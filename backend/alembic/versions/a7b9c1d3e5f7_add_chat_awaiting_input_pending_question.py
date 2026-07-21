"""add awaiting_input to chat sessions and pending_question to chat messages

Supports the structured clarifying-question flow: when the agent asks the
user a question, the question is persisted on the assistant message and the
session is marked as awaiting input until the user replies.

Revision ID: a7b9c1d3e5f7
Revises: f6a8b0d2e4f6
Create Date: 2026-03-18 00:00:00.000000

"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "a7b9c1d3e5f7"
down_revision: str | Sequence[str] | None = "f6a8b0d2e4f6"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    bind = op.get_bind()

    session_columns = [c["name"] for c in sa.inspect(bind).get_columns("llm_chat_sessions")]
    if "awaiting_input" not in session_columns:
        with op.batch_alter_table("llm_chat_sessions") as batch_op:
            batch_op.add_column(
                sa.Column("awaiting_input", sa.Boolean(), nullable=False, server_default=sa.false())
            )

    message_columns = [c["name"] for c in sa.inspect(bind).get_columns("llm_chat_messages")]
    if "pending_question" not in message_columns:
        with op.batch_alter_table("llm_chat_messages") as batch_op:
            batch_op.add_column(sa.Column("pending_question", sa.JSON(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("llm_chat_messages") as batch_op:
        batch_op.drop_column("pending_question")
    with op.batch_alter_table("llm_chat_sessions") as batch_op:
        batch_op.drop_column("awaiting_input")
