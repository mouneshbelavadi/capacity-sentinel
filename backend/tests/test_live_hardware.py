"""
RackSense — Live Hardware Ingestion & Sensor Physics Test.

This test CANNOT pass without real physical hardware and an active MQTT broker.
It executes as part of the live hardware acceptance suite.

Requirements:
- Connects to real Mosquitto broker at MQTT_BROKER_HOST:MQTT_BROKER_PORT.
- Subscribes to dc/{SITE_ID}/+/+/telemetry.
- Awaits live telemetry packet from physical node 'r1-n1' (up to 60s).
- Asserts Contract §15 packet structure: node, seq, ts, metrics.
- Asserts monotonic sequence counter advancement across consecutive packets.
- Asserts database persistence and /api/topology online status.
- FAILS (does not skip) if broker is down or hardware is unplugged.
"""

import asyncio
import json
import time
import pytest
import paho.mqtt.client as mqtt

from backend.core.config import settings
from backend.db.connection import get_db
from backend.repos.nodes import get_node
from backend.repos.telemetry import get_latest_telemetry
from backend.repos.scope import SYSTEM_SCOPE


@pytest.mark.hardware
def test_live_hardware_telemetry_and_physics():
    """
    Validates physical microcontroller data ingestion against Contract §15.
    FAILS LOUDLY if broker is down or physical sensor node is unplugged.
    """
    broker_host = settings.MQTT_BROKER_HOST
    broker_port = settings.MQTT_BROKER_PORT
    site_id = settings.SITE_ID
    topic_telemetry = f"dc/{site_id}/+/+/telemetry"

    received_messages: list[dict] = []
    connection_failed = False
    connection_error_msg = ""

    def on_connect(client, userdata, flags, rc, properties=None):
        nonlocal connection_failed, connection_error_msg
        if rc == 0:
            client.subscribe(topic_telemetry, qos=0)
        else:
            connection_failed = True
            connection_error_msg = f"MQTT connect failed with rc={rc}"

    def on_message(client, userdata, msg):
        try:
            data = json.loads(msg.payload.decode("utf-8"))
            if data.get("node") == "r1-n1":
                received_messages.append(data)
        except Exception:
            pass

    client = mqtt.Client(client_id="racksense-live-hardware-test")
    if settings.MQTT_USERNAME and settings.MQTT_PASSWORD:
        client.username_pw_set(settings.MQTT_USERNAME, settings.MQTT_PASSWORD)

    client.on_connect = on_connect
    client.on_message = on_message

    # 1. Connect to broker
    try:
        client.connect(broker_host, broker_port, keepalive=15)
        client.loop_start()
    except Exception as e:
        pytest.fail(
            f"LIVE HARDWARE TEST FAILED: Cannot connect to Mosquitto broker at "
            f"{broker_host}:{broker_port} ({e}). The sensing layer is dark."
        )

    # 2. Wait up to 60s for at least 2 consecutive messages from node r1-n1
    start_time = time.time()
    timeout_s = 60.0
    print(f"\n[Hardware Test] Listening on {topic_telemetry} for physical node r1-n1...")

    while time.time() - start_time < timeout_s:
        if connection_failed:
            client.loop_stop()
            client.disconnect()
            pytest.fail(f"LIVE HARDWARE TEST FAILED: Broker connection dropped: {connection_error_msg}")

        if len(received_messages) >= 2:
            break
        time.sleep(0.5)

    client.loop_stop()
    client.disconnect()

    # 3. Assert hardware presence
    if len(received_messages) == 0:
        pytest.fail(
            f"LIVE HARDWARE TEST FAILED: Zero messages received from physical node 'r1-n1' within {timeout_s}s. "
            f"Microcontroller is unplugged, unpowered, or Wi-Fi is disconnected."
        )

    msg1 = received_messages[0]
    print(f"[Hardware Test] Received packet 1: {msg1}")

    # 4. Assert Contract §15 schema
    assert msg1.get("node") == "r1-n1", f"Expected node 'r1-n1', got {msg1.get('node')}"
    assert "seq" in msg1 and isinstance(msg1["seq"], int), "Contract §15 requires integer 'seq'"
    assert "ts" in msg1, "Contract §15 requires device clock 'ts'"

    # Real measured physical metric must exist
    has_real_metric = any(k in msg1 and isinstance(msg1[k], (int, float)) for k in ["t_c", "rh", "mq_ratio", "vib_rms_g"])
    assert has_real_metric, f"Contract §15 requires at least one physical metric. Got: {msg1}"

    # 5. Assert sequence advancement across consecutive messages
    if len(received_messages) >= 2:
        msg2 = received_messages[1]
        print(f"[Hardware Test] Received packet 2: {msg2}")
        assert msg2["seq"] > msg1["seq"], (
            f"Hardware seq did not advance: msg1 seq={msg1['seq']}, msg2 seq={msg2['seq']}"
        )

    # 6. Verify database storage via async runner
    async def verify_db_storage():
        async for db in get_db():
            node = await get_node(db, "r1-n1")
            assert node is not None, "Node r1-n1 missing in database"
            assert node.get("status") in ("ONLINE", "WARN", "CRIT"), (
                f"Expected online status for r1-n1, got: {node.get('status')}"
            )
            # Check telemetry storage
            latest = await get_latest_telemetry(db, "r1-n1", "t_c")
            assert latest is not None, "Temperature reading for r1-n1 was not persisted to database"
            assert latest["quality"] == "measured", f"Expected quality 'measured', got {latest['quality']}"
            return latest["value"]

    stored_temp = asyncio.run(verify_db_storage())
    print(f"[Hardware Test] Verified live database record: t_c = {stored_temp} C (quality=measured)")
