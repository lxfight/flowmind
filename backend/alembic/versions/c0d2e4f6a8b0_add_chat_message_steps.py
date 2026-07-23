"""persist agent reasoning and tool steps on chat messages

Revision ID: c0d2e4f6a8b0
Revises: fa1b2c3d4e5f
Create Date: 2026-07-23 12:00:00.000000
"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "c0d2e4f6a8b0"
down_revision: str | Sequence[str] | None = "fa1b2c3d4e5f"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("llm_chat_messages") as batch_op:
        batch_op.add_column(sa.Column("steps", sa.JSON(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("llm_chat_messages") as batch_op:
        batch_op.drop_column("steps")
