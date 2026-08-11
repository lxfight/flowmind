import json
from datetime import UTC, date, datetime, timedelta

from fastapi import HTTPException
from sqlalchemy import and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.permissions import (
    ensure_project_assignee,
    ensure_project_editor,
    ensure_project_member,
)
from app.models.activity import ActivityLog
from app.models.milestone import Milestone
from app.models.task import Task
from app.models.user import User
from app.schemas import (
    MilestoneCreate,
    MilestoneOut,
    MilestoneTimelinePage,
    MilestoneUpdate,
)
from app.services import task_service
from app.services.integration_service import emit_domain_event


def _aware(value: datetime) -> datetime:
    return value if value.tzinfo else value.replace(tzinfo=UTC)


def _health(milestone: Milestone, today: date | None = None) -> str:
    if milestone.status == "completed":
        return "completed"
    if milestone.status == "cancelled":
        return "cancelled"
    today = today or datetime.now(UTC).date()
    if milestone.target_date < today:
        return "overdue"

    open_tasks = [task for task in milestone.tasks if not task.is_completed]
    has_overdue_task = any(
        task.due_date and _aware(task.due_date).date() < today
        for task in open_tasks
    )
    if has_overdue_task or (
        milestone.target_date <= today + timedelta(days=7) and open_tasks
    ):
        return "at_risk"
    return "on_track"


def _out(milestone: Milestone) -> MilestoneOut:
    total = len(milestone.tasks)
    completed = sum(1 for task in milestone.tasks if task.is_completed)
    output = MilestoneOut.model_validate(milestone)
    output.health = _health(milestone)
    output.task_ids = sorted(task.id for task in milestone.tasks)
    output.task_total = total
    output.task_completed = completed
    output.progress = round(completed / total * 100) if total else 0
    return output


def _event_data(milestone: MilestoneOut) -> dict:
    return {
        "id": milestone.id,
        "title": milestone.title,
        "status": milestone.status,
        "target_date": milestone.target_date.isoformat(),
        "owner_id": milestone.owner_id,
        "task_ids": milestone.task_ids,
        "progress": milestone.progress,
        "completed_at": milestone.completed_at.isoformat() if milestone.completed_at else None,
    }


def _event_changes(before: dict, after: dict) -> dict:
    return {
        field: {"from": before[field], "to": value}
        for field, value in after.items()
        if field != "id" and before.get(field) != value
    }


async def _emit_milestone_event(
    db: AsyncSession,
    *,
    project_id: int,
    event_type: str,
    user: User,
    data: dict,
    changes: dict | None = None,
) -> None:
    await emit_domain_event(
        db,
        project_id=project_id,
        event_type=event_type,
        actor=user,
        resource_type="milestone",
        resource_id=data["id"],
        data=data,
        changes=changes,
        link=f"/project/{project_id}/milestones",
    )


def _log(
    db: AsyncSession,
    *,
    project_id: int,
    user_id: int,
    action: str,
    milestone_id: int,
    summary: str,
    snapshot: dict | None = None,
) -> None:
    """Write an ActivityLog row, stamping the agent batch id and a pre-change
    snapshot (as metadata_json) when running inside an agent batch."""
    batch_id = task_service.current_agent_batch()
    db.add(
        ActivityLog(
            project_id=project_id,
            user_id=user_id,
            action=action,
            target_type="milestone",
            target_id=milestone_id,
            summary=summary,
            metadata_json=json.dumps(snapshot, ensure_ascii=False)
            if (batch_id and snapshot)
            else "{}",
            action_batch_id=batch_id,
        )
    )


def _snapshot(milestone: Milestone) -> dict:
    """Serialize a milestone (and linked task ids) for undo compensation."""
    return {
        "id": milestone.id,
        "project_id": milestone.project_id,
        "title": milestone.title,
        "description": milestone.description,
        "target_date": milestone.target_date.isoformat() if milestone.target_date else None,
        "owner_id": milestone.owner_id,
        "status": milestone.status,
        "created_by": milestone.created_by,
        "completed_at": milestone.completed_at.isoformat() if milestone.completed_at else None,
        "task_ids": sorted(task.id for task in milestone.tasks),
    }


async def _tasks_for_project(
    project_id: int,
    task_ids: list[int],
    db: AsyncSession,
    *,
    milestone_id: int | None = None,
) -> list[Task]:
    unique_ids = list(dict.fromkeys(task_ids))
    if not unique_ids:
        return []
    result = await db.execute(
        select(Task)
        .where(
            Task.project_id == project_id,
            Task.parent_task_id.is_(None),
            Task.id.in_(unique_ids),
        )
        .options(selectinload(Task.milestones))
        .with_for_update()
    )
    tasks = result.scalars().all()
    if len(tasks) != len(unique_ids):
        raise HTTPException(
            status_code=400,
            detail="里程碑只能关联当前项目的顶层任务",
        )
    for task in tasks:
        other = next(
            (
                linked
                for linked in task.milestones
                if milestone_id is None or linked.id != milestone_id
            ),
            None,
        )
        if other is not None:
            raise HTTPException(
                status_code=409,
                detail=(
                    f"任务「{task.title}」已属于里程碑「{other.title}」，"
                    "每个任务只能关联一个里程碑"
                ),
            )
    task_by_id = {task.id: task for task in tasks}
    return [task_by_id[task_id] for task_id in unique_ids]


async def _milestone_or_404(
    project_id: int,
    milestone_id: int,
    db: AsyncSession,
) -> Milestone:
    result = await db.execute(
        select(Milestone)
        .where(
            Milestone.id == milestone_id,
            Milestone.project_id == project_id,
        )
        .options(selectinload(Milestone.owner), selectinload(Milestone.tasks))
    )
    milestone = result.scalar_one_or_none()
    if not milestone:
        raise HTTPException(status_code=404, detail="里程碑不存在")
    return milestone


async def list_milestones(
    project_id: int,
    user: User,
    db: AsyncSession,
    *,
    status: str | None = None,
) -> list[MilestoneOut]:
    await ensure_project_member(project_id, user, db)
    query = (
        select(Milestone)
        .where(Milestone.project_id == project_id)
        .options(selectinload(Milestone.owner), selectinload(Milestone.tasks))
        .order_by(Milestone.target_date, Milestone.id)
    )
    if status:
        query = query.where(Milestone.status == status)
    result = await db.execute(query)
    return [_out(milestone) for milestone in result.scalars().all()]


async def list_milestone_timeline(
    project_id: int,
    user: User,
    db: AsyncSession,
    *,
    anchor_date: date,
    direction: str,
    limit: int,
    status: str | None = None,
    cursor_date: date | None = None,
    cursor_id: int | None = None,
) -> MilestoneTimelinePage:
    await ensure_project_member(project_id, user, db)
    if (cursor_date is None) != (cursor_id is None):
        raise HTTPException(status_code=422, detail="时间线游标必须同时包含日期和 ID")

    filters = [Milestone.project_id == project_id]
    if status == "archived":
        filters.append(Milestone.status != "open")
    elif status:
        filters.append(Milestone.status == status)

    history_result = await db.execute(
        select(Milestone.id)
        .where(*filters, Milestone.target_date < anchor_date)
        .limit(1)
    )
    has_history = history_result.scalar_one_or_none() is not None

    query = select(Milestone).where(*filters)
    if direction == "forward":
        if cursor_date is None:
            query = query.where(Milestone.target_date >= anchor_date)
        else:
            query = query.where(
                or_(
                    Milestone.target_date > cursor_date,
                    and_(
                        Milestone.target_date == cursor_date,
                        Milestone.id > cursor_id,
                    ),
                )
            )
        query = query.order_by(Milestone.target_date, Milestone.id)
    else:
        if cursor_date is None:
            query = query.where(Milestone.target_date < anchor_date)
        else:
            query = query.where(
                or_(
                    Milestone.target_date < cursor_date,
                    and_(
                        Milestone.target_date == cursor_date,
                        Milestone.id < cursor_id,
                    ),
                )
            )
        query = query.order_by(Milestone.target_date.desc(), Milestone.id.desc())

    result = await db.execute(
        query.options(
            selectinload(Milestone.owner),
            selectinload(Milestone.tasks),
        ).limit(limit + 1)
    )
    rows = list(result.scalars().all())
    has_more = len(rows) > limit
    page_rows = rows[:limit]
    if direction == "backward":
        page_rows.reverse()

    boundary = None
    if has_more and page_rows:
        boundary = page_rows[-1] if direction == "forward" else page_rows[0]
    return MilestoneTimelinePage(
        items=[_out(milestone) for milestone in page_rows],
        has_more=has_more,
        has_history=has_history,
        next_cursor_date=boundary.target_date if boundary else None,
        next_cursor_id=boundary.id if boundary else None,
    )


async def get_milestone(
    project_id: int,
    milestone_id: int,
    user: User,
    db: AsyncSession,
) -> MilestoneOut:
    await ensure_project_member(project_id, user, db)
    return _out(await _milestone_or_404(project_id, milestone_id, db))


async def create_milestone(
    project_id: int,
    data: MilestoneCreate,
    user: User,
    db: AsyncSession,
) -> MilestoneOut:
    await ensure_project_editor(project_id, user, db)
    if data.owner_id is not None:
        await ensure_project_assignee(project_id, data.owner_id, db)
    tasks = await _tasks_for_project(project_id, data.task_ids, db)
    milestone = Milestone(
        project_id=project_id,
        title=data.title,
        description=data.description,
        target_date=data.target_date,
        owner_id=data.owner_id,
        created_by=user.id,
        tasks=tasks,
    )
    db.add(milestone)
    await db.flush()
    await db.refresh(milestone, ["tasks"])
    _log(
        db,
        project_id=project_id,
        user_id=user.id,
        action="create",
        milestone_id=milestone.id,
        summary=f"创建里程碑: {milestone.title}",
    )
    output = _out(await _milestone_or_404(project_id, milestone.id, db))
    await _emit_milestone_event(
        db,
        project_id=project_id,
        event_type="milestone.created",
        user=user,
        data=_event_data(output),
    )
    return output


async def update_milestone(
    project_id: int,
    milestone_id: int,
    data: MilestoneUpdate,
    user: User,
    db: AsyncSession,
) -> MilestoneOut:
    await ensure_project_editor(project_id, user, db)
    milestone = await _milestone_or_404(project_id, milestone_id, db)
    before_event = _event_data(_out(milestone))
    payload = data.model_dump(exclude_unset=True)
    task_ids = payload.pop("task_ids", None)
    if "owner_id" in payload and payload["owner_id"] is not None:
        await ensure_project_assignee(project_id, payload["owner_id"], db)
    # Capture the pre-change state (including task links) before mutating so
    # agent undo can restore it exactly.
    before_snapshot = _snapshot(milestone)
    if task_ids is not None:
        milestone.tasks = await _tasks_for_project(
            project_id, task_ids, db, milestone_id=milestone_id
        )

    previous_status = milestone.status
    for field, value in payload.items():
        setattr(milestone, field, value)
    if "target_date" in payload:
        milestone.due_notified_at = None
        milestone.overdue_notified_at = None
    if "status" in payload and milestone.status != previous_status:
        milestone.completed_at = (
            datetime.now(UTC) if milestone.status == "completed" else None
        )

    await db.flush()
    _log(
        db,
        project_id=project_id,
        user_id=user.id,
        action="update",
        milestone_id=milestone.id,
        summary=f"更新里程碑: {milestone.title}",
        snapshot=before_snapshot,
    )
    output = _out(await _milestone_or_404(project_id, milestone.id, db))
    event_data = _event_data(output)
    event_changes = _event_changes(before_event, event_data)
    await _emit_milestone_event(
        db,
        project_id=project_id,
        event_type="milestone.updated",
        user=user,
        data=event_data,
        changes=event_changes,
    )
    if (before_event["status"] == "completed") != (event_data["status"] == "completed"):
        await _emit_milestone_event(
            db,
            project_id=project_id,
            event_type="milestone.completed",
            user=user,
            data=event_data,
            changes={"status": event_changes["status"]},
        )
    return output


async def delete_milestone(
    project_id: int,
    milestone_id: int,
    user: User,
    db: AsyncSession,
) -> None:
    await ensure_project_editor(project_id, user, db)
    milestone = await _milestone_or_404(project_id, milestone_id, db)
    event_data = _event_data(_out(milestone))
    title = milestone.title
    _log(
        db,
        project_id=project_id,
        user_id=user.id,
        action="delete",
        milestone_id=milestone.id,
        summary=f"删除里程碑: {title}",
        snapshot=_snapshot(milestone),
    )
    await _emit_milestone_event(
        db,
        project_id=project_id,
        event_type="milestone.deleted",
        user=user,
        data=event_data,
    )
    await db.delete(milestone)
