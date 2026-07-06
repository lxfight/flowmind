from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, delete, func
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.database import get_db
from app.core.security import get_current_user
from app.models.user import User
from app.models.task import Task, TaskComment
from app.schemas import (
    TaskCreate, TaskUpdate, TaskOut, TaskDetailOut, TaskMove,
    TaskCommentCreate, TaskCommentOut,
)

router = APIRouter(prefix="/api/projects/{project_id}/tasks", tags=["tasks"])


@router.get("", response_model=list[TaskOut])
async def list_tasks(
    project_id: int,
    status_id: int | None = None,
    assignee_id: int | None = None,
    db: AsyncSession = Depends(get_db),
):
    query = select(Task).where(Task.project_id == project_id)
    if status_id is not None:
        query = query.where(Task.status_id == status_id)
    if assignee_id is not None:
        query = query.where(Task.assignee_id == assignee_id)
    query = query.order_by(Task.order, Task.created_at.desc())

    result = await db.execute(query)
    tasks = result.scalars().all()

    output = []
    for t in tasks:
        out = TaskOut.model_validate(t)
        if t.assignee:
            out.assignee = t.assignee
        output.append(out)
    return output


@router.post("", response_model=TaskOut, status_code=201)
async def create_task(
    project_id: int,
    data: TaskCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    # Get max order in the target status
    result = await db.execute(
        select(func.max(Task.order))
        .where(Task.status_id == data.status_id)
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
    )
    db.add(task)
    await db.flush()
    await db.refresh(task)

    # Log activity
    from app.models.activity import ActivityLog
    log = ActivityLog(
        project_id=project_id,
        user_id=current_user.id,
        action="create",
        target_type="task",
        target_id=task.id,
        summary=f"创建任务: {task.title}",
    )
    db.add(log)

    return TaskOut.model_validate(task)


@router.get("/{task_id}", response_model=TaskDetailOut)
async def get_task(
    project_id: int,
    task_id: int,
    db: AsyncSession = Depends(get_db),
):
    from sqlalchemy.orm import selectinload

    result = await db.execute(
        select(Task)
        .options(selectinload(Task.assignee), selectinload(Task.subtasks), selectinload(Task.comments))
        .where(Task.id == task_id, Task.project_id == project_id)
    )
    task = result.scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=404, detail="任务不存在")

    return TaskDetailOut.model_validate(task)


@router.put("/{task_id}", response_model=TaskOut)
async def update_task(
    project_id: int,
    task_id: int,
    data: TaskUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Task).where(Task.id == task_id, Task.project_id == project_id)
    )
    task = result.scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=404, detail="任务不存在")

    is_completing = data.is_completed is True and not task.is_completed
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(task, field, value)

    if is_completing:
        task.completed_at = datetime.now(timezone.utc)

    await db.flush()
    await db.refresh(task)

    # Log activity
    from app.models.activity import ActivityLog
    log = ActivityLog(
        project_id=project_id,
        user_id=current_user.id,
        action="update",
        target_type="task",
        target_id=task.id,
        summary=f"更新任务: {task.title}",
    )
    db.add(log)

    return TaskOut.model_validate(task)


@router.delete("/{task_id}")
async def delete_task(
    project_id: int,
    task_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Task).where(Task.id == task_id, Task.project_id == project_id)
    )
    task = result.scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=404, detail="任务不存在")

    await db.delete(task)
    return {"message": "任务已删除"}


@router.patch("/{task_id}/move", response_model=TaskOut)
async def move_task(
    project_id: int,
    task_id: int,
    data: TaskMove,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Task).where(Task.id == task_id, Task.project_id == project_id)
    )
    task = result.scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=404, detail="任务不存在")

    task.status_id = data.status_id
    task.order = data.order
    await db.flush()
    await db.refresh(task)

    # Log activity
    from app.models.activity import ActivityLog
    log = ActivityLog(
        project_id=project_id,
        user_id=current_user.id,
        action="move",
        target_type="task",
        target_id=task.id,
        summary=f"移动任务: {task.title}",
    )
    db.add(log)

    return TaskOut.model_validate(task)


# Task comments
@router.get("/{task_id}/comments", response_model=list[TaskCommentOut])
async def list_comments(project_id: int, task_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(TaskComment)
        .where(TaskComment.task_id == task_id)
        .order_by(TaskComment.created_at)
    )
    comments = result.scalars().all()
    output = []
    for c in comments:
        out = TaskCommentOut.model_validate(c)
        if c.user:
            out.user = c.user
        output.append(out)
    return output


@router.post("/{task_id}/comments", response_model=TaskCommentOut, status_code=201)
async def create_comment(
    project_id: int,
    task_id: int,
    data: TaskCommentCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    comment = TaskComment(
        task_id=task_id,
        user_id=current_user.id,
        content=data.content,
    )
    db.add(comment)
    await db.flush()
    await db.refresh(comment)
    return TaskCommentOut.model_validate(comment)
