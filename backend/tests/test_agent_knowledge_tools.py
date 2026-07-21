"""Agent knowledge-tool coverage: search_knowledge / list_knowledge_docs /
get_doc_content plus the knowledge policy in the system prompt.

Tool functions are invoked directly via `.ainvoke` with a RunnableConfig
carrying a real SQLite session, the admin user, and a project — the same
shape the agent runner builds. Retrieval is stubbed via monkeypatch where
formatting/empty-contract behavior is under test.
"""
import pytest
from sqlalchemy import select

from app.api import knowledge as knowledge_api
from app.models.user import User
from app.services import agent_service
from app.services.agent_service import (
    get_doc_content,
    list_knowledge_docs,
    search_knowledge,
)
from conftest import async_session_factory
from helpers import admin_login, create_project


@pytest.fixture(autouse=True)
def manual_indexing(monkeypatch):
    """Disable background scheduling; tests run indexing explicitly
    (same rationale as test_knowledge.py)."""
    monkeypatch.setattr(knowledge_api, "index_document", lambda *a, **k: None)
    monkeypatch.setattr(knowledge_api, "index_uploaded_document", lambda *a, **k: None)


async def _tool_config(project_id: int):
    """Build (config, session) for direct tool invocation."""
    session = async_session_factory()
    result = await session.execute(select(User).where(User.username == "admin"))
    user = result.scalars().first()
    assert user is not None
    config = {
        "configurable": {
            "db": session,
            "user": user,
            "project_id": project_id,
            "actions": [],
        }
    }
    return config, session


def _create_doc(client, headers, project_id, title="部署手册", content="第一段：构建。\n\n第二段：发布。"):
    response = client.post(
        f"/api/projects/{project_id}/knowledge",
        headers=headers,
        json={"title": title, "content": content},
    )
    assert response.status_code == 201, response.text
    return response.json()


@pytest.mark.asyncio
async def test_search_knowledge_formats_hits(client, monkeypatch):
    headers = admin_login(client)
    project_id, _ = create_project(client, headers)

    async def fake_retrieve(query, pid, db, top_k=None):
        assert top_k == 5  # capped
        assert pid == project_id
        return [
            {
                "content": "A" * 400,
                "doc_title": "部署手册",
                "similarity": 0.86,
            },
            {"content": "短内容", "doc_title": "FAQ", "similarity": 0.42},
        ]

    monkeypatch.setattr(agent_service.rag_service, "retrieve_context", fake_retrieve)
    config, session = await _tool_config(project_id)
    try:
        result = await search_knowledge.ainvoke({"query": "部署"}, config=config)
    finally:
        await session.close()

    assert "《部署手册》(相似度 86%)" in result
    assert "A" * 300 in result
    assert "A" * 301 not in result  # each chunk truncated to ~300 chars
    assert "…" in result
    assert "《FAQ》(相似度 42%)" in result
    assert "短内容" in result


@pytest.mark.asyncio
async def test_search_knowledge_empty_returns_explicit_negative(client, monkeypatch):
    headers = admin_login(client)
    project_id, _ = create_project(client, headers)

    async def fake_retrieve(query, pid, db, top_k=None):
        return []

    monkeypatch.setattr(agent_service.rag_service, "retrieve_context", fake_retrieve)
    config, session = await _tool_config(project_id)
    try:
        result = await search_knowledge.ainvoke({"query": "发布流程"}, config=config)
    finally:
        await session.close()

    # Contract relied on by later phases: explicit negative, exact shape.
    assert result == "知识库中没有找到与「发布流程」相关的内容"


@pytest.mark.asyncio
async def test_search_knowledge_uses_real_plain_text_retrieval_and_status_filter(client):
    """End-to-end through rag_service (SQLite plain-text path): only
    'indexed' docs are searchable; an un-indexed doc yields the negative."""
    from app.services.knowledge_indexing import index_document

    headers = admin_login(client)
    project_id, _ = create_project(client, headers)
    pending = _create_doc(client, headers, project_id, title="未索引手册", content="部署需要先构建")

    config, session = await _tool_config(project_id)
    try:
        # Doc is still in 'indexing' status → must be skipped.
        result = await search_knowledge.ainvoke({"query": "部署"}, config=config)
        assert result == "知识库中没有找到与「部署」相关的内容"

        # Index it → now searchable.
        client.portal.call(index_document, pending["id"])
        await session.close()
        config, session = await _tool_config(project_id)
        result = await search_knowledge.ainvoke({"query": "部署"}, config=config)
        assert "《未索引手册》" in result
        assert "部署需要先构建" in result
    finally:
        await session.close()


@pytest.mark.asyncio
async def test_list_knowledge_docs_lists_docs(client):
    from app.services.knowledge_indexing import index_document

    headers = admin_login(client)
    project_id, _ = create_project(client, headers)
    doc = _create_doc(client, headers, project_id)
    client.portal.call(index_document, doc["id"])

    config, session = await _tool_config(project_id)
    try:
        result = await list_knowledge_docs.ainvoke({}, config=config)
    finally:
        await session.close()

    assert f"[id={doc['id']}] 部署手册" in result
    assert "类型=text" in result
    assert "状态=indexed" in result
    assert "分块数=" in result


@pytest.mark.asyncio
async def test_list_knowledge_docs_empty_project(client):
    headers = admin_login(client)
    project_id, _ = create_project(client, headers)

    config, session = await _tool_config(project_id)
    try:
        result = await list_knowledge_docs.ainvoke({}, config=config)
    finally:
        await session.close()

    assert result == "当前项目还没有知识库文档。"


@pytest.mark.asyncio
async def test_get_doc_content_by_id_and_title(client):
    headers = admin_login(client)
    project_id, _ = create_project(client, headers)
    doc = _create_doc(client, headers, project_id)

    config, session = await _tool_config(project_id)
    try:
        by_id = await get_doc_content.ainvoke({"doc_id": doc["id"]}, config=config)
        by_title = await get_doc_content.ainvoke({"title": "部署手册"}, config=config)
    finally:
        await session.close()

    for result in (by_id, by_title):
        assert result.startswith(f"《部署手册》 (id={doc['id']}")
        assert "第一段：构建。" in result
        assert "第二段：发布。" in result


@pytest.mark.asyncio
async def test_get_doc_content_truncates_long_docs(client):
    headers = admin_login(client)
    project_id, _ = create_project(client, headers)
    doc = _create_doc(client, headers, project_id, title="长文档", content="长" * 5000)

    config, session = await _tool_config(project_id)
    try:
        result = await get_doc_content.ainvoke({"doc_id": doc["id"]}, config=config)
    finally:
        await session.close()

    assert "已截断至 4000 字符" in result
    assert "长" * 4000 in result
    assert "长" * 4001 not in result


@pytest.mark.asyncio
async def test_get_doc_content_not_found(client):
    headers = admin_login(client)
    project_id, _ = create_project(client, headers)

    config, session = await _tool_config(project_id)
    try:
        result = await get_doc_content.ainvoke({"doc_id": 99999}, config=config)
    finally:
        await session.close()

    assert "未找到文档" in result
    assert "list_knowledge_docs" in result


def test_system_prompt_contains_knowledge_policy():
    prompt = agent_service._build_system_prompt(
        {"project_name": "演示项目", "project_description": ""}
    )
    assert "search_knowledge" in prompt
    assert "list_knowledge_docs" in prompt
    assert "get_doc_content" in prompt
    assert "知识库使用规则" in prompt
    assert "不得编造知识库内容" in prompt
    assert "注明来源文档名" in prompt
    assert "优先查知识库" in prompt


def test_knowledge_tools_registered_in_tools_list():
    names = {t.name for t in agent_service.tools}
    assert {"search_knowledge", "list_knowledge_docs", "get_doc_content"} <= names
