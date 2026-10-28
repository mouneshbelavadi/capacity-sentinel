# RackSense — Context
_Last updated: 2026-10-28T19:53:00Z by master-integration_

## Contract
- CONTRACT_VERSION in shared/api-contract.md: 1.0.0
- Backend implements: 1.0.0 (Phases A–F complete)
- Frontend implements: 1.0.0 (Phases 1–6 complete)
- Drift detected: none
- Contract unchanged.

## Current state
Full-stack implementation is complete and verified:
1. **Backend (Phases A–F)**: Fully implemented in Python 3.11+, FastAPI, SQLite WAL mode, and Paho-MQTT subscriber. Implements Contract §15 packet validation, single-choke `apply_scope` tenant isolation, Theil-Sen bootstrap forecast + ETS damped trend, dual change-point detection (CUSUM+PELT), physical RFID approval state machine with 60s single-use nonces and HMAC-SHA256 constant-time verification, OWASP LLM06 grounded advisory AI layer, authenticated WebSocket `/ws?token=<jwt>` with 500ms batching and backpressure queue eviction, sliding-window rate limiting, and startup self-check verifying the SHA-256 hash-chained audit ledger from genesis. 55 backend tests passing.
2. **Frontend (Phases 1–6)**: Fully implemented in React 18, TypeScript (strict, no any), Vite, and Tailwind CSS with custom design tokens. Implements Contract mismatch banner, single API client, single WebSocket hook with 500ms batch buffer, Data Center and Tenant dashboards, 404 stealth view, interactive 3D WebGL rack hall (Three.js with demand frameloop and 2D elevation grid fallback), capacity forecast cone chart (P10/P50/P90 band), vibration baseline chart, CPU-derived power chart, inferred tenant attribution chart, AI advisory panel with evidence modal, proposal discussion card with field-level diffing and countdown timer, physical TFT mirror box, and cryptographic audit log view with interactive tamper detection toggle. 88 frontend tests passing with zero TypeScript errors.

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
| Frontend | Implemented | `frontend/` | Complete 6 phases: 3D hall, forecast cones, approval loop, audit tamper UI |
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
| 2026-10-28 | Enriched judge guide with live competitor comparisons (Grafana/Datadog) and concrete tenant personas (HDFC Bank vs AI Lab) | Provide simple stage dialogue, live demo URLs, and clear persona understanding | User request |
| 2026-10-28 | Double scope check (on subscribe and outbound send) | Prevent tenant socket from subscribing or receiving foreign node frames | Phase F / shared/tenant-isolation.md |
| 2026-10-28 | Selective queue backpressure drops telemetry but preserves state frames | Guarantee critical alerts (proposal, changepoint, audit) under high network lag | Phase F specification |
| 2026-10-28 | scipy.stats.theilslopes analytical CI replaces slow bootstrap loops | Reduce forecast calculation latency from 7.9s to 109ms (well under 2s budget) | Phase F / Contract §14 |
| 2026-10-28 | Fail-loud startup self-check verifying audit chain from genesis | Prevent booting if audit ledger was tampered or truncated out-of-band | Phase F specification |
| 2026-10-28 | CSS design tokens as single source of styling truth in frontend | Enforces consistent infrastructure styling without raw hex codes | `phase-1-foundation.md` §1 |
| 2026-10-28 | Single authStore with persistent localStorage and role derivation | Role routing cleanly synchronizes without prop drilling | `phase-1-foundation.md` §2 |
| 2026-10-28 | 404 stealth on foreign tenant resources across UI views | Guarantees zero foreign tenant existence leakage on client | `phase-2-topology.md` §4 |
| 2026-10-28 | 500 ms batching buffer in single WebSocket client hook | Prevents re-rendering React tree at sensor rate; caps commits at ≤ 2/s | `phase-3-realtime.md` §2 |
| 2026-10-28 | Three explicit connection states (connected / reconnecting / stale) | Visible freshness state prevents operators acting on stale telemetry | `phase-3-realtime.md` §3 |
| 2026-10-28 | Never dual-axis charts; separate power and vibration onto dedicated charts | Dedicated single-unit axes keep data presentation mathematically honest | `phase-4-charts.md` §0 |
| 2026-10-28 | When has_trend is false, cone disappears and text states no sustained trend | Prevents inventing an ETA when slope CI contains zero | `phase-4-charts.md` §1 |
| 2026-10-28 | `<Canvas frameloop="demand">` with direct material.color ref mutation in 3D | Maintains 60 FPS on integrated GPUs without re-rendering component tree | `phase-5-hall.md` §4 |
| 2026-10-28 | Server-derived expires_at countdown calculation in ProposalCard | Eliminates client timer drift; matches hardware reader console exactly | `phase-6-approval.md` §3 |
| 2026-10-28 | Cryptographic verification hero banner with live tamper simulation toggle | Demonstrates append-only SHA-256 integrity check and identifies broken row | `phase-6-approval.md` §4 |
| 2026-10-28 | Automated config consistency check (tools/check_config.py) | Verifies firmware config.h matches central topology before flashing | `03-master-integration.md` Part 1 |
| 2026-10-28 | Single-command 8-step end-to-end smoke test (tools/smoke_test.py) | Ingests sensor reading, polls REST, receives WS frame, approves proposal, submits HMAC tap, and verifies audit chain | `03-master-integration.md` Part 1 |
| 2026-10-28 | Pre-flight readiness checker (tools/demo_check.py) | Verifies config, database, audit ledger, baselines, LLM fallback, and timing budgets before live stage demo | `03-master-integration.md` Part 2 & 5 |
| 2026-10-28 | 12-month synthetic facility backtest (tools/synthetic/backtest.py) | Evaluates lead times (16.6d mean), false-alarm rate (12.5%), interval coverage (63.4%), and change-point F1 (1.000) against ground truth in files (1) | `03-master-integration.md` Part 4 |
| 2026-10-28 | Transparent scope limit disclosure in ANALYSIS.md and DEMO.md | Week-scale claim declared as design intent and synthetic validation; bench physics acknowledged as minute-scale | `03-master-integration.md` Part 3 |

## Open questions for the human
None. Master Integration and Demo Readiness (Phases A–F, Phases 1–6, Parts 1–5) are complete and verified.

## Next actions
1. Run `npm run demo-check` immediately before live presentation to verify green status.
2. Follow the 2.5-minute presentation script in `DEMO.md` with assigned team roles.
