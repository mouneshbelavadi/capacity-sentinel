from datetime import datetime, timezone
import secrets
from typing import Any
import aiosqlite
from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field

from backend.api.deps import get_current_scope
from backend.api.errors import APIContractError
from backend.db.connection import get_db
from backend.repos.proposals import (
    RISK_TIERS,
    WHITELISTED_ACTIONS,
    create_proposal,
    get_proposal,
    list_proposals,
)
from backend.repos.scope import Scope
from backend.services.approval import arm_proposal, reject_proposal
from backend.services.audit import append_audit_event

router = APIRouter(prefix="/api/proposals", tags=["proposals"])


class ProposalCreateRequest(BaseModel):
    action: str
    target: str
    rationale: str
    expected_effect: str
    evidence: list[str] = Field(default_factory=list)
    risk_tier: str = "LOW"
    scope: dict[str, Any] = Field(default_factory=dict)
    model: str = "operator_manual"


class ProposalApproveRequest(BaseModel):
    reader_device_id: str = "reader-01"


class ProposalRejectRequest(BaseModel):
    reason: str | None = None


@router.post("")
async def post_proposal(
    req: ProposalCreateRequest,
    scope: Scope = Depends(get_current_scope),
    db: aiosqlite.Connection = Depends(get_db),
) -> dict[str, Any]:
    """
    Operator-triggered proposal creation endpoint.
    Validates action against whitelist and risk_tier.
    """
    if req.action not in WHITELISTED_ACTIONS:
        await append_audit_event(
            db=db,
            event="AI_EVIDENCE_INVALID",
            actor=f"user:{scope.user_id}",
            subject={"action": req.action},
            payload={"reason": "AI_ACTION_NOT_WHITELISTED"},
        )
        raise APIContractError(
            code="AI_ACTION_NOT_WHITELISTED",
            message=f"Action '{req.action}' is not in the closed whitelist",
            status_code=400,
        )

    if req.risk_tier not in RISK_TIERS:
        raise APIContractError(
            code="VALIDATION_ERROR",
            message=f"Invalid risk_tier '{req.risk_tier}'",
            status_code=400,
        )

    now_iso = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    proposal_id = f"pr_{secrets.token_hex(4)}"

    proposal_data = {
        "proposal_id": proposal_id,
        "created_at": now_iso,
        "scope": req.scope,
        "action": req.action,
        "target": req.target,
        "rationale": req.rationale,
        "expected_effect": req.expected_effect,
        "evidence": req.evidence,
        "risk_tier": req.risk_tier,
        "status": "PROPOSED",
        "model": req.model,
        "updated_at": now_iso,
    }

    created = await create_proposal(db, proposal_data, scope=scope)

    await append_audit_event(
        db=db,
        event="AI_PROPOSAL",
        actor=f"user:{scope.user_id}",
        subject={"proposal_id": proposal_id},
        payload={
            "action": req.action,
            "target": req.target,
            "risk_tier": req.risk_tier,
        },
    )

    return created


@router.get("")
async def get_proposals(
    status: str | None = Query(None),
    scope: Scope = Depends(get_current_scope),
    db: aiosqlite.Connection = Depends(get_db),
) -> dict[str, Any]:
    """
    Returns scoped list of proposals.
    Supports comma-separated status filtering (e.g. status=PROPOSED,DISCUSSING,APPROVED_PENDING_TAP).
    """
    all_proposals = await list_proposals(db, status=None, scope=scope)

    if status:
        allowed = {s.strip() for s in status.split(",") if s.strip()}
        all_proposals = [p for p in all_proposals if p.get("status") in allowed]

    return {"proposals": all_proposals}


@router.get("/{proposal_id}")
async def get_single_proposal(
    proposal_id: str,
    scope: Scope = Depends(get_current_scope),
    db: aiosqlite.Connection = Depends(get_db),
) -> dict[str, Any]:
    proposal = await get_proposal(db, proposal_id, scope=scope)
    if not proposal:
        raise APIContractError(code="NOT_FOUND", message=f"Proposal '{proposal_id}' not found", status_code=404)
    return proposal


@router.post("/{proposal_id}/approve")
async def approve_proposal_endpoint(
    proposal_id: str,
    req: ProposalApproveRequest = ProposalApproveRequest(),
    scope: Scope = Depends(get_current_scope),
    db: aiosqlite.Connection = Depends(get_db),
) -> dict[str, Any]:
    """
    Approves a proposal and arms the RFID reader with a 60s single-use nonce.
    A TENANT gets 404 (Contract §10).
    """
    if scope.role == "TENANT":
        raise APIContractError(code="NOT_FOUND", message=f"Proposal '{proposal_id}' not found", status_code=404)

    proposal = await get_proposal(db, proposal_id, scope=scope)
    if not proposal:
        raise APIContractError(code="NOT_FOUND", message=f"Proposal '{proposal_id}' not found", status_code=404)

    try:
        res = await arm_proposal(
            db=db,
            proposal_id=proposal_id,
            user_id=scope.user_id,
            reader_device_id=req.reader_device_id,
            scope=scope,
        )
        return res
    except PermissionError:
        raise APIContractError(code="NOT_FOUND", message=f"Proposal '{proposal_id}' not found", status_code=404)
    except ValueError as e:
        raise APIContractError(code="VALIDATION_ERROR", message=str(e), status_code=400)


@router.post("/{proposal_id}/reject")
async def reject_proposal_endpoint(
    proposal_id: str,
    req: ProposalRejectRequest = ProposalRejectRequest(),
    scope: Scope = Depends(get_current_scope),
    db: aiosqlite.Connection = Depends(get_db),
) -> dict[str, Any]:
    """Rejects proposal and invalidates active nonces."""
    proposal = await get_proposal(db, proposal_id, scope=scope)
    if not proposal:
        raise APIContractError(code="NOT_FOUND", message=f"Proposal '{proposal_id}' not found", status_code=404)

    try:
        res = await reject_proposal(
            db=db,
            proposal_id=proposal_id,
            user_id=scope.user_id,
            reason=req.reason,
            scope=scope,
        )
        return res
    except ValueError as e:
        raise APIContractError(code="VALIDATION_ERROR", message=str(e), status_code=400)

