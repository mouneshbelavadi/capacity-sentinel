from typing import Any
import aiosqlite
from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel

from backend.api.deps import get_current_scope
from backend.db.connection import get_db
from backend.repos.audit import query_audit_logs
from backend.repos.scope import Scope
from backend.services.audit import verify_audit_chain

router = APIRouter(prefix="/api/audit", tags=["audit"])


class AuditRow(BaseModel):
    seq: int
    ts: str
    actor: str
    event: str
    subject_json: str
    payload_json: str
    prev_hash: str
    hash: str


class AuditResponse(BaseModel):
    rows: list[AuditRow]


class AuditVerifyResponse(BaseModel):
    ok: bool
    rows_checked: int
    head_hash: str
    broken_at: int | None = None


@router.get("", response_model=AuditResponse)
async def get_audit_logs(
    limit: int = Query(50, ge=1, le=500),
    since: str | None = Query(None),
    scope: Scope = Depends(get_current_scope),
    db: aiosqlite.Connection = Depends(get_db),
) -> AuditResponse:
    """
    Get audit logs. Scoped to the caller:
    A TENANT only sees their own actions or events for their own resources.
    """
    rows = await query_audit_logs(db, scope=scope, limit=limit, since=since)
    return AuditResponse(rows=[AuditRow(**r) for r in rows])


@router.get("/verify", response_model=AuditVerifyResponse)
async def get_audit_verify(
    scope: Scope = Depends(get_current_scope),
    db: aiosqlite.Connection = Depends(get_db),
) -> AuditVerifyResponse:
    """
    Verify the integrity of the append-only SHA-256 hash chain.
    Verification is global, truthful for all callers including tenants.
    """
    result = await verify_audit_chain(db)
    return AuditVerifyResponse(**result)

