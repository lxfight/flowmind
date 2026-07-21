"""Tasks CRUD + kanban move endpoint coverage."""
import pytest
from helpers import (
    add_member,
    admin_login,
    create_project,
    create_task,
    register_and_approve,
)


@pytest.mark.asyncio
async def test_task_crud_and_kanban_move(client):
    headers = admin_login(client)
    project_id, statuses = create_project(client, headers)
    first, second = statuses[0], statuses[1]

    task = create_task(client, headers, project_id, first["id"], "看板任务")
    task_id = task["id"]
    assert task["status_id"] == first["id"]

    response = client.get(
        f"/api/projects/{project_id}/tasks/{task_id}", headers=headers
    )
    assert response.status_code == 200
    assert response.json()["title"] == "看板任务"

    response = client.put(
        f"/api/projects/{project_id}/tasks/{task_id}",
        headers=headers,
        json={"title": "改名后的任务", "description": "详情", "priority": 2},
    )
    assert response.status_code == 200, response.text
    assert response.json()["title"] == "改名后的任务"

    # Move between status columns (kanban drag)
    response = client.patch(
        f"/api/projects/{project_id}/tasks/{task_id}/move",
        headers=headers,
        json={"status_id": second["id"], "order": 0},
    )
    assert response.status_code == 200, response.text
    assert response.json()["status_id"] == second["id"]

    # List filtered by status reflects the move
    response = client.get(
        f"/api/projects/{project_id}/tasks",
        headers=headers,
        params={"status_id": second["id"]},
    )
    assert [t["id"] for t in response.json()["items"]] == [task_id]
    response = client.get(
        f"/api/projects/{project_id}/tasks",
        headers=headers,
        params={"status_id": first["id"]},
    )
    assert response.json()["items"] == []

    # Delete then 404
    response = client.delete(
        f"/api/projects/{project_id}/tasks/{task_id}", headers=headers
    )
    assert response.status_code == 200
    response = client.get(
        f"/api/projects/{project_id}/tasks/{task_id}", headers=headers
    )
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_task_permissions_for_member_and_outsider(client):
    headers = admin_login(client)
    member_id, member_headers = register_and_approve(client, headers, "taskmember")
    _, outsider_headers = register_and_approve(client, headers, "taskoutsider")
    project_id, statuses = create_project(client, headers)
    add_member(client, headers, project_id, member_id, role="member")

    # Outsider cannot read or create
    response = client.get(f"/api/projects/{project_id}/tasks", headers=outsider_headers)
    assert response.status_code == 403
    response = client.post(
        f"/api/projects/{project_id}/tasks",
        headers=outsider_headers,
        json={"title": "越权", "status_id": statuses[0]["id"]},
    )
    assert response.status_code == 403

    # Member can create and update but not delete
    task = create_task(client, member_headers, project_id, statuses[0]["id"], "成员任务")
    response = client.put(
        f"/api/projects/{project_id}/tasks/{task['id']}",
        headers=member_headers,
        json={"title": "成员更新"},
    )
    assert response.status_code == 200
    response = client.delete(
        f"/api/projects/{project_id}/tasks/{task['id']}", headers=member_headers
    )
    assert response.status_code == 403


@pytest.mark.asyncio
async def test_move_rejects_invalid_status_and_subtask_constraint(client):
    headers = admin_login(client)
    project_id, statuses = create_project(client, headers)
    parent = create_task(client, headers, project_id, statuses[0]["id"], "父任务")

    # Unknown status id
    response = client.patch(
        f"/api/projects/{project_id}/tasks/{parent['id']}/move",
        headers=headers,
        json={"status_id": 999999, "order": 0},
    )
    assert response.status_code == 404

    # Subtask cannot move to a column different from its parent
    response = client.post(
        f"/api/projects/{project_id}/tasks",
        headers=headers,
        json={
            "title": "子任务",
            "status_id": statuses[0]["id"],
            "parent_task_id": parent["id"],
        },
    )
    sub_id = response.json()["id"]
    response = client.patch(
        f"/api/projects/{project_id}/tasks/{sub_id}/move",
        headers=headers,
        json={"status_id": statuses[1]["id"], "order": 0},
    )
    assert response.status_code == 400
