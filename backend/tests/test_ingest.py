import json
import pytest
import pytest_asyncio
import aiosqlite
from datetime import datetime, timezone, timedelta
from backend.db.connection import SCHEMA_PATH
from backend.ingest.subscriber import MQTTSubscriber


@pytest_asyncio.fixture
async def seeded_test_db(tmp_path):
    db_file = str(tmp_path / "test_ingest.db")
    async with aiosqlite.connect(db_file) as db:
        db.row_factory = aiosqlite.Row
        with open(SCHEMA_PATH, "r", encoding="utf-8") as f:
            await db.executescript(f.read())
        
        # Seed test site, rack, tenant and node
        await db.execute("INSERT INTO sites (site_id, label) VALUES ('site-01', 'Test Site')")
        await db.execute("INSERT INTO racks (rack_id, site_id, label, row, col) VALUES ('rack-01', 'site-01', 'Rack 01', 0, 0)")
        await db.execute("INSERT INTO tenants (tenant_id, label, contact) VALUES ('t-alpha', 'Alpha', 'contact@alpha')")
        await db.execute("INSERT INTO nodes (node_id, rack_id, fw, status, last_seq) VALUES ('r1-n1', 'rack-01', '0.3.1', 'UNKNOWN', 10)")
        await db.execute("INSERT INTO slots (slot_id, rack_id, u_start, u_height, tenant_id, node_id) VALUES ('s1', 'rack-01', 1, 2, 't-alpha', 'r1-n1')")
        await db.commit()
    return db_file


@pytest.mark.asyncio
async def test_valid_telemetry_payload_ingest(seeded_test_db):
    subscriber = MQTTSubscriber(db_path=seeded_test_db)
    now_ts = int(datetime.now(timezone.utc).timestamp())

    payload = {
        "node": "r1-n1",
        "tenant": "t-alpha",
        "seq": 11,
        "ts": now_ts,
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

    success = await subscriber.process_raw_message(
        "dc/site-01/rack-01/r1-n1/telemetry",
        json.dumps(payload).encode("utf-8"),
    )
    assert success is True

    # Verify rows in DB
    async with aiosqlite.connect(seeded_test_db) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute("SELECT * FROM telemetry WHERE node_id = 'r1-n1' AND metric = 't_c'")
        row = await cur.fetchone()
        assert row is not None
        assert row["value"] == 24.61
        assert row["quality"] == "measured"
        assert row["seq"] == 11
        assert row["backfilled"] == 0
        assert row["ts"] is not None
        assert row["received_at"] is not None

        # Node status should be updated to OK
        node_cur = await db.execute("SELECT status, last_seq FROM nodes WHERE node_id = 'r1-n1'")
        node = await node_cur.fetchone()
        assert node["status"] == "OK"
        assert node["last_seq"] == 11


@pytest.mark.asyncio
async def test_malformed_payload_dropped(seeded_test_db):
    subscriber = MQTTSubscriber(db_path=seeded_test_db)

    # 1. Temperature outside physical range (-40..85 C)
    bad_payload_temp = {
        "node": "r1-n1",
        "seq": 12,
        "ts": int(datetime.now(timezone.utc).timestamp()),
        "fw": "0.3.1",
        "t_c": 199.9,  # Impossible physical temperature
    }
    success1 = await subscriber.process_raw_message(
        "dc/site-01/rack-01/r1-n1/telemetry",
        json.dumps(bad_payload_temp).encode("utf-8"),
    )
    assert success1 is False

    # 2. Corrupt / non-JSON payload
    success2 = await subscriber.process_raw_message(
        "dc/site-01/rack-01/r1-n1/telemetry",
        b"NOT_A_JSON_PAYLOAD_GARBAGE",
    )
    assert success2 is False

    # 3. Missing required field (e.g. fw missing)
    bad_payload_missing = {
        "node": "r1-n1",
        "seq": 13,
        "ts": int(datetime.now(timezone.utc).timestamp()),
        "t_c": 24.5,
    }
    success3 = await subscriber.process_raw_message(
        "dc/site-01/rack-01/r1-n1/telemetry",
        json.dumps(bad_payload_missing).encode("utf-8"),
    )
    assert success3 is False

    # Ensure NOTHING was stored from bad payloads
    async with aiosqlite.connect(seeded_test_db) as db:
        cur = await db.execute("SELECT COUNT(*) as cnt FROM telemetry")
        row = await cur.fetchone()
        assert row[0] == 0


@pytest.mark.asyncio
async def test_mq_warm_false_drops_mq_ratio(seeded_test_db):
    subscriber = MQTTSubscriber(db_path=seeded_test_db)
    now_ts = int(datetime.now(timezone.utc).timestamp())

    payload = {
        "node": "r1-n1",
        "seq": 12,
        "ts": now_ts,
        "fw": "0.3.1",
        "t_c": 22.5,
        "mq_ratio": 1.25,
        "mq_warm": False,  # Sensor still preheating!
    }

    success = await subscriber.process_raw_message(
        "dc/site-01/rack-01/r1-n1/telemetry",
        json.dumps(payload).encode("utf-8"),
    )
    assert success is True

    async with aiosqlite.connect(seeded_test_db) as db:
        db.row_factory = aiosqlite.Row
        # t_c must be stored
        t_cur = await db.execute("SELECT * FROM telemetry WHERE metric = 't_c'")
        assert await t_cur.fetchone() is not None

        # mq_ratio must NOT be stored
        mq_cur = await db.execute("SELECT * FROM telemetry WHERE metric = 'mq_ratio'")
        assert await mq_cur.fetchone() is None


@pytest.mark.asyncio
async def test_node_presence_and_lwt_offline(seeded_test_db):
    subscriber = MQTTSubscriber(db_path=seeded_test_db)

    # 1. Publish connect 'online'
    ok = await subscriber.process_raw_message(
        "dc/site-01/rack-01/r1-n1/status",
        b"online",
    )
    assert ok is True

    async with aiosqlite.connect(seeded_test_db) as db:
        db.row_factory = aiosqlite.Row
        node = await (await db.execute("SELECT status FROM nodes WHERE node_id = 'r1-n1'")).fetchone()
        assert node["status"] == "OK"

        audit = await (await db.execute("SELECT event FROM audit WHERE event = 'NODE_ONLINE'")).fetchone()
        assert audit is not None

    # 2. Simulate node power pulled -> LWT 'offline' arrives
    ok2 = await subscriber.process_raw_message(
        "dc/site-01/rack-01/r1-n1/status",
        b"offline",
    )
    assert ok2 is True

    async with aiosqlite.connect(seeded_test_db) as db:
        db.row_factory = aiosqlite.Row
        node = await (await db.execute("SELECT status FROM nodes WHERE node_id = 'r1-n1'")).fetchone()
        assert node["status"] == "OFFLINE"

        audit = await (await db.execute("SELECT event FROM audit WHERE event = 'NODE_OFFLINE'")).fetchone()
        assert audit is not None


@pytest.mark.asyncio
async def test_sequence_gap_detection(seeded_test_db):
    subscriber = MQTTSubscriber(db_path=seeded_test_db)
    now_ts = int(datetime.now(timezone.utc).timestamp())

    # Node's last_seq is 10. Deliberately jump to seq 15 (skipping 11, 12, 13, 14 -> 4 missing)
    payload = {
        "node": "r1-n1",
        "seq": 15,
        "ts": now_ts,
        "fw": "0.3.1",
        "t_c": 24.0,
    }

    ok = await subscriber.process_raw_message(
        "dc/site-01/rack-01/r1-n1/telemetry",
        json.dumps(payload).encode("utf-8"),
    )
    assert ok is True

    async with aiosqlite.connect(seeded_test_db) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute("SELECT * FROM audit WHERE event = 'TELEMETRY_GAP'")
        audit_row = await cur.fetchone()
        assert audit_row is not None
        payload_data = json.loads(audit_row["payload_json"])
        assert payload_data["expected_seq"] == 11
        assert payload_data["received_seq"] == 15
        assert payload_data["missing_count"] == 4
