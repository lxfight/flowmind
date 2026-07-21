from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.permissions import (
    ensure_project_member,
    ensure_task_in_project,
    get_project_or_404,
)
from app.core.database import get_db
from app.core.realtime import queue_ws_event
from app.core.security import get_current_user
from app.models.project import ProjectMember
from app.models.task import TaskComment
from app.models.user import User
from app.schemas import (
    TaskCommentCreate,
    TaskCommentOut,
    TaskCommentUpdate,
    TaskCreate,
    TaskDetailOut,
    TaskListOut,
    TaskMove,
    TaskOut,
    TaskUpdate,
)
from app.services import task_service

router = APIRouter(prefix="/api/projects/{project_id}/tasks", tags=["tasks"])


@router.get("", response_model=TaskListOut)
async def list_tasks(
    project_id: int,
    status_id: int | None = None,
    assignee_id: int | None = None,
    search: str | None = None,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    return await task_service.list_tasks(
        project_id, current_user, db,
        status_id=status_id, assignee_id=assignee_id, search=search,
        page=page, page_size=page_size,
    )


@router.post("", response_model=TaskOut, status_code=201)
async def create_task(
    project_id: int,
    data: TaskCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    task = await task_service.create_task(project_id, data, current_user, db)
    queue_ws_event(
        db, "task_created", project_id,
        {"task_id": task.id, "status_id": task.status_id},
        actor_id=current_user.id,
    )
    return task


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
    task = await task_service.update_task(project_id, task_id, data, current_user, db)
    queue_ws_event(
        db, "task_updated", project_id,
        {"task_id": task.id, "status_id": task.status_id},
        actor_id=current_user.id,
    )
    return task


@router.delete("/{task_id}")
async def delete_task(
    project_id: int,
    task_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await task_service.delete_task(project_id, task_id, current_user, db)
    queue_ws_event(
        db, "task_deleted", project_id,
        {"task_id": task_id},
        actor_id=current_user.id,
    )
    return {"message": "任务已删除"}


@router.patch("/{task_id}/move", response_model=TaskOut)
async def move_task(
    project_id: int,
    task_id: int,
    data: TaskMove,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    task = await task_service.move_task(project_id, task_id, data, current_user, db)
    queue_ws_event(
        db, "task_moved", project_id,
        {"task_id": task.id, "status_id": task.status_id, "order": task.order},
        actor_id=current_user.id,
    )
    return task


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
    comment = await task_service.add_comment(project_id, task_id, data, current_user, db)
    queue_ws_event(
        db, "comment_created", project_id,
        {"task_id": task_id, "comment_id": comment.id},
        actor_id=current_user.id,
    )
    return comment


async def _ensure_comment_moderator(
    project_id: int,
    comment: TaskComment,
    current_user: User,
    db: AsyncSession,
) -> None:
    """Only the comment author, project owner/admin, or superuser may edit/delete."""
    await ensure_project_member(project_id, current_user, db)
    if comment.user_id == current_user.id or current_user.is_superuser:
        return
    project = await get_project_or_404(project_id, db)
    if project.owner_id == current_user.id:
        return
    result = await db.execute(
        select(ProjectMember).where(
            ProjectMember.project_id == project_id,
            ProjectMember.user_id == current_user.id,
        )
    )
    member = result.scalar_one_or_none()
    if not member or member.role not in ("owner", "admin"):
        raise HTTPException(status_code=403, detail="无权操作此评论")


async def _get_comment_or_404(task_id: int, comment_id: int, db: AsyncSession) -> TaskComment:
    result = await db.execute(
        select(TaskComment)
        .options(selectinload(TaskComment.user))
        .where(TaskComment.id == comment_id, TaskComment.task_id == task_id)
    )
    comment = result.scalar_one_or_none()
    if not comment:
        raise HTTPException(status_code=404, detail="评论不存在")
    return comment


@router.patch("/{task_id}/comments/{comment_id}", response_model=TaskCommentOut)
async def update_comment(
    project_id: int,
    task_id: int,
    comment_id: int,
    data: TaskCommentUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await ensure_task_in_project(project_id, task_id, db)
    comment = await _get_comment_or_404(task_id, comment_id, db)
    await _ensure_comment_moderator(project_id, comment, current_user, db)
    comment.content = data.content
    await db.flush()
    await db.refresh(comment)
    queue_ws_event(
        db, "comment_updated", project_id,
        {"task_id": task_id, "comment_id": comment.id},
        actor_id=current_user.id,
    )
    out = TaskCommentOut.model_validate(comment)
    if comment.user:
        out.user = comment.user
    return out


@router.delete("/{task_id}/comments/{comment_id}")
async def delete_comment(
    project_id: int,
    task_id: int,
    comment_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await ensure_task_in_project(project_id, task_id, db)
    comment = await _get_comment_or_404(task_id, comment_id, db)
    await _ensure_comment_moderator(project_id, comment, current_user, db)
    await db.delete(comment)
    queue_ws_event(
        db, "comment_deleted", project_id,
        {"task_id": task_id, "comment_id": comment_id},
        actor_id=current_user.id,
    )
    return {"message": "评论已删除"}
