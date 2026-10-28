from datetime import datetime, timezone
from typing import Any
import aiosqlite
from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel

from backend.api.deps import get_current_scope, record_scope_denial
from backend.api.errors import APIContractError
from backend.db.connection import get_db
from backend.repos.nodes import get_node
from backend.repos.scope import Scope, is_node_allowed
from backend.repos.telemetry import query_node_telemetry

router = APIRouter(prefix="/api/nodes", tags=["telemetry"])

METRIC_UNITS: dict[str, str] = {
    "t_c": "C",
    "rh": "%",
    "dew_c": "C",
    "mq_ratio": "ratio",
    "vib_rms_g": "g",
    "vib_peak_g": "g",
    "vib_crest": "ratio",
    "shock_count": "count",
    "power_w": "W",
}

SENSOR_SOURCES: dict[tuple[str, str], str] = {
    ("r1-n1", "t_c"): "node:r1-n1:dht22",
    ("r1-n1", "rh"): "node:r1-n1:dht22",
    ("r1-n1", "dew_c"): "node:r1-n1:derived:magnus",
    ("r1-n1", "mq_ratio"): "node:r1-n1:mq135",
    ("r1-n1", "shock_count"): "node:r1-n1:sw420",
    ("r2-n1", "vib_rms_g"): "node:r2-n1:mpu6050",
    ("r2-n1", "vib_peak_g"): "node:r2-n1:mpu6050",
    ("r2-n1", "vib_crest"): "node:r2-n1:mpu6050",
}


def get_sensor_source(node_id: str, metric: str) -> str:
    return SENSOR_SOURCES.get((node_id, metric), f"node:{node_id}:{metric}")


class TelemetryPoint(BaseModel):
    ts: str
    value: float


class TelemetryMeta(BaseModel):
    quality: str
    source: str
    model: str | None = None
    uncertainty_pct: float | None = None
    as_of: str


class NodeTelemetryResponse(BaseModel):
    node_id: str
    metric: str
    unit: str
    step_s: int
    points: list[TelemetryPoint]
    meta: TelemetryMeta


@router.get("/{node_id}/telemetry", response_model=NodeTelemetryResponse)
async def get_node_telemetry_route(
    node_id: str,
    metric: str = Query(..., description="Sensor metric key"),
    from_ts: str | None = Query(None, alias="from"),
    to_ts: str | None = Query(None, alias="to"),
    step: str | None = Query("10s", description="Step interval"),
    scope: Scope = Depends(get_current_scope),
    db: aiosqlite.Connection = Depends(get_db),
) -> NodeTelemetryResponse:
    # 1. Enforce tenant isolation: check node ownership via single choke point
    allowed = await is_node_allowed(db, node_id, scope)
    if not allowed:
        # Hard requirement: 404, never 403. Returning 403 leaks existence.
        await record_scope_denial(db, scope, "node_telemetry", node_id)
        raise APIContractError(
            code="NOT_FOUND",
            message="Node not found",
            status_code=404,
        )

    # 2. Check node existence
    node = await get_node(db, node_id, scope=scope)
    if not node:
        raise APIContractError(
            code="NOT_FOUND",
            message="Node not found",
            status_code=404,
        )

    # 3. Check metric validity
    if metric not in METRIC_UNITS:
        raise APIContractError(
            code="VALIDATION_ERROR",
            message=f"Invalid metric '{metric}'",
            status_code=400,
            detail={"allowed_metrics": list(METRIC_UNITS.keys())},
        )

    # 4. Query scoped telemetry points
    raw_points = await query_node_telemetry(db, node_id, metric, from_ts, to_ts, scope=scope)

    step_s = 10
    if step and step.endswith("s"):
        try:
            step_s = int(step[:-1])
        except ValueError:
            step_s = 10

    points = [TelemetryPoint(ts=p["ts"], value=p["value"]) for p in raw_points]
    as_of = points[-1].ts if points else datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")

    return NodeTelemetryResponse(
        node_id=node_id,
        metric=metric,
        unit=METRIC_UNITS[metric],
        step_s=step_s,
        points=points,
        meta=TelemetryMeta(
            quality="measured",
            source=get_sensor_source(node_id, metric),
            model=None,
            uncertainty_pct=None,
            as_of=as_of,
        ),
    )
