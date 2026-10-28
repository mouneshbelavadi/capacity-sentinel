# RackSense — Backend (Phase F: Realtime, Timing & Operational Hardening)

Target: Edge execution on **Arduino UNO Q** (Debian, quad-core Cortex-A53, 2–4 GB RAM) or local workstation.

Python 3.11+, FastAPI, Pydantic v2, SQLite with WAL mode, Mosquitto broker.

---

## 1. Quickstart

### Environment Setup
```bash
python -m venv .venv
source .venv/bin/activate  # Or on Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env
```

### Start Mosquitto Broker
```bash
# On Debian / Arduino UNO Q:
sudo mosquitto -c mosquitto/mosquitto.conf.example

# On local development:
mosquitto -c backend/mosquitto/mosquitto.conf.example
```

### Seed Topology, Users and Readers
```bash
# 1. Seed physical bench layout (site, racks, slots, tenants, nodes)
python backend/tools/seed_topology.py --config backend/tools/topology.example.yaml

# 2. Seed real bench users and RFID card credentials
python backend/tools/seed_users.py --config backend/tools/users.example.yaml

# 3. Register physical RFID Reader console
python backend/tools/register_reader.py --device-id reader-01 --secret test-secret-42 --label "Bench RFID Console"
```

### Run FastAPI Edge Server
```bash
uvicorn backend.main:app --host 0.0.0.0 --port 8000 --reload
```

---

## 2. Architecture & Pipelines

### 1. Ingest & Telemetry (Phase A)
- MQTT subscriber with strict contract validation against §15.
- Telemetry fanning out with `quality: "measured"`.
- Sequence gap detection (`TELEMETRY_GAP`) and LWT monitoring (`NODE_ONLINE` / `NODE_OFFLINE`).

### 2. Tenant Isolation & Auth (Phase B)
- Single choke point: `apply_scope(query, scope)` in `repos/scope.py`.
- 404 on all foreign resource requests; tenant identifiers never leaked in error messages.
- Role-based access: `TENANT`, `OPERATOR`, `SUPER_USER`. The word `admin` is banned.

### 3. Analysis Engine (Phase C)
- Limits: `t_c` 27.0 °C (ASHRAE TC 9.9), `dew_c` Magnus formula, baselines for relative metrics.
- ETS additive damped trend + Theil-Sen bootstrap 95% slope CI check.
- Dual change-point detector: CUSUM trigger confirmed by `ruptures.Pelt` within ±60s.
- Tenant attribution (`inferred` with basis) & linear CPU power estimation (`estimated`).
- Asynchronous `AnalysisScheduler` background cycle caching results every 10s.

### 4. Approval Chain & RFID Console (Phase D)
- **Zero Reader Authority**: The RFID reader console cannot invent or arm an action.
- **Server State Machine**: `PROPOSED` → `DISCUSSING` → `APPROVED_PENDING_TAP` → `AUTHORIZED` | `EXPIRED` | `REJECTED`.
- **Single-Use 60s Nonce**: Issued on dashboard approval, bound to `(proposal_id, reader_device_id)`.
- **Device Endpoints**:
  - `GET /api/reader/{device_id}/pending`: Pre-rendered ASCII lines (`line1`, `line2`) for embedded TFT.
  - `POST /api/reader/{device_id}/tap`: Strict 6-step validation in order:
    1. `device_id` registered → else `DEVICE_UNKNOWN`
    2. HMAC valid (`device_secret` over `device_id|uid|nonce|ts`, constant-time compare) → else `HMAC_INVALID` (nonce not consumed)
    3. `|now - ts| <= 120s` → else `CLOCK_SKEW`
    4. Nonce exists, unconsumed, unexpired, bound to `device_id` → else `NONCE_EXPIRED` / `NONCE_CONSUMED`
    5. Card registered, active, and `card.max_risk_tier >= proposal.risk_tier` → else `UID_NOT_AUTHORIZED`
    6. Atomic single UPDATE consume (`rowcount == 1`); transition to `AUTHORIZED`.
  - `POST /api/reader/{device_id}/heartbeat`: Telemetry and NTP server time sync.
- **Audit Chain**:
  - Append-only, SHA-256 hash chained (`hash = SHA256(prev_hash || canonical_json(row_without_hash))`).
  - Zero `UPDATE` or `DELETE` path exists.
  - `GET /api/audit/verify` recomputes entire chain and pinpoints `broken_at` seq if tampered.

### 5. AI Advisory Layer (Phase E)
- **OWASP LLM06 Compliant**: Advisory only. Zero tools, zero shell, zero direct facility execution.
- **Model Computes No Numbers**: Every figure is computed by Phase C and handed to the model in context.
- **Closed Action Whitelist**: Only 6 permitted actions (`REDUCE_TENANT_LOAD`, `MIGRATE_TENANT`, `INSPECT_FAN`, `INCREASE_COOLING_SETPOINT_REQUEST`, `SCHEDULE_MAINTENANCE`, `NO_ACTION`). Unwhitelisted actions are discarded and audited as `AI_ACTION_NOT_WHITELISTED`.
- **Strict Evidence Grounding**: The model can only cite evidence IDs supplied in the prompt (`AI_EVIDENCE_INVALID` on hallucination).
- **Tenant-Scoped RAG**: Hand-written committed runbook (`shared/runbook.md`) + historical incident records. Scoped before retrieval: tenants NEVER see another tenant's documents.
- **Discussion Before Approval**: `POST /api/ai/chat` moves proposals to `DISCUSSING`. Prompt-injection hardened: chat can NEVER approve or authorize.
- **Failure Honesty**: Returns `AI_UNAVAILABLE` on provider errors/timeouts without breaking any computed dashboard numbers.

### 6. Realtime, Timing & Operational Hardening (Phase F)
- **WebSocket Streaming (`/ws?token=<jwt>`)**: Authenticated duplex connection with heartbeat ping/pong every 30s.
- **500 ms Telemetry Batching**: Ingest rates (up to 200 Hz) decoupled from browser UI; flushes max twice per second per node.
- **Double-Check Scope Isolation**: Verifies tenant permissions on `subscribe` (auditing foreign rack attempts as `SCOPE_DENIED`) AND before every outbound frame using an $O(1)$ memory cache.
- **Queue Backpressure Eviction**: Drops expendable `telemetry` and `power_estimate` frames when a slow client's send queue is full; strictly preserves critical state frames (`proposal_update`, `changepoint`, `audit_append`, `node_status`).
- **Sliding-Window Rate Limiter**: Guards login (max 5/60s) and card tap (max 10/60s) against brute-force attacks.
- **Fail-Loud Boot Integrity**: Re-evaluates audit chain from genesis on startup; fails loudly with `RuntimeError` if broken.
- **Operational Health (`GET /api/health`)**: Unauthenticated endpoint verifying database, audit chain, broker, and scheduler states.

---

## 3. API Endpoints

- `GET /api/meta`: Public metadata and contract version.
- `GET /api/health`: Operational subsystem health and audit chain verification.
- `WS /ws?token=<jwt>`: Authenticated realtime WebSocket stream.
- `POST /api/auth/login`: Issue JWT token (rate-limited).
- `GET /api/auth/me`: Current user profile.
- `GET /api/topology`: Scoped rack geometry.
- `GET /api/nodes/{node_id}/telemetry?metric=t_c`: Scoped telemetry points with provenance.
- `GET /api/racks/{rack_id}/summary`: Scoped rack status and `worst_margin` with limit source.
- `GET /api/forecast/{node_id}/{metric}`: Crossing distribution and ETS forecast.
- `GET /api/changepoints`: Confirmed dual-detector regime shifts.
- `GET /api/attribution/{rack_id}?metric=t_c`: Inferred tenant responsibility with basis.
- `GET /api/power/{node_id}`: Estimated power consumption.
- `POST /api/baselines/{node_id}/{metric}/capture`: Capture commissioning baseline (OPERATOR+).
- `POST /api/proposals`: Create proposal (closed action whitelist & risk tiers).
- `GET /api/proposals`: Scoped proposals with status filtering.
- `POST /api/proposals/{id}/approve`: Operator arms proposal with 60s nonce (TENANT gets 404).
- `POST /api/proposals/{id}/reject`: Reject proposal and invalidate nonces.
- `GET /api/reader/{device_id}/pending`: Device-facing TFT ASCII prompt.
- `POST /api/reader/{device_id}/tap`: Device-facing HMAC-verified card tap (rate-limited).
- `POST /api/reader/{device_id}/heartbeat`: Device heartbeat.
- `POST /api/ai/summarize`: Scoped capacity summary with evidence IDs.
- `POST /api/ai/explain`: Plain-language explanation of real forecast parameters.
- `POST /api/ai/propose`: AI-suggested mitigation proposal in PROPOSED state.
- `POST /api/ai/chat`: Interactive discussion and revision in DISCUSSING state.
- `GET /api/audit`: Scoped audit chain logs.
- `GET /api/audit/verify`: Global hash-chain integrity verification.
- `GET /api/tenants`: SUPER_USER only.

---

## 4. Running Tests

```bash
# Full test suite (55 unit, integration, crypto, isolation, AI, and timing tests)
python -m pytest backend/tests -v

# Verification scripts
python backend/tools/verify_acceptance.py    # Phase A acceptance (Ingest Spine)
python backend/tools/verify_acceptance_b.py  # Phase B acceptance (Auth & Isolation)
python backend/tools/verify_acceptance_c.py  # Phase C acceptance (Analysis Engine)
python backend/tools/verify_acceptance_d.py  # Phase D acceptance (Approval Chain & Audit)
python backend/tools/verify_acceptance_e.py  # Phase E acceptance (AI Advisory Layer)
python backend/tools/verify_acceptance_f.py  # Phase F acceptance (Realtime & Timing Budgets)
```
```
