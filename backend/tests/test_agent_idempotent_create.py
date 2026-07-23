"""Coverage for the per-run idempotency guard on mutating agent tools.

The model occasionally fires two identical calls in one turn (same title /
payload), which used to insert duplicate rows. Within a single run the second
call replays the first call's cached result instead of mutating again; a
different run (fresh ``created_keys``) is unaffected.
"""
import asyncio
import json
from types import SimpleNamespace

import pytest
from conftest import async_session_factory
from helpers import admin_login, create_project
from langchain_core.messages import AIMessage
from sqlalchemy import func, select

from app.models.task import Task, TaskStatus
from app.models.user import User
from app.services.agent_service import (
    MAX_TOOL_CALLS_PER_RUN,
    _bounded_tool_call,
    add_subtask,
    add_subtasks,
    create_status,
    create_task,
    create_tasks,
    update_task,
)


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
            "created_keys": {},
            "mutation_lock": asyncio.Lock(),
        }
    }
    return config, session


async def _task_count(session, project_id: int, title: str) -> int:
    result = await session.execute(
        select(func.count(Task.id)).where(Task.project_id == project_id, Task.title == title)
    )
    return result.scalar()


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
        # The repeated call replays the first result verbatim (same task id).
        assert second == first
        assert second["action"]["task_id"] == first["action"]["task_id"]

        assert await _task_count(session, project_id, "整理迭代计划") == 1

        # The action is surfaced to the run's shared actions list exactly once
        # (the replayed second call does not add a duplicate card).
        actions = config["configurable"]["actions"]
        assert actions == [{"type": "create_task", "task_id": first["action"]["task_id"],
                            "title": "整理迭代计划"}]
    finally:
        await session.close()


@pytest.mark.asyncio
async def test_create_task_dedupes_parallel_identical_calls(client):
    """LangGraph executes sibling tool calls concurrently; the guard must be atomic."""
    headers = admin_login(client)
    project_id, statuses = create_project(client, headers, name="并行幂等项目")
    config, session = await _tool_config(project_id)
    try:
        first, second = await asyncio.gather(
            create_task.ainvoke({"title": "并行任务", "status_id": statuses[0]["id"]}, config=config),
            create_task.ainvoke({"title": "并行任务", "status_id": statuses[0]["id"]}, config=config),
        )
        await session.commit()

        assert json.loads(first) == json.loads(second)
        assert await _task_count(session, project_id, "并行任务") == 1
        assert len(config["configurable"]["actions"]) == 1
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

        result = await session.execute(
            select(func.count(Task.id)).where(Task.project_id == project_id)
        )
        assert result.scalar() == 2
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

        assert await _task_count(session2, project_id, "重复标题") == 2
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
        assert second == first

        result = await session.execute(
            select(func.count(TaskStatus.id)).where(
                TaskStatus.project_id == project_id, TaskStatus.name == "待审核"
            )
        )
        assert result.scalar() == 1
    finally:
        await session.close()


@pytest.mark.asyncio
async def test_add_subtask_dedupes_repeated_identical_call(client):
    """The reported bug: a duplicated add_subtask call must not insert twice."""
    headers = admin_login(client)
    project_id, statuses = create_project(client, headers, name="幂等项目")
    status_id = statuses[0]["id"]
    config, session = await _tool_config(project_id)
    try:
        parent = json.loads(
            await create_task.ainvoke({"title": "父任务", "status_id": status_id}, config=config)
        )
        parent_id = parent["action"]["task_id"]

        first = json.loads(
            await add_subtask.ainvoke({"parent_task_id": parent_id, "title": "子任务A"}, config=config)
        )
        # Same subtask fired twice in one run.
        second = json.loads(
            await add_subtask.ainvoke({"parent_task_id": parent_id, "title": "子任务A"}, config=config)
        )
        await session.commit()

        assert first["ok"] is True
        assert second == first

        result = await session.execute(
            select(func.count(Task.id)).where(
                Task.parent_task_id == parent_id, Task.title == "子任务A"
            )
        )
        assert result.scalar() == 1
    finally:
        await session.close()


@pytest.mark.asyncio
async def test_create_tasks_batch_and_idempotent_replay(client):
    """create_tasks creates many tasks in one call and dedupes a repeated batch."""
    headers = admin_login(client)
    project_id, statuses = create_project(client, headers, name="幂等项目")
    status_id = statuses[0]["id"]
    config, session = await _tool_config(project_id)
    try:
        result = json.loads(
            await create_tasks.ainvoke(
                {"status_id": status_id, "titles": ["任务一", "任务二", "任务三"]}, config=config
            )
        )
        await session.commit()
        assert result["ok"] is True
        assert "批量创建 3 个任务" in result["message"]

        # Repeating the same batch in the same run creates nothing new.
        again = json.loads(
            await create_tasks.ainvoke(
                {"status_id": status_id, "titles": ["任务一", "任务二", "任务三"]}, config=config
            )
        )
        await session.commit()
        assert "批量创建" not in again["message"]
        assert "跳过 3 个" in again["message"]

        total = await session.execute(
            select(func.count(Task.id)).where(
                Task.project_id == project_id, Task.parent_task_id.is_(None)
            )
        )
        assert total.scalar() == 3

        # Each created task records its own create_task card (no aggregate card).
        actions = config["configurable"]["actions"]
        assert [a["type"] for a in actions] == ["create_task"] * 3
        assert {a["title"] for a in actions} == {"任务一", "任务二", "任务三"}
    finally:
        await session.close()


@pytest.mark.asyncio
async def test_add_subtasks_batch_and_idempotent_replay(client):
    headers = admin_login(client)
    project_id, statuses = create_project(client, headers, name="幂等项目")
    status_id = statuses[0]["id"]
    config, session = await _tool_config(project_id)
    try:
        parent = json.loads(
            await create_task.ainvoke({"title": "父任务", "status_id": status_id}, config=config)
        )
        parent_id = parent["action"]["task_id"]

        result = json.loads(
            await add_subtasks.ainvoke(
                {"parent_task_id": parent_id, "titles": ["子1", "子2", "子3"]}, config=config
            )
        )
        await session.commit()
        assert result["ok"] is True
        assert "批量添加 3 个子任务" in result["message"]

        again = json.loads(
            await add_subtasks.ainvoke(
                {"parent_task_id": parent_id, "titles": ["子1", "子2", "子3"]}, config=config
            )
        )
        await session.commit()
        assert "批量添加" not in again["message"]
        assert "跳过 3 个" in again["message"]

        total = await session.execute(
            select(func.count(Task.id)).where(Task.parent_task_id == parent_id)
        )
        assert total.scalar() == 3
    finally:
        await session.close()


@pytest.mark.asyncio
async def test_update_task_allows_a_b_a_transition(client):
    """Retry replay must not suppress a legitimate return to an earlier value."""
    headers = admin_login(client)
    project_id, statuses = create_project(client, headers, name="状态回切项目")
    config, session = await _tool_config(project_id)
    try:
        created = json.loads(
            await create_task.ainvoke({"title": "初始", "status_id": statuses[0]["id"]}, config=config)
        )
        task_id = created["action"]["task_id"]
        await update_task.ainvoke({"task_id": task_id, "title": "A"}, config=config)
        await update_task.ainvoke({"task_id": task_id, "title": "B"}, config=config)
        await update_task.ainvoke({"task_id": task_id, "title": "A"}, config=config)
        await session.commit()

        task = await session.get(Task, task_id)
        assert task is not None
        assert task.title == "A"
        update_actions = [a for a in config["configurable"]["actions"] if a["type"] == "update_task"]
        assert len(update_actions) == 3
    finally:
        await session.close()


@pytest.mark.asyncio
async def test_create_tasks_supports_independent_item_fields(client):
    headers = admin_login(client)
    project_id, statuses = create_project(client, headers, name="异构批量项目")
    config, session = await _tool_config(project_id)
    try:
        result = json.loads(
            await create_tasks.ainvoke(
                {
                    "tasks": [
                        {"title": "低优先级", "status_id": statuses[0]["id"], "priority": 1},
                        {"title": "高优先级", "status_id": statuses[0]["id"], "priority": 4},
                    ]
                },
                config=config,
            )
        )
        await session.commit()

        assert result["ok"] is True
        rows = await session.execute(
            select(Task.title, Task.priority).where(Task.project_id == project_id)
        )
        assert dict(rows.all()) == {"低优先级": 1, "高优先级": 4}
    finally:
        await session.close()


@pytest.mark.asyncio
async def test_tool_budget_stops_execution_after_limit():
    executed = 0

    async def execute(_request):
        nonlocal executed
        executed += 1
        return "ok"

    config = {
        "configurable": {
            "tool_budget": {"used": MAX_TOOL_CALLS_PER_RUN, "limit": MAX_TOOL_CALLS_PER_RUN},
            "tool_budget_lock": asyncio.Lock(),
        }
    }
    request = SimpleNamespace(
        runtime=SimpleNamespace(config=config),
        state={"messages": []},
        tool_call={"id": "over", "name": "list_tasks", "args": {}},
    )

    result = await _bounded_tool_call(request, execute)

    assert executed == 0
    assert "工具调用上限" in result.content


@pytest.mark.asyncio
async def test_parallel_single_creates_are_redirected_to_batch_tool():
    executed = 0

    async def execute(_request):
        nonlocal executed
        executed += 1
        return "ok"

    calls = [
        {"id": "one", "name": "create_task", "args": {"title": "一", "status_id": 1}},
        {"id": "two", "name": "create_task", "args": {"title": "二", "status_id": 1}},
    ]
    budget = {"used": 0, "limit": MAX_TOOL_CALLS_PER_RUN}
    request = SimpleNamespace(
        runtime=SimpleNamespace(
            config={"configurable": {"tool_budget": budget, "tool_budget_lock": asyncio.Lock()}}
        ),
        state={"messages": [AIMessage(content="", tool_calls=calls)]},
        tool_call=calls[0],
    )

    result = await _bounded_tool_call(request, execute)

    assert executed == 0
    assert budget["used"] == 0
    assert "create_tasks" in result.content
