import os

import pytest
from sqlalchemy import update

from app.schemas import KnowledgeQuery
from app.schemas.llm_chat import LLMAgentChatRequest, LLMChatSessionCreate
from app.models.task import Task
from app.services.rag_service import rag_service, settings as rag_settings
from conftest import async_session_factory


def _login(client, username: str, password: str) -> dict[str, str]:
    response = client.post(
        "/api/auth/login",
        data={"username": username, "password": password},
    )
    assert response.status_code == 200, response.text
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


def _register_and_approve(client, admin_headers, username: str) -> tuple[int, dict[str, str]]:
    password = "testpass123"
    response = client.post(
        "/api/auth/register",
        json={
            "username": username,
            "email": f"{username}@example.com",
            "password": password,
        },
    )
    assert response.status_code == 201, response.text
    user_id = response.json()["user_id"]
    response = client.post(
        f"/api/admin/users/{user_id}/approve",
        headers=admin_headers,
    )
    assert response.status_code == 200, response.text
    return user_id, _login(client, username, password)


def _create_project(client, admin_headers) -> tuple[int, list[dict]]:
    response = client.post(
        "/api/projects",
        headers=admin_headers,
        json={"name": "权限测试", "description": "", "color": "#336699"},
    )
    assert response.status_code == 201, response.text
    project_id = response.json()["id"]
    response = client.get(f"/api/projects/{project_id}/statuses", headers=admin_headers)
    assert response.status_code == 200, response.text
    return project_id, response.json()


@pytest.mark.asyncio
async def test_viewer_is_read_only(client):
    admin_headers = _login(client, "admin", os.environ.get("FLOWMIND_ADMIN_PASSWORD", "testadmin"))
    viewer_id, viewer_headers = _register_and_approve(client, admin_headers, "readonly")
    project_id, statuses = _create_project(client, admin_headers)
    response = client.post(
        f"/api/projects/{project_id}/members",
        headers=admin_headers,
        json={"user_id": viewer_id, "role": "viewer"},
    )
    assert response.status_code == 200

    response = client.post(
        f"/api/projects/{project_id}/tasks",
        headers=viewer_headers,
        json={"title": "不应创建", "status_id": statuses[0]["id"]},
    )
    assert response.status_code == 403

    response = client.post(
        f"/api/projects/{project_id}/knowledge",
        headers=viewer_headers,
        json={"title": "不应创建", "content": "内容"},
    )
    assert response.status_code == 403

    response = client.get(f"/api/projects/{project_id}/tasks", headers=viewer_headers)
    assert response.status_code == 200


@pytest.mark.asyncio
async def test_subtasks_are_not_top_level_or_counted(client):
    admin_headers = _login(client, "admin", os.environ.get("FLOWMIND_ADMIN_PASSWORD", "testadmin"))
    project_id, statuses = _create_project(client, admin_headers)
    response = client.post(
        f"/api/projects/{project_id}/tasks",
        headers=admin_headers,
        json={"title": "父任务", "status_id": statuses[0]["id"]},
    )
    parent_id = response.json()["id"]
    response = client.post(
        f"/api/projects/{project_id}/tasks",
        headers=admin_headers,
        json={
            "title": "子任务",
            "status_id": statuses[0]["id"],
            "parent_task_id": parent_id,
        },
    )
    assert response.status_code == 201

    response = client.get(f"/api/projects/{project_id}/tasks", headers=admin_headers)
    assert [task["title"] for task in response.json()["items"]] == ["父任务"]

    response = client.get("/api/projects/stats", headers=admin_headers)
    project_stats = next(item for item in response.json()["projects"] if item["project_id"] == project_id)
    assert project_stats["total_tasks"] == 1

    response = client.get(
        f"/api/projects/{project_id}/tasks/{parent_id}",
        headers=admin_headers,
    )
    assert response.json()["subtask_count"] == 1


@pytest.mark.asyncio
async def test_done_status_sync_and_nonempty_status_protection(client):
    admin_headers = _login(client, "admin", os.environ.get("FLOWMIND_ADMIN_PASSWORD", "testadmin"))
    project_id, statuses = _create_project(client, admin_headers)
    active_status = next(status for status in statuses if not status["is_done"])
    done_status = next(status for status in statuses if status["is_done"])
    response = client.post(
        f"/api/projects/{project_id}/tasks",
        headers=admin_headers,
        json={"title": "待完成", "status_id": active_status["id"]},
    )
    task_id = response.json()["id"]

    response = client.patch(
        f"/api/projects/{project_id}/tasks/{task_id}/move",
        headers=admin_headers,
        json={"status_id": done_status["id"], "order": 0},
    )
    assert response.status_code == 200
    assert response.json()["is_completed"] is True
    assert response.json()["completed_at"] is not None

    response = client.delete(
        f"/api/projects/{project_id}/statuses/{done_status['id']}",
        headers=admin_headers,
    )
    assert response.status_code == 409


@pytest.mark.asyncio
async def test_dashboard_completion_uses_status_as_source_of_truth(client):
    admin_headers = _login(client, "admin", os.environ.get("FLOWMIND_ADMIN_PASSWORD", "testadmin"))
    project_id, statuses = _create_project(client, admin_headers)
    done_status = next(status for status in statuses if status["is_done"])
    response = client.post(
        f"/api/projects/{project_id}/tasks",
        headers=admin_headers,
        json={"title": "历史完成任务", "status_id": done_status["id"]},
    )
    assert response.status_code == 201, response.text
    task_id = response.json()["id"]

    # Simulate a task created before completion flags were synchronized with columns.
    async with async_session_factory() as session:
        await session.execute(
            update(Task)
            .where(Task.id == task_id)
            .values(is_completed=False, completed_at=None)
        )
        await session.commit()

    response = client.get("/api/projects/stats", headers=admin_headers)
    assert response.status_code == 200, response.text
    project_stats = next(
        item for item in response.json()["projects"]
        if item["project_id"] == project_id
    )
    assert project_stats["completed_tasks"] == 1


@pytest.mark.asyncio
async def test_assignee_and_member_role_must_respect_project(client):
    admin_headers = _login(client, "admin", os.environ.get("FLOWMIND_ADMIN_PASSWORD", "testadmin"))
    member_id, _ = _register_and_approve(client, admin_headers, "teammate")
    outsider_id, _ = _register_and_approve(client, admin_headers, "outsider")
    project_id, statuses = _create_project(client, admin_headers)
    response = client.post(
        f"/api/projects/{project_id}/members",
        headers=admin_headers,
        json={"user_id": member_id, "role": "member"},
    )
    assert response.status_code == 200

    response = client.put(
        f"/api/projects/{project_id}/members/{member_id}",
        headers=admin_headers,
        json={"role": "viewer"},
    )
    assert response.status_code == 200
    assert response.json()["role"] == "viewer"

    response = client.post(
        f"/api/projects/{project_id}/tasks",
        headers=admin_headers,
        json={
            "title": "错误指派",
            "status_id": statuses[0]["id"],
            "assignee_ids": [outsider_id],
        },
    )
    assert response.status_code == 400


def test_llm_and_knowledge_input_limits():
    assert KnowledgeQuery(question="问题", top_k=20).top_k == 20
    with pytest.raises(ValueError):
        KnowledgeQuery(question="问题", top_k=21)
    with pytest.raises(ValueError):
        LLMChatSessionCreate(project_id=1, title="x" * 129)
    with pytest.raises(ValueError):
        LLMAgentChatRequest(project_id=1, message="")


@pytest.mark.asyncio
async def test_knowledge_creation_survives_embedding_failure(client, monkeypatch):
    """Embedding failure no longer fails the request: the doc is created and
    the background indexing pipeline marks it 'failed' with an error."""
    from app.api import knowledge as knowledge_api
    from app.services.knowledge_indexing import index_document

    admin_headers = _login(client, "admin", os.environ.get("FLOWMIND_ADMIN_PASSWORD", "testadmin"))
    project_id, _ = _create_project(client, admin_headers)

    async def fail_embedding(_text: str):
        raise RuntimeError("embedding provider unavailable")

    # Drive indexing explicitly (the TestClient defers BackgroundTasks and
    # may run them concurrently on separate loops, which is racy on SQLite).
    monkeypatch.setattr(knowledge_api, "index_document", lambda *a, **k: None)
    monkeypatch.setattr(rag_settings, "llm_api_key", "configured")
    monkeypatch.setattr(rag_service, "embed_text", fail_embedding)
    response = client.post(
        f"/api/projects/{project_id}/knowledge",
        headers=admin_headers,
        json={"title": "纯文本回退", "content": "向量不可用时仍应保存"},
    )

    assert response.status_code == 201, response.text
    assert response.json()["status"] == "indexing"

    client.portal.call(index_document, response.json()["id"])
    settled = client.get(
        f"/api/projects/{project_id}/knowledge/{response.json()['id']}",
        headers=admin_headers,
    )
    assert settled.status_code == 200
    assert settled.json()["status"] == "failed"
    assert "embedding provider unavailable" in settled.json()["error_message"]
