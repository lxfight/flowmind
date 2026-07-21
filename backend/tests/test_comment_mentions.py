"""@mention notifications in task comments.

Mentions resolve only to members of the comment's project; the commenter is
never notified about their own mention.
"""
import pytest
from helpers import (
    add_member,
    admin_login,
    create_project,
    create_task,
    register_and_approve,
)


def _comment(client, headers, project_id, task_id, content):
    response = client.post(
        f"/api/projects/{project_id}/tasks/{task_id}/comments",
        headers=headers,
        json={"content": content},
    )
    assert response.status_code == 201, response.text
    return response.json()


def _notification_types(client, headers):
    response = client.get("/api/notifications", headers=headers)
    assert response.status_code == 200, response.text
    return [n["type"] for n in response.json()["items"]]


@pytest.mark.asyncio
async def test_mention_notifies_project_member(client):
    headers = admin_login(client)
    member_id, member_headers = register_and_approve(client, headers, "mentionmember")
    project_id, statuses = create_project(client, headers)
    add_member(client, headers, project_id, member_id, role="member")
    task = create_task(client, headers, project_id, statuses[0]["id"], "提及任务")

    _comment(client, headers, project_id, task["id"], "请 @mentionmember 看一下这个任务")

    types = _notification_types(client, member_headers)
    assert "mention" in types


@pytest.mark.asyncio
async def test_mention_ignores_non_member(client):
    headers = admin_login(client)
    outsider_id, outsider_headers = register_and_approve(client, headers, "mentionoutsider")
    project_id, statuses = create_project(client, headers)
    task = create_task(client, headers, project_id, statuses[0]["id"], "越权提及任务")

    _comment(client, headers, project_id, task["id"], "随便提一下 @mentionoutsider")

    types = _notification_types(client, outsider_headers)
    assert "mention" not in types


@pytest.mark.asyncio
async def test_mention_does_not_notify_self(client):
    headers = admin_login(client)
    project_id, statuses = create_project(client, headers)
    task = create_task(client, headers, project_id, statuses[0]["id"], "自提及任务")

    # The seeded admin username is "admin"
    _comment(client, headers, project_id, task["id"], "给自己留言 @admin")

    types = _notification_types(client, headers)
    assert "mention" not in types


@pytest.mark.asyncio
async def test_mention_unknown_username_silently_ignored(client):
    headers = admin_login(client)
    project_id, statuses = create_project(client, headers)
    task = create_task(client, headers, project_id, statuses[0]["id"], "未知提及任务")

    comment = _comment(client, headers, project_id, task["id"], "你好 @no_such_user_xyz")
    assert comment["content"] == "你好 @no_such_user_xyz"
