"""Multi-assignee support: create/update with several assignees, notifications, validation."""
import pytest

from helpers import (
    add_member,
    admin_login,
    create_project,
    register_and_approve,
)


@pytest.mark.asyncio
async def test_multi_assignee_create_notify_and_replace(client):
    admin_headers = admin_login(client)
    alice_id, alice_headers = register_and_approve(client, admin_headers, "alice")
    bob_id, bob_headers = register_and_approve(client, admin_headers, "bob")
    outsider_id, _ = register_and_approve(client, admin_headers, "outsider2")
    project_id, statuses = create_project(client, admin_headers)
    add_member(client, admin_headers, project_id, alice_id)
    add_member(client, admin_headers, project_id, bob_id)

    # Create a task with two assignees; both appear in the output.
    response = client.post(
        f"/api/projects/{project_id}/tasks",
        headers=admin_headers,
        json={
            "title": "多人协作任务",
            "status_id": statuses[0]["id"],
            "assignee_ids": [alice_id, bob_id],
        },
    )
    assert response.status_code == 201, response.text
    task = response.json()
    assert sorted(u["id"] for u in task["assignees"]) == sorted([alice_id, bob_id])

    # Both assignees get a task_assigned notification.
    for headers in (alice_headers, bob_headers):
        listing = client.get("/api/notifications", headers=headers).json()
        assert any(n["type"] == "task_assigned" for n in listing["items"]), listing

    # Assignee list filter matches tasks where the user is among assignees.
    response = client.get(
        f"/api/projects/{project_id}/tasks",
        headers=admin_headers,
        params={"assignee_id": bob_id},
    )
    assert response.status_code == 200
    assert any(t["id"] == task["id"] for t in response.json()["items"])

    # Updating assignees replaces the set (alice removed, bob kept, admin added).
    admin_id = None
    for u in client.get("/api/admin/users", headers=admin_headers).json()["items"]:
        if u["username"] == "admin":
            admin_id = u["id"]
    assert admin_id is not None
    response = client.put(
        f"/api/projects/{project_id}/tasks/{task['id']}",
        headers=admin_headers,
        json={"assignee_ids": [bob_id, admin_id]},
    )
    assert response.status_code == 200, response.text
    assert sorted(u["id"] for u in response.json()["assignees"]) == sorted([bob_id, admin_id])

    # Bob keeps his original notification only (no duplicate task_assigned).
    bob_notifs = client.get("/api/notifications", headers=bob_headers).json()["items"]
    assert sum(1 for n in bob_notifs if n["type"] == "task_assigned") == 1
    # Admin (the actor) is not notified about their own assignment.
    admin_notifs = client.get("/api/notifications", headers=admin_headers).json()["items"]
    assert not any(n["type"] == "task_assigned" for n in admin_notifs)

    # Clearing assignees yields an empty list.
    response = client.put(
        f"/api/projects/{project_id}/tasks/{task['id']}",
        headers=admin_headers,
        json={"assignee_ids": []},
    )
    assert response.status_code == 200, response.text
    assert response.json()["assignees"] == []


@pytest.mark.asyncio
async def test_non_member_assignee_rejected(client):
    admin_headers = admin_login(client)
    member_id, _ = register_and_approve(client, admin_headers, "member1")
    outsider_id, _ = register_and_approve(client, admin_headers, "outsider3")
    project_id, statuses = create_project(client, admin_headers)
    add_member(client, admin_headers, project_id, member_id)

    # Create with a non-member in the list -> 400.
    response = client.post(
        f"/api/projects/{project_id}/tasks",
        headers=admin_headers,
        json={
            "title": "非法指派",
            "status_id": statuses[0]["id"],
            "assignee_ids": [member_id, outsider_id],
        },
    )
    assert response.status_code == 400

    # Update with a non-member -> 400 as well.
    response = client.post(
        f"/api/projects/{project_id}/tasks",
        headers=admin_headers,
        json={"title": "正常任务", "status_id": statuses[0]["id"]},
    )
    task_id = response.json()["id"]
    response = client.put(
        f"/api/projects/{project_id}/tasks/{task_id}",
        headers=admin_headers,
        json={"assignee_ids": [outsider_id]},
    )
    assert response.status_code == 400
