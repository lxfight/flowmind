"""allow null project_id on llm_chat_sessions for cross-project sessions

Cross-project assistant sessions (scope = "all my projects") store
project_id = NULL; single-project sessions keep their project id.

- upgrade: relax the NOT NULL constraint (batch_alter_table keeps this
  compatible with both PostgreSQL and SQLite).
- downgrade: cross-project sessions cannot be represented in the old
  schema, so they are deleted before restoring NOT NULL. Single-project
  sessions are untouched.

Revision ID: fa1b2c3d4e5f
Revises: e2f4a6b8c0d2
Create Date: 2026-07-21 23:05:00.000000

"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'fa1b2c3d4e5f'
down_revision: str | Sequence[str] | None = 'e2f4a6b8c0d2'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table('llm_chat_sessions') as batch_op:
        batch_op.alter_column('project_id', existing_type=sa.Integer(), nullable=True)


def downgrade() -> None:
    # Drop sessions that only exist in the new (nullable) world.
    op.execute("DELETE FROM llm_chat_sessions WHERE project_id IS NULL")
    with op.batch_alter_table('llm_chat_sessions') as batch_op:
        batch_op.alter_column('project_id', existing_type=sa.Integer(), nullable=False)
