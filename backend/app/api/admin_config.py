"""Superuser-only runtime configuration API.

GET    /api/admin/config          — all manageable keys, metadata + effective
                                    values (secrets masked), with source
                                    ("db" override or "env" default).
PUT    /api/admin/config/{key}    — set a DB override (validated against the
                                    whitelist: type + numeric range).
DELETE /api/admin/config/{key}    — clear the DB override, fall back to default.
"""
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.core.security import get_current_superuser
from app.services.config_service import config_service

router = APIRouter(
    prefix="/api/admin/config",
    tags=["admin-config"],
    dependencies=[Depends(get_current_superuser)],
)


class ConfigValueUpdate(BaseModel):
    value: Any  # str | int | float; coerced/validated per key metadata


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


