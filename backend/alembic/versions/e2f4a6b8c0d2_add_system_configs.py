"""add system_configs table for runtime config overrides

Stores DB-level overrides for whitelisted LLM/embedding/RAG settings
(see app.services.config_service.CONFIG_REGISTRY). Portable types only —
no pgvector-specific columns — so it runs on both SQLite and PostgreSQL.

Revision ID: e2f4a6b8c0d2
Revises: b8c0d2e4f6a8
Create Date: 2026-05-20 00:00:00.000000

"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "e2f4a6b8c0d2"
down_revision: str | Sequence[str] | None = "b8c0d2e4f6a8"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "system_configs",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("key", sa.String(length=128), nullable=False),
        sa.Column("value", sa.Text(), nullable=False),
        sa.Column("is_secret", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.func.now()),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("key", name="uq_system_configs_key"),
    )
    op.create_index("ix_system_configs_key", "system_configs", ["key"])


def downgrade() -> None:
    op.drop_index("ix_system_configs_key", table_name="system_configs")
    op.drop_table("system_configs")
