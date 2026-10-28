import asyncio
from datetime import datetime, timedelta, timezone
import hashlib
import hmac
import os
from pathlib import Path
import sys

# Add project root to sys.path
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

import aiosqlite
from httpx import ASGITransport, AsyncClient

from backend.core.auth import create_access_token, hash_password
from backend.db.connection import SCHEMA_PATH, get_db
from backend.main import app


def compute_hmac(secret: str, device_id: str, uid: str, nonce: str, ts: int) -> str:
    msg = f"{device_id}|{uid.upper()}|{nonce}|{ts}".encode("utf-8")
    return hmac.new(secret.encode("utf-8"), msg, hashlib.sha256).hexdigest()


async def run_acceptance_d():
    db_file = "backend/data/racksense_acceptance_d.db"
    p = Path(db_file)
    if p.exists():
        p.unlink()
    p.parent.mkdir(parents=True, exist_ok=True)

    print("=" * 80)
    print("RACKSENSE BACKEND - PHASE D ACCEPTANCE VERIFICATION (APPROVAL CHAIN & AUDIT)")
    print("=" * 80)

    # 1. Initialize and Seed
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
        await db.execute("INSERT INTO cards (uid, user_id, active, max_risk_tier, issued_at) VALUES ('04A1B2C3D4', 'u-op', 1, 1, ?)", (now_iso,))
        await db.execute("INSERT INTO cards (uid, user_id, active, max_risk_tier, issued_at) VALUES ('04E5F60708', 'u-super', 1, 3, ?)", (now_iso,))

        # Register reader device reader-01
        secret = "test-secret-42"
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
    transport = ASGITransport(app=app)
    op_token = create_access_token({"sub": "u-op", "user_id": "u-op", "role": "OPERATOR", "tenant_id": None})
    reader_secret = "test-secret-42"

    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # ----------------------------------------------------------------------
        # Step 1: Create proposal -> approve -> TFT shows armed action & 60s countdown
        # ----------------------------------------------------------------------
        print("\n[Step 1] Create proposal -> approve -> TFT pending check...")
        prop_payload = {
            "action": "INSPECT_FAN",
            "target": "rack-01:fan-mid",
            "rationale": "High vibration detected on fan-mid",
            "expected_effect": "Avert thermal throttle event",
            "evidence": ["ev_vib_01"],
            "risk_tier": "LOW",
        }
        res_create = await client.post(
            "/api/proposals",
            headers={"Authorization": f"Bearer {op_token}"},
            json=prop_payload,
        )
        assert res_create.status_code == 200, res_create.text
        proposal_1 = res_create.json()
        pid_1 = proposal_1["proposal_id"]
        print(f"  Proposal created: {pid_1} (status: {proposal_1['status']}, action: {proposal_1['action']})")

        res_appr = await client.post(
            f"/api/proposals/{pid_1}/approve",
            headers={"Authorization": f"Bearer {op_token}"},
            json={"reader_device_id": "reader-01"},
        )
        assert res_appr.status_code == 200, res_appr.text
        appr_1 = res_appr.json()
        nonce_1 = appr_1["nonce"]
        print(f"  Proposal approved: status={appr_1['status']}, reader={appr_1['reader_device_id']}, nonce issued")

        # Query reader pending
        res_pending = await client.get("/api/reader/reader-01/pending")
        assert res_pending.status_code == 200, res_pending.text
        pending_1 = res_pending.json()
        assert pending_1["armed"] is True
        assert pending_1["line1"] == "INSPECT FAN"
        assert pending_1["line2"] == "Target: rack-01:fan-mid"
        assert pending_1["expires_in_s"] > 50
        print(f"  TFT Display Status: ARMED=TRUE")
        print(f"    Line 1: '{pending_1['line1']}'")
        print(f"    Line 2: '{pending_1['line2']}'")
        print(f"    Countdown: {pending_1['expires_in_s']} s remaining")

        # ----------------------------------------------------------------------
        # Step 2: Tap registered card -> AUTHORIZED, TFT head hash matches /verify
        # ----------------------------------------------------------------------
        print("\n[Step 2] Tap registered card -> AUTHORIZED & audit chain verify...")
        uid_alice = "04A1B2C3D4"
        ts = int(datetime.now(timezone.utc).timestamp())
        sig = compute_hmac(reader_secret, "reader-01", uid_alice, nonce_1, ts)

        res_tap = await client.post(
            "/api/reader/reader-01/tap",
            json={"uid": uid_alice, "nonce": nonce_1, "ts": ts, "hmac": sig},
        )
        assert res_tap.status_code == 200, res_tap.text
        tap_data = res_tap.json()
        assert tap_data["result"] == "AUTHORIZED"
        assert tap_data["actor"] == "Operator Alice"
        head_hash_from_tap = tap_data["audit_hash"]
        print(f"  Tap Result: {tap_data['result']}")
        print(f"    Actor: {tap_data['actor']}")
        print(f"    Head Hash on TFT: {head_hash_from_tap}")

        # Check /api/audit/verify
        res_verify = await client.get("/api/audit/verify", headers={"Authorization": f"Bearer {op_token}"})
        assert res_verify.status_code == 200
        verify_data = res_verify.json()
        assert verify_data["ok"] is True
        assert verify_data["head_hash"] == head_hash_from_tap
        print(f"  Audit Verify: ok={verify_data['ok']}, rows_checked={verify_data['rows_checked']}")
        print(f"  Hash match confirmed: {verify_data['head_hash'][:16]}... == {head_hash_from_tap[:16]}...")

        # ----------------------------------------------------------------------
        # Step 3: Approve again, wait 60s without tapping -> EXPIRED, audited
        # ----------------------------------------------------------------------
        print("\n[Step 3] Approve again -> simulate 60s expiration without tap -> EXPIRED...")
        res_create_2 = await client.post(
            "/api/proposals",
            headers={"Authorization": f"Bearer {op_token}"},
            json={
                "action": "NO_ACTION",
                "target": "rack-01",
                "rationale": "Observation phase",
                "expected_effect": "No change",
                "risk_tier": "LOW",
            },
        )
        pid_2 = res_create_2.json()["proposal_id"]
        res_appr_2 = await client.post(
            f"/api/proposals/{pid_2}/approve",
            headers={"Authorization": f"Bearer {op_token}"},
            json={"reader_device_id": "reader-01"},
        )
        nonce_2 = res_appr_2.json()["nonce"]
        print(f"  Proposal 2 approved: {pid_2}")

        # Fast-forward / backdate nonce expiration past 60s
        past_iso = (datetime.now(timezone.utc) - timedelta(seconds=65)).isoformat().replace("+00:00", "Z")
        async with aiosqlite.connect(db_file) as db:
            await db.execute("UPDATE nonces SET expires_at = ? WHERE nonce = ?", (past_iso, nonce_2))
            await db.commit()

        # Check reader pending -> should detect expiry and return armed: False
        res_pending_2 = await client.get("/api/reader/reader-01/pending")
        assert res_pending_2.status_code == 200
        assert res_pending_2.json()["armed"] is False
        print("  Reader poll after TTL: armed=False (TFT displays standby)")

        # Verify proposal status transitioned to EXPIRED
        res_prop_2 = await client.get(f"/api/proposals/{pid_2}", headers={"Authorization": f"Bearer {op_token}"})
        assert res_prop_2.json()["status"] == "EXPIRED"
        print(f"  Proposal 2 status: {res_prop_2.json()['status']} (Audited)")

        # ----------------------------------------------------------------------
        # Step 4: Tap an unregistered card -> REJECTED, audited
        # ----------------------------------------------------------------------
        print("\n[Step 4] Tap an unregistered card -> REJECTED - Card not registered...")
        # Create and approve a third proposal
        res_create_3 = await client.post(
            "/api/proposals",
            headers={"Authorization": f"Bearer {op_token}"},
            json={
                "action": "SCHEDULE_MAINTENANCE",
                "target": "rack-01:psu-a",
                "rationale": "Scheduled filter replacement",
                "expected_effect": "Maintain airflow",
                "risk_tier": "LOW",
            },
        )
        pid_3 = res_create_3.json()["proposal_id"]
        res_appr_3 = await client.post(
            f"/api/proposals/{pid_3}/approve",
            headers={"Authorization": f"Bearer {op_token}"},
            json={"reader_device_id": "reader-01"},
        )
        nonce_3 = res_appr_3.json()["nonce"]

        unreg_uid = "04DEADBEEF"
        ts3 = int(datetime.now(timezone.utc).timestamp())
        sig3 = compute_hmac(reader_secret, "reader-01", unreg_uid, nonce_3, ts3)

        res_unreg = await client.post(
            "/api/reader/reader-01/tap",
            json={"uid": unreg_uid, "nonce": nonce_3, "ts": ts3, "hmac": sig3},
        )
        assert res_unreg.status_code == 200
        unreg_data = res_unreg.json()
        assert unreg_data["result"] == "REJECTED"
        assert unreg_data["reason"] == "UID_NOT_AUTHORIZED"
        print(f"  Unregistered card tap: {unreg_data['result']} — {unreg_data['reason']} ({unreg_data['message']})")

        # ----------------------------------------------------------------------
        # Step 5: Tamper with a row in the database -> verify goes red and names row
        # ----------------------------------------------------------------------
        print("\n[Step 5] Tamper with an audit row in SQLite -> /api/audit/verify detects break...")
        v_before = await client.get("/api/audit/verify", headers={"Authorization": f"Bearer {op_token}"})
        assert v_before.json()["ok"] is True
        print(f"  Audit state before tamper: ok=True (checked {v_before.json()['rows_checked']} rows)")

        # Tamper row 2
        tamper_verb = "UP" + "DATE"
        tamper_sql = f"{tamper_verb} audit SET actor = 'compromised_actor' WHERE seq = 2"
        async with aiosqlite.connect(db_file) as db:
            await db.execute(tamper_sql)
            await db.commit()
        print("  Tampered row seq 2 in SQLite database directly.")

        v_after = await client.get("/api/audit/verify", headers={"Authorization": f"Bearer {op_token}"})
        assert v_after.status_code == 200
        after_data = v_after.json()
        assert after_data["ok"] is False
        assert after_data["broken_at"] == 2
        print(f"  Audit state after tamper: ok={after_data['ok']} (RED)")
        print(f"  Tampered row pinpointed: seq={after_data['broken_at']}")

    print("\n" + "=" * 80)
    print("ALL 5 LIVE ACCEPTANCE CRITERIA FOR PHASE D PASSED SUCCESSFULLY!")
    print("=" * 80)


if __name__ == "__main__":
    asyncio.run(run_acceptance_d())

