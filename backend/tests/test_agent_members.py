"""add_member / remove_member agent tool coverage."""
import json

import pytest
from conftest import async_session_factory
from helpers import admin_login, create_project, register_and_approve
from sqlalchemy import select

from app.models.project import ProjectMember
from app.models.user import User
from app.services.agent_service import add_member, remove_member


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
async def test_add_member_creates_membership(client):
    headers = admin_login(client)
    member_id, _ = register_and_approve(client, headers, "agentmember1")
    project_id, _ = create_project(client, headers, name="加成员")
    config, session = await _tool_config(project_id)
    try:
        raw = await add_member.ainvoke({"user_id": member_id, "role": "member"}, config=config)
        payload = json.loads(raw)
        assert payload["ok"] is True
        assert payload["action"]["type"] == "add_member"
        await session.commit()

        row = (await session.execute(
            select(ProjectMember).where(ProjectMember.project_id == project_id, ProjectMember.user_id == member_id)
        )).scalar_one_or_none()
        assert row is not None
        assert row.role == "member"
    finally:
        await session.close()


@pytest.mark.asyncio
async def test_add_member_duplicate_rejected(client):
    headers = admin_login(client)
    member_id, _ = register_and_approve(client, headers, "agentmember2")
    project_id, _ = create_project(client, headers, name="重复加成员")
    config, session = await _tool_config(project_id)
    try:
        await add_member.ainvoke({"user_id": member_id, "role": "member"}, config=config)
        raw = await add_member.ainvoke({"user_id": member_id, "role": "member"}, config=config)
        payload = json.loads(raw)
        assert payload["ok"] is False
        assert "已是项目成员" in payload["message"]
    finally:
        await session.close()


@pytest.mark.asyncio
async def test_remove_member_requires_confirmation_then_removes(client):
    headers = admin_login(client)
    member_id, _ = register_and_approve(client, headers, "agentmember3")
    project_id, _ = create_project(client, headers, name="移除成员")
    # Add the member via the API.
    client.post(
        f"/api/projects/{project_id}/members",
        headers=headers,
        json={"user_id": member_id, "role": "member"},
    )
    config, session = await _tool_config(project_id)
    try:
        # Unconfirmed → no removal, returns instructions.
        raw = await remove_member.ainvoke({"user_id": member_id}, config=config)
        payload = json.loads(raw)
        assert payload["ok"] is False
        assert "confirmed=true" in payload["message"]

        raw = await remove_member.ainvoke({"user_id": member_id, "confirmed": True}, config=config)
        payload = json.loads(raw)
        assert payload["ok"] is True
        assert payload["action"]["type"] == "remove_member"
        await session.commit()

        row = (await session.execute(
            select(ProjectMember).where(ProjectMember.project_id == project_id, ProjectMember.user_id == member_id)
        )).scalar_one_or_none()
        assert row is None
    finally:
        await session.close()
