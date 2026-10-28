from datetime import datetime, timezone
from typing import Any
import aiosqlite
from fastapi import APIRouter, Depends
from pydantic import BaseModel

from backend.api.deps import get_current_scope, record_scope_denial
from backend.api.errors import APIContractError
from backend.api.telemetry import get_sensor_source
from backend.db.connection import get_db
from backend.repos.scope import Scope, apply_scope
from backend.repos.telemetry import get_latest_node_metric
from backend.repos.topology import get_rack_nodes_stats

router = APIRouter(prefix="/api/racks", tags=["racks"])


class MarginValueMeta(BaseModel):
    quality: str
    source: str
    model: str | None = None
    uncertainty_pct: float | None = None
    as_of: str


class MarginValue(BaseModel):
    value: float
    unit: str
    meta: MarginValueMeta


class WorstMargin(BaseModel):
    metric: str
    node_id: str
    value: MarginValue
    limit: float
    limit_source: str


class RackSummaryResponse(BaseModel):
    rack_id: str
    status: str
    worst_margin: WorstMargin | None = None
    nodes_online: int
    nodes_total: int


@router.get("/{rack_id}/summary", response_model=RackSummaryResponse)
async def get_rack_summary_route(
    rack_id: str,
    scope: Scope = Depends(get_current_scope),
    db: aiosqlite.Connection = Depends(get_db),
) -> RackSummaryResponse:
    # 1. Verify rack exists
    cursor = await db.execute("SELECT rack_id FROM racks WHERE rack_id = ?", (rack_id,))
    rack_row = await cursor.fetchone()
    if not rack_row:
        raise APIContractError(
            code="NOT_FOUND",
            message=f"Rack '{rack_id}' not found",
            status_code=404,
        )

    # 2. Get node counts and status scoped to caller
    online_count, total_count, nodes = await get_rack_nodes_stats(db, rack_id, scope=scope)

    # Hard isolation rule: if TENANT owns no nodes in this rack, return 404
    if scope.role == "TENANT" and total_count == 0:
        await record_scope_denial(db, scope, "rack_summary", rack_id)
        raise APIContractError(
            code="NOT_FOUND",
            message=f"Rack '{rack_id}' not found",
            status_code=404,
        )

    # Rack status is computed strictly over caller's visible nodes
    rack_status = "OK"
    for n in nodes:
        if n["status"] == "CRIT":
            rack_status = "CRIT"
            break
        elif n["status"] in ("WARN", "OFFLINE"):
            rack_status = "WARN"

    # Worst margin from caller's visible nodes
    worst_margin: WorstMargin | None = None
    min_margin = float("inf")

    for n in nodes:
        node_id = n["node_id"]
        latest = await get_latest_node_metric(db, node_id, "t_c", scope=scope)
        if latest:
            as_of = latest["ts"]
            current_val = latest["value"]
            limit_val = 27.0
            limit_src = "ASHRAE TC 9.9 recommended inlet upper bound"
            margin = limit_val - current_val

            if margin < min_margin:
                min_margin = margin
                worst_margin = WorstMargin(
                    metric="t_c",
                    node_id=node_id,
                    value=MarginValue(
                        value=round(margin, 2),
                        unit="C",
                        meta=MarginValueMeta(
                            quality=latest["quality"],
                            source=get_sensor_source(node_id, "t_c"),
                            model=None,
                            uncertainty_pct=None,
                            as_of=as_of,
                        ),
                    ),
                    limit=limit_val,
                    limit_source=limit_src,
                )

    return RackSummaryResponse(
        rack_id=rack_id,
        status=rack_status,
        worst_margin=worst_margin,
        nodes_online=online_count,
        nodes_total=total_count,
    )
