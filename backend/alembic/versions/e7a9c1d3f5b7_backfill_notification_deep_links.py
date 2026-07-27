"""backfill notification deep links

Revision ID: e7a9c1d3f5b7
Revises: d1e3f5a7b9c1
"""

import re
from collections import defaultdict
from collections.abc import Sequence
from datetime import datetime

import sqlalchemy as sa

from alembic import op

revision: str = "e7a9c1d3f5b7"
down_revision: str | None = "d1e3f5a7b9c1"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

BOARD_LINK_RE = re.compile(r"^/project/(\d+)/board$")
TASK_IN_BODY_RE = re.compile(r"^任务「(.*)」(?:：|已超过|将在)")
TASK_IN_COMMENT_TITLE_RE = re.compile(r"评论了任务「(.*)」$")


def _task_title(notification_type: str, title: str, body: str) -> str | None:
    if notification_type == "task_assigned" and body.startswith("任务："):
        return body.removeprefix("任务：")
    if notification_type in {"mention", "due_soon", "due_overdue"}:
        match = TASK_IN_BODY_RE.match(body)
        return match.group(1) if match else None
    if notification_type == "comment":
        match = TASK_IN_COMMENT_TITLE_RE.search(title)
        return match.group(1) if match else None
    return None


def _comment_excerpt(notification_type: str, body: str) -> str | None:
    if notification_type == "comment":
        return body
    if notification_type == "mention":
        match = TASK_IN_BODY_RE.match(body)
        if match and "」：" in body:
            return body.split("」：", 1)[1]
    return None


def _seconds_between(left: datetime, right: datetime) -> float:
    # SQLite may return naive values while PostgreSQL preserves timezone data.
    return abs((left.replace(tzinfo=None) - right.replace(tzinfo=None)).total_seconds())


def upgrade() -> None:
    bind = op.get_bind()
    # Older deployments created this table through metadata.create_all(), but
    # it is absent from the historical Alembic baseline used by fresh installs.
    if not sa.inspect(bind).has_table("notifications"):
        return

    notifications = sa.table(
        "notifications",
        sa.column("id", sa.Integer),
        sa.column("type", sa.String),
        sa.column("title", sa.String),
        sa.column("body", sa.Text),
        sa.column("link", sa.String),
        sa.column("created_at", sa.DateTime(timezone=True)),
    )
    tasks = sa.table(
        "tasks",
        sa.column("id", sa.Integer),
        sa.column("project_id", sa.Integer),
        sa.column("title", sa.String),
    )
    comments = sa.table(
        "task_comments",
        sa.column("id", sa.Integer),
        sa.column("task_id", sa.Integer),
        sa.column("content", sa.Text),
        sa.column("created_at", sa.DateTime(timezone=True)),
    )

    tasks_by_title: dict[tuple[int, str], list[int]] = defaultdict(list)
    for row in bind.execute(sa.select(tasks)).mappings():
        tasks_by_title[(row["project_id"], row["title"])].append(row["id"])

    comments_by_task: dict[int, list[sa.RowMapping]] = defaultdict(list)
    for row in bind.execute(sa.select(comments)).mappings():
        comments_by_task[row["task_id"]].append(row)

    relevant_types = ("task_assigned", "comment", "mention", "due_soon", "due_overdue")
    query = sa.select(notifications).where(notifications.c.type.in_(relevant_types))
    for notification in bind.execute(query).mappings():
        board_match = BOARD_LINK_RE.match(notification["link"] or "")
        if not board_match:
            continue
        project_id = int(board_match.group(1))
        task_title = _task_title(
            notification["type"], notification["title"] or "", notification["body"] or ""
        )
        matching_tasks = tasks_by_title.get((project_id, task_title or ""), [])
        if len(matching_tasks) != 1:
            continue

        task_id = matching_tasks[0]
        link = f"/project/{project_id}/board?task={task_id}"
        excerpt = _comment_excerpt(notification["type"], notification["body"] or "")
        if excerpt:
            matching_comments = [
                comment
                for comment in comments_by_task.get(task_id, [])
                if (comment["content"] or "").strip().replace("\n", " ")[:100] == excerpt
                and _seconds_between(comment["created_at"], notification["created_at"]) <= 300
            ]
            if matching_comments:
                closest = min(
                    matching_comments,
                    key=lambda comment: _seconds_between(
                        comment["created_at"], notification["created_at"]
                    ),
                )
                link += f"&comment={closest['id']}"

        bind.execute(
            notifications.update()
            .where(
                notifications.c.id == notification["id"],
                notifications.c.link == notification["link"],
            )
            .values(link=link)
        )


def downgrade() -> None:
    # This is an irreversible data correction; schema state is unchanged.
    pass
