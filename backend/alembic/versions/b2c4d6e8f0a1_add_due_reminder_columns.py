"""add due date reminder columns to tasks

Revision ID: b2c4d6e8f0a1
Revises: 8a4d9c2e1f70
Create Date: 2026-03-01 00:00:00.000000

"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b2c4d6e8f0a1"
down_revision: str | Sequence[str] | None = "8a4d9c2e1f70"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    bind = op.get_bind()
    existing = {c["name"] for c in sa.inspect(bind).get_columns("tasks")}
    with op.batch_alter_table("tasks", schema=None) as batch_op:
        if "due_notified_at" not in existing:
            batch_op.add_column(sa.Column("due_notified_at", sa.DateTime(timezone=True), nullable=True))
        if "due_overdue_notified_at" not in existing:
            batch_op.add_column(sa.Column("due_overdue_notified_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("tasks", schema=None) as batch_op:
        batch_op.drop_column("due_overdue_notified_at")
        batch_op.drop_column("due_notified_at")
