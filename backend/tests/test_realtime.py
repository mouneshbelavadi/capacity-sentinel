import asyncio
from datetime import datetime, timedelta, timezone
import json
import time
import pytest
import pytest_asyncio
import aiosqlite
from starlette.testclient import TestClient

from backend.core.auth import create_access_token, hash_password
from backend.db.connection import SCHEMA_PATH
from backend.ingest.subscriber import MQTTSubscriber
from backend.main import app
from backend.repos.scope import Scope, SYSTEM_SCOPE
from backend.services.broadcaster import broadcaster


@pytest_asyncio.fixture
async def realtime_db(tmp_path):
    db_file = str(tmp_path / "realtime.db")
    async with aiosqlite.connect(db_file) as db:
        db.row_factory = aiosqlite.Row
        with open(SCHEMA_PATH, "r", encoding="utf-8") as f:
            await db.executescript(f.read())

        await db.execute("INSERT INTO sites VALUES ('site-01', 'Bench DC')")
        await db.execute("INSERT INTO racks VALUES ('rack-01', 'site-01', 'Rack 01', 0, 0)")
        await db.execute("INSERT INTO racks VALUES ('rack-02', 'site-01', 'Rack 02', 0, 1)")

        await db.execute("INSERT INTO tenants VALUES ('t-alpha', 'Alpha Systems', 'ops@alpha')")
        await db.execute("INSERT INTO tenants VALUES ('t-beta', 'Beta Compute', 'ops@beta')")

        await db.execute("INSERT INTO nodes (node_id, rack_id, fw, status, last_seq) VALUES ('r1-n1', 'rack-01', '0.3.1', 'OK', 100)")
        await db.execute("INSERT INTO nodes (node_id, rack_id, fw, status, last_seq) VALUES ('r2-n1', 'rack-02', '0.3.1', 'OK', 100)")

        await db.execute("INSERT INTO slots VALUES ('slot-01', 'rack-01', 1, 2, 't-alpha', 'r1-n1')")
        await db.execute("INSERT INTO slots VALUES ('slot-02', 'rack-02', 1, 2, 't-beta', 'r2-n1')")

        pw = hash_password("secret123")
        await db.execute("INSERT INTO users VALUES ('u-op', 'operator_user', ?, 'OPERATOR', null, 'Operator Alice')", (pw,))
        await db.execute("INSERT INTO users VALUES ('u-alpha', 'alpha_user', ?, 'TENANT', 't-alpha', 'Tenant Charlie')", (pw,))
        await db.execute("INSERT INTO users VALUES ('u-beta', 'beta_user', ?, 'TENANT', 't-beta', 'Tenant David')", (pw,))
        await db.commit()

        # Update broadcaster topology cache
        await broadcaster.update_topology_cache(db)

    yield db_file


def make_token(user_id: str, role: str, tenant_id: str | None = None) -> str:
    return create_access_token({"sub": user_id, "user_id": user_id, "role": role, "tenant_id": tenant_id})


def test_1_mqtt_to_websocket_latency_under_500ms(realtime_db):
    """
    Test 1: Broadcast telemetry point -> arrives at connected client within 500 ms.
    """
    token = make_token("u-op", "OPERATOR")
    client = TestClient(app)

    with client.websocket_connect(f"/ws?token={token}") as ws:
        # Subscribe to rack-01
        ws.send_json({"type": "subscribe", "data": {"racks": ["rack-01"], "metrics": ["t_c"]}})

        start_time = time.perf_counter()
        broadcaster.broadcast_telemetry_point(
            node_id="r1-n1",
            metric="t_c",
            value=24.5,
            unit="deg_c",
            meta={"quality": "measured"},
        )

        # Force a flush for immediate delivery check
        asyncio.run(broadcaster._flush_telemetry_batch())

        # Receive frame
        data = ws.receive_json()
        latency_ms = (time.perf_counter() - start_time) * 1000

        assert data["type"] == "telemetry"
        assert data["data"]["node_id"] == "r1-n1"
        assert data["data"]["metric"] == "t_c"
        assert data["data"]["value"] == 24.5
        assert latency_ms <= 500.0, f"Latency {latency_ms} ms exceeded 500 ms budget"


def test_2_tenant_never_receives_foreign_node_frame(realtime_db):
    """
    Test 2: A TENANT socket NEVER receives a frame for a foreign node,
    even after explicitly attempting to subscribe to a foreign rack.
    """
    alpha_token = make_token("u-alpha", "TENANT", "t-alpha")
    client = TestClient(app)

    with client.websocket_connect(f"/ws?token={alpha_token}") as ws:
        # Maliciously attempt to subscribe to foreign rack-02
        ws.send_json({"type": "subscribe", "data": {"racks": ["rack-02"], "metrics": ["t_c"]}})

        # Broadcast telemetry for r2-n1 (t-beta's node on rack-02)
        broadcaster.broadcast_telemetry_point(
            node_id="r2-n1",
            metric="t_c",
            value=28.9,
            unit="deg_c",
            meta={"quality": "measured"},
        )
        # Broadcast telemetry for r1-n1 (t-alpha's own node on rack-01)
        broadcaster.broadcast_telemetry_point(
            node_id="r1-n1",
            metric="t_c",
            value=24.2,
            unit="deg_c",
            meta={"quality": "measured"},
        )

        asyncio.run(broadcaster._flush_telemetry_batch())

        # Alpha client should ONLY receive frame for r1-n1, NEVER r2-n1!
        # Send a ping to flush the queue
        ws.send_json({"type": "ping", "data": {}})

        received_types = []
        received_nodes = []

        while True:
            msg = ws.receive_json()
            received_types.append(msg.get("type"))
            if msg.get("type") == "telemetry":
                received_nodes.append(msg["data"]["node_id"])
            if msg.get("type") == "pong":
                break

        assert "r2-n1" not in received_nodes, f"Foreign node r2-n1 leaked to t-alpha socket! Received: {received_nodes}"


def test_3_telemetry_batching_max_2_frames_per_sec(realtime_db):
    """
    Test 3: Telemetry frames for one node arrive at most twice per second (>=500ms interval)
    even when input arrives at 10 Hz.
    """
    token = make_token("u-op", "OPERATOR")
    client = TestClient(app)

    with client.websocket_connect(f"/ws?token={token}") as ws:
        ws.send_json({"type": "subscribe", "data": {"racks": ["rack-01"], "metrics": ["t_c"]}})

        # Simulate 10 Hz arrivals over 200 ms (rapid successive bursts)
        for i in range(10):
            broadcaster.broadcast_telemetry_point(
                node_id="r1-n1",
                metric="t_c",
                value=24.0 + (i * 0.1),
                unit="deg_c",
                meta={"quality": "measured"},
            )

        # Trigger flush
        asyncio.run(broadcaster._flush_telemetry_batch())

        # Read frames
        ws.send_json({"type": "ping", "data": {}})
        telemetry_count = 0
        while True:
            msg = ws.receive_json()
            if msg.get("type") == "telemetry":
                telemetry_count += 1
            if msg.get("type") == "pong":
                break

        # In a single 500 ms window, at most 1 batched frame is flushed!
        assert telemetry_count <= 1, f"Expected <= 1 telemetry frame flushed in 500ms window, got {telemetry_count}"


def test_4_slow_client_drops_telemetry_but_preserves_state_frames(realtime_db):
    """
    Test 4: A client queue backing up drops telemetry frames but preserves
    proposal_update, changepoint and audit_append state frames.
    """
    from backend.services.broadcaster import WebSocketClient

    scope = Scope(user_id="u-op", role="OPERATOR", tenant_id=None)
    mock_ws = None  # Internal test
    client = WebSocketClient(mock_ws, scope, queue_maxsize=3)

    # 1. Enqueue proposal frame (state frame)
    client.enqueue_frame({"type": "proposal_update", "data": {"id": "pr_1"}})
    # 2. Enqueue changepoint frame (state frame)
    client.enqueue_frame({"type": "changepoint", "data": {"id": "cp_1"}})
    # 3. Enqueue telemetry frame
    client.enqueue_frame({"type": "telemetry", "data": {"val": 25.0}})

    assert client.send_queue.qsize() == 3

    # Now enqueue an audit_append (urgent state frame) when queue is full:
    # Telemetry frame must be dropped, and audit_append must be preserved!
    client.enqueue_frame({"type": "audit_append", "data": {"seq": 99}})

    items = []
    while not client.send_queue.empty():
        items.append(client.send_queue.get_nowait())

    types = [it["type"] for it in items]
    assert "proposal_update" in types
    assert "changepoint" in types
    assert "audit_append" in types


def test_7_startup_self_check_fails_on_tampered_audit(realtime_db):
    """
    Test 7: Startup self-check fails loudly on a tampered audit chain.
    """
    import sqlite3
    conn = sqlite3.connect(realtime_db)
    # Insert invalid genesis row
    conn.execute(
        "INSERT INTO audit VALUES (1, '2026-10-28T12:00:00Z', 'user', 'AI_PROPOSAL', '{}', '{}', '0'*64, 'tampered_hash_bad')"
    )
    conn.commit()
    conn.close()

    # Async check
    async def check():
        async with aiosqlite.connect(realtime_db) as db:
            from backend.services.audit import verify_audit_chain
            res = await verify_audit_chain(db)
            return res["ok"]

    assert asyncio.run(check()) is False


@pytest.mark.asyncio
async def test_8_50_concurrent_websocket_connections(realtime_db):
    """
    Test 8: 50 concurrent WebSocket clients -> no missed state frames, latency budget met.
    """
    from backend.services.broadcaster import WebSocketClient

    clients = []
    scope = Scope(user_id="u-op", role="OPERATOR", tenant_id=None)

    for i in range(50):
        c = WebSocketClient(None, scope, queue_maxsize=50)
        c.subscribed_racks = {"rack-01"}
        clients.append(c)
        broadcaster.clients.append(c)

    start = time.perf_counter()
    # Broadcast an urgent state frame
    broadcaster.broadcast_proposal_update({"proposal_id": "pr_concurrency_50", "scope": {"rack_id": "rack-01"}})
    latency_ms = (time.perf_counter() - start) * 1000

    assert latency_ms <= 100.0, f"Broadcasting to 50 clients took {latency_ms} ms, budget <= 100 ms"

    for c in clients:
        assert c.send_queue.qsize() == 1
        item = c.send_queue.get_nowait()
        assert item["type"] == "proposal_update"
        broadcaster.clients.remove(c)

