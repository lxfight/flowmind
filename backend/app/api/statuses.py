from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.database import get_db
from app.core.security import get_current_user
from app.models.user import User
from app.schemas import TaskStatusCreate, TaskStatusUpdate, TaskStatusOut
from app.services import task_service

router = APIRouter(prefix="/api/projects/{project_id}/statuses", tags=["task-statuses"])


@router.get("", response_model=list[TaskStatusOut])
async def list_statuses(
    project_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    return await task_service.list_statuses(project_id, current_user, db)


@router.post("", response_model=TaskStatusOut, status_code=201)
async def create_status(
    project_id: int,
    data: TaskStatusCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    return await task_service.create_status(project_id, data, current_user, db)


@router.put("/{status_id}", response_model=TaskStatusOut)
async def update_status(
    project_id: int,
    status_id: int,
    data: TaskStatusUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    return await task_service.update_status(project_id, status_id, data, current_user, db)


@router.delete("/{status_id}")
async def delete_status(
    project_id: int,
    status_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await task_service.delete_status(project_id, status_id, current_user, db)
    return {"message": "状态已删除"}
