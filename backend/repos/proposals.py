from datetime import datetime, timezone
import json
from typing import Any
import aiosqlite
from backend.repos.scope import Scope, SYSTEM_SCOPE, apply_scope

WHITELISTED_ACTIONS = {
    "REDUCE_TENANT_LOAD",
    "MIGRATE_TENANT",
    "INSPECT_FAN",
    "INCREASE_COOLING_SETPOINT_REQUEST",
    "SCHEDULE_MAINTENANCE",
    "NO_ACTION",
}

VALID_STATUSES = {
    "PROPOSED",
    "DISCUSSING",
    "APPROVED_PENDING_TAP",
    "AUTHORIZED",
    "REJECTED",
    "EXPIRED",
}

RISK_TIERS = {"LOW": 1, "MEDIUM": 2, "HIGH": 3}


async def create_proposal(
    db: aiosqlite.Connection,
    proposal: dict[str, Any],
    scope: Scope = SYSTEM_SCOPE,
) -> dict[str, Any]:
    """Inserts a new proposal in PROPOSED state."""
    apply_scope("INSERT INTO proposals", scope)
    now_iso = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")

    action = proposal["action"]
    if action not in WHITELISTED_ACTIONS:
        raise ValueError(f"Action '{action}' is not in the closed whitelist")

    scope_json = json.dumps(proposal.get("scope", {}))
    evidence_json = json.dumps(proposal.get("evidence", []))
    status = proposal.get("status", "PROPOSED")
    risk_tier = proposal.get("risk_tier", "LOW")

    await db.execute(
        """
        INSERT INTO proposals (
            proposal_id, created_at, scope_json, action, target, rationale,
            expected_effect, evidence_json, risk_tier, status, model, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            proposal["proposal_id"],
            proposal.get("created_at", now_iso),
            scope_json,
            action,
            proposal["target"],
            proposal["rationale"],
            proposal["expected_effect"],
            evidence_json,
            risk_tier,
            status,
            proposal.get("model", "operator_manual"),
            now_iso,
        ),
    )
    await db.commit()
    return proposal


async def get_proposal(
    db: aiosqlite.Connection,
    proposal_id: str,
    scope: Scope = SYSTEM_SCOPE,
) -> dict[str, Any] | None:
    """Fetches a proposal by ID, scoped to the caller."""
    base_query = """
        SELECT proposal_id, created_at, scope_json, action, target, rationale,
               expected_effect, evidence_json, risk_tier, status, model, updated_at
        FROM proposals
        WHERE proposal_id = ?
    """
    scoped_query, params = apply_scope(
        base_query,
        scope,
        params=[proposal_id],
        tenant_filter="scope_json LIKE '%' || ? || '%'",
    )
    cursor = await db.execute(scoped_query, params)
    row = await cursor.fetchone()
    if not row:
        return None

    res = dict(row)
    res["scope"] = json.loads(res["scope_json"])
    res["evidence"] = json.loads(res["evidence_json"])
    return res


async def list_proposals(
    db: aiosqlite.Connection,
    status: str | None = None,
    scope: Scope = SYSTEM_SCOPE,
) -> list[dict[str, Any]]:
    """Lists proposals, filtered by status and scoped to caller."""
    conditions = []
    params: list[Any] = []
    if status:
        conditions.append("status = ?")
        params.append(status)

    where_clause = f"WHERE {' AND '.join(conditions)}" if conditions else ""
    base_query = f"""
        SELECT proposal_id, created_at, scope_json, action, target, rationale,
               expected_effect, evidence_json, risk_tier, status, model, updated_at
        FROM proposals
        {where_clause}
        ORDER BY created_at DESC
    """
    scoped_query, scoped_params = apply_scope(
        base_query,
        scope,
        params=params,
        tenant_filter="scope_json LIKE '%' || ? || '%'",
    )

    cursor = await db.execute(scoped_query, scoped_params)
    rows = await cursor.fetchall()

    results = []
    for r in rows:
        d = dict(r)
        d["scope"] = json.loads(d["scope_json"])
        d["evidence"] = json.loads(d["evidence_json"])
        results.append(d)
    return results


async def update_proposal_status(
    db: aiosqlite.Connection,
    proposal_id: str,
    new_status: str,
    scope: Scope = SYSTEM_SCOPE,
) -> bool:
    """Updates proposal state."""
    apply_scope("UPDATE proposals", scope)
    now_iso = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    cursor = await db.execute(
        """
        UPDATE proposals
        SET status = ?, updated_at = ?
        WHERE proposal_id = ?
        """,
        (new_status, now_iso, proposal_id),
    )
    await db.commit()
    return cursor.rowcount > 0

