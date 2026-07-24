import uuid
from datetime import UTC, datetime
from typing import Any

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.security import get_current_superuser
from app.core.version import APP_VERSION
from app.models.system_update import SystemUpdateRun
from app.models.user import User
from app.services.update_service import (
    normalize_version,
    release_service,
    update_overview,
    updater_client,
)

router = APIRouter(prefix="/api/admin/update", tags=["admin-update"])
TERMINAL_STATUSES = {"succeeded", "failed", "rolled_back"}


class UpdateApplyRequest(BaseModel):
    version: str = Field(min_length=1, max_length=64)
    request_id: str | None = Field(default=None, min_length=8, max_length=64)


def _parse_datetime(value: Any) -> datetime | None:
    if not isinstance(value, str) or not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


async def _sync_run(db: AsyncSession, updater: dict[str, Any]) -> None:
    request_id = updater.get("request_id")
    if not request_id:
        return
    result = await db.execute(
        select(SystemUpdateRun).where(SystemUpdateRun.request_id == request_id)
    )
    run = result.scalar_one_or_none()
    if not run:
        return
    run.status = str(updater.get("status") or run.status)
    run.step = str(updater.get("step") or run.step)
    run.progress = int(updater.get("progress") or 0)
    run.message = str(updater.get("message") or "")[:4000]
    run.error = str(updater["error"])[:4000] if updater.get("error") else None
    run.backup_path = updater.get("backup_path") or run.backup_path
    if run.status in TERMINAL_STATUSES:
        run.finished_at = _parse_datetime(updater.get("finished_at")) or datetime.now(UTC)


def _run_payload(run: SystemUpdateRun, actor_name: str | None = None) -> dict[str, Any]:
    return {
        "id": run.id,
        "request_id": run.request_id,
        "actor_id": run.actor_id,
        "actor_name": actor_name,
        "previous_version": run.previous_version,
        "target_version": run.target_version,
        "status": run.status,
        "step": run.step,
        "progress": run.progress,
        "message": run.message,
        "error": run.error,
        "backup_path": run.backup_path,
        "created_at": run.created_at,
        "updated_at": run.updated_at,
        "finished_at": run.finished_at,
    }


@router.get("/status")
async def get_update_status(
    current_user: User = Depends(get_current_superuser),
    db: AsyncSession = Depends(get_db),
):
    overview = await update_overview()
    await _sync_run(db, overview["updater"])
    return overview


@router.post("/check")
async def check_for_updates(
    current_user: User = Depends(get_current_superuser),
    db: AsyncSession = Depends(get_db),
):
    overview = await update_overview(force=True)
    await _sync_run(db, overview["updater"])
    return overview


@router.get("/releases")
async def list_releases(
    limit: int = Query(default=20, ge=1, le=50),
    current_user: User = Depends(get_current_superuser),
):
    return await release_service.list_releases(limit=limit)


@router.post("/apply")
async def apply_update(
    data: UpdateApplyRequest,
    current_user: User = Depends(get_current_superuser),
    db: AsyncSession = Depends(get_db),
):
    try:
        target_version = normalize_version(data.version)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    request_id = data.request_id or uuid.uuid4().hex
    existing_result = await db.execute(
        select(SystemUpdateRun).where(SystemUpdateRun.request_id == request_id)
    )
    existing = existing_result.scalar_one_or_none()
    if existing:
        if existing.target_version != target_version:
            raise HTTPException(status_code=409, detail="请求 ID 已用于其他版本")
        return {"run": _run_payload(existing), "idempotent_replay": True}

    overview = await update_overview()
    latest = overview.get("latest")
    if not latest or latest.get("version") != target_version:
        raise HTTPException(status_code=409, detail="目标版本不是当前可用的最新正式版本")
    if target_version == APP_VERSION:
        raise HTTPException(status_code=409, detail="当前已是该版本")
    if not overview["updater"].get("available"):
        raise HTTPException(status_code=503, detail="updater 服务不可用")

    run = SystemUpdateRun(
        request_id=request_id,
        actor_id=current_user.id,
        previous_version=APP_VERSION,
        target_version=target_version,
        status="queued",
        step="queued",
        progress=0,
        message="等待 updater 接管更新",
    )
    db.add(run)
    await db.flush()
    await db.commit()
    try:
        updater = await updater_client.request(
            "POST",
            "/apply",
            {"version": target_version, "request_id": request_id},
        )
    except (RuntimeError, httpx.HTTPError, ValueError) as exc:
        run.status = "failed"
        run.error = str(exc)[:4000]
        run.finished_at = datetime.now(UTC)
        await db.commit()
        raise HTTPException(status_code=502, detail="updater 未能启动更新") from exc
    await _sync_run(db, updater)
    await db.commit()
    return {"run": _run_payload(run), "updater": updater}


@router.post("/rollback")
async def rollback_update(
    data: UpdateApplyRequest,
    current_user: User = Depends(get_current_superuser),
    db: AsyncSession = Depends(get_db),
):
    request_id = data.request_id or uuid.uuid4().hex
    try:
        target_version = normalize_version(data.version)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    existing_result = await db.execute(
        select(SystemUpdateRun).where(SystemUpdateRun.request_id == request_id)
    )
    existing = existing_result.scalar_one_or_none()
    if existing:
        if existing.target_version != target_version:
            raise HTTPException(status_code=409, detail="请求 ID 已用于其他版本")
        return {"run": _run_payload(existing), "idempotent_replay": True}

    run = SystemUpdateRun(
        request_id=request_id,
        actor_id=current_user.id,
        previous_version=APP_VERSION,
        target_version=target_version,
        status="queued",
        step="queued",
        progress=0,
        message="等待 updater 接管回滚",
    )
    db.add(run)
    await db.flush()
    await db.commit()
    try:
        updater = await updater_client.request(
            "POST",
            "/rollback",
            {"version": target_version, "request_id": request_id},
        )
    except (RuntimeError, httpx.HTTPError) as exc:
        run.status = "failed"
        run.error = str(exc)[:4000]
        run.finished_at = datetime.now(UTC)
        await db.commit()
        raise HTTPException(status_code=502, detail="updater 未能启动回滚") from exc
    await _sync_run(db, updater)
    await db.commit()
    return {"run": _run_payload(run), "updater": updater}


@router.get("/history")
async def update_history(
    current_user: User = Depends(get_current_superuser),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(SystemUpdateRun, User.display_name)
        .join(User, User.id == SystemUpdateRun.actor_id)
        .order_by(SystemUpdateRun.created_at.desc())
        .limit(30)
    )
    return {"items": [_run_payload(run, actor_name) for run, actor_name in result.all()]}
