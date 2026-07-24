"""add system update audit runs

Revision ID: d1e3f5a7b9c1
Revises: c0d2e4f6a8b0
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "d1e3f5a7b9c1"
down_revision: str | None = "c0d2e4f6a8b0"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "system_update_runs",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("request_id", sa.String(length=64), nullable=False),
        sa.Column("actor_id", sa.Integer(), nullable=False),
        sa.Column("previous_version", sa.String(length=64), nullable=False),
        sa.Column("target_version", sa.String(length=64), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("step", sa.String(length=64), nullable=False),
        sa.Column("progress", sa.Integer(), nullable=False),
        sa.Column("message", sa.Text(), nullable=False),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("backup_path", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["actor_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("request_id"),
    )
    op.create_index(op.f("ix_system_update_runs_id"), "system_update_runs", ["id"])
    op.create_index(op.f("ix_system_update_runs_actor_id"), "system_update_runs", ["actor_id"])
    op.create_index(op.f("ix_system_update_runs_request_id"), "system_update_runs", ["request_id"], unique=True)
    op.create_index(op.f("ix_system_update_runs_status"), "system_update_runs", ["status"])


def downgrade() -> None:
    op.drop_index(op.f("ix_system_update_runs_status"), table_name="system_update_runs")
    op.drop_index(op.f("ix_system_update_runs_request_id"), table_name="system_update_runs")
    op.drop_index(op.f("ix_system_update_runs_actor_id"), table_name="system_update_runs")
    op.drop_index(op.f("ix_system_update_runs_id"), table_name="system_update_runs")
    op.drop_table("system_update_runs")
