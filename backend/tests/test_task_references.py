"""Task #reference parsing, synchronization, and API coverage."""

from helpers import admin_login, create_project, create_task

from app.services.task_reference_service import extract_task_reference_ids


def test_reference_parser_ignores_markdown_code():
    text = "正文 #12，`示例 #13`\n```text\n#14\n```\n继续 #15"
    assert extract_task_reference_ids(text) == {12, 15}


def test_description_references_sync_and_return_backlinks(client):
    headers = admin_login(client)
    project_id, statuses = create_project(client, headers)
    target = create_task(client, headers, project_id, statuses[0]["id"], "目标任务")
    source = create_task(client, headers, project_id, statuses[0]["id"], "来源任务")

    response = client.put(
        f"/api/projects/{project_id}/tasks/{source['id']}",
        headers=headers,
        json={"description": f"请参考 #{target['id']}，不要解析 `#{source['id']}`"},
    )
    assert response.status_code == 200, response.text

    response = client.get(
        f"/api/projects/{project_id}/tasks/{source['id']}/references",
        headers=headers,
    )
    assert response.status_code == 200, response.text
    assert [(item["task"]["id"], item["source_type"]) for item in response.json()["outgoing"]] == [
        (target["id"], "description")
    ]

    response = client.get(
        f"/api/projects/{project_id}/tasks/{target['id']}/references",
        headers=headers,
    )
    assert response.json()["incoming"][0]["task"]["id"] == source["id"]

    response = client.put(
        f"/api/projects/{project_id}/tasks/{source['id']}",
        headers=headers,
        json={"description": "引用已移除"},
    )
    assert response.status_code == 200
    response = client.get(
        f"/api/projects/{project_id}/tasks/{target['id']}/references",
        headers=headers,
    )
    assert response.json()["incoming"] == []


def test_comment_references_follow_comment_edits_and_delete(client):
    headers = admin_login(client)
    project_id, statuses = create_project(client, headers)
    target = create_task(client, headers, project_id, statuses[0]["id"], "评论目标")
    source = create_task(client, headers, project_id, statuses[0]["id"], "评论来源")

    response = client.post(
        f"/api/projects/{project_id}/tasks/{source['id']}/comments",
        headers=headers,
        json={"content": f"关联 #{target['id']}"},
    )
    assert response.status_code == 201, response.text
    comment_id = response.json()["id"]

    response = client.get(
        f"/api/projects/{project_id}/tasks/{target['id']}/references",
        headers=headers,
    )
    incoming = response.json()["incoming"]
    assert incoming[0]["source_type"] == "comment"
    assert incoming[0]["source_comment_id"] == comment_id

    response = client.patch(
        f"/api/projects/{project_id}/tasks/{source['id']}/comments/{comment_id}",
        headers=headers,
        json={"content": "不再引用"},
    )
    assert response.status_code == 200
    response = client.get(
        f"/api/projects/{project_id}/tasks/{target['id']}/references",
        headers=headers,
    )
    assert response.json()["incoming"] == []


def test_reference_suggestions_and_cross_project_reference_scope(client):
    headers = admin_login(client)
    project_id, statuses = create_project(client, headers, "当前项目")
    target = create_task(client, headers, project_id, statuses[0]["id"], "发布检查清单")
    source = create_task(client, headers, project_id, statuses[0]["id"], "发布任务")
    other_project_id, other_statuses = create_project(client, headers, "其他项目")
    other = create_task(
        client, headers, other_project_id, other_statuses[0]["id"], "其他项目检查清单"
    )

    response = client.get(
        f"/api/projects/{project_id}/tasks/reference-suggestions",
        headers=headers,
        params={"q": "检查", "exclude_task_id": source["id"]},
    )
    assert response.status_code == 200, response.text
    assert [item["id"] for item in response.json()] == [target["id"]]

    response = client.put(
        f"/api/projects/{project_id}/tasks/{source['id']}",
        headers=headers,
        json={"description": f"本项目 #{target['id']}，跨项目 #{other['id']}，自身 #{source['id']}"},
    )
    assert response.status_code == 200
    response = client.get(
        f"/api/projects/{project_id}/tasks/{source['id']}/references",
        headers=headers,
    )
    assert [item["task"]["id"] for item in response.json()["outgoing"]] == [target["id"]]
