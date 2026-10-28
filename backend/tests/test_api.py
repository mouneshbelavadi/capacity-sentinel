import json
from datetime import datetime, timezone
import pytest
import pytest_asyncio
import aiosqlite
from httpx import ASGITransport, AsyncClient

from backend.core.auth import create_access_token, hash_password
from backend.db.connection import SCHEMA_PATH, get_db
from backend.main import app


@pytest_asyncio.fixture
async def api_db(tmp_path):
    db_file = str(tmp_path / "test_api.db")
    async with aiosqlite.connect(db_file) as db:
        db.row_factory = aiosqlite.Row
        with open(SCHEMA_PATH, "r", encoding="utf-8") as f:
            await db.executescript(f.read())

        # Seed site, racks, tenants, nodes, slots
        await db.execute("INSERT INTO sites (site_id, label) VALUES ('site-01', 'Bench Data Center Site 01')")
        await db.execute("INSERT INTO racks (rack_id, site_id, label, row, col) VALUES ('rack-01', 'site-01', 'Rack 01', 0, 0)")
        await db.execute("INSERT INTO tenants (tenant_id, label, contact) VALUES ('t-alpha', 'Alpha Systems', 'ops@alpha.local')")
        await db.execute("INSERT INTO nodes (node_id, rack_id, fw, status, last_seq) VALUES ('r1-n1', 'rack-01', '0.3.1', 'OK', 1834)")
        await db.execute("INSERT INTO slots (slot_id, rack_id, u_start, u_height, tenant_id, node_id) VALUES ('rack-01-u12', 'rack-01', 12, 2, 't-alpha', 'r1-n1')")

        # Seed user
        pw = hash_password("secret123")
        await db.execute("INSERT INTO users VALUES ('u-alpha', 'alpha_user', ?, 'TENANT', 't-alpha', 'Alpha Lead')", (pw,))
        await db.execute("INSERT INTO users VALUES ('u-super', 'super1', ?, 'SUPER_USER', null, 'Super User')", (pw,))

        # Seed a real measured DHT22 telemetry point
        now_iso = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
        await db.execute(
            """
            INSERT INTO telemetry (node_id, metric, ts, received_at, value, quality, seq, backfilled)
            VALUES ('r1-n1', 't_c', ?, ?, 24.61, 'measured', 1834, 0)
            """,
            (now_iso, now_iso),
        )
        await db.commit()

    async def override_get_db():
        async with aiosqlite.connect(db_file) as conn:
            conn.row_factory = aiosqlite.Row
            yield conn

    app.dependency_overrides[get_db] = override_get_db
    yield db_file
    app.dependency_overrides.clear()


def make_token(user_id: str, role: str, tenant_id: str | None = None) -> str:
    return create_access_token({"sub": user_id, "user_id": user_id, "role": role, "tenant_id": tenant_id})


@pytest.mark.asyncio
async def test_meta_endpoint(api_db):
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # GET /api/meta is public
        res = await client.get("/api/meta")
        assert res.status_code == 200
        data = res.json()
        assert data["contract_version"] == "1.0.0"
        assert data["site_id"] == "site-01"
        assert "server_time" in data


@pytest.mark.asyncio
async def test_auth_login_and_me(api_db):
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # 1. Login with valid credentials
        res = await client.post("/api/auth/login", json={"username": "alpha_user", "password": "secret123"})
        assert res.status_code == 200
        data = res.json()
        assert "access_token" in data
        assert data["role"] == "TENANT"
        assert data["tenant_id"] == "t-alpha"
        assert data["display_name"] == "Alpha Lead"

        token = data["access_token"]

        # 2. GET /api/auth/me
        me_res = await client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})
        assert me_res.status_code == 200
        me_data = me_res.json()
        assert me_data["user_id"] == "u-alpha"
        assert me_data["role"] == "TENANT"
        assert me_data["tenant_id"] == "t-alpha"

        # 3. Bad password -> 401
        bad_res = await client.post("/api/auth/login", json={"username": "alpha_user", "password": "wrong"})
        assert bad_res.status_code == 401
        assert bad_res.json()["error"]["code"] == "UNAUTHENTICATED"


@pytest.mark.asyncio
async def test_topology_endpoint(api_db):
    transport = ASGITransport(app=app)
    token = make_token("u-alpha", "TENANT", "t-alpha")
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        res = await client.get("/api/topology", headers={"Authorization": f"Bearer {token}"})
        assert res.status_code == 200
        data = res.json()
        assert data["site_id"] == "site-01"
        assert len(data["racks"]) == 1
        rack = data["racks"][0]
        assert rack["rack_id"] == "rack-01"
        assert len(rack["slots"]) == 1
        slot = rack["slots"][0]
        assert slot["node_id"] == "r1-n1"
        assert slot["tenant_id"] == "t-alpha"


@pytest.mark.asyncio
async def test_telemetry_endpoint_real_values_and_meta(api_db):
    transport = ASGITransport(app=app)
    token = make_token("u-alpha", "TENANT", "t-alpha")
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        res = await client.get("/api/nodes/r1-n1/telemetry?metric=t_c", headers={"Authorization": f"Bearer {token}"})
        assert res.status_code == 200
        data = res.json()
        assert data["node_id"] == "r1-n1"
        assert data["metric"] == "t_c"
        assert data["unit"] == "C"
        assert len(data["points"]) == 1
        assert data["points"][0]["value"] == 24.61

        meta = data["meta"]
        assert meta["quality"] == "measured"
        assert meta["source"] == "node:r1-n1:dht22"
        assert meta["as_of"] is not None


@pytest.mark.asyncio
async def test_telemetry_endpoint_unknown_node_404(api_db):
    transport = ASGITransport(app=app)
    token = make_token("u-alpha", "TENANT", "t-alpha")
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        res = await client.get("/api/nodes/nonexistent-node/telemetry?metric=t_c", headers={"Authorization": f"Bearer {token}"})
        assert res.status_code == 404
        data = res.json()
        assert "error" in data
        assert data["error"]["code"] == "NOT_FOUND"


@pytest.mark.asyncio
async def test_rack_summary_endpoint(api_db):
    transport = ASGITransport(app=app)
    token = make_token("u-alpha", "TENANT", "t-alpha")
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        res = await client.get("/api/racks/rack-01/summary", headers={"Authorization": f"Bearer {token}"})
        assert res.status_code == 200
        data = res.json()
        assert data["rack_id"] == "rack-01"
        assert data["status"] == "OK"
        assert data["nodes_online"] == 1
        assert data["nodes_total"] == 1
        assert data["worst_margin"] is not None
        assert data["worst_margin"]["metric"] == "t_c"
        assert data["worst_margin"]["value"]["value"] == 2.39
        assert data["worst_margin"]["value"]["meta"]["quality"] == "measured"
