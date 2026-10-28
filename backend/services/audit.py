import asyncio
import hashlib
import json
from datetime import datetime, timezone
from typing import Any
import aiosqlite
from backend.core.logging import logger

GENESIS_PREV_HASH = "0" * 64

# Single-writer lock for audit chain per event loop to ensure concurrency safety
_audit_locks: dict[asyncio.AbstractEventLoop, asyncio.Lock] = {}


def get_audit_lock() -> asyncio.Lock:
    loop = asyncio.get_running_loop()
    if loop not in _audit_locks:
        _audit_locks[loop] = asyncio.Lock()
    return _audit_locks[loop]


def canonical_json(obj: Any) -> str:
    """Serialize object to canonical JSON: sorted keys, no whitespace, UTF-8."""
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def compute_audit_hash(
    prev_hash: str,
    seq: int,
    ts: str,
    actor: str,
    event: str,
    subject_json: str,
    payload_json: str,
) -> str:
    """
    Computes hash = SHA256(prev_hash || canonical_json(row_without_hash))
    """
    row_without_hash = {
        "actor": actor,
        "event": event,
        "payload_json": payload_json,
        "prev_hash": prev_hash,
        "seq": seq,
        "subject_json": subject_json,
        "ts": ts,
    }
    payload_str = prev_hash + canonical_json(row_without_hash)
    return hashlib.sha256(payload_str.encode("utf-8")).hexdigest()


async def append_audit_event(
    db: aiosqlite.Connection,
    event: str,
    actor: str,
    subject: dict[str, Any] | str,
    payload: dict[str, Any] | str,
    ts: str | None = None,
) -> dict[str, Any]:
    """
    Appends an audit event to the append-only audit table under a strict writer lock.
    Enforces hash chain continuity: hash = SHA256(prev_hash || canonical_json(row_without_hash)).
    NOTE: There is NO update and NO delete function for the audit table anywhere in this project.
    """
    if ts is None:
        ts = datetime.now(timezone.utc).isoformat()

    subject_json = canonical_json(subject) if isinstance(subject, dict) else subject
    payload_json = canonical_json(payload) if isinstance(payload, dict) else payload

    async with get_audit_lock():
        # Fetch the latest row
        cursor = await db.execute("SELECT seq, hash FROM audit ORDER BY seq DESC LIMIT 1")
        last_row = await cursor.fetchone()

        if last_row is None:
            seq = 1
            prev_hash = GENESIS_PREV_HASH
        else:
            seq = last_row["seq"] + 1
            prev_hash = last_row["hash"]

        curr_hash = compute_audit_hash(
            prev_hash=prev_hash,
            seq=seq,
            ts=ts,
            actor=actor,
            event=event,
            subject_json=subject_json,
            payload_json=payload_json,
        )

        from backend.repos.audit import insert_audit_row
        await insert_audit_row(
            db=db,
            seq=seq,
            ts=ts,
            actor=actor,
            event=event,
            subject_json=subject_json,
            payload_json=payload_json,
            prev_hash=prev_hash,
            hash_=curr_hash,
        )

        logger.info(
            f"Audit event appended: {event} (seq={seq})",
            extra={"extra_data": {"seq": seq, "event": event, "actor": actor, "hash": curr_hash}},
        )

        # Broadcast live audit append frame (carries seq, event, hash ONLY)
        try:
            from backend.services.broadcaster import broadcaster
            broadcaster.broadcast_audit_append(seq=seq, event=event, hash_=curr_hash)
        except Exception:
            pass

        return {
            "seq": seq,
            "ts": ts,
            "actor": actor,
            "event": event,
            "subject_json": subject_json,
            "payload_json": payload_json,
            "prev_hash": prev_hash,
            "hash": curr_hash,
        }


async def verify_audit_chain(db: aiosqlite.Connection) -> dict[str, Any]:
    """
    Verifies the integrity of the audit chain from genesis to head.
    Returns {"ok": bool, "rows_checked": int, "head_hash": str, "broken_at": int | None}
    """
    db.row_factory = aiosqlite.Row
    cursor = await db.execute(
        "SELECT seq, ts, actor, event, subject_json, payload_json, prev_hash, hash FROM audit ORDER BY seq ASC"
    )
    rows = await cursor.fetchall()

    if not rows:
        return {
            "ok": True,
            "rows_checked": 0,
            "head_hash": GENESIS_PREV_HASH,
            "broken_at": None,
        }

    head_hash = rows[-1]["hash"]
    expected_prev_hash = GENESIS_PREV_HASH

    for expected_seq, row in enumerate(rows, start=1):
        if row["seq"] != expected_seq:
            return {
                "ok": False,
                "rows_checked": len(rows),
                "head_hash": head_hash,
                "broken_at": row["seq"],
            }

        if row["prev_hash"] != expected_prev_hash:
            return {
                "ok": False,
                "rows_checked": len(rows),
                "head_hash": head_hash,
                "broken_at": row["seq"],
            }

        recomputed_hash = compute_audit_hash(
            prev_hash=row["prev_hash"],
            seq=row["seq"],
            ts=row["ts"],
            actor=row["actor"],
            event=row["event"],
            subject_json=row["subject_json"],
            payload_json=row["payload_json"],
        )
        if row["hash"] != recomputed_hash:
            return {
                "ok": False,
                "rows_checked": len(rows),
                "head_hash": head_hash,
                "broken_at": row["seq"],
            }

        expected_prev_hash = row["hash"]

    return {
        "ok": True,
        "rows_checked": len(rows),
        "head_hash": head_hash,
        "broken_at": None,
    }
