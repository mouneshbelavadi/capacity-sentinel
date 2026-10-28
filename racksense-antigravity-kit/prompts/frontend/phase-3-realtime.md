# FRONTEND — PHASE 3 · Realtime, provenance, and the honest stale state

> Run `startup.md` first. Phases 1–2 must be working, and backend Phase F (WebSocket) must be
> live. Read `shared/api-contract.md` §12 and §1.

---

## Goal of this phase

Make the dashboards live — and make the UI **honest about how live it actually is**.

The hard part here is not the socket. It is the stale state: when the connection drops, the
numbers on screen are old, and a dashboard that keeps showing them confidently is lying. That
behaviour is the deliverable.

---

## Build

### 1. One WebSocket hook (`src/api/ws.ts`)

There is exactly one. Every feature subscribes through it.

Responsibilities:
- connect to `WS /ws?token=`, subscribe `{racks, metrics}` for the current view,
- reconnect with exponential backoff capped at ~30 s,
- on reconnect, **resync via REST first, then resubscribe** — the server does not replay,
- `ping`/`pong` heartbeat; treat a missing `pong` as a dropped connection,
- expose `connected | reconnecting | stale` plus `lastFrameAt`.

### 2. Never drive React state at sensor rate

Frames arrive as fast as the backend flushes them. **Batch and commit at most every 500 ms.**

Keep incoming frames in a ref-backed buffer; flush on a timer into the store. One commit per
flush, not one per frame. Measure the re-render count and keep it flat as traffic rises — if
adding a second node doubles your renders, the batching is wrong.

### 3. The three connection states, visibly

| State | Header indicator | What happens to the numbers |
|---|---|---|
| `connected` | "Live" + the tick age in seconds | normal |
| `reconnecting` | "Reconnecting…" with the attempt count | values dim, each shows its own age |
| `stale` (no frame > 10 s) | "Last update 48 s ago" | **every value visibly marked stale** |

A stale value is never shown as if it were current. This is the same principle as the
provenance labels: the screen tells the truth about what it knows.

### 4. Per-value freshness

`<Value>` gains an `asOf` treatment: once a value is older than its expected cadence (2 s
telemetry, 10 s forecast), it carries its age. Quietly at first, then prominently past 30 s.

### 5. Provenance, now with live data

Every incoming frame carries `meta`. Render exactly per `shared/design-system.md` §2:

- `measured` → plain, no badge
- `estimated` → dashed outline, 45° hatch, `EST.` badge, formula in the tooltip
- `inferred` → italic, `INFERRED` badge, `basis` string beside it
- `ai_generated` → `AI — ADVISORY` badge on its own surface

Power arrives on `power_estimate` frames and is **always** `estimated`. Its tooltip shows
`P = P_idle + (P_busy − P_idle)·u` with the live inputs. A user must be able to see why a
number exists in one hover.

### 6. Live status and events

- `node_status` → flips a slot to OFFLINE immediately; the slot says "Offline since …".
- `changepoint` → a marker appears on the relevant rack/slot and a toast names it:
  *"Regime change on r1-n1 — forecast window reset."* If `topology_event` is present, the toast
  says the **fact** ("node r2-n1 came online") separately from the statistical shift. Never
  present a known connection as a discovery.
- `audit_append` → a new row arrives in the Recent activity grid (the full audit view lands in
  Phase 6; wire the frame now and buffer it).

### 7. Motion — spend it once

The single orchestrated moment from the design system: on an escalation (OK→WARN→CRIT) the
slot's outline pulses **once**, and that is the entire motion budget. No entrance animations, no
hover transitions on every card. `prefers-reduced-motion: reduce` disables the pulse — the state
change still happens instantly and visibly.

### 8. Subscription follows the view

Changing the selected rack re-subscribes. Unmounting unsubscribes. Do not keep subscriptions
for views nobody is looking at — and never subscribe to "everything" to avoid the bookkeeping.

---

## Skills — apply every one, and report how

Minimum: real-time data UI, information honesty, performance budgeting, accessibility, visual
design identity. See `shared/design-system.md` §7.

---

## Hard rules

- No `Math.random()`, no simulated ticks, no "demo mode" that fabricates frames. If the socket
  is down, the UI says so — it does not keep the dashboard looking alive.
- A stale number is always marked stale.
- `measured` and `estimated` never share a line or an axis.
- Batching at ≤ 500 ms commits; no state update per frame.

---

## Acceptance — show me

1. Warm a real DHT22 → the number moves on screen within 500 ms of the sensor reading.
2. React DevTools profiler: commits stay at ~2/s with one node, and do **not** scale with
   message rate when a second node joins.
3. Pull the backend's network cable → within 10 s the header says "Last update N s ago" and
   every value is marked stale. Reconnect → REST resync, then live again, with no duplicated
   history.
4. Power on a second node → the change-point toast appears, and it separates the known fact
   ("node came online") from the statistical shift.
5. Hover an estimated power value → the formula and its live inputs.
6. `prefers-reduced-motion: reduce` → no pulse, state still changes visibly.
7. A tenant's socket receives nothing for a foreign node, even after you hand-craft a subscribe
   for one in the console.

## Deliver

Code, skills table, the profiler evidence, refreshed `graph.md` and `.agents/context.md`.
Stop here.
