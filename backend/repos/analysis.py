from typing import Any
import json
import aiosqlite
from backend.repos.scope import Scope, SYSTEM_SCOPE, apply_scope


async def get_cached_forecast_by_id(
    db: aiosqlite.Connection,
    forecast_id: str,
    scope: Scope = SYSTEM_SCOPE,
) -> dict[str, Any] | None:
    base_query = """
        SELECT f.node_id, f.metric, f.forecast_id, f.computed_at, f.payload_json
        FROM forecast_cache f
        JOIN slots s ON f.node_id = s.node_id
        WHERE f.forecast_id = ?
    """
    scoped_query, params = apply_scope(
        base_query,
        scope,
        params=[forecast_id],
        tenant_filter="s.tenant_id = ?",
    )
    cursor = await db.execute(scoped_query, params)
    row = await cursor.fetchone()
    if row is None:
        return None
    d = dict(row)
    d["payload"] = json.loads(d["payload_json"])
    return d


async def query_cached_forecasts(
    db: aiosqlite.Connection,
    node_id: str | None = None,
    scope: Scope = SYSTEM_SCOPE,
) -> list[dict[str, Any]]:
    conditions = []
    params: list[Any] = []
    if node_id:
        conditions.append("f.node_id = ?")
        params.append(node_id)
    where_clause = f"WHERE {' AND '.join(conditions)}" if conditions else ""
    base_query = f"""
        SELECT f.node_id, f.metric, f.forecast_id, f.computed_at, f.payload_json
        FROM forecast_cache f
        JOIN slots s ON f.node_id = s.node_id
        {where_clause}
    """
    scoped_query, scoped_params = apply_scope(
        base_query,
        scope,
        params=params,
        tenant_filter="s.tenant_id = ?",
    )
    cursor = await db.execute(scoped_query, scoped_params)
    rows = await cursor.fetchall()
    results = []
    for r in rows:
        d = dict(r)
        d["payload"] = json.loads(d["payload_json"])
        results.append(d)
    return results


async def get_cached_forecast(
    db: aiosqlite.Connection,
    node_id: str,
    metric: str,
    scope: Scope = SYSTEM_SCOPE,
) -> dict[str, Any] | None:
    base_query = """
        SELECT f.node_id, f.metric, f.forecast_id, f.computed_at, f.payload_json
        FROM forecast_cache f
        JOIN slots s ON f.node_id = s.node_id
        WHERE f.node_id = ? AND f.metric = ?
    """
    scoped_query, params = apply_scope(
        base_query,
        scope,
        params=[node_id, metric],
        tenant_filter="s.tenant_id = ?",
    )
    cursor = await db.execute(scoped_query, params)
    row = await cursor.fetchone()
    if row is None:
        return None
    return dict(row)


async def save_cached_forecast(
    db: aiosqlite.Connection,
    node_id: str,
    metric: str,
    forecast_id: str,
    payload_json: str,
    computed_at: str,
    scope: Scope = SYSTEM_SCOPE,
) -> None:
    apply_scope("INSERT INTO forecast_cache", scope)
    await db.execute(
        """
        INSERT INTO forecast_cache (node_id, metric, forecast_id, computed_at, payload_json)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(node_id, metric) DO UPDATE SET
            forecast_id = excluded.forecast_id,
            computed_at = excluded.computed_at,
            payload_json = excluded.payload_json
        """,
        (node_id, metric, forecast_id, computed_at, payload_json),
    )
    await db.commit()


async def query_changepoints(
    db: aiosqlite.Connection,
    node_id: str | None = None,
    since: str | None = None,
    scope: Scope = SYSTEM_SCOPE,
) -> list[dict[str, Any]]:
    conditions = []
    params: list[Any] = []

    if node_id:
        conditions.append("c.node_id = ?")
        params.append(node_id)
    if since:
        conditions.append("c.detected_at >= ?")
        params.append(since)

    where_clause = f"WHERE {' AND '.join(conditions)}" if conditions else ""
    base_query = f"""
        SELECT c.cp_id, c.node_id, c.metric, c.detected_at, c.located_at,
               c.detector, c.confirmed, c.before_mean, c.after_mean, c.delta,
               c.topology_event_json, c.meta_json
        FROM changepoints c
        JOIN slots s ON c.node_id = s.node_id
        {where_clause}
        ORDER BY c.detected_at DESC
        LIMIT 50
    """
    scoped_query, scoped_params = apply_scope(
        base_query,
        scope,
        params=params,
        tenant_filter="s.tenant_id = ?",
    )
    cursor = await db.execute(scoped_query, scoped_params)
    rows = await cursor.fetchall()
    return [dict(r) for r in rows]


async def save_changepoint(
    db: aiosqlite.Connection,
    cp: dict[str, Any],
    scope: Scope = SYSTEM_SCOPE,
) -> None:
    apply_scope("INSERT INTO changepoints", scope)
    await db.execute(
        """
        INSERT INTO changepoints (
            cp_id, node_id, metric, detected_at, located_at, detector, confirmed,
            before_mean, after_mean, delta, topology_event_json, meta_json
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(cp_id) DO NOTHING
        """,
        (
            cp["cp_id"],
            cp["node_id"],
            cp["metric"],
            cp["detected_at"],
            cp["located_at"],
            cp["detector"],
            1 if cp.get("confirmed", True) else 0,
            cp["shift"]["before_mean"],
            cp["shift"]["after_mean"],
            cp["shift"]["delta"],
            cp.get("topology_event_json"),
            cp.get("meta_json", "{}"),
        ),
    )
    await db.commit()

