"""WebSocket endpoint auth + ConnectionManager unit coverage.

Note: the request-scoped get_db override used in tests does not drain
queued WS events after commit, so end-to-end REST→WS broadcast is covered
by backend/ws_smoke_test.py (dev tool). Here we cover endpoint auth and
the ConnectionManager broadcast semantics directly.
"""
import pytest
from conftest import async_session_factory
from helpers import add_member, admin_login, create_project, register_and_approve
from starlette.websockets import WebSocketDisconnect

from app.core.realtime import ConnectionManager, flush_ws_events, queue_ws_event


def _token(headers: dict[str, str]) -> str:
    return headers["Authorization"].removeprefix("Bearer ")


@pytest.mark.asyncio
async def test_ws_rejects_bad_token(client):
    headers = admin_login(client)
    project_id, _ = create_project(client, headers)
    with pytest.raises(WebSocketDisconnect) as exc, client.websocket_connect(
        f"/ws/projects/{project_id}?token=not-a-token"
    ):
        pass
    assert exc.value.code == 4401


@pytest.mark.asyncio
async def test_ws_rejects_missing_token(client):
    headers = admin_login(client)
    project_id, _ = create_project(client, headers)
    with pytest.raises(WebSocketDisconnect) as exc, client.websocket_connect(f"/ws/projects/{project_id}"):
        pass
    assert exc.value.code == 4401


@pytest.mark.asyncio
async def test_ws_rejects_non_member(client):
    headers = admin_login(client)
    _, outsider_headers = register_and_approve(client, headers, "wsoutsider")
    project_id, _ = create_project(client, headers)
    with pytest.raises(WebSocketDisconnect) as exc, client.websocket_connect(
        f"/ws/projects/{project_id}?token={_token(outsider_headers)}"
    ):
        pass
    assert exc.value.code == 4403


@pytest.mark.asyncio
async def test_ws_accepts_project_member(client):
    headers = admin_login(client)
    member_id, member_headers = register_and_approve(client, headers, "wsmember")
    project_id, _ = create_project(client, headers)
    add_member(client, headers, project_id, member_id, role="viewer")

    with client.websocket_connect(
        f"/ws/projects/{project_id}?token={_token(member_headers)}"
    ) as ws:
        # Connection accepted; the server only reads, so just close cleanly.
        ws.close()


class _FakeWebSocket:
    def __init__(self, fail: bool = False):
        self.accepted = False
        self.sent: list[dict] = []
        self.fail = fail

    async def accept(self):
        self.accepted = True

    async def send_json(self, event: dict):
        if self.fail:
            raise RuntimeError("socket closed mid-broadcast")
        self.sent.append(event)


@pytest.mark.asyncio
async def test_connection_manager_broadcast_and_disconnect():
    manager = ConnectionManager()
    ws1, ws2, dead = _FakeWebSocket(), _FakeWebSocket(), _FakeWebSocket(fail=True)
    await manager.connect(1, ws1)
    await manager.connect(1, ws2)
    await manager.connect(1, dead)

    event = {"type": "task_created", "project_id": 1, "payload": {"task_id": 1}}
    await manager.broadcast(1, event)

    assert ws1.sent == [event]
    assert ws2.sent == [event]
    # A failing socket is dropped from the connection pool
    assert dead not in manager._connections[1]

    # Broadcast to a project with no connections is a no-op
    await manager.broadcast(999, event)

    manager.disconnect(1, ws1)
    manager.disconnect(1, ws2)
    assert 1 not in manager._connections


@pytest.mark.asyncio
async def test_queue_and_flush_ws_events(monkeypatch):
    manager = ConnectionManager()
    monkeypatch.setattr("app.core.realtime.manager", manager)
    ws = _FakeWebSocket()
    await manager.connect(7, ws)

    async with async_session_factory() as session:
        queue_ws_event(session, "task_moved", 7, {"task_id": 5}, actor_id=1)
        queue_ws_event(session, "comment_created", 7, {"task_id": 5, "comment_id": 9})
        await flush_ws_events(session)
        # Queue is drained after flush
        await flush_ws_events(session)

    assert [e["type"] for e in ws.sent] == ["task_moved", "comment_created"]
    assert ws.sent[0]["actor_id"] == 1
