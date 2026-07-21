"""Shared @mention parsing and notification fan-out.

Used by task comments and the LLM agent chat: any ``@username`` token in
user-authored text resolves to project members, who then receive a
"mention" notification. Unknown names are silently ignored; text without
an ``@`` costs nothing (the regex set is empty and we return early).
"""
import re

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.notify import create_notification
from app.models.project import ProjectMember
from app.models.user import User

MENTION_RE = re.compile(r"@([A-Za-z0-9_.-]+)")


def board_link(project_id: int) -> str:
    return f"/project/{project_id}/board"


async def notify_mentions(
    db: AsyncSession,
    *,
    project_id: int,
    actor: User,
    text: str,
    title: str,
    body: str,
    link: str,
) -> set[int]:
    """Notify project members mentioned as ``@username`` in ``text``.

    The actor never notifies themselves; each user is notified at most
    once per call. Returns the set of notified user ids so callers can
    exclude them from other notification fan-outs.
    """
    usernames = set(MENTION_RE.findall(text))
    if not usernames:
        return set()
    result = await db.execute(
        select(User)
        .join(ProjectMember, ProjectMember.user_id == User.id)
        .where(
            User.username.in_(usernames),
            ProjectMember.project_id == project_id,
        )
    )
    notified: set[int] = set()
    for mentioned in result.scalars().all():
        if mentioned.id == actor.id or mentioned.id in notified:
            continue
        notified.add(mentioned.id)
        await create_notification(
            db,
            user_id=mentioned.id,
            type="mention",
            title=title,
            body=body,
            link=link,
        )
    return notified
