import asyncio
import contextlib
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

# Allowed attachment extensions. Storing untrusted file types under a static
# mount would allow stored XSS; keep the surface minimal and inert.
ALLOWED_ATTACHMENT_EXTENSIONS = {
    ".pdf", ".png", ".jpg", ".jpeg", ".gif", ".webp",
    ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx",
    ".txt", ".md", ".csv", ".zip", ".gz", ".7z",
}

# Map a few well-known text-like extensions to their binary MIME type so
# browsers never inline-render uploaded content even if requested directly.
EXTENSION_MEDIA_TYPE = {
    ".txt": "text/plain",
    ".md": "text/markdown",
    ".csv": "text/csv",
    ".svg": "application/octet-stream",
    ".html": "application/octet-stream",
    ".htm": "application/octet-stream",
    ".xml": "application/octet-stream",
    ".json": "application/octet-stream",
    ".js": "application/octet-stream",
    ".css": "application/octet-stream",
}


def get_attachments_dir() -> Path:
    """Return the task-attachments directory, creating it if necessary."""
    attachments_dir = get_upload_dir() / "task_attachments"
    attachments_dir.mkdir(parents=True, exist_ok=True)
    return attachments_dir


async def _read_upload_limited(file: UploadFile, max_bytes: int) -> bytes:
    """Read an upload in chunks, rejecting oversized files without buffering it whole."""
    chunks: list[bytes] = []
    total = 0
    while chunk := await file.read(1024 * 1024):
        total += len(chunk)
        if total > max_bytes:
            raise HTTPException(status_code=400, detail="附件大小不能超过 20MB")
        chunks.append(chunk)
    return b"".join(chunks)


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

    # Strip any client-supplied path components; keep only the base name.
    original_name = os.path.basename(file.filename or "attachment") or "attachment"
    ext = Path(original_name).suffix.lower()[:20]
    if ext not in ALLOWED_ATTACHMENT_EXTENSIONS:
        raise HTTPException(status_code=400, detail="不支持的附件类型")
    contents = await _read_upload_limited(file, MAX_ATTACHMENT_BYTES)

    stored_name = f"{uuid.uuid4().hex}{ext}"
    file_path = get_attachments_dir() / stored_name
    await asyncio.to_thread(file_path.write_bytes, contents)

    content_type = file.content_type or "application/octet-stream"
    if content_type in EXTENSION_MEDIA_TYPE or EXTENSION_MEDIA_TYPE.get(ext) == "application/octet-stream":
        # Never let uploads render inline as active content.
        content_type = EXTENSION_MEDIA_TYPE.get(ext, "application/octet-stream")

    attachment = TaskAttachment(
        task_id=task_id,
        uploader_id=current_user.id,
        filename=original_name,
        stored_name=stored_name,
        content_type=content_type,
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
    # Force download (never inline render) and keep uploaded content inert even
    # if a browser ignores the disposition.
    return FileResponse(
        path=str(file_path),
        filename=attachment.filename,
        media_type=attachment.content_type or "application/octet-stream",
        headers={"X-Content-Type-Options": "nosniff"},
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
        with contextlib.suppress(OSError):
            # DB row is gone; leftover file is harmless
            await asyncio.to_thread(file_path.unlink)
    return {"message": "附件已删除"}
