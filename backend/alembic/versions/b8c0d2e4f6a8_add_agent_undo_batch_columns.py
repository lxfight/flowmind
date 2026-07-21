"""add agent undo batch columns

Adds action_batch_id to activity_logs and llm_chat_messages plus undone_at
on llm_chat_messages, supporting in-session undo of agent action batches.

Revision ID: b8c0d2e4f6a8
Revises: a7b9c1d3e5f7
Create Date: 2026-03-25 00:00:00.000000

"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b8c0d2e4f6a8"
down_revision: str | Sequence[str] | None = "a7b9c1d3e5f7"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    bind = op.get_bind()

    activity_columns = [c["name"] for c in sa.inspect(bind).get_columns("activity_logs")]
    if "action_batch_id" not in activity_columns:
        with op.batch_alter_table("activity_logs") as batch_op:
            batch_op.add_column(sa.Column("action_batch_id", sa.String(length=64), nullable=True))
            batch_op.create_index("ix_activity_logs_action_batch_id", ["action_batch_id"])

    message_columns = [c["name"] for c in sa.inspect(bind).get_columns("llm_chat_messages")]
    with op.batch_alter_table("llm_chat_messages") as batch_op:
        if "action_batch_id" not in message_columns:
            batch_op.add_column(sa.Column("action_batch_id", sa.String(length=64), nullable=True))
            batch_op.create_index("ix_llm_chat_messages_action_batch_id", ["action_batch_id"])
        if "undone_at" not in message_columns:
            batch_op.add_column(sa.Column("undone_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("llm_chat_messages") as batch_op:
        batch_op.drop_column("undone_at")
        batch_op.drop_index("ix_llm_chat_messages_action_batch_id")
        batch_op.drop_column("action_batch_id")
    with op.batch_alter_table("activity_logs") as batch_op:
        batch_op.drop_index("ix_activity_logs_action_batch_id")
        batch_op.drop_column("action_batch_id")
