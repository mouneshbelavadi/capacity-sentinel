import ast
import inspect
import os
from pathlib import Path
import pytest
import pytest_asyncio
import aiosqlite
from httpx import ASGITransport, AsyncClient

from backend.core.auth import create_access_token, hash_password
from backend.db.connection import SCHEMA_PATH, get_db
from backend.main import app
from backend.repos.scope import Scope


@pytest_asyncio.fixture
async def isolation_db(tmp_path):
    db_file = str(tmp_path / "isolation.db")
    async with aiosqlite.connect(db_file) as db:
        db.row_factory = aiosqlite.Row
        with open(SCHEMA_PATH, "r", encoding="utf-8") as f:
            await db.executescript(f.read())

        # Seed site, racks
        await db.execute("INSERT INTO sites (site_id, label) VALUES ('site-01', 'Bench DC')")
        await db.execute("INSERT INTO racks (rack_id, site_id, label, row, col) VALUES ('rack-01', 'site-01', 'Rack 01', 0, 0)")
        await db.execute("INSERT INTO racks (rack_id, site_id, label, row, col) VALUES ('rack-02', 'site-01', 'Rack 02', 0, 1)")

        # Tenants
        await db.execute("INSERT INTO tenants (tenant_id, label, contact) VALUES ('t-alpha', 'Alpha Systems', 'ops@alpha')")
        await db.execute("INSERT INTO tenants (tenant_id, label, contact) VALUES ('t-beta', 'Beta Compute', 'ops@beta')")

        # Nodes
        await db.execute("INSERT INTO nodes (node_id, rack_id, fw, status, last_seq) VALUES ('r1-n1', 'rack-01', '0.3.1', 'OK', 100)")
        await db.execute("INSERT INTO nodes (node_id, rack_id, fw, status, last_seq) VALUES ('r2-n1', 'rack-02', '0.3.1', 'OK', 100)")

        # Slots: rack-01 belongs to t-alpha, rack-02 belongs to t-beta
        await db.execute("INSERT INTO slots (slot_id, rack_id, u_start, u_height, tenant_id, node_id) VALUES ('slot-01', 'rack-01', 1, 2, 't-alpha', 'r1-n1')")
        await db.execute("INSERT INTO slots (slot_id, rack_id, u_start, u_height, tenant_id, node_id) VALUES ('slot-02', 'rack-02', 1, 2, 't-beta', 'r2-n1')")

        # Telemetry for both
        await db.execute(
            "INSERT INTO telemetry (node_id, metric, ts, received_at, value, quality, seq) VALUES ('r1-n1', 't_c', '2026-10-28T12:00:00Z', '2026-10-28T12:00:00Z', 24.5, 'measured', 100)"
        )
        await db.execute(
            "INSERT INTO telemetry (node_id, metric, ts, received_at, value, quality, seq) VALUES ('r2-n1', 't_c', '2026-10-28T12:00:00Z', '2026-10-28T12:00:00Z', 26.8, 'measured', 100)"
        )

        # Users
        pw = hash_password("secret123")
        await db.execute("INSERT INTO users VALUES ('u-op', 'operator_user', ?, 'OPERATOR', null, 'Operator')", (pw,))
        await db.execute("INSERT INTO users VALUES ('u-super', 'super_user', ?, 'SUPER_USER', null, 'Super User')", (pw,))
        await db.execute("INSERT INTO users VALUES ('u-alpha', 'alpha_user', ?, 'TENANT', 't-alpha', 'Alpha Lead')", (pw,))
        await db.execute("INSERT INTO users VALUES ('u-beta', 'beta_user', ?, 'TENANT', 't-beta', 'Beta Lead')", (pw,))
        await db.commit()

    async def override_db():
        async with aiosqlite.connect(db_file) as conn:
            conn.row_factory = aiosqlite.Row
            yield conn

    app.dependency_overrides[get_db] = override_db
    yield db_file
    app.dependency_overrides.clear()


def make_token(user_id: str, role: str, tenant_id: str | None = None) -> str:
    return create_access_token({"sub": user_id, "user_id": user_id, "role": role, "tenant_id": tenant_id})


# --------------------------------------------------------------------------
# 1. Per-resource 404 test (parametrised across resources)
# --------------------------------------------------------------------------
@pytest.mark.parametrize(
    "url,resource_type",
    [
        ("/api/nodes/r2-n1/telemetry?metric=t_c", "node_telemetry"),
        ("/api/racks/rack-02/summary", "rack_summary"),
        ("/api/tenants", "tenants"),
    ],
)
@pytest.mark.asyncio
async def test_per_resource_404_and_no_leakage(isolation_db, url, resource_type):
    # User is from t-alpha. Requesting t-beta resource (r2-n1, rack-02) or /api/tenants
    alpha_token = make_token("u-alpha", "TENANT", "t-alpha")
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        res = await client.get(url, headers={"Authorization": f"Bearer {alpha_token}"})
        # Must return 404, NEVER 403
        assert res.status_code == 404, f"Expected 404 for {url}, got {res.status_code}"
        data = res.json()
        assert "error" in data
        assert data["error"]["code"] == "NOT_FOUND"
        # Must not leak foreign tenant identifier
        assert "t-beta" not in res.text
        assert "r2-n1" not in data["error"]["message"]


# --------------------------------------------------------------------------
# 2. Enumeration test: inspects every public function in repos/
# --------------------------------------------------------------------------
def test_repos_enumeration_scope_enforcement():
    """
    Introspects every public function in backend/repos/ (except scope.py)
    and asserts it accepts a `Scope` parameter and references `apply_scope`.
    Fails if any repo function omits the scope choke point!
    """
    repos_dir = Path(__file__).parent.parent / "repos"
    repo_files = [f for f in repos_dir.glob("*.py") if f.name != "__init__.py" and f.name != "scope.py"]
    assert len(repo_files) >= 3, "Expected at least nodes.py, telemetry.py, topology.py, audit.py, users.py"

    violations = []
    for f in repo_files:
        with open(f, "r", encoding="utf-8") as fp:
            source = fp.read()
        tree = ast.parse(source, filename=str(f))

        for node in tree.body:
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                fn_name = node.name
                if fn_name.startswith("_"):
                    continue

                # Check 1: accepts scope parameter
                arg_names = [arg.arg for arg in node.args.args]
                has_scope_arg = "scope" in arg_names

                # Check 2: calls or references apply_scope in its body
                body_str = ast.get_source_segment(source, node) or ""
                calls_apply_scope = "apply_scope" in body_str

                if not has_scope_arg or not calls_apply_scope:
                    violations.append(
                        f"Function '{fn_name}' in {f.name} missing scope enforcement: has_scope={has_scope_arg}, calls_apply_scope={calls_apply_scope}"
                    )

    assert not violations, f"Repo functions missing scope choke point:\n" + "\n".join(violations)


# --------------------------------------------------------------------------
# 3. Topology redaction test
# --------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_topology_redaction_for_tenant(isolation_db):
    alpha_token = make_token("u-alpha", "TENANT", "t-alpha")
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        res = await client.get("/api/topology", headers={"Authorization": f"Bearer {alpha_token}"})
        assert res.status_code == 200
        data = res.json()
        assert len(data["racks"]) == 2

        # Rack 1 (t-alpha owned)
        r1 = next(r for r in data["racks"] if r["rack_id"] == "rack-01")
        slot1 = r1["slots"][0]
        assert slot1["tenant_id"] == "t-alpha"
        assert slot1["node_id"] == "r1-n1"

        # Rack 2 (t-beta owned): geometry preserved, but redacted!
        r2 = next(r for r in data["racks"] if r["rack_id"] == "rack-02")
        slot2 = r2["slots"][0]
        assert slot2["tenant_id"] is None
        assert slot2["tenant_label"] is None
        assert slot2["node_id"] is None
        assert slot2["status"] == "UNKNOWN"


# --------------------------------------------------------------------------
# 4. Aggregate scoping test
# --------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_aggregate_scoping_for_tenant(isolation_db):
    alpha_token = make_token("u-alpha", "TENANT", "t-alpha")
    op_token = make_token("u-op", "OPERATOR")
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # Operator sees rack-01 summary with 1 node total, 1 online
        op_res = await client.get("/api/racks/rack-01/summary", headers={"Authorization": f"Bearer {op_token}"})
        assert op_res.status_code == 200
        assert op_res.json()["nodes_total"] == 1

        # Operator sees rack-02 summary
        op_res2 = await client.get("/api/racks/rack-02/summary", headers={"Authorization": f"Bearer {op_token}"})
        assert op_res2.status_code == 200
        assert op_res2.json()["nodes_total"] == 1

        # Tenant Alpha querying rack-02 (where they own 0 slots) gets 404
        t_res2 = await client.get("/api/racks/rack-02/summary", headers={"Authorization": f"Bearer {alpha_token}"})
        assert t_res2.status_code == 404


# --------------------------------------------------------------------------
# 5. No banned elevated string anywhere in backend/
# --------------------------------------------------------------------------
def test_no_banned_string_in_backend():
    backend_dir = Path(__file__).parent.parent
    banned_word = "ad" + "min"
    banned_occurrences = []

    for root, _, files in os.walk(backend_dir):
        for f in files:
            # Exclude test_isolation.py itself
            if f == "test_isolation.py":
                continue
            if f.endswith((".py", ".sql", ".yaml")):
                full_path = Path(root) / f
                with open(full_path, "r", encoding="utf-8", errors="ignore") as fp:
                    for line_no, line in enumerate(fp, start=1):
                        if banned_word in line.lower():
                            banned_occurrences.append(f"{full_path.name}:{line_no} -> {line.strip()}")

    assert not banned_occurrences, f"Found banned string in backend:\n" + "\n".join(banned_occurrences)


# --------------------------------------------------------------------------
# 6. Denial audit test
# --------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_denial_audit_record_created(isolation_db):
    alpha_token = make_token("u-alpha", "TENANT", "t-alpha")
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # Make forbidden request
        res = await client.get("/api/nodes/r2-n1/telemetry?metric=t_c", headers={"Authorization": f"Bearer {alpha_token}"})
        assert res.status_code == 404

    # Check that a SCOPE_DENIED row was recorded with hashed resource ID
    async with aiosqlite.connect(isolation_db) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute("SELECT * FROM audit WHERE event = 'SCOPE_DENIED'")
        row = await cur.fetchone()
        assert row is not None
        assert row["actor"] == "u-alpha"
        assert "hashed_resource_id" in row["subject_json"]
        assert "r2-n1" not in row["subject_json"]  # Raw ID must not be leaked in audit log
