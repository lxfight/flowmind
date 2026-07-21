"""multi-assignee support via task_assignees table

Creates the many-to-many association table, migrates existing
Task.assignee_id values into it, then drops the old column.

Revision ID: e5f7a9c1d3e5
Revises: d4e6f8a0b2c4
Create Date: 2026-03-10 00:00:00.000000

"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "e5f7a9c1d3e5"
down_revision: str | Sequence[str] | None = "d4e6f8a0b2c4"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    bind = op.get_bind()
    if "task_assignees" not in sa.inspect(bind).get_table_names():
        op.create_table(
            "task_assignees",
            sa.Column("task_id", sa.Integer(), nullable=False),
            sa.Column("user_id", sa.Integer(), nullable=False),
            sa.Column("assigned_at", sa.DateTime(timezone=True), nullable=True),
            sa.ForeignKeyConstraint(["task_id"], ["tasks.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("task_id", "user_id"),
        )

    # Carry over existing single assignees.
    op.execute(
        "INSERT INTO task_assignees (task_id, user_id) "
        "SELECT id, assignee_id FROM tasks WHERE assignee_id IS NOT NULL"
    )

    # batch mode recreates the table under the hood (required for SQLite).
    with op.batch_alter_table("tasks") as batch_op:
        batch_op.drop_column("assignee_id")


def downgrade() -> None:
    with op.batch_alter_table("tasks") as batch_op:
        batch_op.add_column(
            sa.Column("assignee_id", sa.Integer(), nullable=True)
        )
    with op.batch_alter_table("tasks") as batch_op:
        batch_op.create_foreign_key(
            "fk_tasks_assignee_id_users", "users", ["assignee_id"], ["id"], ondelete="SET NULL"
        )
    # Restore the first assignee (lowest user_id) as the single assignee.
    op.execute(
        "UPDATE tasks SET assignee_id = ("
        "SELECT MIN(user_id) FROM task_assignees WHERE task_assignees.task_id = tasks.id"
        ")"
    )
    op.drop_table("task_assignees")
