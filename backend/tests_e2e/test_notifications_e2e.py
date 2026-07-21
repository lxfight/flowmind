"""E2E test for the notification system. Run from backend/ dir."""
import os
import tempfile

os.environ["DATABASE_URL"] = "sqlite+aiosqlite:///" + os.path.join(
    tempfile.mkdtemp(), "notif_test.db"
)
os.environ["FLOWMIND_ADMIN_PASSWORD"] = "adminpass123"

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402

PASS = "password123"
failures = []


def check(name, cond, extra=""):
    status = "PASS" if cond else "FAIL"
    print(f"[{status}] {name} {extra}")
    if not cond:
        failures.append(name)


with TestClient(app) as client:
    # --- admin login
    r = client.post("/api/auth/login", data={"username": "admin", "password": "adminpass123"})
    check("admin login", r.status_code == 200, str(r.status_code))
    admin_headers = {"Authorization": f"Bearer {r.json()['access_token']}"}

    # --- register two users
    for name in ("alice", "bob"):
        r = client.post("/api/auth/register", json={
            "username": name, "email": f"{name}@example.com", "password": PASS,
        })
        check(f"register {name}", r.status_code in (200, 201), r.text[:200])

    r = client.get("/api/admin/users", headers=admin_headers)
    users = {u["username"]: u for u in r.json()["items"]}
    alice_id, bob_id = users["alice"]["id"], users["bob"]["id"]

    # --- approve both (alice can create projects)
    r = client.post(f"/api/admin/users/{alice_id}/approve?can_create_project=true", headers=admin_headers)
    check("approve alice", r.status_code == 200, r.text[:200])
    r = client.post(f"/api/admin/users/{bob_id}/approve", headers=admin_headers)
    check("approve bob", r.status_code == 200, r.text[:200])

    # bob should have a user_approved notification
    r = client.post("/api/auth/login", data={"username": "bob", "password": PASS})
    bob_headers = {"Authorization": f"Bearer {r.json()['access_token']}"}
    r = client.get("/api/notifications", headers=bob_headers)
    check("bob got user_approved notification",
          r.status_code == 200 and any(n["type"] == "user_approved" for n in r.json()["items"]),
          r.text[:300])

    r = client.post("/api/auth/login", data={"username": "alice", "password": PASS})
    alice_headers = {"Authorization": f"Bearer {r.json()['access_token']}"}

    # --- alice creates project
    r = client.post("/api/projects", json={"name": "通知测试项目", "description": "", "color": "#3b82f6"},
                    headers=alice_headers)
    check("create project", r.status_code == 201, r.text[:200])
    pid = r.json()["id"]

    # --- add bob as member
    r = client.post(f"/api/projects/{pid}/members", json={"user_id": bob_id, "role": "member"},
                    headers=alice_headers)
    check("add bob as member", r.status_code == 200, r.text[:200])

    # --- find a status column
    r = client.get(f"/api/projects/{pid}/statuses", headers=alice_headers)
    check("list statuses", r.status_code == 200 and len(r.json()) > 0, r.text[:200])
    status_id = r.json()[0]["id"]

    # --- alice creates task assigned to bob
    r = client.post(f"/api/projects/{pid}/tasks",
                    json={"title": "给 Bob 的任务", "status_id": status_id, "assignee_ids": [bob_id]},
                    headers=alice_headers)
    check("create task assigned to bob", r.status_code == 201, r.text[:300])
    task_id = r.json()["id"]

    # --- alice reassigns task (update) to bob again after clearing -> triggers another notification
    r = client.put(f"/api/projects/{pid}/tasks/{task_id}",
                   json={"assignee_ids": []}, headers=alice_headers)
    check("clear assignee", r.status_code == 200, r.text[:200])
    r = client.put(f"/api/projects/{pid}/tasks/{task_id}",
                   json={"assignee_ids": [bob_id]}, headers=alice_headers)
    check("reassign to bob", r.status_code == 200, r.text[:200])

    # --- alice comments (plain) on the task
    r = client.post(f"/api/projects/{pid}/tasks/{task_id}/comments",
                    json={"content": "请尽快处理这个任务"}, headers=alice_headers)
    check("alice comment", r.status_code == 201, r.text[:200])

    # --- bob comments with @alice mention
    r = client.post(f"/api/projects/{pid}/tasks/{task_id}/comments",
                    json={"content": "好的 @alice 我马上看"}, headers=bob_headers)
    check("bob comment with mention", r.status_code == 201, r.text[:200])

    # --- inspect bob's notifications
    r = client.get("/api/notifications", headers=bob_headers)
    data = r.json()
    types = [n["type"] for n in data["items"]]
    check("bob notification types", all(t in types for t in
          ["user_approved", "member_added", "task_assigned", "comment"]), str(types))
    check("bob unread_count matches",
          data["unread_count"] == sum(1 for n in data["items"] if not n["is_read"]),
          f"unread={data['unread_count']}")
    check("task_assigned link correct",
          any(n["type"] == "task_assigned" and n["link"] == f"/project/{pid}/board"
              for n in data["items"]), "")

    r = client.get("/api/notifications/unread-count", headers=bob_headers)
    bob_unread_before = r.json()["unread_count"]
    check("unread-count endpoint", bob_unread_before == data["unread_count"],
          str(bob_unread_before))

    # --- alice should have a mention notification from bob's comment
    r = client.get("/api/notifications", headers=alice_headers)
    alice_types = [n["type"] for n in r.json()["items"]]
    check("alice got mention notification", "mention" in alice_types, str(alice_types))

    # --- alice should NOT have been notified about her own comment/assignment
    check("alice no self-notification for own comment",
          "comment" not in alice_types and "task_assigned" not in alice_types, str(alice_types))

    # --- mark single notification read
    notif_id = data["items"][0]["id"]
    r = client.post(f"/api/notifications/{notif_id}/read", headers=bob_headers)
    check("mark one read", r.status_code == 200 and r.json()["is_read"] is True, r.text[:200])
    r = client.get("/api/notifications/unread-count", headers=bob_headers)
    check("unread decreased by 1", r.json()["unread_count"] == bob_unread_before - 1,
          str(r.json()))

    # --- bob cannot read alice's notification
    r2 = client.get("/api/notifications", headers=alice_headers)
    alice_notif_id = r2.json()["items"][0]["id"]
    r = client.post(f"/api/notifications/{alice_notif_id}/read", headers=bob_headers)
    check("cross-user read forbidden (404)", r.status_code == 404, str(r.status_code))

    # --- read-all
    r = client.post("/api/notifications/read-all", headers=bob_headers)
    check("read-all", r.status_code == 200, r.text[:200])
    r = client.get("/api/notifications/unread-count", headers=bob_headers)
    check("unread zero after read-all", r.json()["unread_count"] == 0, str(r.json()))

    # --- unauthenticated access rejected
    r = client.get("/api/notifications")
    check("unauth 401/403", r.status_code in (401, 403), str(r.status_code))

    # --- cleanup test users' data: delete project cascades; delete users via admin? deactivate instead
    client.post(f"/api/admin/users/{alice_id}/reject", headers=admin_headers)
    client.post(f"/api/admin/users/{bob_id}/reject", headers=admin_headers)

print()
if failures:
    print(f"{len(failures)} FAILURES: {failures}")
    raise SystemExit(1)
print("ALL TESTS PASSED")
