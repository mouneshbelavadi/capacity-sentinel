# RackSense — API Contract v1.0.0

**This file is the single source of truth shared by the backend and the frontend.**

Both the Backend prompt and the Frontend prompt embed this contract verbatim. They are
*face-to-face*: the frontend may assume nothing that is not written here, and the backend
may return nothing that is not written here.

> **Contract rule.** If you need to change anything in this file, you must:
> 1. bump `CONTRACT_VERSION` (semver),
> 2. edit this file,
> 3. update **both** sides in the same change,
> 4. append a row to the Changelog at the bottom.
>
> Never let one side drift. A frontend that invents a field, or a backend that renames one,
> is a contract break and must be fixed in this file first.

`CONTRACT_VERSION = 1.0.0`

The backend exposes the running contract version at `GET /api/meta`. The frontend reads it on
boot and shows a hard, blocking banner if the major version does not match the one it was
built against.

---

## 0. Vocabulary (use these exact words everywhere — UI, code, logs)

| Term | Meaning |
|---|---|
| **Site** | One facility. Demo has one: `site-01`. |
| **Rack** | A physical rack. `rack-01`, `rack-02`. |
| **Slot** | A position in a rack that a tenant rents. |
| **Node** | A physical sensor board reporting telemetry. Mapped to exactly one slot. |
| **Tenant** | A customer renting one or more slots. Sees only their own slots. |
| **Metric** | A measured or derived quantity (`t_c`, `rh`, `dew_c`, `mq_ratio`, `vib_rms_g`, `power_w`). |
| **Margin** | Distance from a metric to its limit. The thing that "runs out". |
| **Forecast** | A distribution over *when* a metric crosses its limit. Never a single number. |
| **Change point** | A detected regime shift that invalidates the current forecast window. |
| **Proposal** | An action suggested by the AI. Advisory. Never self-executing. |
| **Authorization** | A human approval completed by an RFID tap. The only way a proposal leaves `PROPOSED`. |

### Dashboard naming (hard requirement)

- The all-servers view is called the **Data Center Dashboard**.
- The scoped view is called the **Tenant Dashboard**.
- The word **"Admin"** must not appear in any route, component name, label, page title, or
  log line. The elevated role is named `SUPER_USER` and is shown to humans as **"Super User"**.

---

## 1. Data provenance — every number carries its origin

This is the project's core honesty rule and it lives in the contract, not in a style guide.

Every numeric value the API returns for display is wrapped with a `meta` object:

```json
{
  "value": 24.61,
  "unit": "C",
  "meta": {
    "quality": "measured",
    "source": "node:r1-n1:dht22",
    "model": null,
    "uncertainty_pct": null,
    "as_of": "2026-10-28T10:04:02Z"
  }
}
```

`quality` is a closed enum. There are exactly four values:

| `quality` | Means | Example | UI treatment (frontend must honour) |
|---|---|---|---|
| `measured` | A sensor physically read it. | DHT22 temperature | Solid value, no badge |
| `estimated` | Computed from a declared model, not sensed. | Power from CPU utilisation | Dashed outline + `EST.` badge + model name in tooltip |
| `inferred` | A correlation or mapping, not an observation. | Tenant attribution of a trend | Italic + `INFERRED` badge |
| `ai_generated` | Written by the LLM. | Explanations, proposals | `AI — ADVISORY` badge, distinct surface |

Rules that both sides enforce:

- A `measured` series and an `estimated` series **must never be drawn on the same line**.
- The backend must never return `quality: "measured"` for a value it did not read from a sensor.
- Power is **always** `estimated` in this build (there is no current sensor). If an INA219 is
  added later, only values read from it may become `measured`, and the `source` must say
  `node DC rail`, never "server power".
- Synthetic/backfill rows carry `"source": "synthetic:<dataset-id>"` and are visually separated
  from live data.

---

## 2. Auth, roles and tenant isolation

### Roles

| Role | Scope | Can approve proposals | Can manage tenants/users/RFID |
|---|---|---|---|
| `TENANT` | Only slots owned by their `tenant_id` | No | No |
| `OPERATOR` | All slots in the site | Yes | No |
| `SUPER_USER` | All slots in the site | Yes | Yes |

### Isolation is enforced server-side. Always.

- Every authenticated request resolves a **scope** from the JWT: `{role, tenant_id}`.
- Every query that touches telemetry, forecasts, change points, proposals or audit rows is
  filtered by that scope **in the data access layer**, not in the route handler and never in
  the frontend.
- There is exactly one function that builds the scope filter. Every query calls it. A query
  that bypasses it is a bug, and the test suite must contain a test that fails if any new
  query omits it.
- A `TENANT` requesting a node they do not own gets **`404 NOT_FOUND`**, not `403`. Returning
  `403` leaks the existence of the resource. This is deliberate — do not "fix" it.
- WebSocket subscriptions are scoped at subscribe time. A `TENANT` socket never receives a
  frame for another tenant's node, even if the frontend asks for it.

### Endpoints

```
POST /api/auth/login
  body:  { "username": string, "password": string }
  200:   { "access_token": string, "token_type": "bearer", "expires_in": number,
           "role": "TENANT"|"OPERATOR"|"SUPER_USER",
           "tenant_id": string|null, "display_name": string }

GET  /api/auth/me
  200:   { "user_id": string, "role": ..., "tenant_id": string|null, "display_name": string }

GET  /api/meta
  200:   { "contract_version": "1.0.0", "server_time": iso8601, "site_id": string }
```

All other endpoints require `Authorization: Bearer <token>`.

---

## 3. Topology

```
GET /api/topology
  200: {
    "site_id": "site-01",
    "racks": [
      {
        "rack_id": "rack-01",
        "label": "Rack 01",
        "position": { "row": 0, "col": 0 },
        "slots": [
          {
            "slot_id": "rack-01-u12",
            "u_start": 12, "u_height": 2,
            "tenant_id": "t-alpha",          // null when unlet
            "tenant_label": "Alpha Systems", // null when unlet or out of scope
            "node_id": "r1-n1",              // null when no node installed
            "status": "OK"|"WARN"|"CRIT"|"OFFLINE"|"UNKNOWN"
          }
        ]
      }
    ]
  }
```

Scope behaviour: a `TENANT` receives the full rack geometry (so the 3D hall still renders)
but every slot they do not own has `tenant_id: null`, `tenant_label: null`, `node_id: null`,
`status: "UNKNOWN"`. They cannot tell who their neighbour is or how that neighbour is doing.

```
GET /api/tenants                       # SUPER_USER only, else 404
  200: { "tenants": [ { "tenant_id","label","slot_count","contact" } ] }
```

---

## 4. Telemetry

```
GET /api/nodes/{node_id}/telemetry?metric=t_c&from=<iso>&to=<iso>&step=10s
  200: {
    "node_id": "r1-n1",
    "metric": "t_c",
    "unit": "C",
    "step_s": 10,
    "points": [ { "ts": iso8601, "value": 24.61 } ],
    "meta": { "quality": "measured", "source": "node:r1-n1:dht22", "as_of": iso8601 }
  }
```

`metric` is one of:

| key | unit | quality | sensor |
|---|---|---|---|
| `t_c` | `C` | measured | DHT22 |
| `rh` | `%` | measured | DHT22 |
| `dew_c` | `C` | measured | derived from DHT22 (Magnus), still a measurement of air state |
| `mq_ratio` | `ratio` | measured | MQ135 `Rs/R0`, relative only — **never ppm** |
| `vib_rms_g` | `g` | measured | MPU6050 window RMS |
| `vib_crest` | `ratio` | measured | peak / RMS |
| `shock_count` | `count` | measured | SW-420 events in window |
| `power_w` | `W` | **estimated** | CPU-utilisation model |

```
GET /api/racks/{rack_id}/summary
  200: {
    "rack_id": "rack-01",
    "status": "OK"|"WARN"|"CRIT",
    "worst_margin": {
      "metric": "t_c", "node_id": "r1-n1",
      "value": { "value": 2.4, "unit": "C", "meta": {...} },
      "limit": 27.0, "limit_source": "ASHRAE TC9.9 recommended inlet upper"
    },
    "nodes_online": 2, "nodes_total": 3
  }
```

---

## 5. Forecast — a distribution, never a single ETA

```
GET /api/forecast/{node_id}/{metric}
  200: {
    "forecast_id": "fc_0193",
    "node_id": "r1-n1",
    "metric": "t_c",
    "limit": 27.0,
    "limit_source": "ASHRAE TC9.9 recommended inlet upper bound",
    "model": "ets_damped_additive",
    "window_start": iso8601,
    "window_reason": "changepoint:cp_0042" | "cold_start" | "rolling_30m",
    "horizon_s": 7200,
    "history":  [ { "ts": iso, "value": 24.1 } ],
    "median":   [ { "ts": iso, "value": 25.2 } ],
    "p10":      [ { "ts": iso, "value": 24.8 } ],
    "p90":      [ { "ts": iso, "value": 25.9 } ],
    "crossing": {
      "has_trend": true,
      "p10_s": 180, "p50_s": 360, "p90_s": 660,
      "no_breach_fraction": 0.12
    },
    "slope": { "value": 0.014, "unit": "C/s", "ci_low": 0.009, "ci_high": 0.019 },
    "calibration": { "nominal": 0.80, "empirical_coverage": 0.74, "widen_factor": 1.18 },
    "meta": { "quality": "estimated", "model": "ets_damped_additive",
              "uncertainty_pct": null, "as_of": iso8601 }
  }
```

Hard rules both sides honour:

- When `crossing.has_trend` is `false` (the slope CI contains zero), the backend returns
  `p10_s/p50_s/p90_s` as `null` and the frontend renders the words
  **"No sustained trend — no exhaustion forecast"**. It must not draw a cone or invent an ETA.
- `no_breach_fraction` is the share of simulated paths that never crossed inside the horizon.
  The frontend must display it (e.g. "62% of scenarios: no breach within 2 h"). Hiding it
  turns an honest forecast into a scary one.
- `horizon_s` is capped by the backend at 3× the fitted window length. The frontend must not
  extrapolate the returned series further.
- The frontend renders the cone as a **P10–P90 band**, the median as a line, the limit as a
  reference line, and the crossing-time window as a shaded vertical region.

---

## 6. Change points

```
GET /api/changepoints?node_id=r1-n1&since=<iso>
  200: { "changepoints": [ {
           "cp_id": "cp_0042",
           "node_id": "r1-n1", "metric": "t_c",
           "detected_at": iso8601, "located_at": iso8601,
           "detector": "cusum+pelt",
           "confirmed": true,
           "shift": { "before_mean": 23.9, "after_mean": 25.4, "delta": 1.5 },
           "topology_event": { "type": "node_online", "node_id": "r2-n1" } | null,
           "meta": { "quality": "measured", ... }
         } ] }
```

- `topology_event` is present when a node connecting or disconnecting (MQTT LWT) coincides
  within ±60 s. That is a **known** event, not a statistical discovery — the UI says
  *"node r2-n1 came online"* as fact, and keeps the statistical shift separate.

---

## 7. Attribution — always labelled `inferred`

```
GET /api/attribution/{rack_id}?metric=t_c
  200: { "rack_id": "rack-01", "metric": "t_c",
         "contributors": [ {
            "tenant_id": "t-beta", "tenant_label": "Beta Compute",
            "share": 0.71,
            "basis": "slope increased 3.1x within 40s of tenant node r2-n1 coming online",
            "meta": { "quality": "inferred", ... }
         } ] }
```

Never `measured`. The UI always shows the `basis` string next to the share.

---

## 8. Power — always estimated

```
GET /api/power/{node_id}
  200: { "node_id": "r1-n1",
         "value": { "value": 1.08, "unit": "W",
           "meta": { "quality": "estimated",
                     "source": "model",
                     "model": "linear-cpu-v1",
                     "uncertainty_pct": 30,
                     "as_of": iso8601 } },
         "model_detail": {
           "formula": "P = P_idle + (P_busy - P_idle) * u",
           "p_idle_w": 0.4, "p_busy_w": 1.4, "u": 0.68,
           "calibrated": false,
           "reference": "Fan, Weber & Barroso (ISCA 2007); UNO Q idle/load figures from independent bench tests"
         } }
```

The frontend must render the formula in the tooltip. A user must be able to see *why* a
number exists in one hover.

---

## 9. AI — advisory only, never an actor

The LLM never computes a number and never authorizes anything. It reads values the backend
already computed and writes prose plus a structured proposal.

```
POST /api/ai/summarize       body { "scope": "site"|"rack"|"node", "id": string }
  200: { "text": string, "status_hint": "OK"|"WARN"|"CRIT",
         "evidence": ["fc_0193","cp_0042"],
         "meta": { "quality": "ai_generated", "model": "<provider/model>", "as_of": iso } }

POST /api/ai/explain         body { "forecast_id": string }
  200: same envelope as summarize

POST /api/ai/propose         body { "node_id"|"rack_id": string }
  201: Proposal   (see schema below, created with status "PROPOSED")
```

### Proposal schema

```json
{
  "proposal_id": "pr_0007",
  "created_at": "2026-10-28T10:05:11Z",
  "scope": { "rack_id": "rack-01", "node_id": "r1-n1", "tenant_id": "t-beta" },
  "action": "REDUCE_TENANT_LOAD",
  "target": "t-beta",
  "rationale": "…",
  "expected_effect": "…",
  "evidence": ["fc_0193", "cp_0042"],
  "risk_tier": "LOW" | "MEDIUM" | "HIGH",
  "status": "PROPOSED" | "DISCUSSING" | "APPROVED_PENDING_TAP" | "AUTHORIZED" | "REJECTED" | "EXPIRED",
  "meta": { "quality": "ai_generated", "model": "<provider/model>", "as_of": "…" }
}
```

`action` is a **closed whitelist**. The backend rejects anything else and logs the rejection:

```
REDUCE_TENANT_LOAD | MIGRATE_TENANT | INSPECT_FAN | INCREASE_COOLING_SETPOINT_REQUEST
| SCHEDULE_MAINTENANCE | NO_ACTION
```

Every `evidence` ID must be one the backend supplied in the prompt. A response citing an
unknown ID is discarded and logged as `AI_EVIDENCE_INVALID`. The LLM cannot invent evidence.

### Discussion before approval (the "talk to the AI first" step)

```
POST /api/ai/chat
  body: { "proposal_id": "pr_0007", "message": "why not migrate instead?" }
  200:  { "reply": string, "proposal_revision": Proposal|null,
          "meta": { "quality": "ai_generated", ... } }
```

Discussing moves the proposal to `DISCUSSING`. A revision replaces the proposal's fields but
keeps `proposal_id` and appends an audit row. **Discussion never changes status to approved.**

---

## 10. The approval → RFID authorization flow

This is the heart of the project. The state machine lives **only** on the server.

```
PROPOSED ──(human discusses)──> DISCUSSING ──┐
   │                                         │
   └──────── (human clicks "Proceed") ───────┴──> APPROVED_PENDING_TAP
                                                      │  nonce issued, TTL 60s,
                                                      │  bound to (proposal_id, reader_device_id)
                            ┌─────────────────────────┼──────────────────────┐
                            ▼                         ▼                      ▼
                     valid tap → AUTHORIZED     TTL elapsed → EXPIRED   human → REJECTED
```

### Operator-facing

```
POST /api/proposals/{id}/approve      # OPERATOR or SUPER_USER only
  200: { "proposal_id": "pr_0007",
         "status": "APPROVED_PENDING_TAP",
         "nonce": "…",                      # opaque, single use
         "expires_at": iso8601,             # now + 60s
         "reader_device_id": "reader-01" }

POST /api/proposals/{id}/reject
  200: { "proposal_id": "pr_0007", "status": "REJECTED" }

GET  /api/proposals?status=PROPOSED,DISCUSSING,APPROVED_PENDING_TAP
  200: { "proposals": [ Proposal ] }        # scoped
```

A `TENANT` can read proposals for their own slots and can use `/api/ai/chat`, but
`POST /approve` returns `404` for them.

### Device-facing (the ESP32-S3 auth console)

The reader is **dumb on purpose**. It cannot arm itself and holds no authority.

```
GET  /api/reader/{device_id}/pending
  200: { "armed": false } 
     | { "armed": true,
         "proposal_id": "pr_0007",
         "nonce": "…",
         "expires_at": iso8601,
         "expires_in_s": 47,                # seconds remaining AT RESPONSE TIME
         "action": "REDUCE_TENANT_LOAD",
         "target": "t-beta",
         "line1": "REDUCE LOAD",            # pre-rendered ASCII for the TFT
         "line2": "Tenant: Beta Compute",
         "risk_tier": "MEDIUM" }
```

`expires_in_s` exists so the reader never has to parse ISO 8601 or trust its own clock for the
countdown — it extrapolates locally between polls and resyncs on every response. `expires_at`
remains the authoritative value for the dashboard.
```

POST /api/reader/{device_id}/tap
  body: { "uid": "04A2B3C4D5",              # RFID UID, uppercase hex, no separators
          "nonce": "…",
          "ts": 1761650000,                 # unix seconds, device clock (NTP synced)
          "hmac": "…" }                     # hex HMAC-SHA256 over "device_id|uid|nonce|ts"
                                            # key = per-device shared secret
  200: { "result": "AUTHORIZED",
         "proposal_id": "pr_0007",
         "actor": "Mounesh E Belavadi",
         "audit_hash": "9f2c…",             # head hash, printed on the TFT
         "message": "Authorized" }
  200: { "result": "REJECTED", "reason": "UID_NOT_AUTHORIZED", "message": "Card not registered" }

POST /api/reader/{device_id}/heartbeat
  body: { "fw": "0.3.1", "rssi": -54, "uptime_s": 8123 }
  200: { "server_time": 1761650001 }
```

Server-side checks on every tap, in this order. Any failure → `REJECTED` + audit row:

1. `device_id` is registered → else `DEVICE_UNKNOWN`
2. `hmac` valid for that device's secret → else `HMAC_INVALID`
3. `|server_now - ts| <= 120s` → else `CLOCK_SKEW`
4. `nonce` exists, unconsumed, unexpired, bound to this `device_id` → else `NONCE_EXPIRED` / `NONCE_CONSUMED`
5. `uid` in allowlist, and that user's role may authorize this `risk_tier` → else `UID_NOT_AUTHORIZED`
6. Mark nonce consumed **atomically** (single UPDATE … WHERE consumed_at IS NULL), then
   set proposal `AUTHORIZED`.

Known limitation to state on stage: an RFID **UID is a public identifier, not a secret** —
"magic" cards can clone one. The tap is the *second* factor after dashboard approval, scoped
by a single-use nonce with a 60 s TTL. Production would use DESFire EV2/EV3 or NTAG 424 DNA
with AES challenge–response, plus TLS.

---

## 11. Audit — append-only, hash-chained

```
GET /api/audit?from=<iso>&to=<iso>&limit=200          # scoped
  200: { "rows": [ {
           "seq": 1842,
           "ts": iso8601,
           "actor": "system" | "user:<id>" | "ai" | "reader:<device_id>",
           "event": "TELEMETRY_GAP" | "CHANGE_POINT" | "FORECAST_ISSUED"
                  | "AI_PROPOSAL" | "AI_EVIDENCE_INVALID" | "PROPOSAL_APPROVED"
                  | "TAP_AUTHORIZED" | "TAP_REJECTED" | "NODE_ONLINE" | "NODE_OFFLINE"
                  | "SCOPE_DENIED",
           "subject": { "node_id": "...", "proposal_id": "..." },
           "payload": { ... },
           "prev_hash": "…",
           "hash": "…"
         } ] }

GET /api/audit/verify
  200: { "ok": true, "rows_checked": 1842, "head_hash": "9f2c…", "broken_at": null }
     | { "ok": false, "rows_checked": 1842, "head_hash": "…", "broken_at": 903 }
```

`hash = SHA256(prev_hash || canonical_json(row_without_hash))`, canonical JSON = sorted keys,
no whitespace, UTF-8. Genesis row has `prev_hash = "0"*64`.

The audit table has **no UPDATE and no DELETE path in the codebase.** Writes are insert-only.

---

## 12. WebSocket

```
WS /ws?token=<jwt>
```

Server → client frames. Every frame is `{ "type": ..., "ts": iso8601, "data": {...} }`:

| `type` | `data` |
|---|---|
| `telemetry` | `{ node_id, metric, value, unit, meta }` |
| `node_status` | `{ node_id, status: "online"\|"offline", rssi }` |
| `changepoint` | the change point object from §6 |
| `forecast_update` | the forecast object from §5 (may be partial: `forecast_id` + `crossing`) |
| `proposal_update` | the proposal object from §9 |
| `audit_append` | `{ seq, event, hash }` (never the full payload — the activity grid fetches detail on click) |
| `power_estimate` | `{ node_id, value, unit, meta }` |

Client → server frames:

| `type` | `data` |
|---|---|
| `subscribe` | `{ "racks": ["rack-01"], "metrics": ["t_c","vib_rms_g"] }` |
| `ping` | `{}` → server replies `pong` |

Rules:
- The server **re-validates scope on every subscribe and on every outbound frame.** A token's
  scope is never trusted from the client's subscribe list alone.
- Telemetry frames are batched and flushed at **500 ms** max rate per node, even if MQTT
  delivers faster. The UI must never be driven at sensor rate.
- On reconnect the client calls the REST endpoints to resync, then resubscribes. The server
  does not replay missed frames.

---

## 13. Errors

Every non-2xx response:

```json
{ "error": { "code": "NONCE_EXPIRED", "message": "Approval window elapsed", "detail": {} } }
```

Closed code list:

```
UNAUTHENTICATED | FORBIDDEN | NOT_FOUND | VALIDATION_ERROR | CONTRACT_VERSION_MISMATCH
NONCE_EXPIRED | NONCE_CONSUMED | UID_NOT_AUTHORIZED | DEVICE_UNKNOWN | HMAC_INVALID | CLOCK_SKEW
AI_EVIDENCE_INVALID | AI_ACTION_NOT_WHITELISTED | AI_UNAVAILABLE
FORECAST_INSUFFICIENT_DATA | SENSOR_WARMING_UP | RATE_LIMITED | INTERNAL
```

The frontend has a rendering branch for **every** code above. No generic "Something went
wrong" fallback that swallows a known code.

---

## 14. Timing budget (both sides must meet these)

| Path | Budget |
|---|---|
| MQTT message → stored in DB | ≤ 250 ms |
| MQTT message → WebSocket frame at the browser | ≤ 500 ms |
| `GET /api/topology` | ≤ 150 ms |
| `GET /api/forecast/...` (cached) | ≤ 200 ms |
| Forecast recompute (ETS + 1000 sims) | ≤ 2 s, off the request path, cached |
| `POST /api/proposals/{id}/approve` | ≤ 300 ms |
| Reader poll → armed action visible on TFT | ≤ 1.5 s |
| Tap → `AUTHORIZED` on screen | ≤ 1 s |
| Browser frame rate with 3D hall + live data | ≥ 50 fps on an integrated GPU |

Forecasts are computed on a background scheduler, never inside a request handler.

---

## 15. MQTT contract (hardware ↔ backend)

Broker: Mosquitto on the Arduino UNO Q. Nodes publish QoS 0.

```
dc/{site}/{rack}/{node}/telemetry      # JSON, every 2000 ms
dc/{site}/{rack}/{node}/status         # retained; LWT payload "offline"; "online" on connect
dc/{site}/{rack}/{node}/cmd            # server → node; display text only, NEVER authorization
```

Telemetry payload (fields absent when that sensor is not fitted on the node):

```json
{
  "node": "r1-n1", "tenant": "t-alpha", "seq": 1834,
  "ts": 1761650000, "fw": "0.3.1",
  "t_c": 24.61, "rh": 41.2, "dew_c": 10.4,
  "mq_ratio": 1.07, "mq_warm": true,
  "vib_rms_g": 0.0121, "vib_peak_g": 0.0440, "vib_crest": 3.63,
  "shock_count": 0,
  "rssi": -54, "uptime_s": 8123
}
```

- `seq` increases by 1 per publish and lets the server detect gaps → `TELEMETRY_GAP` audit row.
- `ts` is the **device** clock (NTP synced at boot). The server stores `received_at` separately
  and marks backfilled rows.
- `mq_warm: false` means the MQ135 has not finished preheating. While false the backend returns
  `SENSOR_WARMING_UP` for `mq_ratio` and the UI shows "warming up", never a number.
- Buffered rows replayed after a reconnect keep their original `ts` and are flagged `backfilled`.

---

## Changelog

| Version | Date | Change |
|---|---|---|
| 1.0.0 | 2026-10-28 | Initial contract. |
