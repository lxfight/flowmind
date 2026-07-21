"""Isolation tests for LLM chat sessions (per user, per project)."""

import pytest
from helpers import add_member, admin_login, create_project, register_and_approve


@pytest.mark.asyncio
async def test_sessions_isolated_between_users_same_project(client):
    """User B (member of the same project) must not see or touch A's sessions."""
    headers = admin_login(client)
    project_id, _ = create_project(client, headers, name="隔离项目")
    other_id, other_headers = register_and_approve(client, headers, "iso-user-b")
    add_member(client, headers, project_id, other_id, role="member")

    resp = client.post(
        "/api/llm/sessions",
        headers=headers,
        json={"project_id": project_id, "title": "A 的会话"},
    )
    assert resp.status_code == 201
    session_id = resp.json()["id"]

    # B's list in the same project is empty (A's session is not leaked)
    resp = client.get(
        "/api/llm/sessions", headers=other_headers, params={"project_id": project_id}
    )
    assert resp.status_code == 200
    assert resp.json() == []

    # Read / rename / delete / agent-chat all return 404 (no existence leak)
    assert client.get(f"/api/llm/sessions/{session_id}", headers=other_headers).status_code == 404
    assert (
        client.put(
            f"/api/llm/sessions/{session_id}", headers=other_headers, json={"title": "篡改"}
        ).status_code
        == 404
    )
    assert client.delete(f"/api/llm/sessions/{session_id}", headers=other_headers).status_code == 404
    resp = client.post(
        "/api/llm/agent-chat",
        headers=other_headers,
        json={"project_id": project_id, "session_id": session_id, "message": "你好"},
    )
    assert resp.status_code == 404

    # Undo of someone else's batch is likewise invisible
    resp = client.post(f"/api/llm/sessions/{session_id}/undo", headers=other_headers)
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_sessions_isolated_between_projects(client):
    """A session created in project X must not appear in project Y's list."""
    headers = admin_login(client)
    project_x, _ = create_project(client, headers, name="项目X")
    project_y, _ = create_project(client, headers, name="项目Y")

    resp = client.post(
        "/api/llm/sessions", headers=headers, json={"project_id": project_x, "title": "X 会话"}
    )
    assert resp.status_code == 201
    session_x = resp.json()["id"]

    resp = client.get("/api/llm/sessions", headers=headers, params={"project_id": project_x})
    assert [s["id"] for s in resp.json()] == [session_x]

    resp = client.get("/api/llm/sessions", headers=headers, params={"project_id": project_y})
    assert resp.json() == []

    # Agent chat with a session from another project is rejected
    resp = client.post(
        "/api/llm/agent-chat",
        headers=headers,
        json={"project_id": project_y, "session_id": session_x, "message": "你好"},
    )
    assert resp.status_code == 403
    assert "不属于该项目" in resp.json()["detail"]


@pytest.mark.asyncio
async def test_create_session_stamps_current_user(client):
    """Sessions created via the API belong to the caller, not to anyone else."""
    headers = admin_login(client)
    project_id, _ = create_project(client, headers, name="归属项目")
    other_id, other_headers = register_and_approve(client, headers, "iso-owner")
    add_member(client, headers, project_id, other_id, role="member")

    resp = client.post(
        "/api/llm/sessions",
        headers=other_headers,
        json={"project_id": project_id, "title": "B 的会话"},
    )
    assert resp.status_code == 201
    session_id = resp.json()["id"]

    # It shows up in B's list but not in admin's list for the same project
    resp = client.get(
        "/api/llm/sessions", headers=other_headers, params={"project_id": project_id}
    )
    assert [s["id"] for s in resp.json()] == [session_id]
    resp = client.get("/api/llm/sessions", headers=headers, params={"project_id": project_id})
    assert resp.json() == []

    # Superuser may still read it directly (admin support path)
    assert client.get(f"/api/llm/sessions/{session_id}", headers=headers).status_code == 200
