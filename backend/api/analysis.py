from datetime import datetime, timezone
import json
from typing import Any
import aiosqlite
from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel

from backend.api.deps import get_current_scope, record_scope_denial
from backend.api.errors import APIContractError
from backend.db.connection import get_db
from backend.repos.analysis import get_cached_forecast, query_changepoints, save_cached_forecast
from backend.repos.baselines import get_baseline, save_baseline
from backend.repos.nodes import get_node
from backend.repos.scope import Scope, is_node_allowed
from backend.repos.telemetry import query_node_telemetry
from backend.services.attribution import compute_attribution
from backend.services.forecast import compute_forecast
from backend.services.power import estimate_power

router = APIRouter(prefix="/api", tags=["analysis"])


# -------------------------------------------------------------
# 1. Forecast endpoint
# -------------------------------------------------------------
@router.get("/forecast/{node_id}/{metric}")
async def get_forecast(
    node_id: str,
    metric: str,
    scope: Scope = Depends(get_current_scope),
    db: aiosqlite.Connection = Depends(get_db),
) -> dict[str, Any]:
    # 1. Check scope access
    allowed = await is_node_allowed(db, node_id, scope)
    if not allowed:
        await record_scope_denial(db, scope, "forecast", node_id)
        raise APIContractError(code="NOT_FOUND", message="Node not found", status_code=404)

    # 2. Check if baseline required (for relative metrics)
    baseline_record = await get_baseline(db, node_id, metric, scope=scope)
    baseline_val = baseline_record["value"] if baseline_record else None
    if metric in ("mq_ratio", "vib_rms_g") and baseline_val is None:
        raise APIContractError(
            code="FORECAST_INSUFFICIENT_DATA",
            message=f"No baseline captured for metric '{metric}' on node '{node_id}'",
            status_code=400,
        )

    # 3. Read cached forecast
    cached = await get_cached_forecast(db, node_id, metric, scope=scope)
    if cached:
        return json.loads(cached["payload_json"])

    # Fallback compute if cache empty
    raw_points = await query_node_telemetry(db, node_id, metric, limit=180, scope=scope)
    forecast = compute_forecast(
        node_id=node_id,
        metric=metric,
        points=raw_points,
        baseline_val=baseline_val,
    )
    now_iso = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    await save_cached_forecast(
        db,
        node_id=node_id,
        metric=metric,
        forecast_id=forecast["forecast_id"],
        payload_json=json.dumps(forecast),
        computed_at=now_iso,
        scope=scope,
    )
    return forecast


# -------------------------------------------------------------
# 2. Change points endpoint
# -------------------------------------------------------------
@router.get("/changepoints")
async def get_changepoints_route(
    node_id: str | None = Query(None),
    since: str | None = Query(None),
    scope: Scope = Depends(get_current_scope),
    db: aiosqlite.Connection = Depends(get_db),
) -> dict[str, Any]:
    if node_id:
        allowed = await is_node_allowed(db, node_id, scope)
        if not allowed:
            await record_scope_denial(db, scope, "changepoints", node_id)
            raise APIContractError(code="NOT_FOUND", message="Node not found", status_code=404)

    raw_cps = await query_changepoints(db, node_id=node_id, since=since, scope=scope)
    results = []
    for r in raw_cps:
        results.append({
            "cp_id": r["cp_id"],
            "node_id": r["node_id"],
            "metric": r["metric"],
            "detected_at": r["detected_at"],
            "located_at": r["located_at"],
            "detector": r["detector"],
            "confirmed": bool(r["confirmed"]),
            "shift": {
                "before_mean": r["before_mean"],
                "after_mean": r["after_mean"],
                "delta": r["delta"],
            },
            "topology_event": json.loads(r["topology_event_json"]) if r["topology_event_json"] else None,
            "meta": json.loads(r["meta_json"]) if r["meta_json"] else {},
        })
    return {"changepoints": results}


# -------------------------------------------------------------
# 3. Attribution endpoint
# -------------------------------------------------------------
@router.get("/attribution/{rack_id}")
async def get_attribution_route(
    rack_id: str,
    metric: str = Query("t_c"),
    scope: Scope = Depends(get_current_scope),
    db: aiosqlite.Connection = Depends(get_db),
) -> dict[str, Any]:
    # Check rack existence
    cursor = await db.execute("SELECT rack_id FROM racks WHERE rack_id = ?", (rack_id,))
    if not await cursor.fetchone():
        raise APIContractError(code="NOT_FOUND", message="Rack not found", status_code=404)

    # Scoped tenant check
    if scope.role == "TENANT":
        slot_cur = await db.execute("SELECT slot_id FROM slots WHERE rack_id = ? AND tenant_id = ?", (rack_id, scope.tenant_id))
        if not await slot_cur.fetchone():
            await record_scope_denial(db, scope, "attribution", rack_id)
            raise APIContractError(code="NOT_FOUND", message="Rack not found", status_code=404)

    # Fetch tenant nodes for this rack
    nodes_cur = await db.execute(
        """
        SELECT s.slot_id, s.node_id, s.tenant_id, t.label as tenant_label
        FROM slots s
        LEFT JOIN tenants t ON s.tenant_id = t.tenant_id
        WHERE s.rack_id = ?
        """,
        (rack_id,),
    )
    tenant_nodes = [dict(r) for r in await nodes_cur.fetchall()]

    # Fetch recent changepoint if any
    recent_cps = await query_changepoints(db, scope=scope)
    latest_cp = None
    if recent_cps:
        raw_cp = recent_cps[0]
        latest_cp = {
            "cp_id": raw_cp["cp_id"],
            "located_at": raw_cp["located_at"],
            "topology_event": json.loads(raw_cp["topology_event_json"]) if raw_cp.get("topology_event_json") else None,
        }

    attr = compute_attribution(
        rack_id=rack_id,
        metric=metric,
        tenant_nodes=tenant_nodes,
        recent_changepoint=latest_cp,
    )
    return attr


# -------------------------------------------------------------
# 4. Power endpoint (always estimated)
# -------------------------------------------------------------
@router.get("/power/{node_id}")
async def get_node_power(
    node_id: str,
    scope: Scope = Depends(get_current_scope),
    db: aiosqlite.Connection = Depends(get_db),
) -> dict[str, Any]:
    allowed = await is_node_allowed(db, node_id, scope)
    if not allowed:
        await record_scope_denial(db, scope, "power", node_id)
        raise APIContractError(code="NOT_FOUND", message="Node not found", status_code=404)

    node = await get_node(db, node_id, scope=scope)
    if not node:
        raise APIContractError(code="NOT_FOUND", message="Node not found", status_code=404)

    return estimate_power(node_id=node_id)


# -------------------------------------------------------------
# 5. Baseline capture endpoint (OPERATOR & SUPER_USER only)
# -------------------------------------------------------------
@router.post("/baselines/{node_id}/{metric}/capture")
async def capture_baseline_route(
    node_id: str,
    metric: str,
    scope: Scope = Depends(get_current_scope),
    db: aiosqlite.Connection = Depends(get_db),
) -> dict[str, Any]:
    if scope.role == "TENANT":
        await record_scope_denial(db, scope, "baseline_capture", node_id)
        raise APIContractError(code="NOT_FOUND", message="Resource not found", status_code=404)

    node = await get_node(db, node_id, scope=scope)
    if not node:
        raise APIContractError(code="NOT_FOUND", message="Node not found", status_code=404)

    # Compute baseline from recent readings (last 30 samples)
    points = await query_node_telemetry(db, node_id, metric, limit=30, scope=scope)
    if len(points) < 5:
        raise APIContractError(
            code="FORECAST_INSUFFICIENT_DATA",
            message=f"Need at least 5 quiet samples to capture baseline (found {len(points)})",
            status_code=400,
        )

    values = [p["value"] for p in points]
    mean_val = float(sum(values) / len(values))
    now_iso = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")

    baseline = await save_baseline(
        db,
        node_id=node_id,
        metric=metric,
        value=round(mean_val, 4),
        sample_count=len(values),
        captured_at=now_iso,
        scope=scope,
    )
    return baseline

