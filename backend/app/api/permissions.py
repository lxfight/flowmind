from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.project import Project, ProjectMember
from app.models.task import Task, TaskStatus
from app.models.user import User


async def get_project_or_404(project_id: int, db: AsyncSession) -> Project:
    result = await db.execute(select(Project).where(Project.id == project_id))
    project = result.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail="项目不存在")
    return project


async def ensure_project_member(
    project_id: int,
    current_user: User,
    db: AsyncSession,
) -> ProjectMember | None:
    project = await get_project_or_404(project_id, db)
    if current_user.is_superuser:
        return None

    result = await db.execute(
        select(ProjectMember).where(
            ProjectMember.project_id == project_id,
            ProjectMember.user_id == current_user.id,
        )
    )
    member = result.scalar_one_or_none()
    if not member and project.owner_id != current_user.id:
        raise HTTPException(status_code=403, detail="无权访问此项目")
    return member


async def ensure_project_admin(
    project_id: int,
    current_user: User,
    db: AsyncSession,
) -> ProjectMember | None:
    member = await ensure_project_member(project_id, current_user, db)
    if current_user.is_superuser:
        return None
    if not member or member.role not in ("owner", "admin"):
        raise HTTPException(status_code=403, detail="无权管理此项目")
    return member


async def ensure_project_editor(
    project_id: int,
    current_user: User,
    db: AsyncSession,
) -> ProjectMember | None:
    """Allow owners, admins, and members to mutate project content."""
    member = await ensure_project_member(project_id, current_user, db)
    if current_user.is_superuser:
        return None
    if member and member.role == "viewer":
        raise HTTPException(status_code=403, detail="只读成员无权修改项目内容")
    return member


async def ensure_project_assignee(
    project_id: int,
    user_id: int,
    db: AsyncSession,
) -> User:
    """Return an active project member that can be assigned work."""
    result = await db.execute(
        select(User)
        .join(ProjectMember, ProjectMember.user_id == User.id)
        .where(
            ProjectMember.project_id == project_id,
            User.id == user_id,
            User.is_active.is_(True),
            User.is_approved.is_(True),
        )
    )
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=400, detail="指派人必须是有效的项目成员")
    return user


async def ensure_status_in_project(
    project_id: int,
    status_id: int,
    db: AsyncSession,
) -> TaskStatus:
    result = await db.execute(
        select(TaskStatus).where(
            TaskStatus.id == status_id,
            TaskStatus.project_id == project_id,
        )
    )
    status = result.scalar_one_or_none()
    if not status:
        raise HTTPException(status_code=404, detail="状态不存在")
    return status


async def ensure_task_in_project(
    project_id: int,
    task_id: int,
    db: AsyncSession,
) -> Task:
    result = await db.execute(
        select(Task).where(Task.id == task_id, Task.project_id == project_id)
    )
    task = result.scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=404, detail="任务不存在")
    return task
