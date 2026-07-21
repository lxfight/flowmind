"""Knowledge/RAG coverage without external LLM or network access.

LLM_API_KEY is empty in tests, so chunking stores plain-text chunks and
retrieval uses the SQLite/plain-text path. The one LLM call (answer
generation) is stubbed via monkeypatch.

Indexing is asynchronous: Starlette's TestClient runs FastAPI
BackgroundTasks before returning, so by the time a request completes the
background indexing coroutine has finished and the doc status is settled
('indexed' or 'failed'). The create/upload response body itself is a
pre-indexing snapshot showing status='indexing'.
"""
import pytest
from helpers import add_member, admin_login, create_project, register_and_approve

from app.api import knowledge as knowledge_api
from app.services.knowledge_indexing import index_document, index_uploaded_document
from app.services.rag_service import rag_service

# NOTE: this starlette TestClient defers FastAPI BackgroundTasks until a
# later request and may run several of them concurrently on separate event
# loops (racy against SQLite). Tests therefore replace the scheduled
# background callables with no-ops and drive the real indexing coroutine
# explicitly on the app's event loop via client.portal.call.


@pytest.fixture(autouse=True)
def manual_indexing(monkeypatch):
    """Disable background scheduling; tests run indexing explicitly."""
    monkeypatch.setattr(knowledge_api, "index_document", lambda *a, **k: None)
    monkeypatch.setattr(knowledge_api, "index_uploaded_document", lambda *a, **k: None)


def _create_doc(client, headers, project_id, title="部署手册", content="第一段：构建。\n\n第二段：发布。"):
    response = client.post(
        f"/api/projects/{project_id}/knowledge",
        headers=headers,
        json={"title": title, "content": content},
    )
    assert response.status_code == 201, response.text
    return response.json()


def _get_doc(client, headers, project_id, doc_id):
    response = client.get(f"/api/projects/{project_id}/knowledge/{doc_id}", headers=headers)
    assert response.status_code == 200, response.text
    return response.json()


@pytest.mark.asyncio
async def test_knowledge_doc_crud_happy_path(client):
    headers = admin_login(client)
    project_id, _ = create_project(client, headers)

    doc = _create_doc(client, headers, project_id)
    assert doc["title"] == "部署手册"
    # Response is a snapshot taken before background indexing runs.
    assert doc["status"] == "indexing"

    client.portal.call(index_document, doc["id"])
    settled = _get_doc(client, headers, project_id, doc["id"])
    assert settled["status"] == "indexed"
    assert settled["error_message"] is None
    assert settled["chunk_count"] >= 1
    assert settled["content"].startswith("第一段")

    response = client.get(f"/api/projects/{project_id}/knowledge", headers=headers)
    assert response.status_code == 200
    body = response.json()
    assert body["total"] == 1
    assert body["items"][0]["id"] == doc["id"]
    assert body["items"][0]["status"] == "indexed"

    response = client.delete(
        f"/api/projects/{project_id}/knowledge/{doc['id']}", headers=headers
    )
    assert response.status_code == 200
    response = client.get(
        f"/api/projects/{project_id}/knowledge/{doc['id']}", headers=headers
    )
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_knowledge_upload_txt_file(client):
    headers = admin_login(client)
    project_id, _ = create_project(client, headers)

    response = client.post(
        f"/api/projects/{project_id}/knowledge/upload",
        headers=headers,
        files={"file": ("会议记录.txt", "本周同步了发布计划".encode(), "text/plain")},
    )
    assert response.status_code == 201, response.text
    doc = response.json()
    assert doc["title"] == "会议记录"
    assert doc["file_type"] == "txt"
    assert doc["status"] == "indexing"

    # markitdown parsing + chunking run in the background task.
    client.portal.call(index_uploaded_document, doc["id"], "本周同步了发布计划".encode(), "txt")
    settled = _get_doc(client, headers, project_id, doc["id"])
    assert settled["status"] == "indexed"
    assert settled["content"] == "本周同步了发布计划"
    assert settled["chunk_count"] >= 1

    # Unsupported extension is rejected
    response = client.post(
        f"/api/projects/{project_id}/knowledge/upload",
        headers=headers,
        files={"file": ("evil.exe", b"MZ", "application/octet-stream")},
    )
    assert response.status_code == 400

    # Empty file is rejected
    response = client.post(
        f"/api/projects/{project_id}/knowledge/upload",
        headers=headers,
        files={"file": ("empty.txt", b"", "text/plain")},
    )
    assert response.status_code == 400


@pytest.mark.asyncio
async def test_knowledge_indexing_failure_sets_failed_status(client, monkeypatch):
    """A failing chunk/embed pipeline marks the doc failed with error_message."""
    headers = admin_login(client)
    project_id, _ = create_project(client, headers)

    async def boom(*args, **kwargs):
        raise RuntimeError("embedding backend exploded")

    monkeypatch.setattr(rag_service, "chunk_document", boom)

    doc = _create_doc(client, headers, project_id, title="坏文档", content="内容")
    assert doc["status"] == "indexing"  # no more 502 on index failure

    client.portal.call(index_document, doc["id"])
    settled = _get_doc(client, headers, project_id, doc["id"])
    assert settled["status"] == "failed"
    assert "embedding backend exploded" in settled["error_message"]


@pytest.mark.asyncio
async def test_knowledge_reindex_recovers_failed_doc(client, monkeypatch):
    headers = admin_login(client)
    project_id, _ = create_project(client, headers)

    original_chunk = rag_service.chunk_document

    async def boom(*args, **kwargs):
        raise RuntimeError("temporary failure")

    monkeypatch.setattr(rag_service, "chunk_document", boom)
    doc = _create_doc(client, headers, project_id)
    client.portal.call(index_document, doc["id"])
    assert _get_doc(client, headers, project_id, doc["id"])["status"] == "failed"

    # Restore chunking directly; monkeypatch.undo() would also revert the
    # manual_indexing fixture's no-op of the API background callables.
    monkeypatch.setattr(rag_service, "chunk_document", original_chunk)
    response = client.post(
        f"/api/projects/{project_id}/knowledge/{doc['id']}/reindex", headers=headers
    )
    assert response.status_code == 200, response.text
    assert response.json()["status"] == "indexing"
    client.portal.call(index_document, doc["id"])
    settled = _get_doc(client, headers, project_id, doc["id"])
    assert settled["status"] == "indexed"
    assert settled["error_message"] is None
    assert settled["chunk_count"] >= 1


@pytest.mark.asyncio
async def test_knowledge_upload_parse_failure_sets_failed_status(client, monkeypatch):
    """markitdown raising in the background marks the upload as failed."""
    headers = admin_login(client)
    project_id, _ = create_project(client, headers)

    class BrokenMarkItDown:
        def convert_stream(self, *args, **kwargs):
            raise ValueError("corrupt file")

    import markitdown
    monkeypatch.setattr(markitdown, "MarkItDown", BrokenMarkItDown)

    response = client.post(
        f"/api/projects/{project_id}/knowledge/upload",
        headers=headers,
        files={"file": ("broken.txt", b"whatever", "text/plain")},
    )
    assert response.status_code == 201, response.text
    client.portal.call(index_uploaded_document, response.json()["id"], b"whatever", "txt")
    settled = _get_doc(client, headers, project_id, response.json()["id"])
    assert settled["status"] == "failed"
    assert "corrupt file" in settled["error_message"]


@pytest.mark.asyncio
async def test_knowledge_edit_triggers_background_reindex(client):
    headers = admin_login(client)
    project_id, _ = create_project(client, headers)
    doc = _create_doc(client, headers, project_id)

    response = client.put(
        f"/api/projects/{project_id}/knowledge/{doc['id']}",
        headers=headers,
        json={"content": "全新内容，重新切片。"},
    )
    assert response.status_code == 200, response.text
    assert response.json()["status"] == "indexing"

    client.portal.call(index_document, doc["id"])
    settled = _get_doc(client, headers, project_id, doc["id"])
    assert settled["status"] == "indexed"
    assert settled["content"] == "全新内容，重新切片。"
    assert settled["chunk_count"] >= 1


@pytest.mark.asyncio
async def test_knowledge_chunks_endpoint(client):
    headers = admin_login(client)
    project_id, _ = create_project(client, headers)
    doc = _create_doc(client, headers, project_id)
    client.portal.call(index_document, doc["id"])

    response = client.get(
        f"/api/projects/{project_id}/knowledge/{doc['id']}/chunks", headers=headers
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["total"] >= 1
    assert body["page"] == 1
    first = body["items"][0]
    assert first["seq"] == 0
    assert "第一段" in first["content"]
    # No LLM key in tests → plain-text chunks only, no embeddings stored.
    assert first["has_embedding"] is False

    # Pagination shape
    response = client.get(
        f"/api/projects/{project_id}/knowledge/{doc['id']}/chunks",
        headers=headers,
        params={"page": 2, "page_size": 1},
    )
    assert response.status_code == 200
    assert response.json()["page"] == 2

    # Unknown doc → 404
    response = client.get(
        f"/api/projects/{project_id}/knowledge/99999/chunks", headers=headers
    )
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_knowledge_viewer_can_read_chunks_but_cannot_reindex(client):
    headers = admin_login(client)
    viewer_id, viewer_headers = register_and_approve(client, headers, "chunkviewer")
    project_id, _ = create_project(client, headers)
    add_member(client, headers, project_id, viewer_id, role="viewer")
    doc = _create_doc(client, headers, project_id)

    response = client.get(
        f"/api/projects/{project_id}/knowledge/{doc['id']}/chunks", headers=viewer_headers
    )
    assert response.status_code == 200

    response = client.post(
        f"/api/projects/{project_id}/knowledge/{doc['id']}/reindex", headers=viewer_headers
    )
    assert response.status_code == 403


@pytest.mark.asyncio
async def test_knowledge_query_with_stubbed_llm(client, monkeypatch):
    headers = admin_login(client)
    project_id, _ = create_project(client, headers)
    doc = _create_doc(client, headers, project_id, title="产品FAQ", content="FlowMind 支持看板拖拽和实时同步。")
    client.portal.call(index_document, doc["id"])

    async def fake_chat(messages, system_prompt=None, **kwargs):
        return "这是基于知识库的回答。"

    monkeypatch.setattr(knowledge_api.llm_service, "chat", fake_chat)
    response = client.post(
        f"/api/projects/{project_id}/knowledge/query",
        headers=headers,
        json={"question": "看板", "top_k": 3},
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["answer"] == "这是基于知识库的回答。"
    assert any(s["title"] == "产品FAQ" for s in body["sources"])


@pytest.mark.asyncio
async def test_knowledge_query_no_match_returns_empty_sources(client, monkeypatch):
    """Plain-text fallback: no keyword match → empty sources (regression
    guard against the old unconditional first-N fallback)."""
    headers = admin_login(client)
    project_id, _ = create_project(client, headers)
    doc = _create_doc(client, headers, project_id, title="产品FAQ", content="FlowMind 支持看板拖拽。")
    client.portal.call(index_document, doc["id"])

    captured = {}

    async def fake_chat(messages, system_prompt=None, **kwargs):
        captured["system_prompt"] = system_prompt
        return "知识库中未找到相关内容。"

    monkeypatch.setattr(knowledge_api.llm_service, "chat", fake_chat)
    response = client.post(
        f"/api/projects/{project_id}/knowledge/query",
        headers=headers,
        json={"question": "完全不相关的词语xyz"},
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["sources"] == []
    assert body["answer"] == "知识库中未找到相关内容。"
    # The LLM was explicitly told there is no relevant knowledge.
    assert "未找到" in (captured["system_prompt"] or "") or "没有" in (captured["system_prompt"] or "")


@pytest.mark.asyncio
async def test_knowledge_query_empty_project_without_llm(client):
    """No docs → retrieval empty → LLM is asked to say so (or 502 when
    no LLM key is configured, which is also an acceptable surfaced failure)."""
    headers = admin_login(client)
    project_id, _ = create_project(client, headers)
    response = client.post(
        f"/api/projects/{project_id}/knowledge/query",
        headers=headers,
        json={"question": "随便问"},
    )
    if response.status_code == 200:
        assert response.json()["sources"] == []
    else:
        assert response.status_code == 502


@pytest.mark.asyncio
async def test_retrieve_context_similarity_threshold(monkeypatch):
    """pgvector path filters chunks below the similarity threshold."""
    from app.services import rag_service as rag_module

    class FakeResult:
        def __init__(self, rows):
            self._rows = rows

        def fetchall(self):
            return self._rows

    class FakeDB:
        async def execute(self, *args, **kwargs):
            # (content, chunk_index, doc_title, similarity)
            return FakeResult([
                ("高相关", 0, "文档A", 0.9),
                ("低相关", 1, "文档A", 0.1),
            ])

    async def fake_embed(text):
        return [0.0] * 1536

    monkeypatch.setattr(rag_module, "_is_sqlite", False)
    monkeypatch.setattr(rag_service, "embed_text", fake_embed)
    monkeypatch.setattr(rag_module.settings, "llm_api_key", "fake-key")
    monkeypatch.setattr(rag_module.settings, "similarity_threshold", 0.35)

    results = await rag_service.retrieve_context("查询", 1, FakeDB())
    assert len(results) == 1
    assert results[0]["content"] == "高相关"
    assert results[0]["similarity"] == 0.9

    # Everything below threshold → empty list ("no relevant knowledge").
    monkeypatch.setattr(rag_module.settings, "similarity_threshold", 0.95)
    results = await rag_service.retrieve_context("查询", 1, FakeDB())
    assert results == []


@pytest.mark.asyncio
async def test_viewer_cannot_create_knowledge_doc(client):
    headers = admin_login(client)
    viewer_id, viewer_headers = register_and_approve(client, headers, "docviewer")
    project_id, _ = create_project(client, headers)
    add_member(client, headers, project_id, viewer_id, role="viewer")

    response = client.post(
        f"/api/projects/{project_id}/knowledge",
        headers=viewer_headers,
        json={"title": "越权", "content": "内容"},
    )
    assert response.status_code == 403
    # Viewer can read the (empty) list
    response = client.get(f"/api/projects/{project_id}/knowledge", headers=viewer_headers)
    assert response.status_code == 200
