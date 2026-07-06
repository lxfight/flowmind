from pydantic_settings import BaseSettings
from functools import lru_cache


class Settings(BaseSettings):
    app_name: str = "FlowMind"
    debug: bool = False

    # Database
    database_url: str = "sqlite+aiosqlite:///./flowmind.db"

    # JWT
    jwt_secret: str = "dev-secret-change-in-production"
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 60 * 24  # 24 hours

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

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"


@lru_cache()
def get_settings() -> Settings:
    return Settings()
