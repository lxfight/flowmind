from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.database import get_db
from app.core.security import get_current_user
from app.api.permissions import ensure_project_admin, ensure_project_member
from app.models.user import User
from app.models.task import TaskStatus
from app.schemas import TaskStatusCreate, TaskStatusUpdate, TaskStatusOut

router = APIRouter(prefix="/api/projects/{project_id}/statuses", tags=["task-statuses"])


@router.get("", response_model=list[TaskStatusOut])
async def list_statuses(
    project_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await ensure_project_member(project_id, current_user, db)
    result = await db.execute(
        select(TaskStatus)
        .where(TaskStatus.project_id == project_id)
        .order_by(TaskStatus.order)
    )
    statuses = result.scalars().all()

    from sqlalchemy import func
    from app.models.task import Task

    output = []
    for s in statuses:
        count_result = await db.execute(
            select(func.count(Task.id)).where(
                Task.status_id == s.id,
                Task.is_completed == False,
            )
        )
        out = TaskStatusOut.model_validate(s)
        out.task_count = count_result.scalar() or 0
        output.append(out)
    return output


@router.post("", response_model=TaskStatusOut, status_code=201)
async def create_status(
    project_id: int,
    data: TaskStatusCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await ensure_project_admin(project_id, current_user, db)
    # Get max order
    result = await db.execute(
        select(TaskStatus).where(TaskStatus.project_id == project_id).order_by(TaskStatus.order.desc()).limit(1)
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
    return TaskStatusOut.model_validate(status)


@router.put("/{status_id}", response_model=TaskStatusOut)
async def update_status(
    project_id: int,
    status_id: int,
    data: TaskStatusUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await ensure_project_admin(project_id, current_user, db)
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

    await db.flush()
    await db.refresh(status)
    return TaskStatusOut.model_validate(status)


@router.delete("/{status_id}")
async def delete_status(
    project_id: int,
    status_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await ensure_project_admin(project_id, current_user, db)
    result = await db.execute(
        select(TaskStatus).where(
            TaskStatus.id == status_id,
            TaskStatus.project_id == project_id,
        )
    )
    status = result.scalar_one_or_none()
    if not status:
        raise HTTPException(status_code=404, detail="状态不存在")

    await db.delete(status)
    return {"message": "状态已删除"}
