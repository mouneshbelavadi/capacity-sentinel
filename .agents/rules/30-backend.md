---
trigger: glob
globs: "*.py"
---

# Backend standards

**Stack.** Python 3.11+, FastAPI, Pydantic v2. Every request and response model is typed; no
`dict[str, Any]` crosses a route boundary.

**Layering.** `api/` (routes, no logic) → `services/` (logic) → `repos/` (queries — the only
place SQL lives) → `db/`. A route that runs a query directly is a bug.

**Tenant isolation.** `apply_scope(query, scope)` lives in `repos/scope.py` and nowhere else.
Every repo function that touches tenant data takes a `Scope` and calls it. Write the test that
enumerates repo functions and fails on any that does not — write it early, not at the end.
A tenant requesting a foreign resource gets **404**, never 403; `403` would confirm the resource
exists. Aggregates for a tenant are computed only over that tenant's own slots. The RAG prompt
builder runs **after** the scope filter.

**Async all the way.** Never block the event loop. Forecasting, simulation and change-point
detection run on a background scheduler, write to a cache table, and routes read the cache.
A request handler must never fit an ETS model.

**Analysis correctness.**
- Robust trend check first; if the slope CI contains zero, return `has_trend: false` and no ETA.
- ETS damped additive trend, 1000 simulated paths, crossing-time P10/P50/P90, and
  `no_breach_fraction` for paths that never cross.
- Horizon capped at 3× the fitted window length.
- CUSUM (`k=0.5σ`, `h=5σ`) triggers; `ruptures.Pelt(model="l2", min_size>=30, jump=5)` confirms
  within ±60 s. Log `CHANGE_POINT` only when both agree.
- Node online/offline comes from MQTT LWT and is logged as a known fact, never presented as a
  statistical discovery.
- Attribution is always `quality: "inferred"` and always ships its `basis` string.
- Power is always `quality: "estimated"` with the formula and inputs in `model_detail`.

**Ingest.** Validate every MQTT message against the payload schema before it touches the
database; a malformed message is logged and dropped, never partially stored. `seq` gaps produce
a `TELEMETRY_GAP` audit row. Backfilled rows keep their original `ts` and are flagged.

**Storage.** SQLite in WAL mode for telemetry, batched writes, indexed on
`(node_id, metric, ts)`. Use Postgres + pgvector only if it is already running; otherwise store
embeddings in SQLite and do brute-force cosine in numpy.

**Authorization.** Nonce is single-use, TTL 60 s, bound to `(proposal_id, reader_device_id)`,
consumed atomically (`UPDATE … WHERE consumed_at IS NULL`). Verify in order: device registered →
HMAC → clock skew ≤120 s → nonce → UID allowlist and risk tier. Every failure writes an audit
row.

**Audit.** Append-only. `hash = SHA256(prev_hash || canonical_json(row))`, canonical JSON =
sorted keys, no whitespace, UTF-8, genesis `prev_hash = "0"*64`. No UPDATE and no DELETE path
exists in the codebase.

**LLM.** Advisory only: no tools, no write access, no authority. `action` must be in the closed
whitelist, `evidence` IDs must be ones we supplied — otherwise discard and log
`AI_ACTION_NOT_WHITELISTED` / `AI_EVIDENCE_INVALID`. Log every prompt, model name, response and
validation result to the audit chain.

**Errors.** Use the closed code list from the contract. No bare `HTTPException(500)`, no stack
traces to the client.

**Logging.** Structured JSON with `request_id`, `user_id`, `scope`. Never log a token, nonce,
HMAC or full card UID — hash or truncate.

**Required tests.** Tenant 404 across every resource type · nonce single-use under concurrency ·
HMAC rejection · audit chain detects a tampered row · no ETA when the slope CI contains zero ·
unknown evidence ID discarded · MQTT→WebSocket latency within budget.
