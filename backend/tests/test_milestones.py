"""Project milestone CRUD, permissions, progress, and exclusive task links."""

from datetime import UTC, datetime, timedelta

from helpers import (
    add_member,
    admin_login,
    create_project,
    create_task,
    register_and_approve,
)


def _future_date(days: int = 30) -> str:
    return (datetime.now(UTC).date() + timedelta(days=days)).isoformat()


def _create_milestone(
    client,
    headers,
    project_id: int,
    title: str,
    task_ids=None,
    *,
    days: int = 30,
):
    response = client.post(
        f"/api/projects/{project_id}/milestones",
        headers=headers,
        json={
            "title": title,
            "description": f"{title} 的验收边界",
            "target_date": _future_date(days),
            "task_ids": task_ids or [],
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


def test_timeline_uses_stable_date_cursor_and_skips_history_by_default(client):
    headers = admin_login(client)
    project_id, _ = create_project(client, headers, name="时间线分页项目")
    today = datetime.now(UTC).date()
    past = _create_milestone(client, headers, project_id, "历史节点", days=-3)
    current = _create_milestone(client, headers, project_id, "今日节点", days=0)
    first = _create_milestone(client, headers, project_id, "同日节点 A", days=2)
    second = _create_milestone(client, headers, project_id, "同日节点 B", days=2)

    response = client.get(
        f"/api/projects/{project_id}/milestones/timeline",
        headers=headers,
        params={"anchor_date": today.isoformat(), "limit": 2},
    )
    assert response.status_code == 200, response.text
    page = response.json()
    assert [item["id"] for item in page["items"]] == [current["id"], first["id"]]
    assert page["has_more"] is True
    assert page["has_history"] is True

    response = client.get(
        f"/api/projects/{project_id}/milestones/timeline",
        headers=headers,
        params={
            "anchor_date": today.isoformat(),
            "limit": 2,
            "cursor_date": page["next_cursor_date"],
            "cursor_id": page["next_cursor_id"],
        },
    )
    assert response.status_code == 200, response.text
    assert [item["id"] for item in response.json()["items"]] == [second["id"]]
    assert response.json()["has_more"] is False

    response = client.get(
        f"/api/projects/{project_id}/milestones/timeline",
        headers=headers,
        params={
            "anchor_date": today.isoformat(),
            "direction": "backward",
            "limit": 2,
        },
    )
    assert response.status_code == 200, response.text
    assert [item["id"] for item in response.json()["items"]] == [past["id"]]


def test_task_cannot_belong_to_multiple_milestones(client):
    headers = admin_login(client)
    project_id, statuses = create_project(client, headers, name="多里程碑项目")
    todo = next(status for status in statuses if not status["is_done"])
    task = create_task(client, headers, project_id, todo["id"], "跨阶段任务")

    first = _create_milestone(client, headers, project_id, "方案冻结", [task["id"]])
    response = client.post(
        f"/api/projects/{project_id}/milestones",
        headers=headers,
        json={
            "title": "正式发布",
            "target_date": _future_date(60),
            "task_ids": [task["id"]],
        },
    )
    assert response.status_code == 409
    assert "方案冻结" in response.json()["detail"]
    assert "只能关联一个里程碑" in response.json()["detail"]

    response = client.get(
        f"/api/projects/{project_id}/tasks/{task['id']}", headers=headers
    )
    assert response.status_code == 200, response.text
    assert response.json()["milestone_ids"] == [first["id"]]

    milestones = client.get(
        f"/api/projects/{project_id}/milestones", headers=headers
    )
    assert milestones.status_code == 200, milestones.text
    assert [item["title"] for item in milestones.json()] == ["方案冻结"]
    assert milestones.json()[0]["task_ids"] == [task["id"]]


def test_task_update_replaces_milestone_links(client):
    headers = admin_login(client)
    project_id, statuses = create_project(client, headers, name="任务关联项目")
    todo = next(status for status in statuses if not status["is_done"])
    task = create_task(client, headers, project_id, todo["id"], "待关联任务")
    first = _create_milestone(client, headers, project_id, "第一阶段")
    second = _create_milestone(client, headers, project_id, "第二阶段")

    response = client.put(
        f"/api/projects/{project_id}/tasks/{task['id']}",
        headers=headers,
        json={"milestone_ids": [first["id"], second["id"]]},
    )
    assert response.status_code == 422, response.text

    response = client.put(
        f"/api/projects/{project_id}/tasks/{task['id']}",
        headers=headers,
        json={"milestone_ids": [second["id"]]},
    )
    assert response.status_code == 200, response.text
    assert response.json()["milestone_ids"] == [second["id"]]


def test_milestone_update_cannot_take_task_from_another_milestone(client):
    headers = admin_login(client)
    project_id, statuses = create_project(client, headers, name="里程碑互斥更新")
    todo = next(status for status in statuses if not status["is_done"])
    task = create_task(client, headers, project_id, todo["id"], "独占任务")
    first = _create_milestone(client, headers, project_id, "第一阶段", [task["id"]])
    second = _create_milestone(client, headers, project_id, "第二阶段")

    response = client.put(
        f"/api/projects/{project_id}/milestones/{second['id']}",
        headers=headers,
        json={"task_ids": [task["id"]]},
    )

    assert response.status_code == 409
    assert first["title"] in response.json()["detail"]
    assert "只能关联一个里程碑" in response.json()["detail"]


def test_milestone_progress_and_completion_health(client):
    headers = admin_login(client)
    project_id, statuses = create_project(client, headers, name="里程碑进度项目")
    todo = next(status for status in statuses if not status["is_done"])
    task = create_task(client, headers, project_id, todo["id"], "交付任务")
    milestone = _create_milestone(client, headers, project_id, "交付节点", [task["id"]])
    assert milestone["progress"] == 0
    assert milestone["health"] == "on_track"

    response = client.put(
        f"/api/projects/{project_id}/tasks/{task['id']}",
        headers=headers,
        json={"is_completed": True},
    )
    assert response.status_code == 200, response.text
    response = client.put(
        f"/api/projects/{project_id}/milestones/{milestone['id']}",
        headers=headers,
        json={"status": "completed"},
    )
    assert response.status_code == 200, response.text
    assert response.json()["progress"] == 100
    assert response.json()["health"] == "completed"
    assert response.json()["completed_at"] is not None


def test_milestone_rejects_cross_project_tasks(client):
    headers = admin_login(client)
    project_id, _ = create_project(client, headers, name="本项目")
    other_id, other_statuses = create_project(client, headers, name="其他项目")
    other_todo = next(status for status in other_statuses if not status["is_done"])
    other_task = create_task(client, headers, other_id, other_todo["id"], "越界任务")

    response = client.post(
        f"/api/projects/{project_id}/milestones",
        headers=headers,
        json={
            "title": "非法节点",
            "target_date": _future_date(),
            "task_ids": [other_task["id"]],
        },
    )
    assert response.status_code == 400
    assert "当前项目" in response.json()["detail"]


def test_viewer_can_read_but_cannot_change_milestones(client):
    admin_headers = admin_login(client)
    project_id, _ = create_project(client, admin_headers, name="只读里程碑项目")
    milestone = _create_milestone(client, admin_headers, project_id, "公开节点")
    viewer_id, viewer_headers = register_and_approve(
        client, admin_headers, "milestone_viewer"
    )
    add_member(client, admin_headers, project_id, viewer_id, role="viewer")

    response = client.get(
        f"/api/projects/{project_id}/milestones", headers=viewer_headers
    )
    assert response.status_code == 200, response.text
    assert response.json()[0]["id"] == milestone["id"]

    response = client.put(
        f"/api/projects/{project_id}/milestones/{milestone['id']}",
        headers=viewer_headers,
        json={"title": "无权修改"},
    )
    assert response.status_code == 403


def test_deleting_milestone_keeps_task(client):
    headers = admin_login(client)
    project_id, statuses = create_project(client, headers, name="删除里程碑项目")
    todo = next(status for status in statuses if not status["is_done"])
    task = create_task(client, headers, project_id, todo["id"], "保留任务")
    milestone = _create_milestone(client, headers, project_id, "临时节点", [task["id"]])

    response = client.delete(
        f"/api/projects/{project_id}/milestones/{milestone['id']}", headers=headers
    )
    assert response.status_code == 200, response.text
    response = client.get(
        f"/api/projects/{project_id}/tasks/{task['id']}", headers=headers
    )
    assert response.status_code == 200, response.text
    assert response.json()["milestone_ids"] == []
