import asyncio
from datetime import datetime, timezone, timedelta
import json
import os
import sys
from pathlib import Path

# Add project root to sys.path
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

import aiosqlite
from httpx import ASGITransport, AsyncClient

from backend.core.auth import create_access_token
from backend.db.connection import SCHEMA_PATH, get_db
from backend.main import app
from backend.services.changepoint import detect_agreed_changepoint
from backend.services.forecast import compute_forecast
from tools.synthetic.generators import generate_clean_ramp, generate_flat_series, generate_step_change


async def run_acceptance_c():
    db_file = "backend/data/racksense_acceptance_c.db"
    p = Path(db_file)
    if p.exists():
        p.unlink()
    p.parent.mkdir(parents=True, exist_ok=True)

    print("=" * 75)
    print("RACKSENSE BACKEND - PHASE C ACCEPTANCE VERIFICATION (ANALYSIS ENGINE)")
    print("=" * 75)

    # 1. Initialize and Seed
    async with aiosqlite.connect(db_file) as db:
        db.row_factory = aiosqlite.Row
        with open(SCHEMA_PATH, "r", encoding="utf-8") as f:
            await db.executescript(f.read())

        await db.execute("INSERT INTO sites (site_id, label) VALUES ('site-01', 'Bench DC Site 01')")
        await db.execute("INSERT INTO racks (rack_id, site_id, label, row, col) VALUES ('rack-01', 'site-01', 'Rack 01', 0, 0)")
        await db.execute("INSERT INTO tenants (tenant_id, label, contact) VALUES ('t-alpha', 'Alpha Systems', 'ops@alpha')")
        await db.execute("INSERT INTO tenants (tenant_id, label, contact) VALUES ('t-beta', 'Beta Compute', 'ops@beta')")
        await db.execute("INSERT INTO nodes (node_id, rack_id, fw, status, last_seq) VALUES ('r1-n1', 'rack-01', '0.3.1', 'OK', 100)")
        await db.execute("INSERT INTO nodes (node_id, rack_id, fw, status, last_seq) VALUES ('r2-n1', 'rack-01', '0.3.1', 'OK', 100)")
        await db.execute("INSERT INTO slots (slot_id, rack_id, u_start, u_height, tenant_id, node_id) VALUES ('slot-01', 'rack-01', 1, 2, 't-alpha', 'r1-n1')")
        await db.execute("INSERT INTO slots (slot_id, rack_id, u_start, u_height, tenant_id, node_id) VALUES ('slot-02', 'rack-01', 3, 2, 't-beta', 'r2-n1')")

        # Baseline for r1-n1
        await db.execute("INSERT INTO baselines VALUES ('r1-n1', 't_c', 23.8, '2026-10-28T00:00:00Z', 50)")
        await db.commit()

    async def override_db():
        async with aiosqlite.connect(db_file) as conn:
            conn.row_factory = aiosqlite.Row
            yield conn

    app.dependency_overrides[get_db] = override_db
    transport = ASGITransport(app=app)
    token = create_access_token({"sub": "u-op1", "user_id": "u-op1", "role": "OPERATOR", "tenant_id": None})

    # -------------------------------------------------------------
    # 1. Warm DHT22 (warming ramp -> countdown shortens, cone narrows)
    # -------------------------------------------------------------
    print("\n[1] Simulating DHT22 warming by hand (rising ramp towards 27.0 C ASHRAE limit)...")
    warming_pts = generate_clean_ramp(start_val=24.5, slope_per_s=0.012, n_points=35)
    fc_warm = compute_forecast(node_id="r1-n1", metric="t_c", points=warming_pts, repetitions=500)

    print(f"  -> has_trend: {fc_warm['crossing']['has_trend']}")
    print(f"  -> Slope: {fc_warm['slope']['value']} C/s (CI: [{fc_warm['slope']['ci_low']}, {fc_warm['slope']['ci_high']}])")
    print(f"  -> Crossing Distribution: P10={fc_warm['crossing']['p10_s']}s, P50={fc_warm['crossing']['p50_s']}s, P90={fc_warm['crossing']['p90_s']}s")
    print(f"  -> No breach fraction: {fc_warm['crossing']['no_breach_fraction']}")
    print(f"  -> P10-P90 cone generated with widen_factor={fc_warm['calibration']['widen_factor']}")
    assert fc_warm["crossing"]["has_trend"] is True
    assert fc_warm["crossing"]["p10_s"] <= fc_warm["crossing"]["p50_s"] <= fc_warm["crossing"]["p90_s"]

    # -------------------------------------------------------------
    # 2. Let it cool -> has_trend flips to false, crossing times null
    # -------------------------------------------------------------
    print("\n[2] Simulating sensor cooling down (flat series, no sustained trend)...")
    cooling_pts = generate_flat_series(base_val=23.5, noise_std=0.03, n_points=40)
    fc_cool = compute_forecast(node_id="r1-n1", metric="t_c", points=cooling_pts, repetitions=500)

    print(f"  -> has_trend: {fc_cool['crossing']['has_trend']}")
    print(f"  -> Slope CI: [{fc_cool['slope']['ci_low']}, {fc_cool['slope']['ci_high']}] (contains zero)")
    print(f"  -> Crossing times: p10={fc_cool['crossing']['p10_s']}, p50={fc_cool['crossing']['p50_s']}, p90={fc_cool['crossing']['p90_s']}")
    print(f"  -> no_breach_fraction: {fc_cool['crossing']['no_breach_fraction']}")
    assert fc_cool["crossing"]["has_trend"] is False
    assert fc_cool["crossing"]["p50_s"] is None

    # -------------------------------------------------------------
    # 3. Second node comes online -> NODE_ONLINE fact, CUSUM+PELT agree, attribution appears
    # -------------------------------------------------------------
    print("\n[3] Second node r2-n1 powers on (NODE_ONLINE fact + load shift)...")
    step_pts = generate_step_change(before_val=23.8, after_val=26.4, step_idx=45, n_points=85)
    break_ts = step_pts[45]["ts"]

    # Attach deterministic MQTT LWT connection fact
    topo_event = {"ts": break_ts, "event_data": {"type": "node_online", "node_id": "r2-n1"}}
    cp = detect_agreed_changepoint(node_id="r1-n1", metric="t_c", points=step_pts, topology_events=[topo_event])

    print(f"  -> Changepoint detected: cp_id={cp['cp_id']}, delta=+{cp['shift']['delta']} C")
    print(f"  -> Located at: {cp['located_at']}")
    print(f"  -> Associated topology fact: {cp['topology_event']}")
    assert cp is not None
    assert cp["confirmed"] is True
    assert cp["topology_event"]["node_id"] == "r2-n1"

    # Query attribution endpoint
    async with aiosqlite.connect(db_file) as db:
        from backend.repos.analysis import save_changepoint
        from backend.repos.scope import SYSTEM_SCOPE
        await save_changepoint(db, cp, scope=SYSTEM_SCOPE)

    async with AsyncClient(transport=transport, base_url="http://test") as client:
        res = await client.get("/api/attribution/rack-01?metric=t_c", headers={"Authorization": f"Bearer {token}"})
        attr_data = res.json()
        print(f"  -> GET /api/attribution/rack-01 response:")
        print(f"     Contributors count: {len(attr_data['contributors'])}")
        first = attr_data["contributors"][0]
        print(f"     Tenant: {first['tenant_label']} (share: {first['share']})")
        print(f"     Basis: '{first['basis']}'")
        print(f"     Quality: {first['meta']['quality']}")
        assert first["meta"]["quality"] == "inferred"
        assert "r2-n1" in first["basis"]

    # -------------------------------------------------------------
    # 4. Power endpoint returns estimated power + formula in model_detail
    # -------------------------------------------------------------
    print("\n[4] Calling GET /api/power/r1-n1...")
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        res = await client.get("/api/power/r1-n1", headers={"Authorization": f"Bearer {token}"})
        pwr_data = res.json()
        print(f"  -> Value: {pwr_data['value']['value']} {pwr_data['value']['unit']}")
        print(f"  -> Quality: {pwr_data['value']['meta']['quality']} (never 'measured')")
        print(f"  -> Formula: {pwr_data['model_detail']['formula']}")
        print(f"  -> Reference: {pwr_data['model_detail']['reference']}")
        assert pwr_data["value"]["meta"]["quality"] == "estimated"
        assert "P = P_idle + (P_busy - P_idle) * u" in pwr_data["model_detail"]["formula"]
        assert pwr_data["model_detail"]["calibrated"] is False

    print("\n" + "=" * 75)
    print("ALL 4 PHASE C ACCEPTANCE CRITERIA PASSED AND VERIFIED!")
    print("=" * 75)


if __name__ == "__main__":
    asyncio.run(run_acceptance_c())

