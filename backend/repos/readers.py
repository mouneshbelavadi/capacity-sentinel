from datetime import datetime, timezone
import hashlib
from typing import Any
import aiosqlite
from backend.repos.scope import Scope, SYSTEM_SCOPE, apply_scope


async def register_reader_device(
    db: aiosqlite.Connection,
    device_id: str,
    device_secret: str,
    label: str,
    scope: Scope = SYSTEM_SCOPE,
) -> dict[str, Any]:
    """Registers or updates a physical reader device."""
    apply_scope("INSERT INTO reader_devices", scope)
    now_iso = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    secret_hash = hashlib.sha256(device_secret.encode("utf-8")).hexdigest()

    await db.execute(
        """
        INSERT INTO reader_devices (device_id, device_secret, secret_hash, label, registered_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(device_id) DO UPDATE SET
            device_secret = excluded.device_secret,
            secret_hash = excluded.secret_hash,
            label = excluded.label
        """,
        (device_id, device_secret, secret_hash, label, now_iso),
    )
    await db.commit()
    return {
        "device_id": device_id,
        "label": label,
        "registered_at": now_iso,
    }


async def get_reader_device(
    db: aiosqlite.Connection,
    device_id: str,
    scope: Scope = SYSTEM_SCOPE,
) -> dict[str, Any] | None:
    """Retrieves reader device info and shared secret."""
    base_query = (
        "SELECT device_id, device_secret, secret_hash, label, registered_at, last_seen_at, last_fw, last_rssi "
        "FROM reader_devices WHERE device_id = ?"
    )
    scoped_query, params = apply_scope(base_query, scope, params=[device_id])
    cursor = await db.execute(scoped_query, params)
    row = await cursor.fetchone()
    if not row:
        return None
    return dict(row)


async def update_reader_heartbeat(
    db: aiosqlite.Connection,
    device_id: str,
    fw: str,
    rssi: int,
    scope: Scope = SYSTEM_SCOPE,
) -> bool:
    """Updates reader last seen time, fw version and rssi."""
    apply_scope("UPDATE reader_devices", scope)
    now_iso = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    cursor = await db.execute(
        """
        UPDATE reader_devices
        SET last_seen_at = ?, last_fw = ?, last_rssi = ?
        WHERE device_id = ?
        """,
        (now_iso, fw, rssi, device_id),
    )
    await db.commit()
    return cursor.rowcount > 0


async def create_nonce(
    db: aiosqlite.Connection,
    nonce: str,
    proposal_id: str,
    reader_device_id: str,
    issued_at: str,
    expires_at: str,
    issued_by_user_id: str,
    scope: Scope = SYSTEM_SCOPE,
) -> dict[str, Any]:
    """Creates a single-use 60s TTL nonce bound to proposal and reader device."""
    apply_scope("INSERT INTO nonces", scope)
    await db.execute(
        """
        INSERT INTO nonces (nonce, proposal_id, reader_device_id, issued_at, expires_at, consumed_at, issued_by_user_id)
        VALUES (?, ?, ?, ?, ?, NULL, ?)
        """,
        (nonce, proposal_id, reader_device_id, issued_at, expires_at, issued_by_user_id),
    )
    await db.commit()
    return {
        "nonce": nonce,
        "proposal_id": proposal_id,
        "reader_device_id": reader_device_id,
        "issued_at": issued_at,
        "expires_at": expires_at,
        "issued_by_user_id": issued_by_user_id,
    }


async def get_nonce(
    db: aiosqlite.Connection,
    nonce: str,
    scope: Scope = SYSTEM_SCOPE,
) -> dict[str, Any] | None:
    """Retrieves nonce information."""
    base_query = (
        "SELECT nonce, proposal_id, reader_device_id, issued_at, expires_at, consumed_at, issued_by_user_id "
        "FROM nonces WHERE nonce = ?"
    )
    scoped_query, params = apply_scope(base_query, scope, params=[nonce])
    cursor = await db.execute(scoped_query, params)
    row = await cursor.fetchone()
    if not row:
        return None
    return dict(row)


async def consume_nonce_atomic(
    db: aiosqlite.Connection,
    nonce: str,
    consumed_at: str,
    scope: Scope = SYSTEM_SCOPE,
) -> bool:
    """
    Atomically consumes a nonce using UPDATE ... WHERE consumed_at IS NULL.
    Returns True if exactly 1 row was updated, False if 0 (another concurrent tap won).
    """
    apply_scope("UPDATE nonces", scope)
    cursor = await db.execute(
        """
        UPDATE nonces
        SET consumed_at = ?
        WHERE nonce = ? AND consumed_at IS NULL
        """,
        (consumed_at, nonce),
    )
    await db.commit()
    return cursor.rowcount == 1


async def invalidate_proposal_nonces(
    db: aiosqlite.Connection,
    proposal_id: str,
    now_iso: str,
    scope: Scope = SYSTEM_SCOPE,
) -> int:
    """Invalidates any pending unconsumed nonces for a proposal when re-armed or rejected."""
    apply_scope("UPDATE nonces", scope)
    cursor = await db.execute(
        """
        UPDATE nonces
        SET consumed_at = ?
        WHERE proposal_id = ? AND consumed_at IS NULL
        """,
        (now_iso, proposal_id),
    )
    await db.commit()
    return cursor.rowcount


async def get_pending_armed_action(
    db: aiosqlite.Connection,
    device_id: str,
    scope: Scope = SYSTEM_SCOPE,
) -> dict[str, Any] | None:
    """
    Finds the latest armed proposal with an unconsumed nonce bound to device_id.
    """
    base_query = (
        "SELECT n.nonce, n.proposal_id, n.reader_device_id, n.issued_at, n.expires_at, "
        "       p.action, p.target, p.rationale, p.risk_tier, p.status, p.scope_json "
        "FROM nonces n "
        "JOIN proposals p ON n.proposal_id = p.proposal_id "
        "WHERE n.reader_device_id = ? AND n.consumed_at IS NULL AND p.status = 'APPROVED_PENDING_TAP' "
        "ORDER BY n.issued_at DESC LIMIT 1"
    )
    scoped_query, params = apply_scope(base_query, scope, params=[device_id])
    cursor = await db.execute(scoped_query, params)
    row = await cursor.fetchone()
    if not row:
        return None
    return dict(row)


async def expire_pending_nonces(
    db: aiosqlite.Connection,
    now_iso: str,
    scope: Scope = SYSTEM_SCOPE,
) -> list[str]:
    """
    Finds proposals in APPROVED_PENDING_TAP whose nonces have all expired,
    moves them to EXPIRED, and returns list of expired proposal IDs.
    """
    apply_scope("SELECT nonces / UPDATE proposals", scope)
    # Find all proposals in APPROVED_PENDING_TAP where all nonces have expires_at < now_iso
    cursor = await db.execute(
        """
        SELECT DISTINCT p.proposal_id
        FROM proposals p
        JOIN nonces n ON p.proposal_id = n.proposal_id
        WHERE p.status = 'APPROVED_PENDING_TAP'
        GROUP BY p.proposal_id
        HAVING MAX(n.expires_at) < ?
        """,
        (now_iso,),
    )
    rows = await cursor.fetchall()
    expired_ids = [r[0] for r in rows]

    if expired_ids:
        placeholders = ",".join("?" for _ in expired_ids)
        await db.execute(
            f"UPDATE proposals SET status = 'EXPIRED', updated_at = ? WHERE proposal_id IN ({placeholders})",
            [now_iso, *expired_ids],
        )
        await db.commit()

    return expired_ids

