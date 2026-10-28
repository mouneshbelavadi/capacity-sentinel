import asyncio
from datetime import datetime, timezone
import json
import time
from typing import Any
import aiosqlite
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from backend.api.deps import record_scope_denial
from backend.core.auth import decode_access_token
from backend.core.logging import logger
from backend.db.connection import get_db
from backend.repos.scope import Scope, SYSTEM_SCOPE
from backend.services.broadcaster import broadcaster

router = APIRouter(tags=["realtime"])


@router.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket) -> None:
    token = websocket.query_params.get("token")
    if not token:
        logger.warning("WebSocket rejected: missing token query parameter")
        await websocket.close(code=1008, reason="Missing authentication token")
        return

    payload = decode_access_token(token)
    if not payload:
        logger.warning("WebSocket rejected: invalid or expired token")
        await websocket.close(code=1008, reason="Invalid token")
        return

    user_id = payload.get("sub") or payload.get("user_id") or "unknown"
    role = payload.get("role", "TENANT")
    tenant_id = payload.get("tenant_id")
    scope = Scope(user_id=user_id, role=role, tenant_id=tenant_id)

    await websocket.accept()

    # Register client with broadcaster
    client = await broadcaster.register(websocket, scope)

    try:
        while True:
            text = await websocket.receive_text()
            client.last_seen = time.time()

            try:
                frame = json.loads(text)
            except Exception:
                continue

            frame_type = frame.get("type")

            if frame_type == "ping":
                now_iso = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
                pong_frame = {"type": "pong", "ts": now_iso, "data": {}}
                await websocket.send_text(json.dumps(pong_frame))

            elif frame_type == "subscribe":
                data = frame.get("data", {})
                req_racks = set(data.get("racks", []))
                req_metrics = set(data.get("metrics", []))

                # Double scope check: on subscribe
                if scope.role == "TENANT":
                    # Determine racks that caller actually owns slots in
                    allowed_racks = set()
                    denied_racks = set()
                    for node_id, (rack_id, node_tenant) in broadcaster.node_tenant_cache.items():
                        if rack_id in req_racks:
                            if node_tenant == scope.tenant_id:
                                allowed_racks.add(rack_id)
                            else:
                                denied_racks.add(rack_id)

                    # Denied racks that tenant doesn't own
                    foreign_racks = (req_racks - allowed_racks)
                    if foreign_racks:
                        logger.warning(
                            f"Tenant {scope.tenant_id} attempted subscribe to foreign racks: {foreign_racks}. Denied."
                        )
                        # Record SCOPE_DENIED in audit log
                        async for db in get_db():
                            for denied_r in foreign_racks:
                                await record_scope_denial(db, scope, "ws_subscribe_rack", denied_r)
                            break

                    client.subscribed_racks = allowed_racks
                else:
                    client.subscribed_racks = req_racks

                client.subscribed_metrics = req_metrics

    except WebSocketDisconnect:
        pass
    except Exception as e:
        logger.warning(f"WebSocket client loop terminated: {e}")
    finally:
        await broadcaster.unregister(client)

