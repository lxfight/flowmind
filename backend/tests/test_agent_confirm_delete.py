"""Coverage for the confirm-first contract on the destructive delete_status tool.

- Unconfirmed calls never delete and return instructions for the agent.
- Confirmed calls delete and record the action.
- The system prompt documents the confirmation rule.
"""
import json

import pytest
from sqlalchemy import select

from app.models.task import TaskStatus
from app.models.user import User
from app.services import agent_service
from app.services.agent_service import delete_status
from conftest import async_session_factory
from helpers import admin_login, create_project


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
async def test_delete_status_unconfirmed_does_not_delete(client):
    headers = admin_login(client)
    project_id, statuses = create_project(client, headers, name="确认删除")
    config, session = await _tool_config(project_id)
    try:
        status_id = statuses[0]["id"]
        raw = await delete_status.ainvoke({"status_id": status_id}, config=config)
        payload = json.loads(raw)
        assert payload["ok"] is False
        assert "confirmed=true" in payload["message"]
        assert statuses[0]["name"] in payload["message"]

        # Nothing deleted, no action recorded
        assert await session.get(TaskStatus, status_id) is not None
        assert "action" not in payload
    finally:
        await session.close()


@pytest.mark.asyncio
async def test_delete_status_confirmed_deletes(client):
    headers = admin_login(client)
    project_id, statuses = create_project(client, headers, name="确认删除")
    # Add an empty extra column so the deletion is allowed
    resp = client.post(
        f"/api/projects/{project_id}/statuses",
        headers=headers,
        json={"name": "待删列", "color": "#ff0000"},
    )
    assert resp.status_code == 201, resp.text
    status_id = resp.json()["id"]

    config, session = await _tool_config(project_id)
    try:
        raw = await delete_status.ainvoke(
            {"status_id": status_id, "confirmed": True}, config=config
        )
        payload = json.loads(raw)
        assert payload["ok"] is True
        assert payload["action"]["type"] == "delete_status"
        await session.commit()
        assert await session.get(TaskStatus, status_id) is None
    finally:
        await session.close()


def test_system_prompt_has_destructive_confirm_rule():
    prompt = agent_service._build_system_prompt(
        {"project_name": "P", "project_description": ""}
    )
    assert "破坏性操作确认规则" in prompt
    assert "confirmed=true" in prompt
