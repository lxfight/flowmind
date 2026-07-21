"""E2E test for task due_date + due reminder scanning. Run from backend/ dir."""
import asyncio
import os
import tempfile
from datetime import UTC, datetime, timedelta

os.environ["DATABASE_URL"] = "sqlite+aiosqlite:///" + os.path.join(
    tempfile.mkdtemp(), "due_test.db"
)
os.environ["FLOWMIND_ADMIN_PASSWORD"] = "adminpass123"

from fastapi.testclient import TestClient  # noqa: E402

from app.core.database import async_session_factory  # noqa: E402
from app.main import app  # noqa: E402
from app.services.due_reminder import scan_due_tasks  # noqa: E402

PASS = "password123"
failures = []


def check(name, cond, extra=""):
    status = "PASS" if cond else "FAIL"
    print(f"[{status}] {name} {extra}")
    if not cond:
        failures.append(name)


def run_scan():
    async def _go():
        async with async_session_factory() as db:
            counters = await scan_due_tasks(db)
            await db.commit()
            return counters
    return asyncio.get_event_loop().run_until_complete(_go())


with TestClient(app) as client:
    r = client.post("/api/auth/login", data={"username": "admin", "password": "adminpass123"})
    check("admin login", r.status_code == 200, str(r.status_code))
    admin_headers = {"Authorization": f"Bearer {r.json()['access_token']}"}

    r = client.post("/api/auth/register", json={
        "username": "carol", "email": "carol@example.com", "password": PASS,
    })
    check("register carol", r.status_code in (200, 201), r.text[:200])
    r = client.get("/api/admin/users", headers=admin_headers)
    carol_id = next(u["id"] for u in r.json()["items"] if u["username"] == "carol")
    r = client.post(f"/api/admin/users/{carol_id}/approve?can_create_project=true", headers=admin_headers)
    check("approve carol", r.status_code == 200, r.text[:200])

    r = client.post("/api/auth/login", data={"username": "carol", "password": PASS})
    headers = {"Authorization": f"Bearer {r.json()['access_token']}"}

    r = client.post("/api/projects", json={"name": "截止测试", "description": "", "color": "#3b82f6"},
                    headers=headers)
    check("create project", r.status_code == 201, r.text[:200])
    pid = r.json()["id"]

    r = client.get(f"/api/projects/{pid}/statuses", headers=headers)
    statuses = r.json()
    open_status = next(s for s in statuses if not s["is_done"])
    done_status = next((s for s in statuses if s["is_done"]), None)

    now = datetime.now(UTC)

    # --- 1. create task with due_date -> TaskOut includes it
    due_soon = (now + timedelta(hours=12)).isoformat()
    r = client.post(f"/api/projects/{pid}/tasks", json={
        "title": "即将到期", "status_id": open_status["id"],
        "assignee_ids": [carol_id], "due_date": due_soon,
    }, headers=headers)
    check("create task with due_date", r.status_code == 201 and r.json()["due_date"] is not None, r.text[:300])
    t_soon = r.json()["id"]

    # --- 2. update due_date
    new_due = (now + timedelta(days=5)).isoformat()
    r = client.put(f"/api/projects/{pid}/tasks/{t_soon}", json={"due_date": new_due}, headers=headers)
    check("update due_date", r.status_code == 200 and r.json()["due_date"][:10] == new_due[:10], r.text[:300])

    # --- 3. clear due_date
    r = client.put(f"/api/projects/{pid}/tasks/{t_soon}", json={"due_date": None}, headers=headers)
    check("clear due_date", r.status_code == 200 and r.json()["due_date"] is None, r.text[:300])

    # restore soon due for scanning
    client.put(f"/api/projects/{pid}/tasks/{t_soon}", json={"due_date": due_soon}, headers=headers)

    # --- overdue task
    r = client.post(f"/api/projects/{pid}/tasks", json={
        "title": "已经逾期", "status_id": open_status["id"],
        "assignee_ids": [carol_id], "due_date": (now - timedelta(hours=3)).isoformat(),
    }, headers=headers)
    t_over = r.json()["id"]

    # --- far-future task (no notification)
    r = client.post(f"/api/projects/{pid}/tasks", json={
        "title": "还很远", "status_id": open_status["id"],
        "assignee_ids": [carol_id], "due_date": (now + timedelta(days=10)).isoformat(),
    }, headers=headers)
    t_far = r.json()["id"]

    # --- no-assignee soon task (skipped)
    client.post(f"/api/projects/{pid}/tasks", json={
        "title": "无指派", "status_id": open_status["id"],
        "due_date": (now + timedelta(hours=5)).isoformat(),
    }, headers=headers)

    # --- completed (done status) overdue task (skipped)
    t_done = None
    if done_status:
        r = client.post(f"/api/projects/{pid}/tasks", json={
            "title": "已完成逾期", "status_id": done_status["id"],
            "assignee_ids": [carol_id], "due_date": (now - timedelta(hours=2)).isoformat(),
        }, headers=headers)
        t_done = r.json()["id"]

    # baseline notification count
    def notifs():
        return client.get("/api/notifications", headers=headers).json()["items"]

    base_count = len(notifs())

    # --- 4. first scan: due_soon + due_overdue notifications
    counters1 = run_scan()
    check("scan counters first pass",
          counters1["due_soon"] == 1 and counters1["due_overdue"] == 1, str(counters1))
    n1 = notifs()
    new_types = [n["type"] for n in n1[: len(n1) - base_count]]
    check("due_soon notification", "due_soon" in new_types, str(new_types))
    check("due_overdue notification", "due_overdue" in new_types, str(new_types))
    soon_notif = next(n for n in n1 if n["type"] == "due_soon")
    check("due_soon link", soon_notif["link"] == f"/project/{pid}/board", soon_notif["link"])

    # --- 5. second scan: no duplicates
    counters2 = run_scan()
    check("scan idempotent", counters2["due_soon"] == 0 and counters2["due_overdue"] == 0, str(counters2))
    check("notification count stable", len(notifs()) == len(n1),
          f"{len(n1)} -> {len(notifs())}")

    # --- 6. due_date change re-arms reminder
    client.put(f"/api/projects/{pid}/tasks/{t_far}",
               json={"due_date": (now + timedelta(hours=6)).isoformat()}, headers=headers)
    counters3 = run_scan()
    check("re-arm after due_date update", counters3["due_soon"] == 1, str(counters3))

    # --- 7. completing a due-soon task suppresses further reminders
    client.put(f"/api/projects/{pid}/tasks/{t_far}", json={"is_completed": True}, headers=headers)
    client.put(f"/api/projects/{pid}/tasks/{t_far}",
               json={"due_date": (now + timedelta(hours=1)).isoformat()}, headers=headers)
    # un-complete with a new date, verify re-arm works again
    client.put(f"/api/projects/{pid}/tasks/{t_far}", json={"is_completed": False}, headers=headers)
    counters4 = run_scan()
    check("re-opened task re-notified", counters4["due_soon"] == 1, str(counters4))

    # --- 8. far-future + no-assignee + done tasks never notified
    overdue_titles = [n["body"] for n in notifs() if n["type"] in ("due_soon", "due_overdue")]
    check("no notification body mentions 无指派/已完成逾期",
          not any("无指派" in b or "已完成逾期" in b for b in overdue_titles), "")

print()
if failures:
    print(f"{len(failures)} FAILURES: {failures}")
    raise SystemExit(1)
print("ALL TESTS PASSED")
