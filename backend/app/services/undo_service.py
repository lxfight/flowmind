"""Undo (compensation) for agent action batches.

Each agent run writes ActivityLog rows stamped with an action_batch_id and a
pre-change snapshot in metadata_json. undo_batch walks those rows in reverse
order and compensates each mutation:

- created entities (task / subtask / status) are deleted again
- updated / moved entities get their snapshotted old values restored
- deleted entities are recreated with their original id when still free

Undo runs inside the requesting user's own session; entries whose target
entity has since vanished (or been recreated) are skipped and reported, so
the caller gets {undone: [...], skipped: [...]}. All compensations queue the
same WS events as the regular endpoints, so connected boards refresh live.

Known limitations:
- Attachments of a deleted task are not restored (files are gone).
- Recreated comments get new ids.
- Undo itself is not redoable and does not create a new batch.
"""
import json
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.realtime import queue_ws_event
from app.models.activity import ActivityLog
from app.models.llm_chat import LLMChatMessage
from app.models.task import Task, TaskComment, TaskStatus
from app.models.user import User


def _parse_dt(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value)
    except ValueError:
        return None


async def _get_task(db: AsyncSession, task_id: int) -> Task | None:
    result = await db.execute(select(Task).where(Task.id == task_id))
    return result.scalar_one_or_none()


async def _restore_assignees(db: AsyncSession, task: Task, ids: list[int]) -> None:
    await db.refresh(task, ["assignees"])
    if not ids:
        task.assignees = []
        return
    result = await db.execute(select(User).where(User.id.in_(ids)))
    task.assignees = list(result.scalars().all())


async def _restore_subtask_statuses(db: AsyncSession, mapping: dict) -> None:
    for sub_id, status_id in (mapping or {}).items():
        sub = await _get_task(db, int(sub_id))
        if sub is not None:
            sub.status_id = status_id


async def _compensate(
    db: AsyncSession,
    log: ActivityLog,
    snapshot: dict,
    actor: User,
) -> str | None:
    """Apply the compensation for one activity row.

    Returns None on success, or a skip reason (entity gone / conflict).
    """
    action = log.action
    target_type = log.target_type

    if action == "create" and target_type in ("task", "subtask"):
        task = await _get_task(db, log.target_id)
        if task is None:
            return "任务已不存在"
        await db.delete(task)
        queue_ws_event(db, "task_deleted", log.project_id, {"task_id": log.target_id}, actor_id=actor.id)
        return None

    if action == "create" and target_type == "status":
        status = await db.get(TaskStatus, log.target_id)
        if status is None:
            return "状态列已不存在"
        count = await db.execute(select(Task.id).where(Task.status_id == status.id).limit(1))
        if count.first() is not None:
            return "状态列中已有任务，无法删除"
        await db.delete(status)
        queue_ws_event(db, "status_deleted", log.project_id, {"status_id": log.target_id}, actor_id=actor.id)
        return None

    if action in ("update", "move") and target_type == "task":
        task = await _get_task(db, log.target_id)
        if task is None:
            return "任务已被删除，无法恢复"
        for field in ("title", "description", "status_id", "priority", "order", "is_completed"):
            if field in snapshot:
                setattr(task, field, snapshot[field])
        if "due_date" in snapshot:
            task.due_date = _parse_dt(snapshot["due_date"])
        if "completed_at" in snapshot:
            task.completed_at = _parse_dt(snapshot["completed_at"])
        if "assignee_ids" in snapshot:
            await db.refresh(task, ["assignees"])
            await _restore_assignees(db, task, snapshot["assignee_ids"])
        await _restore_subtask_statuses(db, snapshot.get("subtask_status_ids"))
        await db.flush()
        event = "task_moved" if action == "move" else "task_updated"
        queue_ws_event(
            db, event, log.project_id,
            {"task_id": task.id, "status_id": task.status_id, "order": task.order},
            actor_id=actor.id,
        )
        return None

    if action == "update" and target_type == "subtask":
        sub = await _get_task(db, log.target_id)
        if sub is None:
            return "子任务已被删除，无法恢复"
        if "is_completed" in snapshot:
            sub.is_completed = snapshot["is_completed"]
        if "completed_at" in snapshot:
            sub.completed_at = _parse_dt(snapshot["completed_at"])
        await db.flush()
        queue_ws_event(
            db, "task_updated", log.project_id, {"task_id": sub.id, "status_id": sub.status_id}, actor_id=actor.id
        )
        return None

    if action == "delete" and target_type == "task":
        data = snapshot.get("task")
        if not data:
            return "缺少删除前的快照"
        if await _get_task(db, data["id"]) is not None:
            return "相同 ID 的任务已存在，跳过恢复"
        task = Task(
            id=data["id"],
            project_id=data["project_id"],
            status_id=data["status_id"],
            parent_task_id=data.get("parent_task_id"),
            title=data["title"],
            description=data.get("description") or "",
            priority=data.get("priority", 0),
            order=data.get("order", 0.0),
            due_date=_parse_dt(data.get("due_date")),
            is_completed=data.get("is_completed", False),
            completed_at=_parse_dt(data.get("completed_at")),
        )
        db.add(task)
        await db.flush()
        await _restore_assignees(db, task, snapshot.get("assignee_ids") or [])
        for s in snapshot.get("subtasks") or []:
            if await _get_task(db, s["id"]) is not None:
                continue
            sub = Task(
                id=s["id"],
                project_id=task.project_id,
                status_id=s["status_id"],
                parent_task_id=task.id,
                title=s["title"],
                priority=0,
                order=s.get("order", 0.0),
                is_completed=s.get("is_completed", False),
                completed_at=_parse_dt(s.get("completed_at")),
            )
            db.add(sub)
            await db.flush()
            await _restore_assignees(db, sub, s.get("assignee_ids") or [])
        for c in snapshot.get("comments") or []:
            db.add(
                TaskComment(
                    task_id=task.id,
                    user_id=c["user_id"],
                    content=c["content"],
                    created_at=_parse_dt(c.get("created_at")) or datetime.now(UTC),
                )
            )
        await db.flush()
        queue_ws_event(
            db, "task_created", log.project_id, {"task_id": task.id, "status_id": task.status_id}, actor_id=actor.id
        )
        return None

    if action == "comment" and target_type == "task":
        comment_id = snapshot.get("comment_id")
        comment = await db.get(TaskComment, comment_id) if comment_id else None
        if comment is None:
            return "评论已不存在"
        await db.delete(comment)
        queue_ws_event(
            db, "comment_deleted", log.project_id,
            {"task_id": log.target_id, "comment_id": comment_id},
            actor_id=actor.id,
        )
        return None

    if action == "update" and target_type == "status":
        status = await db.get(TaskStatus, log.target_id)
        if status is None:
            return "状态列已被删除，无法恢复"
        for field in ("name", "color", "is_done", "order"):
            if field in snapshot:
                setattr(status, field, snapshot[field])
        for task_id, is_completed in (snapshot.get("task_completions") or {}).items():
            t = await _get_task(db, int(task_id))
            if t is not None:
                t.is_completed = is_completed
        await db.flush()
        queue_ws_event(db, "status_updated", log.project_id, {"status_id": status.id}, actor_id=actor.id)
        return None

    if action == "delete" and target_type == "status":
        data = snapshot.get("status")
        if not data:
            return "缺少删除前的快照"
        if await db.get(TaskStatus, data["id"]) is not None:
            return "相同 ID 的状态列已存在，跳过恢复"
        db.add(
            TaskStatus(
                id=data["id"],
                project_id=log.project_id,
                name=data["name"],
                color=data.get("color", "#6b7280"),
                order=data.get("order", 0),
                is_done=data.get("is_done", False),
            )
        )
        await db.flush()
        queue_ws_event(db, "status_created", log.project_id, {"status_id": data["id"]}, actor_id=actor.id)
        return None

    return "不支持撤销的操作类型"


async def undo_batch(
    db: AsyncSession,
    message: LLMChatMessage,
    actor: User,
) -> dict:
    """Compensate every activity row of the message's action batch.

    Marks the message undone_at and returns {undone: [...], skipped: [...]}.
    """
    result = await db.execute(
        select(ActivityLog)
        .where(ActivityLog.action_batch_id == message.action_batch_id)
        .order_by(ActivityLog.id.desc())
    )
    logs = result.scalars().all()

    undone: list[str] = []
    skipped: list[dict] = []
    for log in logs:
        try:
            snapshot = json.loads(log.metadata_json or "{}")
        except json.JSONDecodeError:
            snapshot = {}
        reason = await _compensate(db, log, snapshot, actor)
        if reason is None:
            undone.append(log.summary)
        else:
            skipped.append({"summary": log.summary, "reason": reason})

    message.undone_at = datetime.now(UTC)
    db.add(
        ActivityLog(
            project_id=logs[0].project_id,
            user_id=actor.id,
            action="undo",
            target_type="agent_batch",
            target_id=message.id,
            summary=f"撤销本轮操作（{len(undone)} 项）",
        )
    )
    await db.flush()
    return {
        "batch_id": message.action_batch_id,
        "message_id": message.id,
        "undone": undone,
        "skipped": skipped,
        "undone_at": message.undone_at.isoformat(),
    }
