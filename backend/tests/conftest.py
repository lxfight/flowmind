import os
import tempfile

# Use a temporary SQLite file so lifespan and test sessions share the same database
test_db_file = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
os.environ.setdefault("DATABASE_URL", f"sqlite+aiosqlite:///{test_db_file.name}")
os.environ.setdefault("JWT_SECRET", "test-jwt-secret-for-ci")
os.environ.setdefault("JWT_ALGORITHM", "HS256")
os.environ.setdefault("FLOWMIND_ADMIN_PASSWORD", "testadmin")
os.environ.setdefault("LLM_API_KEY", "")

import pytest
import pytest_asyncio
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker

from app.core.database import Base, get_db
from app.core.security import hash_password
from app.main import app
from app.models.user import User

engine = create_async_engine(
    os.environ["DATABASE_URL"],
    connect_args={"check_same_thread": False},
)
async_session_factory = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
)

# Replace the app's database engine/session factory so lifespan and tests use the same DB
import app.core.database as db_module
import app.main as main_module

db_module.engine = engine
db_module.async_session_factory = async_session_factory
main_module.engine = engine
main_module.async_session_factory = async_session_factory


async def override_get_db():
    async with async_session_factory() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise


app.dependency_overrides[get_db] = override_get_db


@pytest_asyncio.fixture
async def client():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    with TestClient(app) as tc:
        yield tc

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)


@pytest_asyncio.fixture
async def approved_user():
    """Create an approved user for authentication tests."""
    async with async_session_factory() as session:
        user = User(
            username="approveduser",
            email="approved@example.com",
            hashed_password=hash_password("approvedpass123"),
            display_name="Approved User",
            is_active=True,
            is_approved=True,
            can_create_project=True,
        )
        session.add(user)
        await session.commit()
        await session.refresh(user)
        return user


@pytest.fixture
def anyio_backend():
    return "asyncio"
