import contextvars
import json
from datetime import UTC, datetime

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.permissions import (
    ensure_project_admin,
    ensure_project_assignee,
    ensure_project_editor,
    ensure_project_member,
    ensure_status_in_project,
    ensure_task_in_project,
)
from app.core.notify import create_notification
from app.models.activity import ActivityLog
from app.models.project import Project, ProjectMember
from app.models.task import Task, TaskComment, TaskStatus
from app.models.user import User
from app.schemas import (
    ProjectMemberOut,
    SubtaskUpdate,
    TaskCommentCreate,
    TaskCommentOut,
    TaskCreate,
    TaskDetailOut,
    TaskListOut,
    TaskMove,
    TaskOut,
    TaskStatusCreate,
    TaskStatusOut,
    TaskStatusUpdate,
    TaskUpdate,
)
from app.services.mention_service import notify_mentions

# ---------------------------------------------------------------------------
# Agent action batching (undo support)
# ---------------------------------------------------------------------------
# Agent-driven mutations carry a batch id (one uuid per agent run) so a whole
# run can be undone as a unit. agent_service sets the contextvar around each
# run; plain API calls leave it unset, so their ActivityLog rows keep the
# default empty metadata_json and no batch id.
_agent_batch_id: contextvars.ContextVar[str | None] = contextvars.ContextVar(
    "flowmind_agent_batch_id", default=None
)


def set_agent_batch(batch_id: str) -> contextvars.Token:
    return _agent_batch_id.set(batch_id)


def reset_agent_batch(token: contextvars.Token) -> None:
    _agent_batch_id.reset(token)


def current_agent_batch() -> str | None:
    return _agent_batch_id.get()


def _iso(value: datetime | None) -> str | None:
    return value.isoformat() if value else None


def _log(
    db: AsyncSession,
    *,
    project_id: int,
    user_id: int,
    action: str,
    target_type: str,
    target_id: int,
    summary: str,
    snapshot: dict | None = None,
) -> None:
    """Write an ActivityLog row, stamping the agent batch id and a pre-change
    snapshot (as metadata_json) when running inside an agent batch."""
    batch_id = _agent_batch_id.get()
    db.add(
        ActivityLog(
            project_id=project_id,
            user_id=user_id,
            action=action,
            target_type=target_type,
            target_id=target_id,
            summary=summary,
            metadata_json=json.dumps(snapshot, ensure_ascii=False)
            if (batch_id and snapshot)
            else "{}",
            action_batch_id=batch_id,
        )
    )


async def _subtask_status_map(db: AsyncSession, task_id: int) -> dict[str, int]:
    result = await db.execute(select(Task).where(Task.parent_task_id == task_id))
    return {str(s.id): s.status_id for s in result.scalars().all()}


# ---------------------------------------------------------------------------
# Helper: build TaskOut with counts
# ---------------------------------------------------------------------------
def _task_out(t: Task) -> TaskOut:
    out = TaskOut.model_validate(t)
    out.comment_count = len(getattr(t, "comments", []))
    out.subtask_count = len(getattr(t, "subtasks", []))
    out.subtask_done = sum(1 for s in getattr(t, "subtasks", []) if s.is_completed)
    return out


def _task_detail_out(t: Task) -> TaskDetailOut:
    out = TaskDetailOut.model_validate(t)
    out.comment_count = len(getattr(t, "comments", []))
    out.subtask_count = len(getattr(t, "subtasks", []))
    out.subtask_done = sum(1 for s in getattr(t, "subtasks", []) if s.is_completed)
    return out


async def _require_admin(project_id: int, user: User, db: AsyncSession) -> None:
    await ensure_project_admin(project_id, user, db)


# ---------------------------------------------------------------------------
# Notification helpers
# ---------------------------------------------------------------------------
def _board_link(project_id: int) -> str:
    return f"/project/{project_id}/board"


async def _notify_task_assigned(
    db: AsyncSession,
    project_id: int,
    task: Task,
    assignee_ids: list[int],
    actor: User,
) -> None:
    """Notify newly assigned users (never the actor themselves)."""
    actor_name = actor.display_name or actor.username
    # Include the task title in the heading so several simultaneous assignments
    # read as distinct notifications instead of a run of identical rows. Truncate
    # the embedded title so the 256-char notification title column never overflows.
    short_title = task.title if len(task.title) <= 80 else task.title[:79] + "…"
    for assignee_id in assignee_ids:
        if assignee_id == actor.id:
            continue
        await create_notification(
            db,
            user_id=assignee_id,
            type="task_assigned",
            title=f"{actor_name} 将任务「{short_title}」指派给你",
            body=f"任务：{task.title}",
            link=_board_link(project_id),
        )


async def _get_task_creator_id(task_id: int, db: AsyncSession) -> int | None:
    """Task has no creator column; infer creator from the activity log."""
    result = await db.execute(
        select(ActivityLog.user_id)
        .where(
            ActivityLog.target_type.in_(["task", "subtask"]),
            ActivityLog.target_id == task_id,
            ActivityLog.action == "create",
        )
        .order_by(ActivityLog.id)
        .limit(1)
    )
    return result.scalar_one_or_none()


# ---------------------------------------------------------------------------
# Tasks
# ---------------------------------------------------------------------------
async def list_tasks(
    project_id: int,
    user: User,
    db: AsyncSession,
    *,
    status_id: int | None = None,
    assignee_id: int | None = None,
    search: str | None = None,
    page: int = 1,
    page_size: int = 20,
) -> TaskListOut:
    await ensure_project_member(project_id, user, db)
    if status_id is not None:
        await ensure_status_in_project(project_id, status_id, db)

    filters = [Task.project_id == project_id, Task.parent_task_id.is_(None)]
    if status_id is not None:
        filters.append(Task.status_id == status_id)
    if assignee_id is not None:
        filters.append(Task.assignees.any(User.id == assignee_id))
    if search:
        filters.append(
            Task.title.ilike(f"%{search}%") | Task.description.ilike(f"%{search}%")
        )

    count_result = await db.execute(
        select(func.count(Task.id)).where(*filters)
    )
    total = count_result.scalar() or 0

    query = (
        select(Task)
        .options(
            selectinload(Task.assignees),
            selectinload(Task.subtasks),
            selectinload(Task.comments),
        )
        .where(*filters)
        .order_by(Task.order, Task.created_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    )

    result = await db.execute(query)
    return TaskListOut(
        items=[_task_out(t) for t in result.scalars().all()],
        total=total,
        page=page,
        page_size=page_size,
    )


async def search_tasks(project_id: int, user: User, db: AsyncSession, query_text: str) -> list[TaskOut]:
    result = await list_tasks(project_id, user, db, search=query_text, page=1, page_size=100)
    return result.items


async def get_task(project_id: int, task_id: int, user: User, db: AsyncSession) -> TaskDetailOut:
    await ensure_project_member(project_id, user, db)
    result = await db.execute(
        select(Task)
        .options(
            selectinload(Task.assignees),
            selectinload(Task.subtasks).selectinload(Task.assignees),
            selectinload(Task.comments).selectinload(TaskComment.user),
        )
        .where(Task.id == task_id, Task.project_id == project_id)
    )
    task = result.scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=404, detail="任务不存在")
    return _task_detail_out(task)


async def create_task(
    project_id: int,
    data: TaskCreate,
    user: User,
    db: AsyncSession,
) -> TaskOut:
    await ensure_project_editor(project_id, user, db)
    status = await ensure_status_in_project(project_id, data.status_id, db)
    if data.parent_task_id is not None:
        parent = await ensure_task_in_project(project_id, data.parent_task_id, db)
        if parent.parent_task_id is not None:
            raise HTTPException(status_code=400, detail="子任务不能继续创建下级任务")
        if parent.status_id != data.status_id:
            raise HTTPException(status_code=400, detail="子任务状态必须与父任务一致")
    assignees: list[User] = []
    for assignee_id in dict.fromkeys(data.assignee_ids):
        assignees.append(await ensure_project_assignee(project_id, assignee_id, db))

    result = await db.execute(
        select(func.max(Task.order)).where(
            Task.status_id == data.status_id,
            Task.parent_task_id == data.parent_task_id,
        )
    )
    max_order = result.scalar() or 0

    task = Task(
        project_id=project_id,
        status_id=data.status_id,
        title=data.title,
        description=data.description,
        priority=data.priority,
        due_date=data.due_date,
        parent_task_id=data.parent_task_id,
        order=max_order + 1.0,
        is_completed=status.is_done,
        completed_at=datetime.now(UTC) if status.is_done else None,
    )
    task.assignees = assignees
    db.add(task)
    await db.flush()
    await db.refresh(task)
    await db.refresh(task, ["assignees"])

    _log(
        db,
        project_id=project_id,
        user_id=user.id,
        action="create",
        target_type="task",
        target_id=task.id,
        summary=f"创建任务: {task.title}",
        snapshot={"task_id": task.id},
    )
    if assignees:
        await _notify_task_assigned(db, project_id, task, [u.id for u in assignees], user)
    return TaskOut.model_validate(task)


async def update_task(
    project_id: int,
    task_id: int,
    data: TaskUpdate,
    user: User,
    db: AsyncSession,
) -> TaskOut:
    await ensure_project_editor(project_id, user, db)
    task = await ensure_task_in_project(project_id, task_id, db)
    payload = data.model_dump(exclude_unset=True)
    new_assignees: list[User] | None = None
    target_status = None
    if data.status_id is not None:
        target_status = await ensure_status_in_project(project_id, data.status_id, db)
        if task.parent_task_id is not None:
            parent = await ensure_task_in_project(project_id, task.parent_task_id, db)
            if parent.status_id != data.status_id:
                raise HTTPException(status_code=400, detail="子任务状态必须与父任务一致")
    if "assignee_ids" in payload:
        new_assignees = []
        for assignee_id in dict.fromkeys(payload.pop("assignee_ids") or []):
            new_assignees.append(await ensure_project_assignee(project_id, assignee_id, db))

    await db.refresh(task, ["assignees"])
    old_assignee_ids = {u.id for u in task.assignees}

    snapshot = None
    if current_agent_batch():
        snapshot = {
            "title": task.title,
            "description": task.description,
            "status_id": task.status_id,
            "priority": task.priority,
            "due_date": _iso(task.due_date),
            "is_completed": task.is_completed,
            "completed_at": _iso(task.completed_at),
            "order": task.order,
            "assignee_ids": sorted(old_assignee_ids),
            "subtask_status_ids": await _subtask_status_map(db, task.id),
        }

    if new_assignees is not None:
        task.assignees = new_assignees

    for field, value in payload.items():
        setattr(task, field, value)

    if "due_date" in payload:
        # New/cleared deadline re-arms reminders for the new date.
        task.due_notified_at = None
        task.due_overdue_notified_at = None

    if target_status is not None:
        task.is_completed = target_status.is_done
        if task.parent_task_id is None:
            result = await db.execute(
                select(Task).where(Task.parent_task_id == task.id)
            )
            for subtask in result.scalars().all():
                subtask.status_id = target_status.id
    elif "is_completed" in payload and task.parent_task_id is None:
        result = await db.execute(
            select(TaskStatus)
            .where(
                TaskStatus.project_id == project_id,
                TaskStatus.is_done == bool(data.is_completed),
            )
            .order_by(TaskStatus.order)
            .limit(1)
        )
        matching_status = result.scalar_one_or_none()
        if not matching_status:
            raise HTTPException(status_code=409, detail="项目缺少对应的完成或未完成状态列")
        task.status_id = matching_status.id
        result = await db.execute(select(Task).where(Task.parent_task_id == task.id))
        for subtask in result.scalars().all():
            subtask.status_id = matching_status.id

    if "is_completed" in payload or target_status is not None:
        task.completed_at = datetime.now(UTC) if task.is_completed else None

    await db.flush()
    await db.refresh(task)
    await db.refresh(task, ["assignees"])

    _log(
        db,
        project_id=project_id,
        user_id=user.id,
        action="update",
        target_type="task",
        target_id=task.id,
        summary=f"更新任务: {task.title}",
        snapshot=snapshot,
    )
    if new_assignees is not None:
        added_ids = [u.id for u in task.assignees if u.id not in old_assignee_ids]
        if added_ids:
            await _notify_task_assigned(db, project_id, task, added_ids, user)
    return TaskOut.model_validate(task)


async def move_task(
    project_id: int,
    task_id: int,
    data: TaskMove,
    user: User,
    db: AsyncSession,
) -> TaskOut:
    await ensure_project_editor(project_id, user, db)
    task = await ensure_task_in_project(project_id, task_id, db)
    status = await ensure_status_in_project(project_id, data.status_id, db)
    if task.parent_task_id is not None:
        parent = await ensure_task_in_project(project_id, task.parent_task_id, db)
        if parent.status_id != data.status_id:
            raise HTTPException(status_code=400, detail="子任务状态必须与父任务一致")

    snapshot = None
    if current_agent_batch():
        snapshot = {
            "status_id": task.status_id,
            "order": task.order,
            "is_completed": task.is_completed,
            "completed_at": _iso(task.completed_at),
            "subtask_status_ids": await _subtask_status_map(db, task.id),
        }

    task.status_id = data.status_id
    task.order = data.order
    task.is_completed = status.is_done
    task.completed_at = datetime.now(UTC) if status.is_done else None
    if task.parent_task_id is None:
        result = await db.execute(select(Task).where(Task.parent_task_id == task.id))
        for subtask in result.scalars().all():
            subtask.status_id = status.id

    result = await db.execute(
        select(Task)
        .where(
            Task.status_id == data.status_id,
            Task.project_id == project_id,
            Task.parent_task_id == task.parent_task_id,
        )
        .order_by(Task.order, Task.id)
    )
    all_tasks = result.scalars().all()
    for i, t in enumerate(all_tasks):
        t.order = float(i * 1000)

    await db.flush()
    await db.refresh(task)
    await db.refresh(task, ["assignees"])

    _log(
        db,
        project_id=project_id,
        user_id=user.id,
        action="move",
        target_type="task",
        target_id=task.id,
        summary=f"移动任务: {task.title}",
        snapshot=snapshot,
    )
    return TaskOut.model_validate(task)


async def delete_task(project_id: int, task_id: int, user: User, db: AsyncSession) -> None:
    await _require_admin(project_id, user, db)
    task = await ensure_task_in_project(project_id, task_id, db)

    snapshot = None
    if current_agent_batch():
        await db.refresh(task, ["assignees", "comments"])
        subtasks_result = await db.execute(
            select(Task).options(selectinload(Task.assignees)).where(Task.parent_task_id == task.id)
        )
        subtasks = subtasks_result.scalars().all()
        snapshot = {
            "task": {
                "id": task.id,
                "project_id": task.project_id,
                "status_id": task.status_id,
                "parent_task_id": task.parent_task_id,
                "title": task.title,
                "description": task.description,
                "priority": task.priority,
                "order": task.order,
                "due_date": _iso(task.due_date),
                "is_completed": task.is_completed,
                "completed_at": _iso(task.completed_at),
            },
            "assignee_ids": [u.id for u in task.assignees],
            "subtasks": [
                {
                    "id": s.id,
                    "status_id": s.status_id,
                    "title": s.title,
                    "order": s.order,
                    "is_completed": s.is_completed,
                    "completed_at": _iso(s.completed_at),
                    "assignee_ids": [u.id for u in s.assignees],
                }
                for s in subtasks
            ],
            "comments": [
                {
                    "user_id": c.user_id,
                    "content": c.content,
                    "created_at": _iso(c.created_at),
                }
                for c in task.comments
            ],
        }

    _log(
        db,
        project_id=project_id,
        user_id=user.id,
        action="delete",
        target_type="task",
        target_id=task.id,
        summary=f"删除任务: {task.title}",
        snapshot=snapshot,
    )
    await db.delete(task)


async def add_comment(
    project_id: int,
    task_id: int,
    data: TaskCommentCreate,
    user: User,
    db: AsyncSession,
) -> TaskCommentOut:
    await ensure_project_editor(project_id, user, db)
    task = await ensure_task_in_project(project_id, task_id, db)
    await db.refresh(task, ["assignees"])
    comment = TaskComment(task_id=task_id, user_id=user.id, content=data.content)
    db.add(comment)
    await db.flush()
    await db.refresh(comment)
    await db.refresh(comment, ["user"])
    _log(
        db,
        project_id=project_id,
        user_id=user.id,
        action="comment",
        target_type="task",
        target_id=task_id,
        summary=f"评论任务: {task.title}",
        snapshot={"comment_id": comment.id},
    )

    # --- notifications: mentions take precedence, otherwise notify assignee + creator
    actor_name = user.display_name or user.username
    link = _board_link(project_id)
    excerpt = data.content.strip().replace("\n", " ")[:100]
    # Only resolves mentions to members of this project; actor is skipped.
    mentioned_ids = await notify_mentions(
        db,
        project_id=project_id,
        actor=user,
        text=data.content,
        title=f"{actor_name} 在评论中提到了你",
        body=f"任务「{task.title}」：{excerpt}",
        link=link,
    )

    recipients: set[int] = {u.id for u in task.assignees}
    creator_id = await _get_task_creator_id(task_id, db)
    if creator_id is not None:
        recipients.add(creator_id)
    for recipient_id in recipients - mentioned_ids:
        if recipient_id == user.id:
            continue
        await create_notification(
            db,
            user_id=recipient_id,
            type="comment",
            title=f"{actor_name} 评论了任务「{task.title}」",
            body=excerpt,
            link=link,
        )

    return TaskCommentOut.model_validate(comment)


async def add_subtask(
    project_id: int,
    parent_task_id: int,
    title: str,
    user: User,
    db: AsyncSession,
) -> TaskOut:
    await ensure_project_editor(project_id, user, db)
    parent = await ensure_task_in_project(project_id, parent_task_id, db)
    result = await db.execute(
        select(func.max(Task.order)).where(Task.parent_task_id == parent_task_id)
    )
    max_order = result.scalar() or 0
    subtask = Task(
        project_id=project_id,
        status_id=parent.status_id,
        title=title,
        parent_task_id=parent_task_id,
        priority=0,
        order=max_order + 1.0,
    )
    db.add(subtask)
    await db.flush()
    await db.refresh(subtask)
    await db.refresh(subtask, ["assignees"])
    _log(
        db,
        project_id=project_id,
        user_id=user.id,
        action="create",
        target_type="subtask",
        target_id=subtask.id,
        summary=f"创建子任务: {subtask.title}",
        snapshot={"task_id": subtask.id},
    )
    return TaskOut.model_validate(subtask)


async def update_subtask(
    project_id: int,
    subtask_id: int,
    is_completed: bool,
    user: User,
    db: AsyncSession,
) -> TaskOut:
    await ensure_project_editor(project_id, user, db)
    subtask = await ensure_task_in_project(project_id, subtask_id, db)
    snapshot = None
    if current_agent_batch():
        snapshot = {
            "is_completed": subtask.is_completed,
            "completed_at": _iso(subtask.completed_at),
        }
    subtask.is_completed = is_completed
    if is_completed:
        subtask.completed_at = datetime.now(UTC)
    else:
        subtask.completed_at = None
    await db.flush()
    await db.refresh(subtask)
    await db.refresh(subtask, ["assignees"])
    _log(
        db,
        project_id=project_id,
        user_id=user.id,
        action="update",
        target_type="subtask",
        target_id=subtask.id,
        summary=f"更新子任务: {subtask.title}",
        snapshot=snapshot,
    )
    return TaskOut.model_validate(subtask)


async def edit_subtask(
    project_id: int,
    parent_task_id: int,
    subtask_id: int,
    data: SubtaskUpdate,
    user: User,
    db: AsyncSession,
) -> TaskOut:
    await ensure_project_editor(project_id, user, db)
    parent = await ensure_task_in_project(project_id, parent_task_id, db)
    subtask = await ensure_task_in_project(project_id, subtask_id, db)
    if parent.parent_task_id is not None or subtask.parent_task_id != parent.id:
        raise HTTPException(status_code=404, detail="子任务不存在")

    payload = data.model_dump(exclude_unset=True)
    snapshot = None
    if current_agent_batch():
        snapshot = {
            "title": subtask.title,
            "is_completed": subtask.is_completed,
            "completed_at": _iso(subtask.completed_at),
        }
    if "title" in payload:
        subtask.title = payload["title"]
    if "is_completed" in payload:
        subtask.is_completed = bool(payload["is_completed"])
        subtask.completed_at = datetime.now(UTC) if subtask.is_completed else None

    await db.flush()
    await db.refresh(subtask)
    await db.refresh(subtask, ["assignees"])
    _log(
        db,
        project_id=project_id,
        user_id=user.id,
        action="update",
        target_type="subtask",
        target_id=subtask.id,
        summary=f"更新子任务: {subtask.title}",
        snapshot=snapshot,
    )
    return TaskOut.model_validate(subtask)


async def delete_subtask(
    project_id: int,
    parent_task_id: int,
    subtask_id: int,
    user: User,
    db: AsyncSession,
) -> None:
    await ensure_project_editor(project_id, user, db)
    parent = await ensure_task_in_project(project_id, parent_task_id, db)
    subtask = await ensure_task_in_project(project_id, subtask_id, db)
    if parent.parent_task_id is not None or subtask.parent_task_id != parent.id:
        raise HTTPException(status_code=404, detail="子任务不存在")

    _log(
        db,
        project_id=project_id,
        user_id=user.id,
        action="delete",
        target_type="subtask",
        target_id=subtask.id,
        summary=f"删除子任务: {subtask.title}",
    )
    await db.delete(subtask)


# ---------------------------------------------------------------------------
# Statuses
# ---------------------------------------------------------------------------
async def list_statuses(project_id: int, user: User, db: AsyncSession) -> list[TaskStatusOut]:
    await ensure_project_member(project_id, user, db)
    result = await db.execute(
        select(TaskStatus)
        .where(TaskStatus.project_id == project_id)
        .order_by(TaskStatus.order)
    )
    statuses = result.scalars().all()
    output = []
    for s in statuses:
        count_result = await db.execute(
            select(func.count(Task.id)).where(
                Task.status_id == s.id,
                Task.parent_task_id.is_(None),
            )
        )
        out = TaskStatusOut.model_validate(s)
        out.task_count = count_result.scalar() or 0
        output.append(out)
    return output


async def create_status(
    project_id: int,
    data: TaskStatusCreate,
    user: User,
    db: AsyncSession,
) -> TaskStatusOut:
    await _require_admin(project_id, user, db)
    result = await db.execute(
        select(TaskStatus)
        .where(TaskStatus.project_id == project_id)
        .order_by(TaskStatus.order.desc())
        .limit(1)
    )
    last = result.scalar_one_or_none()
    order = (last.order + 1) if last else 0
    status = TaskStatus(
        project_id=project_id,
        name=data.name,
        color=data.color,
        order=order,
        is_done=data.is_done,
    )
    db.add(status)
    await db.flush()
    await db.refresh(status)
    _log(
        db,
        project_id=project_id,
        user_id=user.id,
        action="create",
        target_type="status",
        target_id=status.id,
        summary=f"创建状态列: {status.name}",
        snapshot={"status_id": status.id},
    )
    return TaskStatusOut.model_validate(status)


async def update_status(
    project_id: int,
    status_id: int,
    data: TaskStatusUpdate,
    user: User,
    db: AsyncSession,
) -> TaskStatusOut:
    await _require_admin(project_id, user, db)
    result = await db.execute(
        select(TaskStatus).where(
            TaskStatus.id == status_id,
            TaskStatus.project_id == project_id,
        )
    )
    status = result.scalar_one_or_none()
    if not status:
        raise HTTPException(status_code=404, detail="状态不存在")
    snapshot = None
    if current_agent_batch():
        snapshot = {
            "name": status.name,
            "color": status.color,
            "is_done": status.is_done,
            "order": status.order,
        }
        if data.is_done is not None and data.is_done != status.is_done:
            # is_done flips cascade to task completion flags — capture for undo
            tasks_result = await db.execute(select(Task).where(Task.status_id == status_id))
            snapshot["task_completions"] = {
                str(t.id): t.is_completed for t in tasks_result.scalars().all()
            }
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(status, field, value)
    if data.is_done is not None:
        result = await db.execute(select(Task).where(Task.status_id == status_id))
        for task in result.scalars().all():
            task.is_completed = data.is_done
            task.completed_at = datetime.now(UTC) if data.is_done else None
    await db.flush()
    await db.refresh(status)
    _log(
        db,
        project_id=project_id,
        user_id=user.id,
        action="update",
        target_type="status",
        target_id=status.id,
        summary=f"更新状态列: {status.name}",
        snapshot=snapshot,
    )
    return TaskStatusOut.model_validate(status)


async def delete_status(project_id: int, status_id: int, user: User, db: AsyncSession) -> None:
    await _require_admin(project_id, user, db)
    result = await db.execute(
        select(TaskStatus).where(
            TaskStatus.id == status_id,
            TaskStatus.project_id == project_id,
        )
    )
    status = result.scalar_one_or_none()
    if not status:
        raise HTTPException(status_code=404, detail="状态不存在")
    task_count_result = await db.execute(
        select(func.count(Task.id)).where(Task.status_id == status_id)
    )
    if (task_count_result.scalar() or 0) > 0:
        raise HTTPException(status_code=409, detail="状态列中仍有任务，请先移动任务后再删除")
    _log(
        db,
        project_id=project_id,
        user_id=user.id,
        action="delete",
        target_type="status",
        target_id=status.id,
        summary=f"删除状态列: {status.name}",
        snapshot={
            "status": {
                "id": status.id,
                "name": status.name,
                "color": status.color,
                "order": status.order,
                "is_done": status.is_done,
            }
        },
    )
    await db.delete(status)


# ---------------------------------------------------------------------------
# Project summary / members (for agent context)
# ---------------------------------------------------------------------------
async def get_project_summary(project_id: int, user: User, db: AsyncSession) -> dict:
    await ensure_project_member(project_id, user, db)
    result = await db.execute(select(Project).where(Project.id == project_id))
    project = result.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail="项目不存在")

    statuses = await list_statuses(project_id, user, db)
    status_lines = [f"- {s.name} (id={s.id}, 顺序={s.order}, 是否完成={s.is_done})" for s in statuses]

    result = await db.execute(
        select(Task)
        .where(Task.project_id == project_id, Task.parent_task_id.is_(None))
        .order_by(Task.updated_at.desc())
        .limit(20)
    )
    tasks = result.scalars().all()
    task_lines = [
        f"- [{t.id}] {t.title} (状态id={t.status_id}, 优先级={t.priority}, 完成={t.is_completed})"
        for t in tasks
    ]

    result = await db.execute(
        select(ProjectMember, User)
        .join(User, ProjectMember.user_id == User.id)
        .where(ProjectMember.project_id == project_id)
    )
    member_lines = [
        f"- {u.username} (id={u.id}, 角色={m.role}, 昵称={u.display_name or u.username})"
        for m, u in result.all()
    ]

    return {
        "project_name": project.name,
        "project_description": project.description,
        "statuses": status_lines,
        "members": member_lines,
        "recent_tasks": task_lines,
    }


async def get_members(project_id: int, user: User, db: AsyncSession) -> list[ProjectMemberOut]:
    await ensure_project_member(project_id, user, db)
    result = await db.execute(
        select(ProjectMember).where(ProjectMember.project_id == project_id)
    )
    members = result.scalars().all()
    output = []
    for m in members:
        await db.refresh(m, ["user"])
        out = ProjectMemberOut.model_validate(m)
        if m.user:
            out.username = m.user.username
            out.display_name = m.user.display_name
            out.avatar_url = m.user.avatar_url
        output.append(out)
    return output
