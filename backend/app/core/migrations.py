"""Apply Alembic migrations, including adoption of legacy create_all databases."""

import asyncio
from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import inspect, text

from app.core.database import Base, engine


async def _prepare_database() -> tuple[set[str], bool]:
    async with engine.begin() as connection:
        if connection.dialect.name == "postgresql":
            try:
                async with connection.begin_nested():
                    await connection.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
            except Exception:
                # Some managed databases preinstall pgvector but deny CREATE EXTENSION.
                pass
        tables = set(
            await connection.run_sync(lambda sync_conn: inspect(sync_conn).get_table_names())
        )
        has_application_tables = bool({"users", "projects"} & tables)
        if has_application_tables and "alembic_version" not in tables:
            # Older releases created tables from ORM metadata without recording a revision.
            await connection.run_sync(Base.metadata.create_all)
        return tables, has_application_tables


def main() -> None:
    tables, has_application_tables = asyncio.run(_prepare_database())
    config_path = Path(__file__).resolve().parents[2] / "alembic.ini"
    config = Config(str(config_path))

    if has_application_tables and "alembic_version" not in tables:
        command.stamp(config, "7c926fe0db38")
        command.upgrade(config, "head")
    else:
        command.upgrade(config, "head")


if __name__ == "__main__":
    main()
