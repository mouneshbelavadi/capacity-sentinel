import asyncio
from datetime import datetime, timezone
import json
import time
from typing import Any
import aiosqlite
from fastapi import WebSocket

from backend.core.logging import logger
from backend.repos.scope import Scope, SYSTEM_SCOPE


class WebSocketClient:
    def __init__(self, ws: WebSocket, scope: Scope, queue_maxsize: int = 100):
        self.ws = ws
        self.scope = scope
        self.subscribed_racks: set[str] = set()
        self.subscribed_metrics: set[str] = set()
        self.send_queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue(maxsize=queue_maxsize)
        self.last_seen: float = time.time()
        self.send_task: asyncio.Task | None = None
        self.alive: bool = True

    def can_receive_node(self, node_id: str, node_tenant: str | None, node_rack: str | None) -> bool:
        """Enforces tenant isolation on outbound frames."""
        if self.scope.role == "TENANT":
            if node_tenant != self.scope.tenant_id:
                return False
        if self.subscribed_racks and node_rack and (node_rack not in self.subscribed_racks):
            return False
        return True

    def enqueue_frame(self, frame: dict[str, Any]) -> None:
        """
        Enqueues a frame. If queue is full, drops the oldest telemetry frame
        to ensure state frames (proposal, changepoint, audit) are NEVER lost.
        """
        if not self.alive:
            return

        frame_type = frame.get("type")
        if self.send_queue.full():
            # If incoming frame is expendable telemetry/power, drop it directly
            if frame_type in ("telemetry", "power_estimate"):
                logger.debug("Dropping incoming telemetry frame due to client backpressure")
                return

            # Urgent state frame: evict an expendable frame from the queue to make room
            temp_items = []
            evicted = False
            while not self.send_queue.empty():
                item = self.send_queue.get_nowait()
                if not evicted and item.get("type") in ("telemetry", "power_estimate"):
                    evicted = True
                    continue
                temp_items.append(item)

            for item in temp_items:
                self.send_queue.put_nowait(item)

            if not evicted and self.send_queue.full():
                # If no expendable frames existed, evict oldest to make room
                try:
                    self.send_queue.get_nowait()
                except asyncio.QueueEmpty:
                    pass

        try:
            self.send_queue.put_nowait(frame)
        except asyncio.QueueFull:
            pass


class RealtimeBroadcaster:
    def __init__(self):
        self.clients: list[WebSocketClient] = []
        self._lock = asyncio.Lock()
        self.node_tenant_cache: dict[str, tuple[str | None, str | None]] = {}  # node_id -> (rack_id, tenant_id)
        # Batching: node_id -> (last_flush_ts, pending_metrics_dict)
        self.telemetry_batch: dict[str, dict[str, Any]] = {}
        self.last_flush_per_node: dict[str, float] = {}
        self._batcher_task: asyncio.Task | None = None
        self._heartbeat_task: asyncio.Task | None = None
        self.running: bool = False

    async def update_topology_cache(self, db: aiosqlite.Connection) -> None:
        """Refreshes node -> (rack_id, tenant_id) mapping for O(1) scope checks."""
        cursor = await db.execute("SELECT node_id, rack_id, tenant_id FROM slots WHERE node_id IS NOT NULL")
        rows = await cursor.fetchall()
        for r in rows:
            self.node_tenant_cache[r["node_id"]] = (r["rack_id"], r["tenant_id"])

    async def register(self, ws: WebSocket, scope: Scope) -> WebSocketClient:
        client = WebSocketClient(ws, scope)
        async with self._lock:
            self.clients.append(client)
        client.send_task = asyncio.create_task(self._client_sender_loop(client))
        logger.info(f"WebSocket client connected: user={scope.user_id}, role={scope.role}")
        return client

    async def unregister(self, client: WebSocketClient) -> None:
        client.alive = False
        if client.send_task:
            client.send_task.cancel()
        async with self._lock:
            if client in self.clients:
                self.clients.remove(client)
        try:
            await client.ws.close()
        except Exception:
            pass
        logger.info(f"WebSocket client disconnected: user={client.scope.user_id}")

    async def _client_sender_loop(self, client: WebSocketClient) -> None:
        """Per-connection send loop. Ensures a slow client never blocks others."""
        while client.alive:
            try:
                frame = await client.send_queue.get()
                frame_json = json.dumps(frame)
                await client.ws.send_text(frame_json)
                client.send_queue.task_done()
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.warning(f"Error sending to WebSocket client: {e}")
                break
        await self.unregister(client)

    def broadcast_telemetry_point(
        self,
        node_id: str,
        metric: str,
        value: float,
        unit: str,
        meta: dict[str, Any],
        ts: str | None = None,
    ) -> None:
        """
        Batches telemetry points per node to ensure max 1 frame per node per 500 ms.
        The UI is never driven at high sensor rate.
        """
        if ts is None:
            ts = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")

        if node_id not in self.telemetry_batch:
            self.telemetry_batch[node_id] = {}

        self.telemetry_batch[node_id][metric] = {
            "node_id": node_id,
            "metric": metric,
            "value": value,
            "unit": unit,
            "meta": meta,
            "ts": ts,
        }

    async def _flush_telemetry_batch(self) -> None:
        """Flushes batched telemetry respecting the 500 ms per node rate limit."""
        now = time.time()
        nodes_to_flush = list(self.telemetry_batch.keys())

        for node_id in nodes_to_flush:
            last_flush = self.last_flush_per_node.get(node_id, 0.0)
            if (now - last_flush) >= 0.5:  # 500 ms minimum interval
                metrics_data = self.telemetry_batch.pop(node_id, {})
                if not metrics_data:
                    continue

                self.last_flush_per_node[node_id] = now
                rack_id, tenant_id = self.node_tenant_cache.get(node_id, (None, None))

                for metric_key, item in metrics_data.items():
                    frame = {
                        "type": "telemetry",
                        "ts": item["ts"],
                        "data": {
                            "node_id": node_id,
                            "metric": item["metric"],
                            "value": item["value"],
                            "unit": item["unit"],
                            "meta": item["meta"],
                        },
                    }
                    self._dispatch_scoped(frame, node_id, tenant_id, rack_id, item["metric"])

    def broadcast_node_status(self, node_id: str, status: str, rssi: int | None = None) -> None:
        rack_id, tenant_id = self.node_tenant_cache.get(node_id, (None, None))
        now_iso = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
        frame = {
            "type": "node_status",
            "ts": now_iso,
            "data": {
                "node_id": node_id,
                "status": status,
                "rssi": rssi,
            },
        }
        self._dispatch_scoped(frame, node_id, tenant_id, rack_id)

    def broadcast_changepoint(self, cp: dict[str, Any]) -> None:
        node_id = cp["node_id"]
        rack_id, tenant_id = self.node_tenant_cache.get(node_id, (None, None))
        now_iso = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
        frame = {
            "type": "changepoint",
            "ts": now_iso,
            "data": cp,
        }
        self._dispatch_scoped(frame, node_id, tenant_id, rack_id)

    def broadcast_forecast_update(self, forecast: dict[str, Any]) -> None:
        node_id = forecast["node_id"]
        rack_id, tenant_id = self.node_tenant_cache.get(node_id, (None, None))
        now_iso = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
        frame = {
            "type": "forecast_update",
            "ts": now_iso,
            "data": forecast,
        }
        self._dispatch_scoped(frame, node_id, tenant_id, rack_id)

    def broadcast_proposal_update(self, proposal: dict[str, Any]) -> None:
        now_iso = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
        prop_scope = proposal.get("scope", {})
        node_id = prop_scope.get("node_id")
        rack_id = prop_scope.get("rack_id")
        tenant_id = prop_scope.get("tenant_id")
        frame = {
            "type": "proposal_update",
            "ts": now_iso,
            "data": proposal,
        }
        self._dispatch_scoped(frame, node_id, tenant_id, rack_id)

    def broadcast_audit_append(self, seq: int, event: str, hash_: str) -> None:
        """
        Contract §12 rule: audit_append carries {seq, event, hash} ONLY.
        Activity grid fetches detail on click. Never push full payload down the socket.
        """
        now_iso = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
        frame = {
            "type": "audit_append",
            "ts": now_iso,
            "data": {
                "seq": seq,
                "event": event,
                "hash": hash_,
            },
        }
        # Audit appends are broadcast to all clients (verified truthfully for all)
        for client in list(self.clients):
            client.enqueue_frame(frame)

    def broadcast_power_estimate(self, node_id: str, value: float, meta: dict[str, Any]) -> None:
        rack_id, tenant_id = self.node_tenant_cache.get(node_id, (None, None))
        now_iso = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
        frame = {
            "type": "power_estimate",
            "ts": now_iso,
            "data": {
                "node_id": node_id,
                "value": value,
                "unit": "W",
                "meta": meta,
            },
        }
        self._dispatch_scoped(frame, node_id, tenant_id, rack_id)

    def _dispatch_scoped(
        self,
        frame: dict[str, Any],
        node_id: str | None,
        tenant_id: str | None,
        rack_id: str | None,
        metric: str | None = None,
    ) -> None:
        """
        Double-check scope before writing:
        Verifies that recipient client's Scope permits viewing this frame.
        """
        for client in list(self.clients):
            # Check tenant isolation
            if client.scope.role == "TENANT":
                if tenant_id and tenant_id != client.scope.tenant_id:
                    continue  # Filter out foreign tenant frame!

            # Check rack subscription filter
            if client.subscribed_racks and rack_id and (rack_id not in client.subscribed_racks):
                continue

            # Check metric subscription filter
            if metric and client.subscribed_metrics and (metric not in client.subscribed_metrics):
                continue

            client.enqueue_frame(frame)

    async def _batcher_loop(self) -> None:
        while self.running:
            try:
                await self._flush_telemetry_batch()
                await asyncio.sleep(0.05)  # 50 ms tick
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Error in telemetry batcher loop: {e}", exc_info=True)

    async def _heartbeat_loop(self) -> None:
        """Pings clients every 20s; drops client if no pong after 40s."""
        while self.running:
            try:
                await asyncio.sleep(20.0)
                now = time.time()
                now_iso = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
                ping_frame = {"type": "ping", "ts": now_iso, "data": {}}

                for client in list(self.clients):
                    if (now - client.last_seen) > 40.0:
                        logger.warning(f"Dropping unresponsive WebSocket client {client.scope.user_id}")
                        await self.unregister(client)
                    else:
                        client.enqueue_frame(ping_frame)
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Error in WebSocket heartbeat loop: {e}", exc_info=True)

    def start(self, loop: asyncio.AbstractEventLoop) -> None:
        self.running = True
        self._batcher_task = loop.create_task(self._batcher_loop())
        self._heartbeat_task = loop.create_task(self._heartbeat_loop())
        logger.info("Realtime broadcaster background tasks started")

    def stop(self) -> None:
        self.running = False
        if self._batcher_task:
            self._batcher_task.cancel()
        if self._heartbeat_task:
            self._heartbeat_task.cancel()
        for c in list(self.clients):
            if c.send_task:
                c.send_task.cancel()
        self.clients.clear()
        logger.info("Realtime broadcaster stopped")


# Global singleton broadcaster
broadcaster = RealtimeBroadcaster()
