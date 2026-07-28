from datetime import date
from typing import Literal

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.realtime import queue_ws_event
from app.core.security import get_current_user
from app.models.user import User
from app.schemas import (
    MilestoneCreate,
    MilestoneOut,
    MilestoneTimelinePage,
    MilestoneUpdate,
)
from app.services import milestone_service

router = APIRouter(
    prefix="/api/projects/{project_id}/milestones",
    tags=["milestones"],
)


@router.get("", response_model=list[MilestoneOut])
async def list_milestones(
    project_id: int,
    status: str | None = Query(default=None, pattern="^(open|completed|cancelled)$"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    return await milestone_service.list_milestones(
        project_id, current_user, db, status=status
    )


@router.post("", response_model=MilestoneOut, status_code=201)
async def create_milestone(
    project_id: int,
    data: MilestoneCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    milestone = await milestone_service.create_milestone(
        project_id, data, current_user, db
    )
    queue_ws_event(
        db,
        "milestone_created",
        project_id,
        {"milestone_id": milestone.id},
        actor_id=current_user.id,
    )
    return milestone


@router.get("/timeline", response_model=MilestoneTimelinePage)
async def list_milestone_timeline(
    project_id: int,
    anchor_date: date = Query(),
    direction: Literal["forward", "backward"] = Query(default="forward"),
    limit: int = Query(default=12, ge=1, le=50),
    status: str | None = Query(
        default=None,
        pattern="^(open|completed|cancelled|archived)$",
    ),
    cursor_date: date | None = Query(default=None),
    cursor_id: int | None = Query(default=None, ge=1),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    return await milestone_service.list_milestone_timeline(
        project_id,
        current_user,
        db,
        anchor_date=anchor_date,
        direction=direction,
        limit=limit,
        status=status,
        cursor_date=cursor_date,
        cursor_id=cursor_id,
    )


@router.get("/{milestone_id}", response_model=MilestoneOut)
async def get_milestone(
    project_id: int,
    milestone_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    return await milestone_service.get_milestone(
        project_id, milestone_id, current_user, db
    )


@router.put("/{milestone_id}", response_model=MilestoneOut)
async def update_milestone(
    project_id: int,
    milestone_id: int,
    data: MilestoneUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    milestone = await milestone_service.update_milestone(
        project_id, milestone_id, data, current_user, db
    )
    queue_ws_event(
        db,
        "milestone_updated",
        project_id,
        {"milestone_id": milestone.id},
        actor_id=current_user.id,
    )
    return milestone


@router.delete("/{milestone_id}")
async def delete_milestone(
    project_id: int,
    milestone_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await milestone_service.delete_milestone(
        project_id, milestone_id, current_user, db
    )
    queue_ws_event(
        db,
        "milestone_deleted",
        project_id,
        {"milestone_id": milestone_id},
        actor_id=current_user.id,
    )
    return {"message": "里程碑已删除"}
