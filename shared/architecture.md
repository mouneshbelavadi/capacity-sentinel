# RackSense — Architecture & Analysis Methods

Problem statement: **AO-02 — "Seeing trouble before the capacity runs out."**
Team: Maverick Marvels · Team ID HM3-P-00493-03 · Domain: AI & Ops.

One sentence: *a rack capacity early-warning system that says which resource runs out, when,
and why — with honest confidence, and with every AI suggestion gated behind a physical RFID
approval.*

---

## 1. The four layers

```
┌── LAYER 4 — PRESENTATION ───────────────────────────────────────────────────┐
│  Browser on the laptop.                                                      │
│  Data Center Dashboard (all racks)  ·  Tenant Dashboard (own slots only)     │
│  Live 3D rack hall · forecast cones · evidence panel · AI proposal card      │
│  · approval flow · hash-chained audit activity grid                          │
└──────────────────────────▲──────────────────────────────────────────────────┘
                           │  REST (resync) + WebSocket (live, ≤500 ms)
┌──────────────────────────┴── LAYER 3 — BRAIN ───────────────────────────────┐
│  Runs on the Arduino UNO Q (Debian, quad Cortex-A53).                        │
│  FastAPI  ·  scope/RBAC filter  ·  forecaster (ETS + simulation)             │
│  ·  CUSUM→PELT change-point  ·  attribution  ·  power estimator              │
│  ·  proposal state machine  ·  nonce issuer  ·  hash-chained audit writer    │
│  Calls the CLOUD LLM for advisory text only. The LLM never decides.          │
└──────────────────────────▲──────────────────────────────────────────────────┘
                           │  SQLite (WAL) telemetry  ·  audit chain
                           │  pgvector / numpy cosine for RAG
┌──────────────────────────┴── LAYER 2 — INGEST ──────────────────────────────┐
│  Mosquitto MQTT broker on the UNO Q.                                         │
│  Normalises every message to (ts, node, metric, value, quality, seq)         │
│  LWT presence → node online/offline is a KNOWN event, not a guess            │
└──────────────────────────▲──────────────────────────────────────────────────┘
                           │  MQTT over Wi-Fi, QoS 0, 2 s cadence
┌──────────────────────────┴── LAYER 1 — SENSING ─────────────────────────────┐
│  ESP32 dev module   → DHT22 (temp/RH) + MQ135 (air ratio) + SW-420 (shock)   │
│  ESP32-S3 #2        → MPU6050 (vibration RMS / peak / crest)                 │
│  ESP32-S3 #1        → RC522 RFID + ILI9488 TFT  (authorization console)      │
│  UNO Q itself       → its own CPU/RAM/thermals = the only real compute signal│
└──────────────────────────────────────────────────────────────────────────────┘

   Telemetry arrows point UP only. Nothing in this system writes to a facility control.
```

---

## 2. What each sensor legitimately represents

Every metric is either a **margin against a cited limit** or a **ratio to its own baseline**.
Nothing is dressed up as something it is not.

| Sensor | Represents | Limit / basis | Honesty note |
|---|---|---|---|
| DHT22 temp | Cooling capacity / inlet thermal headroom | ASHRAE TC 9.9 recommended inlet upper bound **27 °C** (allowable A1 15–32 °C). Margin = 27 − T | ±0.5 °C, response up to ~10 s, min 2 s between reads |
| DHT22 RH → dew point | Condensation / ESD risk | Dew point envelope ≈ −9 … 15 °C (cited as primary; RH caps differ between secondary sources) | Derived via Magnus formula |
| MQ135 | Air-quality drift: off-gassing from overheating insulation, smoke, filter loading | **Relative `Rs/R0`** against a clean-air baseline | Needs >24 h preheat. Broad cross-sensitivity. **Never report ppm.** |
| MPU6050 | Fan bearing wear, imbalance, rack mechanical health | **Baseline-relative**: WARN at 2× commissioning RMS, CRIT at 4× | ISO 10816/20816 absolute zones are for 15 kW–300 kW machines and **do not apply** to a small fan |
| SW-420 | Discrete shock events (door slam, rack bump) | Events per minute | It is a spring switch + comparator. Binary only. It cannot measure amplitude. |
| UNO Q CPU/RAM | Compute capacity headroom on the edge server | Real utilisation | The only genuinely measured *compute* capacity in the build |
| Power | Electrical headroom | **Estimated** from CPU utilisation | No current sensor fitted. Always labelled `estimated`. |

---

## 3. Forecasting — "runs out in X (Y–Z)"

**Method: sliding-window damped-trend exponential smoothing, simulated to a crossing-time
distribution.** Rejected: Prophet (built for daily/weekly business seasonality, heavy, poor on
hours of 0.5 Hz data) and seasonal SARIMAX (you cannot observe two daily cycles in a hackathon).

Pipeline per (node, metric):

1. **Resample** raw 2 s readings to fixed 10 s means. Keep a sliding window — default last
   30 min, **reset to the most recent confirmed change point** when one exists.
2. **Robust trend check first.** Fit Theil–Sen (or Huber) on the window. If the slope's 95 %
   CI contains zero → `has_trend = false`, return no ETA, and the UI says
   *"No sustained trend — no exhaustion forecast."* This single rule kills most nonsense output.
3. **Fit ETS** (`statsmodels.tsa.exponential_smoothing.ets.ETSModel`, additive error, additive
   **damped** trend, no seasonality).
4. **Simulate** 1000 paths from the end of the window over the horizon.
5. For each path record the **first step that crosses the limit**. The P10 / P50 / P90 of those
   crossing times is the published "runs out in X (Y–Z)". Paths that never cross are counted and
   reported as `no_breach_fraction`.
6. **Cap the horizon** at 3× the window length. 30 min of data never produces a 3-day claim.
7. **Calibrate.** Track how often past actuals landed inside past 80 % bands; store the
   empirical coverage and a `widen_factor`. ETS/ARIMA intervals are known to be too narrow
   (nominal 95 % often delivering ~71–87 % coverage), so widening is honest, not cosmetic.

What we claim on stage: *the method is designed for week-scale facility capacity; what we
validated in a hackathon is minute-scale on a mock rack.* We say that out loud rather than
implying we forecast weeks.

---

## 4. Change-point detection — two detectors must agree

- **CUSUM** (two-sided, `k = 0.5σ`, `h = 5σ`) on residuals from the current model. Online,
  cheap, catches small sustained shifts fast. This is the **trigger**.
- **ruptures PELT** (`model="l2"`, `min_size ≥ 30` samples, `jump=5`) over the last 10 minutes.
  This **confirms and localises**.
- A change point is only logged when PELT finds a break within **±60 s** of the CUSUM trigger.
  Requiring agreement is what keeps false alarms off the screen during a live demo.
- On confirmation: write a `CHANGE_POINT` audit row, cut the forecast window at the break,
  refit.

**Topology vs statistics — a deliberate separation.** A node joining or leaving is known
*deterministically* from MQTT LWT/connect. We log it as fact (`NODE_ONLINE`). We do not pretend
statistics discovered it. Statistics are for the *load* change that follows.

---

## 5. Attribution — honest by construction

Tenant attribution = **declared mapping** (tenant → slot → node) **plus temporal correlation**.
Output is always `quality: "inferred"` and always ships with its `basis` string, e.g.
*"slope increased 3.1× within 40 s of tenant B's node coming online."*
We never present attribution as a measurement.

---

## 6. Power — estimated, and it says so

`P ≈ P_idle + (P_busy − P_idle) · u` (Fan, Weber & Barroso, ISCA 2007), with `u` read from
`/proc/stat` on the UNO Q and anchors `P_idle ≈ 0.4 W`, `P_busy ≈ 1.4 W` from independent
bench measurements of the board. Published with `uncertainty_pct: 30` until calibrated.

ESP32 nodes use datasheet-class per-state constants × duty cycle. Worth saying out loud: the
**MQ135 heater (~0.8–0.95 W) dominates a sensor node's power** — a good, true talking point.

**If an INA219 is added** (~1 hour of work, I²C, shares the bus with the MPU6050): it measures
one **DC rail of the mock rack**, 0–26 V, ±3.2 A with the stock 0.1 Ω shunt. Those values may
become `measured`, labelled `source: "node DC rail"` — never "server power", and never mains AC.

---

## 7. AI layer — advisory, bounded, auditable

Three role prompts against one cloud LLM SDK with JSON-schema outputs. Designed directly
against OWASP LLM06 "Excessive Agency": minimum functions, human-in-the-loop for impact,
**authorization enforced downstream, never by the model**.

1. **Summarizer** — input is numbers the backend already computed. Output: 2–3 sentences +
   status hint. The model computes nothing.
2. **Explainer** — input is the forecast's real parameters (slope ± CI, damping, window start,
   the change point that reset it, crossing quantiles) + retrieved audit history. Output must
   cite `evidence` IDs; a response citing an ID we did not supply is **discarded** and logged
   as `AI_EVIDENCE_INVALID`.
3. **Proposer** — output must match a JSON schema whose `action` is from a closed whitelist.
   Anything else → `AI_ACTION_NOT_WHITELISTED`, discarded, logged.

**RAG**: embed audit events, past incidents and a short hand-written runbook (ASHRAE limits,
baseline rules). Retrieve top-k by cosine on `(server_id, question)`. pgvector if Postgres is
up; otherwise embeddings in SQLite + brute-force cosine in numpy — at hundreds of documents
that is instant and removes a moving part.

Every prompt, model name, response and validation result is written to the audit chain.

---

## 8. The approval chain — why the device is deliberately powerless

```
AI proposes ──> human reads evidence ──> human discusses with AI in chat
      │                                          │
      └──────────────> human clicks "Proceed" ───┘
                               │
                 server issues single-use nonce (TTL 60 s),
                 bound to (proposal_id, reader_device_id)
                               │
                 reader polls, shows the armed action on the TFT
                               │
                 RFID tap → {uid, nonce, ts, HMAC} ──> server verifies 6 checks
                               │
                        AUTHORIZED + audit row (hash printed on TFT)
```

The reader can only **relay a tap for an action the server already armed.** It cannot invent,
arm, or approve anything. That is the same principle as the team's earlier SAAKSHI job-card
device: *a device that could invent its own authority is a way to launder an unverified action
into something that looks official.*

Security honesty: a UID is a public identifier, not a secret. The tap is the **second** factor
after dashboard approval, scoped by a one-time nonce and a short TTL, with an HMAC over
`device_id|uid|nonce|ts` to defeat replay. Production would use DESFire EV2/EV3 or NTAG 424 DNA
(AES challenge–response) over TLS. We say this rather than overclaiming.

---

## 9. Audit — tamper-evident

Append-only table. `hash = SHA256(prev_hash || canonical_json(row))`. `GET /api/audit/verify`
recomputes the whole chain and reports the first broken row. The latest head hash is printed on
the TFT after every authorization, so the physical device and the server agree in public.

No UPDATE and no DELETE path to the audit table exists anywhere in the codebase.

---

## 10. Build order (what to do, in order)

| Phase | Work | Done when |
|---|---|---|
| **A** | Nodes flashed; Mosquitto + FastAPI ingest + SQLite on the UNO Q. LWT and `seq` from the first commit. | A real reading from a real sensor is in the database and visible via REST |
| **B** | Margins, baselines, ETS crossing-time simulation, CUSUM+PELT, audit hash chain | A hand-warmed DHT22 moves a real countdown |
| **C** | RFID state machine with nonce/TTL/HMAC; auth console firmware | A tap flips a proposal to AUTHORIZED and prints the hash |
| **D** | Dashboard: topology, cards, Recharts cone, then the 3D hall | Two browsers side by side — one tenant, one operator — prove isolation |
| **E** | LLM roles + RAG + the discuss-then-Proceed chat | An explanation cites real evidence IDs |
| **F** | Interval calibration, demo rehearsal ×3, optional INA219 | Coverage number is real; demo runs clean three times |

**Rule from the research that we keep:** one teammate is the **honesty owner**. Their only job
is to check that every number on screen carries the right `measured` / `estimated` / `inferred`
/ `ai_generated` label before the demo.

---

## 11. Live demo (~2.5 min)

Pre-flight: MQ135 powered since the start of the event (>24 h preheat); 5 min quiet vibration
baseline captured; clean-air `R0` captured; second node unpowered; NTP synced; audit verify green.

| Time | Action | What is shown | Provenance |
|---|---|---|---|
| 0:00 | Data Center Dashboard, racks green, inlet ~24 °C, margin ≈ 3 °C to 27 °C | 3D hall + live sparkline | measured |
| 0:20 | Cup hands around the DHT22 | Slope rises; cone appears: "breach in 6 min (P10 3 – P90 11)"; cone narrows | measured + forecast |
| 0:55 | Power on node 2 ("tenant B") | `NODE_ONLINE` logged as fact; CUSUM fires, PELT confirms; window resets; attribution card appears | topology measured, attribution inferred |
| 1:20 | Tape on a fan blade | Vibration RMS → ~3× baseline, rack outline goes red | measured, baseline-relative |
| 1:45 | Click **Explain** | Plain-language reason citing evidence IDs; proposal `REDUCE_TENANT_LOAD`; power shows `EST.` | ai_generated / estimated |
| 2:05 | Ask the AI "why not migrate?" in the proposal chat | Revised proposal, still `DISCUSSING` | ai_generated |
| 2:15 | Click **Proceed** → TFT shows armed action + 60 s countdown → **tap card** | `AUTHORIZED`, audit row, head hash on TFT and screen | measured |
| 2:30 | Tap an unregistered card | `REJECTED — Card not registered`, audit row written | measured |
| 2:40 | Log in as tenant in a second window | Neighbour slots show `UNKNOWN`; `/api/audit/verify` green | — |

**Do not demo:** an MQ135 "gas leak" with a lighter or alcohol (safety question + minutes of
sensor recovery), real thermal exhaustion, or a local LLM on the UNO Q during the run.

---

## 12. Things we deliberately refuse to do

- No `ppm` from the MQ135.
- No "measured watts" anywhere without a current sensor.
- No single-number ETA without a confidence range.
- No ISO 10816 absolute vibration zones on a 5 V fan.
- No LLM with write access, tool execution, or authorization power.
- No LLM running on any microcontroller — a 1 B-parameter model at 4-bit is ~0.5 GB of weights;
  the ESP32-S3 has 512 KB SRAM + 8 MB PSRAM. It is off by orders of magnitude, and we say so.
- No "weeks ahead" claim presented as a validated hackathon result.
- No tenant able to see another tenant's data, ever, by any route.
