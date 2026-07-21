"""Tests for GET /api/projects/users/search candidate-list parameters."""

from tests.helpers import add_member, admin_login, create_project, register_and_approve


def test_short_query_without_exclude_returns_empty(client):
    headers = admin_login(client)
    response = client.get("/api/projects/users/search", params={"q": "a"}, headers=headers)
    assert response.status_code == 200
    assert response.json() == []


def test_keyword_search_still_works(client):
    headers = admin_login(client)
    register_and_approve(client, headers, "searchtarget")
    response = client.get("/api/projects/users/search", params={"q": "searchtar"}, headers=headers)
    assert response.status_code == 200
    usernames = [u["username"] for u in response.json()]
    assert "searchtarget" in usernames


def test_candidates_exclude_project_members_with_empty_query(client):
    headers = admin_login(client)
    project_id, _ = create_project(client, headers, name="候选项目")
    member_id, _ = register_and_approve(client, headers, "candmember")
    outsider_id, _ = register_and_approve(client, headers, "candoutsider")
    add_member(client, headers, project_id, member_id)

    response = client.get(
        "/api/projects/users/search",
        params={"exclude_project_id": project_id},
        headers=headers,
    )
    assert response.status_code == 200
    user_ids = [u["id"] for u in response.json()]
    assert member_id not in user_ids
    assert outsider_id in user_ids


def test_candidates_limit_is_honored(client):
    headers = admin_login(client)
    project_id, _ = create_project(client, headers, name="限额项目")
    response = client.get(
        "/api/projects/users/search",
        params={"exclude_project_id": project_id, "limit": 1},
        headers=headers,
    )
    assert response.status_code == 200
    assert len(response.json()) <= 1


def test_candidates_with_short_query_filter(client):
    headers = admin_login(client)
    project_id, _ = create_project(client, headers, name="短词项目")
    register_and_approve(client, headers, "zxshortquery")
    response = client.get(
        "/api/projects/users/search",
        params={"q": "zx", "exclude_project_id": project_id},
        headers=headers,
    )
    assert response.status_code == 200
    usernames = [u["username"] for u in response.json()]
    assert "zxshortquery" in usernames
