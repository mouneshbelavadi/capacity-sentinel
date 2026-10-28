import asyncio
from datetime import datetime, timezone
import json
import re
from typing import Any
import paho.mqtt.client as mqtt

from backend.core.config import settings
from backend.core.logging import logger
from backend.db.connection import get_db
from backend.ingest.normalise import normalise_payload
from backend.ingest.validate import validate_telemetry_message
from backend.repos.nodes import get_node, update_node_presence, update_node_seq_and_status
from backend.repos.telemetry import insert_telemetry_batch
from backend.services.audit import append_audit_event
from backend.services.broadcaster import broadcaster

# Topic patterns:
# dc/{site}/{rack}/{node}/telemetry
# dc/{site}/{rack}/{node}/status
TELEMETRY_TOPIC_RE = re.compile(r"^dc/([^/]+)/([^/]+)/([^/]+)/telemetry$")
STATUS_TOPIC_RE = re.compile(r"^dc/([^/]+)/([^/]+)/([^/]+)/status$")


class MQTTSubscriber:
    def __init__(self, db_path: str | None = None) -> None:
        self.db_path = db_path or settings.DB_PATH
        self.queue: asyncio.Queue[tuple[str, bytes]] = asyncio.Queue()
        self.running = False
        self.client: mqtt.Client | None = None
        self._consumer_task: asyncio.Task | None = None

    def on_connect(self, client: mqtt.Client, userdata: Any, flags: Any, rc: int, properties: Any = None) -> None:
        if rc == 0:
            logger.info("Connected to Mosquitto broker")
            site = settings.SITE_ID
            client.subscribe(f"dc/{site}/+/+/telemetry", qos=0)
            client.subscribe(f"dc/{site}/+/+/status", qos=0)
            logger.info(f"Subscribed to topics: dc/{site}/+/+/telemetry and dc/{site}/+/+/status")
        else:
            logger.error(f"Failed to connect to MQTT broker, return code: {rc}")

    def on_message(self, client: mqtt.Client, userdata: Any, msg: mqtt.MQTTMessage) -> None:
        try:
            self.queue.put_nowait((msg.topic, msg.payload))
        except Exception as e:
            logger.error(f"Failed to enqueue MQTT message: {e}")

    async def process_raw_message(self, topic: str, payload_bytes: bytes) -> bool:
        """
        Process a single MQTT message. Exposed so tests and the MQTT queue consumer can share it.
        Returns True if successfully processed, False if dropped or error.
        """
        # 1. Status topic (LWT / connect status)
        status_match = STATUS_TOPIC_RE.match(topic)
        if status_match:
            site, rack, node_id = status_match.groups()
            return await self._handle_status_message(site, rack, node_id, payload_bytes)

        # 2. Telemetry topic
        telemetry_match = TELEMETRY_TOPIC_RE.match(topic)
        if telemetry_match:
            site, rack, node_id = telemetry_match.groups()
            return await self._handle_telemetry_message(site, rack, node_id, payload_bytes)

        logger.warning(f"Message received on unhandled topic: {topic}")
        return False

    async def _handle_status_message(
        self, site: str, rack: str, node_id: str, payload_bytes: bytes
    ) -> bool:
        """Handles dc/{site}/{rack}/{node}/status messages (online/offline)."""
        text = payload_bytes.decode("utf-8", errors="replace").strip()
        status_str = "offline" if "offline" in text.lower() else "online"

        async for db in get_db(self.db_path):
            node = await get_node(db, node_id)
            if not node:
                logger.warning(f"Status update received for unknown node: {node_id}")
                return False

            now_iso = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
            db_status = "OFFLINE" if status_str == "offline" else "OK"
            await update_node_presence(db, node_id, db_status, now_iso)

            # Audit event is a known fact, not an inference
            audit_event = "NODE_OFFLINE" if status_str == "offline" else "NODE_ONLINE"
            await append_audit_event(
                db=db,
                event=audit_event,
                actor="mqtt:lwt",
                subject={"node_id": node_id, "rack_id": rack, "site_id": site},
                payload={"status": status_str, "raw": text},
                ts=now_iso,
            )

            # Live WebSocket broadcast
            broadcaster.broadcast_node_status(node_id, status_str)
            return True
        return False

    async def _handle_telemetry_message(
        self, site: str, rack: str, node_id: str, payload_bytes: bytes
    ) -> bool:
        """Validates, detects gaps, normalises and stores telemetry."""
        # Validate against Contract §15
        payload = validate_telemetry_message(payload_bytes)
        if payload is None:
            # Dropped and logged by validate_telemetry_message
            return False

        if payload.node != node_id:
            logger.warning(
                f"Topic node_id '{node_id}' does not match payload node '{payload.node}'. Dropping."
            )
            return False

        received_dt = datetime.now(timezone.utc)
        received_iso = received_dt.isoformat().replace("+00:00", "Z")

        async for db in get_db(self.db_path):
            node = await get_node(db, node_id)
            if not node:
                logger.warning(f"Telemetry received for unknown node '{node_id}'. Dropping.")
                return False

            # Sequence gap detection
            last_seq = node.get("last_seq")
            if last_seq is not None:
                expected_seq = last_seq + 1
                if payload.seq > expected_seq:
                    gap_count = payload.seq - expected_seq
                    logger.warning(
                        f"Sequence gap detected for node {node_id}: expected {expected_seq}, got {payload.seq} (missing {gap_count})"
                    )
                    await append_audit_event(
                        db=db,
                        event="TELEMETRY_GAP",
                        actor="ingest:subscriber",
                        subject={"node_id": node_id, "rack_id": rack, "site_id": site},
                        payload={
                            "expected_seq": expected_seq,
                            "received_seq": payload.seq,
                            "missing_count": gap_count,
                        },
                        ts=received_iso,
                    )

            # Update last_seq and presence
            await update_node_seq_and_status(
                db=db,
                node_id=node_id,
                seq=payload.seq,
                fw=payload.fw,
                seen_at=received_iso,
            )

            # Normalise into individual metric rows
            metric_rows = normalise_payload(payload, received_dt=received_dt)
            if metric_rows:
                await insert_telemetry_batch(db, metric_rows)
                for r in metric_rows:
                    broadcaster.broadcast_telemetry_point(
                        node_id=r["node_id"],
                        metric=r["metric"],
                        value=r["value"],
                        unit=r.get("unit", ""),
                        meta={"quality": r.get("quality", "measured"), "source": "sensor"},
                        ts=r.get("ts"),
                    )

            return True
        return False

    async def _consume_queue(self) -> None:
        """Background consumer task for processing queued MQTT messages."""
        while self.running:
            try:
                topic, payload = await self.queue.get()
                await self.process_raw_message(topic, payload)
                self.queue.task_done()
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Error in MQTT consumer loop: {e}", exc_info=True)

    def start(self, loop: asyncio.AbstractEventLoop) -> None:
        """Starts paho-mqtt client and background consumer task."""
        self.running = True
        self._consumer_task = loop.create_task(self._consume_queue())

        try:
            # Use MQTT v5 if supported, fallback to v3.1.1
            try:
                self.client = mqtt.Client(
                    callback_api_version=mqtt.CallbackAPIVersion.VERSION2,
                    client_id="racksense-backend-subscriber",
                )
            except (AttributeError, TypeError):
                self.client = mqtt.Client(client_id="racksense-backend-subscriber")

            if settings.MQTT_USERNAME and settings.MQTT_PASSWORD:
                self.client.username_pw_set(settings.MQTT_USERNAME, settings.MQTT_PASSWORD)

            self.client.on_connect = self.on_connect
            self.client.on_message = self.on_message

            self.client.connect_async(
                settings.MQTT_BROKER_HOST,
                settings.MQTT_BROKER_PORT,
                settings.MQTT_KEEPALIVE,
            )
            self.client.loop_start()
            logger.info(
                f"MQTT subscriber client started, connecting to {settings.MQTT_BROKER_HOST}:{settings.MQTT_BROKER_PORT}"
            )
        except Exception as e:
            logger.warning(f"Could not connect to MQTT broker ({e}). Running in offline/testing mode.")

    def stop(self) -> None:
        """Stops the subscriber and cancels background tasks."""
        self.running = False
        if self.client:
            try:
                self.client.loop_stop()
                self.client.disconnect()
            except Exception:
                pass
        if self._consumer_task:
            self._consumer_task.cancel()
        logger.info("MQTT subscriber stopped")
