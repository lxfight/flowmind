"""get_task_references agent tool coverage."""

import pytest
from conftest import async_session_factory
from helpers import admin_login, create_project, create_task
from sqlalchemy import select

from app.models.user import User
from app.services.agent_service import get_task_references


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
async def test_get_task_references_lists_outgoing_and_incoming(client):
    headers = admin_login(client)
    project_id, statuses = create_project(client, headers, name="引用工具")
    status_id = statuses[0]["id"]
    source = create_task(client, headers, project_id, status_id, "引用方")
    target = create_task(client, headers, project_id, status_id, "被引用方")

    # Establish a reference by putting #target in source's description.
    response = client.put(
        f"/api/projects/{project_id}/tasks/{source['id']}",
        headers=headers,
        json={"description": f"关联到 #{target['id']}"},
    )
    assert response.status_code == 200, response.text

    config, session = await _tool_config(project_id)
    try:
        # From the source: it references the target.
        raw = await get_task_references.ainvoke({"task_id": source["id"]}, config=config)
        assert f"[{target['id']}] 被引用方" in raw
        assert "引用了" in raw

        # From the target: it is referenced by the source.
        raw2 = await get_task_references.ainvoke({"task_id": target["id"]}, config=config)
        assert f"[{source['id']}] 引用方" in raw2
        assert "被引用" in raw2
    finally:
        await session.close()


@pytest.mark.asyncio
async def test_get_task_references_empty(client):
    headers = admin_login(client)
    project_id, statuses = create_project(client, headers, name="无引用")
    status_id = statuses[0]["id"]
    task = create_task(client, headers, project_id, status_id, "孤立任务")
    config, session = await _tool_config(project_id)
    try:
        raw = await get_task_references.ainvoke({"task_id": task["id"]}, config=config)
        assert "引用了：无" in raw
        assert "被引用：无" in raw
    finally:
        await session.close()
