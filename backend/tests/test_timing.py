import asyncio
from datetime import datetime, timezone
import json
import time
import pytest
import pytest_asyncio
import aiosqlite
from httpx import ASGITransport, AsyncClient

from backend.core.auth import create_access_token, hash_password
from backend.db.connection import SCHEMA_PATH, get_db
from backend.main import app
from backend.services.forecast import compute_forecast


@pytest_asyncio.fixture
async def timing_db(tmp_path):
    db_file = str(tmp_path / "timing.db")
    async with aiosqlite.connect(db_file) as db:
        db.row_factory = aiosqlite.Row
        with open(SCHEMA_PATH, "r", encoding="utf-8") as f:
            await db.executescript(f.read())

        await db.execute("INSERT INTO sites VALUES ('site-01', 'Bench DC')")
        await db.execute("INSERT INTO racks VALUES ('rack-01', 'site-01', 'Rack 01', 0, 0)")
        await db.execute("INSERT INTO tenants VALUES ('t-alpha', 'Alpha Systems', 'ops@alpha')")
        await db.execute("INSERT INTO nodes (node_id, rack_id, fw, status, last_seq) VALUES ('r1-n1', 'rack-01', '0.3.1', 'OK', 100)")
        await db.execute("INSERT INTO slots VALUES ('slot-01', 'rack-01', 1, 2, 't-alpha', 'r1-n1')")

        pw = hash_password("secret123")
        await db.execute("INSERT INTO users VALUES ('u-op', 'operator_user', ?, 'OPERATOR', null, 'Operator Alice')", (pw,))

        now_iso = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
        fc_payload = json.dumps({
            "has_trend": True,
            "slope": 0.05,
            "slope_ci": [0.03, 0.07],
            "crossing": {"p10": 1800, "p50": 2400, "p90": 3200},
            "no_breach_fraction": 0.02,
        })
        await db.execute(
            "INSERT INTO forecast_cache (node_id, metric, forecast_id, computed_at, payload_json) VALUES ('r1-n1', 't_c', 'fc_001', ?, ?)",
            (now_iso, fc_payload),
        )

        # Seed proposal
        await db.execute(
            """
            INSERT INTO proposals VALUES (
                'pr_time_01', ?, '{}', 'INSPECT_FAN', 'r1-n1', 'Rationale', 'Effect',
                '[]', 'LOW', 'PROPOSED', 'manual', ?
            )
            """,
            (now_iso, now_iso),
        )

        # Register reader
        await db.execute(
            "INSERT INTO reader_devices VALUES ('reader-01', 'secret', 'hash', 'Console', ?, null, null, null)",
            (now_iso,),
        )
        await db.commit()

    async def override_db():
        async with aiosqlite.connect(db_file) as conn:
            conn.row_factory = aiosqlite.Row
            yield conn

    app.dependency_overrides[get_db] = override_db
    yield db_file
    app.dependency_overrides.clear()


def make_token(user_id: str, role: str) -> str:
    return create_access_token({"sub": user_id, "user_id": user_id, "role": role})


@pytest.mark.asyncio
async def test_timing_budgets(timing_db):
    """
    Measures timing budgets against Contract §14.
    """
    token = make_token("u-op", "OPERATOR")
    transport = ASGITransport(app=app)

    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # 1. GET /api/topology <= 150 ms
        t0 = time.perf_counter()
        res_topo = await client.get("/api/topology", headers={"Authorization": f"Bearer {token}"})
        t_topo_ms = (time.perf_counter() - t0) * 1000
        assert res_topo.status_code == 200
        assert t_topo_ms <= 150.0, f"GET /api/topology took {t_topo_ms:.2f} ms (budget <= 150 ms)"

        # 2. GET /api/forecast/... (cached) <= 200 ms
        t0 = time.perf_counter()
        res_fc = await client.get("/api/forecast/r1-n1/t_c", headers={"Authorization": f"Bearer {token}"})
        t_fc_ms = (time.perf_counter() - t0) * 1000
        assert res_fc.status_code == 200
        assert t_fc_ms <= 200.0, f"GET /api/forecast took {t_fc_ms:.2f} ms (budget <= 200 ms)"

        # 3. POST /api/proposals/{id}/approve <= 300 ms
        t0 = time.perf_counter()
        res_appr = await client.post(
            "/api/proposals/pr_time_01/approve",
            headers={"Authorization": f"Bearer {token}"},
            json={"reader_device_id": "reader-01"},
        )
        t_appr_ms = (time.perf_counter() - t0) * 1000
        assert res_appr.status_code == 200
        assert t_appr_ms <= 300.0, f"POST /api/proposals/approve took {t_appr_ms:.2f} ms (budget <= 300 ms)"

        # 4. Forecast recompute (ETS + 500 sims) <= 2 s
        # Generate 60 test points
        test_points = [
            {"ts": f"2026-10-28T12:{i:02d}:00Z", "value": 24.0 + (i * 0.05)}
            for i in range(60)
        ]
        t0 = time.perf_counter()
        fc_res = compute_forecast(
            node_id="r1-n1",
            metric="t_c",
            points=test_points,
            repetitions=500,
        )
        t_recompute_s = time.perf_counter() - t0
        assert fc_res is not None
        assert t_recompute_s <= 2.0, f"Forecast recompute took {t_recompute_s:.2f} s (budget <= 2 s)"

