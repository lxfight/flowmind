"""Due-date reminder scanning: notifies assignees about upcoming/overdue tasks.

Used by the hourly background loop started in the FastAPI lifespan, and
directly by tests. All functions swallow nothing themselves except the loop
wrapper; callers own the transaction.
"""

import asyncio
import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.notify import create_notification
from app.models.task import Task

logger = logging.getLogger("flowmind.due_reminder")

DUE_SOON_WINDOW = timedelta(hours=24)
SCAN_INTERVAL_SECONDS = 3600


def _as_utc(dt: datetime) -> datetime:
    """SQLite returns naive datetimes even for timezone=True columns."""
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


async def scan_due_tasks(db: AsyncSession, now: datetime | None = None) -> dict:
    """Send due_soon / due_overdue notifications for eligible tasks.

    Returns counters, e.g. {"due_soon": 2, "due_overdue": 1}.
    """
    now = now or datetime.now(timezone.utc)
    soon_threshold = now + DUE_SOON_WINDOW

    result = await db.execute(
        select(Task)
        .options(selectinload(Task.assignees))
        .where(
            Task.due_date.isnot(None),
            Task.is_completed.is_(False),
            Task.assignees.any(),
            (Task.due_notified_at.is_(None))
            | (Task.due_overdue_notified_at.is_(None)),
        )
    )
    counters = {"due_soon": 0, "due_overdue": 0}
    for task in result.scalars().all():
        due = _as_utc(task.due_date)
        link = f"/project/{task.project_id}/board"
        if due < now:
            if task.due_overdue_notified_at is not None:
                continue
            for assignee in task.assignees:
                await create_notification(
                    db,
                    user_id=assignee.id,
                    type="due_overdue",
                    title="任务已逾期",
                    body=f"任务「{task.title}」已超过截止时间，请尽快处理。",
                    link=link,
                )
            task.due_overdue_notified_at = now
            counters["due_overdue"] += 1
        elif due <= soon_threshold:
            if task.due_notified_at is not None:
                continue
            for assignee in task.assignees:
                await create_notification(
                    db,
                    user_id=assignee.id,
                    type="due_soon",
                    title="任务即将到期",
                    body=f"任务「{task.title}」将在 24 小时内到期（{due.strftime('%Y-%m-%d %H:%M')} UTC）。",
                    link=link,
                )
            task.due_notified_at = now
            counters["due_soon"] += 1
    await db.flush()
    return counters


async def due_reminder_loop(session_factory, interval: int = SCAN_INTERVAL_SECONDS) -> None:
    """Hourly scan loop. Never lets an exception kill the loop."""
    while True:
        try:
            async with session_factory() as db:
                counters = await scan_due_tasks(db)
                await db.commit()
                if counters["due_soon"] or counters["due_overdue"]:
                    logger.info("due reminders sent: %s", counters)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("due reminder scan failed")
        await asyncio.sleep(interval)
