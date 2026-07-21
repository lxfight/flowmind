"""add knowledge doc status and error_message

Adds the indexing status machine columns (status, error_message) to
knowledge_docs. All pre-existing docs were synchronously chunked before
this change, so they are marked 'indexed' regardless of chunk count.

NOTE: the pgvector embedding column size is driven by
settings.llm_embedding_dim (default 1536). Changing that value on an
existing deployment requires a manual migration to resize the column.

Revision ID: f6a8b0d2e4f6
Revises: e5f7a9c1d3e5
Create Date: 2026-03-11 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "f6a8b0d2e4f6"
down_revision: Union[str, Sequence[str], None] = "e5f7a9c1d3e5"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    columns = [c["name"] for c in sa.inspect(bind).get_columns("knowledge_docs")]
    with op.batch_alter_table("knowledge_docs") as batch_op:
        if "status" not in columns:
            batch_op.add_column(
                sa.Column("status", sa.String(length=16), nullable=False, server_default="indexed")
            )
        if "error_message" not in columns:
            batch_op.add_column(sa.Column("error_message", sa.Text(), nullable=True))

    # Pre-existing docs were synchronously chunked before the async pipeline
    # existed, so every existing row is considered indexed.
    op.execute("UPDATE knowledge_docs SET status = 'indexed' WHERE status IS NULL OR status = ''")


def downgrade() -> None:
    with op.batch_alter_table("knowledge_docs") as batch_op:
        batch_op.drop_column("error_message")
        batch_op.drop_column("status")
