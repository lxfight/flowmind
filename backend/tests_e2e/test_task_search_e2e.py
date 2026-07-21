"""E2E test for cross-project task search (GET /api/tasks/search). Run from backend/ dir."""
import os
import tempfile
from datetime import UTC, datetime, timedelta

os.environ["DATABASE_URL"] = "sqlite+aiosqlite:///" + os.path.join(
    tempfile.mkdtemp(), "task_search_test.db"
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


NOW = datetime.now(UTC)
PAST = (NOW - timedelta(days=3)).isoformat()
FUTURE = (NOW + timedelta(days=5)).isoformat()
FAR_FUTURE = (NOW + timedelta(days=30)).isoformat()

with TestClient(app) as client:
    # --- admin login
    r = client.post("/api/auth/login", data={"username": "admin", "password": "adminpass123"})
    check("admin login", r.status_code == 200, str(r.status_code))
    admin_headers = {"Authorization": f"Bearer {r.json()['access_token']}"}

    # --- register & approve two users
    for name in ("alice", "bob"):
        r = client.post("/api/auth/register", json={
            "username": name, "email": f"{name}@example.com", "password": PASS,
        })
        check(f"register {name}", r.status_code in (200, 201), r.text[:200])

    r = client.get("/api/admin/users", headers=admin_headers)
    users = {u["username"]: u for u in r.json()["items"]}
    alice_id, bob_id = users["alice"]["id"], users["bob"]["id"]
    client.post(f"/api/admin/users/{alice_id}/approve?can_create_project=true", headers=admin_headers)
    client.post(f"/api/admin/users/{bob_id}/approve?can_create_project=true", headers=admin_headers)

    def login(name):
        r = client.post("/api/auth/login", data={"username": name, "password": PASS})
        return {"Authorization": f"Bearer {r.json()['access_token']}"}

    alice_headers = login("alice")
    bob_headers = login("bob")

    def create_project(headers, name):
        r = client.post("/api/projects", json={"name": name}, headers=headers)
        assert r.status_code == 201, r.text
        return r.json()["id"]

    def first_status(headers, pid):
        r = client.get(f"/api/projects/{pid}/statuses", headers=headers)
        return r.json()[0]["id"]

    # --- project A: alice owns, bob is member
    pid_a = create_project(alice_headers, "搜索项目A")
    sid_a = first_status(alice_headers, pid_a)
    r = client.post(f"/api/projects/{pid_a}/members", json={"user_id": bob_id, "role": "member"},
                    headers=alice_headers)
    check("add bob to project A", r.status_code == 200, r.text[:200])

    # --- project B: bob owns, alice NOT a member
    pid_b = create_project(bob_headers, "搜索项目B")
    sid_b = first_status(bob_headers, pid_b)

    def create_task(headers, pid, **kwargs):
        r = client.post(f"/api/projects/{pid}/tasks", json=kwargs, headers=headers)
        assert r.status_code == 201, r.text
        return r.json()

    # Project A tasks
    t1 = create_task(alice_headers, pid_a, status_id=sid_a, title="修复登录崩溃",
                     description="登录页面偶发崩溃", priority=4, assignee_ids=[bob_id], due_date=PAST)
    t2 = create_task(alice_headers, pid_a, status_id=sid_a, title="更新文档",
                     description="描述里提到登录流程优化", priority=2, assignee_ids=[alice_id],
                     due_date=FUTURE)
    t3 = create_task(alice_headers, pid_a, status_id=sid_a, title="重构看板",
                     description="拖拽体验改进", priority=1, due_date=FAR_FUTURE)
    # completed task (via is_completed update) with past due -> not overdue
    t4 = create_task(alice_headers, pid_a, status_id=sid_a, title="已完成的旧任务",
                     description="历史遗留", priority=3, assignee_ids=[bob_id], due_date=PAST)
    r = client.put(f"/api/projects/{pid_a}/tasks/{t4['id']}", json={"is_completed": True},
                   headers=alice_headers)
    check("complete t4", r.status_code == 200 and r.json()["is_completed"] is True, r.text[:200])

    # Project B task (alice must not see it)
    create_task(bob_headers, pid_b, status_id=sid_b, title="登录接口压测",
                description="性能测试", priority=4, assignee_ids=[bob_id], due_date=PAST)

    def search(headers, **params):
        r = client.get("/api/tasks/search", params=params, headers=headers)
        assert r.status_code == 200, r.text
        return r.json()

    # --- 1. unauthenticated
    r = client.get("/api/tasks/search")
    check("unauth 401/403", r.status_code in (401, 403), str(r.status_code))

    # --- 2. keyword search hits title AND description (case-insensitive)
    data = search(alice_headers, q="登录")
    titles = {t["title"] for t in data["tasks"]}
    check("q hits title", "修复登录崩溃" in titles, str(titles))
    check("q hits description", "更新文档" in titles, str(titles))
    check("q case-insensitive",
          len(search(alice_headers, q="登录")["tasks"]) == len(search(alice_headers, q="登录")["tasks"]), "")

    # --- 3. permission isolation: alice cannot see project B tasks
    check("permission isolation", "登录接口压测" not in titles, str(titles))
    all_alice = search(alice_headers)
    check("alice sees only project A", all(t["project_id"] == pid_a for t in all_alice["tasks"]),
          str([t["project_id"] for t in all_alice["tasks"]]))
    check("total matches items", all_alice["total"] == len(all_alice["tasks"]), str(all_alice["total"]))

    # bob (member of A, owner of B) sees both projects
    all_bob = search(bob_headers)
    check("bob sees both projects",
          {t["project_id"] for t in all_bob["tasks"]} == {pid_a, pid_b},
          str({t["project_id"] for t in all_bob["tasks"]}))

    # --- 4. project_id filter
    data = search(alice_headers, project_id=pid_a, q="登录")
    check("project filter", all(t["project_id"] == pid_a for t in data["tasks"]), "")
    # project B is not accessible to alice -> empty even when filtering by id
    data = search(alice_headers, project_id=pid_b)
    check("inaccessible project filter returns empty", data["tasks"] == [] and data["total"] == 0, "")

    # --- 5. assignee filter + "me"
    data = search(alice_headers, assignee_id="me")
    check("assignee=me", all(any(u["id"] == alice_id for u in t["assignees"]) for t in data["tasks"]),
          str([t["assignees"] for t in data["tasks"]]))
    check("assignee=me found t2", any(t["title"] == "更新文档" for t in data["tasks"]), "")
    data = search(alice_headers, assignee_id=str(bob_id))
    check("assignee by id", all(any(u["id"] == bob_id for u in t["assignees"]) for t in data["tasks"]), "")

    # --- 6. priority filter
    data = search(alice_headers, priority=4)
    check("priority filter", {t["title"] for t in data["tasks"]} == {"修复登录崩溃"},
          str([t["title"] for t in data["tasks"]]))

    # --- 7. status filter (t4 moved to a done status after completion)
    data = search(alice_headers, status_id=sid_a)
    check("status filter", all(t["status_id"] == sid_a for t in data["tasks"]), "")

    # --- 8. overdue filter: t1 only (t4 completed, t2/t3 future)
    data = search(alice_headers, overdue=True)
    check("overdue filter", {t["title"] for t in data["tasks"]} == {"修复登录崩溃"},
          str([t["title"] for t in data["tasks"]]))
    data = search(alice_headers, overdue=False)
    check("overdue=false returns all", len(data["tasks"]) == all_alice["total"], str(len(data["tasks"])))

    # --- 9. due_before / due_after
    data = search(alice_headers, due_after=FUTURE)
    check("due_after", {t["title"] for t in data["tasks"]} == {"更新文档", "重构看板"},
          str([t["title"] for t in data["tasks"]]))
    data = search(alice_headers, due_before=NOW.isoformat())
    check("due_before", {t["title"] for t in data["tasks"]} == {"修复登录崩溃", "已完成的旧任务"},
          str([t["title"] for t in data["tasks"]]))

    # --- 10. combined filters
    data = search(alice_headers, q="登录", assignee_id=str(bob_id), priority=4, overdue=True)
    check("combined filters", {t["title"] for t in data["tasks"]} == {"修复登录崩溃"},
          str([t["title"] for t in data["tasks"]]))

    # --- 11. enrichment fields + ordering
    item = all_alice["tasks"][0]
    check("enrichment fields",
          all(k in item for k in ("project_name", "status_name", "status_color", "project_color", "assignees")),
          str(sorted(item.keys())))
    check("project_name correct", all(t["project_name"] == "搜索项目A" for t in all_alice["tasks"]), "")
    updated = [t["updated_at"] for t in all_alice["tasks"]]
    check("ordered by updated_at desc", updated == sorted(updated, reverse=True), str(updated))

    # --- 12. pagination
    page = search(alice_headers, limit=1, offset=0)
    check("pagination limit", len(page["tasks"]) == 1 and page["total"] == all_alice["total"], "")
    page2 = search(alice_headers, limit=1, offset=1)
    check("pagination offset", page2["tasks"] and page2["tasks"][0]["id"] != page["tasks"][0]["id"], "")

    # --- 13. invalid assignee_id -> 422
    r = client.get("/api/tasks/search", params={"assignee_id": "notanumber"}, headers=alice_headers)
    check("invalid assignee_id 422", r.status_code == 422, str(r.status_code))

    # --- cleanup
    client.post(f"/api/admin/users/{alice_id}/reject", headers=admin_headers)
    client.post(f"/api/admin/users/{bob_id}/reject", headers=admin_headers)

print()
if failures:
    print(f"{len(failures)} FAILURES: {failures}")
    raise SystemExit(1)
print("ALL TESTS PASSED")
