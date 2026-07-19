import pytest


@pytest.mark.asyncio
async def test_register(client):
    response = client.post(
        "/api/auth/register",
        json={
            "username": "testuser",
            "email": "test@example.com",
            "password": "testpass123",
            "display_name": "Test User",
        },
    )
    assert response.status_code == 201
    data = response.json()
    assert "user_id" in data
    assert "注册申请已提交" in data["message"]


@pytest.mark.asyncio
async def test_login_and_me(client, approved_user):
    # Login with the approved user fixture
    login_response = client.post(
        "/api/auth/login",
        data={
            "username": "approveduser",
            "password": "approvedpass123",
        },
    )
    assert login_response.status_code == 200
    token_data = login_response.json()
    assert "access_token" in token_data
    assert token_data["token_type"] == "bearer"

    # Access protected endpoint
    me_response = client.get(
        "/api/auth/me",
        headers={"Authorization": f"Bearer {token_data['access_token']}"},
    )
    assert me_response.status_code == 200
    me = me_response.json()
    assert me["username"] == "approveduser"
    assert me["email"] == "approved@example.com"


@pytest.mark.asyncio
async def test_login_with_invalid_password(client, approved_user):
    response = client.post(
        "/api/auth/login",
        data={
            "username": "approveduser",
            "password": "wrongpassword",
        },
    )
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_login_unapproved_user(client):
    # Register a new user (not approved by default)
    client.post(
        "/api/auth/register",
        json={
            "username": "unapproved",
            "email": "unapproved@example.com",
            "password": "testpass123",
        },
    )

    response = client.post(
        "/api/auth/login",
        data={
            "username": "unapproved",
            "password": "testpass123",
        },
    )
    assert response.status_code == 403
    assert "尚未通过审批" in response.json()["detail"]


@pytest.mark.asyncio
async def test_register_duplicate_username(client):
    payload = {
        "username": "dupuser",
        "email": "dup@example.com",
        "password": "testpass123",
    }
    first = client.post("/api/auth/register", json=payload)
    assert first.status_code == 201

    second = client.post("/api/auth/register", json=payload)
    assert second.status_code == 409
    assert "已存在" in second.json()["detail"]
