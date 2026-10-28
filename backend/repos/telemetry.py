from typing import Any
import aiosqlite
from backend.repos.scope import Scope, SYSTEM_SCOPE, apply_scope


async def insert_telemetry_batch(
    db: aiosqlite.Connection,
    rows: list[dict[str, Any]],
    scope: Scope = SYSTEM_SCOPE,
) -> int:
    """Inserts normalised telemetry rows into the database."""
    apply_scope("INSERT INTO telemetry", scope)
    if not rows:
        return 0

    await db.executemany(
        """
        INSERT INTO telemetry (node_id, metric, ts, received_at, value, quality, seq, backfilled)
        VALUES (:node_id, :metric, :ts, :received_at, :value, :quality, :seq, :backfilled)
        """,
        rows,
    )
    await db.commit()
    return len(rows)


async def query_node_telemetry(
    db: aiosqlite.Connection,
    node_id: str,
    metric: str,
    from_ts: str | None = None,
    to_ts: str | None = None,
    limit: int = 1000,
    scope: Scope = SYSTEM_SCOPE,
) -> list[dict[str, Any]]:
    """
    Queries telemetry points for a node and metric between from_ts and to_ts.
    Indexed on (node_id, metric, ts), filtered by tenant scope.
    """
    conditions = ["node_id = ?", "metric = ?"]
    params: list[Any] = [node_id, metric]

    if from_ts:
        conditions.append("ts >= ?")
        params.append(from_ts)
    if to_ts:
        conditions.append("ts <= ?")
        params.append(to_ts)

    where_clause = " AND ".join(conditions)
    base_query = f"""
        SELECT ts, value, quality, received_at
        FROM telemetry
        WHERE {where_clause}
        ORDER BY ts ASC
        LIMIT ?
    """
    params.append(limit)

    scoped_query, scoped_params = apply_scope(
        base_query,
        scope,
        params=params,
        tenant_filter="node_id IN (SELECT node_id FROM slots WHERE tenant_id = ?)",
    )

    cursor = await db.execute(scoped_query, scoped_params)
    rows = await cursor.fetchall()
    return [dict(r) for r in rows]


async def get_latest_node_metric(
    db: aiosqlite.Connection,
    node_id: str,
    metric: str,
    scope: Scope = SYSTEM_SCOPE,
) -> dict[str, Any] | None:
    """Gets the single latest telemetry point for a node and metric, scoped."""
    base_query = """
        SELECT ts, value, quality, received_at
        FROM telemetry
        WHERE node_id = ? AND metric = ?
        ORDER BY ts DESC
        LIMIT 1
    """
    scoped_query, scoped_params = apply_scope(
        base_query,
        scope,
        params=[node_id, metric],
        tenant_filter="node_id IN (SELECT node_id FROM slots WHERE tenant_id = ?)",
    )

    cursor = await db.execute(scoped_query, scoped_params)
    row = await cursor.fetchone()
    if row is None:
        return None
    return dict(row)
