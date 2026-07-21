from sqlalchemy.ext.asyncio import AsyncSession

from app.models.notification import Notification


async def create_notification(
    db: AsyncSession,
    user_id: int,
    type: str,
    title: str,
    body: str = "",
    link: str = "",
) -> Notification:
    """Insert a notification row for a user.

    Caller is responsible for the surrounding transaction (flush/commit),
    typically via the request-scoped session from get_db().
    """
    notification = Notification(
        user_id=user_id,
        type=type,
        title=title,
        body=body or "",
        link=link or "",
    )
    db.add(notification)
    await db.flush()
    return notification


async def notify_users(
    db: AsyncSession,
    user_ids: set[int] | list[int],
    type: str,
    title: str,
    body: str = "",
    link: str = "",
    exclude_user_id: int | None = None,
) -> None:
    """Notify multiple distinct users, skipping the actor."""
    for uid in set(user_ids):
        if exclude_user_id is not None and uid == exclude_user_id:
            continue
        await create_notification(db, uid, type, title, body, link)
