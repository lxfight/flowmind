import asyncio
import contextlib
import os
import secrets
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from sqlalchemy import select, text

from app.api import admin, attachments, auth, knowledge, llm, notifications, projects, statuses, task_search, tasks, ws
from app.core.database import Base, async_session_factory, engine

# Columns that older SQLite dev databases may be missing; create_all never
# alters existing tables, so add them manually.
_SQLITE_COLUMN_FALLBACKS = {
    "tasks": [
        ("due_date", "DATETIME"),
        ("due_notified_at", "DATETIME"),
        ("due_overdue_notified_at", "DATETIME"),
    ],
    "llm_chat_sessions": [
        ("awaiting_input", "BOOLEAN NOT NULL DEFAULT 0"),
    ],
    "llm_chat_messages": [
        ("pending_question", "JSON"),
    ],
}


async def _ensure_sqlite_columns(conn) -> None:
    """Best-effort ALTER TABLE ADD COLUMN for SQLite dev databases."""
    if conn.dialect.name != "sqlite":
        return
    for table, columns in _SQLITE_COLUMN_FALLBACKS.items():
        rows = await conn.execute(text(f"PRAGMA table_info({table})"))
        existing = {row[1] for row in rows.fetchall()}
        if not existing:
            continue  # table doesn't exist yet; create_all will handle it
        for name, ddl in columns:
            if name not in existing:
                await conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {name} {ddl}"))


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: enable pgvector extension, then create tables
    async with engine.begin() as conn:
        with contextlib.suppress(Exception):
            # ignore if not PostgreSQL (e.g. SQLite dev mode)
            await conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
        await _ensure_sqlite_columns(conn)
        await conn.run_sync(Base.metadata.create_all)

    # Ensure upload directories exist
    from app.core.paths import get_avatars_dir
    get_avatars_dir()

    # Auto-create default superuser if no users exist
    async with async_session_factory() as db:
        from app.core.security import hash_password
        from app.models.user import User
        result = await db.execute(select(User).limit(1))
        if not result.scalar_one_or_none():
            admin_password = os.environ.get(
                "FLOWMIND_ADMIN_PASSWORD",
                secrets.token_urlsafe(12),
            )
            admin = User(
                username="admin",
                email="admin@flowmind.local",
                hashed_password=hash_password(admin_password),
                display_name="超级管理员",
                is_superuser=True,
                is_approved=True,
                can_create_project=True,
            )
            db.add(admin)
            await db.commit()
            print(f"\n{'='*60}")
            print("  默认超级管理员已创建")
            print("  用户名: admin")
            print(f"  密码:   {admin_password}")
            print("  请登录后立即修改密码!")
            print(f"{'='*60}\n")

    # Start hourly due-date reminder background task
    from app.services.due_reminder import due_reminder_loop
    reminder_task = asyncio.create_task(due_reminder_loop(async_session_factory))

    yield
    # Shutdown
    reminder_task.cancel()
    with contextlib.suppress(asyncio.CancelledError):
        await reminder_task
    await engine.dispose()

app = FastAPI(
    title="FlowMind API",
    description="LLM-powered intelligent task management system",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register routers
app.include_router(auth.router)
app.include_router(admin.router)
app.include_router(projects.router)
app.include_router(tasks.router)
app.include_router(statuses.router)
app.include_router(knowledge.router)
app.include_router(llm.router)
app.include_router(notifications.router)
app.include_router(task_search.router)
app.include_router(attachments.router)
app.include_router(ws.router)

# Serve uploaded files (avatars, etc.)
from app.core.paths import get_upload_dir

upload_dir_path = get_upload_dir()
(upload_dir_path / "avatars").mkdir(parents=True, exist_ok=True)
app.mount("/api/uploads", StaticFiles(directory=str(upload_dir_path)), name="uploads")


@app.get("/api/health")
async def health_check():
    return {"status": "ok", "service": "FlowMind"}
