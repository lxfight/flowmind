"""Smoke test: WS client receives task_created event after REST mutation."""
import asyncio
import json
import os
import sys
import tempfile

db_file = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
os.environ["DATABASE_URL"] = f"sqlite+aiosqlite:///{db_file.name}"
os.environ["JWT_SECRET"] = "ws-smoke-test-secret"
os.environ["FLOWMIND_ADMIN_PASSWORD"] = "testadmin"
os.environ["LLM_API_KEY"] = ""

import httpx
import uvicorn
import websockets

BASE = "http://127.0.0.1:8765"


async def main():
    from app.main import app
    config = uvicorn.Config(app, host="127.0.0.1", port=8765, log_level="error")
    server = uvicorn.Server(config)
    task = asyncio.create_task(server.serve())
    await asyncio.sleep(2)

    try:
        async with httpx.AsyncClient(base_url=BASE, timeout=10) as client:
            r = await client.post("/api/auth/login", data={"username": "admin", "password": "testadmin"})
            r.raise_for_status()
            token = r.json()["access_token"]
            headers = {"Authorization": f"Bearer {token}"}

            r = await client.post("/api/projects", json={"name": "ws-smoke"}, headers=headers)
            r.raise_for_status()
            project_id = r.json()["id"]

            r = await client.get(f"/api/projects/{project_id}/statuses", headers=headers)
            statuses = r.json()
            if not statuses:
                r = await client.post(f"/api/projects/{project_id}/statuses", json={"name": "Todo"}, headers=headers)
                statuses = [r.json()]
            status_id = statuses[0]["id"]

            ws_url = f"ws://127.0.0.1:8765/ws/projects/{project_id}?token={token}"
            async with websockets.connect(ws_url) as ws:
                r = await client.post(
                    f"/api/projects/{project_id}/tasks",
                    json={"title": "ws event task", "status_id": status_id},
                    headers=headers,
                )
                r.raise_for_status()
                task_id = r.json()["id"]
                event = json.loads(await asyncio.wait_for(ws.recv(), timeout=5))
                assert event["type"] == "task_created", event
                assert event["project_id"] == project_id, event
                assert event["payload"]["task_id"] == task_id, event
                print("PASS: task_created event received:", event)

                # attachment upload event
                r = await client.post(
                    f"/api/projects/{project_id}/tasks/{task_id}/attachments",
                    files={"file": ("hello.txt", b"hello world", "text/plain")},
                    headers=headers,
                )
                r.raise_for_status()
                attachment_id = r.json()["id"]
                event = json.loads(await asyncio.wait_for(ws.recv(), timeout=5))
                assert event["type"] == "attachment_added", event
                print("PASS: attachment_added event received:", event)

                # download + list + delete
                r = await client.get(
                    f"/api/projects/{project_id}/tasks/{task_id}/attachments/{attachment_id}/download",
                    headers=headers,
                )
                assert r.status_code == 200 and r.content == b"hello world", r.status_code
                assert "attachment" in r.headers.get("content-disposition", "")
                print("PASS: attachment download ok, content-disposition:", r.headers["content-disposition"])
                r = await client.delete(
                    f"/api/projects/{project_id}/tasks/{task_id}/attachments/{attachment_id}",
                    headers=headers,
                )
                assert r.status_code == 200, r.text
                event = json.loads(await asyncio.wait_for(ws.recv(), timeout=5))
                assert event["type"] == "attachment_deleted", event
                print("PASS: attachment_deleted event received")

            # bad token rejected
            try:
                async with websockets.connect(f"ws://127.0.0.1:8765/ws/projects/{project_id}?token=bad") as ws:
                    await asyncio.wait_for(ws.recv(), timeout=3)
                    print("FAIL: bad token connection not closed")
                    sys.exit(1)
            except Exception as e:
                print("PASS: bad token rejected:", type(e).__name__)
        print("ALL SMOKE TESTS PASSED")
    finally:
        server.should_exit = True
        await task


asyncio.run(main())
