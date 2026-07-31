from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.permissions import ensure_project_admin
from app.core.database import get_db
from app.core.security import get_current_user
from app.models.integration import ExternalDelivery, ExternalIntegration
from app.models.user import User
from app.schemas.integration import (
    EventDefinitionOut,
    ExternalDeliveryListOut,
    ExternalIntegrationCreate,
    ExternalIntegrationCreatedOut,
    ExternalIntegrationOut,
    ExternalIntegrationUpdate,
    QueuedDeliveryOut,
    SigningSecretOut,
)
from app.services import integration_service

router = APIRouter(
    prefix="/api/projects/{project_id}/integrations",
    tags=["integrations"],
)


@router.get("/catalog", response_model=list[EventDefinitionOut])
async def event_catalog(
    project_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await ensure_project_admin(project_id, current_user, db)
    return integration_service.EVENT_CATALOG


@router.get("", response_model=list[ExternalIntegrationOut])
async def list_integrations(
    project_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await ensure_project_admin(project_id, current_user, db)
    result = await db.execute(
        select(ExternalIntegration)
        .where(
            ExternalIntegration.project_id == project_id,
            ExternalIntegration.deleted_at.is_(None),
        )
        .order_by(ExternalIntegration.created_at.desc())
    )
    return result.scalars().all()


@router.post("", response_model=ExternalIntegrationCreatedOut, status_code=status.HTTP_201_CREATED)
async def create_integration(
    project_id: int,
    data: ExternalIntegrationCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await ensure_project_admin(project_id, current_user, db)
    if data.allow_private_network and not current_user.is_superuser:
        raise HTTPException(status_code=403, detail="只有系统管理员可以允许内网 Webhook")
    integration, secret = await integration_service.create_integration(
        db,
        project_id=project_id,
        created_by_id=current_user.id,
        **data.model_dump(),
    )
    output = ExternalIntegrationOut.model_validate(integration).model_dump()
    return ExternalIntegrationCreatedOut(**output, signing_secret=secret)


@router.get("/deliveries", response_model=ExternalDeliveryListOut)
async def list_deliveries(
    project_id: int,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=30, ge=1, le=100),
    integration_id: int | None = Query(default=None),
    delivery_status: str | None = Query(
        default=None, alias="status", pattern="^(pending|processing|retrying|succeeded|failed|cancelled)$"
    ),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await ensure_project_admin(project_id, current_user, db)
    items, total = await integration_service.list_deliveries(
        db,
        project_id=project_id,
        page=page,
        page_size=page_size,
        integration_id=integration_id,
        status=delivery_status,
    )
    return ExternalDeliveryListOut(items=items, total=total, page=page, page_size=page_size)


@router.post("/deliveries/{delivery_id}/retry", response_model=QueuedDeliveryOut)
async def retry_delivery(
    project_id: int,
    delivery_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await ensure_project_admin(project_id, current_user, db)
    result = await db.execute(
        select(ExternalDelivery)
        .join(ExternalIntegration)
        .where(
            ExternalDelivery.id == delivery_id,
            ExternalIntegration.project_id == project_id,
        )
    )
    delivery = result.scalar_one_or_none()
    if delivery is None:
        raise HTTPException(status_code=404, detail="投递记录不存在")
    if delivery.status not in {"failed", "cancelled"}:
        raise HTTPException(status_code=409, detail="当前投递状态不能重试")
    integration = await db.get(ExternalIntegration, delivery.integration_id)
    if integration is None or integration.deleted_at is not None:
        raise HTTPException(status_code=409, detail="外部集成已删除")
    if not integration.is_enabled:
        raise HTTPException(status_code=409, detail="请先启用外部集成")
    delivery.status = "pending"
    delivery.next_attempt_at = datetime.now(UTC)
    delivery.completed_at = None
    delivery.error_message = ""
    delivery.response_status = None
    await db.flush()
    return QueuedDeliveryOut(delivery_id=delivery.id)


@router.put("/{integration_id}", response_model=ExternalIntegrationOut)
async def update_integration(
    project_id: int,
    integration_id: int,
    data: ExternalIntegrationUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await ensure_project_admin(project_id, current_user, db)
    integration = await integration_service.get_integration(db, project_id, integration_id)
    payload = data.model_dump(exclude_unset=True)
    if payload.get("allow_private_network") and not current_user.is_superuser:
        raise HTTPException(status_code=403, detail="只有系统管理员可以允许内网 Webhook")
    return await integration_service.update_integration(db, integration, payload)


@router.delete("/{integration_id}")
async def delete_integration(
    project_id: int,
    integration_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await ensure_project_admin(project_id, current_user, db)
    integration = await integration_service.get_integration(db, project_id, integration_id)
    await integration_service.delete_integration(db, integration)
    return {"message": "外部集成已删除"}


@router.post("/{integration_id}/test", response_model=QueuedDeliveryOut, status_code=status.HTTP_202_ACCEPTED)
async def test_integration(
    project_id: int,
    integration_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await ensure_project_admin(project_id, current_user, db)
    integration = await integration_service.get_integration(db, project_id, integration_id)
    if not integration.is_enabled:
        raise HTTPException(status_code=409, detail="请先启用外部集成")
    delivery = await integration_service.queue_test_delivery(db, integration=integration, actor=current_user)
    return QueuedDeliveryOut(delivery_id=delivery.id)


@router.post("/{integration_id}/rotate-secret", response_model=SigningSecretOut)
async def rotate_secret(
    project_id: int,
    integration_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await ensure_project_admin(project_id, current_user, db)
    integration = await integration_service.get_integration(db, project_id, integration_id)
    secret = integration_service.generate_signing_secret()
    integration.secret_encrypted = integration_service.encrypt_secret(secret)
    await db.flush()
    return SigningSecretOut(signing_secret=secret)
