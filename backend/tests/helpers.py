"""Shared helpers for API tests (login, user provisioning, project setup)."""


def login(client, username: str, password: str) -> dict[str, str]:
    response = client.post(
        "/api/auth/login",
        data={"username": username, "password": password},
    )
    assert response.status_code == 200, response.text
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


def admin_login(client) -> dict[str, str]:
    return login(client, "admin", "testadmin")


def register_and_approve(client, admin_headers, username: str) -> tuple[int, dict[str, str]]:
    password = "testpass123"
    response = client.post(
        "/api/auth/register",
        json={
            "username": username,
            "email": f"{username}@example.com",
            "password": password,
        },
    )
    assert response.status_code == 201, response.text
    user_id = response.json()["user_id"]
    response = client.post(
        f"/api/admin/users/{user_id}/approve",
        headers=admin_headers,
    )
    assert response.status_code == 200, response.text
    return user_id, login(client, username, password)


def create_project(client, headers, name: str = "测试项目") -> tuple[int, list[dict]]:
    response = client.post(
        "/api/projects",
        headers=headers,
        json={"name": name, "description": "", "color": "#336699"},
    )
    assert response.status_code == 201, response.text
    project_id = response.json()["id"]
    response = client.get(f"/api/projects/{project_id}/statuses", headers=headers)
    assert response.status_code == 200, response.text
    return project_id, response.json()


def add_member(client, admin_headers, project_id: int, user_id: int, role: str = "member"):
    response = client.post(
        f"/api/projects/{project_id}/members",
        headers=admin_headers,
        json={"user_id": user_id, "role": role},
    )
    assert response.status_code == 200, response.text


def create_task(client, headers, project_id: int, status_id: int, title: str) -> dict:
    response = client.post(
        f"/api/projects/{project_id}/tasks",
        headers=headers,
        json={"title": title, "status_id": status_id},
    )
    assert response.status_code == 201, response.text
    return response.json()
