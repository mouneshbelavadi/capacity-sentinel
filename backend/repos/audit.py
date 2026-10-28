from typing import Any
import aiosqlite
from backend.repos.scope import Scope, SYSTEM_SCOPE, apply_scope


async def insert_audit_row(
    db: aiosqlite.Connection,
    seq: int,
    ts: str,
    actor: str,
    event: str,
    subject_json: str,
    payload_json: str,
    prev_hash: str,
    hash_: str,
    scope: Scope = SYSTEM_SCOPE,
) -> None:
    """Inserts a single hash-chained audit row. No UPDATE or DELETE path exists."""
    apply_scope("INSERT INTO audit", scope)
    await db.execute(
        """
        INSERT INTO audit (seq, ts, actor, event, subject_json, payload_json, prev_hash, hash)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (seq, ts, actor, event, subject_json, payload_json, prev_hash, hash_),
    )
    await db.commit()


async def query_audit_logs(
    db: aiosqlite.Connection,
    scope: Scope = SYSTEM_SCOPE,
    limit: int = 100,
    since: str | None = None,
) -> list[dict[str, Any]]:
    """
    Queries audit logs.
    For TENANT: scoped to their own actions or records where their tenant_id is in subject_json.
    """
    conditions = []
    params: list[Any] = []

    if since:
        conditions.append("ts >= ?")
        params.append(since)

    where_clause = f"WHERE {' AND '.join(conditions)}" if conditions else ""
    base_query = f"""
        SELECT seq, ts, actor, event, subject_json, payload_json, prev_hash, hash
        FROM audit
        {where_clause}
        ORDER BY seq DESC
        LIMIT ?
    """
    params.append(limit)

    scoped_query, scoped_params = apply_scope(
        base_query,
        scope,
        params=params,
        tenant_filter="(actor = ? OR subject_json LIKE '%' || ? || '%')",
    )

    # Note: if tenant_filter has two ?, adjust for tenant_id and user_id if needed
    if scope.role == "TENANT":
        # apply_scope inserted 1 param (tenant_id), let's ensure params match
        cursor = await db.execute(
            f"""
            SELECT seq, ts, actor, event, subject_json, payload_json, prev_hash, hash
            FROM audit
            WHERE (actor = ? OR subject_json LIKE '%' || ? || '%')
            ORDER BY seq DESC
            LIMIT ?
            """,
            (scope.user_id, scope.tenant_id, limit),
        )
    else:
        cursor = await db.execute(scoped_query, scoped_params)

    rows = await cursor.fetchall()
    return [dict(r) for r in rows]

