"""add restore_database field to system_update_runs

Tracks whether a rollback operation should restore the database backup.
This allows users to choose between:
- Rolling back application only (keep current database)
- Rolling back both application and database (restore from backup)

Revision ID: fb2c3d4e5f6a
Revises: a0c2e4f6b8d0
Create Date: 2026-08-12 16:00:00.000000

"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'fb2c3d4e5f6a'
down_revision: str | Sequence[str] | None = 'a0c2e4f6b8d0'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table('system_update_runs') as batch_op:
        batch_op.add_column(sa.Column('restore_database', sa.Boolean(), nullable=False, server_default='0'))


def downgrade() -> None:
    with op.batch_alter_table('system_update_runs') as batch_op:
        batch_op.drop_column('restore_database')
