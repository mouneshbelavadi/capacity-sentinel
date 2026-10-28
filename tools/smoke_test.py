#!/usr/bin/env python3
"""
RackSense End-to-End System Smoke Test.

Validates the full system flow in a single executable command:
1. Ingests a known sensor telemetry reading.
2. Polls REST API to confirm ingestion with correct provenance quality.
3. Opens authenticated WebSocket, subscribes, and verifies telemetry broadcast.
4. Creates an advisory proposal.
5. Operator approves proposal, issuing a 60-second cryptographic nonce.
6. Reader console queries pending action and submits signed RFID tap (HMAC-SHA256).
7. Verifies proposal status transitions to AUTHORIZED.
8. Verifies cryptographic SHA-256 audit ledger from genesis to head.

Exit code 0 on complete pass, 1 on any failure.
"""

import asyncio
from datetime import datetime, timezone
import hashlib
import hmac
import json
import os
import sys
import time
from pathlib import Path

# Add project root to path
REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))

import aiosqlite
from starlette.testclient import TestClient

from backend.core.auth import create_access_token, hash_password
from backend.core.config import settings
from backend.db.connection import SCHEMA_PATH
from backend.ingest.normalise import normalise_payload
from backend.ingest.validate import validate_telemetry_message
from backend.main import app
from backend.services.broadcaster import broadcaster


READER_SECRET = "demo-reader-device-secret-key-32ch"
READER_SECRET_HASH = hashlib.sha256(READER_SECRET.encode("utf-8")).hexdigest()
OPERATOR_CARD_UID = "04A1B2C3D4"


async def setup_test_environment(db_path: str):
    """Seed test database with required topology, reader device, and users."""
    async with aiosqlite.connect(db_path) as db:
        db.row_factory = aiosqlite.Row
        with open(SCHEMA_PATH, "r", encoding="utf-8") as f:
            await db.executescript(f.read())

        # Topology
        await db.execute("INSERT OR REPLACE INTO sites VALUES ('site-01', 'Bench DC Site 01')")
        await db.execute("INSERT OR REPLACE INTO racks VALUES ('rack-01', 'site-01', 'Rack 01', 0, 0)")
        await db.execute("INSERT OR REPLACE INTO tenants VALUES ('t-alpha', 'Alpha Systems', 'ops@alpha.local')")
        await db.execute("INSERT OR REPLACE INTO nodes (node_id, rack_id, fw, status, last_seq) VALUES ('r1-n1', 'rack-01', '0.3.1', 'OK', 10)")
        await db.execute("INSERT OR REPLACE INTO slots VALUES ('rack-01-u12', 'rack-01', 12, 2, 't-alpha', 'r1-n1')")

        # Users
        pw = hash_password("secret123")
        await db.execute("INSERT OR REPLACE INTO users VALUES ('u-op1', 'op1', ?, 'OPERATOR', null, 'Operator Alice')", (pw,))
        await db.execute("INSERT OR REPLACE INTO users VALUES ('u-super1', 'super1', ?, 'SUPER_USER', null, 'Super Director')", (pw,))

        # Reader Device
        now_iso = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
        await db.execute(
            """
            INSERT OR REPLACE INTO reader_devices (device_id, device_secret, secret_hash, label, registered_at)
            VALUES ('reader-01', ?, ?, 'Bench RFID Console', ?)
            """,
            (READER_SECRET, READER_SECRET_HASH, now_iso),
        )

        # RFID Card for Operator
        await db.execute(
            """
            INSERT OR REPLACE INTO cards (uid, user_id, active, max_risk_tier, issued_at)
            VALUES (?, 'u-op1', 1, 2, ?)
            """,
            (OPERATOR_CARD_UID, now_iso),
        )

        await db.commit()
        await broadcaster.update_topology_cache(db)


def run_smoke_test() -> bool:
    print("=" * 70)
    print("  RackSense End-to-End System Smoke Test")
    print("=" * 70)

    # Use a clean temporary database for isolated verification
    test_db_path = str(REPO_ROOT / "backend" / "data" / "smoke_test.db")
    settings.DB_PATH = test_db_path

    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    loop.run_until_complete(setup_test_environment(test_db_path))

    client = TestClient(app)
    operator_token = create_access_token({"sub": "u-op1", "user_id": "u-op1", "role": "OPERATOR"})
    auth_headers = {"Authorization": f"Bearer {operator_token}"}

    try:
        # Step 1: Ingest known reading
        print("\n[Step 1/8] Ingesting validated sensor payload for node r1-n1...")
        ts_now = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
        raw_dict = {
            "node": "r1-n1",
            "seq": 101,
            "ts": ts_now,
            "fw": "0.3.1",
            "t_c": 24.5,
            "rh": 48.0,
            "mq_ratio": 1.15,
            "mq_warm": True,
            "shock_count": 0,
        }
        validated = validate_telemetry_message(json.dumps(raw_dict))
        assert validated is not None, "Payload validation failed"
        telemetry_rows = normalise_payload(validated)
        assert len(telemetry_rows) >= 3, "Normalisation yielded insufficient rows"

        # Write to database
        async def insert_telemetry():
            async with aiosqlite.connect(test_db_path) as db:
                for row in telemetry_rows:
                    await db.execute(
                        """
                        INSERT INTO telemetry (node_id, metric, ts, received_at, value, quality, seq, backfilled)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                        """,
                        (row["node_id"], row["metric"], row["ts"], row["received_at"], row["value"], row["quality"], row["seq"], row["backfilled"]),
                    )
                await db.commit()

        loop.run_until_complete(insert_telemetry())
        print("  -> Sensor rows inserted: t_c=24.5, rh=48.0, mq_ratio=1.15 (quality=measured)")

        # Step 2: Poll REST API
        print("\n[Step 2/8] Polling GET /api/nodes/r1-n1/telemetry to verify storage and provenance...")
        resp = client.get("/api/nodes/r1-n1/telemetry?metric=t_c", headers=auth_headers)
        assert resp.status_code == 200, f"GET /api/nodes/r1-n1/telemetry failed: {resp.text}"
        data = resp.json()
        assert len(data.get("points", [])) > 0, f"No telemetry points returned from API: {data}"
        latest_val = data["points"][-1]["value"]
        quality = data["meta"]["quality"]
        assert latest_val == 24.5, f"Expected 24.5, got {latest_val}"
        assert quality == "measured", f"Expected quality=measured, got {quality}"
        print(f"  -> Verified API response: value={latest_val}, quality={quality}, unit={data['unit']}")

        # Step 3: Open authenticated WebSocket and subscribe
        print("\n[Step 3/8] Connecting to authenticated WebSocket WS /ws...")
        with client.websocket_connect(f"/ws?token={operator_token}") as ws:
            # Send subscription
            ws.send_json({"type": "subscribe", "data": {"racks": ["rack-01"], "metrics": ["t_c"]}})

            # Broadcast a telemetry point
            broadcaster.broadcast_telemetry_point(
                node_id="r1-n1",
                metric="t_c",
                value=24.5,
                unit="deg_c",
                meta={"quality": "measured"},
                ts=ts_now,
            )

            # Flush batch
            loop.run_until_complete(broadcaster._flush_telemetry_batch())

            # Receive frame
            frame = ws.receive_json()
            assert frame.get("type") == "telemetry", f"Expected telemetry frame, got {frame}"
            assert frame["data"]["node_id"] == "r1-n1"
            assert frame["data"]["value"] == 24.5
            print(f"  -> WebSocket frame received: node_id={frame['data']['node_id']}, metric={frame['data']['metric']}, value={frame['data']['value']}")

        # Step 4: Create a proposal
        print("\n[Step 4/8] Creating proposal via POST /api/proposals...")
        prop_payload = {
            "scope": {"rack_id": "rack-01", "tenant_id": "t-alpha"},
            "action": "REDUCE_TENANT_LOAD",
            "target": "rack-01-u12",
            "rationale": "High thermal dissipation in slot u12 approaching 27C threshold.",
            "expected_effect": "Lowers slot thermal output by 1.2C within 15 minutes.",
            "evidence": ["ev_temp_trend_01"],
            "risk_tier": "LOW",
        }
        resp = client.post("/api/proposals", json=prop_payload, headers=auth_headers)
        assert resp.status_code in (200, 201), f"Failed to create proposal: {resp.text}"
        proposal = resp.json()
        proposal_id = proposal["proposal_id"]
        assert proposal["status"] == "PROPOSED"
        print(f"  -> Proposal created: id={proposal_id}, status={proposal['status']}")

        # Step 5: Approve proposal (issues 60s nonce)
        print("\n[Step 5/8] Operator approving proposal via POST /api/proposals/{id}/approve...")
        resp = client.post(
            f"/api/proposals/{proposal_id}/approve",
            json={"reader_device_id": "reader-01"},
            headers=auth_headers,
        )
        assert resp.status_code == 200, f"Failed to approve proposal: {resp.text}"
        approval_data = resp.json()
        assert approval_data["status"] == "APPROVED_PENDING_TAP"
        assert "nonce" in approval_data
        nonce = approval_data["nonce"]
        print(f"  -> Proposal approved: status={approval_data['status']}, nonce={nonce[:8]}... (TTL: 60s)")

        # Step 6: Reader polls pending and submits signed RFID tap
        print("\n[Step 6/8] Reader console polling GET /api/reader/reader-01/pending...")
        resp = client.get("/api/reader/reader-01/pending")
        assert resp.status_code == 200, f"Reader poll failed: {resp.text}"
        pending_data = resp.json()
        assert pending_data["armed"] is True
        assert pending_data["nonce"] == nonce
        print(f"  -> Reader received armed action: {pending_data['action']} on {pending_data['target']}")

        # Generate cryptographic HMAC-SHA256 signature
        tap_ts = int(time.time())
        msg = f"reader-01|{OPERATOR_CARD_UID}|{nonce}|{tap_ts}".encode("utf-8")
        computed_hmac = hmac.new(READER_SECRET.encode("utf-8"), msg, hashlib.sha256).hexdigest()

        print("  -> Submitting signed tap to POST /api/reader/reader-01/tap...")
        tap_body = {
            "uid": OPERATOR_CARD_UID,
            "nonce": nonce,
            "ts": tap_ts,
            "hmac": computed_hmac,
        }
        resp = client.post("/api/reader/reader-01/tap", json=tap_body)
        assert resp.status_code == 200, f"Tap submission failed: {resp.text}"
        tap_result = resp.json()
        assert tap_result.get("result") == "AUTHORIZED", f"Expected AUTHORIZED, got {tap_result}"
        print(f"  -> Tap accepted: result={tap_result['result']}, proposal_id={tap_result['proposal_id']}")

        # Step 7: Check proposal state is AUTHORIZED
        print("\n[Step 7/8] Verifying proposal state flipped to AUTHORIZED...")
        resp = client.get(f"/api/proposals/{proposal_id}", headers=auth_headers)
        assert resp.status_code == 200
        prop_after = resp.json()
        assert prop_after["status"] == "AUTHORIZED"
        print(f"  -> Proposal confirmed: status={prop_after['status']}")

        # Step 8: Verify SHA-256 audit ledger from genesis to head
        print("\n[Step 8/8] Verifying cryptographic SHA-256 audit ledger...")
        resp = client.get("/api/audit/verify", headers=auth_headers)
        assert resp.status_code == 200, f"Audit verification endpoint failed: {resp.text}"
        audit_res = resp.json()
        assert audit_res["ok"] is True, f"Audit chain verification failed: {audit_res}"
        rows_checked = audit_res["rows_checked"]
        head_hash = audit_res["head_hash"]
        print(f"  -> Audit chain integrity verified: ok=True, {rows_checked} rows checked.")
        print(f"  -> Current ledger head hash: {head_hash}")

        print("\n" + "=" * 70)
        print("  ALL 8 SMOKE TEST STEPS PASSED PERFECTLY (Exit Code: 0)")
        print("=" * 70)
        return True

    except Exception as e:
        print(f"\nSMOKE TEST FAILED: {e}")
        import traceback
        traceback.print_exc()
        return False
    finally:
        broadcaster.stop()
        loop.close()
        # Clean up test database
        if os.path.exists(test_db_path):
            try:
                os.remove(test_db_path)
            except Exception:
                pass


if __name__ == "__main__":
    success = run_smoke_test()
    sys.exit(0 if success else 1)
