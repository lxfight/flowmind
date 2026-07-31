import json
from datetime import UTC, datetime

import httpx
import pytest
from conftest import async_session_factory
from helpers import add_member, admin_login, create_project, register_and_approve
from sqlalchemy import func, select

from app.models.integration import DomainEvent, ExternalDelivery, ExternalIntegration
from app.models.user import User
from app.services.integration_service import emit_domain_event
from app.services.webhook_delivery import process_next_delivery, sign_webhook


def _create_webhook(client, headers, project_id: int, **overrides):
    payload = {
        "name": "交付机器人",
        "url": "http://127.0.0.1:9876/webhook",
        "event_types": ["task.created", "milestone.completed"],
        "is_enabled": True,
        "allow_private_network": True,
        **overrides,
    }
    response = client.post(
        f"/api/projects/{project_id}/integrations",
        headers=headers,
        json=payload,
    )
    assert response.status_code == 201, response.text
    return response.json()


@pytest.mark.asyncio
async def test_integration_crud_hides_and_rotates_secret(client):
    headers = admin_login(client)
    project_id, _ = create_project(client, headers, name="Webhook 配置项目")
    created = _create_webhook(client, headers, project_id)

    assert created["signing_secret"]
    assert created["event_types"] == ["task.created", "milestone.completed"]
    listing = client.get(f"/api/projects/{project_id}/integrations", headers=headers)
    assert listing.status_code == 200
    assert "signing_secret" not in listing.json()[0]

    rotated = client.post(
        f"/api/projects/{project_id}/integrations/{created['id']}/rotate-secret",
        headers=headers,
    )
    assert rotated.status_code == 200
    assert rotated.json()["signing_secret"] != created["signing_secret"]

    updated = client.put(
        f"/api/projects/{project_id}/integrations/{created['id']}",
        headers=headers,
        json={"name": "发布通知", "event_types": ["task.created"]},
    )
    assert updated.status_code == 200
    assert updated.json()["name"] == "发布通知"

    deleted = client.delete(
        f"/api/projects/{project_id}/integrations/{created['id']}",
        headers=headers,
    )
    assert deleted.status_code == 200
    assert client.get(f"/api/projects/{project_id}/integrations", headers=headers).json() == []


def test_integration_permissions_and_private_network_guard(client):
    admin_headers = admin_login(client)
    project_id, _ = create_project(client, admin_headers, name="Webhook 权限项目")
    user_id, user_headers = register_and_approve(client, admin_headers, "webhookmember")
    add_member(client, admin_headers, project_id, user_id, role="member")

    response = client.get(f"/api/projects/{project_id}/integrations", headers=user_headers)
    assert response.status_code == 403

    response = client.post(
        f"/api/projects/{project_id}/integrations",
        headers=admin_headers,
        json={
            "name": "不安全地址",
            "url": "https://127.0.0.1/hook",
            "event_types": ["task.created"],
        },
    )
    assert response.status_code == 422
    assert "内网" in response.json()["detail"]


@pytest.mark.asyncio
async def test_domain_event_is_signed_and_delivered(client):
    headers = admin_login(client)
    project_id, _ = create_project(client, headers, name="Webhook 投递项目")
    integration = _create_webhook(client, headers, project_id, event_types=["task.created"])

    async with async_session_factory() as db:
        actor = await db.scalar(select(User).where(User.username == "admin"))
        await emit_domain_event(
            db,
            project_id=project_id,
            event_type="task.created",
            actor=actor,
            resource_type="task",
            resource_id=91,
            data={"id": 91, "title": "准备发布"},
            link=f"/project/{project_id}/board?task=91",
        )
        await db.commit()

    received: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        received.append(request)
        return httpx.Response(204)

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http_client:
        assert await process_next_delivery(async_session_factory, http_client) is True

    assert len(received) == 1
    request = received[0]
    body = request.content
    envelope = json.loads(body)
    assert envelope["type"] == "task.created"
    assert envelope["resource"] == {"type": "task", "id": 91}
    assert envelope["data"]["title"] == "准备发布"
    timestamp = int(request.headers["X-FlowMind-Timestamp"])
    expected = sign_webhook(integration["signing_secret"], timestamp, body)
    assert request.headers["X-FlowMind-Signature"] == f"v1={expected}"

    deliveries = client.get(f"/api/projects/{project_id}/integrations/deliveries", headers=headers)
    assert deliveries.status_code == 200
    item = deliveries.json()["items"][0]
    assert item["status"] == "succeeded"
    assert item["response_status"] == 204
    assert item["attempt_count"] == 1


@pytest.mark.asyncio
async def test_retryable_failure_is_scheduled(client):
    headers = admin_login(client)
    project_id, _ = create_project(client, headers, name="Webhook 重试项目")
    _create_webhook(client, headers, project_id, event_types=["task.created"])

    async with async_session_factory() as db:
        actor = await db.scalar(select(User).where(User.username == "admin"))
        await emit_domain_event(
            db,
            project_id=project_id,
            event_type="task.created",
            actor=actor,
            resource_type="task",
            resource_id=92,
            data={"id": 92, "title": "等待重试"},
        )
        await db.commit()

    async def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(503, headers={"Retry-After": "120"})

    before = datetime.now(UTC)
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http_client:
        assert await process_next_delivery(async_session_factory, http_client) is True

    async with async_session_factory() as db:
        delivery = await db.scalar(select(ExternalDelivery))
        integration = await db.scalar(select(ExternalIntegration))
        assert delivery.status == "retrying"
        assert delivery.response_status == 503
        retry_at = delivery.next_attempt_at
        if retry_at.tzinfo is None:
            retry_at = retry_at.replace(tzinfo=UTC)
        assert (retry_at - before).total_seconds() >= 119
        assert integration.consecutive_failures == 1


@pytest.mark.asyncio
async def test_domain_event_rolls_back_with_business_transaction(client):
    headers = admin_login(client)
    project_id, _ = create_project(client, headers, name="Webhook 回滚项目")
    _create_webhook(client, headers, project_id, event_types=["task.created"])

    async with async_session_factory() as db:
        actor = await db.scalar(select(User).where(User.username == "admin"))
        await emit_domain_event(
            db,
            project_id=project_id,
            event_type="task.created",
            actor=actor,
            resource_type="task",
            resource_id=93,
            data={"id": 93, "title": "不会提交"},
        )
        await db.rollback()

    async with async_session_factory() as db:
        assert await db.scalar(select(func.count(DomainEvent.id))) == 0
        assert await db.scalar(select(func.count(ExternalDelivery.id))) == 0
