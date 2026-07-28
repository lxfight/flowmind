"""add project report generation state

Revision ID: a9c1e3f5b7d9
Revises: f8a0b2c4d6e8
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "a9c1e3f5b7d9"
down_revision: str | Sequence[str] | None = "f8a0b2c4d6e8"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "project_report_generations",
        sa.Column("project_id", sa.Integer(), nullable=False),
        sa.Column("generated_by", sa.Integer(), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["generated_by"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("project_id"),
    )


def downgrade() -> None:
    op.drop_table("project_report_generations")
