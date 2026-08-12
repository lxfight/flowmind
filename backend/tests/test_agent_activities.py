"""list_activities tool coverage."""
from datetime import UTC, datetime

import pytest
from conftest import async_session_factory
from helpers import admin_login, create_project
from sqlalchemy import select

from app.models.activity import ActivityLog
from app.models.user import User
from app.services.agent_service import list_activities


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
            "actions": [],
            "pending_question": {},
        }
    }
    return config, session


@pytest.mark.asyncio
async def test_list_activities_returns_recent_logs(client):
    headers = admin_login(client)
    project_id, _ = create_project(client, headers, name="动态工具")
    config, session = await _tool_config(project_id)
    try:
        # Insert a couple of activity rows directly.
        async with async_session_factory() as s:
            user = (await s.execute(select(User).where(User.username == "admin"))).scalar_one()
            s.add(ActivityLog(
                project_id=project_id, user_id=user.id, action="create",
                target_type="task", target_id=1, summary="创建任务: 测试",
                created_at=datetime.now(UTC),
            ))
            s.add(ActivityLog(
                project_id=project_id, user_id=user.id, action="update",
                target_type="task", target_id=2, summary="更新任务: 改标题",
                created_at=datetime.now(UTC),
            ))
            await s.commit()

        raw = await list_activities.ainvoke({"limit": 10}, config=config)
        assert "创建任务: 测试" in raw
        assert "更新任务: 改标题" in raw
    finally:
        await session.close()


@pytest.mark.asyncio
async def test_list_activities_returns_project_logs(client):
    headers = admin_login(client)
    project_id, _ = create_project(client, headers, name="项目动态")
    config, session = await _tool_config(project_id)
    try:
        raw = await list_activities.ainvoke({}, config=config)
        # Project creation writes an activity row; the tool surfaces it.
        assert "创建项目" in raw
    finally:
        await session.close()


@pytest.mark.asyncio
async def test_list_activities_rejects_out_of_scope_project(client):
    headers = admin_login(client)
    project_id, _ = create_project(client, headers, name="越权动态")
    config, session = await _tool_config(project_id)
    try:
        raw = await list_activities.ainvoke({"project_id": 99999}, config=config)
        assert "不在你可访问" in raw
    finally:
        await session.close()
