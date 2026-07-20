from pydantic_settings import BaseSettings, SettingsConfigDict
from functools import lru_cache
import secrets
import os


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    app_name: str = "FlowMind"
    debug: bool = False

    # Database (defaults to SQLite for local dev; override with DATABASE_URL env)
    database_url: str = "sqlite+aiosqlite:///./flowmind_dev.db"

    # JWT
    jwt_secret: str = ""
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 60 * 24  # 24 hours

    # Rate limiting
    rate_limit_login_max: int = 5
    rate_limit_window: int = 60

    # LLM
    llm_api_key: str = ""
    llm_base_url: str = ""
    llm_model: str = "gpt-4o-mini"
    llm_embedding_model: str = "text-embedding-3-small"

    # RAG
    chunk_size: int = 512
    chunk_overlap: int = 64
    top_k_retrieval: int = 5

    # Vector dimensions (text-embedding-3-small = 1536)
    vector_dimension: int = 1536

    # File uploads
    upload_dir: str = "uploads"
    avatar_max_bytes: int = 2 * 1024 * 1024
    knowledge_max_bytes: int = 25 * 1024 * 1024

    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        if not self.jwt_secret:
            self.jwt_secret = secrets.token_urlsafe(32)
            if not os.environ.get("JWT_SECRET") and not kwargs.get("jwt_secret"):
                import sys
                print("\n⚠️  JWT_SECRET 未设置，已自动生成随机密钥。"
                      "生产环境请通过环境变量设置 JWT_SECRET。\n",
                      file=sys.stderr)


@lru_cache()
def get_settings() -> Settings:
    return Settings()
