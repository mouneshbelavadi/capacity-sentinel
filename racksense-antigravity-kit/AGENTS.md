# AGENTS.md — RackSense

Workspace rules. Always active. The full version with rationale is `rules.md`; this file is the
enforceable core. Where they differ, `rules.md` wins and this file should be corrected.

## Ground truth files — read before acting

`rules.md` · `shared/api-contract.md` · `shared/architecture.md` · `shared/tenant-isolation.md`
· `shared/hardware-connections.md`

At the start of every session run `startup.md`: regenerate `graph.md`, refresh
`.agents/context.md`, write the workspace rules, then wait for the task prompt.

## The core rule

**No fake data. No hard-coded values. No invented numbers.** Every displayed number is
`measured`, `estimated`, `inferred`, `ai_generated` or `synthetic`, and carries that label in
`meta.quality`. There is no sixth category and no unlabelled number.

Forbidden anywhere outside `tools/synthetic/`: mock constants, `Math.random()` in a render path,
demo data inside a component or route, charts that draw a shape with no data behind them, empty
states that render zeros. When there is no data, the UI says there is no data.

## Non-negotiables

1. `shared/api-contract.md` is shared by backend and frontend and is **face-to-face**. Never
   change one side. To change: bump `CONTRACT_VERSION`, edit the contract, update both sides in
   the same change, append to the Changelog.
2. Tenant isolation is enforced server-side in one function, `apply_scope(query, scope)` in
   `repos/scope.py`. Every tenant-data query calls it. A tenant requesting a foreign resource
   gets **404**, never 403. A test must fail if a new query omits the scope.
3. The word **`admin` is banned** in routes, components, tables, labels, titles and logs. The
   elevated role is `SUPER_USER` ("Super User"). The all-servers view is the **Data Center
   Dashboard**; the scoped view is the **Tenant Dashboard**.
4. The LLM is **advisory**. It computes no numbers, holds no write tools, authorizes nothing.
   `action` must be in the closed whitelist; `evidence` IDs must be ones we supplied. Violations
   are discarded and audited.
5. The RFID reader **holds no authority**. It cannot arm itself; it relays a tap for an action
   the server already armed with a single-use nonce (TTL 60 s) bound to that proposal and device.
6. The audit log is **append-only**, hash-chained
   (`SHA256(prev_hash || canonical_json(row))`). No UPDATE or DELETE path exists in the codebase.
7. **Nothing writes to a facility control.** Telemetry flows up only. The system advises.
8. **No secrets in the repo.** `.env`, `secrets.h`, NVS — all gitignored, with `.example` files
   committed instead.

## Honesty in the UI

- `measured` and `estimated` series never share a line.
- Power is always `estimated` here (no current sensor); the tooltip shows the formula and inputs.
- A forecast is always a distribution. If `has_trend` is false, render "No sustained trend — no
  exhaustion forecast" and draw no cone. Always display `no_breach_fraction`.
- MQ135 reports a **ratio**, never ppm; "warming up" until preheat completes.
- Vibration is relative to a captured baseline, never an absolute ISO zone.
- Never present "weeks ahead" as a validated hackathon result.

## Working method

Plan before building. Small verifiable steps. Finish what you start — no `TODO`, no stub
returning a constant, no commented-out "for later". Never silently widen scope. Read before you
write; do not add a second implementation of scoping, hashing or forecasting. Ask when
ambiguous, especially around isolation, authorization or the audit chain. Verify by running it.

## Backend (`*.py`)

Python 3.11+, FastAPI, Pydantic v2, fully typed. Layering `api/` → `services/` → `repos/` →
`db/`; SQL only in `repos/`. Async throughout — forecasting and change-point detection run on a
background scheduler and write to a cache table; a request handler never fits a model. SQLite in
WAL mode, indexed on `(node_id, metric, ts)`. Validate every MQTT message before storage;
`seq` gaps raise `TELEMETRY_GAP`. Errors use the closed code list. Structured JSON logs that
never contain a token, nonce, HMAC or full card UID.

Required tests: tenant 404 across every resource type · nonce single-use under concurrency ·
HMAC rejection · audit chain detects a tampered row · no ETA when slope CI contains zero ·
unknown evidence ID discarded.

## Frontend (`*.tsx`, `*.ts`, `*.css`)

React + TypeScript (`strict`, no `any`) + Vite. One API client; one WebSocket hook with backoff,
REST resync on reconnect, and a visible `connected | reconnecting | stale` state. Never drive
state at sensor rate — batch and commit at most every 500 ms. `<Canvas frameloop="demand">` with
`invalidate()` on update; mutate refs in `useFrame`. Every contract error code has a rendering
branch. Loading, empty, stale and error are designed states. Accessibility floor: visible focus,
`prefers-reduced-motion`, never colour alone, contrast checked. Design tokens only — no hex in a
component.

Look: a professional infrastructure console (Google Cloud Console / Power BI grade).
**Light theme only — no dark theme, no toggle.** Outline icons from one set only.
**No emojis anywhere.** No gradients, glass, glow or decoration.

## Firmware

Pins only via named constants in `config.h`. Non-blocking everywhere; no `delay()` in `loop()`.
`setBufferSize(1024)` before connecting on PubSubClient. LWT + retained status + `"online"` on
connect. Monotonic `seq`, NTP at boot, ring buffer flushed on reconnect with original timestamps.
DHT22 no faster than 2 s; MQ135 `mq_warm:false` until preheat; MPU6050 reduces 2 s of 200 Hz
samples to RMS/peak/crest on-device. The reader never decides anything.

## Finishing a run

Regenerate `graph.md`. Update `.agents/context.md` (state, subsystem table, append-only decision
rows, next actions). State in one line what changed in the contract or "contract unchanged".
List what you left unfinished. A run that edits code without refreshing those two files is not
finished.

## Refuse

Mock data to fill a screen · single-number ETAs · ppm from MQ135 · ISO zones on a small fan ·
"measured" power without a sensor · giving the LLM tools, write access or authority · running an
LLM on a microcontroller · client-side-only permission checks · an `admin` route or label ·
editing or deleting an audit row.
