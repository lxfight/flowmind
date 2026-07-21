from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from sqlalchemy import select

from app.api.permissions import ensure_project_member
from app.core.database import async_session_factory
from app.core.realtime import manager
from app.core.security import decode_access_token
from app.models.user import User

router = APIRouter(tags=["realtime"])


@router.websocket("/ws/projects/{project_id}")
async def project_ws(websocket: WebSocket, project_id: int, token: str = ""):
    """Real-time project event stream.

    Browsers cannot send Authorization headers on WebSocket handshakes, so
    the JWT is passed as a ``token`` query parameter and validated exactly
    like HTTP auth, plus project membership is enforced before accepting.
    """
    try:
        payload = decode_access_token(token)
        user_id = int(payload.get("sub"))
    except Exception:
        await websocket.close(code=4401)
        return

    async with async_session_factory() as db:
        result = await db.execute(select(User).where(User.id == user_id))
        user = result.scalar_one_or_none()
        if not user or not user.is_active or not user.is_approved:
            await websocket.close(code=4401)
            return
        try:
            await ensure_project_member(project_id, user, db)
        except Exception:
            await websocket.close(code=4403)
            return

    await manager.connect(project_id, websocket)
    try:
        while True:
            # Client messages are ignored; receiving keeps the socket alive.
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    except Exception:
        pass
    finally:
        manager.disconnect(project_id, websocket)
