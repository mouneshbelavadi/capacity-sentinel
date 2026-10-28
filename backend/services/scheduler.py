import asyncio
import json
import time
from datetime import datetime, timezone
from typing import Any
import aiosqlite

from backend.core.config import settings
from backend.core.logging import logger
from backend.db.connection import get_db
from backend.repos.analysis import save_cached_forecast, save_changepoint
from backend.repos.audit import query_audit_logs
from backend.repos.baselines import get_baseline
from backend.repos.scope import SYSTEM_SCOPE
from backend.repos.telemetry import query_node_telemetry
from backend.services.approval import reap_expired_proposals
from backend.services.audit import append_audit_event
from backend.services.broadcaster import broadcaster
from backend.services.changepoint import detect_agreed_changepoint
from backend.services.forecast import compute_forecast

TRACKED_METRICS = ["t_c", "rh", "vib_rms_g", "mq_ratio"]


class AnalysisScheduler:
    def __init__(self, db_path: str | None = None, interval_s: float = 10.0):
        self.db_path = db_path or settings.DB_PATH
        self.interval_s = interval_s
        self.running = False
        self._task: asyncio.Task | None = None
        self.last_duration_ms: float = 0.0

    async def run_single_node_metric_cycle(
        self,
        db: aiosqlite.Connection,
        node_id: str,
        metric: str,
        repetitions: int = 500,
    ) -> float:
        """Runs change-point and forecast for a single node and metric. Returns duration in ms."""
        start_time = time.perf_counter()

        # 1. Fetch recent telemetry (up to last 180 points ~ 30 min of 10s data)
        raw_points = await query_node_telemetry(
            db=db,
            node_id=node_id,
            metric=metric,
            limit=180,
            scope=SYSTEM_SCOPE,
        )

        if not raw_points:
            return round((time.perf_counter() - start_time) * 1000, 2)

        # 2. Check baselines for relative metrics
        baseline_record = await get_baseline(db, node_id, metric, scope=SYSTEM_SCOPE)
        baseline_val = baseline_record["value"] if baseline_record else None

        # 3. Check for agreed change point
        recent_audit = await query_audit_logs(db, scope=SYSTEM_SCOPE, limit=20)
        topo_events = [
            {"ts": r["ts"], "event_data": json.loads(r["payload_json"])}
            for r in recent_audit
            if r["event"] in ("NODE_ONLINE", "NODE_OFFLINE")
        ]

        cp = detect_agreed_changepoint(
            node_id=node_id,
            metric=metric,
            points=raw_points,
            topology_events=topo_events,
        )
        window_reason = "cold_start"
        if cp:
            window_reason = f"changepoint:{cp['cp_id']}"
            await save_changepoint(db, cp, scope=SYSTEM_SCOPE)
            await append_audit_event(
                db=db,
                event="CHANGE_POINT",
                actor="analysis:engine",
                subject={"node_id": node_id, "metric": metric, "cp_id": cp["cp_id"]},
                payload={"delta": cp["shift"]["delta"], "located_at": cp["located_at"]},
            )
            broadcaster.broadcast_changepoint(cp)

        # 4. Compute forecast
        forecast_result = compute_forecast(
            node_id=node_id,
            metric=metric,
            points=raw_points,
            baseline_val=baseline_val,
            window_reason=window_reason,
            repetitions=repetitions,
        )

        # 5. Cache result
        now_iso = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
        await save_cached_forecast(
            db=db,
            node_id=node_id,
            metric=metric,
            forecast_id=forecast_result["forecast_id"],
            payload_json=json.dumps(forecast_result),
            computed_at=now_iso,
            scope=SYSTEM_SCOPE,
        )
        broadcaster.broadcast_forecast_update(forecast_result)

        duration_ms = round((time.perf_counter() - start_time) * 1000, 2)
        return duration_ms

    async def run_full_cycle(self) -> float:
        """Runs full analysis cycle across all nodes and metrics."""
        start_time = time.perf_counter()
        async for db in get_db(self.db_path):
            cursor = await db.execute("SELECT node_id FROM nodes")
            nodes = [r[0] for r in await cursor.fetchall()]

            for node_id in nodes:
                for metric in TRACKED_METRICS:
                    try:
                        await self.run_single_node_metric_cycle(db, node_id, metric, repetitions=500)
                    except Exception as e:
                        logger.warning(f"Error analyzing {node_id}/{metric}: {e}")

            # Also reap any expired proposals past their 60s TTL
            try:
                await reap_expired_proposals(db)
            except Exception as e:
                logger.warning(f"Error reaping expired proposals: {e}")

        self.last_duration_ms = round((time.perf_counter() - start_time) * 1000, 2)
        return self.last_duration_ms

    async def _loop(self) -> None:
        while self.running:
            try:
                cycle_ms = await self.run_full_cycle()
                logger.debug(f"Analysis cycle completed in {cycle_ms} ms")
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Error in analysis scheduler loop: {e}", exc_info=True)

            try:
                await asyncio.sleep(self.interval_s)
            except asyncio.CancelledError:
                break

    def start(self, loop: asyncio.AbstractEventLoop) -> None:
        self.running = True
        self._task = loop.create_task(self._loop())
        logger.info(f"Analysis scheduler started (interval={self.interval_s}s)")

    def stop(self) -> None:
        self.running = False
        if self._task:
            self._task.cancel()
        logger.info("Analysis scheduler stopped")

