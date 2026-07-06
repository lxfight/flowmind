from fastapi import APIRouter, Depends, HTTPException
from datetime import datetime, timezone
from sqlalchemy import select, func, delete
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.database import get_db
from app.core.security import get_current_user
from app.models.user import User
from app.models.project import Project, ProjectMember
from app.models.task import Task, TaskStatus
from app.schemas import ProjectCreate, ProjectUpdate, ProjectOut, ProjectMemberOut, ProjectMemberAdd, ProjectStats, DashboardStats, ActivityLogOut

router = APIRouter(prefix="/api/projects", tags=["projects"])


@router.get("/users/search", response_model=list["UserOut"])
async def search_users(
    q: str = "",
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Search users by username or display_name."""
    from app.schemas import UserOut
    if not q:
        return []
    result = await db.execute(
        select(User).where(
            (User.username.ilike(f"%{q}%")) | (User.display_name.ilike(f"%{q}%"))
        ).limit(10)
    )
    return [UserOut.model_validate(u) for u in result.scalars().all()]


@router.get("", response_model=list[ProjectOut])
async def list_projects(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List projects the current user is a member of."""
    result = await db.execute(
        select(Project)
        .join(ProjectMember)
        .where(ProjectMember.user_id == current_user.id)
        .where(Project.is_archived == False)
        .order_by(Project.updated_at.desc())
    )
    projects = result.scalars().all()

    # Attach member counts
    output = []
    for p in projects:
        count_result = await db.execute(
            select(func.count(ProjectMember.id)).where(ProjectMember.project_id == p.id)
        )
        out = ProjectOut.model_validate(p)
        out.member_count = count_result.scalar() or 0
        output.append(out)
    return output


@router.post("", response_model=ProjectOut, status_code=201)
async def create_project(
    data: ProjectCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Create a new project with default task statuses."""
    project = Project(
        name=data.name,
        description=data.description,
        color=data.color,
        owner_id=current_user.id,
    )
    db.add(project)
    await db.flush()

    # Add creator as owner
    member = ProjectMember(
        project_id=project.id,
        user_id=current_user.id,
        role="owner",
    )
    db.add(member)

    # Create default task statuses
    default_statuses = [
        TaskStatus(name="待处理", order=0, color="#6b7280"),
        TaskStatus(name="进行中", order=1, color="#3b82f6"),
        TaskStatus(name="已完成", order=2, color="#22c55e", is_done=True),
    ]
    for status in default_statuses:
        status.project_id = project.id
        db.add(status)

    await db.flush()
    await db.refresh(project)
    out = ProjectOut.model_validate(project)
    out.member_count = 1
    return out


@router.get("/stats", response_model=DashboardStats)
async def get_dashboard_stats(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get dashboard statistics for all user projects."""
    # Get user's projects
    result = await db.execute(
        select(Project)
        .join(ProjectMember)
        .where(ProjectMember.user_id == current_user.id)
        .where(Project.is_archived == False)
    )
    projects = result.scalars().all()

    stats = []
    for p in projects:
        # Total tasks
        total_result = await db.execute(
            select(func.count(Task.id)).where(Task.project_id == p.id)
        )
        total_tasks = total_result.scalar() or 0

        # Completed tasks
        completed_result = await db.execute(
            select(func.count(Task.id)).where(
                Task.project_id == p.id,
                Task.is_completed == True,
            )
        )
        completed_tasks = completed_result.scalar() or 0

        # Overdue tasks (due_date in the past and not completed)
        overdue_result = await db.execute(
            select(func.count(Task.id)).where(
                Task.project_id == p.id,
                Task.is_completed == False,
                Task.due_date.isnot(None),
                Task.due_date < datetime.now(timezone.utc),
            )
        )
        overdue_tasks = overdue_result.scalar() or 0

        # Member count
        member_result = await db.execute(
            select(func.count(ProjectMember.id)).where(ProjectMember.project_id == p.id)
        )
        member_count = member_result.scalar() or 0

        stats.append(ProjectStats(
            project_id=p.id,
            project_name=p.name,
            color=p.color,
            total_tasks=total_tasks,
            completed_tasks=completed_tasks,
            overdue_tasks=overdue_tasks,
            member_count=member_count,
        ))

    return DashboardStats(projects=stats)


@router.get("/{project_id}", response_model=ProjectOut)
async def get_project(
    project_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Project).where(Project.id == project_id)
    )
    project = result.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail="项目不存在")

    # Check membership
    member_check = await db.execute(
        select(ProjectMember).where(
            ProjectMember.project_id == project_id,
            ProjectMember.user_id == current_user.id,
        )
    )
    if not member_check.scalar_one_or_none() and project.owner_id != current_user.id:
        raise HTTPException(status_code=403, detail="无权访问此项目")

    count_result = await db.execute(
        select(func.count(ProjectMember.id)).where(ProjectMember.project_id == project_id)
    )
    out = ProjectOut.model_validate(project)
    out.member_count = count_result.scalar() or 0
    return out


@router.put("/{project_id}", response_model=ProjectOut)
async def update_project(
    project_id: int,
    data: ProjectUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Project).where(Project.id == project_id))
    project = result.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail="项目不存在")
    if project.owner_id != current_user.id:
        raise HTTPException(status_code=403, detail="只有项目所有者才能修改项目")

    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(project, field, value)

    await db.flush()
    await db.refresh(project)
    return ProjectOut.model_validate(project)


@router.get("/{project_id}/members", response_model=list[ProjectMemberOut])
async def list_members(project_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(ProjectMember)
        .where(ProjectMember.project_id == project_id)
    )
    members = result.scalars().all()
    output = []
    for m in members:
        await db.refresh(m, ["user"])
        out = ProjectMemberOut.model_validate(m)
        if m.user:
            out.username = m.user.username
            out.display_name = m.user.display_name
        output.append(out)
    return output


@router.post("/{project_id}/members")
async def add_member(
    project_id: int,
    data: ProjectMemberAdd,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    # Verify current user has permission
    result = await db.execute(
        select(ProjectMember).where(
            ProjectMember.project_id == project_id,
            ProjectMember.user_id == current_user.id,
            ProjectMember.role.in_(["owner", "admin"]),
        )
    )
    if not result.scalar_one_or_none():
        raise HTTPException(status_code=403, detail="无权添加成员")

    member = ProjectMember(
        project_id=project_id,
        user_id=data.user_id,
        role=data.role,
    )
    db.add(member)
    await db.flush()
    return {"message": "成员添加成功"}


@router.delete("/{project_id}/members/{user_id}")
async def remove_member(project_id: int, user_id: int, db: AsyncSession = Depends(get_db)):
    await db.execute(
        delete(ProjectMember).where(
            ProjectMember.project_id == project_id,
            ProjectMember.user_id == user_id,
        )
    )
    return {"message": "成员已移除"}


@router.get("/{project_id}/activities", response_model=list[ActivityLogOut])
async def list_activities(
    project_id: int,
    limit: int = 30,
    db: AsyncSession = Depends(get_db),
):
    """Get recent activity logs for a project."""
    from app.models.activity import ActivityLog
    result = await db.execute(
        select(ActivityLog)
        .where(ActivityLog.project_id == project_id)
        .order_by(ActivityLog.created_at.desc())
        .limit(limit)
    )
    logs = result.scalars().all()
    output = []
    for log in logs:
        out = ActivityLogOut.model_validate(log)
        # Attach user name
        if log.user:
            out.user_name = log.user.display_name or log.user.username
        output.append(out)
    return output
