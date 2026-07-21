"""Tests for the embedding pipeline: retry/backoff, batching, bounded
concurrency, and the upload-commit regression fix.

Retry tests exercise call_with_embedding_retry with real openai exception
types; pipeline tests run on SQLite (conftest engine) with the embedding
HTTP layer stubbed out.
"""
import asyncio

import httpx
import pytest
from helpers import admin_login, create_project
from openai import APIStatusError, RateLimitError
from sqlalchemy import select

from app.models.knowledge import DocChunk, DocChunkEmbedding, KnowledgeDoc
from app.services import rag_service as rag_module
from app.services.config_service import config_service
from app.services.knowledge_indexing import index_uploaded_document
from app.services.rag_service import (
    call_with_embedding_retry,
    rag_service,
)
from tests.conftest import async_session_factory


def _status_error(status_code: int):
    from openai import APIStatusError, RateLimitError

    request = httpx.Request("POST", "http://test/v1/embeddings")
    response = httpx.Response(status_code, request=request)
    if status_code == 429:
        return RateLimitError("rate limited", response=response, body=None)
    return APIStatusError(f"status {status_code}", response=response, body=None)


# ---------------------------------------------------------------------------
# call_with_embedding_retry
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_retry_succeeds_after_429s():
    calls = 0

    async def flaky():
        nonlocal calls
        calls += 1
        if calls < 3:
            raise _status_error(429)
        return "ok"

    result = await call_with_embedding_retry(flaky, max_retries=4, base_delay=0.01)
    assert result == "ok"
    assert calls == 3


@pytest.mark.asyncio
async def test_retry_exhaustion_raises():
    calls = 0

    async def always_limited():
        nonlocal calls
        calls += 1
        raise _status_error(429)

    with pytest.raises(RateLimitError):
        await call_with_embedding_retry(always_limited, max_retries=2, base_delay=0.01)
    assert calls == 3  # 1 initial + 2 retries


@pytest.mark.asyncio
async def test_client_error_not_retried():
    calls = 0

    async def bad_request():
        nonlocal calls
        calls += 1
        raise _status_error(400)

    with pytest.raises(APIStatusError):
        await call_with_embedding_retry(bad_request, max_retries=4, base_delay=0.01)
    assert calls == 1  # 4xx (non-429) is not retryable


@pytest.mark.asyncio
async def test_connection_error_retried():
    from openai import APIConnectionError

    calls = 0

    async def flaky():
        nonlocal calls
        calls += 1
        if calls == 1:
            raise APIConnectionError(request=httpx.Request("POST", "http://test"))
        return "ok"

    result = await call_with_embedding_retry(flaky, max_retries=2, base_delay=0.01)
    assert result == "ok"
    assert calls == 2


# ---------------------------------------------------------------------------
# embed_texts: config-driven client + batch request shape
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_embed_texts_uses_runtime_config_and_batches(monkeypatch):
    captured = {}

    class FakeEmbeddings:
        async def create(self, model, input):
            captured["model"] = model
            captured["input"] = input
            return type("Resp", (), {
                "data": [type("Item", (), {"embedding": [0.1, 0.2]})() for _ in input],
            })()

    class FakeClient:
        def __init__(self, **kwargs):
            captured["client_kwargs"] = kwargs
            self.embeddings = FakeEmbeddings()

    config_values = {
        "embedding_api_key": "",
        "embedding_base_url": "",
        "llm_api_key": "sk-test",
        "llm_base_url": "http://llm.example/v1",
        "llm_embedding_model": "emb-model-x",
        "embedding_timeout": 30.0,
        "embedding_max_retries": 0,
        "embedding_retry_base_delay": 1.0,
    }

    async def fake_get(key):
        return config_values[key]

    monkeypatch.setattr(config_service, "get", fake_get)
    monkeypatch.setattr("openai.AsyncOpenAI", FakeClient)

    vectors = await rag_service.embed_texts(["第一段文本", "第二段文本"])
    assert vectors == [[0.1, 0.2], [0.1, 0.2]]
    # One batched API call carrying both texts
    assert captured["input"] == ["第一段文本", "第二段文本"]
    assert captured["model"] == "emb-model-x"
    # Falls back to the llm_* credentials and applies the configured timeout
    assert captured["client_kwargs"]["api_key"] == "sk-test"
    assert captured["client_kwargs"]["base_url"] == "http://llm.example/v1"
    assert captured["client_kwargs"]["timeout"] == 30.0
    assert captured["client_kwargs"]["max_retries"] == 0


# ---------------------------------------------------------------------------
# chunk_document: bounded concurrency
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_chunk_document_bounded_concurrency(client, monkeypatch):
    monkeypatch.setattr(rag_module.settings, "llm_api_key", "fake-key")
    monkeypatch.setattr(rag_module.settings, "embedding_concurrency", 2)
    monkeypatch.setattr(rag_module.settings, "embedding_batch_size", 1)
    monkeypatch.setattr(rag_module.settings, "chunk_size", 40)
    monkeypatch.setattr(rag_module.settings, "chunk_overlap", 0)

    current = 0
    peak = 0

    async def fake_embed_texts(texts):
        nonlocal current, peak
        current += 1
        peak = max(peak, current)
        await asyncio.sleep(0.02)
        current -= 1
        # Dimension must match the pgvector column (settings.llm_embedding_dim).
        return [[0.1] * 1536 for _ in texts]

    monkeypatch.setattr(rag_service, "embed_texts", fake_embed_texts)

    content = "\n\n".join(f"第{i}段内容，包含足够多的文字以构成分块。" for i in range(6))
    async with async_session_factory() as session:
        doc = KnowledgeDoc(
            project_id=1, title="并发测试", content=content,
            file_type="text", created_by=1, status="indexing",
        )
        session.add(doc)
        await session.commit()
        await session.refresh(doc)
        await rag_service.chunk_document(doc.title, doc.content, doc.id, session)
        await session.commit()
        doc_id = doc.id

    # 6 paragraphs, chunk_size=40 → several chunks → multiple batches
    assert peak <= 2, f"并发峰值 {peak} 超过限制的 2"
    async with async_session_factory() as session:
        chunks = (await session.execute(
            select(DocChunk).where(DocChunk.doc_id == doc_id)
        )).scalars().all()
        assert len(chunks) >= 3
        for chunk in chunks:
            emb = (await session.execute(
                select(DocChunkEmbedding).where(DocChunkEmbedding.chunk_id == chunk.id)
            )).scalar_one_or_none()
            assert emb is not None
        await session.delete(doc)
        await session.commit()


# ---------------------------------------------------------------------------
# Upload regression: doc must be committed before the background task runs
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_uploaded_doc_visible_to_background_session(client):
    """Regression: the upload endpoint used to only flush (not commit) the
    doc before scheduling the background indexing task. The task opens its
    own session and, running before the request session's commit, found no
    document and silently returned — leaving docs stuck in 'indexing'
    forever with empty content.
    """
    md_bytes = "# 发布计划\n\n第一阶段：完成后端接口。\n\n第二阶段：前端联调与回归测试。".encode()

    headers = admin_login(client)
    project_id, _ = create_project(client, headers)
    response = client.post(
        f"/api/projects/{project_id}/knowledge/upload",
        headers=headers,
        files={"file": ("发布计划.md", md_bytes, "text/markdown")},
    )
    assert response.status_code == 201, response.text
    doc_id = response.json()["id"]

    # The doc must be visible in a fresh session immediately after the
    # response (i.e. it was committed inside the endpoint). Depending on
    # the TestClient's background-task timing the pipeline may already
    # have finished — both states prove the doc was committed.
    async with async_session_factory() as session:
        doc = await session.get(KnowledgeDoc, doc_id)
        assert doc is not None
        assert doc.status in ("indexing", "indexed")

    # The full pipeline then runs to a terminal state against that doc.
    client.portal.call(index_uploaded_document, doc_id, md_bytes, "md")

    response = client.get(f"/api/projects/{project_id}/knowledge/{doc_id}", headers=headers)
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "indexed"
    assert body["content"]
    assert body["chunk_count"] >= 1
