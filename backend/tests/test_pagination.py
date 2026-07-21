"""Pagination envelope coverage for tasks and notifications list endpoints."""
import pytest

from sqlalchemy import select

from app.core.notify import create_notification
from app.models.user import User
from conftest import async_session_factory
from helpers import admin_login, create_project, create_task


@pytest.mark.asyncio
async def test_tasks_pagination_envelope_and_totals(client):
    headers = admin_login(client)
    project_id, statuses = create_project(client, headers)
    status_id = statuses[0]["id"]
    for i in range(25):
        create_task(client, headers, project_id, status_id, f"任务{i:02d}")

    response = client.get(
        f"/api/projects/{project_id}/tasks",
        headers=headers,
        params={"page": 1, "page_size": 10},
    )
    assert response.status_code == 200
    body = response.json()
    assert set(body) >= {"items", "total", "page", "page_size"}
    assert len(body["items"]) == 10
    assert body["total"] == 25
    assert body["page"] == 1
    assert body["page_size"] == 10

    response = client.get(
        f"/api/projects/{project_id}/tasks",
        headers=headers,
        params={"page": 3, "page_size": 10},
    )
    body = response.json()
    assert len(body["items"]) == 5
    assert body["total"] == 25

    # Out-of-range page returns empty items but keeps the true total
    response = client.get(
        f"/api/projects/{project_id}/tasks",
        headers=headers,
        params={"page": 99, "page_size": 10},
    )
    assert response.json()["items"] == []
    assert response.json()["total"] == 25


@pytest.mark.asyncio
async def test_tasks_pagination_rejects_invalid_params(client):
    headers = admin_login(client)
    project_id, _ = create_project(client, headers)
    for params in ({"page": 0}, {"page_size": 0}, {"page_size": 101}):
        response = client.get(
            f"/api/projects/{project_id}/tasks", headers=headers, params=params
        )
        assert response.status_code == 422, params


async def _make_notifications(user_id: int, count: int):
    async with async_session_factory() as session:
        for i in range(count):
            await create_notification(
                session, user_id, "comment", f"通知{i}", body=f"内容{i}"
            )
        await session.commit()


@pytest.mark.asyncio
async def test_notifications_pagination_envelope(client):
    headers = admin_login(client)
    async with async_session_factory() as session:
        result = await session.execute(select(User).where(User.username == "admin"))
        admin_id = result.scalar_one().id
    await _make_notifications(user_id=admin_id, count=7)

    response = client.get(
        "/api/notifications", headers=headers, params={"page": 2, "page_size": 3}
    )
    assert response.status_code == 200
    body = response.json()
    assert set(body) >= {"items", "unread_count", "total", "page", "page_size"}
    assert len(body["items"]) == 3
    assert body["total"] == 7
    assert body["unread_count"] == 7
    assert body["page"] == 2
    assert body["page_size"] == 3
