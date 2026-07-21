"""Coverage for Phase 4: in-session undo of agent action batches.

- Agent-driven mutations stamp action_batch_id + pre-change snapshots on
  ActivityLog rows; non-agent mutations keep empty metadata.
- The undo endpoint compensates create / update / move / delete / comment /
  status batches, rejects double-undo and non-owner undo, and reports
  partial skips when entities vanished.
"""
import json

import pytest
from conftest import async_session_factory
from helpers import (
    add_member,
    admin_login,
    create_project,
    create_task,
    register_and_approve,
)
from sqlalchemy import select

from app.models.activity import ActivityLog
from app.models.llm_chat import LLMChatMessage, LLMChatSession
from app.models.task import Task, TaskComment, TaskStatus
from app.models.user import User
from app.schemas import (
    TaskCommentCreate,
    TaskCreate,
    TaskMove,
    TaskUpdate,
)
from app.services import task_service


async def _db_and_admin():
    session = async_session_factory()
    result = await session.execute(select(User).where(User.username == "admin"))
    user = result.scalars().first()
    assert user is not None
    return session, user


async def _latest_activity(session, batch_id: str) -> ActivityLog:
    result = await session.execute(
        select(ActivityLog)
        .where(ActivityLog.action_batch_id == batch_id)
        .order_by(ActivityLog.id.desc())
        .limit(1)
    )
    row = result.scalars().first()
    assert row is not None
    return row


async def _make_undoable_session(project_id: int, user_id: int, batch_id: str) -> int:
    """Persist a chat session whose latest assistant message carries batch_id."""
    session = async_session_factory()
    try:
        chat = LLMChatSession(user_id=user_id, project_id=project_id, title="undo 测试")
        session.add(chat)
        await session.flush()
        session.add(
            LLMChatMessage(
                session_id=chat.id,
                role="user",
                content="做点什么",
                ordinal=1,
            )
        )
        session.add(
            LLMChatMessage(
                session_id=chat.id,
                role="assistant",
                content="已完成。",
                ordinal=2,
                action_batch_id=batch_id,
                actions=[{"type": "update_task"}],
            )
        )
        await session.commit()
        return chat.id
    finally:
        await session.close()


async def _agent_run(batch_id: str, coro):
    """Run a service call as if inside an agent batch."""
    token = task_service.set_agent_batch(batch_id)
    try:
        return await coro
    finally:
        task_service.reset_agent_batch(token)


# ---------------------------------------------------------------------------
# Snapshot capture
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_agent_update_captures_snapshot_and_batch(client):
    headers = admin_login(client)
    project_id, statuses = create_project(client, headers, name="快照项目")
    task = create_task(client, headers, project_id, statuses[0]["id"], "原始标题")

    session, user = await _db_and_admin()
    try:
        await _agent_run(
            "batch-snap",
            task_service.update_task(
                project_id, task["id"], TaskUpdate(title="新标题"), user, session
            ),
        )
        await session.commit()

        row = await _latest_activity(session, "batch-snap")
        meta = json.loads(row.metadata_json)
        assert meta["title"] == "原始标题"
        assert meta["status_id"] == statuses[0]["id"]
        assert row.action_batch_id == "batch-snap"
    finally:
        await session.close()


@pytest.mark.asyncio
async def test_non_agent_mutation_has_empty_metadata(client):
    headers = admin_login(client)
    project_id, statuses = create_project(client, headers, name="普通项目")
    task = create_task(client, headers, project_id, statuses[0]["id"], "普通任务")

    session, _ = await _db_and_admin()
    try:
        result = await session.execute(
            select(ActivityLog)
            .where(ActivityLog.target_id == task["id"])
            .order_by(ActivityLog.id.desc())
        )
        rows = result.scalars().all()
        assert rows, "expected activity rows for API-driven mutations"
        for row in rows:
            assert row.action_batch_id is None
            assert row.metadata_json == "{}"
    finally:
        await session.close()


# ---------------------------------------------------------------------------
# Undo endpoint
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_undo_create_task_deletes_it(client):
    headers = admin_login(client)
    project_id, statuses = create_project(client, headers, name="撤销创建")

    session, user = await _db_and_admin()
    try:
        created = await _agent_run(
            "batch-create",
            task_service.create_task(
                project_id,
                TaskCreate(title="agent 建的", status_id=statuses[0]["id"]),
                user,
                session,
            ),
        )
        await session.commit()
        task_id = created.id
        chat_id = await _make_undoable_session(project_id, user.id, "batch-create")

        resp = client.post(f"/api/llm/sessions/{chat_id}/undo", headers=headers)
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert len(body["undone"]) == 1
        assert body["skipped"] == []

        gone = await session.execute(select(Task).where(Task.id == task_id))
        assert gone.scalar_one_or_none() is None
    finally:
        await session.close()


@pytest.mark.asyncio
async def test_undo_update_restores_old_values(client):
    headers = admin_login(client)
    project_id, statuses = create_project(client, headers, name="撤销更新")
    task = create_task(client, headers, project_id, statuses[0]["id"], "改前标题")

    session, user = await _db_and_admin()
    try:
        await _agent_run(
            "batch-update",
            task_service.update_task(
                project_id,
                task["id"],
                TaskUpdate(title="改后标题", priority=4),
                user,
                session,
            ),
        )
        await session.commit()
        chat_id = await _make_undoable_session(project_id, user.id, "batch-update")

        resp = client.post(f"/api/llm/sessions/{chat_id}/undo", headers=headers)
        assert resp.status_code == 200, resp.text

        session.expire_all()
        restored = await session.get(Task, task["id"])
        assert restored.title == "改前标题"
        assert restored.priority == task["priority"]
    finally:
        await session.close()


@pytest.mark.asyncio
async def test_undo_move_restores_column(client):
    headers = admin_login(client)
    project_id, statuses = create_project(client, headers, name="撤销移动")
    task = create_task(client, headers, project_id, statuses[0]["id"], "要移动")

    session, user = await _db_and_admin()
    try:
        await _agent_run(
            "batch-move",
            task_service.move_task(
                project_id, task["id"], TaskMove(status_id=statuses[1]["id"], order=0), user, session
            ),
        )
        await session.commit()
        chat_id = await _make_undoable_session(project_id, user.id, "batch-move")

        resp = client.post(f"/api/llm/sessions/{chat_id}/undo", headers=headers)
        assert resp.status_code == 200, resp.text

        session.expire_all()
        restored = await session.get(Task, task["id"])
        assert restored.status_id == statuses[0]["id"]
    finally:
        await session.close()


@pytest.mark.asyncio
async def test_undo_delete_status_recreates_column(client):
    headers = admin_login(client)
    project_id, statuses = create_project(client, headers, name="撤销删列")
    # Extra empty column created outside the agent batch
    resp = client.post(
        f"/api/projects/{project_id}/statuses",
        headers=headers,
        json={"name": "临时列", "color": "#123456"},
    )
    assert resp.status_code == 201, resp.text
    status_id = resp.json()["id"]

    session, user = await _db_and_admin()
    try:
        await _agent_run(
            "batch-del-status",
            task_service.delete_status(project_id, status_id, user, session),
        )
        await session.commit()
        assert await session.get(TaskStatus, status_id) is None
        chat_id = await _make_undoable_session(project_id, user.id, "batch-del-status")

        resp = client.post(f"/api/llm/sessions/{chat_id}/undo", headers=headers)
        assert resp.status_code == 200, resp.text

        session.expire_all()
        restored = await session.get(TaskStatus, status_id)
        assert restored is not None
        assert restored.name == "临时列"
        assert restored.color == "#123456"
    finally:
        await session.close()


@pytest.mark.asyncio
async def test_undo_delete_task_recreates_with_original_id(client):
    headers = admin_login(client)
    project_id, statuses = create_project(client, headers, name="撤销删任务")
    task = create_task(client, headers, project_id, statuses[0]["id"], "被删任务")
    client.post(
        f"/api/projects/{project_id}/tasks/{task['id']}/comments",
        headers=headers,
        json={"content": "删掉前的评论"},
    )

    session, user = await _db_and_admin()
    try:
        await _agent_run(
            "batch-del-task",
            task_service.delete_task(project_id, task["id"], user, session),
        )
        await session.commit()
        assert await session.get(Task, task["id"]) is None
        chat_id = await _make_undoable_session(project_id, user.id, "batch-del-task")

        resp = client.post(f"/api/llm/sessions/{chat_id}/undo", headers=headers)
        assert resp.status_code == 200, resp.text

        session.expire_all()
        restored = await session.get(Task, task["id"])
        assert restored is not None
        assert restored.title == "被删任务"
        comments = await session.execute(
            select(TaskComment).where(TaskComment.task_id == task["id"])
        )
        assert [c.content for c in comments.scalars().all()] == ["删掉前的评论"]
    finally:
        await session.close()


@pytest.mark.asyncio
async def test_undo_comment_deletes_it(client):
    headers = admin_login(client)
    project_id, statuses = create_project(client, headers, name="撤销评论")
    task = create_task(client, headers, project_id, statuses[0]["id"], "被评论")

    session, user = await _db_and_admin()
    try:
        comment = await _agent_run(
            "batch-comment",
            task_service.add_comment(
                project_id, task["id"], TaskCommentCreate(content="agent 评论"), user, session
            ),
        )
        await session.commit()
        chat_id = await _make_undoable_session(project_id, user.id, "batch-comment")

        resp = client.post(f"/api/llm/sessions/{chat_id}/undo", headers=headers)
        assert resp.status_code == 200, resp.text

        session.expire_all()
        assert await session.get(TaskComment, comment.id) is None
    finally:
        await session.close()


@pytest.mark.asyncio
async def test_double_undo_rejected(client):
    headers = admin_login(client)
    project_id, statuses = create_project(client, headers, name="重复撤销")

    session, user = await _db_and_admin()
    try:
        await _agent_run(
            "batch-twice",
            task_service.create_task(
                project_id,
                TaskCreate(title="只能撤一次", status_id=statuses[0]["id"]),
                user,
                session,
            ),
        )
        await session.commit()
        chat_id = await _make_undoable_session(project_id, user.id, "batch-twice")

        first = client.post(f"/api/llm/sessions/{chat_id}/undo", headers=headers)
        assert first.status_code == 200, first.text
        second = client.post(f"/api/llm/sessions/{chat_id}/undo", headers=headers)
        assert second.status_code == 404
        assert "没有可撤销" in second.json()["detail"]
    finally:
        await session.close()


@pytest.mark.asyncio
async def test_undo_by_non_owner_rejected(client):
    headers = admin_login(client)
    project_id, statuses = create_project(client, headers, name="他人撤销")
    other_id, other_headers = register_and_approve(client, headers, "undor")
    add_member(client, headers, project_id, other_id, role="member")

    session, user = await _db_and_admin()
    try:
        await _agent_run(
            "batch-owner",
            task_service.create_task(
                project_id,
                TaskCreate(title="owner 的批次", status_id=statuses[0]["id"]),
                user,
                session,
            ),
        )
        await session.commit()
        chat_id = await _make_undoable_session(project_id, user.id, "batch-owner")

        resp = client.post(f"/api/llm/sessions/{chat_id}/undo", headers=other_headers)
        assert resp.status_code == 403
    finally:
        await session.close()


@pytest.mark.asyncio
async def test_undo_partial_skip_when_entity_vanished(client):
    headers = admin_login(client)
    project_id, statuses = create_project(client, headers, name="部分跳过")

    session, user = await _db_and_admin()
    try:
        created = await _agent_run(
            "batch-vanish",
            task_service.create_task(
                project_id,
                TaskCreate(title="会被别人删掉", status_id=statuses[0]["id"]),
                user,
                session,
            ),
        )
        await session.commit()
        chat_id = await _make_undoable_session(project_id, user.id, "batch-vanish")

        # Someone else deletes the created task before the undo
        resp = client.delete(
            f"/api/projects/{project_id}/tasks/{created.id}", headers=headers
        )
        assert resp.status_code == 200, resp.text

        resp = client.post(f"/api/llm/sessions/{chat_id}/undo", headers=headers)
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["undone"] == []
        assert len(body["skipped"]) == 1
        assert "已不存在" in body["skipped"][0]["reason"]

        # Batch is still marked undone (no re-undo loop)
        again = client.post(f"/api/llm/sessions/{chat_id}/undo", headers=headers)
        assert again.status_code == 404
    finally:
        await session.close()
