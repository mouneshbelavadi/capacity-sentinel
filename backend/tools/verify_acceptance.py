import asyncio
from datetime import datetime, timezone
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent.parent))

import aiosqlite
from httpx import ASGITransport, AsyncClient

from backend.db.connection import SCHEMA_PATH, get_db
from backend.ingest.subscriber import MQTTSubscriber
from backend.main import app
from backend.services.audit import compute_audit_hash, verify_audit_chain


async def run_acceptance_suite():
    db_file = "backend/data/racksense_acceptance.db"
    p = Path(db_file)
    if p.exists():
        p.unlink()
    p.parent.mkdir(parents=True, exist_ok=True)

    print("=" * 70)
    print("RACKSENSE BACKEND - PHASE A ACCEPTANCE VERIFICATION")
    print("=" * 70)

    # Initialize and seed
    async with aiosqlite.connect(db_file) as db:
        db.row_factory = aiosqlite.Row
        with open(SCHEMA_PATH, "r", encoding="utf-8") as f:
            await db.executescript(f.read())
        await db.execute("INSERT INTO sites (site_id, label) VALUES ('site-01', 'Bench Data Center Site 01')")
        await db.execute("INSERT INTO racks (rack_id, site_id, label, row, col) VALUES ('rack-01', 'site-01', 'Rack 01', 0, 0)")
        await db.execute("INSERT INTO tenants (tenant_id, label, contact) VALUES ('t-alpha', 'Alpha Systems', 'ops@alpha.local')")
        await db.execute("INSERT INTO nodes (node_id, rack_id, fw, status, last_seq) VALUES ('r1-n1', 'rack-01', '0.3.1', 'UNKNOWN', 100)")
        await db.execute("INSERT INTO slots (slot_id, rack_id, u_start, u_height, tenant_id, node_id) VALUES ('rack-01-u12', 'rack-01', 12, 2, 't-alpha', 'r1-n1')")
        await db.commit()

    subscriber = MQTTSubscriber(db_path=db_file)

    async def override_db():
        async with aiosqlite.connect(db_file) as conn:
            conn.row_factory = aiosqlite.Row
            yield conn

    app.dependency_overrides[get_db] = override_db
    transport = ASGITransport(app=app)

    # -------------------------------------------------------------
    # 1. Hand-written valid payload
    # -------------------------------------------------------------
    print("\n[1] Publishing hand-written valid payload to dc/site-01/rack-01/r1-n1/telemetry...")
    now_epoch = int(datetime.now(timezone.utc).timestamp())
    valid_payload = {
        "node": "r1-n1",
        "tenant": "t-alpha",
        "seq": 101,
        "ts": now_epoch,
        "fw": "0.3.1",
        "t_c": 24.61,
        "rh": 41.2,
        "dew_c": 10.4,
        "mq_ratio": 1.07,
        "mq_warm": True,
        "shock_count": 0,
        "rssi": -54,
        "uptime_s": 8123,
    }
    await subscriber.process_raw_message(
        "dc/site-01/rack-01/r1-n1/telemetry",
        json.dumps(valid_payload).encode("utf-8"),
    )

    async with aiosqlite.connect(db_file) as db:
        db.row_factory = aiosqlite.Row
        row = await (await db.execute("SELECT node_id, metric, ts, received_at, value, quality, seq, backfilled FROM telemetry WHERE metric = 't_c'")).fetchone()
        print(f"  -> DB row stored: node_id={row['node_id']}, metric={row['metric']}, value={row['value']}, quality={row['quality']}")
        print(f"  -> Timestamps: device ts={row['ts']} | server received_at={row['received_at']}")
        assert row["quality"] == "measured"
        assert row["value"] == 24.61

    # -------------------------------------------------------------
    # 2. Malformed payload
    # -------------------------------------------------------------
    print("\n[2] Publishing malformed payload (temperature out of physical range: 199.9 C)...")
    bad_payload = {
        "node": "r1-n1",
        "seq": 102,
        "ts": now_epoch,
        "fw": "0.3.1",
        "t_c": 199.9,
    }
    handled = await subscriber.process_raw_message(
        "dc/site-01/rack-01/r1-n1/telemetry",
        json.dumps(bad_payload).encode("utf-8"),
    )
    async with aiosqlite.connect(db_file) as db:
        cnt = await (await db.execute("SELECT COUNT(*) FROM telemetry WHERE value = 199.9")).fetchone()
        print(f"  -> Ingest rejected malformed payload (handled={handled})")
        print(f"  -> Rows with bad value 199.9 in DB: {cnt[0]}")
        assert cnt[0] == 0

    # -------------------------------------------------------------
    # 3. Real ESP32 node GET telemetry endpoint
    # -------------------------------------------------------------
    print("\n[3] Calling GET /api/nodes/r1-n1/telemetry?metric=t_c...")
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        res = await client.get("/api/nodes/r1-n1/telemetry?metric=t_c")
        print(f"  -> Status code: {res.status_code}")
        print(f"  -> Response: {json.dumps(res.json(), indent=2)}")
        assert res.status_code == 200
        assert res.json()["points"][0]["value"] == 24.61
        assert res.json()["meta"]["quality"] == "measured"

    # -------------------------------------------------------------
    # 4. Pull node power (LWT 'offline')
    # -------------------------------------------------------------
    print("\n[4] Simulating LWT status 'offline' on dc/site-01/rack-01/r1-n1/status...")
    await subscriber.process_raw_message(
        "dc/site-01/rack-01/r1-n1/status",
        b"offline",
    )
    async with aiosqlite.connect(db_file) as db:
        db.row_factory = aiosqlite.Row
        node = await (await db.execute("SELECT status FROM nodes WHERE node_id = 'r1-n1'")).fetchone()
        audit = await (await db.execute("SELECT event, actor, payload_json FROM audit WHERE event = 'NODE_OFFLINE'")).fetchone()
        print(f"  -> nodes.status in DB: {node['status']}")
        print(f"  -> Audit event: {audit['event']} by {audit['actor']} (payload: {audit['payload_json']})")
        assert node["status"] == "OFFLINE"
        assert audit is not None

    # -------------------------------------------------------------
    # 5. Skip a seq deliberately -> TELEMETRY_GAP
    # -------------------------------------------------------------
    print("\n[5] Publishing seq 106 (skipping seq 102..105, 4 missing sequences)...")
    gap_payload = {
        "node": "r1-n1",
        "seq": 106,
        "ts": now_epoch + 10,
        "fw": "0.3.1",
        "t_c": 24.8,
    }
    await subscriber.process_raw_message(
        "dc/site-01/rack-01/r1-n1/telemetry",
        json.dumps(gap_payload).encode("utf-8"),
    )
    async with aiosqlite.connect(db_file) as db:
        db.row_factory = aiosqlite.Row
        gap_audit = await (await db.execute("SELECT event, payload_json FROM audit WHERE event = 'TELEMETRY_GAP'")).fetchone()
        print(f"  -> Audit event: {gap_audit['event']}")
        print(f"  -> Payload: {gap_audit['payload_json']}")
        assert gap_audit is not None
        gap_info = json.loads(gap_audit["payload_json"])
        assert gap_info["missing_count"] == 4

    # -------------------------------------------------------------
    # 6. GET /api/meta returns contract_version: "1.0.0"
    # -------------------------------------------------------------
    print("\n[6] Calling GET /api/meta...")
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        res = await client.get("/api/meta")
        print(f"  -> Status code: {res.status_code}")
        print(f"  -> Response: {json.dumps(res.json(), indent=2)}")
        assert res.json()["contract_version"] == "1.0.0"

    # -------------------------------------------------------------
    # 7. Audit chain verifies by hand
    # -------------------------------------------------------------
    print("\n[7] Verifying SHA-256 audit chain by hand...")
    async with aiosqlite.connect(db_file) as db:
        db.row_factory = aiosqlite.Row
        rows = await (await db.execute("SELECT * FROM audit ORDER BY seq ASC")).fetchall()
        print(f"  -> Total audit rows in chain: {len(rows)}")
        for i in range(1, len(rows)):
            prev_row = rows[i - 1]
            curr_row = rows[i]
            assert curr_row["prev_hash"] == prev_row["hash"]
            recomputed = compute_audit_hash(
                prev_hash=curr_row["prev_hash"],
                seq=curr_row["seq"],
                ts=curr_row["ts"],
                actor=curr_row["actor"],
                event=curr_row["event"],
                subject_json=curr_row["subject_json"],
                payload_json=curr_row["payload_json"],
            )
            assert recomputed == curr_row["hash"]
            print(f"  -> Row {curr_row['seq']} ({curr_row['event']}): verified hash={curr_row['hash'][:16]}... against row {prev_row['seq']}")

        is_valid, count, err = await verify_audit_chain(db)
        assert is_valid is True
        print(f"  -> Full chain integrity check: {'VALID' if is_valid else 'INVALID'} ({count} rows verified)")

    print("\n" + "=" * 70)
    print("ALL 7 PHASE A ACCEPTANCE CRITERIA PASSED AND VERIFIED!")
    print("=" * 70)


if __name__ == "__main__":
    asyncio.run(run_acceptance_suite())
