from datetime import datetime, timezone
import time
from typing import Any
import aiosqlite
from fastapi import APIRouter, Depends
from pydantic import BaseModel

from backend.core.config import settings
from backend.db.connection import get_db
from backend.services.audit import verify_audit_chain

router = APIRouter(prefix="/api", tags=["meta"])
_server_start_time: float = time.time()


class MetaResponse(BaseModel):
    contract_version: str
    server_time: str
    site_id: str


class HealthResponse(BaseModel):
    ok: bool
    broker: bool
    scheduler: bool
    db: bool
    audit_chain_ok: bool
    head_hash: str
    uptime_s: float


@router.get("/meta", response_model=MetaResponse)
async def get_meta() -> MetaResponse:
    now_iso = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    return MetaResponse(
        contract_version=settings.CONTRACT_VERSION,
        server_time=now_iso,
        site_id=settings.SITE_ID,
    )


@router.get("/health", response_model=HealthResponse)
async def get_health(db: aiosqlite.Connection = Depends(get_db)) -> HealthResponse:
    """
    Operational health endpoint.
    Unauthenticated, reveals no tenant-specific data.
    """
    # 1. DB check
    db_ok = False
    try:
        cursor = await db.execute("SELECT 1")
        row = await cursor.fetchone()
        db_ok = row is not None
    except Exception:
        db_ok = False

    # 2. Audit chain check
    audit_ok = False
    head_hash = ""
    try:
        audit_res = await verify_audit_chain(db)
        audit_ok = audit_res.get("ok", False)
        head_hash = audit_res.get("head_hash", "")
    except Exception:
        audit_ok = False

    # 3. Subsystem checks
    from backend.main import analysis_scheduler, mqtt_subscriber
    scheduler_ok = bool(analysis_scheduler and analysis_scheduler.running)
    broker_ok = bool(mqtt_subscriber and mqtt_subscriber.running)

    overall_ok = db_ok and audit_ok

    uptime_s = round(time.time() - _server_start_time, 1)

    return HealthResponse(
        ok=overall_ok,
        broker=broker_ok,
        scheduler=scheduler_ok,
        db=db_ok,
        audit_chain_ok=audit_ok,
        head_hash=head_hash,
        uptime_s=uptime_s,
    )
