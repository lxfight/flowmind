"""add project reports

Revision ID: f8a0b2c4d6e8
Revises: e7a9c1d3f5b7
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "f8a0b2c4d6e8"
down_revision: str | Sequence[str] | None = "e7a9c1d3f5b7"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "project_reports",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("project_id", sa.Integer(), nullable=False),
        sa.Column("report", sa.Text(), nullable=False),
        sa.Column("generated_by", sa.Integer(), nullable=True),
        sa.Column("generated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["generated_by"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_project_reports_id"), "project_reports", ["id"])
    op.create_index(
        "ix_project_reports_project_generated_at",
        "project_reports",
        ["project_id", "generated_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_project_reports_project_generated_at", table_name="project_reports")
    op.drop_index(op.f("ix_project_reports_id"), table_name="project_reports")
    op.drop_table("project_reports")
