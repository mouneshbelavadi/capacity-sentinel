import asyncio
import time
import uuid
from contextlib import asynccontextmanager
from typing import AsyncGenerator
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from backend.api.errors import APIContractError, api_contract_error_handler
from backend.api.ai import router as ai_router
from backend.api.analysis import router as analysis_router
from backend.api.auth import router as auth_router
from backend.api.audit import router as audit_router
from backend.api.meta import router as meta_router
from backend.api.proposals import router as proposals_router
from backend.api.racks import router as racks_router
from backend.api.reader import router as reader_router
from backend.api.telemetry import router as telemetry_router
from backend.api.topology import router as topology_router
from backend.api.ws import router as ws_router
from backend.api.simulation import router as simulation_router
from backend.core.config import settings
from backend.core.logging import logger
from backend.db.connection import get_db, init_db_async
from backend.ingest.subscriber import MQTTSubscriber
from backend.services.audit import verify_audit_chain
from backend.services.broadcaster import broadcaster
from backend.services.scheduler import AnalysisScheduler

mqtt_subscriber: MQTTSubscriber | None = None
analysis_scheduler: AnalysisScheduler | None = None


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    global mqtt_subscriber, analysis_scheduler
    logger.info("Initializing database...")
    await init_db_async()

    # Startup self-check: verify audit chain integrity before proceeding
    async for db in get_db():
        audit_check = await verify_audit_chain(db)
        if not audit_check["ok"]:
            broken_seq = audit_check.get("broken_at")
            logger.critical(
                f"FATAL STARTUP FAILURE: Audit chain integrity broken at sequence {broken_seq}! Halting edge server."
            )
            raise RuntimeError(f"Startup self-check failed: Audit chain corrupted at seq {broken_seq}")

        logger.info(
            f"Startup self-check passed: Contract={settings.CONTRACT_VERSION}, "
            f"AuditChain=OK ({audit_check['rows_checked']} rows verified, head={audit_check['head_hash'][:16]}...)"
        )
        await broadcaster.update_topology_cache(db)
        break

    loop = asyncio.get_running_loop()

    logger.info("Starting Realtime Broadcaster service...")
    broadcaster.start(loop)

    logger.info("Starting MQTT subscriber background service...")
    mqtt_subscriber = MQTTSubscriber()
    mqtt_subscriber.start(loop)

    logger.info("Starting Analysis background scheduler...")
    analysis_scheduler = AnalysisScheduler(interval_s=10.0)
    analysis_scheduler.start(loop)

    yield

    logger.info("Shutting down background services...")
    if broadcaster:
        broadcaster.stop()
    if mqtt_subscriber:
        mqtt_subscriber.stop()
    if analysis_scheduler:
        analysis_scheduler.stop()


app = FastAPI(
    title="RackSense Edge API",
    version=settings.CONTRACT_VERSION,
    description="Rack capacity early-warning system backend running on Arduino UNO Q / Edge host",
    lifespan=lifespan,
)


@app.middleware("http")
async def request_logging_middleware(request: Request, call_next):
    request_id = request.headers.get("X-Request-Id", str(uuid.uuid4()))
    request.state.request_id = request_id
    start_time = time.perf_counter()

    try:
        response = await call_next(request)
        duration_ms = round((time.perf_counter() - start_time) * 1000, 2)
        response.headers["X-Request-Id"] = request_id

        # Hard rule: never log credentials, tokens or full auth headers
        logger.info(
            f"{request.method} {request.url.path} {response.status_code} ({duration_ms} ms)",
            extra={
                "request_id": request_id,
                "extra_data": {
                    "method": request.method,
                    "path": request.url.path,
                    "status_code": response.status_code,
                    "duration_ms": duration_ms,
                },
            },
        )
        return response
    except Exception as exc:
        duration_ms = round((time.perf_counter() - start_time) * 1000, 2)
        logger.error(
            f"Unhandled exception on {request.method} {request.url.path}: {exc}",
            exc_info=True,
            extra={"request_id": request_id, "extra_data": {"duration_ms": duration_ms}},
        )
        return JSONResponse(
            status_code=500,
            content={
                "error": {
                    "code": "INTERNAL",
                    "message": "Internal server error",
                    "detail": {},
                }
            },
            headers={"X-Request-Id": request_id},
        )


# Register contract exception handlers
app.add_exception_handler(APIContractError, api_contract_error_handler)


@app.exception_handler(StarletteHTTPException)
async def http_exception_handler(request: Request, exc: StarletteHTTPException):
    code = "NOT_FOUND" if exc.status_code == 404 else "INTERNAL"
    return JSONResponse(
        status_code=exc.status_code,
        content={"error": {"code": code, "message": str(exc.detail), "detail": {}}},
    )


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    return JSONResponse(
        status_code=400,
        content={
            "error": {
                "code": "VALIDATION_ERROR",
                "message": "Request validation failed",
                "detail": {"errors": exc.errors()},
            }
        },
    )


# Mount routes
app.include_router(auth_router)
app.include_router(analysis_router)
app.include_router(meta_router)
app.include_router(topology_router)
app.include_router(telemetry_router)
app.include_router(racks_router)
app.include_router(audit_router)
app.include_router(proposals_router)
app.include_router(reader_router)
app.include_router(ai_router)
app.include_router(ws_router)
app.include_router(simulation_router)
