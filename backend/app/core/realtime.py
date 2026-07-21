"""In-process WebSocket connection manager for real-time kanban sync.

Limitation: connections are held in this process's memory only. With
multiple workers/processes, events triggered in one process will not reach
clients connected to another — swap in Redis pub/sub (or similar) for
multi-process deployments.
"""
from collections import defaultdict

from fastapi import WebSocket
from sqlalchemy.ext.asyncio import AsyncSession


class ConnectionManager:
    """Tracks active WebSocket connections keyed by project_id."""

    def __init__(self) -> None:
        self._connections: dict[int, set[WebSocket]] = defaultdict(set)

    async def connect(self, project_id: int, websocket: WebSocket) -> None:
        await websocket.accept()
        self._connections[project_id].add(websocket)

    def disconnect(self, project_id: int, websocket: WebSocket) -> None:
        conns = self._connections.get(project_id)
        if conns is not None:
            conns.discard(websocket)
            if not conns:
                self._connections.pop(project_id, None)

    async def broadcast(self, project_id: int, event: dict) -> None:
        for ws in list(self._connections.get(project_id, ())):
            try:
                await ws.send_json(event)
            except Exception:
                self.disconnect(project_id, ws)


manager = ConnectionManager()


def queue_ws_event(
    session: AsyncSession,
    event_type: str,
    project_id: int,
    payload: dict,
    actor_id: int | None = None,
) -> None:
    """Queue an event to be broadcast after the DB commit succeeds.

    Events are drained in ``get_db`` after ``session.commit()``, so clients
    never see events for rolled-back transactions. Payloads stay light
    (ids + changed fields); clients refetch details as needed.
    """
    events = session.info.setdefault("ws_events", [])
    events.append(
        {
            "type": event_type,
            "project_id": project_id,
            "payload": payload,
            "actor_id": actor_id,
        }
    )


async def flush_ws_events(session: AsyncSession) -> None:
    """Broadcast all events queued on the session (call after commit)."""
    events = session.info.pop("ws_events", [])
    for event in events:
        await manager.broadcast(event["project_id"], event)
