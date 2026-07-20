import asyncio
from logging.config import fileConfig

from sqlalchemy import pool
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import create_async_engine, AsyncEngine

from alembic import context

# Import all models so Base.metadata is populated
import app.models.activity  # noqa: F401
import app.models.knowledge  # noqa: F401
import app.models.llm_chat  # noqa: F401
import app.models.project  # noqa: F401
import app.models.task  # noqa: F401
import app.models.user  # noqa: F401
from app.core.config import get_settings
from app.core.database import Base

settings = get_settings()

# this is the Alembic Config object, which provides
# access to the values within the .ini file in use.
config = context.config

# Interpret the config file for Python logging.
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# Target metadata for autogenerate support
target_metadata = Base.metadata

# Database URL from settings (respects DATABASE_URL env var)
DATABASE_URL = settings.database_url


def run_migrations_offline() -> None:
    """Run migrations in 'offline' mode."""
    url = DATABASE_URL
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        compare_type=True,
    )

    with context.begin_transaction():
        context.run_migrations()


def do_run_migrations(connection: Connection) -> None:
    context.configure(
        connection=connection,
        target_metadata=target_metadata,
        compare_type=True,
    )

    with context.begin_transaction():
        context.run_migrations()


async def run_async_migrations() -> None:
    """Run migrations in 'online' mode with an async engine."""
    connect_args = {}
    if "sqlite" in DATABASE_URL:
        connect_args["check_same_thread"] = False

    engine: AsyncEngine = create_async_engine(
        DATABASE_URL,
        poolclass=pool.NullPool,
        connect_args=connect_args,
    )

    async with engine.connect() as connection:
        await connection.run_sync(do_run_migrations)

    await engine.dispose()


def run_migrations_online() -> None:
    """Run migrations in 'online' mode."""
    asyncio.run(run_async_migrations())


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
