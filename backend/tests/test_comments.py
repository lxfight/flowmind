"""Comment create/list/edit/delete coverage incl. permission rules."""
import pytest
from helpers import (
    add_member,
    admin_login,
    create_project,
    create_task,
    register_and_approve,
)


def _comment(client, headers, project_id, task_id, content="一条评论"):
    response = client.post(
        f"/api/projects/{project_id}/tasks/{task_id}/comments",
        headers=headers,
        json={"content": content},
    )
    assert response.status_code == 201, response.text
    return response.json()


@pytest.mark.asyncio
async def test_comment_create_list_edit_delete_happy_path(client):
    headers = admin_login(client)
    project_id, statuses = create_project(client, headers)
    task = create_task(client, headers, project_id, statuses[0]["id"], "评论任务")

    comment = _comment(client, headers, project_id, task["id"])
    assert comment["content"] == "一条评论"

    response = client.get(
        f"/api/projects/{project_id}/tasks/{task['id']}/comments", headers=headers
    )
    assert response.status_code == 200
    assert [c["id"] for c in response.json()] == [comment["id"]]

    # Author edits own comment
    response = client.patch(
        f"/api/projects/{project_id}/tasks/{task['id']}/comments/{comment['id']}",
        headers=headers,
        json={"content": "编辑后的内容"},
    )
    assert response.status_code == 200, response.text
    assert response.json()["content"] == "编辑后的内容"

    # Author deletes own comment
    response = client.delete(
        f"/api/projects/{project_id}/tasks/{task['id']}/comments/{comment['id']}",
        headers=headers,
    )
    assert response.status_code == 200
    response = client.get(
        f"/api/projects/{project_id}/tasks/{task['id']}/comments", headers=headers
    )
    assert response.json() == []


@pytest.mark.asyncio
async def test_comment_permissions_author_vs_member_vs_admin(client):
    headers = admin_login(client)
    author_id, author_headers = register_and_approve(client, headers, "commentauthor")
    other_id, other_headers = register_and_approve(client, headers, "commentother")
    project_id, statuses = create_project(client, headers)
    add_member(client, headers, project_id, author_id, role="member")
    add_member(client, headers, project_id, other_id, role="member")
    task = create_task(client, headers, project_id, statuses[0]["id"], "权限任务")

    comment = _comment(client, author_headers, project_id, task["id"], "作者的评论")
    url = f"/api/projects/{project_id}/tasks/{task['id']}/comments/{comment['id']}"

    # Non-author regular member cannot edit or delete
    assert client.patch(url, headers=other_headers, json={"content": "篡改"}).status_code == 403
    assert client.delete(url, headers=other_headers).status_code == 403

    # Project admin (superuser owner) may moderate others' comments
    assert client.patch(url, headers=headers, json={"content": "管理员修订"}).status_code == 200
    assert client.delete(url, headers=headers).status_code == 200

    # Editing a missing comment 404s
    assert client.patch(url, headers=headers, json={"content": "x"}).status_code == 404


@pytest.mark.asyncio
async def test_comment_project_admin_member_role_can_moderate(client):
    headers = admin_login(client)
    author_id, author_headers = register_and_approve(client, headers, "cauthor2")
    proj_admin_id, proj_admin_headers = register_and_approve(client, headers, "cadmin2")
    project_id, statuses = create_project(client, headers)
    add_member(client, headers, project_id, author_id, role="member")
    add_member(client, headers, project_id, proj_admin_id, role="admin")
    task = create_task(client, headers, project_id, statuses[0]["id"], "管理任务")

    comment = _comment(client, author_headers, project_id, task["id"], "待审评论")
    url = f"/api/projects/{project_id}/tasks/{task['id']}/comments/{comment['id']}"
    response = client.delete(url, headers=proj_admin_headers)
    assert response.status_code == 200


@pytest.mark.asyncio
async def test_viewer_cannot_comment(client):
    headers = admin_login(client)
    viewer_id, viewer_headers = register_and_approve(client, headers, "commentviewer")
    project_id, statuses = create_project(client, headers)
    add_member(client, headers, project_id, viewer_id, role="viewer")
    task = create_task(client, headers, project_id, statuses[0]["id"], "只读任务")

    response = client.post(
        f"/api/projects/{project_id}/tasks/{task['id']}/comments",
        headers=viewer_headers,
        json={"content": "不应成功"},
    )
    assert response.status_code == 403
    # Viewer can still read comments
    response = client.get(
        f"/api/projects/{project_id}/tasks/{task['id']}/comments",
        headers=viewer_headers,
    )
    assert response.status_code == 200
