---
trigger: glob
globs: "*.py"
---

- **Python 3.11+, FastAPI, Pydantic v2.** Every request and response model is typed. No
  `dict[str, Any]` crossing a route boundary.
- **Layering:** `api/` (routes, no logic) → `services/` (logic) → `repos/` (queries, the only
  place SQL lives) → `db/`. A route that runs a query directly is a bug.
- **`apply_scope()` lives in `repos/scope.py` and nowhere else.** Every repo function takes a
  `Scope` and calls it. Add the test that enumerates repo functions and fails on any that
  do not.
- **Async all the way.** Never block the event loop. Forecasting, simulation and change-point
  detection run on a background scheduler (APScheduler or an asyncio task), write their results
  to a cache table, and routes read the cache. A request handler must never fit an ETS model.
- **Timing budgets from the contract are enforced**, not aspirational. Add a timing test for the
  MQTT→WebSocket path.
- **SQLite in WAL mode** for telemetry on the UNO Q. Write batched, read indexed on
  `(node_id, metric, ts)`. Postgres + pgvector only if it is already running; otherwise
  embeddings in SQLite with numpy cosine — at hundreds of documents it is instant and removes a
  moving part.
- **Every MQTT message is validated** against the payload schema before it touches the database.
  A malformed message is logged and dropped, never partially stored.
- **`seq` gaps produce a `TELEMETRY_GAP` audit row.** Backfilled rows keep their original `ts`
  and are flagged.
- **Errors use the closed code list.** No bare `HTTPException(500)`. No stack traces to the
  client.
- **Structured logging** (JSON) with `request_id`, `user_id`, `scope`. Never log a token, a
  nonce, an HMAC or a card UID in full — hash or truncate.
- **Tests that must exist before you call the backend done:** scope isolation (a tenant gets 404
  for a foreign node, across *every* resource type), nonce single-use under concurrency, HMAC
  rejection, audit chain verification detecting a tampered row, forecast returns no ETA when the
  slope CI contains zero, LLM response with an unknown evidence ID is discarded.
