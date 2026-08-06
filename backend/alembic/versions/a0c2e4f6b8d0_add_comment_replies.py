"""add comment replies

Revision ID: a0c2e4f6b8d0
Revises: e8f0a2b4c6d8
Create Date: 2026-08-06 00:00:00.000000

"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "a0c2e4f6b8d0"
down_revision: str | Sequence[str] | None = "e8f0a2b4c6d8"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("task_comments", schema=None) as batch_op:
        batch_op.add_column(sa.Column("parent_comment_id", sa.Integer(), nullable=True))
        batch_op.create_index(
            batch_op.f("ix_task_comments_parent_comment_id"),
            ["parent_comment_id"],
            unique=False,
        )
        batch_op.create_foreign_key(
            "fk_task_comments_parent_comment_id_task_comments",
            "task_comments",
            ["parent_comment_id"],
            ["id"],
            ondelete="SET NULL",
        )


def downgrade() -> None:
    with op.batch_alter_table("task_comments", schema=None) as batch_op:
        batch_op.drop_constraint(
            "fk_task_comments_parent_comment_id_task_comments", type_="foreignkey"
        )
        batch_op.drop_index(batch_op.f("ix_task_comments_parent_comment_id"))
        batch_op.drop_column("parent_comment_id")
