# BACKEND — PHASE A · Ingest spine

> Run `startup.md` first. Do not begin until it printed `STARTUP COMPLETE`.
> Read `shared/api-contract.md` (§1, §3, §4, §15), `shared/architecture.md` (§1, §2),
> `shared/hardware-connections.md`.

---

## Goal of this phase

Get a **real reading from a real sensor** into the database and back out over REST. Nothing
else. No auth yet, no forecasting, no UI.

This is the spine. If it is wrong, every later phase inherits the error — so build it carefully
and resist adding anything that is not on this page.

---

## Target

`backend/` running on the **Arduino UNO Q** (Debian, quad-core Cortex-A53, 2–4 GB RAM).
Treat it as a small Linux box. Python 3.11+, FastAPI, Pydantic v2, SQLite in WAL mode,
Mosquitto as the broker.

---

## Build

### 1. Schema (`db/schema.sql`)

Create these tables. Types and indexes matter — telemetry is the hot path.

| Table | Key columns |
|---|---|
| `sites` | `site_id`, `label` |
| `racks` | `rack_id`, `site_id`, `label`, `row`, `col` |
| `slots` | `slot_id`, `rack_id`, `u_start`, `u_height`, `tenant_id`, `node_id` |
| `tenants` | `tenant_id`, `label`, `contact` |
| `nodes` | `node_id`, `rack_id`, `fw`, `last_seen_at`, `status`, `last_seq` |
| `telemetry` | `node_id`, `metric`, `ts`, `received_at`, `value`, `quality`, `seq`, `backfilled` |
| `audit` | `seq` PK autoincrement, `ts`, `actor`, `event`, `subject_json`, `payload_json`, `prev_hash`, `hash` |
| `baselines` | `node_id`, `metric`, `value`, `captured_at`, `sample_count` |

Index `telemetry` on `(node_id, metric, ts)`. Enable WAL: `PRAGMA journal_mode=WAL;`
Enable `PRAGMA synchronous=NORMAL;` — on this board, FULL is slow and NORMAL is safe with WAL.

The `audit` table gets **no UPDATE and no DELETE path anywhere in the codebase**. Write the
insert function now and never write the others.

### 2. Mosquitto

Config for the UNO Q: listener on 1883, `allow_anonymous false`, one username/password per
node, persistence on. Commit `mosquitto/mosquitto.conf.example`, not the password file.

### 3. MQTT subscriber (`ingest/subscriber.py`)

Subscribe:
```
dc/site-01/+/+/telemetry
dc/site-01/+/+/status
```

Run paho-mqtt on its own loop and hand messages to the asyncio app via a queue. Do not block
the event loop.

### 4. Payload validation (`ingest/validate.py`)

Validate **every** message against the schema in contract §15 before it touches the database.
A malformed message is logged and dropped — never partially stored.

Required: `node`, `seq`, `ts`, `fw`. Optional per fitted sensor: `t_c`, `rh`, `dew_c`,
`mq_ratio`, `mq_warm`, `vib_rms_g`, `vib_peak_g`, `vib_crest`, `shock_count`, `rssi`,
`uptime_s`, `tenant`.

Range-sanity each field (`t_c` −40…85, `rh` 0…100, `mq_ratio` > 0, `vib_rms_g` ≥ 0). A value
outside physical range is a sensor fault, not data — drop it and log.

### 5. Normalisation (`ingest/normalise.py`)

Fan one message out into one `telemetry` row per metric: `(node_id, metric, ts, received_at,
value, quality, seq)`.

- `quality` is `measured` for every sensor field in this phase.
- Store the device `ts` and the server `received_at` **separately**. Rows arriving more than
  10 s after their `ts` are marked `backfilled = 1`.
- `mq_warm: false` → do **not** store `mq_ratio` at all. Store nothing rather than a number the
  sensor cannot justify.

### 6. Presence and gaps

- MQTT LWT `offline` / connect `online` on `dc/.../status` → update `nodes.status` and write
  `NODE_OFFLINE` / `NODE_ONLINE` audit rows. This is a **known fact**, not an inference.
- `seq` jumping by more than 1 → write a `TELEMETRY_GAP` audit row with the missing count.

### 7. Audit chain (`services/audit.py`)

`hash = SHA256(prev_hash || canonical_json(row_without_hash))` where canonical JSON is sorted
keys, no whitespace, UTF-8. Genesis `prev_hash = "0" * 64`. Insert-only, under a single writer
lock so the chain cannot interleave.

### 8. Routes (`api/`)

Implement exactly these, exactly as the contract specifies them:

```
GET /api/meta                            → contract_version, server_time, site_id
GET /api/topology                        → racks/slots/nodes  (unscoped for now — Phase B scopes it)
GET /api/nodes/{node_id}/telemetry       → ?metric=&from=&to=&step=
GET /api/racks/{rack_id}/summary         → status + worst_margin (margins land properly in Phase C;
                                            for now return the raw latest value with its meta)
```

Every numeric response is wrapped with `meta: {quality, source, model, uncertainty_pct, as_of}`
as in contract §1. Start as you mean to continue — do not add `meta` later.

### 9. Seeding — by hand, with real values

Write `tools/seed_topology.py` that reads a **human-edited YAML file** describing the actual
racks, slots, tenants and node IDs on your bench. It must not invent anything. No random
tenants, no generated node names.

Committed example: `tools/topology.example.yaml`. The real one is gitignored.

---

## Hard rules for this phase

- **No fake data.** No seeded telemetry rows, no `random`, no default values standing in for
  readings. If a node has not reported, `/telemetry` returns an empty `points` array — not
  zeros, not a plausible curve.
- **Never store a number the sensor cannot justify** (see `mq_warm`).
- **No `admin`** anywhere.
- Structured JSON logging with `request_id`. Never log credentials.
- Secrets in `.env`, gitignored, with a committed `.env.example`.

---

## Acceptance — show me these, in this order

1. `mosquitto_pub` a hand-written valid payload → a row appears in `telemetry` with correct
   `quality` and both timestamps.
2. A malformed payload → logged, dropped, **nothing** in the database.
3. A real ESP32 node powered on → `GET /api/nodes/r1-n1/telemetry?metric=t_c` returns real
   DHT22 values.
4. Pull the node's power → within the keepalive window, `nodes.status` goes `offline` and a
   `NODE_OFFLINE` audit row exists.
5. Skip a `seq` deliberately → a `TELEMETRY_GAP` row exists with the right count.
6. `GET /api/meta` returns `contract_version: "1.0.0"`.
7. The audit chain verifies by hand: recompute row N's hash from row N−1 and it matches.

---

## Deliver

- The code, running on the UNO Q.
- `backend/README.md`: how to start Mosquitto and uvicorn, env vars, how to seed topology.
- `.env.example`, `mosquitto/mosquitto.conf.example`, `tools/topology.example.yaml`.
- Refresh `graph.md` and `.agents/context.md`. State "contract unchanged" or what changed.

Stop here. Do not start Phase B.
