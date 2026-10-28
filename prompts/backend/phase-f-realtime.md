# BACKEND — PHASE F · Realtime, timing and hardening

> Run `startup.md` first. Phases A–E must be working.
> Read `shared/api-contract.md` §12 and §14.

---

## Goal of this phase

Push everything the backend knows to the browser **live, scoped and on time** — and then prove
the timing rather than assuming it.

This is also the hardening phase: the timing budgets in the contract become enforced tests, and
the system gets its "it keeps working when things go wrong" behaviour.

---

## Build

### 1. WebSocket endpoint

```
WS /ws?token=<jwt>
```

Frames are `{ "type", "ts", "data" }`. Types exactly as contract §12:
`telemetry`, `node_status`, `changepoint`, `forecast_update`, `proposal_update`,
`audit_append`, `power_estimate`.

Client → server: `subscribe { racks, metrics }`, `ping` → `pong`.

### 2. Scope on subscribe **and** on send

A client may ask to subscribe to anything. The server **intersects** the request with the
token's scope, and then checks scope again on every outbound frame before writing it.

Never treat the client's subscribe list as the filter. Two checks, not one — the second is what
catches a bug in the first.

`audit_append` frames carry `{seq, event, hash}` only. The activity grid fetches detail on
click, through the scoped REST route. Never push full audit payloads down the socket.

### 3. Backpressure and batching

- Telemetry is batched and flushed at **most one frame per node per 500 ms**, regardless of how
  fast MQTT delivers. The UI must never be driven at sensor rate.
- If a client's send queue backs up beyond a small bound, **drop the oldest telemetry frames**
  for that client — never block the broadcaster, and never drop a `proposal_update`,
  `changepoint` or `audit_append`. State frames matter; a stale reading does not.
- Per-connection send task, so one slow client cannot stall the others.

### 4. Reconnect contract

On reconnect the client calls REST to resync and then resubscribes. **The server does not
replay missed frames.** Keep it that way — a replay buffer is a second source of truth and it
will drift.

Heartbeat: server `ping` every 20 s; drop a connection with no `pong` after 40 s.

### 5. Timing budgets — now enforced

| Path | Budget |
|---|---|
| MQTT message → stored in DB | ≤ 250 ms |
| MQTT message → WebSocket frame at the browser | ≤ 500 ms |
| `GET /api/topology` | ≤ 150 ms |
| `GET /api/forecast/...` (cached) | ≤ 200 ms |
| Forecast recompute (ETS + simulations) | ≤ 2 s, off the request path |
| `POST /api/proposals/{id}/approve` | ≤ 300 ms |

Write `tests/test_timing.py` that measures these against a running instance **on the UNO Q**,
not on a laptop. If a budget fails on the real board, fix it or reduce the work (e.g. 500
simulation repetitions instead of 1000) and record the decision in `.agents/context.md`. Do not
silently exceed a budget.

### 6. Hardening

- **Rate limiting** on `/api/auth/login` and `/api/reader/{id}/tap` → `RATE_LIMITED`.
- **Graceful degradation**: if the LLM provider is down, every other endpoint keeps working.
  If Mosquitto drops, the API keeps serving stored data and the UI shows nodes as offline.
- **Startup self-check** that logs: contract version, DB schema version, audit chain verified
  (`ok` + head hash + row count), broker reachable, scheduler running. Fail loudly on a broken
  chain rather than starting quietly.
- **Clean shutdown**: flush the telemetry batch, close the broker connection, finish in-flight
  audit appends under the writer lock.
- **Log hygiene** audit: grep your own logs for tokens, nonces, HMACs and full card UIDs. Hash
  or truncate anything found.

### 7. Operational endpoints

```
GET /api/health   → { ok, broker, scheduler, db, audit_chain_ok, uptime_s }
GET /api/meta     → contract_version, server_time, site_id   (already exists — confirm)
```

`/api/health` is unauthenticated but reveals nothing tenant-specific.

---

## Tests

1. MQTT publish → WebSocket frame at a connected client within **500 ms**, measured on the
   UNO Q.
2. A `TENANT` socket **never** receives a frame for a foreign node — even after explicitly
   subscribing to one. Assert over a 30-second run with both tenants publishing.
3. Telemetry frames for one node arrive at most twice per second even when MQTT delivers at
   10 Hz.
4. A deliberately slow client gets telemetry dropped but still receives every
   `proposal_update`, `changepoint` and `audit_append`.
5. Killing and restarting the broker → nodes go offline, API keeps serving, nodes reappear on
   reconnect with no duplicate rows (`seq` dedupe).
6. Killing the LLM provider → `AI_UNAVAILABLE` only; every other endpoint green.
7. Startup self-check fails loudly on a tampered audit chain.
8. 50 concurrent WebSocket clients → no missed state frames, latency budget still met.
9. All Phase A–E tests still pass.

---

## Acceptance — show me live

1. Two browsers side by side — an operator and a tenant — both live. Warm the DHT22: both
   update, and the tenant sees only their own node.
2. In the tenant's devtools, subscribe to a foreign rack → no frames arrive, and a
   `SCOPE_DENIED` row appears in the operator's activity grid.
3. Pull the node's power → `node_status` offline within the keepalive, visible immediately.
4. `GET /api/health` → all green, audit chain `ok`, head hash shown.
5. The timing test output, run on the UNO Q, pasted in full.

## Deliver

- Code, the full test suite green **on the UNO Q**.
- `backend/README.md` finished: install, run, seed, operate, troubleshoot.
- A short `backend/PERFORMANCE.md` with the measured numbers from the real board — real
  measurements, not estimates.
- Refresh `graph.md` and `.agents/context.md`; state final contract version.

The backend is complete after this phase. Next: `prompts/03-master-integration.md`.
