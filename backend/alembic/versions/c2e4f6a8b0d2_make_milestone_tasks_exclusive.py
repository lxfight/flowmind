"""make milestone task links exclusive

Revision ID: c2e4f6a8b0d2
Revises: b0d2f4a6c8e0
"""

from collections.abc import Sequence

from alembic import op

revision: str = "c2e4f6a8b0d2"
down_revision: str | Sequence[str] | None = "b0d2f4a6c8e0"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Keep the earliest delivery target if an older database contains shared tasks.
    op.execute(
        """
        WITH ranked AS (
            SELECT
                mt.milestone_id,
                mt.task_id,
                ROW_NUMBER() OVER (
                    PARTITION BY mt.task_id
                    ORDER BY m.target_date, m.id
                ) AS position
            FROM milestone_tasks AS mt
            JOIN milestones AS m ON m.id = mt.milestone_id
        )
        DELETE FROM milestone_tasks
        WHERE (milestone_id, task_id) IN (
            SELECT milestone_id, task_id
            FROM ranked
            WHERE position > 1
        )
        """
    )
    op.drop_index("ix_milestone_tasks_task_id", table_name="milestone_tasks")
    op.create_index(
        "ix_milestone_tasks_task_id",
        "milestone_tasks",
        ["task_id"],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index("ix_milestone_tasks_task_id", table_name="milestone_tasks")
    op.create_index(
        "ix_milestone_tasks_task_id",
        "milestone_tasks",
        ["task_id"],
        unique=False,
    )
