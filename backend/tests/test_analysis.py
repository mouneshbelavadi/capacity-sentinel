import time
import pytest
import pytest_asyncio
import aiosqlite
from httpx import ASGITransport, AsyncClient

from backend.core.auth import create_access_token
from backend.db.connection import SCHEMA_PATH, get_db
from backend.main import app
from backend.services.changepoint import detect_agreed_changepoint
from backend.services.forecast import compute_forecast
from backend.services.power import estimate_power
from backend.services.scheduler import AnalysisScheduler
from tools.synthetic.generators import (
    generate_clean_ramp,
    generate_flat_series,
    generate_noisy_ramp,
    generate_step_change,
)


@pytest_asyncio.fixture
async def analysis_test_db(tmp_path):
    db_file = str(tmp_path / "test_analysis.db")
    async with aiosqlite.connect(db_file) as db:
        db.row_factory = aiosqlite.Row
        with open(SCHEMA_PATH, "r", encoding="utf-8") as f:
            await db.executescript(f.read())

        # Seed site, rack, tenant, node, slot
        await db.execute("INSERT INTO sites (site_id, label) VALUES ('site-01', 'Test Site')")
        await db.execute("INSERT INTO racks (rack_id, site_id, label, row, col) VALUES ('rack-01', 'site-01', 'Rack 01', 0, 0)")
        await db.execute("INSERT INTO tenants (tenant_id, label, contact) VALUES ('t-alpha', 'Alpha Systems', 'ops@alpha')")
        await db.execute("INSERT INTO nodes (node_id, rack_id, fw, status, last_seq) VALUES ('r1-n1', 'rack-01', '0.3.1', 'OK', 100)")
        await db.execute("INSERT INTO slots (slot_id, rack_id, u_start, u_height, tenant_id, node_id) VALUES ('slot-01', 'rack-01', 1, 2, 't-alpha', 'r1-n1')")

        # Seed baseline for t_c and vib_rms_g
        await db.execute("INSERT INTO baselines (node_id, metric, value, captured_at, sample_count) VALUES ('r1-n1', 'vib_rms_g', 0.012, '2026-10-28T00:00:00Z', 50)")
        await db.commit()

    async def override_db():
        async with aiosqlite.connect(db_file) as conn:
            conn.row_factory = aiosqlite.Row
            yield conn

    app.dependency_overrides[get_db] = override_db
    yield db_file
    app.dependency_overrides.clear()


def make_token(user_id: str = "u-alpha", role: str = "TENANT", tenant_id: str | None = "t-alpha") -> str:
    return create_access_token({"sub": user_id, "user_id": user_id, "role": role, "tenant_id": tenant_id})


# -------------------------------------------------------------
# 1. Flat synthetic series -> has_trend: false, crossing times null
# -------------------------------------------------------------
def test_flat_series_no_trend():
    flat_pts = generate_flat_series(base_val=24.0, noise_std=0.03, n_points=60)
    fc = compute_forecast(node_id="r1-n1", metric="t_c", points=flat_pts, repetitions=200)

    assert fc["crossing"]["has_trend"] is False
    assert fc["crossing"]["p10_s"] is None
    assert fc["crossing"]["p50_s"] is None
    assert fc["crossing"]["p90_s"] is None
    assert fc["crossing"]["no_breach_fraction"] == 1.0


# -------------------------------------------------------------
# 2. Clean ramp -> crossing P10 < P50 < P90, P50 close to analytic
# -------------------------------------------------------------
def test_clean_ramp_crossing_distribution():
    # Start at 24.0 C, ramp at 0.01 C/s. Limit is 27.0 C.
    # Delta to limit from end of window (30 points = 300s -> 27.0 C is reached around 300s from start)
    # Let's start at 24.0 C, 30 points (last is ~26.7 C). Remaining delta = 0.3 C -> ~30s
    ramp_pts = generate_clean_ramp(start_val=24.0, slope_per_s=0.01, n_points=30)
    fc = compute_forecast(node_id="r1-n1", metric="t_c", points=ramp_pts, repetitions=500)

    assert fc["crossing"]["has_trend"] is True
    p10 = fc["crossing"]["p10_s"]
    p50 = fc["crossing"]["p50_s"]
    p90 = fc["crossing"]["p90_s"]

    assert p10 is not None and p50 is not None and p90 is not None
    assert p10 <= p50 <= p90
    assert 10 <= p50 <= 120  # Analytic is approx 40s


# -------------------------------------------------------------
# 3. Noisy ramp -> wider band, P50 sane, horizon respects 3x cap
# -------------------------------------------------------------
def test_noisy_ramp_horizon_and_widening():
    # 30 points of 10s = 300s window. Horizon cap = 3x = 900s
    noisy_pts = generate_noisy_ramp(start_val=24.0, slope_per_s=0.008, noise_std=0.35, n_points=30)
    fc = compute_forecast(node_id="r1-n1", metric="t_c", points=noisy_pts, repetitions=500)

    assert fc["horizon_s"] <= 900
    assert fc["calibration"]["widen_factor"] == 1.18


# -------------------------------------------------------------
# 4. Step change -> CUSUM + PELT agreement -> changepoint detected
# -------------------------------------------------------------
def test_step_change_cusum_pelt_agreement():
    step_pts = generate_step_change(before_val=24.0, after_val=26.5, step_idx=40, n_points=80)
    cp = detect_agreed_changepoint(node_id="r1-n1", metric="t_c", points=step_pts)

    assert cp is not None
    assert cp["confirmed"] is True
    assert cp["detector"] == "cusum+pelt"
    assert 2.0 <= cp["shift"]["delta"] <= 3.0


# -------------------------------------------------------------
# 5. Single outlier / transient spike with no PELT agreement -> nothing logged
# -------------------------------------------------------------
def test_transient_no_pelt_confirmation():
    # Flat series with a single point jump
    pts = generate_flat_series(base_val=24.0, noise_std=0.03, n_points=60)
    pts[30]["value"] = 30.0  # transient single sample spike

    cp = detect_agreed_changepoint(node_id="r1-n1", metric="t_c", points=pts)
    # PELT requires min_size>=20 sustained break, so single sample spike is not confirmed!
    assert cp is None


# -------------------------------------------------------------
# 6. no_breach_fraction between 0 and 1
# -------------------------------------------------------------
def test_no_breach_fraction():
    # Gentle ramp: some paths cross within horizon, some do not
    gentle_pts = generate_noisy_ramp(start_val=24.0, slope_per_s=0.002, noise_std=0.4, n_points=30)
    fc = compute_forecast(node_id="r1-n1", metric="t_c", points=gentle_pts, repetitions=500)

    nbf = fc["crossing"]["no_breach_fraction"]
    assert 0.0 <= nbf <= 1.0


# -------------------------------------------------------------
# 7. Power response always quality: 'estimated' + complete model_detail
# -------------------------------------------------------------
@pytest.mark.asyncio
async def test_power_endpoint_estimated_and_formula(analysis_test_db):
    token = make_token()
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        res = await client.get("/api/power/r1-n1", headers={"Authorization": f"Bearer {token}"})
        assert res.status_code == 200
        data = res.json()
        assert data["value"]["meta"]["quality"] == "estimated"
        assert data["value"]["unit"] == "W"
        assert "model_detail" in data
        assert "formula" in data["model_detail"]
        assert "P = P_idle + (P_busy - P_idle) * u" in data["model_detail"]["formula"]
        assert data["model_detail"]["calibrated"] is False


# -------------------------------------------------------------
# 8. Metric with no baseline -> FORECAST_INSUFFICIENT_DATA
# -------------------------------------------------------------
@pytest.mark.asyncio
async def test_metric_missing_baseline_error(analysis_test_db):
    token = make_token()
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # mq_ratio has NO baseline seeded
        res = await client.get("/api/forecast/r1-n1/mq_ratio", headers={"Authorization": f"Bearer {token}"})
        assert res.status_code == 400
        data = res.json()
        assert "error" in data
        assert data["error"]["code"] == "FORECAST_INSUFFICIENT_DATA"


# -------------------------------------------------------------
# 9. Scheduler recompute completes within <= 2s budget
# -------------------------------------------------------------
@pytest.mark.asyncio
async def test_scheduler_budget(analysis_test_db):
    # Populate telemetry points in DB
    async with aiosqlite.connect(analysis_test_db) as db:
        pts = generate_clean_ramp(start_val=24.0, slope_per_s=0.01, n_points=40)
        for idx, p in enumerate(pts):
            await db.execute(
                "INSERT INTO telemetry (node_id, metric, ts, received_at, value, quality, seq) VALUES ('r1-n1', 't_c', ?, ?, ?, 'measured', ?)",
                (p["ts"], p["ts"], p["value"], 100 + idx),
            )
        await db.commit()

    scheduler = AnalysisScheduler(db_path=analysis_test_db)
    start_t = time.perf_counter()
    duration_ms = await scheduler.run_full_cycle()
    elapsed = time.perf_counter() - start_t

    # Hard budget: must complete in <= 2.0 seconds
    assert elapsed <= 2.0, f"Scheduler exceeded 2s budget: took {elapsed:.2f} s"
    assert duration_ms <= 2000.0

