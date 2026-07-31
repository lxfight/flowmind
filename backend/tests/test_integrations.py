import json
from datetime import UTC, datetime

import httpx
import pytest
from conftest import async_session_factory
from helpers import add_member, admin_login, create_project, register_and_approve
from sqlalchemy import func, select

from app.models.integration import DomainEvent, ExternalDelivery, ExternalIntegration
from app.models.task import Task
from app.models.user import User
from app.schemas import TaskCreate
from app.services import task_service
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


@pytest.mark.asyncio
async def test_business_apis_emit_task_comment_and_milestone_events(client):
    headers = admin_login(client)
    project_id, statuses = create_project(client, headers, name="Webhook 业务事件项目")
    all_events = [
        "task.created",
        "task.updated",
        "task.moved",
        "task.completed",
        "task.deleted",
        "comment.created",
        "milestone.created",
        "milestone.updated",
        "milestone.completed",
        "milestone.deleted",
    ]
    _create_webhook(client, headers, project_id, event_types=all_events)

    task_response = client.post(
        f"/api/projects/{project_id}/tasks",
        headers=headers,
        json={"title": "准备发布", "status_id": statuses[0]["id"]},
    )
    assert task_response.status_code == 201, task_response.text
    task = task_response.json()

    update_response = client.put(
        f"/api/projects/{project_id}/tasks/{task['id']}",
        headers=headers,
        json={"title": "准备正式发布"},
    )
    assert update_response.status_code == 200, update_response.text

    done_status = next(status for status in statuses if status["is_done"])
    move_response = client.patch(
        f"/api/projects/{project_id}/tasks/{task['id']}/move",
        headers=headers,
        json={"status_id": done_status["id"], "order": 1000},
    )
    assert move_response.status_code == 200, move_response.text

    comment_response = client.post(
        f"/api/projects/{project_id}/tasks/{task['id']}/comments",
        headers=headers,
        json={"content": "已经部署到预发布环境"},
    )
    assert comment_response.status_code == 201, comment_response.text

    delete_task_response = client.delete(
        f"/api/projects/{project_id}/tasks/{task['id']}", headers=headers
    )
    assert delete_task_response.status_code == 200, delete_task_response.text

    milestone_response = client.post(
        f"/api/projects/{project_id}/milestones",
        headers=headers,
        json={
            "title": "正式发布",
            "description": "",
            "target_date": "2027-01-15",
            "owner_id": None,
            "task_ids": [],
        },
    )
    assert milestone_response.status_code == 201, milestone_response.text
    milestone = milestone_response.json()

    complete_response = client.put(
        f"/api/projects/{project_id}/milestones/{milestone['id']}",
        headers=headers,
        json={"status": "completed"},
    )
    assert complete_response.status_code == 200, complete_response.text
    delete_milestone_response = client.delete(
        f"/api/projects/{project_id}/milestones/{milestone['id']}", headers=headers
    )
    assert delete_milestone_response.status_code == 200, delete_milestone_response.text

    async with async_session_factory() as db:
        events = list(
            (
                await db.execute(
                    select(DomainEvent).where(DomainEvent.project_id == project_id)
                )
            ).scalars()
        )
        assert sorted(event.event_type for event in events) == sorted(all_events)
        assert await db.scalar(
            select(func.count(ExternalDelivery.id)).join(DomainEvent).where(
                DomainEvent.project_id == project_id
            )
        ) == len(all_events)

        updated = next(event for event in events if event.event_type == "task.updated")
        assert updated.payload["changes"]["title"] == {
            "from": "准备发布",
            "to": "准备正式发布",
        }
        completed = next(event for event in events if event.event_type == "task.completed")
        assert completed.payload["changes"]["is_completed"] == {
            "from": False,
            "to": True,
        }
        comment = next(event for event in events if event.event_type == "comment.created")
        assert comment.payload["data"]["task_id"] == task["id"]
        milestone_completed = next(
            event for event in events if event.event_type == "milestone.completed"
        )
        assert milestone_completed.payload["changes"]["status"] == {
            "from": "open",
            "to": "completed",
        }


@pytest.mark.asyncio
async def test_task_and_outbox_roll_back_in_the_same_transaction(client):
    headers = admin_login(client)
    project_id, statuses = create_project(client, headers, name="Webhook 业务回滚项目")
    _create_webhook(client, headers, project_id, event_types=["task.created"])

    async with async_session_factory() as db:
        actor = await db.scalar(select(User).where(User.username == "admin"))
        task = await task_service.create_task(
            project_id,
            TaskCreate(title="随事务回滚", status_id=statuses[0]["id"]),
            actor,
            db,
        )
        assert task.id is not None
        assert await db.scalar(select(func.count(DomainEvent.id))) == 1
        assert await db.scalar(select(func.count(ExternalDelivery.id))) == 1
        await db.rollback()

    async with async_session_factory() as db:
        assert await db.scalar(select(func.count(Task.id))) == 0
        assert await db.scalar(select(func.count(DomainEvent.id))) == 0
        assert await db.scalar(select(func.count(ExternalDelivery.id))) == 0
