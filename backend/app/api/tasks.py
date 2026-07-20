from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from app.core.database import get_db
from app.core.security import get_current_user
from app.api.permissions import (
    ensure_project_admin,
    ensure_project_member,
    ensure_status_in_project,
    ensure_task_in_project,
)
from app.models.user import User
from app.models.task import Task, TaskComment
from app.schemas import (
    TaskCreate, TaskUpdate, TaskOut, TaskDetailOut, TaskMove,
    TaskCommentCreate, TaskCommentOut,
)
from app.services import task_service

router = APIRouter(prefix="/api/projects/{project_id}/tasks", tags=["tasks"])


@router.get("", response_model=list[TaskOut])
async def list_tasks(
    project_id: int,
    status_id: int | None = None,
    assignee_id: int | None = None,
    search: str | None = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    return await task_service.list_tasks(
        project_id, current_user, db,
        status_id=status_id, assignee_id=assignee_id, search=search,
    )


@router.post("", response_model=TaskOut, status_code=201)
async def create_task(
    project_id: int,
    data: TaskCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    return await task_service.create_task(project_id, data, current_user, db)


@router.get("/{task_id}", response_model=TaskDetailOut)
async def get_task(
    project_id: int,
    task_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    return await task_service.get_task(project_id, task_id, current_user, db)


@router.put("/{task_id}", response_model=TaskOut)
async def update_task(
    project_id: int,
    task_id: int,
    data: TaskUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    return await task_service.update_task(project_id, task_id, data, current_user, db)


@router.delete("/{task_id}")
async def delete_task(
    project_id: int,
    task_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await task_service.delete_task(project_id, task_id, current_user, db)
    return {"message": "任务已删除"}


@router.patch("/{task_id}/move", response_model=TaskOut)
async def move_task(
    project_id: int,
    task_id: int,
    data: TaskMove,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    return await task_service.move_task(project_id, task_id, data, current_user, db)


# Task comments
@router.get("/{task_id}/comments", response_model=list[TaskCommentOut])
async def list_comments(
    project_id: int,
    task_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await ensure_project_member(project_id, current_user, db)
    await ensure_task_in_project(project_id, task_id, db)
    result = await db.execute(
        select(TaskComment)
        .options(selectinload(TaskComment.user))
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
    return await task_service.add_comment(project_id, task_id, data, current_user, db)
