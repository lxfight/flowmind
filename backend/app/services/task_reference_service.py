"""Task #reference parsing, synchronization, and read models."""

import re
from typing import Literal

from sqlalchemy import delete, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.permissions import ensure_project_member, ensure_task_in_project
from app.models.task import Task, TaskReference, TaskStatus
from app.models.user import User
from app.schemas import TaskReferenceItemOut, TaskReferencesOut, TaskReferenceTaskOut

SourceType = Literal["description", "comment"]
TASK_REFERENCE_RE = re.compile(r"(?<![\w#])#([1-9]\d*)\b")
INLINE_CODE_RE = re.compile(r"(`+)([^`\n]*?)\1")
FENCE_RE = re.compile(r"^[ \t]{0,3}(`{3,}|~{3,})")


def _escape_like(term: str) -> str:
    return term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def extract_task_reference_ids(text: str) -> set[int]:
    """Extract task ids from Markdown text while ignoring fenced/inline code."""
    visible_lines: list[str] = []
    fence_char: str | None = None
    fence_length = 0
    for line in text.splitlines(keepends=True):
        match = FENCE_RE.match(line)
        if match:
            marker = match.group(1)
            if fence_char is None:
                fence_char, fence_length = marker[0], len(marker)
            elif marker[0] == fence_char and len(marker) >= fence_length:
                fence_char, fence_length = None, 0
            visible_lines.append("\n")
            continue
        if fence_char is None:
            visible_lines.append(INLINE_CODE_RE.sub(" ", line))
        else:
            visible_lines.append("\n")
    return {int(match.group(1)) for match in TASK_REFERENCE_RE.finditer("".join(visible_lines))}


async def sync_references(
    db: AsyncSession,
    *,
    project_id: int,
    source_type: SourceType,
    source_id: int,
    source_task_id: int,
    text: str,
    actor_id: int,
) -> None:
    """Replace the normalized references for one description or comment."""
    await db.execute(
        delete(TaskReference).where(
            TaskReference.source_type == source_type,
            TaskReference.source_id == source_id,
        )
    )
    candidate_ids = extract_task_reference_ids(text) - {source_task_id}
    if not candidate_ids:
        return
    result = await db.execute(
        select(Task.id).where(
            Task.project_id == project_id,
            Task.id.in_(candidate_ids),
        )
    )
    for target_task_id in sorted(result.scalars().all()):
        db.add(
            TaskReference(
                source_type=source_type,
                source_id=source_id,
                source_task_id=source_task_id,
                target_task_id=target_task_id,
                created_by_id=actor_id,
            )
        )


async def delete_comment_references(db: AsyncSession, comment_id: int) -> None:
    await db.execute(
        delete(TaskReference).where(
            TaskReference.source_type == "comment",
            TaskReference.source_id == comment_id,
        )
    )


def _task_out(task: Task, status: TaskStatus) -> TaskReferenceTaskOut:
    return TaskReferenceTaskOut(
        id=task.id,
        project_id=task.project_id,
        parent_task_id=task.parent_task_id,
        title=task.title,
        status_id=status.id,
        status_name=status.name,
        status_color=status.color,
        is_completed=task.is_completed,
    )


async def suggest_tasks(
    project_id: int,
    user: User,
    db: AsyncSession,
    *,
    query: str,
    exclude_task_id: int | None,
    limit: int,
) -> list[TaskReferenceTaskOut]:
    await ensure_project_member(project_id, user, db)
    filters = [Task.project_id == project_id]
    if exclude_task_id is not None:
        filters.append(Task.id != exclude_task_id)
    term = query.strip()
    if term:
        matchers = [Task.title.ilike(f"%{_escape_like(term)}%", escape="\\")]
        if term.isdigit():
            matchers.append(Task.id == int(term))
        filters.append(or_(*matchers))
    result = await db.execute(
        select(Task, TaskStatus)
        .join(TaskStatus, Task.status_id == TaskStatus.id)
        .where(*filters)
        .order_by(Task.is_completed, Task.updated_at.desc(), Task.id.desc())
        .limit(limit)
    )
    return [_task_out(task, status) for task, status in result.all()]


async def get_references(
    project_id: int,
    task_id: int,
    user: User,
    db: AsyncSession,
) -> TaskReferencesOut:
    await ensure_project_member(project_id, user, db)
    await ensure_task_in_project(project_id, task_id, db)

    outgoing_result = await db.execute(
        select(TaskReference, Task, TaskStatus)
        .join(Task, Task.id == TaskReference.target_task_id)
        .join(TaskStatus, Task.status_id == TaskStatus.id)
        .where(TaskReference.source_task_id == task_id)
        .order_by(TaskReference.id)
    )
    incoming_result = await db.execute(
        select(TaskReference, Task, TaskStatus)
        .join(Task, Task.id == TaskReference.source_task_id)
        .join(TaskStatus, Task.status_id == TaskStatus.id)
        .where(TaskReference.target_task_id == task_id)
        .order_by(Task.updated_at.desc(), TaskReference.id.desc())
    )

    def item(reference: TaskReference, task: Task, status: TaskStatus) -> TaskReferenceItemOut:
        return TaskReferenceItemOut(
            source_type=reference.source_type,
            source_comment_id=reference.source_id if reference.source_type == "comment" else None,
            task=_task_out(task, status),
        )

    return TaskReferencesOut(
        outgoing=[item(reference, task, status) for reference, task, status in outgoing_result.all()],
        incoming=[item(reference, task, status) for reference, task, status in incoming_result.all()],
    )
