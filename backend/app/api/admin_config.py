"""Superuser-only runtime configuration API.

GET    /api/admin/config          — all manageable keys, metadata + effective
                                    values (secrets masked), with source
                                    ("db" override or "env" default).
PUT    /api/admin/config/{key}    — set a DB override (validated against the
                                    whitelist: type + numeric range).
DELETE /api/admin/config/{key}    — clear the DB override, fall back to default.
POST   /api/admin/config/test     — connectivity test: one embedding call and
                                    one chat call using the current (or
                                    request-supplied) credentials, reporting
                                    success/latency/error per probe.
"""
import time
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.core.security import get_current_superuser
from app.services.config_service import MASKED_VALUE, config_service

router = APIRouter(
    prefix="/api/admin/config",
    tags=["admin-config"],
    dependencies=[Depends(get_current_superuser)],
)


class ConfigValueUpdate(BaseModel):
    value: Any  # str | int | float; coerced/validated per key metadata


class ConfigTestRequest(BaseModel):
    """Optional overrides; omitted/masked fields use the effective config.

    Legacy aliases ``api_key`` / ``base_url`` are still accepted and map
    to ``llm_api_key`` / ``llm_base_url``.
    """
    llm_api_key: str | None = None
    llm_base_url: str | None = None
    chat_model: str | None = None
    embedding_api_key: str | None = None
    embedding_base_url: str | None = None
    embedding_model: str | None = None
    # Deprecated aliases kept for backward compatibility.
    api_key: str | None = None
    base_url: str | None = None


class ConfigTestProbe(BaseModel):
    ok: bool
    latency_ms: int | None = None
    error: str | None = None
    base_url: str = ""  # endpoint actually used (default when empty)
    model: str = ""     # model actually used


class ConfigTestResponse(BaseModel):
    embedding: ConfigTestProbe
    chat: ConfigTestProbe


@router.get("")
async def list_configs():
    """List all manageable config items with effective values (secrets masked)."""
    return {"items": await config_service.get_all_effective()}


@router.put("/{key}")
async def update_config(key: str, data: ConfigValueUpdate):
    """Set a runtime DB override for a whitelisted key."""
    try:
        result = await config_service.set(key, data.value)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=422, detail=f"配置值非法: {exc}") from exc
    return {"message": "配置已更新，立即生效", **result}


@router.delete("/{key}")
async def delete_config(key: str):
    """Remove the DB override for a key; it falls back to the env/default value."""
    try:
        removed = await config_service.delete(key)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    if not removed:
        return {"message": "该配置项没有数据库覆盖值", "key": key, "source": "env"}
    return {"message": "已清除覆盖，回落默认值", "key": key, "source": "env"}


def _resolve(*values: str | None) -> str | None:
    """First override that is neither empty nor the masked placeholder."""
    for value in values:
        if value is not None and value != "" and value != MASKED_VALUE:
            return value
    return None


@router.post("/test", response_model=ConfigTestResponse)
async def test_connection(data: ConfigTestRequest):
    """Probe the configured endpoints with one embedding + one chat call.

    Chat uses the LLM credentials; the embedding probe uses the embedding
    credentials, which fall back to the LLM credentials when not set —
    mirroring the runtime resolution (including request-level overrides:
    a request-supplied llm_api_key also backs the embedding probe when no
    embedding_api_key is supplied).
    """
    from openai import AsyncOpenAI

    llm_api_key, llm_base_url, llm_model = await config_service.get_llm_credentials()

    chat_key = _resolve(data.llm_api_key, data.api_key) or llm_api_key
    chat_url = _resolve(data.llm_base_url, data.base_url) or llm_base_url
    chat_model = _resolve(data.chat_model) or llm_model

    # Embedding credentials mirror the runtime fallback rule: a request
    # override wins; otherwise an explicitly configured embedding_* value
    # wins; only when embedding is not configured at all does the chat
    # credential apply (including request-level chat overrides).
    eff_emb_key, emb_key_src = await config_service.get_resolved("embedding_api_key")
    eff_emb_url, emb_url_src = await config_service.get_resolved("embedding_base_url")
    embedding_key = _resolve(data.embedding_api_key) or (
        eff_emb_key if emb_key_src == "embedding_api_key" else chat_key
    )
    embedding_url = _resolve(data.embedding_base_url) or (
        eff_emb_url if emb_url_src == "embedding_base_url" else chat_url
    )
    embedding_model = _resolve(data.embedding_model) or await config_service.get("llm_embedding_model")

    async def probe(api_key: str, base_url: str, model: str, call) -> ConfigTestProbe:
        if not api_key:
            return ConfigTestProbe(
                ok=False, error="API Key 未配置", base_url=base_url, model=model
            )
        client = AsyncOpenAI(
            api_key=api_key,
            base_url=base_url or None,
            timeout=20.0,
            max_retries=0,
        )
        start = time.perf_counter()
        try:
            await call(client)
        except Exception as exc:
            return ConfigTestProbe(
                ok=False,
                latency_ms=int((time.perf_counter() - start) * 1000),
                error=str(exc)[:500],
                base_url=base_url,
                model=model,
            )
        return ConfigTestProbe(
            ok=True,
            latency_ms=int((time.perf_counter() - start) * 1000),
            base_url=base_url,
            model=model,
        )

    embedding_probe = await probe(
        embedding_key, embedding_url, embedding_model,
        lambda client: client.embeddings.create(model=embedding_model, input="ping"),
    )
    chat_probe = await probe(
        chat_key, chat_url, chat_model,
        lambda client: client.chat.completions.create(
            model=chat_model,
            messages=[{"role": "user", "content": "ping"}],
            max_tokens=8,
        ),
    )
    return ConfigTestResponse(embedding=embedding_probe, chat=chat_probe)
