"""Notifications: unread count, mark read, mark all read."""
import pytest
from conftest import async_session_factory
from helpers import admin_login, register_and_approve
from sqlalchemy import select

from app.core.notify import create_notification
from app.models.user import User


async def _user_id(username: str) -> int:
    async with async_session_factory() as session:
        result = await session.execute(select(User).where(User.username == username))
        return result.scalar_one().id


async def _notify(user_id: int, count: int, title_prefix: str = "通知"):
    async with async_session_factory() as session:
        for i in range(count):
            await create_notification(session, user_id, "comment", f"{title_prefix}{i}")
        await session.commit()


@pytest.mark.asyncio
async def test_unread_count_mark_read_and_mark_all(client):
    headers = admin_login(client)
    admin_id = await _user_id("admin")
    await _notify(admin_id, 3)

    response = client.get("/api/notifications/unread-count", headers=headers)
    assert response.status_code == 200
    assert response.json() == {"unread_count": 3}

    # Mark a single notification read
    listing = client.get("/api/notifications", headers=headers).json()
    first_id = listing["items"][0]["id"]
    response = client.post(f"/api/notifications/{first_id}/read", headers=headers)
    assert response.status_code == 200
    assert response.json()["is_read"] is True
    assert client.get("/api/notifications/unread-count", headers=headers).json()["unread_count"] == 2

    # Marking the same one again is idempotent (count unchanged)
    client.post(f"/api/notifications/{first_id}/read", headers=headers)
    assert client.get("/api/notifications/unread-count", headers=headers).json()["unread_count"] == 2

    # Mark all read
    response = client.post("/api/notifications/read-all", headers=headers)
    assert response.status_code == 200
    assert response.json()["updated"] == 2
    assert client.get("/api/notifications/unread-count", headers=headers).json()["unread_count"] == 0
    listing = client.get("/api/notifications", headers=headers).json()
    assert listing["unread_count"] == 0


@pytest.mark.asyncio
async def test_notifications_are_user_scoped(client):
    headers = admin_login(client)
    _, other_headers = register_and_approve(client, headers, "notifuser")
    other_id = await _user_id("notifuser")
    await _notify(other_id, 2, title_prefix="他人通知")

    # Admin sees none of the other user's notifications
    assert client.get("/api/notifications/unread-count", headers=headers).json()["unread_count"] == 0

    # Admin cannot mark the other user's notification read
    listing = client.get("/api/notifications", headers=other_headers).json()
    victim_id = listing["items"][0]["id"]
    response = client.post(f"/api/notifications/{victim_id}/read", headers=headers)
    assert response.status_code == 404

    # The owner can
    response = client.post(f"/api/notifications/{victim_id}/read", headers=other_headers)
    assert response.status_code == 200


@pytest.mark.asyncio
async def test_batch_assignment_titles_are_distinct(client):
    """Assigning several tasks at once must yield one notification per task,
    each heading carrying its own task title (not a run of identical rows)."""
    from helpers import add_member, create_project
    from sqlalchemy import select

    from app.models.notification import Notification

    headers = admin_login(client)
    project_id, statuses = create_project(client, headers, name="指派通知标题")
    uid, _ = register_and_approve(client, headers, "assignee1")
    add_member(client, headers, project_id, uid, role="member")
    status_id = statuses[0]["id"]

    titles = [f"批量任务-{i}" for i in range(3)]
    for t in titles:
        resp = client.post(
            f"/api/projects/{project_id}/tasks",
            headers=headers,
            json={"title": t, "status_id": status_id, "assignee_ids": [uid]},
        )
        assert resp.status_code == 201, resp.text

    async with async_session_factory() as session:
        result = await session.execute(
            select(Notification)
            .where(Notification.user_id == uid, Notification.type == "task_assigned")
            .order_by(Notification.id)
        )
        notifs = result.scalars().all()

    assert len(notifs) == 3
    heads = [n.title for n in notifs]
    # Each notification headline is unique and names its task.
    assert len(set(heads)) == 3
    for t in titles:
        assert any(t in h for h in heads)


@pytest.mark.asyncio
async def test_assignment_title_truncates_long_task_name(client):
    """A very long task title must not overflow the 256-char title column."""
    from helpers import add_member, create_project
    from sqlalchemy import select

    from app.models.notification import Notification

    headers = admin_login(client)
    project_id, statuses = create_project(client, headers, name="长标题指派")
    uid, _ = register_and_approve(client, headers, "assignee2")
    add_member(client, headers, project_id, uid, role="member")
    long_title = "超长任务" * 100  # > 256 chars once embedded
    resp = client.post(
        f"/api/projects/{project_id}/tasks",
        headers=headers,
        json={"title": long_title[:512], "status_id": statuses[0]["id"], "assignee_ids": [uid]},
    )
    assert resp.status_code == 201, resp.text

    async with async_session_factory() as session:
        result = await session.execute(
            select(Notification).where(Notification.user_id == uid, Notification.type == "task_assigned")
        )
        notif = result.scalars().one()
    assert len(notif.title) <= 256
    assert notif.title.endswith("」指派给你")
    # Full task title still available in the body.
    assert notif.body == f"任务：{long_title[:512]}"

