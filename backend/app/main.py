import os
import secrets
from contextlib import asynccontextmanager
from pathlib import Path
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from sqlalchemy import text, select

from app.api import auth, admin, projects, tasks, statuses, knowledge, llm
from app.core.database import engine, Base, async_session_factory
from app.core.config import get_settings


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: enable pgvector extension, then create tables
    async with engine.begin() as conn:
        try:
            await conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
        except Exception:
            pass  # ignore if not PostgreSQL (e.g. SQLite dev mode)
        await conn.run_sync(Base.metadata.create_all)

    # Ensure upload directories exist
    settings = get_settings()
    os.makedirs(os.path.join(settings.upload_dir, "avatars"), exist_ok=True)

    # Auto-create default superuser if no users exist
    async with async_session_factory() as db:
        from app.models.user import User
        from app.core.security import hash_password
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

    yield
    # Shutdown
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

# Serve uploaded files (avatars, etc.)
settings = get_settings()
upload_dir_path = Path(settings.upload_dir)
if not upload_dir_path.is_absolute():
    upload_dir_path = Path(__file__).resolve().parent.parent / upload_dir_path
os.makedirs(upload_dir_path / "avatars", exist_ok=True)
app.mount("/api/uploads", StaticFiles(directory=str(upload_dir_path)), name="uploads")


@app.get("/api/health")
async def health_check():
    return {"status": "ok", "service": "FlowMind"}
