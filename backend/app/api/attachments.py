import asyncio
import os
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.permissions import (
    ensure_project_editor,
    ensure_project_member,
    ensure_task_in_project,
    get_project_or_404,
)
from app.core.database import get_db
from app.core.paths import get_upload_dir
from app.core.realtime import queue_ws_event
from app.core.security import get_current_user
from app.models.project import ProjectMember
from app.models.task import TaskAttachment
from app.models.user import User
from app.schemas import TaskAttachmentOut

router = APIRouter(
    prefix="/api/projects/{project_id}/tasks/{task_id}/attachments",
    tags=["task-attachments"],
)

MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024  # 20 MB


def get_attachments_dir() -> Path:
    """Return the task-attachments directory, creating it if necessary."""
    attachments_dir = get_upload_dir() / "task_attachments"
    attachments_dir.mkdir(parents=True, exist_ok=True)
    return attachments_dir


async def _get_attachment_or_404(task_id: int, attachment_id: int, db: AsyncSession) -> TaskAttachment:
    result = await db.execute(
        select(TaskAttachment).where(
            TaskAttachment.id == attachment_id,
            TaskAttachment.task_id == task_id,
        )
    )
    attachment = result.scalar_one_or_none()
    if not attachment:
        raise HTTPException(status_code=404, detail="附件不存在")
    return attachment


async def _ensure_attachment_moderator(
    project_id: int,
    attachment: TaskAttachment,
    current_user: User,
    db: AsyncSession,
) -> None:
    """Only the uploader, project owner/admin, or superuser may delete."""
    await ensure_project_member(project_id, current_user, db)
    if attachment.uploader_id == current_user.id or current_user.is_superuser:
        return
    project = await get_project_or_404(project_id, db)
    if project.owner_id == current_user.id:
        return
    result = await db.execute(
        select(ProjectMember).where(
            ProjectMember.project_id == project_id,
            ProjectMember.user_id == current_user.id,
        )
    )
    member = result.scalar_one_or_none()
    if not member or member.role not in ("owner", "admin"):
        raise HTTPException(status_code=403, detail="无权操作此附件")


def _attachment_path(attachment: TaskAttachment) -> Path:
    """Resolve the on-disk path, guarding against path traversal."""
    base = get_attachments_dir().resolve()
    path = (base / attachment.stored_name).resolve()
    if base not in path.parents:
        raise HTTPException(status_code=400, detail="非法的附件路径")
    return path


@router.post("", response_model=TaskAttachmentOut, status_code=201)
async def upload_attachment(
    project_id: int,
    task_id: int,
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await ensure_project_editor(project_id, current_user, db)
    await ensure_task_in_project(project_id, task_id, db)

    contents = await file.read()
    if len(contents) > MAX_ATTACHMENT_BYTES:
        raise HTTPException(status_code=400, detail="附件大小不能超过 20MB")

    # Strip any client-supplied path components; keep only the base name.
    original_name = os.path.basename(file.filename or "attachment") or "attachment"
    ext = Path(original_name).suffix[:20]
    stored_name = f"{uuid.uuid4().hex}{ext}"
    file_path = get_attachments_dir() / stored_name
    await asyncio.to_thread(file_path.write_bytes, contents)

    attachment = TaskAttachment(
        task_id=task_id,
        uploader_id=current_user.id,
        filename=original_name,
        stored_name=stored_name,
        content_type=file.content_type or "application/octet-stream",
        size=len(contents),
    )
    db.add(attachment)
    await db.flush()
    await db.refresh(attachment)
    queue_ws_event(
        db, "attachment_added", project_id,
        {"task_id": task_id, "attachment_id": attachment.id},
        actor_id=current_user.id,
    )
    return attachment


@router.get("", response_model=list[TaskAttachmentOut])
async def list_attachments(
    project_id: int,
    task_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await ensure_project_member(project_id, current_user, db)
    await ensure_task_in_project(project_id, task_id, db)
    result = await db.execute(
        select(TaskAttachment)
        .where(TaskAttachment.task_id == task_id)
        .order_by(TaskAttachment.created_at)
    )
    return result.scalars().all()


@router.get("/{attachment_id}/download")
async def download_attachment(
    project_id: int,
    task_id: int,
    attachment_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await ensure_project_member(project_id, current_user, db)
    await ensure_task_in_project(project_id, task_id, db)
    attachment = await _get_attachment_or_404(task_id, attachment_id, db)
    file_path = _attachment_path(attachment)
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="附件文件已丢失")
    # FileResponse sets Content-Disposition: attachment with the original name.
    return FileResponse(
        path=str(file_path),
        filename=attachment.filename,
        media_type=attachment.content_type or "application/octet-stream",
    )


@router.delete("/{attachment_id}")
async def delete_attachment(
    project_id: int,
    task_id: int,
    attachment_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await ensure_task_in_project(project_id, task_id, db)
    attachment = await _get_attachment_or_404(task_id, attachment_id, db)
    await _ensure_attachment_moderator(project_id, attachment, current_user, db)
    file_path = _attachment_path(attachment)
    await db.delete(attachment)
    queue_ws_event(
        db, "attachment_deleted", project_id,
        {"task_id": task_id, "attachment_id": attachment_id},
        actor_id=current_user.id,
    )
    if file_path.exists():
        try:
            await asyncio.to_thread(file_path.unlink)
        except OSError:
            pass  # DB row is gone; leftover file is harmless
    return {"message": "附件已删除"}
