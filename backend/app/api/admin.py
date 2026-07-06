from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.database import get_db
from app.core.security import get_current_superuser, hash_password
from app.models.user import User
from app.schemas import UserOut

router = APIRouter(prefix="/api/admin", tags=["admin"])


@router.get("/users", response_model=list[UserOut])
async def list_users(
    current_user: User = Depends(get_current_superuser),
    db: AsyncSession = Depends(get_db),
):
    """List all users (superuser only)."""
    result = await db.execute(select(User).order_by(User.created_at.desc()))
    return [UserOut.model_validate(u) for u in result.scalars().all()]


@router.post("/users/{user_id}/approve", response_model=UserOut)
async def approve_user(
    user_id: int,
    can_create_project: bool = False,
    current_user: User = Depends(get_current_superuser),
    db: AsyncSession = Depends(get_db),
):
    """Approve a user registration."""
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="用户不存在")
    if user.id == current_user.id:
        raise HTTPException(status_code=400, detail="不能审批自己的账号")

    user.is_approved = True
    user.can_create_project = can_create_project
    await db.flush()
    await db.refresh(user)
    return UserOut.model_validate(user)


@router.post("/users/{user_id}/reject")
async def reject_user(
    user_id: int,
    current_user: User = Depends(get_current_superuser),
    db: AsyncSession = Depends(get_db),
):
    """Reject/disable a user."""
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="用户不存在")
    if user.id == current_user.id:
        raise HTTPException(status_code=400, detail="不能禁用自己的账号")

    user.is_active = False
    await db.flush()
    return {"message": "用户已禁用"}


@router.post("/users/{user_id}/activate")
async def activate_user(
    user_id: int,
    current_user: User = Depends(get_current_superuser),
    db: AsyncSession = Depends(get_db),
):
    """Re-enable a disabled user."""
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="用户不存在")

    user.is_active = True
    await db.flush()
    return {"message": "用户已启用"}


@router.post("/users/{user_id}/reset-password")
async def admin_reset_password(
    user_id: int,
    current_user: User = Depends(get_current_superuser),
    db: AsyncSession = Depends(get_db),
):
    """Reset user password to a random value (superuser only)."""
    import secrets
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="用户不存在")

    new_password = secrets.token_urlsafe(8)
    user.hashed_password = hash_password(new_password)
    await db.flush()
    return {"message": "密码已重置", "new_password": new_password}


@router.put("/users/{user_id}", response_model=UserOut)
async def update_user(
    user_id: int,
    can_create_project: bool | None = None,
    display_name: str | None = None,
    current_user: User = Depends(get_current_superuser),
    db: AsyncSession = Depends(get_db),
):
    """Update user settings (superuser only)."""
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="用户不存在")

    if can_create_project is not None:
        user.can_create_project = can_create_project
    if display_name is not None:
        user.display_name = display_name

    await db.flush()
    await db.refresh(user)
    return UserOut.model_validate(user)
