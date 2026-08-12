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


@pytest.mark.asyncio
async def test_project_member_can_edit_and_delete_scoped_subtasks(client):
    admin_headers = admin_login(client)
    member_id, member_headers = register_and_approve(client, admin_headers, "subtaskeditor")
    project_id, statuses = create_project(client, admin_headers)
    add_member(client, admin_headers, project_id, member_id, role="member")
    parent = create_task(client, admin_headers, project_id, statuses[0]["id"], "父任务")
    other_parent = create_task(client, admin_headers, project_id, statuses[0]["id"], "其他父任务")

    response = client.post(
        f"/api/projects/{project_id}/tasks",
        headers=member_headers,
        json={
            "title": "待编辑子任务",
            "status_id": statuses[0]["id"],
            "parent_task_id": parent["id"],
        },
    )
    assert response.status_code == 201, response.text
    subtask_id = response.json()["id"]

    response = client.patch(
        f"/api/projects/{project_id}/tasks/{parent['id']}/subtasks/{subtask_id}",
        headers=member_headers,
        json={"title": "已编辑子任务", "is_completed": True},
    )
    assert response.status_code == 200, response.text
    assert response.json()["title"] == "已编辑子任务"
    assert response.json()["is_completed"] is True

    response = client.patch(
        f"/api/projects/{project_id}/tasks/{other_parent['id']}/subtasks/{subtask_id}",
        headers=member_headers,
        json={"title": "越权编辑"},
    )
    assert response.status_code == 404

    response = client.delete(
        f"/api/projects/{project_id}/tasks/{parent['id']}/subtasks/{subtask_id}",
        headers=member_headers,
    )
    assert response.status_code == 200, response.text
    detail = client.get(
        f"/api/projects/{project_id}/tasks/{parent['id']}", headers=member_headers
    )
    assert detail.status_code == 200
    assert detail.json()["subtasks"] == []


@pytest.mark.asyncio
async def test_task_list_search_escapes_like_wildcards(client):
    headers = admin_login(client)
    project_id, statuses = create_project(client, headers, name="通配符搜索")
    base = statuses[0]["id"]

    create_task(client, headers, project_id, base, "100% 完成")
    create_task(client, headers, project_id, base, "a_b 特殊命名")
    create_task(client, headers, project_id, base, "普通任务")

    # '%' is a LIKE wildcard; searching for it must match only the literal task
    response = client.get(
        f"/api/projects/{project_id}/tasks",
        headers=headers,
        params={"search": "100%"},
    )
    assert response.status_code == 200
    titles = [item["title"] for item in response.json()["items"]]
    assert titles == ["100% 完成"]

    # '_' must match literally, not "any single character"
    response = client.get(
        f"/api/projects/{project_id}/tasks",
        headers=headers,
        params={"search": "a_b"},
    )
    assert response.status_code == 200
    titles = [item["title"] for item in response.json()["items"]]
    assert titles == ["a_b 特殊命名"]

    # Backslash is preserved so it cannot escape the LIKE pattern
    response = client.get(
        f"/api/projects/{project_id}/tasks",
        headers=headers,
        params={"search": "\\"},
    )
    assert response.status_code == 200


@pytest.mark.asyncio
async def test_cascade_subtask_status_keeps_completion_consistent(client):
    headers = admin_login(client)
    project_id, statuses = create_project(client, headers)
    done_status = next((s for s in statuses if s["is_done"]), None)
    open_status = next((s for s in statuses if not s["is_done"]), None)
    assert done_status and open_status

    parent = create_task(client, headers, project_id, open_status["id"], "级联父任务")
    response = client.post(
        f"/api/projects/{project_id}/tasks",
        headers=headers,
        json={
            "title": "级联子任务",
            "status_id": open_status["id"],
            "parent_task_id": parent["id"],
        },
    )
    sub_id = response.json()["id"]
    assert response.json()["is_completed"] is False

    # Move the parent into the "done" column — the subtask must follow fully.
    response = client.patch(
        f"/api/projects/{project_id}/tasks/{parent['id']}/move",
        headers=headers,
        json={"status_id": done_status["id"], "order": 0},
    )
    assert response.status_code == 200, response.text

    sub = client.get(
        f"/api/projects/{project_id}/tasks/{sub_id}", headers=headers
    ).json()
    assert sub["status_id"] == done_status["id"]
    assert sub["is_completed"] is True
    assert sub["completed_at"] is not None

    # Move back to an open column — subtask un-completes too.
    response = client.patch(
        f"/api/projects/{project_id}/tasks/{parent['id']}/move",
        headers=headers,
        json={"status_id": open_status["id"], "order": 0},
    )
    assert response.status_code == 200, response.text
    sub = client.get(
        f"/api/projects/{project_id}/tasks/{sub_id}", headers=headers
    ).json()
    assert sub["status_id"] == open_status["id"]
    assert sub["is_completed"] is False
    assert sub["completed_at"] is None


@pytest.mark.asyncio
async def test_cascade_subtask_status_on_parent_put(client):
    headers = admin_login(client)
    project_id, statuses = create_project(client, headers)
    done_status = next((s for s in statuses if s["is_done"]), None)
    open_status = next((s for s in statuses if not s["is_done"]), None)

    parent = create_task(client, headers, project_id, open_status["id"], "PUT 父任务")
    response = client.post(
        f"/api/projects/{project_id}/tasks",
        headers=headers,
        json={
            "title": "PUT 子任务",
            "status_id": open_status["id"],
            "parent_task_id": parent["id"],
        },
    )
    sub_id = response.json()["id"]

    response = client.put(
        f"/api/projects/{project_id}/tasks/{parent['id']}",
        headers=headers,
        json={"status_id": done_status["id"]},
    )
    assert response.status_code == 200, response.text

    sub = client.get(
        f"/api/projects/{project_id}/tasks/{sub_id}", headers=headers
    ).json()
    assert sub["status_id"] == done_status["id"]
    assert sub["is_completed"] is True


@pytest.mark.asyncio
async def test_concurrent_creates_get_distinct_orders(client):
    """Concurrent creates in the same column must not collide on order.

    Serialization relies on Postgres advisory locks; SQLite has no advisory
    locks, so the assertion only applies on Postgres.
    """
    import os

    if "sqlite" in os.environ.get("DATABASE_URL", ""):
        import pytest as _pytest
        _pytest.skip("advisory lock serialization is Postgres-only")

    import asyncio

    headers = admin_login(client)
    project_id, statuses = create_project(client, headers)
    status_id = statuses[0]["id"]

    async def create_one(index):
        response = await asyncio.to_thread(
            client.post,
            f"/api/projects/{project_id}/tasks",
            headers=headers,
            json={"title": f"并发任务 {index}", "status_id": status_id},
        )
        assert response.status_code == 201, response.text
        return response.json()["order"]

    orders = await asyncio.gather(*(create_one(i) for i in range(5)))
    assert len(orders) == len(set(orders)), f"duplicate orders: {orders}"

    # And a list reflects the creation order via the order field.
    response = client.get(
        f"/api/projects/{project_id}/tasks",
        headers=headers,
        params={"status_id": status_id},
    )
    assert response.status_code == 200
    titles = [item["title"] for item in response.json()["items"]]
    assert titles == [f"并发任务 {i}" for i in range(5)]


@pytest.mark.asyncio
async def test_list_tasks_due_overdue_and_soon_filters(client):
    from datetime import UTC, datetime, timedelta

    from conftest import async_session_factory
    from sqlalchemy import select

    from app.models.user import User
    from app.services.task_service import list_tasks

    headers = admin_login(client)
    project_id, statuses = create_project(client, headers, name="截止筛选")
    status_id = statuses[0]["id"]
    now = datetime.now(UTC)

    # Create three tasks, then set their due dates directly.
    overdue_task = create_task(client, headers, project_id, status_id, "已逾期")
    soon_task = create_task(client, headers, project_id, status_id, "今天到期")
    later_task = create_task(client, headers, project_id, status_id, "下月到期")

    async with async_session_factory() as session:
        from app.models.task import Task
        for task_id, due in [
            (overdue_task["id"], now - timedelta(days=2)),
            (soon_task["id"], now + timedelta(hours=6)),
            (later_task["id"], now + timedelta(days=30)),
        ]:
            row = (await session.execute(select(Task).where(Task.id == task_id))).scalar_one()
            row.due_date = due
        await session.commit()

        user = (await session.execute(select(User).where(User.username == "admin"))).scalar_one()

        overdue = await list_tasks(project_id, user, session, due_overdue=True)
        assert [t.id for t in overdue.items] == [overdue_task["id"]]

        soon = await list_tasks(project_id, user, session, due_soon=True)
        assert [t.id for t in soon.items] == [soon_task["id"]]

        both = await list_tasks(project_id, user, session, due_overdue=True, due_soon=True)
        assert {t.id for t in both.items} == {overdue_task["id"], soon_task["id"]}
