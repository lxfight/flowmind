"""enforce project membership uniqueness

Revision ID: 3f1b2c4d5e6f
Revises: 7c926fe0db38
"""

from collections.abc import Sequence

from alembic import op

revision: str = "3f1b2c4d5e6f"
down_revision: str | Sequence[str] | None = "7c926fe0db38"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        "DELETE FROM project_members WHERE id NOT IN "
        "(SELECT MIN(id) FROM project_members GROUP BY project_id, user_id)"
    )
    with op.batch_alter_table("project_members") as batch_op:
        batch_op.create_unique_constraint(
            "uq_project_members_project_user",
            ["project_id", "user_id"],
        )


def downgrade() -> None:
    with op.batch_alter_table("project_members") as batch_op:
        batch_op.drop_constraint(
            "uq_project_members_project_user",
            type_="unique",
        )
