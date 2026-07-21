"""Cross-project assistant: scope resolution, tool behavior, API contract."""

import json
from unittest.mock import AsyncMock, patch

import pytest
from conftest import async_session_factory
from helpers import add_member, admin_login, create_project, register_and_approve
from langchain_core.messages import AIMessage, HumanMessage
from sqlalchemy import select

from app.api import knowledge as knowledge_api
from app.models.user import User
from app.services import agent_service
from app.services.agent_service import (
    create_task,
    get_user_project_scope,
    read_knowledge_doc,
    search_knowledge,
    update_task,
)


@pytest.fixture(autouse=True)
def manual_indexing(monkeypatch):
    """Disable background indexing (same rationale as test_knowledge.py)."""
    monkeypatch.setattr(knowledge_api, "index_document", lambda *a, **k: None)
    monkeypatch.setattr(knowledge_api, "index_uploaded_document", lambda *a, **k: None)


async def _admin_user(session):
    result = await session.execute(select(User).where(User.username == "admin"))
    user = result.scalars().first()
    assert user is not None
    return user


def _cross_config(session, user, project_ids, project_names):
    return {
        "configurable": {
            "db": session,
            "user": user,
            "project_id": None,
            "project_ids": project_ids,
            "project_names": project_names,
            "actions": [],
            "pending_question": {},
        }
    }


def _create_doc(client, headers, project_id, title, content):
    resp = client.post(
        f"/api/projects/{project_id}/knowledge",
        headers=headers,
        json={"title": title, "content": content},
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


# ---------------------------------------------------------------------------
# Scope resolution
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_scope_follows_memberships_and_updates_on_removal(client):
    """Cross-project scope = current memberships; removal takes effect on the
    next run (old sessions lose access immediately)."""
    headers = admin_login(client)
    p1, _ = create_project(client, headers, name="范围项目一")
    p2, _ = create_project(client, headers, name="范围项目二")
    other_id, _ = register_and_approve(client, headers, "scope-user")
    add_member(client, headers, p1, other_id, role="member")

    session = async_session_factory()
    try:
        result = await session.execute(select(User).where(User.id == other_id))
        user = result.scalars().first()

        ids, names = await get_user_project_scope(session, user)
        assert ids == [p1]
        assert names == {p1: "范围项目一"}

        add_member(client, headers, p2, other_id, role="member")
        ids, names = await get_user_project_scope(session, user)
        assert ids == [p1, p2]
        assert names[p2] == "范围项目二"

        # Removed from p2 → scope shrinks again
        resp = client.delete(f"/api/projects/{p2}/members/{other_id}", headers=headers)
        assert resp.status_code == 200
        ids, _ = await get_user_project_scope(session, user)
        assert ids == [p1]
    finally:
        await session.close()


# ---------------------------------------------------------------------------
# Knowledge tools across projects
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_search_knowledge_cross_project_annotates_source(client, monkeypatch):
    headers = admin_login(client)
    p1, _ = create_project(client, headers, name="检索项目一")
    p2, _ = create_project(client, headers, name="检索项目二")

    async def fake_retrieve(query, pid, db, top_k=None):
        assert pid == [p1, p2]  # whole scope passed to retrieval
        return [
            {"content": "项目一的部署手册", "doc_title": "部署手册", "project_id": p1,
             "vector_score": 0.9, "keyword_score": 0.5},
            {"content": "项目二的发布清单", "doc_title": "发布清单", "project_id": p2,
             "vector_score": None, "keyword_score": 0.6},
        ]

    monkeypatch.setattr(agent_service.rag_service, "retrieve_context", fake_retrieve)
    session = async_session_factory()
    try:
        user = await _admin_user(session)
        config = _cross_config(session, user, [p1, p2], {p1: "检索项目一", p2: "检索项目二"})
        result = await search_knowledge.ainvoke({"query": "部署"}, config=config)
    finally:
        await session.close()

    assert "【检索项目一】《部署手册》" in result
    assert "【检索项目二】《发布清单》" in result


@pytest.mark.asyncio
async def test_read_knowledge_doc_out_of_scope_rejected(client):
    headers = admin_login(client)
    p1, _ = create_project(client, headers, name="文档项目一")
    p2, _ = create_project(client, headers, name="文档项目二")
    doc = _create_doc(client, headers, p1, title="机密手册", content="绝密内容")

    session = async_session_factory()
    try:
        user = await _admin_user(session)
        # Scope only covers p2 → the p1 doc must be invisible
        config = _cross_config(session, user, [p2], {p2: "文档项目二"})
        result = await read_knowledge_doc.ainvoke({"doc_id": doc["id"]}, config=config)
    finally:
        await session.close()

    assert "未找到文档" in result
    assert "不属于你参与的项目" in result
    assert "绝密内容" not in result


@pytest.mark.asyncio
async def test_read_knowledge_doc_cross_project_ok(client):
    headers = admin_login(client)
    p1, _ = create_project(client, headers, name="读取项目一")
    p2, _ = create_project(client, headers, name="读取项目二")
    doc = _create_doc(client, headers, p1, title="公开手册", content="第一段内容")

    session = async_session_factory()
    try:
        user = await _admin_user(session)
        config = _cross_config(session, user, [p1, p2], {p1: "读取项目一", p2: "读取项目二"})
        result = await read_knowledge_doc.ainvoke({"doc_id": doc["id"]}, config=config)
    finally:
        await session.close()

    assert "【读取项目一】《公开手册》" in result
    assert "第一段内容" in result


# ---------------------------------------------------------------------------
# Write tools: must ask when the target project is ambiguous
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_create_task_cross_project_asks_when_target_missing(client):
    headers = admin_login(client)
    p1, statuses1 = create_project(client, headers, name="写入项目一")
    p2, _ = create_project(client, headers, name="写入项目二")

    session = async_session_factory()
    try:
        user = await _admin_user(session)
        config = _cross_config(session, user, [p1, p2], {p1: "写入项目一", p2: "写入项目二"})
        result = await create_task.ainvoke(
            {"title": "新任务", "status_id": statuses1[0]["id"]}, config=config
        )
        pending = config["configurable"]["pending_question"]
        actions = config["configurable"]["actions"]
    finally:
        await session.close()

    assert "已向用户提问" in result
    assert pending.get("question"), "pending question must be recorded"
    assert set(pending.get("options") or []) == {"写入项目一", "写入项目二"}
    assert actions == [], "no task may be created before the user answers"


@pytest.mark.asyncio
async def test_create_task_cross_project_with_explicit_project(client):
    headers = admin_login(client)
    p1, statuses1 = create_project(client, headers, name="指定项目一")
    p2, _ = create_project(client, headers, name="指定项目二")

    session = async_session_factory()
    try:
        user = await _admin_user(session)
        config = _cross_config(session, user, [p1, p2], {p1: "指定项目一", p2: "指定项目二"})
        result = await create_task.ainvoke(
            {"title": "明确任务", "status_id": statuses1[0]["id"], "project_id": p1},
            config=config,
        )
        pending = config["configurable"]["pending_question"]
    finally:
        await session.close()

    payload = json.loads(result)
    assert payload["ok"] is True
    assert payload["action"]["type"] == "create_task"
    assert "创建任务" in payload["message"]
    assert "【指定项目一】" in payload["message"]
    assert pending == {}, "explicit target must not trigger a clarifying question"


@pytest.mark.asyncio
async def test_create_task_rejects_out_of_scope_project(client):
    headers = admin_login(client)
    p1, statuses1 = create_project(client, headers, name="越权项目一")
    p2, _ = create_project(client, headers, name="越权项目二")

    session = async_session_factory()
    try:
        user = await _admin_user(session)
        config = _cross_config(session, user, [p1, p2], {p1: "越权项目一", p2: "越权项目二"})
        result = await create_task.ainvoke(
            {"title": "越权任务", "status_id": statuses1[0]["id"], "project_id": 99999},
            config=config,
        )
    finally:
        await session.close()

    assert "不在你当前可访问的项目范围内" in result


@pytest.mark.asyncio
async def test_update_task_cross_project_resolves_by_task_id(client):
    """task_id uniquely identifies the project; no need to ask."""
    headers = admin_login(client)
    p1, statuses1 = create_project(client, headers, name="定位项目一")
    p2, _ = create_project(client, headers, name="定位项目二")

    session = async_session_factory()
    try:
        user = await _admin_user(session)
        config = _cross_config(session, user, [p1, p2], {p1: "定位项目一", p2: "定位项目二"})
        created = await create_task.ainvoke(
            {"title": "原始标题", "status_id": statuses1[0]["id"], "project_id": p1},
            config=config,
        )
        task_id = json.loads(created)["action"]["task_id"]

        # No project_id given: the tool resolves it from the task itself
        result = await update_task.ainvoke({"task_id": task_id, "title": "更新标题"}, config=config)
    finally:
        await session.close()

    assert "已更新任务" in result


# ---------------------------------------------------------------------------
# API contract
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_cross_project_session_crud_and_isolation(client):
    headers = admin_login(client)
    p1, _ = create_project(client, headers, name="会话项目")
    other_id, other_headers = register_and_approve(client, headers, "cross-user")
    add_member(client, headers, p1, other_id, role="member")

    # Create a cross-project session (project_id omitted)
    resp = client.post("/api/llm/sessions", headers=headers, json={"title": "跨项目会话"})
    assert resp.status_code == 201
    cross = resp.json()
    assert cross["project_id"] is None

    # scope=all_my_projects lists it; the project list does not
    resp = client.get("/api/llm/sessions", headers=headers, params={"scope": "all_my_projects"})
    assert [s["id"] for s in resp.json()] == [cross["id"]]
    resp = client.get("/api/llm/sessions", headers=headers, params={"project_id": p1})
    assert resp.json() == []

    # scope=project still requires project_id
    resp = client.get("/api/llm/sessions", headers=headers)
    assert resp.status_code == 422

    # Other users cannot see it (404, no existence leak)
    assert client.get(f"/api/llm/sessions/{cross['id']}", headers=other_headers).status_code == 404
    resp = client.get("/api/llm/sessions", headers=other_headers, params={"scope": "all_my_projects"})
    assert resp.json() == []


@pytest.mark.asyncio
async def test_agent_chat_scope_validation(client):
    headers = admin_login(client)
    p1, _ = create_project(client, headers, name="校验项目")

    # scope=all_my_projects must not carry project_id
    resp = client.post(
        "/api/llm/agent-chat",
        headers=headers,
        json={"scope": "all_my_projects", "project_id": p1, "message": "你好"},
    )
    assert resp.status_code == 422

    # scope=project requires project_id
    resp = client.post("/api/llm/agent-chat", headers=headers, json={"message": "你好"})
    assert resp.status_code == 422

    # A cross-project session cannot be reused as a project session
    resp = client.post("/api/llm/sessions", headers=headers, json={"title": "跨项目"})
    cross_id = resp.json()["id"]
    resp = client.post(
        "/api/llm/agent-chat",
        headers=headers,
        json={"project_id": p1, "session_id": cross_id, "message": "你好"},
    )
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_agent_chat_cross_project_run_uses_null_project(client):
    headers = admin_login(client)
    create_project(client, headers, name="运行项目")

    fake_result = {
        "message": "跨项目回答",
        "actions": [],
        "messages": [HumanMessage(content="总览"), AIMessage(content="跨项目回答")],
        "pending_question": None,
        "action_batch_id": None,
    }
    mock_run = AsyncMock(return_value=fake_result)
    with patch("app.api.llm.run_agent", mock_run):
        resp = client.post(
            "/api/llm/agent-chat",
            headers=headers,
            json={"scope": "all_my_projects", "message": "给我所有项目的总览"},
        )

    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["message"] == "跨项目回答"
    # The agent ran with the cross-project (None) scope
    assert mock_run.await_count == 1
    assert mock_run.await_args.kwargs["project_id"] is None
    # The created session is a cross-project session
    detail = client.get(f"/api/llm/sessions/{data['session_id']}", headers=headers)
    assert detail.status_code == 200
    assert detail.json()["project_id"] is None


# ---------------------------------------------------------------------------
# Migration
# ---------------------------------------------------------------------------
def test_cross_project_session_migration_up_down_on_sqlite(tmp_path):
    """alembic upgrade head / downgrade -1 / upgrade head must all succeed on
    SQLite, and downgrade must delete cross-project (NULL project) sessions
    while keeping project sessions."""
    import os
    import sqlite3
    import subprocess
    import sys
    from pathlib import Path

    db_file = tmp_path / "mig.db"
    backend_dir = Path(__file__).resolve().parents[1]
    env = {
        **os.environ,
        "DATABASE_URL": f"sqlite+aiosqlite:///{db_file}",
        "JWT_SECRET": "migration-test",
    }

    def alembic(*args: str) -> None:
        result = subprocess.run(
            [sys.executable, "-m", "alembic", *args],
            cwd=backend_dir, env=env, capture_output=True, text=True,
        )
        assert result.returncode == 0, result.stderr

    alembic("upgrade", "head")

    # Seed one project session and one cross-project session
    conn = sqlite3.connect(db_file)
    conn.execute(
        "INSERT INTO users (username, email, hashed_password, display_name, avatar_url, "
        "is_active, is_superuser, is_approved, can_create_project, created_at, updated_at) "
        "VALUES ('m', 'm@x.com', 'x', '', '', 1, 0, 1, 1, '2026-01-01', '2026-01-01')"
    )
    conn.execute(
        "INSERT INTO projects (name, description, color, owner_id, is_archived, created_at, updated_at) "
        "VALUES ('p', '', '#000000', 1, 0, '2026-01-01', '2026-01-01')"
    )
    conn.execute(
        "INSERT INTO llm_chat_sessions (user_id, project_id, title, created_at, updated_at) "
        "VALUES (1, 1, '项目会话', '2026-01-01', '2026-01-01')"
    )
    conn.execute(
        "INSERT INTO llm_chat_sessions (user_id, project_id, title, created_at, updated_at) "
        "VALUES (1, NULL, '跨项目会话', '2026-01-01', '2026-01-01')"
    )
    conn.commit()
    conn.close()

    alembic("downgrade", "-1")
    conn = sqlite3.connect(db_file)
    titles = [r[0] for r in conn.execute("SELECT title FROM llm_chat_sessions")]
    conn.close()
    assert titles == ["项目会话"], "downgrade must drop NULL-project sessions only"

    alembic("upgrade", "head")
    conn = sqlite3.connect(db_file)
    nullable = conn.execute(
        "SELECT COUNT(*) FROM pragma_table_info('llm_chat_sessions') "
        "WHERE name='project_id' AND \"notnull\"=0"
    ).fetchone()[0]
    conn.close()
    assert nullable == 1
