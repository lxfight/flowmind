import asyncio
import base64
import hashlib
import ipaddress
import secrets
import socket
from datetime import UTC, datetime
from urllib.parse import urlsplit
from uuid import uuid4

from cryptography.fernet import Fernet, InvalidToken
from fastapi import HTTPException
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.models.integration import DomainEvent, ExternalDelivery, ExternalIntegration
from app.models.project import Project
from app.models.user import User
from app.schemas.integration import ExternalDeliveryOut

EVENT_CATALOG = [
    {"type": "task.created", "label": "任务创建", "group": "任务", "default_enabled": True},
    {"type": "task.updated", "label": "任务更新", "group": "任务", "default_enabled": False},
    {"type": "task.moved", "label": "任务移动", "group": "任务", "default_enabled": False},
    {"type": "task.completed", "label": "任务完成或重开", "group": "任务", "default_enabled": True},
    {"type": "task.deleted", "label": "任务删除", "group": "任务", "default_enabled": True},
    {"type": "comment.created", "label": "新增评论", "group": "协作", "default_enabled": False},
    {"type": "milestone.created", "label": "里程碑创建", "group": "里程碑", "default_enabled": True},
    {"type": "milestone.updated", "label": "里程碑更新", "group": "里程碑", "default_enabled": False},
    {"type": "milestone.completed", "label": "里程碑完成或重开", "group": "里程碑", "default_enabled": True},
    {"type": "milestone.deleted", "label": "里程碑删除", "group": "里程碑", "default_enabled": True},
]
EVENT_TYPES = {item["type"] for item in EVENT_CATALOG}


def _encryption_material() -> str:
    """Return the secret material used to encrypt webhook credentials.

    Prefer INTEGRATION_ENCRYPTION_KEY; fall back to an explicitly configured
    JWT_SECRET. A random auto-generated JWT_SECRET is never used: it changes on
    every restart, which would permanently orphan stored secrets.
    """
    settings = get_settings()
    if settings.integration_encryption_key:
        return settings.integration_encryption_key
    if settings.jwt_secret_is_random:
        raise RuntimeError(
            "INTEGRATION_ENCRYPTION_KEY 未配置，且 JWT_SECRET 为自动生成的随机值。"
            "请设置 INTEGRATION_ENCRYPTION_KEY，否则已保存的 Webhook 密钥在重启后将无法解密。"
        )
    return settings.jwt_secret


def _fernet() -> Fernet:
    digest = hashlib.sha256(_encryption_material().encode("utf-8")).digest()
    return Fernet(base64.urlsafe_b64encode(digest))


def encrypt_secret(secret: str) -> str:
    return _fernet().encrypt(secret.encode("utf-8")).decode("ascii")


def decrypt_secret(encrypted: str) -> str:
    try:
        return _fernet().decrypt(encrypted.encode("ascii")).decode("utf-8")
    except InvalidToken as exc:
        raise RuntimeError("Webhook 签名密钥无法解密，请重新生成密钥") from exc


def generate_signing_secret() -> str:
    return secrets.token_urlsafe(32)


def validate_event_types(event_types: list[str]) -> list[str]:
    unique = list(dict.fromkeys(event_types))
    unknown = sorted(set(unique) - EVENT_TYPES)
    if unknown:
        raise HTTPException(status_code=422, detail=f"不支持的事件类型: {', '.join(unknown)}")
    return unique


async def validate_webhook_url(url: str, *, allow_private_network: bool) -> str:
    value = url.strip()
    parsed = urlsplit(value)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise HTTPException(status_code=422, detail="Webhook 地址必须是有效的 HTTP(S) URL")
    if parsed.username or parsed.password or parsed.fragment:
        raise HTTPException(status_code=422, detail="Webhook 地址不能包含用户凭据或片段")
    if parsed.scheme != "https" and not allow_private_network:
        raise HTTPException(status_code=422, detail="公网 Webhook 必须使用 HTTPS")

    try:
        port = parsed.port or (443 if parsed.scheme == "https" else 80)
        addresses = await asyncio.get_running_loop().getaddrinfo(
            parsed.hostname,
            port,
            type=socket.SOCK_STREAM,
        )
    except (OSError, ValueError) as exc:
        raise HTTPException(status_code=422, detail="Webhook 域名无法解析") from exc

    if not allow_private_network:
        for address in addresses:
            raw_ip = address[4][0].split("%", 1)[0]
            if not ipaddress.ip_address(raw_ip).is_global:
                raise HTTPException(status_code=422, detail="Webhook 地址不能指向内网或本机地址")
    return value


async def get_integration(
    db: AsyncSession,
    project_id: int,
    integration_id: int,
    *,
    include_deleted: bool = False,
) -> ExternalIntegration:
    query = select(ExternalIntegration).where(
        ExternalIntegration.id == integration_id,
        ExternalIntegration.project_id == project_id,
    )
    if not include_deleted:
        query = query.where(ExternalIntegration.deleted_at.is_(None))
    result = await db.execute(query)
    integration = result.scalar_one_or_none()
    if integration is None:
        raise HTTPException(status_code=404, detail="外部集成不存在")
    return integration


async def create_integration(
    db: AsyncSession,
    *,
    project_id: int,
    name: str,
    url: str,
    event_types: list[str],
    is_enabled: bool,
    allow_private_network: bool,
    created_by_id: int,
) -> tuple[ExternalIntegration, str]:
    checked_url = await validate_webhook_url(url, allow_private_network=allow_private_network)
    secret = generate_signing_secret()
    integration = ExternalIntegration(
        project_id=project_id,
        kind="webhook",
        name=name.strip(),
        url=checked_url,
        secret_encrypted=encrypt_secret(secret),
        event_types=validate_event_types(event_types),
        is_enabled=is_enabled,
        allow_private_network=allow_private_network,
        created_by_id=created_by_id,
    )
    db.add(integration)
    await db.flush()
    await db.refresh(integration)
    return integration, secret


async def update_integration(
    db: AsyncSession,
    integration: ExternalIntegration,
    payload: dict,
) -> ExternalIntegration:
    allow_private = payload.get("allow_private_network", integration.allow_private_network)
    if "url" in payload:
        payload["url"] = await validate_webhook_url(payload["url"], allow_private_network=allow_private)
    elif "allow_private_network" in payload:
        await validate_webhook_url(integration.url, allow_private_network=allow_private)
    if "event_types" in payload:
        payload["event_types"] = validate_event_types(payload["event_types"])
    if "name" in payload:
        payload["name"] = payload["name"].strip()
    for field, value in payload.items():
        setattr(integration, field, value)
    await db.flush()
    await db.refresh(integration)
    return integration


async def delete_integration(db: AsyncSession, integration: ExternalIntegration) -> None:
    integration.is_enabled = False
    integration.deleted_at = datetime.now(UTC)
    await db.execute(
        update(ExternalDelivery)
        .where(
            ExternalDelivery.integration_id == integration.id,
            ExternalDelivery.status.in_(["pending", "retrying", "processing"]),
        )
        .values(status="cancelled", locked_at=None)
    )
    await db.flush()


async def emit_domain_event(
    db: AsyncSession,
    *,
    project_id: int,
    event_type: str,
    actor: User | None,
    resource_type: str,
    resource_id: int | None,
    data: dict,
    changes: dict | None = None,
    link: str = "",
) -> DomainEvent:
    if event_type not in EVENT_TYPES:
        raise ValueError(f"Unknown domain event: {event_type}")
    project_name = await db.scalar(select(Project.name).where(Project.id == project_id))
    settings = get_settings()
    public_url = settings.public_app_url.rstrip("/")
    event = DomainEvent(
        id=str(uuid4()),
        project_id=project_id,
        event_type=event_type,
        actor_id=actor.id if actor else None,
        resource_type=resource_type,
        resource_id=resource_id,
        payload={
            "project": {"id": project_id, "name": project_name or f"#{project_id}"},
            "actor": (
                {
                    "id": actor.id,
                    "username": actor.username,
                    "display_name": actor.display_name or actor.username,
                }
                if actor
                else None
            ),
            "resource": {"type": resource_type, "id": resource_id},
            "data": data,
            "changes": changes or {},
            "url": f"{public_url}{link}" if public_url and link else link,
        },
    )
    db.add(event)
    integrations = (
        await db.execute(
            select(ExternalIntegration).where(
                ExternalIntegration.project_id == project_id,
                ExternalIntegration.is_enabled.is_(True),
                ExternalIntegration.deleted_at.is_(None),
            )
        )
    ).scalars()
    for integration in integrations:
        if event_type in integration.event_types:
            db.add(
                ExternalDelivery(
                    id=str(uuid4()),
                    event_id=event.id,
                    integration_id=integration.id,
                )
            )
    return event


async def queue_test_delivery(
    db: AsyncSession,
    *,
    integration: ExternalIntegration,
    actor: User,
) -> ExternalDelivery:
    project_name = await db.scalar(select(Project.name).where(Project.id == integration.project_id))
    event = DomainEvent(
        id=str(uuid4()),
        project_id=integration.project_id,
        event_type="integration.test",
        actor_id=actor.id,
        resource_type="integration",
        resource_id=integration.id,
        payload={
            "project": {"id": integration.project_id, "name": project_name or f"#{integration.project_id}"},
            "actor": {
                "id": actor.id,
                "username": actor.username,
                "display_name": actor.display_name or actor.username,
            },
            "resource": {"type": "integration", "id": integration.id},
            "data": {"message": "FlowMind Webhook 测试通知"},
            "changes": {},
            "url": "",
        },
    )
    delivery = ExternalDelivery(
        id=str(uuid4()),
        event_id=event.id,
        integration_id=integration.id,
    )
    db.add_all([event, delivery])
    await db.flush()
    return delivery


async def list_deliveries(
    db: AsyncSession,
    *,
    project_id: int,
    page: int,
    page_size: int,
    integration_id: int | None,
    status: str | None,
) -> tuple[list[ExternalDeliveryOut], int]:
    filters = [ExternalIntegration.project_id == project_id]
    if integration_id is not None:
        filters.append(ExternalDelivery.integration_id == integration_id)
    if status:
        filters.append(ExternalDelivery.status == status)
    base = (
        select(ExternalDelivery, DomainEvent, ExternalIntegration)
        .join(DomainEvent, DomainEvent.id == ExternalDelivery.event_id)
        .join(ExternalIntegration, ExternalIntegration.id == ExternalDelivery.integration_id)
        .where(*filters)
    )
    total = await db.scalar(select(func.count()).select_from(base.subquery())) or 0
    rows = (
        await db.execute(
            base.order_by(ExternalDelivery.created_at.desc()).offset((page - 1) * page_size).limit(page_size)
        )
    ).all()
    return [
        ExternalDeliveryOut(
            id=delivery.id,
            integration_id=integration.id,
            integration_name=integration.name,
            event_id=event.id,
            event_type=event.event_type,
            resource_type=event.resource_type,
            resource_id=event.resource_id,
            status=delivery.status,
            attempt_count=delivery.attempt_count,
            next_attempt_at=delivery.next_attempt_at,
            last_attempt_at=delivery.last_attempt_at,
            completed_at=delivery.completed_at,
            response_status=delivery.response_status,
            error_message=delivery.error_message,
            created_at=delivery.created_at,
        )
        for delivery, event, integration in rows
    ], total
