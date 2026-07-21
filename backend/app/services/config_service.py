"""Runtime configuration service.

Effective config resolution: DB override (system_configs table) >
environment variable / settings default. Only keys registered in
CONFIG_REGISTRY are manageable at runtime.

All accessors are async because they may hit the database. Results are
cached in-process and the cache is invalidated on every set/delete, so
changes take effect immediately without a restart (single-process
deployments; with multiple workers each worker refreshes on its next
write or restart).
"""
import asyncio
import logging
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, Literal

from sqlalchemy import delete, select

from app.core import database
from app.core.config import get_settings
from app.models.system_config import SystemConfig

logger = logging.getLogger(__name__)
settings = get_settings()

MASKED_VALUE = "******"

ValueKind = Literal["str", "int", "float"]


@dataclass(frozen=True)
class ConfigMeta:
    """Whitelist metadata for one manageable config key."""

    key: str
    label: str
    kind: ValueKind = "str"
    secret: bool = False
    description: str = ""
    minimum: float | None = None
    maximum: float | None = None

    def coerce(self, raw: Any) -> Any:
        """Coerce a raw value (DB string or API input) to the typed value."""
        if self.kind == "int":
            value = int(raw)
        elif self.kind == "float":
            value = float(raw)
        else:
            value = str(raw)
        if isinstance(value, (int, float)) and not isinstance(value, bool):
            if self.minimum is not None and value < self.minimum:
                raise ValueError(f"{self.key} 不能小于 {self.minimum}")
            if self.maximum is not None and value > self.maximum:
                raise ValueError(f"{self.key} 不能大于 {self.maximum}")
        return value


CONFIG_REGISTRY: dict[str, ConfigMeta] = {
    meta.key: meta
    for meta in [
        ConfigMeta(
            "llm_api_key", "LLM API Key", secret=True,
            description="OpenAI 兼容接口的 API Key（chat 专用；embedding 未单独配置时也会用它）",
        ),
        ConfigMeta(
            "llm_base_url", "LLM Base URL",
            description=(
                "OpenAI 兼容接口地址，例如 https://api.openai.com/v1"
                "（chat 专用；embedding 未单独配置时也会用它）"
            ),
        ),
        ConfigMeta(
            "embedding_api_key", "Embedding API Key", secret=True,
            description="向量嵌入接口的 API Key；留空则回退使用 llm_api_key",
        ),
        ConfigMeta(
            "embedding_base_url", "Embedding Base URL",
            description="向量嵌入接口地址；留空则回退使用 llm_base_url",
        ),
        ConfigMeta("llm_model", "Chat 模型", description="对话/Agent 使用的模型名"),
        ConfigMeta("llm_embedding_model", "Embedding 模型", description="向量嵌入使用的模型名"),
        ConfigMeta("embedding_timeout", "Embedding 超时(秒)", kind="float", minimum=5, maximum=180,
                   description="单次 embedding 请求的超时时间，避免接口无响应导致索引永久挂起"),
        ConfigMeta("embedding_max_retries", "Embedding 重试次数", kind="int", minimum=0, maximum=10,
                   description="遇到 429/5xx/网络错误时的指数退避重试次数"),
        ConfigMeta("embedding_retry_base_delay", "Embedding 重试基础延迟(秒)", kind="float",
                   minimum=0.5, maximum=60,
                   description="指数退避的基础延迟，实际等待按 2^n 增长并带随机抖动"),
        ConfigMeta("embedding_concurrency", "Embedding 并发数", kind="int", minimum=1, maximum=10,
                   description="索引时同时进行的 embedding 批量请求数，过高容易触发 429"),
        ConfigMeta("embedding_batch_size", "Embedding 批量大小", kind="int", minimum=1, maximum=64,
                   description="单次 embedding 请求携带的文本块数量"),
        ConfigMeta(
            "llm_embedding_dim", "Embedding 维度", kind="int", minimum=64, maximum=8192,
            description=(
                "仅影响新写入的向量；数据库列宽由建表时的值决定，"
                "修改此项不会改变已有列宽，需要手工迁移调整 vector 列"
            ),
        ),
        ConfigMeta("chunk_size", "分块大小", kind="int", minimum=64, maximum=8192,
                   description="文档分块的最大字符数"),
        ConfigMeta("chunk_overlap", "分块重叠", kind="int", minimum=0, maximum=2048,
                   description="相邻分块之间保留的重叠字符数（实际不超过 chunk_size 的一半）"),
        ConfigMeta("top_k_retrieval", "检索条数", kind="int", minimum=1, maximum=50,
                   description="RAG 检索返回的最大文档块数"),
        ConfigMeta("similarity_threshold", "相似度阈值", kind="float", minimum=0.0, maximum=1.0,
                   description="RAG 向量检索的最低余弦相似度（1 - cosine distance）；关键词强命中的结果不受此阈值过滤"),
        ConfigMeta("knowledge_max_bytes", "知识库文件大小上限", kind="int",
                   minimum=1024, maximum=512 * 1024 * 1024,
                   description="单个上传文件的最大字节数"),
    ]
}

# Keys that fall back to another key when left empty. Resolution rule:
# effective(key) = value(key) if non-empty else value(fallback_key).
CONFIG_FALLBACKS: dict[str, str] = {
    "embedding_api_key": "llm_api_key",
    "embedding_base_url": "llm_base_url",
}


class ConfigService:
    """Reads effective config values (DB override > settings default)."""

    def __init__(self):
        self._cache: dict[str, str] | None = None
        self._lock = asyncio.Lock()

    def invalidate(self) -> None:
        """Drop the in-process cache; the next read reloads from DB."""
        self._cache = None

    async def _db_values(self) -> dict[str, str]:
        async with self._lock:
            if self._cache is None:
                async with database.async_session_factory() as session:
                    result = await session.execute(select(SystemConfig))
                    self._cache = {row.key: row.value for row in result.scalars()}
            return self._cache

    async def get(self, key: str) -> Any:
        """Return the effective typed value for a whitelisted key."""
        meta = CONFIG_REGISTRY.get(key)
        if meta is None:
            raise KeyError(f"未知配置项: {key}")
        raw = (await self._db_values()).get(key)
        if raw is None:
            return getattr(settings, key)
        try:
            return meta.coerce(raw)
        except (TypeError, ValueError):
            logger.warning("配置项 %s 的数据库值非法，已回落默认值: %r", key, raw)
            return getattr(settings, key)

    async def get_resolved(self, key: str) -> tuple[Any, str]:
        """Return (value, source_key) honoring CONFIG_FALLBACKS.

        For keys with a fallback (e.g. embedding_api_key → llm_api_key),
        an empty own value resolves to the fallback key's effective value.
        Keys without a fallback simply return (own value, key).
        """
        value = await self.get(key)
        fallback = CONFIG_FALLBACKS.get(key)
        if fallback and value in (None, ""):
            return await self.get(fallback), fallback
        return value, key

    async def get_llm_credentials(self) -> tuple[str, str, str]:
        """(api_key, base_url, model) for chat completions."""
        api_key = await self.get("llm_api_key")
        base_url = await self.get("llm_base_url")
        model = await self.get("llm_model")
        return api_key or "", base_url or "", model

    async def get_embedding_credentials(self) -> tuple[str, str, str]:
        """(api_key, base_url, model) for embeddings, with llm_* fallback."""
        api_key, _ = await self.get_resolved("embedding_api_key")
        base_url, _ = await self.get_resolved("embedding_base_url")
        model = await self.get("llm_embedding_model")
        return api_key or "", base_url or "", model

    async def get_all_effective(self) -> list[dict]:
        """All whitelisted keys with metadata and effective values.

        Secret values are masked; ``is_set`` tells whether a non-empty
        value is in effect. ``source`` is "db" or "env" (settings default).
        For keys with a fallback (``fallback_key`` is set),
        ``effective_source`` tells which key's value is actually in effect:
        the key itself when configured, otherwise the fallback key.
        """
        db_values = await self._db_values()
        updated_rows: dict[str, datetime] = {}
        async with database.async_session_factory() as session:
            result = await session.execute(select(SystemConfig))
            updated_rows = {row.key: row.updated_at for row in result.scalars()}

        items = []
        for meta in CONFIG_REGISTRY.values():
            raw = db_values.get(meta.key)
            source = "db" if raw is not None else "env"
            try:
                effective = meta.coerce(raw) if raw is not None else getattr(settings, meta.key)
            except (TypeError, ValueError):
                effective = getattr(settings, meta.key)
                source = "env"
            is_set = effective not in (None, "")

            fallback_key = CONFIG_FALLBACKS.get(meta.key)
            effective_source = None
            if fallback_key:
                effective_source = meta.key if is_set else fallback_key

            items.append({
                "key": meta.key,
                "label": meta.label,
                "kind": meta.kind,
                "secret": meta.secret,
                "description": meta.description,
                "value": MASKED_VALUE if (meta.secret and is_set) else effective,
                "is_set": is_set,
                "source": source,
                "fallback_key": fallback_key,
                "effective_source": effective_source,
                "updated_at": updated_rows.get(meta.key).isoformat()
                if meta.key in updated_rows else None,
            })
        return items

    async def set(self, key: str, value: Any) -> dict:
        """Validate and upsert a DB override, then invalidate the cache."""
        meta = CONFIG_REGISTRY.get(key)
        if meta is None:
            raise KeyError(f"未知配置项: {key}")
        coerced = meta.coerce(value)  # raises ValueError on bad type/range
        raw = str(coerced)
        async with database.async_session_factory() as session:
            result = await session.execute(
                select(SystemConfig).where(SystemConfig.key == key)
            )
            row = result.scalar_one_or_none()
            if row is None:
                row = SystemConfig(key=key, value=raw, is_secret=meta.secret)
                session.add(row)
            else:
                row.value = raw
                row.is_secret = meta.secret
                row.updated_at = datetime.now(UTC)
            await session.commit()
        self.invalidate()
        return {"key": key, "source": "db"}

    async def delete(self, key: str) -> bool:
        """Remove a DB override (fall back to settings default)."""
        if key not in CONFIG_REGISTRY:
            raise KeyError(f"未知配置项: {key}")
        async with database.async_session_factory() as session:
            result = await session.execute(
                delete(SystemConfig).where(SystemConfig.key == key)
            )
            await session.commit()
            removed = result.rowcount > 0
        self.invalidate()
        return removed


# Global singleton
config_service = ConfigService()
