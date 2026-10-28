from datetime import datetime, timezone
from typing import Any
import aiosqlite
from backend.repos.scope import Scope, SYSTEM_SCOPE, apply_scope


async def get_node(
    db: aiosqlite.Connection,
    node_id: str,
    scope: Scope = SYSTEM_SCOPE,
) -> dict[str, Any] | None:
    base_query = """
        SELECT n.node_id, n.rack_id, n.fw, n.last_seen_at, n.status, n.last_seq
        FROM nodes n
        LEFT JOIN slots s ON n.node_id = s.node_id
        WHERE n.node_id = ?
    """
    scoped_query, params = apply_scope(
        base_query,
        scope,
        params=[node_id],
        tenant_filter="s.tenant_id = ?",
    )
    cursor = await db.execute(scoped_query, params)
    row = await cursor.fetchone()
    if row is None:
        return None
    return dict(row)


async def update_node_presence(
    db: aiosqlite.Connection,
    node_id: str,
    status: str,
    seen_at: str | None = None,
    scope: Scope = SYSTEM_SCOPE,
) -> bool:
    """Updates node status ('OK', 'OFFLINE', etc.) and last_seen_at."""
    apply_scope("UPDATE nodes", scope)
    if seen_at is None:
        seen_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")

    cursor = await db.execute(
        """
        UPDATE nodes
        SET status = ?, last_seen_at = ?
        WHERE node_id = ?
        """,
        (status, seen_at, node_id),
    )
    await db.commit()
    return cursor.rowcount > 0


async def update_node_seq_and_status(
    db: aiosqlite.Connection,
    node_id: str,
    seq: int,
    fw: str | None = None,
    seen_at: str | None = None,
    scope: Scope = SYSTEM_SCOPE,
) -> bool:
    """Update last sequence number and mark node as OK / seen."""
    apply_scope("UPDATE nodes", scope)
    if seen_at is None:
        seen_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")

    if fw:
        cursor = await db.execute(
            """
            UPDATE nodes
            SET last_seq = ?, status = 'OK', fw = ?, last_seen_at = ?
            WHERE node_id = ?
            """,
            (seq, fw, seen_at, node_id),
        )
    else:
        cursor = await db.execute(
            """
            UPDATE nodes
            SET last_seq = ?, status = 'OK', last_seen_at = ?
            WHERE node_id = ?
            """,
            (seq, seen_at, node_id),
        )
    await db.commit()
    return cursor.rowcount > 0


async def list_nodes_in_rack(
    db: aiosqlite.Connection,
    rack_id: str,
    scope: Scope = SYSTEM_SCOPE,
) -> list[dict[str, Any]]:
    if scope.role == "TENANT":
        base_query = """
            SELECT n.node_id, n.rack_id, n.fw, n.last_seen_at, n.status, n.last_seq
            FROM nodes n
            JOIN slots s ON n.node_id = s.node_id
            WHERE n.rack_id = ?
        """
        scoped_query, params = apply_scope(
            base_query,
            scope,
            params=[rack_id],
            tenant_filter="s.tenant_id = ?",
        )
    else:
        base_query = "SELECT node_id, rack_id, fw, last_seen_at, status, last_seq FROM nodes WHERE rack_id = ?"
        scoped_query, params = apply_scope(base_query, scope, params=[rack_id])

    cursor = await db.execute(scoped_query, params)
    rows = await cursor.fetchall()
    return [dict(r) for r in rows]
