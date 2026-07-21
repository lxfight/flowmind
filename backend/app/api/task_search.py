"""Cross-project task search API ("我的任务搜索")."""
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select, union
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.database import get_db
from app.core.security import get_current_user
from app.models.project import Project, ProjectMember
from app.models.task import Task, TaskStatus
from app.models.user import User
from app.schemas import TaskSearchItemOut, TaskSearchListOut, UserBriefOut

router = APIRouter(prefix="/api/tasks", tags=["task-search"])


def _escape_like(term: str) -> str:
    """Escape LIKE wildcards so user input is matched literally."""
    return term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def _accessible_project_ids(user: User):
    """Subquery of project ids the user may see (owner/member, or all for admin)."""
    owned = select(Project.id).where(Project.owner_id == user.id)
    if user.is_superuser:
        return select(Project.id)
    member_of = select(ProjectMember.project_id).where(
        ProjectMember.user_id == user.id
    )
    return union(owned, member_of)


@router.get("/search", response_model=TaskSearchListOut)
async def search_my_tasks(
    q: str | None = Query(default=None, max_length=256),
    project_id: int | None = None,
    assignee_id: str | None = Query(
        default=None, description="用户 ID 或 'me'"
    ),
    priority: int | None = Query(default=None, ge=0, le=4),
    status_id: int | None = None,
    overdue: bool | None = None,
    due_before: datetime | None = None,
    due_after: datetime | None = None,
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Search tasks across all projects the current user can access."""
    accessible = _accessible_project_ids(current_user).subquery()

    filters = [Task.project_id.in_(select(accessible))]
    if project_id is not None:
        filters.append(Task.project_id == project_id)
    if assignee_id is not None:
        if assignee_id == "me":
            filters.append(Task.assignees.any(User.id == current_user.id))
        else:
            try:
                filters.append(Task.assignees.any(User.id == int(assignee_id)))
            except ValueError:
                raise HTTPException(status_code=422, detail="assignee_id 必须是用户 ID 或 'me'") from None
    if priority is not None:
        filters.append(Task.priority == priority)
    if status_id is not None:
        filters.append(Task.status_id == status_id)
    if q and q.strip():
        pattern = f"%{_escape_like(q.strip())}%"
        filters.append(
            Task.title.ilike(pattern, escape="\\")
            | Task.description.ilike(pattern, escape="\\")
        )
    if overdue is True:
        filters.append(Task.due_date.isnot(None))
        filters.append(Task.due_date < datetime.now(UTC))
        filters.append(Task.is_completed.is_(False))
    if due_before is not None:
        filters.append(Task.due_date.isnot(None))
        filters.append(Task.due_date <= due_before)
    if due_after is not None:
        filters.append(Task.due_date.isnot(None))
        filters.append(Task.due_date >= due_after)

    count_result = await db.execute(
        select(func.count(Task.id)).where(*filters)
    )
    total = count_result.scalar() or 0

    result = await db.execute(
        select(Task, Project.name, Project.color, TaskStatus.name, TaskStatus.color)
        .join(Project, Task.project_id == Project.id)
        .join(TaskStatus, Task.status_id == TaskStatus.id)
        .options(selectinload(Task.assignees))
        .where(*filters)
        .order_by(Task.updated_at.desc(), Task.id.desc())
        .offset(offset)
        .limit(limit)
    )

    items: list[TaskSearchItemOut] = []
    for task, project_name, project_color, status_name, status_color in result.all():
        items.append(
            TaskSearchItemOut(
                id=task.id,
                project_id=task.project_id,
                project_name=project_name,
                project_color=project_color,
                status_id=task.status_id,
                status_name=status_name,
                status_color=status_color,
                title=task.title,
                description=task.description,
                priority=task.priority,
                is_completed=task.is_completed,
                due_date=task.due_date,
                updated_at=task.updated_at,
                assignees=[UserBriefOut.model_validate(u) for u in task.assignees],
            )
        )
    return TaskSearchListOut(tasks=items, total=total)
