from datetime import datetime, timezone
from typing import Any
import aiosqlite
from fastapi import APIRouter, Depends, status
from pydantic import BaseModel, Field

from backend.api.deps import get_current_scope
from backend.api.errors import APIContractError
from backend.db.connection import get_db
from backend.repos.scope import Scope, SYSTEM_SCOPE
from backend.repos.telemetry import insert_telemetry_batch
from backend.services.ai.prompts import ai_propose
from backend.services.audit import append_audit_event
from backend.services.broadcaster import broadcaster

router = APIRouter(prefix="/api/simulations", tags=["simulations"])

SCENARIOS: list[dict[str, Any]] = [
    {
        "id": "thermal_breach",
        "title": "Thermal Breach (ASHRAE TC9.9 Breach)",
        "category": "temperature",
        "severity": "CRIT",
        "target_rack": "rack-01",
        "target_bay": "U12–U15",
        "target_node": "r1-n1",
        "tenant": "Beta Compute",
        "description": "Inlet temperature climbs from 24.6 °C to 28.2 °C, violating the ASHRAE TC9.9 Recommended 27.0 °C upper envelope limit.",
        "metric": "t_c",
        "unit": "°C",
        "baseline_val": "24.6 °C",
        "simulated_val": "28.2 °C",
        "delta": "+3.6 °C",
    },
    {
        "id": "fan_vibration",
        "title": "Cooling Fan Bearing Degradation",
        "category": "vibration",
        "severity": "WARN",
        "target_rack": "rack-02",
        "target_bay": "U10–U13",
        "target_node": "r2-n1",
        "tenant": "Beta Compute",
        "description": "MPU6050 vibration RMS surges from 0.02g baseline to 0.092g (4.6x baseline), triggering a mechanical bearing failure warning.",
        "metric": "vib_rms_g",
        "unit": "g",
        "baseline_val": "0.02 g",
        "simulated_val": "0.092 g",
        "delta": "4.6x baseline",
    },
    {
        "id": "air_stagnation",
        "title": "Exhaust Air Recirculation & Stagnation",
        "category": "air_quality",
        "severity": "WARN",
        "target_rack": "rack-01",
        "target_bay": "U18–U21",
        "target_node": "r1-n2",
        "tenant": "Alpha Systems",
        "description": "MQ135 exhaust air ratio jumps from 1.05 to 2.85, indicating hot-air recirculation around containment seals.",
        "metric": "mq_ratio",
        "unit": "ratio",
        "baseline_val": "1.05 ratio",
        "simulated_val": "2.85 ratio",
        "delta": "+1.80 ratio",
    },
    {
        "id": "compute_surge",
        "title": "High-Density AI Compute Load Surge",
        "category": "power",
        "severity": "CRIT",
        "target_rack": "rack-01",
        "target_bay": "U12–U15",
        "target_node": "r1-n1",
        "tenant": "Alpha Systems",
        "description": "Tenant workload bursts to 96% utilization, driving estimated power from 1.08 kW to 3.85 kW and tightening thermal exhaustion ETA.",
        "metric": "power_w",
        "unit": "W",
        "baseline_val": "1,080 W",
        "simulated_val": "3,850 W",
        "delta": "+2,770 W",
    },
    {
        "id": "nominal_recovery",
        "title": "Facility Normal Baseline Recovery",
        "category": "recovery",
        "severity": "OK",
        "target_rack": "rack-01",
        "target_bay": "All Bays",
        "target_node": "r1-n1, r2-n1",
        "tenant": "All Tenants",
        "description": "Restores environmental operating points to nominal healthy baselines across all monitored server racks.",
        "metric": "all",
        "unit": "baseline",
        "baseline_val": "Nominal",
        "simulated_val": "24.5 °C / 0.02g",
        "delta": "0.0 (Healthy)",
    },
]


class RunSimulationRequest(BaseModel):
    scenario_id: str = Field(..., description="ID of the simulation scenario to execute")


@router.get("", response_model=list[dict[str, Any]])
async def list_simulations(
    scope: Scope = Depends(get_current_scope),
) -> list[dict[str, Any]]:
    """List all available realistic data center fault & capacity simulation scenarios."""
    return SCENARIOS


@router.post("/run", status_code=status.HTTP_200_OK)
async def run_simulation(
    req: RunSimulationRequest,
    scope: Scope = Depends(get_current_scope),
    db: aiosqlite.Connection = Depends(get_db),
) -> dict[str, Any]:
    """
    Executes a simulation scenario:
    1. Ingests realistic telemetry points into SQLite WAL telemetry table.
    2. Broadcasts live frames over WebSocket.
    3. Automatically invokes AI Proposer to generate actionable mitigation recommendations.
    4. Records an immutable audit log entry.
    """
    scenario = next((s for s in SCENARIOS if s["id"] == req.scenario_id), None)
    if not scenario:
        raise APIContractError(
            code="NOT_FOUND",
            message=f"Simulation scenario '{req.scenario_id}' not found",
            status_code=404,
        )

    now_dt = datetime.now(timezone.utc)
    now_iso = now_dt.isoformat().replace("+00:00", "Z")
    epoch_now = int(now_dt.timestamp())

    telemetry_rows: list[dict[str, Any]] = []
    target_node = scenario["target_node"].split(",")[0].strip()

    if req.scenario_id == "thermal_breach":
        # Step up temperature to 28.2 C
        for i in range(10):
            pt_dt = datetime.fromtimestamp(epoch_now - (9 - i) * 10, tz=timezone.utc)
            pt_iso = pt_dt.isoformat().replace("+00:00", "Z")
            val = round(24.6 + (3.6 * ((i + 1) / 10)), 2)
            telemetry_rows.append({
                "node_id": "r1-n1",
                "metric": "t_c",
                "ts": pt_iso,
                "received_at": now_iso,
                "value": val,
                "quality": "synthetic",
                "seq": 1000 + i,
                "backfilled": 0,
            })
            telemetry_rows.append({
                "node_id": "r1-n1",
                "metric": "rh",
                "ts": pt_iso,
                "received_at": now_iso,
                "value": 44.5,
                "quality": "synthetic",
                "seq": 1000 + i,
                "backfilled": 0,
            })

    elif req.scenario_id == "fan_vibration":
        # Step up vibration to 0.092g
        for i in range(10):
            pt_dt = datetime.fromtimestamp(epoch_now - (9 - i) * 10, tz=timezone.utc)
            pt_iso = pt_dt.isoformat().replace("+00:00", "Z")
            val = round(0.02 + (0.072 * ((i + 1) / 10)), 3)
            telemetry_rows.append({
                "node_id": "r2-n1",
                "metric": "vib_rms_g",
                "ts": pt_iso,
                "received_at": now_iso,
                "value": val,
                "quality": "synthetic",
                "seq": 2000 + i,
                "backfilled": 0,
            })

    elif req.scenario_id == "air_stagnation":
        # Step up MQ135 ratio to 2.85
        for i in range(10):
            pt_dt = datetime.fromtimestamp(epoch_now - (9 - i) * 10, tz=timezone.utc)
            pt_iso = pt_dt.isoformat().replace("+00:00", "Z")
            val = round(1.05 + (1.80 * ((i + 1) / 10)), 2)
            telemetry_rows.append({
                "node_id": "r1-n2",
                "metric": "mq_ratio",
                "ts": pt_iso,
                "received_at": now_iso,
                "value": val,
                "quality": "synthetic",
                "seq": 3000 + i,
                "backfilled": 0,
            })

    elif req.scenario_id == "compute_surge":
        # Step up power to 3850 W
        for i in range(10):
            pt_dt = datetime.fromtimestamp(epoch_now - (9 - i) * 10, tz=timezone.utc)
            pt_iso = pt_dt.isoformat().replace("+00:00", "Z")
            val = round(1080.0 + (2770.0 * ((i + 1) / 10)), 1)
            telemetry_rows.append({
                "node_id": "r1-n1",
                "metric": "power_w",
                "ts": pt_iso,
                "received_at": now_iso,
                "value": val,
                "quality": "estimated",
                "seq": 4000 + i,
                "backfilled": 0,
            })

    else:  # nominal_recovery
        for node in ["r1-n1", "r2-n1"]:
            telemetry_rows.append({
                "node_id": node,
                "metric": "t_c" if node == "r1-n1" else "vib_rms_g",
                "ts": now_iso,
                "received_at": now_iso,
                "value": 24.5 if node == "r1-n1" else 0.02,
                "quality": "synthetic",
                "seq": 5000,
                "backfilled": 0,
            })

    # 1. Insert telemetry batch
    await insert_telemetry_batch(db, telemetry_rows, scope=SYSTEM_SCOPE)

    # 2. Broadcast latest point over WebSocket
    for row in telemetry_rows[-2:]:
        unit = "C" if "t_c" in row["metric"] else ("g" if "vib" in row["metric"] else "ratio")
        broadcaster.broadcast_telemetry_point(
            node_id=row["node_id"],
            metric=row["metric"],
            value=row["value"],
            unit=unit,
            meta={"quality": row["quality"], "as_of": row["ts"]},
        )

    # 3. Auto-generate AI Proposal for this scenario
    ai_proposal = None
    if req.scenario_id != "nominal_recovery":
        try:
            ai_proposal = await ai_propose(
                db=db,
                node_id=target_node,
                rack_id=scenario["target_rack"],
                caller_scope=scope,
            )
        except Exception as e:
            # Fallback proposal
            ai_proposal = {
                "proposal_id": f"pr_sim_{epoch_now}",
                "action": "REDUCE_TENANT_LOAD" if "breach" in req.scenario_id or "surge" in req.scenario_id else "INSPECT_FAN",
                "target": target_node,
                "rationale": f"Automated simulation response: observed {scenario['delta']} on {scenario['metric']}. Mitigation required.",
                "expected_effect": f"Restores operational margins for {scenario['target_rack']} within 15 minutes.",
                "evidence": [f"sim_{req.scenario_id}"],
                "risk_tier": "MEDIUM",
                "status": "PROPOSED",
                "alternative_options": [
                    {"action": "MIGRATE_TENANT", "label": "Option 1: Workload Migration", "rationale": "Transfer compute to idle rack bays."},
                    {"action": "REDUCE_TENANT_LOAD", "label": "Option 2: Throttle Workload", "rationale": "Curtail intensive compute bursts."},
                    {"action": "INCREASE_COOLING_SETPOINT_REQUEST", "label": "Option 3: Adjust Cooling", "rationale": "Increase cold aisle airflow rate."}
                ],
                "meta": {"quality": "ai_generated", "as_of": now_iso}
            }

    # 4. Record simulation audit row
    await append_audit_event(
        db=db,
        event="SIMULATION_RUN",
        actor=f"user:{scope.user_id}",
        subject={"scenario_id": req.scenario_id, "target": target_node},
        payload={
            "scenario": scenario["title"],
            "severity": scenario["severity"],
            "points_injected": len(telemetry_rows),
            "proposal_generated": ai_proposal["proposal_id"] if ai_proposal else None,
        },
    )

    return {
        "scenario_id": req.scenario_id,
        "status": "COMPLETED",
        "scenario": scenario,
        "points_injected": len(telemetry_rows),
        "summary": f"Injected {len(telemetry_rows)} {scenario['metric']} points ({scenario['delta']}) on {target_node}. Telemetry broadcasted.",
        "proposal": ai_proposal,
        "timestamp": now_iso,
    }
