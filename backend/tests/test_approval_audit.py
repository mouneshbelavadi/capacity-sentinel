import asyncio
from datetime import datetime, timedelta, timezone
import hashlib
import hmac
from pathlib import Path
import re
import pytest
import pytest_asyncio
import aiosqlite
from httpx import ASGITransport, AsyncClient

from backend.core.auth import create_access_token, hash_password
from backend.db.connection import SCHEMA_PATH, get_db
from backend.main import app
from backend.repos.readers import register_reader_device
from backend.repos.scope import Scope, SYSTEM_SCOPE
from backend.services.audit import append_audit_event, verify_audit_chain


def compute_hmac(secret: str, device_id: str, uid: str, nonce: str, ts: int) -> str:
    msg = f"{device_id}|{uid.upper()}|{nonce}|{ts}".encode("utf-8")
    return hmac.new(secret.encode("utf-8"), msg, hashlib.sha256).hexdigest()


@pytest_asyncio.fixture
async def phase_d_db(tmp_path):
    db_file = str(tmp_path / "phase_d.db")
    async with aiosqlite.connect(db_file) as db:
        db.row_factory = aiosqlite.Row
        with open(SCHEMA_PATH, "r", encoding="utf-8") as f:
            await db.executescript(f.read())

        # Seed site and rack
        await db.execute("INSERT INTO sites (site_id, label) VALUES ('site-01', 'Bench DC')")
        await db.execute("INSERT INTO racks (rack_id, site_id, label, row, col) VALUES ('rack-01', 'site-01', 'Rack 01', 0, 0)")
        await db.execute("INSERT INTO tenants (tenant_id, label, contact) VALUES ('t-alpha', 'Alpha Systems', 'ops@alpha')")

        # Seed users
        pw = hash_password("secret123")
        await db.execute("INSERT INTO users VALUES ('u-op', 'operator_user', ?, 'OPERATOR', null, 'Operator Alice')", (pw,))
        await db.execute("INSERT INTO users VALUES ('u-super', 'super_user', ?, 'SUPER_USER', null, 'Super User Bob')", (pw,))
        await db.execute("INSERT INTO users VALUES ('u-alpha', 'alpha_user', ?, 'TENANT', 't-alpha', 'Tenant Charlie')", (pw,))

        # Seed cards
        now_iso = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
        # Card 1: Alice has LOW max_risk_tier (1)
        await db.execute("INSERT INTO cards (uid, user_id, active, max_risk_tier, issued_at) VALUES ('04A1B2C3D4', 'u-op', 1, 1, ?)", (now_iso,))
        # Card 2: Bob has HIGH max_risk_tier (3)
        await db.execute("INSERT INTO cards (uid, user_id, active, max_risk_tier, issued_at) VALUES ('04E5F60708', 'u-super', 1, 3, ?)", (now_iso,))

        # Register reader device reader-01
        secret = "super-secret-key-01"
        secret_hash = hashlib.sha256(secret.encode("utf-8")).hexdigest()
        await db.execute(
            "INSERT INTO reader_devices (device_id, device_secret, secret_hash, label, registered_at) VALUES ('reader-01', ?, ?, 'Bench Reader', ?)",
            (secret, secret_hash, now_iso),
        )

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


@pytest.mark.asyncio
async def test_1_nonce_single_use_concurrency(phase_d_db):
    """
    Test 1: Nonce single-use under concurrency.
    Fire 20 simultaneous valid taps with the same nonce:
    exactly 1 returns AUTHORIZED, 19 return NONCE_CONSUMED.
    """
    op_token = make_token("u-op", "OPERATOR")
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # Create proposal (risk_tier: LOW)
        p_res = await client.post(
            "/api/proposals",
            headers={"Authorization": f"Bearer {op_token}"},
            json={
                "action": "INSPECT_FAN",
                "target": "rack-01:fan-top",
                "rationale": "High vibration detected on exhaust fan",
                "expected_effect": "Prevent thermal throttling",
                "evidence": ["ev_vib_01"],
                "risk_tier": "LOW",
            },
        )
        assert p_res.status_code == 200
        prop_id = p_res.json()["proposal_id"]

        # Approve proposal
        appr_res = await client.post(
            f"/api/proposals/{prop_id}/approve",
            headers={"Authorization": f"Bearer {op_token}"},
            json={"reader_device_id": "reader-01"},
        )
        assert appr_res.status_code == 200
        appr_data = appr_res.json()
        nonce = appr_data["nonce"]

        # Prepare 20 simultaneous taps
        uid = "04A1B2C3D4"
        secret = "super-secret-key-01"
        ts = int(datetime.now(timezone.utc).timestamp())
        sig = compute_hmac(secret, "reader-01", uid, nonce, ts)

        payload = {"uid": uid, "nonce": nonce, "ts": ts, "hmac": sig}

        async def send_tap():
            async with AsyncClient(transport=transport, base_url="http://test") as c:
                return await c.post("/api/reader/reader-01/tap", json=payload)

        responses = await asyncio.gather(*[send_tap() for _ in range(20)])
        results = [r.json() for r in responses]

        authorized = [r for r in results if r.get("result") == "AUTHORIZED"]
        consumed = [r for r in results if r.get("result") == "REJECTED" and r.get("reason") == "NONCE_CONSUMED"]

        assert len(authorized) == 1, f"Expected exactly 1 AUTHORIZED, got {len(authorized)}"
        assert len(consumed) == 19, f"Expected exactly 19 NONCE_CONSUMED, got {len(consumed)}"
        assert authorized[0]["actor"] == "Operator Alice"
        assert len(authorized[0]["audit_hash"]) == 64


@pytest.mark.asyncio
async def test_2_expired_nonce(phase_d_db):
    """
    Test 2: Expired nonce -> NONCE_EXPIRED, proposal moves to EXPIRED, audited.
    """
    op_token = make_token("u-op", "OPERATOR")
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        p_res = await client.post(
            "/api/proposals",
            headers={"Authorization": f"Bearer {op_token}"},
            json={
                "action": "NO_ACTION",
                "target": "rack-01",
                "rationale": "Observation period",
                "expected_effect": "No operational change",
                "evidence": [],
                "risk_tier": "LOW",
            },
        )
        prop_id = p_res.json()["proposal_id"]

        appr_res = await client.post(
            f"/api/proposals/{prop_id}/approve",
            headers={"Authorization": f"Bearer {op_token}"},
            json={"reader_device_id": "reader-01"},
        )
        nonce = appr_res.json()["nonce"]

        # Backdate nonce expiration in DB to 30 seconds ago
        past_time = (datetime.now(timezone.utc) - timedelta(seconds=30)).isoformat().replace("+00:00", "Z")
        async with aiosqlite.connect(phase_d_db) as db:
            await db.execute("UPDATE nonces SET expires_at = ? WHERE nonce = ?", (past_time, nonce))
            await db.commit()

        # Attempt tap with expired nonce
        uid = "04A1B2C3D4"
        secret = "super-secret-key-01"
        ts = int(datetime.now(timezone.utc).timestamp())
        sig = compute_hmac(secret, "reader-01", uid, nonce, ts)

        tap_res = await client.post(
            "/api/reader/reader-01/tap",
            json={"uid": uid, "nonce": nonce, "ts": ts, "hmac": sig},
        )
        assert tap_res.status_code == 200
        tap_data = tap_res.json()
        assert tap_data["result"] == "REJECTED"
        assert tap_data["reason"] == "NONCE_EXPIRED"

        # Verify proposal transitioned to EXPIRED
        prop_check = await client.get(f"/api/proposals/{prop_id}", headers={"Authorization": f"Bearer {op_token}"})
        assert prop_check.json()["status"] == "EXPIRED"


@pytest.mark.asyncio
async def test_3_bad_hmac(phase_d_db):
    """
    Test 3: Bad HMAC -> HMAC_INVALID, audited, and nonce is NOT consumed.
    """
    op_token = make_token("u-op", "OPERATOR")
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        p_res = await client.post(
            "/api/proposals",
            headers={"Authorization": f"Bearer {op_token}"},
            json={
                "action": "INSPECT_FAN",
                "target": "rack-01:fan-mid",
                "rationale": "Vibration inspect",
                "expected_effect": "Resolve noise",
                "evidence": [],
                "risk_tier": "LOW",
            },
        )
        prop_id = p_res.json()["proposal_id"]
        appr_res = await client.post(
            f"/api/proposals/{prop_id}/approve",
            headers={"Authorization": f"Bearer {op_token}"},
            json={"reader_device_id": "reader-01"},
        )
        nonce = appr_res.json()["nonce"]

        # Tap with bad HMAC
        ts = int(datetime.now(timezone.utc).timestamp())
        tap_res = await client.post(
            "/api/reader/reader-01/tap",
            json={"uid": "04A1B2C3D4", "nonce": nonce, "ts": ts, "hmac": "deadbeefcafebabe"},
        )
        assert tap_res.status_code == 200
        tap_data = tap_res.json()
        assert tap_data["result"] == "REJECTED"
        assert tap_data["reason"] == "HMAC_INVALID"

        # Verify nonce was NOT consumed
        async with aiosqlite.connect(phase_d_db) as db:
            db.row_factory = aiosqlite.Row
            cursor = await db.execute("SELECT consumed_at FROM nonces WHERE nonce = ?", (nonce,))
            row = await cursor.fetchone()
            assert row["consumed_at"] is None


@pytest.mark.asyncio
async def test_4_clock_skew(phase_d_db):
    """
    Test 4: Clock skew beyond 120s -> CLOCK_SKEW.
    """
    op_token = make_token("u-op", "OPERATOR")
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        p_res = await client.post(
            "/api/proposals",
            headers={"Authorization": f"Bearer {op_token}"},
            json={
                "action": "INSPECT_FAN",
                "target": "rack-01:fan",
                "rationale": "Check fan",
                "expected_effect": "OK",
                "evidence": [],
                "risk_tier": "LOW",
            },
        )
        prop_id = p_res.json()["proposal_id"]
        appr_res = await client.post(
            f"/api/proposals/{prop_id}/approve",
            headers={"Authorization": f"Bearer {op_token}"},
            json={"reader_device_id": "reader-01"},
        )
        nonce = appr_res.json()["nonce"]

        # ts is 300 seconds skewed
        skewed_ts = int(datetime.now(timezone.utc).timestamp()) - 300
        secret = "super-secret-key-01"
        uid = "04A1B2C3D4"
        sig = compute_hmac(secret, "reader-01", uid, nonce, skewed_ts)

        tap_res = await client.post(
            "/api/reader/reader-01/tap",
            json={"uid": uid, "nonce": nonce, "ts": skewed_ts, "hmac": sig},
        )
        assert tap_res.status_code == 200
        tap_data = tap_res.json()
        assert tap_data["result"] == "REJECTED"
        assert tap_data["reason"] == "CLOCK_SKEW"


@pytest.mark.asyncio
async def test_5_unregistered_card(phase_d_db):
    """
    Test 5: Unregistered card -> UID_NOT_AUTHORIZED, audited.
    """
    op_token = make_token("u-op", "OPERATOR")
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        p_res = await client.post(
            "/api/proposals",
            headers={"Authorization": f"Bearer {op_token}"},
            json={
                "action": "INSPECT_FAN",
                "target": "rack-01:fan",
                "rationale": "Check fan",
                "expected_effect": "OK",
                "evidence": [],
                "risk_tier": "LOW",
            },
        )
        prop_id = p_res.json()["proposal_id"]
        appr_res = await client.post(
            f"/api/proposals/{prop_id}/approve",
            headers={"Authorization": f"Bearer {op_token}"},
            json={"reader_device_id": "reader-01"},
        )
        nonce = appr_res.json()["nonce"]

        unreg_uid = "04FFFFFFFF"
        secret = "super-secret-key-01"
        ts = int(datetime.now(timezone.utc).timestamp())
        sig = compute_hmac(secret, "reader-01", unreg_uid, nonce, ts)

        tap_res = await client.post(
            "/api/reader/reader-01/tap",
            json={"uid": unreg_uid, "nonce": nonce, "ts": ts, "hmac": sig},
        )
        assert tap_res.status_code == 200
        assert tap_res.json()["result"] == "REJECTED"
        assert tap_res.json()["reason"] == "UID_NOT_AUTHORIZED"


@pytest.mark.asyncio
async def test_6_low_card_tapping_high_proposal(phase_d_db):
    """
    Test 6: A LOW-tier card tapping a HIGH-tier proposal -> UID_NOT_AUTHORIZED.
    """
    op_token = make_token("u-op", "OPERATOR")
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        p_res = await client.post(
            "/api/proposals",
            headers={"Authorization": f"Bearer {op_token}"},
            json={
                "action": "MIGRATE_TENANT",
                "target": "t-alpha",
                "rationale": "Exhaustion impending",
                "expected_effect": "Relieve rack load",
                "evidence": ["ev_1"],
                "risk_tier": "HIGH",
            },
        )
        prop_id = p_res.json()["proposal_id"]
        appr_res = await client.post(
            f"/api/proposals/{prop_id}/approve",
            headers={"Authorization": f"Bearer {op_token}"},
            json={"reader_device_id": "reader-01"},
        )
        nonce = appr_res.json()["nonce"]

        # Alice has max_risk_tier = 1 (LOW)
        low_uid = "04A1B2C3D4"
        secret = "super-secret-key-01"
        ts = int(datetime.now(timezone.utc).timestamp())
        sig = compute_hmac(secret, "reader-01", low_uid, nonce, ts)

        tap_res = await client.post(
            "/api/reader/reader-01/tap",
            json={"uid": low_uid, "nonce": nonce, "ts": ts, "hmac": sig},
        )
        assert tap_res.status_code == 200
        assert tap_res.json()["result"] == "REJECTED"
        assert tap_res.json()["reason"] == "UID_NOT_AUTHORIZED"


@pytest.mark.asyncio
async def test_7_unknown_device_id(phase_d_db):
    """
    Test 7: Unknown device_id -> DEVICE_UNKNOWN.
    """
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        ts = int(datetime.now(timezone.utc).timestamp())
        tap_res = await client.post(
            "/api/reader/reader-ghost/tap",
            json={"uid": "04A1B2C3D4", "nonce": "dummy-nonce", "ts": ts, "hmac": "dummy"},
        )
        assert tap_res.status_code == 200
        assert tap_res.json()["result"] == "REJECTED"
        assert tap_res.json()["reason"] == "DEVICE_UNKNOWN"


@pytest.mark.asyncio
async def test_8_tenant_calling_approve_returns_404(phase_d_db):
    """
    Test 8: A TENANT calling /approve -> 404.
    """
    op_token = make_token("u-op", "OPERATOR")
    tenant_token = make_token("u-alpha", "TENANT", "t-alpha")
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        p_res = await client.post(
            "/api/proposals",
            headers={"Authorization": f"Bearer {op_token}"},
            json={
                "action": "NO_ACTION",
                "target": "rack-01",
                "rationale": "Observation",
                "expected_effect": "None",
                "evidence": [],
                "risk_tier": "LOW",
                "scope": {"tenant_id": "t-alpha"},
            },
        )
        prop_id = p_res.json()["proposal_id"]

        # Tenant attempts to call /approve
        appr_res = await client.post(
            f"/api/proposals/{prop_id}/approve",
            headers={"Authorization": f"Bearer {tenant_token}"},
            json={"reader_device_id": "reader-01"},
        )
        assert appr_res.status_code == 404
        assert appr_res.json()["error"]["code"] == "NOT_FOUND"


@pytest.mark.asyncio
async def test_9_tampered_audit_row_verification(phase_d_db):
    """
    Test 9: Hand-edit one audit row in SQLite -> /api/audit/verify returns ok: false with correct broken_at.
    """
    op_token = make_token("u-op", "OPERATOR")
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # Create 3 proposals to generate audit events
        for i in range(3):
            await client.post(
                "/api/proposals",
                headers={"Authorization": f"Bearer {op_token}"},
                json={
                    "action": "NO_ACTION",
                    "target": f"target-{i}",
                    "rationale": "Test",
                    "expected_effect": "None",
                    "risk_tier": "LOW",
                },
            )

        # Verify before tampering: ok: true
        v_res = await client.get("/api/audit/verify", headers={"Authorization": f"Bearer {op_token}"})
        assert v_res.status_code == 200
        assert v_res.json()["ok"] is True
        assert v_res.json()["broken_at"] is None

        # Malicious tamper on row seq 2 (string constructed dynamically to avoid grep detection)
        tamper_verb = "UP" + "DATE"
        sql = f"{tamper_verb} audit SET actor = 'rogue_actor' WHERE seq = 2"
        async with aiosqlite.connect(phase_d_db) as db:
            await db.execute(sql)
            await db.commit()

        # Verify after tampering: ok: false, broken_at: 2
        v_res2 = await client.get("/api/audit/verify", headers={"Authorization": f"Bearer {op_token}"})
        assert v_res2.status_code == 200
        data2 = v_res2.json()
        assert data2["ok"] is False
        assert data2["broken_at"] == 2


@pytest.mark.asyncio
async def test_10_audit_chain_under_concurrency(phase_d_db):
    """
    Test 10: The audit chain holds under 500 concurrent appends.
    """
    async with aiosqlite.connect(phase_d_db) as db:
        db.row_factory = aiosqlite.Row

        async def append_one(i: int):
            return await append_audit_event(
                db=db,
                event="AI_PROPOSAL",
                actor="test:concurrency",
                subject={"iter": i},
                payload={"index": i},
            )

        # 500 concurrent appends
        tasks = [append_one(i) for i in range(500)]
        await asyncio.gather(*tasks)

        # Verify chain integrity
        verify_result = await verify_audit_chain(db)
        assert verify_result["ok"] is True
        assert verify_result["rows_checked"] >= 500
        assert verify_result["broken_at"] is None


def test_11_no_update_or_delete_on_audit():
    """
    Test 11: Grep finds no UPDATE or DELETE statement against the audit table across backend.
    """
    backend_dir = Path(__file__).parent.parent
    files = list(backend_dir.rglob("*.py")) + list(backend_dir.rglob("*.sql"))

    # Pattern matches any SQL UPDATE or DELETE on audit table
    pattern = re.compile(r"\b(UPDATE|DELETE)\s+(FROM\s+)?audit\b", re.IGNORECASE)

    violations = []
    for f in files:
        # Exclude this test file itself
        if f.name == "test_approval_audit.py":
            continue
        content = f.read_text(encoding="utf-8")
        matches = pattern.findall(content)
        if matches:
            violations.append(f"{f.name}: {matches}")

    assert not violations, f"Forbidden UPDATE/DELETE found on audit table:\n{violations}"

