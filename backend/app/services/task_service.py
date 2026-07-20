from datetime import datetime, timezone
from fastapi import HTTPException
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.permissions import (
    ensure_project_member,
    ensure_project_admin,
    ensure_project_editor,
    ensure_project_assignee,
    ensure_status_in_project,
    ensure_task_in_project,
)
from app.models.activity import ActivityLog
from app.models.project import Project, ProjectMember
from app.models.task import Task, TaskComment, TaskStatus
from app.models.user import User
from app.schemas import (
    TaskCreate,
    TaskUpdate,
    TaskMove,
    TaskOut,
    TaskDetailOut,
    TaskCommentCreate,
    TaskCommentOut,
    TaskStatusCreate,
    TaskStatusUpdate,
    TaskStatusOut,
    ProjectMemberOut,
)


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
) -> list[TaskOut]:
    await ensure_project_member(project_id, user, db)
    if status_id is not None:
        await ensure_status_in_project(project_id, status_id, db)

    query = (
        select(Task)
        .options(
            selectinload(Task.assignee),
            selectinload(Task.subtasks),
            selectinload(Task.comments),
        )
        .where(Task.project_id == project_id, Task.parent_task_id.is_(None))
    )
    if status_id is not None:
        query = query.where(Task.status_id == status_id)
    if assignee_id is not None:
        query = query.where(Task.assignee_id == assignee_id)
    if search:
        query = query.where(
            Task.title.ilike(f"%{search}%") | Task.description.ilike(f"%{search}%")
        )
    query = query.order_by(Task.order, Task.created_at.desc())

    result = await db.execute(query)
    return [_task_out(t) for t in result.scalars().all()]


async def search_tasks(project_id: int, user: User, db: AsyncSession, query_text: str) -> list[TaskOut]:
    return await list_tasks(project_id, user, db, search=query_text)


async def get_task(project_id: int, task_id: int, user: User, db: AsyncSession) -> TaskDetailOut:
    await ensure_project_member(project_id, user, db)
    result = await db.execute(
        select(Task)
        .options(
            selectinload(Task.assignee),
            selectinload(Task.subtasks).selectinload(Task.assignee),
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
    if data.assignee_id is not None:
        await ensure_project_assignee(project_id, data.assignee_id, db)

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
        assignee_id=data.assignee_id,
        priority=data.priority,
        due_date=data.due_date,
        parent_task_id=data.parent_task_id,
        order=max_order + 1.0,
        is_completed=status.is_done,
        completed_at=datetime.now(timezone.utc) if status.is_done else None,
    )
    db.add(task)
    await db.flush()
    await db.refresh(task)
    if task.assignee_id is not None:
        await db.refresh(task, ["assignee"])

    db.add(
        ActivityLog(
            project_id=project_id,
            user_id=user.id,
            action="create",
            target_type="task",
            target_id=task.id,
            summary=f"创建任务: {task.title}",
        )
    )
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
    target_status = None
    if data.status_id is not None:
        target_status = await ensure_status_in_project(project_id, data.status_id, db)
        if task.parent_task_id is not None:
            parent = await ensure_task_in_project(project_id, task.parent_task_id, db)
            if parent.status_id != data.status_id:
                raise HTTPException(status_code=400, detail="子任务状态必须与父任务一致")
    if "assignee_id" in payload and data.assignee_id is not None:
        await ensure_project_assignee(project_id, data.assignee_id, db)

    for field, value in payload.items():
        setattr(task, field, value)

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
        task.completed_at = datetime.now(timezone.utc) if task.is_completed else None

    await db.flush()
    await db.refresh(task)
    if task.assignee_id is not None:
        await db.refresh(task, ["assignee"])

    db.add(
        ActivityLog(
            project_id=project_id,
            user_id=user.id,
            action="update",
            target_type="task",
            target_id=task.id,
            summary=f"更新任务: {task.title}",
        )
    )
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

    task.status_id = data.status_id
    task.order = data.order
    task.is_completed = status.is_done
    task.completed_at = datetime.now(timezone.utc) if status.is_done else None
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

    db.add(
        ActivityLog(
            project_id=project_id,
            user_id=user.id,
            action="move",
            target_type="task",
            target_id=task.id,
            summary=f"移动任务: {task.title}",
        )
    )
    return TaskOut.model_validate(task)


async def delete_task(project_id: int, task_id: int, user: User, db: AsyncSession) -> None:
    await _require_admin(project_id, user, db)
    task = await ensure_task_in_project(project_id, task_id, db)
    db.add(
        ActivityLog(
            project_id=project_id,
            user_id=user.id,
            action="delete",
            target_type="task",
            target_id=task.id,
            summary=f"删除任务: {task.title}",
        )
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
    comment = TaskComment(task_id=task_id, user_id=user.id, content=data.content)
    db.add(comment)
    await db.flush()
    await db.refresh(comment)
    await db.refresh(comment, ["user"])
    db.add(
        ActivityLog(
            project_id=project_id,
            user_id=user.id,
            action="comment",
            target_type="task",
            target_id=task_id,
            summary=f"评论任务: {task.title}",
        )
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
    db.add(
        ActivityLog(
            project_id=project_id,
            user_id=user.id,
            action="create",
            target_type="subtask",
            target_id=subtask.id,
            summary=f"创建子任务: {subtask.title}",
        )
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
    subtask.is_completed = is_completed
    if is_completed:
        subtask.completed_at = datetime.now(timezone.utc)
    else:
        subtask.completed_at = None
    await db.flush()
    await db.refresh(subtask)
    db.add(
        ActivityLog(
            project_id=project_id,
            user_id=user.id,
            action="update",
            target_type="subtask",
            target_id=subtask.id,
            summary=f"更新子任务: {subtask.title}",
        )
    )
    return TaskOut.model_validate(subtask)


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
    db.add(
        ActivityLog(
            project_id=project_id,
            user_id=user.id,
            action="create",
            target_type="status",
            target_id=status.id,
            summary=f"创建状态列: {status.name}",
        )
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
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(status, field, value)
    if data.is_done is not None:
        result = await db.execute(select(Task).where(Task.status_id == status_id))
        for task in result.scalars().all():
            task.is_completed = data.is_done
            task.completed_at = datetime.now(timezone.utc) if data.is_done else None
    await db.flush()
    await db.refresh(status)
    db.add(
        ActivityLog(
            project_id=project_id,
            user_id=user.id,
            action="update",
            target_type="status",
            target_id=status.id,
            summary=f"更新状态列: {status.name}",
        )
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
    db.add(
        ActivityLog(
            project_id=project_id,
            user_id=user.id,
            action="delete",
            target_type="status",
            target_id=status.id,
            summary=f"删除状态列: {status.name}",
        )
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
    task_lines = [f"- [{t.id}] {t.title} (状态id={t.status_id}, 优先级={t.priority}, 完成={t.is_completed})" for t in tasks]

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
