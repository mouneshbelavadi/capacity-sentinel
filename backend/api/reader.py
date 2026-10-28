from datetime import datetime, timezone
from typing import Any
import aiosqlite
from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from backend.core.ratelimit import tap_limiter
from backend.db.connection import get_db
from backend.repos.readers import update_reader_heartbeat
from backend.services.approval import get_pending_for_reader, process_rfid_tap

router = APIRouter(prefix="/api/reader", tags=["reader"])


class TapRequest(BaseModel):
    uid: str = Field(..., description="RFID card UID (hex string, e.g. 04A2B3C4D5)")
    nonce: str = Field(..., description="Single-use nonce issued by server")
    ts: int = Field(..., description="Unix seconds timestamp from device clock")
    hmac: str = Field(..., description="HMAC-SHA256 signature in hex over device_id|uid|nonce|ts")


class HeartbeatRequest(BaseModel):
    fw: str = Field(..., description="Firmware version string")
    rssi: int = Field(..., description="WiFi RSSI in dBm")
    uptime_s: int = Field(0, description="Device uptime in seconds")


@router.get("/{device_id}/pending")
async def get_pending_action(
    device_id: str,
    db: aiosqlite.Connection = Depends(get_db),
) -> dict[str, Any]:
    """
    Device-facing endpoint.
    Returns armed proposal state with pre-rendered ASCII lines for TFT display,
    or {"armed": false} if no action is armed.
    """
    return await get_pending_for_reader(db=db, device_id=device_id)


@router.post("/{device_id}/tap")
async def handle_tap(
    device_id: str,
    req: TapRequest,
    db: aiosqlite.Connection = Depends(get_db),
) -> dict[str, Any]:
    """
    Device-facing endpoint.
    Processes physical RFID card tap with HMAC verification.
    Always returns HTTP 200 with result='AUTHORIZED' or result='REJECTED'.
    """
    tap_limiter.check(device_id)
    return await process_rfid_tap(
        db=db,
        device_id=device_id,
        uid=req.uid,
        nonce=req.nonce,
        ts=req.ts,
        hmac_str=req.hmac,
    )


@router.post("/{device_id}/heartbeat")
async def handle_heartbeat(
    device_id: str,
    req: HeartbeatRequest,
    db: aiosqlite.Connection = Depends(get_db),
) -> dict[str, Any]:
    """
    Device-facing heartbeat endpoint.
    Updates reader telemetry and returns server timestamp for NTP sync.
    """
    await update_reader_heartbeat(db=db, device_id=device_id, fw=req.fw, rssi=req.rssi)
    server_time = int(datetime.now(timezone.utc).timestamp())
    return {"server_time": server_time}

