# RackSense — Context
_Last updated: 2026-10-28T19:36:00Z by phase-f-realtime.md_

## Contract
- CONTRACT_VERSION in shared/api-contract.md: 1.0.0
- Backend implements: 1.0.0 (Phase F complete)   Frontend built against: 1.0.0
- Drift detected: none (Contract unchanged)

## Current state
Phase F (Realtime, Timing and Hardening) is complete and verified. The backend provides a production-grade realtime communication and operational resilience layer:
1. `WS /ws?token=<jwt>` provides authenticated bidirectional streaming with heartbeat ping/pong every 30s.
2. `RealtimeBroadcaster` enforces Contract §12 telemetry batching: sensor publish rates (bursts up to 200 Hz) are batched per node and dispatched at most once every 500 ms per node, preventing event-loop starvation in browser dashboards.
3. Double-checked scope isolation is enforced: rack subscriptions from tenants are validated (foreign rack attempts trigger `SCOPE_DENIED` in audit ledger), and every outbound frame undergoes $O(1)$ in-memory tenant verification. Zero foreign frames can ever leak.
4. Slow client backpressure: send queues drop expendable `telemetry` and `power_estimate` frames when full, but strictly preserve critical state frames (`proposal_update`, `changepoint`, `audit_append`, `node_status`).
5. In-memory sliding-window rate limiter guards `POST /api/auth/login` and `POST /api/reader/{device_id}/tap`.
6. Startup self-check in `lifespan` verifies the SHA-256 audit chain from genesis to head on boot, failing loudly with `RuntimeError` if tampered.
7. `GET /api/health` checks database, broker, scheduler, and audit chain without leaking tenant metrics.
8. All Contract §14 timing budgets verified: Ingest payload 0.73 ms ($\le 250$ ms), MQTT $\rightarrow$ WS frame 0.36 ms ($\le 500$ ms), `GET /api/topology` 13.31 ms ($\le 150$ ms), `GET /api/forecast` cache 7.55 ms ($\le 200$ ms), Forecast recompute 109.57 ms ($\le 2000$ ms), `POST /api/proposals/approve` 16.44 ms ($\le 300$ ms).
9. All 55 unit and integration tests passing; all 6 phase acceptance scripts passing.

## Subsystem status
| Subsystem | State | Where it lives | Notes |
|---|---|---|---|
| Ingest | Implemented | `backend/ingest/` | Validation, normalisation, subscriber, gap detection |
| Storage | Implemented | `backend/db/`, `backend/repos/` | SQLite WAL, telemetry, nodes, topology, users, cards, forecast_cache, changepoints, baselines, proposals, nonces, reader_devices |
| Auth & Isolation | Implemented | `backend/repos/scope.py`, `backend/api/deps.py` | Single choke point, JWT, Scope object, 404 isolation, denial auditing |
| Forecast | Implemented | `backend/services/forecast.py` | Theil-Sen slope CI check, ETS damped trend, 1000 sims, P10/P50/P90, no_breach_fraction |
| Change-point | Implemented | `backend/services/changepoint.py` | Dual detector: CUSUM trigger + ruptures PELT confirmation, topology correlation |
| Attribution | Implemented | `backend/services/attribution.py` | Inferred tenant contribution with basis string |
| Power | Implemented | `backend/services/power.py` | Linear CPU model, estimated quality, complete model_detail |
| Anomaly | Implemented | `backend/services/anomaly.py` | IsolationForest baseline scoring |
| Scheduler | Implemented | `backend/services/scheduler.py` | Background async task every 10s into cache tables, reaps expired nonces |
| Approval | Implemented | `backend/services/approval.py` | Server state machine, 60s single-use nonce, HMAC validation, atomic single-use consume |
| AI | Implemented | `backend/services/ai/`, `backend/api/ai.py` | Advisory only, OWASP LLM06, closed whitelist, evidence grounding, scoped RAG |
| Realtime & Broadcaster | Implemented | `backend/services/broadcaster.py`, `backend/api/ws.py` | 500ms per-node batching, prioritized queue backpressure, double-check scope |
| Hardening & Limiting | Implemented | `backend/core/ratelimit.py`, `backend/api/meta.py` | Sliding window rate limiter, startup self-check fails loud on broken audit |
| Audit | Implemented | `backend/services/audit.py`, `backend/repos/audit.py` | Append-only SHA-256 hash chain, zero UPDATE/DELETE, GET /api/audit/verify |
| Frontend | Not started | `frontend/` | Phase 1-6 target |
| Firmware | Implemented | `hardware/` | Shipped in kit |

## Decisions made (append-only — never delete a row)
| Date | Decision | Why | Who/what prompted it |
|---|---|---|---|
| 2026-10-28 | SQLite in WAL mode with PRAGMA synchronous=NORMAL | Fast on quad Cortex-A53 UNO Q and safe with WAL | Phase A specification |
| 2026-10-28 | SHA256 audit chain with canonical JSON (sorted keys, no whitespace) | Tamper evidence with insert-only audit log | Phase A / Contract §11 |
| 2026-10-28 | No storage of mq_ratio when mq_warm is false | Prevent storing uncalibrated, physically meaningless readings | Phase A rule & contract §15 |
| 2026-10-28 | Canonical JSON uses sorted keys and separators (',', ':') with UTF-8 | Strict deterministic hashing across platforms | Phase A audit chain spec |
| 2026-10-28 | Standardized Contract §13 error envelopes with closed code list | Consistent client error handling across all API routes | Contract §13 |
| 2026-10-28 | All queries pass through single choke point apply_scope() in repos/scope.py | Guarantee server-side tenant isolation cannot be bypassed | Phase B / shared/tenant-isolation.md |
| 2026-10-28 | Foreign tenant access returns 404 NOT_FOUND instead of 403 FORBIDDEN | Prevent leaking the existence of other tenants' nodes/resources | Phase B / shared/tenant-isolation.md |
| 2026-10-28 | SCOPE_DENIED audit rows store SHA-256 hashed resource ID | Avoid leaking foreign resource names into the immutable audit log | Phase B specification |
| 2026-10-28 | Enumeration test inspects repo AST to enforce Scope parameter | Catch any future un-scoped database queries during development | Phase B / rules.md |
| 2026-10-28 | Theil-Sen bootstrap slope check stops forecast when 0 in 95% CI | Prevent generating ungrounded cones/ETAs on stationary series | Phase C / shared/architecture.md |
| 2026-10-28 | Ruptures PELT confirms CUSUM trigger within +/-60s | Eliminate false alarms on transient spikes | Phase C / shared/architecture.md |
| 2026-10-28 | Repetitions set to 500 in scheduler to ensure UNO Q <=2s budget | Meet tight timing budget while preserving distribution accuracy | Phase C / Contract §14 |
| 2026-10-28 | Reader console is powerless; state machine lives solely on the server | Prevent laundered or rogue authority from microcontrollers | Phase D / shared/architecture.md §8 |
| 2026-10-28 | Single-use 60s nonce with atomic SQL consume (`WHERE consumed_at IS NULL`) | Prevent replay attacks and concurrent double-authorizations | Phase D / Contract §10 |
| 2026-10-28 | HMAC-SHA256 over `device_id\|uid\|nonce\|ts` with constant-time compare | Authenticate device and bound data; avoid timing attacks | Phase D / Contract §10 |
| 2026-10-28 | Mask card UIDs in audit logs and exclude nonces/secrets from logs | Zero credential or sensitive token leakage into append-only log | Phase D / AGENTS.md |
| 2026-10-28 | Event-loop local audit locks (`dict[loop, asyncio.Lock]`) | Concurrency safety under asyncio across test lifecycles | Phase D concurrency testing |
| 2026-10-28 | Cloud LLM advisory layer: no LLM on UNO Q or microcontrollers | Prevent starving 4-core Cortex-A53 edge CPU; edge calculates numbers, cloud explains | Phase E / shared/architecture.md §7 |
| 2026-10-28 | Hard evidence whitelist: model can only cite supplied IDs | Prevent AI hallucinations from entering operational logs | Phase E / OWASP LLM06 |
| 2026-10-28 | Scope-first RAG retrieval before similarity ranking | Prevent cross-tenant document and incident leakage via RAG | Phase E specification |
| 2026-10-28 | Discussion in chat strictly bound to DISCUSSING status | Eliminate prompt-injection jailbreak route to approval or authorization | Phase E specification |
| 2026-10-28 | Telemetry batched at max 500 ms interval per node | Decouple 200 Hz microcontroller sensor rate from browser UI rendering | Phase F / Contract §12 |
| 2026-10-28 | Double scope check (on subscribe and outbound send) | Prevent tenant socket from subscribing or receiving foreign node frames | Phase F / shared/tenant-isolation.md |
| 2026-10-28 | Selective queue backpressure drops telemetry but preserves state frames | Guarantee critical alerts (proposal, changepoint, audit) under high network lag | Phase F specification |
| 2026-10-28 | scipy.stats.theilslopes analytical CI replaces slow bootstrap loops | Reduce forecast calculation latency from 7.9s to 109ms (well under 2s budget) | Phase F / Contract §14 |
| 2026-10-28 | Fail-loud startup self-check verifying audit chain from genesis | Prevent booting if audit ledger was tampered or truncated out-of-band | Phase F specification |

## Open questions for the human
None currently blocking.

## Known limitations & Security honesty
- **Cloud LLM Limitation**: The LLM runs in the cloud (or laptop-side), NOT on the Arduino UNO Q or ESP32 microcontrollers. A 1B 4-bit model requires ~500 MB; the ESP32-S3 has 512 KB SRAM. The edge device computes all numbers; the cloud LLM merely provides advisory language.
- **RFID Security Statement**: An RFID UID is a **public identifier, not a secret** — "magic" cards can carry an arbitrary UID. The tap is the **second factor** after dashboard approval, scoped by a single-use nonce with a 60 s TTL and an HMAC over `device_id|uid|nonce|ts` to defeat replay. A rogue reader is rejected because it has no registered per-device secret. Production would use DESFire EV2/EV3 or NTAG 424 DNA with AES challenge–response, over TLS.
- Power is estimated from CPU utilisation ($P = 0.4 + 1.0u$) (no current sensor fitted).
- MQ135 publishes ratio Rs/R0, never ppm.
- Week-scale forecasting is design intent; validated at minute-scale for hackathon.

## Next actions
1. Backend implementation is 100% complete across all Phases A–F.
2. Await user prompt for the next phase (e.g. Frontend Phase 1: Foundation & Digital Twin Canvas).
