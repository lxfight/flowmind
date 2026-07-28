"""add milestones and task links

Revision ID: b0d2f4a6c8e0
Revises: a9c1e3f5b7d9
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "b0d2f4a6c8e0"
down_revision: str | Sequence[str] | None = "a9c1e3f5b7d9"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "milestones",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("project_id", sa.Integer(), nullable=False),
        sa.Column("title", sa.String(length=256), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("target_date", sa.Date(), nullable=False),
        sa.Column("owner_id", sa.Integer(), nullable=True),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("created_by", sa.Integer(), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("due_notified_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("overdue_notified_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["owner_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_milestones_id"), "milestones", ["id"])
    op.create_index(
        "ix_milestones_project_status_date",
        "milestones",
        ["project_id", "status", "target_date"],
    )
    op.create_table(
        "milestone_tasks",
        sa.Column("milestone_id", sa.Integer(), nullable=False),
        sa.Column("task_id", sa.Integer(), nullable=False),
        sa.Column("linked_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["milestone_id"], ["milestones.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["task_id"], ["tasks.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("milestone_id", "task_id"),
    )
    op.create_index("ix_milestone_tasks_task_id", "milestone_tasks", ["task_id"])


def downgrade() -> None:
    op.drop_index("ix_milestone_tasks_task_id", table_name="milestone_tasks")
    op.drop_table("milestone_tasks")
    op.drop_index("ix_milestones_project_status_date", table_name="milestones")
    op.drop_index(op.f("ix_milestones_id"), table_name="milestones")
    op.drop_table("milestones")
