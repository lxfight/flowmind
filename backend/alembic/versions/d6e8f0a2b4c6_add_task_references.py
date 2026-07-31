"""add task references

Revision ID: d6e8f0a2b4c6
Revises: c2e4f6a8b0d2
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "d6e8f0a2b4c6"
down_revision: str | Sequence[str] | None = "c2e4f6a8b0d2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "task_references",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("source_type", sa.String(length=16), nullable=False),
        sa.Column("source_id", sa.Integer(), nullable=False),
        sa.Column("source_task_id", sa.Integer(), nullable=False),
        sa.Column("target_task_id", sa.Integer(), nullable=False),
        sa.Column("created_by_id", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["created_by_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["source_task_id"], ["tasks.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["target_task_id"], ["tasks.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "source_type",
            "source_id",
            "target_task_id",
            name="uq_task_references_source_target",
        ),
    )
    op.create_index(op.f("ix_task_references_id"), "task_references", ["id"])
    op.create_index("ix_task_references_source_task_id", "task_references", ["source_task_id"])
    op.create_index("ix_task_references_target_task_id", "task_references", ["target_task_id"])


def downgrade() -> None:
    op.drop_index("ix_task_references_target_task_id", table_name="task_references")
    op.drop_index("ix_task_references_source_task_id", table_name="task_references")
    op.drop_index(op.f("ix_task_references_id"), table_name="task_references")
    op.drop_table("task_references")
