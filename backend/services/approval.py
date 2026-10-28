from datetime import datetime, timedelta, timezone
import hashlib
import hmac
import secrets
from typing import Any
import aiosqlite

from backend.core.logging import logger
from backend.repos.proposals import (
    RISK_TIERS,
    create_proposal,
    get_proposal,
    list_proposals,
    update_proposal_status,
)
from backend.repos.readers import (
    consume_nonce_atomic,
    create_nonce,
    expire_pending_nonces,
    get_nonce,
    get_pending_armed_action,
    get_reader_device,
    invalidate_proposal_nonces,
)
from backend.repos.scope import Scope, SYSTEM_SCOPE
from backend.repos.users import get_card
from backend.services.audit import append_audit_event

ACTION_ASCII_LINES = {
    "REDUCE_TENANT_LOAD": "REDUCE LOAD",
    "MIGRATE_TENANT": "MIGRATE TENANT",
    "INSPECT_FAN": "INSPECT FAN",
    "INCREASE_COOLING_SETPOINT_REQUEST": "INCR COOLING",
    "SCHEDULE_MAINTENANCE": "SCHEDULE MAINT",
    "NO_ACTION": "NO ACTION",
}


def _mask_uid(uid: str) -> str:
    """Mask card UID to preserve privacy in audit logs."""
    cleaned = uid.strip().upper()
    if len(cleaned) <= 4:
        return cleaned + "****"
    return cleaned[:4] + "****"


async def arm_proposal(
    db: aiosqlite.Connection,
    proposal_id: str,
    user_id: str,
    reader_device_id: str = "reader-01",
    scope: Scope = SYSTEM_SCOPE,
) -> dict[str, Any]:
    """
    Arms a proposal with a 60s single-use nonce bound to proposal and reader device.
    Only OPERATOR or SUPER_USER may call this.
    """
    if scope.role == "TENANT":
        raise PermissionError("TENANT role cannot approve proposals")

    proposal = await get_proposal(db, proposal_id, scope=scope)
    if not proposal:
        raise ValueError(f"Proposal '{proposal_id}' not found")

    if proposal["status"] in ("AUTHORIZED", "REJECTED", "EXPIRED"):
        raise ValueError(f"Cannot arm proposal in terminal state '{proposal['status']}'")

    now_dt = datetime.now(timezone.utc)
    now_iso = now_dt.isoformat().replace("+00:00", "Z")
    expires_dt = now_dt + timedelta(seconds=60)
    expires_at = expires_dt.isoformat().replace("+00:00", "Z")

    # Invalidate any prior unconsumed nonces for this proposal
    await invalidate_proposal_nonces(db, proposal_id, now_iso, scope=scope)

    # Generate single-use nonce
    nonce = secrets.token_urlsafe(32)

    await create_nonce(
        db=db,
        nonce=nonce,
        proposal_id=proposal_id,
        reader_device_id=reader_device_id,
        issued_at=now_iso,
        expires_at=expires_at,
        issued_by_user_id=user_id,
        scope=scope,
    )

    await update_proposal_status(db, proposal_id, "APPROVED_PENDING_TAP", scope=scope)

    # Append PROPOSAL_APPROVED to audit chain (never log raw nonce)
    await append_audit_event(
        db=db,
        event="PROPOSAL_APPROVED",
        actor=f"user:{user_id}",
        subject={"proposal_id": proposal_id},
        payload={
            "reader_device_id": reader_device_id,
            "expires_at": expires_at,
            "risk_tier": proposal["risk_tier"],
            "action": proposal["action"],
        },
    )

    return {
        "proposal_id": proposal_id,
        "status": "APPROVED_PENDING_TAP",
        "nonce": nonce,
        "expires_at": expires_at,
        "reader_device_id": reader_device_id,
    }


async def reject_proposal(
    db: aiosqlite.Connection,
    proposal_id: str,
    user_id: str,
    reason: str | None = None,
    scope: Scope = SYSTEM_SCOPE,
) -> dict[str, Any]:
    """Rejects a proposal and invalidates active nonces."""
    proposal = await get_proposal(db, proposal_id, scope=scope)
    if not proposal:
        raise ValueError(f"Proposal '{proposal_id}' not found")

    now_iso = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    await invalidate_proposal_nonces(db, proposal_id, now_iso, scope=scope)
    await update_proposal_status(db, proposal_id, "REJECTED", scope=scope)

    await append_audit_event(
        db=db,
        event="TAP_REJECTED",
        actor=f"user:{user_id}",
        subject={"proposal_id": proposal_id},
        payload={"reason": reason or "OPERATOR_REJECTED", "action": proposal["action"]},
    )

    return {"proposal_id": proposal_id, "status": "REJECTED"}


async def get_pending_for_reader(
    db: aiosqlite.Connection,
    device_id: str,
    scope: Scope = SYSTEM_SCOPE,
) -> dict[str, Any]:
    """
    Returns the armed proposal state with pre-rendered ASCII lines for TFT.
    If no active armed proposal exists or nonce expired, returns {"armed": False}.
    """
    device = await get_reader_device(db, device_id, scope=scope)
    if not device:
        return {"armed": False}

    row = await get_pending_armed_action(db, device_id, scope=scope)
    if not row:
        return {"armed": False}

    now_dt = datetime.now(timezone.utc)
    expires_dt = datetime.fromisoformat(row["expires_at"].replace("Z", "+00:00"))
    expires_in_s = int((expires_dt - now_dt).total_seconds())

    if expires_in_s <= 0:
        # Expired
        now_iso = now_dt.isoformat().replace("+00:00", "Z")
        await update_proposal_status(db, row["proposal_id"], "EXPIRED", scope=scope)
        await append_audit_event(
            db=db,
            event="TAP_REJECTED",
            actor="system:nonce_expiry",
            subject={"proposal_id": row["proposal_id"]},
            payload={"reason": "NONCE_EXPIRED"},
        )
        return {"armed": False}

    action_label = ACTION_ASCII_LINES.get(row["action"], row["action"].replace("_", " ")[:16])
    line1 = "".join(c for c in action_label if ord(c) < 128)
    line2_raw = f"Target: {row['target']}"
    line2 = "".join(c for c in line2_raw if ord(c) < 128)

    return {
        "armed": True,
        "proposal_id": row["proposal_id"],
        "nonce": row["nonce"],
        "expires_at": row["expires_at"],
        "expires_in_s": expires_in_s,
        "action": row["action"],
        "target": row["target"],
        "line1": line1,
        "line2": line2,
        "risk_tier": row["risk_tier"],
    }


async def process_rfid_tap(
    db: aiosqlite.Connection,
    device_id: str,
    uid: str,
    nonce: str,
    ts: int,
    hmac_str: str,
    scope: Scope = SYSTEM_SCOPE,
) -> dict[str, Any]:
    """
    Validates physical RFID tap strictly in the Contract §10 order:
    1. device_id registered -> else DEVICE_UNKNOWN
    2. HMAC valid -> else HMAC_INVALID (constant-time compare)
    3. |server_now - ts| <= 120s -> else CLOCK_SKEW
    4. nonce exists, unconsumed, unexpired, bound to device_id -> else NONCE_EXPIRED / NONCE_CONSUMED
    5. uid in cards, active, max_risk_tier >= proposal.risk_tier -> else UID_NOT_AUTHORIZED
    6. Consume atomically (rowcount == 1), transition to AUTHORIZED, append TAP_AUTHORIZED to audit.
    """
    clean_uid = uid.strip().upper()
    now_dt = datetime.now(timezone.utc)
    server_now_ts = int(now_dt.timestamp())
    now_iso = now_dt.isoformat().replace("+00:00", "Z")

    # 1. Device registered?
    device = await get_reader_device(db, device_id, scope=scope)
    if not device:
        await append_audit_event(
            db=db,
            event="TAP_REJECTED",
            actor=f"reader:{device_id}",
            subject={"device_id": device_id},
            payload={"reason": "DEVICE_UNKNOWN", "uid_masked": _mask_uid(clean_uid)},
        )
        return {"result": "REJECTED", "reason": "DEVICE_UNKNOWN", "message": "Unknown reader device"}

    # 2. HMAC valid?
    expected_msg = f"{device_id}|{clean_uid}|{nonce}|{ts}".encode("utf-8")
    device_secret = device["device_secret"].encode("utf-8")
    expected_hmac = hmac.new(device_secret, expected_msg, hashlib.sha256).hexdigest()

    if not hmac.compare_digest(expected_hmac.lower(), hmac_str.strip().lower()):
        await append_audit_event(
            db=db,
            event="TAP_REJECTED",
            actor=f"reader:{device_id}",
            subject={"device_id": device_id},
            payload={"reason": "HMAC_INVALID"},
        )
        return {"result": "REJECTED", "reason": "HMAC_INVALID", "message": "HMAC verification failed"}

    # 3. Clock skew <= 120s?
    skew = abs(server_now_ts - ts)
    if skew > 120:
        await append_audit_event(
            db=db,
            event="TAP_REJECTED",
            actor=f"reader:{device_id}",
            subject={"device_id": device_id},
            payload={"reason": "CLOCK_SKEW", "skew_seconds": skew},
        )
        return {"result": "REJECTED", "reason": "CLOCK_SKEW", "message": "Clock skew exceeds 120 seconds"}

    # 4. Nonce exists, unconsumed, unexpired, bound to device_id?
    nonce_row = await get_nonce(db, nonce, scope=scope)
    if not nonce_row or nonce_row["reader_device_id"] != device_id:
        await append_audit_event(
            db=db,
            event="TAP_REJECTED",
            actor=f"reader:{device_id}",
            subject={"device_id": device_id},
            payload={"reason": "NONCE_EXPIRED"},
        )
        return {"result": "REJECTED", "reason": "NONCE_EXPIRED", "message": "Nonce not found or unbound"}

    if nonce_row["consumed_at"] is not None:
        await append_audit_event(
            db=db,
            event="TAP_REJECTED",
            actor=f"reader:{device_id}",
            subject={"device_id": device_id, "proposal_id": nonce_row["proposal_id"]},
            payload={"reason": "NONCE_CONSUMED"},
        )
        return {"result": "REJECTED", "reason": "NONCE_CONSUMED", "message": "Nonce already consumed"}

    expires_dt = datetime.fromisoformat(nonce_row["expires_at"].replace("Z", "+00:00"))
    if now_dt > expires_dt:
        # Move proposal to EXPIRED
        await update_proposal_status(db, nonce_row["proposal_id"], "EXPIRED", scope=scope)
        await append_audit_event(
            db=db,
            event="TAP_REJECTED",
            actor=f"reader:{device_id}",
            subject={"device_id": device_id, "proposal_id": nonce_row["proposal_id"]},
            payload={"reason": "NONCE_EXPIRED"},
        )
        return {"result": "REJECTED", "reason": "NONCE_EXPIRED", "message": "Approval window elapsed"}

    # 5. UID in cards, active, max_risk_tier >= proposal.risk_tier?
    card = await get_card(db, clean_uid, scope=SYSTEM_SCOPE)
    if not card or card.get("active") != 1:
        await append_audit_event(
            db=db,
            event="TAP_REJECTED",
            actor=f"reader:{device_id}",
            subject={"device_id": device_id, "proposal_id": nonce_row["proposal_id"]},
            payload={"reason": "UID_NOT_AUTHORIZED", "uid_masked": _mask_uid(clean_uid)},
        )
        return {"result": "REJECTED", "reason": "UID_NOT_AUTHORIZED", "message": "Card not registered"}

    proposal = await get_proposal(db, nonce_row["proposal_id"], scope=SYSTEM_SCOPE)
    if not proposal:
        return {"result": "REJECTED", "reason": "NONCE_EXPIRED", "message": "Proposal not found"}

    card_tier = card.get("max_risk_tier", 1)
    prop_tier = RISK_TIERS.get(proposal["risk_tier"], 1)

    if card_tier < prop_tier:
        await append_audit_event(
            db=db,
            event="TAP_REJECTED",
            actor=f"reader:{device_id}",
            subject={"device_id": device_id, "proposal_id": proposal["proposal_id"]},
            payload={
                "reason": "UID_NOT_AUTHORIZED",
                "uid_masked": _mask_uid(clean_uid),
                "card_tier": card_tier,
                "proposal_tier": prop_tier,
            },
        )
        return {"result": "REJECTED", "reason": "UID_NOT_AUTHORIZED", "message": "Card risk tier insufficient"}

    # 6. Consume atomically (single UPDATE WHERE consumed_at IS NULL)
    consumed = await consume_nonce_atomic(db, nonce, now_iso, scope=scope)
    if not consumed:
        # Another concurrent tap won the race
        await append_audit_event(
            db=db,
            event="TAP_REJECTED",
            actor=f"reader:{device_id}",
            subject={"device_id": device_id, "proposal_id": proposal["proposal_id"]},
            payload={"reason": "NONCE_CONSUMED"},
        )
        return {"result": "REJECTED", "reason": "NONCE_CONSUMED", "message": "Nonce already consumed"}

    # Mark proposal AUTHORIZED
    await update_proposal_status(db, proposal["proposal_id"], "AUTHORIZED", scope=scope)

    actor_name = card.get("display_name") or f"Cardholder {clean_uid[-4:]}"

    # Log TAP_AUTHORIZED to append-only audit chain
    audit_row = await append_audit_event(
        db=db,
        event="TAP_AUTHORIZED",
        actor=f"user:{card['user_id']}",
        subject={"proposal_id": proposal["proposal_id"], "device_id": device_id},
        payload={
            "uid_masked": _mask_uid(clean_uid),
            "risk_tier": proposal["risk_tier"],
            "target": proposal["target"],
            "action": proposal["action"],
        },
    )

    return {
        "result": "AUTHORIZED",
        "proposal_id": proposal["proposal_id"],
        "actor": actor_name,
        "audit_hash": audit_row["hash"],
        "message": "Authorized",
    }


async def reap_expired_proposals(
    db: aiosqlite.Connection,
    scope: Scope = SYSTEM_SCOPE,
) -> list[str]:
    """Background task to expire proposals past their TTL."""
    now_iso = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    expired_ids = await expire_pending_nonces(db, now_iso, scope=scope)
    for pid in expired_ids:
        await append_audit_event(
            db=db,
            event="TAP_REJECTED",
            actor="system:nonce_expiry",
            subject={"proposal_id": pid},
            payload={"reason": "NONCE_EXPIRED"},
        )
    return expired_ids

