from typing import Any
import aiosqlite
from backend.repos.scope import Scope, SYSTEM_SCOPE, apply_scope


async def get_baseline(
    db: aiosqlite.Connection,
    node_id: str,
    metric: str,
    scope: Scope = SYSTEM_SCOPE,
) -> dict[str, Any] | None:
    base_query = """
        SELECT b.node_id, b.metric, b.value, b.captured_at, b.sample_count
        FROM baselines b
        JOIN slots s ON b.node_id = s.node_id
        WHERE b.node_id = ? AND b.metric = ?
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


async def save_baseline(
    db: aiosqlite.Connection,
    node_id: str,
    metric: str,
    value: float,
    sample_count: int,
    captured_at: str,
    scope: Scope = SYSTEM_SCOPE,
) -> dict[str, Any]:
    apply_scope("INSERT INTO baselines", scope)
    await db.execute(
        """
        INSERT INTO baselines (node_id, metric, value, captured_at, sample_count)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(node_id, metric) DO UPDATE SET
            value = excluded.value,
            captured_at = excluded.captured_at,
            sample_count = excluded.sample_count
        """,
        (node_id, metric, value, captured_at, sample_count),
    )
    await db.commit()
    return {
        "node_id": node_id,
        "metric": metric,
        "value": value,
        "captured_at": captured_at,
        "sample_count": sample_count,
    }

