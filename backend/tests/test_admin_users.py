"""Admin user list + global overview counts."""
import pytest
from helpers import admin_login, register_and_approve


@pytest.mark.asyncio
async def test_admin_users_overview_counts_are_global(client):
    """The overview counts must reflect all users, not just the current page."""
    headers = admin_login(client)

    # Register one user but leave it pending (no approve).
    response = client.post(
        "/api/auth/register",
        json={"username": "pendingonly", "email": "pendingonly@example.com", "password": "testpass123"},
    )
    assert response.status_code == 201

    # Approve two others.
    active1_id, _ = register_and_approve(client, headers, "activeuser1")
    active2_id, _ = register_and_approve(client, headers, "activeuser2")

    # Disable one of the active users.
    response = client.post(f"/api/admin/users/{active2_id}/reject", headers=headers)
    assert response.status_code == 200

    # Fetch page 1 with a tiny page size so not every user fits on the page.
    response = client.get("/api/admin/users", headers=headers, params={"page": 1, "page_size": 1})
    assert response.status_code == 200
    body = response.json()

    # Global counts include users that are NOT on page 1.
    assert body["pending_count"] >= 1
    assert body["active_count"] >= 1
    assert body["disabled_count"] >= 1
    # The overview totals cover more users than the single item on this page.
    assert body["total"] >= body["pending_count"] + body["active_count"] + body["disabled_count"]
