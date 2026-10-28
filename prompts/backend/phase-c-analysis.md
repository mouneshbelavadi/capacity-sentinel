# BACKEND — PHASE C · Analysis engine

> Run `startup.md` first. Phases A and B must be working.
> Read `shared/architecture.md` §2–§6 and `shared/api-contract.md` §4–§8.

---

## Goal of this phase

Turn a stream of readings into an **honest answer to "what runs out, when, and why"**.

The thing that makes this phase good is not the model. It is the refusals: knowing when there
is no trend, capping the horizon, reporting the fraction of scenarios that never breach, and
labelling what is estimated rather than measured. A forecast that admits uncertainty beats one
that sounds confident.

---

## Build

### 1. Margins and limits (`services/margins.py`)

| Metric | Limit | Source to cite in `limit_source` |
|---|---|---|
| `t_c` | 27.0 °C | ASHRAE TC 9.9 recommended inlet upper bound (allowable A1 15–32 °C) |
| `dew_c` | 15.0 °C upper, −9 °C lower | dew-point envelope |
| `mq_ratio` | baseline × 1.5 (WARN), × 2.0 (CRIT) | clean-air `R0` baseline captured on this bench |
| `vib_rms_g` | baseline × 2 (WARN), × 4 (CRIT) | commissioning baseline captured on this bench |

Dew point from DHT22 temp + RH via the **Magnus formula** — compute it, do not approximate.

**Baselines are captured, never assumed.** `POST /api/baselines/{node_id}/{metric}/capture`
(OPERATOR+) records the mean and σ over a quiet window and stores the sample count. Until a
baseline exists for a metric, that metric has **no status and no forecast** — the API returns
`FORECAST_INSUFFICIENT_DATA` and the UI will say so.

**Do not report MQ135 ppm.** Ratio only. The sensor is broadly cross-sensitive and strongly
temperature/humidity dependent.
**Do not apply ISO 10816/20816 absolute vibration zones.** They are defined for 15 kW–300 kW
machines; a 5 V fan is not one. Baseline-relative only.

### 2. Forecast (`services/forecast.py`)

Exactly this pipeline, in this order:

1. **Resample** raw 2 s readings to fixed **10 s means**. Window = last 30 min, or from the most
   recent confirmed change point if one exists (`window_reason`).
2. **Robust slope check first.** `TheilSenRegressor` (or Huber) on the window. Bootstrap or
   analytic 95 % CI on the slope.
   **If the CI contains zero → return `has_trend: false`, crossing times `null`, and stop.**
   This single rule removes most nonsense output. Do not fit anything further.
3. **Fit ETS**: `statsmodels.tsa.exponential_smoothing.ets.ETSModel`, additive error, additive
   **damped** trend, **no seasonality**. You will not observe two daily cycles in a hackathon, so
   seasonal models are not justified.
4. **Simulate** 1000 paths from the end of the window over the horizon
   (`fit.simulate(anchor="end", nsimulations=H, repetitions=1000)`).
5. **Crossing times**: for each path, the first step that crosses the limit. Report P10/P50/P90
   of that distribution. Paths that never cross inside the horizon are counted and returned as
   `no_breach_fraction` — this field is **required**, not optional.
6. **Cap the horizon** at 3× the fitted window length. 30 minutes of data never produces a
   3-day claim.
7. **Calibrate.** Track how often past actuals fell inside past 80 % bands; store
   `empirical_coverage` and a `widen_factor`. ETS intervals are known to run narrow — nominal
   95 % often delivering only ~71–87 % coverage — so widening is honest, not decoration. Apply
   the factor to the published band.

Return the full object from contract §5, including `slope` with its CI and the `calibration`
block.

**Do not use Prophet** (built for daily/weekly business seasonality, heavy, poor on hours of
0.5 Hz data) **or seasonal SARIMAX**.

### 3. Change points (`services/changepoint.py`)

Two detectors must agree before anything is logged:

- **CUSUM**, two-sided, `k = 0.5σ`, `h = 5σ`, on residuals from the current model. Online,
  cheap. This is the **trigger**.
- **`ruptures.Pelt(model="l2", min_size>=30, jump=5)`** over the last 10 minutes. This
  **confirms and localises**.
- Log `CHANGE_POINT` only when PELT finds a break within **±60 s** of the CUSUM trigger. Then
  cut the forecast window at the break and refit.

Requiring agreement is what keeps false alarms off the screen during a live demo.

**Keep topology separate from statistics.** A node joining or leaving is known deterministically
from MQTT LWT — it is already logged as `NODE_ONLINE` / `NODE_OFFLINE` fact in Phase A. When a
change point coincides within ±60 s, attach it as `topology_event`. Never present a known
connection as a statistical discovery.

### 4. Attribution (`services/attribution.py`)

Declared mapping (tenant → slot → node) **plus** temporal correlation. Output is **always**
`quality: "inferred"` and **always** carries the `basis` string, e.g.
*"slope increased 3.1× within 40 s of tenant node r2-n1 coming online"*.

Never `measured`. Never a share without its basis.

### 5. Power (`services/power.py`)

```
P = P_idle + (P_busy − P_idle) · u
```

`u` from `/proc/stat` on the UNO Q. Anchors `P_idle = 0.4 W`, `P_busy = 1.4 W`,
`uncertainty_pct = 30`, `calibrated: false`.

Return `quality: "estimated"`, `model: "linear-cpu-v1"`, and the full `model_detail` block with
the formula, the inputs and the reference (Fan, Weber & Barroso, ISCA 2007; board idle/load
figures from independent bench tests).

**There is no current sensor on this build.** Nothing here may ever be labelled `measured`.
If an INA219 is added later, only values read from it become `measured`, with
`source: "node DC rail"` — never "server power", never mains AC.

### 6. Anomaly (`services/anomaly.py`)

`IsolationForest` over the multivariate feature vector (`t_c`, `rh`, `mq_ratio`, `vib_rms_g`,
`vib_crest`), fitted on the node's own quiet baseline window. Used as a badge, not as a
forecast. If a node has fewer than N baseline samples, no anomaly score is produced.

### 7. Scheduler (`services/scheduler.py`)

**Nothing above runs inside a request handler.** APScheduler (or an asyncio task) recomputes per
`(node, metric)` every 10 s and writes to `forecast_cache` / `changepoints`. Routes read the
cache.

Budget: a full ETS fit + 1000 simulations must complete in ≤ 2 s on the UNO Q. If it does not,
reduce repetitions to 500 and say so in `.agents/context.md` — do not silently exceed the
budget.

### 8. Routes

```
GET /api/forecast/{node_id}/{metric}
GET /api/changepoints?node_id=&since=
GET /api/attribution/{rack_id}?metric=
GET /api/power/{node_id}
POST /api/baselines/{node_id}/{metric}/capture     # OPERATOR, SUPER_USER
```

All scoped through `apply_scope`. `GET /api/racks/{id}/summary` now returns a real
`worst_margin` with its `limit_source`.

---

## Hard rules

- A forecast is **always a distribution**, never a single ETA.
- `has_trend: false` → no cone, no ETA, no guess.
- `no_breach_fraction` is always returned.
- Horizon capped at 3× window.
- Attribution is always `inferred`; power is always `estimated`.
- No ppm from the MQ135; no absolute ISO zones for vibration.
- Never claim week-scale validation. The method targets week-scale facility capacity; what you
  validated is minute-scale on a mock rack. Record that distinction in `.agents/context.md`.

---

## Tests

1. A flat synthetic series → `has_trend: false`, crossing times `null`.
2. A clean ramp → crossing P10 < P50 < P90, and P50 within tolerance of the analytic crossing.
3. A noisy ramp → the band widens, P50 stays sane, horizon respects the 3× cap.
4. A step change injected mid-window → CUSUM fires, PELT confirms, `CHANGE_POINT` logged once
   (not twice), window resets.
5. A step change with **no** PELT confirmation → **nothing** logged.
6. `no_breach_fraction` is between 0 and 1 and equals the simulated share.
7. Power response always carries `quality: "estimated"` and a complete `model_detail`.
8. Metric with no baseline → `FORECAST_INSUFFICIENT_DATA`, not a number.
9. Scheduler completes a full recompute within the 2 s budget.

Synthetic series for these tests live in `tools/synthetic/` and are clearly named. They are test
fixtures — they must never be reachable from a production route.

---

## Acceptance — show me live

1. Warm a real DHT22 by hand → the countdown shortens, the cone narrows as the trend firms.
2. Let it cool → `has_trend` flips to `false` and the UI-facing payload says no forecast.
3. Power on a second node → `NODE_ONLINE` logged as fact, CUSUM+PELT agree, window resets,
   attribution appears with its basis string.
4. `GET /api/power/...` → `estimated`, with the formula visible in `model_detail`.

## Deliver

Code, tests green, updated `backend/README.md`, refreshed `graph.md` and `.agents/context.md`,
contract status stated. Stop here.
