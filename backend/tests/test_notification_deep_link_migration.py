"""Data migration coverage for legacy notification links."""

import importlib.util
from datetime import UTC, datetime, timedelta
from pathlib import Path

import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations


def _load_migration():
    path = (
        Path(__file__).parents[1]
        / "alembic/versions/e7a9c1d3f5b7_backfill_notification_deep_links.py"
    )
    spec = importlib.util.spec_from_file_location("notification_link_migration", path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_backfill_skips_database_without_notifications_table():
    engine = sa.create_engine("sqlite://")

    with engine.begin() as connection:
        migration = _load_migration()
        migration.op = Operations(MigrationContext.configure(connection))
        migration.upgrade()


def test_backfill_notification_deep_links():
    engine = sa.create_engine("sqlite://")
    metadata = sa.MetaData()
    tasks = sa.Table(
        "tasks",
        metadata,
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("project_id", sa.Integer, nullable=False),
        sa.Column("title", sa.String, nullable=False),
    )
    comments = sa.Table(
        "task_comments",
        metadata,
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("task_id", sa.Integer, nullable=False),
        sa.Column("content", sa.Text, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    notifications = sa.Table(
        "notifications",
        metadata,
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("type", sa.String, nullable=False),
        sa.Column("title", sa.String, nullable=False),
        sa.Column("body", sa.Text, nullable=False),
        sa.Column("link", sa.String, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    metadata.create_all(engine)
    now = datetime.now(UTC)

    with engine.begin() as connection:
        connection.execute(
            tasks.insert(),
            [
                {"id": 10, "project_id": 1, "title": "逾期任务"},
                {"id": 11, "project_id": 1, "title": "评论任务"},
                {"id": 12, "project_id": 2, "title": "同名任务"},
                {"id": 13, "project_id": 2, "title": "同名任务"},
            ],
        )
        connection.execute(
            comments.insert(),
            {"id": 21, "task_id": 11, "content": "请 @alice 查看", "created_at": now},
        )
        connection.execute(
            notifications.insert(),
            [
                {
                    "id": 1,
                    "type": "due_overdue",
                    "title": "任务已逾期",
                    "body": "任务「逾期任务」已超过截止时间，请尽快处理。",
                    "link": "/project/1/board",
                    "created_at": now,
                },
                {
                    "id": 2,
                    "type": "mention",
                    "title": "成员在评论中提到了你",
                    "body": "任务「评论任务」：请 @alice 查看",
                    "link": "/project/1/board",
                    "created_at": now + timedelta(seconds=1),
                },
                {
                    "id": 3,
                    "type": "due_soon",
                    "title": "任务即将到期",
                    "body": "任务「同名任务」将在 24 小时内到期。",
                    "link": "/project/2/board",
                    "created_at": now,
                },
            ],
        )

        migration = _load_migration()
        migration.op = Operations(MigrationContext.configure(connection))
        migration.upgrade()

        links = {
            row.id: row.link
            for row in connection.execute(sa.select(notifications.c.id, notifications.c.link))
        }

    assert links[1] == "/project/1/board?task=10"
    assert links[2] == "/project/1/board?task=11&comment=21"
    assert links[3] == "/project/2/board"
