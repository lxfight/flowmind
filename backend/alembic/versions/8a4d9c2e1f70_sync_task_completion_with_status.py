"""sync task completion with status

Revision ID: 8a4d9c2e1f70
Revises: 3f1b2c4d5e6f
"""

from typing import Sequence, Union

from alembic import op


revision: str = "8a4d9c2e1f70"
down_revision: Union[str, Sequence[str], None] = "3f1b2c4d5e6f"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        """
        UPDATE tasks
        SET is_completed = CASE
                WHEN EXISTS (
                    SELECT 1 FROM task_statuses
                    WHERE task_statuses.id = tasks.status_id
                      AND task_statuses.is_done = TRUE
                ) THEN TRUE
                ELSE FALSE
            END,
            completed_at = CASE
                WHEN EXISTS (
                    SELECT 1 FROM task_statuses
                    WHERE task_statuses.id = tasks.status_id
                      AND task_statuses.is_done = TRUE
                ) THEN COALESCE(completed_at, updated_at, created_at)
                ELSE NULL
            END
        """
    )


def downgrade() -> None:
    # The previous inconsistent completion values cannot be reconstructed.
    pass
