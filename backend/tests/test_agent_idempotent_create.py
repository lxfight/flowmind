"""Coverage for the per-run idempotency guard on create-type agent tools.

The model occasionally fires two identical create_task / create_status calls in
one turn (same title), which used to insert duplicate rows. Within a single run
the second call must reuse the already-created record instead of inserting
again; a different run (fresh ``created_keys``) is unaffected.
"""
import json

import pytest
from conftest import async_session_factory
from helpers import admin_login, create_project
from sqlalchemy import func, select

from app.models.task import Task, TaskStatus
from app.models.user import User
from app.services.agent_service import create_status, create_task


async def _tool_config(project_id: int):
    session = async_session_factory()
    result = await session.execute(select(User).where(User.username == "admin"))
    user = result.scalars().first()
    assert user is not None
    config = {
        "configurable": {
            "db": session,
            "user": user,
            "project_id": project_id,
            "project_ids": [project_id],
            "project_names": {project_id: "测试"},
            "actions": [],
            "pending_question": {},
            # Seeded per run by _build_agent_run in production.
            "created_keys": set(),
        }
    }
    return config, session


@pytest.mark.asyncio
async def test_create_task_dedupes_repeated_identical_call(client):
    headers = admin_login(client)
    project_id, statuses = create_project(client, headers, name="幂等项目")
    status_id = statuses[0]["id"]
    config, session = await _tool_config(project_id)
    try:
        first = json.loads(
            await create_task.ainvoke(
                {"title": "整理迭代计划", "status_id": status_id}, config=config
            )
        )
        # Same title fired again within the same run (parallel duplicate).
        second = json.loads(
            await create_task.ainvoke(
                {"title": "整理迭代计划", "status_id": status_id}, config=config
            )
        )
        await session.commit()

        assert first["ok"] is True
        assert second["ok"] is True
        assert "未重复创建" in second["message"]

        count = await session.execute(
            select(func.count(Task.id)).where(
                Task.project_id == project_id, Task.title == "整理迭代计划"
            )
        )
        assert count.scalar() == 1
    finally:
        await session.close()


@pytest.mark.asyncio
async def test_create_task_allows_distinct_titles(client):
    headers = admin_login(client)
    project_id, statuses = create_project(client, headers, name="幂等项目")
    status_id = statuses[0]["id"]
    config, session = await _tool_config(project_id)
    try:
        await create_task.ainvoke({"title": "任务甲", "status_id": status_id}, config=config)
        await create_task.ainvoke({"title": "任务乙", "status_id": status_id}, config=config)
        await session.commit()

        count = await session.execute(
            select(func.count(Task.id)).where(Task.project_id == project_id)
        )
        assert count.scalar() == 2
    finally:
        await session.close()


@pytest.mark.asyncio
async def test_create_task_dedupe_scoped_to_single_run(client):
    """A fresh run (new created_keys) may deliberately create the same title."""
    headers = admin_login(client)
    project_id, statuses = create_project(client, headers, name="幂等项目")
    status_id = statuses[0]["id"]

    config1, session1 = await _tool_config(project_id)
    try:
        await create_task.ainvoke({"title": "重复标题", "status_id": status_id}, config=config1)
        await session1.commit()
    finally:
        await session1.close()

    # Second "run": brand-new configurable without the prior created_keys.
    config2, session2 = await _tool_config(project_id)
    try:
        await create_task.ainvoke({"title": "重复标题", "status_id": status_id}, config=config2)
        await session2.commit()

        count = await session2.execute(
            select(func.count(Task.id)).where(
                Task.project_id == project_id, Task.title == "重复标题"
            )
        )
        assert count.scalar() == 2
    finally:
        await session2.close()


@pytest.mark.asyncio
async def test_create_status_dedupes_repeated_identical_call(client):
    headers = admin_login(client)
    project_id, _ = create_project(client, headers, name="幂等项目")
    config, session = await _tool_config(project_id)
    try:
        first = json.loads(await create_status.ainvoke({"name": "待审核"}, config=config))
        second = json.loads(await create_status.ainvoke({"name": "待审核"}, config=config))
        await session.commit()

        assert first["ok"] is True
        assert "未重复创建" in second["message"]

        count = await session.execute(
            select(func.count(TaskStatus.id)).where(
                TaskStatus.project_id == project_id, TaskStatus.name == "待审核"
            )
        )
        assert count.scalar() == 1
    finally:
        await session.close()
