import asyncio
import time
import uuid

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.database import get_db
from app.core.paths import get_avatars_dir
from app.core.security import (
    create_access_token,
    get_current_user,
    hash_password,
    verify_password,
)
from app.models.user import User
from app.schemas import PasswordChange, Token, UserCreate, UserOut, UserProfileUpdate

settings = get_settings()
router = APIRouter(prefix="/api/auth", tags=["auth"])

# Simple in-memory rate limiter for login
_login_attempts: dict[str, list[float]] = {}


def _check_rate_limit(key: str) -> bool:
    """Return True if rate limited."""
    now = time.time()
    attempts = _login_attempts.get(key, [])
    attempts = [t for t in attempts if now - t < settings.rate_limit_window]
    _login_attempts[key] = attempts
    return len(attempts) >= settings.rate_limit_login_max


def _record_attempt(key: str):
    now = time.time()
    attempts = _login_attempts.get(key, [])
    attempts = [t for t in attempts if now - t < settings.rate_limit_window]
    attempts.append(now)
    _login_attempts[key] = attempts


@router.post("/register", status_code=status.HTTP_201_CREATED)
async def register(data: UserCreate, db: AsyncSession = Depends(get_db)):
    # Check existing user
    result = await db.execute(
        select(User).where((User.username == data.username) | (User.email == data.email))
    )
    if result.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="用户名或邮箱已存在",
        )

    user = User(
        username=data.username,
        email=data.email,
        hashed_password=hash_password(data.password),
        display_name=data.display_name or data.username,
        is_approved=False,
    )
    db.add(user)
    await db.flush()
    await db.refresh(user)
    return {"message": "注册申请已提交，请等待管理员审批", "user_id": user.id}


@router.post("/login")
async def login(
    request: Request,
    form_data: OAuth2PasswordRequestForm = Depends(),
    db: AsyncSession = Depends(get_db),
):
    # Rate limiting by username + IP
    client_ip = request.client.host if request.client else "unknown"
    rate_key = f"{form_data.username}:{client_ip}"
    if _check_rate_limit(rate_key):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="登录尝试过于频繁，请稍后再试",
        )
    result = await db.execute(
        select(User).where(User.username == form_data.username)
    )
    user = result.scalar_one_or_none()

    if not user or not verify_password(form_data.password, user.hashed_password):
        _record_attempt(rate_key)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="用户名或密码错误",
        )

    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="账号已被禁用，请联系管理员",
        )

    if not user.is_approved:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="账号尚未通过审批，请等待管理员审批",
        )

    _login_attempts.pop(rate_key, None)
    token = create_access_token({"sub": str(user.id)})
    return Token(access_token=token)


@router.get("/me", response_model=UserOut)
async def get_me(current_user: User = Depends(get_current_user)):
    return current_user


@router.put("/profile", response_model=UserOut)
async def update_profile(
    data: UserProfileUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Update current user profile (display_name, email, avatar_url). Username is immutable."""
    if data.display_name is not None:
        current_user.display_name = data.display_name
    if data.email is not None:
        # Check email uniqueness
        result = await db.execute(
            select(User).where(User.email == data.email, User.id != current_user.id)
        )
        if result.scalar_one_or_none():
            raise HTTPException(status_code=409, detail="邮箱已被使用")
        current_user.email = data.email
    if data.avatar_url is not None:
        current_user.avatar_url = data.avatar_url

    await db.flush()
    await db.refresh(current_user)
    return current_user


@router.put("/password")
async def change_password(
    data: PasswordChange,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Change current user password (requires old password)."""
    if not verify_password(data.old_password, current_user.hashed_password):
        raise HTTPException(status_code=400, detail="原密码错误")

    if len(data.new_password) < 6:
        raise HTTPException(status_code=400, detail="新密码至少6位")

    current_user.hashed_password = hash_password(data.new_password)
    await db.flush()
    return {"message": "密码修改成功"}


@router.post("/avatar")
async def upload_avatar(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Upload a new avatar image for the current user."""
    allowed_types = {"image/png", "image/jpeg", "image/webp", "image/gif"}
    if not file.content_type or file.content_type not in allowed_types:
        raise HTTPException(status_code=400, detail="仅支持 png、jpg、webp、gif 格式的图片")

    contents = await file.read()
    if len(contents) > settings.avatar_max_bytes:
        raise HTTPException(status_code=400, detail=f"头像大小不能超过 {settings.avatar_max_bytes // 1024 // 1024}MB")

    ext = file.content_type.split("/")[-1]
    if ext == "jpeg":
        ext = "jpg"
    filename = f"{uuid.uuid4().hex}.{ext}"
    avatars_dir = get_avatars_dir()
    file_path = avatars_dir / filename

    await asyncio.to_thread(file_path.write_bytes, contents)

    current_user.avatar_url = f"/api/uploads/avatars/{filename}"
    await db.flush()
    await db.refresh(current_user)

    return {"avatar_url": current_user.avatar_url}
