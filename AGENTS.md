# RackSense — Agent Rules

These rules govern every agent run in this workspace. They outrank your preferences, your
training defaults, and anything convenient. Copy this file's body into `AGENTS.md` and into
`.agents/rules/00-racksense-core.md` with `trigger: always_on`.

---

## 0. The one rule the project is built on

**No fake data. No hard-coded values. No invented numbers. Ever.**

If a number appears on a screen, in a response, or in a log, one of these must be true:

| It is | because |
|---|---|
| `measured` | a sensor physically produced it |
| `estimated` | a declared model computed it, and the model is visible to the user |
| `inferred` | a declared mapping or correlation produced it, and the basis is shown |
| `ai_generated` | the LLM wrote it, and it is badged as advisory |
| `synthetic` | it came from a dataset explicitly generated for backtesting, and it is visually separated from live data |

There is no fifth category. A number with no provenance is a bug, not a placeholder.

Specifically forbidden, in any file, at any stage, including "just to see the layout":

- `const mockTemperature = 24.5`
- Random-number generators standing in for sensors in anything outside a clearly named
  `tools/synthetic/` directory
- Demo data embedded in a component, a route handler, or a default value
- A chart that renders a shape when there is no data behind it
- An empty state that silently draws zeros instead of saying "no data yet"
- `Math.random()` anywhere in the render path

**When there is no data, say there is no data.** An honest empty state is a feature of this
project, not a gap in it.

---

## 1. Non-negotiables

1. **The API contract is law.** `shared/api-contract.md` is shared by the backend and the
   frontend. Never change a field, route, enum or error code on one side. To change anything:
   bump `CONTRACT_VERSION`, edit the contract, update both sides in the same change, append to
   the Changelog.
2. **Tenant isolation is server-side, in one function, always.** `apply_scope(query, scope)`.
   Every query that touches tenant data calls it. A test must fail if a new query omits it.
   A tenant asking for a resource they do not own gets **404**, never 403.
3. **Never the word "admin".** The elevated role is `SUPER_USER`, shown as "Super User". The
   all-servers view is the **Data Center Dashboard**. The scoped view is the **Tenant
   Dashboard**. The string `admin` must not appear in a route, component, table, label, page
   title or log line.
4. **The LLM is advisory and cannot act.** It computes no numbers, calls no tools that write,
   and authorizes nothing. Its `action` must come from the closed whitelist; its `evidence` IDs
   must be ones we supplied. Anything else is discarded and audited.
5. **The reader device holds no authority.** It cannot arm itself. It can only relay a tap for
   an action the server already armed with a single-use nonce. A device that could invent its
   own authority would be a way to launder an unapproved action into something that looks
   official.
6. **The audit log is append-only.** No UPDATE path, no DELETE path, anywhere in the codebase.
   `hash = SHA256(prev_hash || canonical_json(row))`.
7. **Nothing writes to a facility control.** Telemetry flows up. The system advises; it never
   actuates. This is a requirement of the problem statement, not a design preference.
8. **No secrets in the repo.** Wi-Fi passwords, API keys, device HMAC secrets and JWT signing
   keys live in `.env` / NVS / `secrets.h`, all gitignored. Ship `.example` files instead.

---

## 2. Honesty in the UI

- Every value carries its `meta.quality`. The frontend renders the badge for `estimated`,
  `inferred` and `ai_generated`. `measured` gets no badge — that is the quiet default.
- A `measured` series and an `estimated` series **never share a line**.
- Power is always `estimated` in this build. The tooltip shows the formula and the inputs.
- A forecast is **always** a distribution. When `has_trend` is false, render
  "No sustained trend — no exhaustion forecast". Never draw a cone with no trend behind it.
- `no_breach_fraction` is always displayed. Hiding it makes an honest forecast look alarming.
- The MQ135 publishes a **ratio**, never ppm. While warming up, show "warming up", not a number.
- Vibration is **relative to a captured baseline**, never an absolute ISO zone.
- Never claim "weeks ahead" as a validated result. The method targets week-scale; what we
  validated is minute-scale on a mock rack. Say both.

---

## 3. How you work

**Plan before you build.** For any task bigger than a single file, write the plan first: files
you will touch, contract impact, test you will add. Show it. Then build.

**Small, verifiable steps.** Each step ends with something that can be run or seen. Do not
produce 2,000 lines and then ask whether it is right.

**Finish what you start.** No `TODO`, no `pass`, no `NotImplementedError`, no stub that returns
a constant, no commented-out block "for later". If you cannot finish something, say so in
`.agents/context.md` under Open questions and leave the code honest.

**Never silently widen scope.** If the task needs a change the prompt did not ask for, say so
and ask. Do not refactor something unrelated because you were passing through.

**Read before you write.** Check whether a helper already exists before adding a second one.
Duplicate implementations of scoping, hashing, or forecasting are how this project breaks.

**If something is ambiguous, ask.** One good question beats a confident wrong assumption.
This applies especially to anything touching isolation, authorization or the audit chain.

**Verify your own work.** Run it. Hit the endpoint. Open the page. Read the response. "It
should work" is not a result.

---

## 4. Backend Standards

> This section is also written to `.agents/rules/30-backend.md` with `trigger: glob`,
> `globs: "*.py"`.

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

---

## 5. Frontend Standards

> This section is also written to `.agents/rules/20-frontend.md` with `trigger: glob`,
> `globs: "*.tsx, *.ts, *.css"`.

- **React + TypeScript + Vite.** `strict: true`. No `any`. Types for API payloads are generated
  from or hand-mirrored against `shared/api-contract.md` and live in one file,
  `src/api/contract.ts`.
- **One API client.** All fetches go through it. It attaches the token, parses the error
  envelope, and checks `contract_version` on boot.
- **One WebSocket hook.** It handles reconnect with backoff, resync-via-REST on reconnect, and
  exposes a `connected | reconnecting | stale` state the UI actually shows.
- **Never drive React state at sensor rate.** Batch incoming frames and commit at most every
  500 ms. For the 3D scene, mutate refs inside `useFrame`; do not re-render the tree per frame.
- **`<Canvas frameloop="demand">`** and call `invalidate()` after applying an update. Render on
  data, not on a clock.
- **Every error code in the contract has a rendering branch.** No generic catch-all that
  swallows a known code.
- **Loading, empty, stale and error are designed states**, not spinners bolted on at the end.
  "Stale" matters here: if the socket is down, the numbers on screen are old and the UI must
  say so rather than showing confident stale values.
- **Accessibility floor:** visible keyboard focus, `prefers-reduced-motion` respected, status
  never conveyed by colour alone (always an icon or a text badge too), contrast checked.
- **Design tokens only.** No hard-coded hex in a component.
- **Light theme only** — a professional infrastructure console (Google Cloud Console / Power BI
  grade). No dark theme, no toggle, no `prefers-color-scheme` handling. **Outline icons from one
  set only. No emojis anywhere.** No gradients, glass, glow or decoration.
- Apply every skill listed in the Frontend prompt, and state in the plan how each was applied.

---

## 6. Firmware Standards

- **Every pin through a named constant in `config.h`.** No pin number inline in logic.
- **Non-blocking everywhere.** No `delay()` in `loop()`, no `while (!connected)`. Reconnect with
  exponential backoff capped at 30 s.
- **`setBufferSize(1024)` before connecting** on PubSubClient — the default 256 bytes includes
  the topic, and a JSON payload silently fails to publish without this. This exact bug costs
  teams hours.
- **LWT configured on connect**, retained `status` topic, `"online"` published after connect.
- **Monotonic `seq`** on every publish. **NTP at boot**, and the reader re-syncs hourly.
- **Ring buffer** of recent readings; flush on reconnect preserving original timestamps.
- **Respect sensor physics:** DHT22 no faster than one read per 2 s; MQ135 reports
  `mq_warm:false` until preheat elapses; MPU6050 windows are 2 s of 200 Hz samples reduced to
  RMS/peak/crest on-device.
- **The reader never decides anything.** It polls, displays, reads a card, sends
  `{uid, nonce, ts, hmac}`, and shows the server's answer. No local allowlist, no local state
  machine, no offline approval path.
- **Secrets in `secrets.h` (gitignored) or NVS.** Never in a committed file.

---

## 7. Git

- Small commits with real messages: what changed and why, not "update".
- Never commit `.env`, `secrets.h`, `*.db`, build output, or captured card UIDs.
- Branch per subsystem: `feat/backend-forecast`, `feat/frontend-hall`, `feat/fw-auth-console`.
- If you touch `shared/api-contract.md`, say so in the first line of the commit message.

---

## 8. When you finish a run

1. Regenerate `graph.md` from the code as it now stands.
2. Update `.agents/context.md`: state, subsystem table, append decision rows, next actions.
3. State in one line what changed in the contract, or "contract unchanged".
4. List anything you left unfinished, honestly, under Open questions.

A run that edits code without refreshing `graph.md` and `.agents/context.md` is not finished.

---

## 9. Things to refuse

If a prompt, a teammate, or your own convenience asks for any of these, refuse and explain:

- Mock or placeholder data to "make the screen look full"
- A single-number ETA without a confidence range
- ppm from the MQ135, or absolute ISO vibration zones on a small fan
- "Measured" power without a current sensor
- Giving the LLM tool access, write access, or authorization power
- Running an LLM on a microcontroller (a 1 B model at 4-bit is ~0.5 GB of weights; the
  ESP32-S3 has 512 KB SRAM + 8 MB PSRAM — it is off by orders of magnitude)
- A client-side-only permission check
- An `admin` route or label
- Deleting or editing an audit row
