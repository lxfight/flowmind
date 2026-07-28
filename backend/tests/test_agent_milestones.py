"""Milestone tools exposed to the project assistant."""

import asyncio
import json
from datetime import UTC, datetime, timedelta

import pytest
from conftest import async_session_factory
from helpers import add_member, admin_login, create_project, create_task, register_and_approve
from sqlalchemy import func, select

from app.models.milestone import Milestone, milestone_tasks
from app.models.task import Task
from app.models.user import User
from app.services.agent_service import (
    create_milestone,
    delete_milestone,
    list_milestones,
    update_milestone,
)


def _future_date(days: int = 30) -> str:
    return (datetime.now(UTC).date() + timedelta(days=days)).isoformat()


async def _user(session, user_id: int | None = None) -> User:
    query = select(User).where(User.id == user_id) if user_id else select(User).where(User.username == "admin")
    result = await session.execute(query)
    user = result.scalars().first()
    assert user is not None
    return user


def _config(session, user, project_id, project_ids=None, project_names=None):
    ids = project_ids or [project_id]
    return {
        "configurable": {
            "db": session,
            "user": user,
            "project_id": project_id,
            "project_ids": ids,
            "project_names": project_names or {pid: f"项目{pid}" for pid in ids},
            "actions": [],
            "pending_question": {},
            "created_keys": {},
            "last_mutations": {},
            "mutation_lock": asyncio.Lock(),
        }
    }


@pytest.mark.asyncio
async def test_create_and_list_multiple_milestones_with_progress(client):
    headers = admin_login(client)
    project_id, statuses = create_project(client, headers, name="助手里程碑")
    task = create_task(client, headers, project_id, statuses[0]["id"], "交付任务")

    session = async_session_factory()
    try:
        config = _config(session, await _user(session), project_id)
        first_raw = await create_milestone.ainvoke(
            {
                "title": "方案冻结",
                "target_date": _future_date(10),
                "task_ids": [task["id"]],
            },
            config=config,
        )
        repeated_raw = await create_milestone.ainvoke(
            {
                "title": "方案冻结",
                "target_date": _future_date(10),
                "task_ids": [task["id"]],
            },
            config=config,
        )
        await create_milestone.ainvoke(
            {"title": "正式发布", "target_date": _future_date(30), "task_ids": [task["id"]]},
            config=config,
        )
        await session.commit()

        assert json.loads(first_raw) == json.loads(repeated_raw)
        count = await session.scalar(
            select(func.count(Milestone.id)).where(Milestone.project_id == project_id)
        )
        assert count == 2
        assert [action["type"] for action in config["configurable"]["actions"]] == [
            "create_milestone",
            "create_milestone",
        ]

        listing = await list_milestones.ainvoke({}, config=config)
        assert "方案冻结" in listing
        assert "正式发布" in listing
        assert "进度=0% [0/1]" in listing
        assert f"任务id={task['id']}" in listing
    finally:
        await session.close()


@pytest.mark.asyncio
async def test_update_milestone_replaces_tasks_and_completes(client):
    headers = admin_login(client)
    project_id, statuses = create_project(client, headers, name="助手更新里程碑")
    first_task = create_task(client, headers, project_id, statuses[0]["id"], "任务一")
    second_task = create_task(client, headers, project_id, statuses[0]["id"], "任务二")

    session = async_session_factory()
    try:
        config = _config(session, await _user(session), project_id)
        created = json.loads(
            await create_milestone.ainvoke(
                {
                    "title": "待更新节点",
                    "target_date": _future_date(),
                    "task_ids": [first_task["id"]],
                },
                config=config,
            )
        )
        milestone_id = created["action"]["milestone_id"]
        updated = json.loads(
            await update_milestone.ainvoke(
                {
                    "milestone_id": milestone_id,
                    "title": "已交付节点",
                    "status": "completed",
                    "task_ids": [second_task["id"]],
                },
                config=config,
            )
        )
        await session.commit()

        assert updated["ok"] is True
        assert updated["action"]["type"] == "update_milestone"
        milestone = await session.get(Milestone, milestone_id)
        assert milestone is not None
        assert milestone.title == "已交付节点"
        assert milestone.status == "completed"
        linked = await session.scalars(
            select(milestone_tasks.c.task_id).where(
                milestone_tasks.c.milestone_id == milestone_id
            )
        )
        assert list(linked) == [second_task["id"]]
    finally:
        await session.close()


@pytest.mark.asyncio
async def test_cross_project_create_asks_and_update_resolves_by_id(client):
    headers = admin_login(client)
    first_id, _ = create_project(client, headers, name="里程碑项目一")
    second_id, _ = create_project(client, headers, name="里程碑项目二")

    session = async_session_factory()
    try:
        user = await _user(session)
        config = _config(
            session,
            user,
            None,
            [first_id, second_id],
            {first_id: "里程碑项目一", second_id: "里程碑项目二"},
        )
        result = await create_milestone.ainvoke(
            {"title": "未指定项目", "target_date": _future_date()}, config=config
        )
        assert "已向用户提问" in result
        assert config["configurable"]["actions"] == []
        assert config["configurable"]["pending_question"].get("question")

        created = json.loads(
            await create_milestone.ainvoke(
                {
                    "title": "指定项目节点",
                    "target_date": _future_date(),
                    "project_id": first_id,
                },
                config=config,
            )
        )
        milestone_id = created["action"]["milestone_id"]
        updated = json.loads(
            await update_milestone.ainvoke(
                {"milestone_id": milestone_id, "description": "跨项目自动定位"},
                config=config,
            )
        )
        assert updated["ok"] is True
        assert (await session.get(Milestone, milestone_id)).project_id == first_id
    finally:
        await session.close()


@pytest.mark.asyncio
async def test_viewer_cannot_create_or_update_milestone(client):
    admin_headers = admin_login(client)
    project_id, _ = create_project(client, admin_headers, name="助手只读里程碑")
    viewer_id, _ = register_and_approve(client, admin_headers, "agent-milestone-viewer")
    add_member(client, admin_headers, project_id, viewer_id, role="viewer")

    session = async_session_factory()
    try:
        config = _config(session, await _user(session, viewer_id), project_id)
        result = json.loads(
            await create_milestone.ainvoke(
                {"title": "无权节点", "target_date": _future_date()}, config=config
            )
        )
        assert result["ok"] is False
        assert "403" in result["message"]
        assert await session.scalar(
            select(func.count(Milestone.id)).where(Milestone.project_id == project_id)
        ) == 0
    finally:
        await session.close()


@pytest.mark.asyncio
async def test_delete_milestone_requires_confirmation_and_keeps_tasks(client):
    headers = admin_login(client)
    project_id, statuses = create_project(client, headers, name="助手删除里程碑")
    task = create_task(client, headers, project_id, statuses[0]["id"], "保留任务")

    session = async_session_factory()
    try:
        config = _config(session, await _user(session), project_id)
        created = json.loads(
            await create_milestone.ainvoke(
                {
                    "title": "待删节点",
                    "target_date": _future_date(),
                    "task_ids": [task["id"]],
                },
                config=config,
            )
        )
        milestone_id = created["action"]["milestone_id"]

        unconfirmed = json.loads(
            await delete_milestone.ainvoke({"milestone_id": milestone_id}, config=config)
        )
        assert unconfirmed["ok"] is False
        assert "confirmed=true" in unconfirmed["message"]
        assert await session.get(Milestone, milestone_id) is not None

        deleted = json.loads(
            await delete_milestone.ainvoke(
                {"milestone_id": milestone_id, "confirmed": True}, config=config
            )
        )
        await session.commit()
        assert deleted["action"]["type"] == "delete_milestone"
        assert await session.get(Milestone, milestone_id) is None
        assert await session.get(Task, task["id"]) is not None
    finally:
        await session.close()
