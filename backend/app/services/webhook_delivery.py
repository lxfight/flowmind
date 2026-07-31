import hashlib
import hmac
import json
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from email.utils import parsedate_to_datetime

import httpx
from sqlalchemy import and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker
from sqlalchemy.orm import selectinload

from app.core.config import get_settings
from app.core.notify import notify_users
from app.models.integration import ExternalDelivery, ExternalIntegration
from app.models.project import Project, ProjectMember
from app.services.integration_service import decrypt_secret, validate_webhook_url

RETRY_DELAYS_SECONDS = (60, 300, 900, 3600, 21600, 86400)


@dataclass
class WebhookJob:
    delivery_id: str
    integration_id: int
    project_id: int
    url: str
    secret_encrypted: str
    allow_private_network: bool
    attempt_count: int
    event_id: str
    event_type: str
    version: int
    occurred_at: datetime
    payload: dict


def sign_webhook(secret: str, timestamp: int, body: bytes) -> str:
    signed = str(timestamp).encode("ascii") + b"." + body
    return hmac.new(secret.encode("utf-8"), signed, hashlib.sha256).hexdigest()


def webhook_body(job: WebhookJob) -> bytes:
    envelope = {
        "id": job.event_id,
        "type": job.event_type,
        "version": job.version,
        "occurred_at": job.occurred_at.isoformat(),
        **job.payload,
    }
    return json.dumps(envelope, ensure_ascii=False, separators=(",", ":")).encode("utf-8")


async def claim_delivery(
    session_factory: async_sessionmaker[AsyncSession],
) -> WebhookJob | None:
    now = datetime.now(UTC)
    stale_before = now - timedelta(minutes=5)
    async with session_factory() as db:
        result = await db.execute(
            select(ExternalDelivery)
            .join(ExternalIntegration)
            .where(
                ExternalIntegration.is_enabled.is_(True),
                ExternalIntegration.deleted_at.is_(None),
                or_(
                    and_(
                        ExternalDelivery.status.in_(["pending", "retrying"]),
                        ExternalDelivery.next_attempt_at <= now,
                    ),
                    and_(
                        ExternalDelivery.status == "processing",
                        ExternalDelivery.locked_at < stale_before,
                    ),
                ),
            )
            .options(
                selectinload(ExternalDelivery.event),
                selectinload(ExternalDelivery.integration),
            )
            .order_by(ExternalDelivery.next_attempt_at, ExternalDelivery.created_at)
            .with_for_update(skip_locked=True)
            .limit(1)
        )
        delivery = result.scalar_one_or_none()
        if delivery is None:
            return None
        delivery.status = "processing"
        delivery.locked_at = now
        delivery.last_attempt_at = now
        delivery.attempt_count += 1
        await db.commit()
        event = delivery.event
        integration = delivery.integration
        return WebhookJob(
            delivery_id=delivery.id,
            integration_id=integration.id,
            project_id=integration.project_id,
            url=integration.url,
            secret_encrypted=integration.secret_encrypted,
            allow_private_network=integration.allow_private_network,
            attempt_count=delivery.attempt_count,
            event_id=event.id,
            event_type=event.event_type,
            version=event.version,
            occurred_at=event.occurred_at,
            payload=event.payload,
        )


def _retry_after(response: httpx.Response, now: datetime) -> int | None:
    value = response.headers.get("retry-after", "").strip()
    if not value:
        return None
    try:
        return max(0, min(int(value), 86400))
    except ValueError:
        try:
            retry_at = parsedate_to_datetime(value)
            if retry_at.tzinfo is None:
                retry_at = retry_at.replace(tzinfo=UTC)
            return max(0, min(int((retry_at - now).total_seconds()), 86400))
        except (TypeError, ValueError, OverflowError):
            return None


def _retryable_status(status_code: int) -> bool:
    return status_code in {408, 409, 425, 429} or status_code >= 500


async def _project_admin_ids(db: AsyncSession, project_id: int) -> set[int]:
    owner_id = await db.scalar(select(Project.owner_id).where(Project.id == project_id))
    member_ids = (
        await db.execute(
            select(ProjectMember.user_id).where(
                ProjectMember.project_id == project_id,
                ProjectMember.role.in_(["owner", "admin"]),
            )
        )
    ).scalars()
    return ({owner_id} if owner_id else set()) | set(member_ids)


async def record_result(
    session_factory: async_sessionmaker[AsyncSession],
    job: WebhookJob,
    *,
    success: bool,
    response_status: int | None,
    error_message: str,
    retry_after_seconds: int | None = None,
    retryable: bool = True,
) -> None:
    now = datetime.now(UTC)
    settings = get_settings()
    async with session_factory() as db:
        delivery = await db.get(ExternalDelivery, job.delivery_id)
        integration = await db.get(ExternalIntegration, job.integration_id)
        if delivery is None or integration is None:
            return
        delivery.locked_at = None
        delivery.response_status = response_status
        delivery.error_message = error_message[:1000]
        if success:
            delivery.status = "succeeded"
            delivery.completed_at = now
            integration.consecutive_failures = 0
            integration.last_success_at = now
            await db.commit()
            return

        integration.consecutive_failures += 1
        integration.last_failure_at = now
        maxed_out = delivery.attempt_count >= settings.webhook_max_attempts
        auto_paused = integration.consecutive_failures >= settings.webhook_auto_pause_failures
        if retryable and not maxed_out and not auto_paused:
            delay_index = min(max(delivery.attempt_count - 1, 0), len(RETRY_DELAYS_SECONDS) - 1)
            delay = retry_after_seconds if retry_after_seconds is not None else RETRY_DELAYS_SECONDS[delay_index]
            delivery.status = "retrying"
            delivery.next_attempt_at = now + timedelta(seconds=delay)
        else:
            delivery.status = "failed"
            delivery.completed_at = now

        if auto_paused and integration.is_enabled:
            integration.is_enabled = False
            recipients = await _project_admin_ids(db, integration.project_id)
            await notify_users(
                db,
                recipients,
                type="integration_paused",
                title=f"外部集成「{integration.name}」已自动暂停",
                body="Webhook 连续投递失败，请检查地址或接收服务后重新启用。",
                link=f"/project/{integration.project_id}/integrations",
            )
        await db.commit()


async def process_next_delivery(
    session_factory: async_sessionmaker[AsyncSession],
    client: httpx.AsyncClient,
) -> bool:
    job = await claim_delivery(session_factory)
    if job is None:
        return False
    try:
        await validate_webhook_url(job.url, allow_private_network=job.allow_private_network)
        secret = decrypt_secret(job.secret_encrypted)
        body = webhook_body(job)
        timestamp = int(datetime.now(UTC).timestamp())
        response = await client.post(
            job.url,
            content=body,
            headers={
                "Content-Type": "application/json",
                "User-Agent": "FlowMind-Webhook/1.0",
                "X-FlowMind-Event": job.event_type,
                "X-FlowMind-Delivery": job.delivery_id,
                "X-FlowMind-Timestamp": str(timestamp),
                "X-FlowMind-Signature": f"v1={sign_webhook(secret, timestamp, body)}",
            },
        )
        if 200 <= response.status_code < 300:
            await record_result(
                session_factory,
                job,
                success=True,
                response_status=response.status_code,
                error_message="",
            )
        else:
            await record_result(
                session_factory,
                job,
                success=False,
                response_status=response.status_code,
                error_message=f"HTTP {response.status_code}",
                retry_after_seconds=_retry_after(response, datetime.now(UTC)),
                retryable=_retryable_status(response.status_code),
            )
    except httpx.RequestError as exc:
        await record_result(
            session_factory,
            job,
            success=False,
            response_status=None,
            error_message=f"{type(exc).__name__}: {exc}",
        )
    except Exception as exc:
        await record_result(
            session_factory,
            job,
            success=False,
            response_status=None,
            error_message=str(exc),
            retryable=False,
        )
    return True
