# FRONTEND — PHASE 2 · Topology, the two dashboards, isolation made visible

> Run `startup.md` first. Phase 1 must be working.
> Read `shared/api-contract.md` §3–§4, `shared/tenant-isolation.md`, `shared/design-system.md` §4.

---

## Goal of this phase

Turn `GET /api/topology` into the two dashboards, and make **tenant isolation something a judge
can see**, not something you claim in a slide.

Still no live data (Phase 3), no charts (Phase 4), no 3D (Phase 5). Static fetches only.

---

## Build

### 1. Data Center Dashboard — `/datacenter`

Roles: `OPERATOR`, `SUPER_USER`. Title: **Data Center Dashboard**.

- **Left rail**: rack list with per-rack status, tenant filter, metric filter. Selecting a rack
  scopes the centre and right column.
- **Centre**: for this phase, a flat 2D rack grid — each rack a `<Panel>` containing its slots
  as a vertical strip of cells. Phase 5 replaces this with the 3D hall; keep the component
  boundary clean so the swap is one import.
- Each slot cell shows: U position, tenant label, node ID, `<StatusBadge>`.
- **Right column**: rack summary — worst margin with its `limit_source` ("ASHRAE 27 °C"), nodes
  online / total.
- **Bottom**: a "Recent activity" `<Card>` holding a `<DataTable>`, still `<EmptyState>` until
  Phase 6 fills it.

### 2. Tenant Dashboard — `/tenant`

Role: `TENANT`. Title: **Tenant Dashboard**.

Same shell, same components, scoped data. The important detail:

> A tenant still sees the **full rack geometry** — so the hall renders and they understand where
> they sit — but every slot they do not own arrives as `tenant_id: null`, `node_id: null`,
> `status: "UNKNOWN"`.

Render those foreign slots as a distinct, obviously-not-data treatment: the hatch fill from the
design system at low opacity, no label, no status colour, and the text **"Not your slot"**.

It must be visually unmistakable that the tenant is not being shown a neighbour's condition —
not greyed-out-looking-like-OK, and not an empty cell that could be read as "fine".

### 3. Slot and node detail

Clicking a slot opens a detail panel: node ID, firmware, last seen, fitted sensors, current
values via `<Value>` with the right provenance treatment, and the baseline status per metric
("baseline captured 12 min ago, 340 samples" or "no baseline — no forecast available").

For a metric with no baseline, say exactly that. Do not show a status.

### 4. Status derivation lives on the server

The UI renders `status` from the API. It does **not** compute status from a raw value with a
threshold in the frontend. If you find yourself writing `if (temp > 27)` in a component, stop —
that logic belongs in the backend and duplicating it guarantees the two will disagree.

### 5. Empty, loading, stale and error — designed, not bolted on

| State | What the user sees |
|---|---|
| Loading | Skeleton panels that match the real layout, not a spinner over blank space |
| Empty (no nodes yet) | "No nodes reporting. Nodes publish every 2 seconds once they connect." |
| Metric with no baseline | "No baseline captured. Capture one to enable status and forecasting." |
| Sensor warming up (`SENSOR_WARMING_UP`) | "Warming up — the MQ135 needs its preheat before any reading is meaningful." **Never a number.** |
| `NOT_FOUND` | "That node isn't in your view." No hint that it exists elsewhere. |
| Any other contract code | Its specific message from `<ErrorState>` |

There is **no** generic "Something went wrong" that swallows a known code.

### 6. The isolation demo view

Build this deliberately, because you will use it on stage:

A **"Prove isolation"** control in the Data Center Dashboard (operator only) that opens a split
view: the same rack as the operator sees it, beside the same rack as a tenant token sees it,
fetched live with both tokens. Side by side, the redaction is obvious.

This is not a mock. It makes two real requests with two real tokens and shows two real
responses. If it ever showed a hand-written "tenant view", it would be worthless.

---

## Skills — apply every one, and report how

Minimum for this phase: visual design identity, information architecture, error & empty-state
design, accessibility, information honesty, design tokens. See `shared/design-system.md` §7.

Specifically:
- Structure encodes information: the slot strip's visual order is the real U order in the rack.
  Do not add numbered markers (01 / 02 / 03) to things that are not sequences.
- Status is never colour alone — every badge carries an icon and a letter.
- Tabular figures on every number that can change.

---

## Hard rules

- No mock topology. If the backend returns nothing, the screen says so.
- No threshold logic in the frontend.
- No `admin` anywhere.
- Foreign slots must be unmistakably "not shown to you", never ambiguously "fine".

---

## Acceptance — show me

1. Operator and tenant, two windows, the same rack. The tenant's foreign slots are hatched and
   labelled "Not your slot".
2. In the tenant's devtools, `fetch('/api/nodes/<foreign-node>/telemetry')` → **404**, and the
   UI renders "That node isn't in your view" — with no hint the node exists.
3. The "Prove isolation" split view, live, with two real tokens.
4. A node with no baseline → "No baseline captured", no status, no invented number.
5. An MQ135 still warming → "Warming up", no number.
6. Kill the backend → every panel shows a real error state, nothing renders zeros.
7. Keyboard-only navigation through rail → rack → slot → detail.

## Deliver

Code, skills table, refreshed `graph.md` and `.agents/context.md`. Stop here.
