"""Due reminder scan + timezone formatting coverage."""
from datetime import UTC, datetime, timedelta

import pytest
from helpers import admin_login, create_project, create_task

from app.services.due_reminder import _format_due_local, scan_due_tasks


@pytest.mark.asyncio
async def test_due_reminder_notifies_overdue_and_soon(client, monkeypatch):
    from tests.conftest import async_session_factory

    notified: list[dict] = []

    async def fake_create_notification(db, user_id, type, title, body, link):
        notified.append({"user_id": user_id, "type": type, "title": title, "body": body})

    monkeypatch.setattr("app.services.due_reminder.create_notification", fake_create_notification)

    headers = admin_login(client)
    project_id, statuses = create_project(client, headers, name="逾期提醒")
    status_id = statuses[0]["id"]

    # admin is the creator/owner; give them an assignee via the task.
    task = create_task(client, headers, project_id, status_id, "逾期测试任务")
    now = datetime.now(UTC)

    async with async_session_factory() as session:
        from sqlalchemy import select
        from sqlalchemy.orm import selectinload

        from app.models.task import Task
        from app.models.user import User

        row = (await session.execute(
            select(Task).options(selectinload(Task.assignees)).where(Task.id == task["id"])
        )).scalar_one()
        admin_user = (await session.execute(select(User).where(User.username == "admin"))).scalar_one()
        row.assignees = [admin_user]
        row.due_date = now - timedelta(hours=2)  # overdue
        await session.commit()

        counters = await scan_due_tasks(session, now=now)
        await session.commit()

    assert counters["due_overdue"] == 1
    assert any(n["type"] == "due_overdue" for n in notified)

    # Second scan: already notified, no duplicates.
    notified.clear()
    async with async_session_factory() as session:
        counters = await scan_due_tasks(session, now=now + timedelta(hours=1))
        await session.commit()
    assert counters["due_overdue"] == 0


@pytest.mark.asyncio
async def test_due_reminder_soon_window_uses_local_timezone_copy(monkeypatch):
    """The due-soon copy shows the configured local timezone, not UTC."""
    due = datetime(2026, 8, 12, 15, 59, 59, tzinfo=UTC)
    monkeypatch.setattr("app.services.due_reminder.get_settings", lambda: type(
        "S", (), {"app_timezone": "Asia/Shanghai"}
    )())
    assert _format_due_local(due) == "2026-08-12 23:59"

    # Unknown tz falls back to the raw UTC value.
    monkeypatch.setattr("app.services.due_reminder.get_settings", lambda: type(
        "S", (), {"app_timezone": "Not/AZone"}
    )())
    assert _format_due_local(due) == "2026-08-12 15:59"


@pytest.mark.asyncio
async def test_due_reminder_skips_completed_tasks(client, monkeypatch):
    from tests.conftest import async_session_factory

    notified: list[dict] = []

    async def fake_create_notification(db, user_id, type, title, body, link):
        notified.append({"user_id": user_id, "type": type})

    monkeypatch.setattr("app.services.due_reminder.create_notification", fake_create_notification)

    headers = admin_login(client)
    project_id, statuses = create_project(client, headers, name="跳过完成")
    status_id = statuses[0]["id"]
    task = create_task(client, headers, project_id, status_id, "已完成的任务")
    now = datetime.now(UTC)

    async with async_session_factory() as session:
        from sqlalchemy import select
        from sqlalchemy.orm import selectinload

        from app.models.task import Task
        from app.models.user import User

        row = (await session.execute(
            select(Task).options(selectinload(Task.assignees)).where(Task.id == task["id"])
        )).scalar_one()
        admin_user = (await session.execute(select(User).where(User.username == "admin"))).scalar_one()
        row.assignees = [admin_user]
        row.due_date = now - timedelta(days=3)
        row.is_completed = True
        await session.commit()

        counters = await scan_due_tasks(session, now=now)
        await session.commit()

    assert counters == {"due_soon": 0, "due_overdue": 0}
    assert notified == []
