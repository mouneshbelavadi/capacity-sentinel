# DATASET GENERATION PROMPT

**How to use this:** paste everything below the line into a separate AI tool (one good at
writing data-generation code). It is self-contained — it does not reference the RackSense
repository, so the tool needs no other context.

**What you get back:** a Python generator plus CSV/Parquet files for backtesting the forecaster.

**The rule that must survive:** this data is **synthetic**. Every row carries
`provenance: "synthetic"`, it loads only into `tools/synthetic/`, it goes into a separate
database or a clearly flagged partition, and the UI visually separates it from measured data.
It exists to *validate* the forecaster against known ground truth — never to fill a dashboard
that is pretending to be live.

---

I need you to write a Python generator that produces a realistic synthetic dataset for
validating a **data-centre capacity forecasting system**. I will use it to backtest a
time-to-exhaustion forecaster, a change-point detector, and an attribution method against known
ground truth.

Write **code that generates the data**, plus a short README. Do not hand-write data rows.

## Scenario

One facility, `site-01`, over **12 months at 1-minute resolution** (downsampled copies at 10 min
and 1 h as well). It contains:

- **3 racks** (`rack-01` … `rack-03`), each with **8 slots**.
- **4 tenants** (`t-alpha`, `t-beta`, `t-gamma`, `t-delta`) renting slots across racks. Tenants
  move in and out during the year — the slot→tenant mapping is time-varying, and that mapping
  must be emitted as its own table.
- Per slot, a sensor node emitting the metrics below.

## Metrics to generate

| Column | Unit | Notes |
|---|---|---|
| `t_c` | °C | Rack inlet temperature. Base ~22 °C. |
| `rh` | % | Relative humidity, ~40 %, mildly anti-correlated with temperature. |
| `vib_rms_g` | g | Fan vibration RMS. Baseline ~0.010 g per node, each node with its own baseline. |
| `vib_crest` | ratio | peak / RMS, normally ~3.0–4.0, rises with bearing wear. |
| `mq_ratio` | ratio | Air-quality `Rs/R0`. Baseline 1.0. Rises slowly with filter loading, spikes on thermal events. |
| `power_w` | W | Rack power draw. Correlated with a per-tenant load signal. |
| `storage_pct` | % | Storage utilisation per tenant — monotonically rising with occasional cleanups. |
| `net_mbps` | Mbps | Bandwidth per tenant, diurnal. |
| `cpu_util` | 0–1 | Per-node utilisation, drives `power_w`. |

## Realism requirements — this is the important part

Do not emit smooth sine waves plus Gaussian noise. The generator must produce data a forecaster
can actually be wrong about.

1. **Diurnal and weekly cycles.** Load is higher 09:00–18:00 local, lower at weekends. Inlet
   temperature follows load with a **lag** (thermal inertia) — model it as a first-order
   response with a time constant of roughly 10–20 minutes, not an instant mapping.
2. **Seasonal drift.** Ambient temperature rises through summer, shifting the whole inlet
   baseline by a few degrees across the year.
3. **Thermal physics.** `t_c` is a function of ambient + a load term + cooling capacity. When
   cooling degrades, the *same* load produces a higher inlet temperature. That coupling is what
   makes the forecasting problem real.
4. **Autocorrelated noise**, not white noise. Use an AR(1) process per metric with a realistic
   coefficient. Add occasional sensor dropouts (missing rows) and rare single-sample spikes
   that are clearly artefacts.
5. **Sensor characteristics.** `t_c` quantised to 0.1 °C with ±0.5 °C error; `rh` to 0.1 % with
   ±2 % error; vibration noisy at low amplitude.
6. **Per-node individuality.** Every node gets its own baseline offsets and noise parameters at
   generation time. Two nodes must never be statistically identical.

## Ground-truth events to inject (and emit as a label table)

The whole point of this dataset is that you know the answers.

| Event | What happens | Label |
|---|---|---|
| **Slow cooling degradation** | Cooling capacity declines over 2–6 weeks; inlet temperature trends toward and eventually crosses 27 °C | `CAPACITY_EXHAUSTION`, metric `t_c`, with the true crossing timestamp |
| **New tenant onboarding** | A tenant's node comes online; rack load and temperature step up within minutes | `REGIME_CHANGE` + `TENANT_ONBOARD`, with the true change timestamp and the responsible tenant |
| **Tenant departure** | Load steps down | `REGIME_CHANGE` + `TENANT_OFFBOARD` |
| **Fan bearing wear** | `vib_rms_g` rises from 1× to 4× baseline over 1–3 weeks, `vib_crest` rising with it | `MECHANICAL_DEGRADATION` |
| **Filter loading** | `mq_ratio` drifts from 1.0 to ~1.6 over weeks, resets at a maintenance event | `AIR_QUALITY_DRIFT` |
| **Storage exhaustion** | A tenant's `storage_pct` trends to 100 % with occasional cleanups that only delay it | `CAPACITY_EXHAUSTION`, metric `storage_pct` |
| **Transient spike that resolves itself** | A sharp rise that returns to baseline within an hour, with **no** underlying problem | `FALSE_ALARM_CANDIDATE` — these exist specifically to measure the false-alarm rate |
| **Cooling maintenance** | Capacity restored; an ongoing trend reverses | `MAINTENANCE` |

Inject **at least 25 labelled events** across the year, with a realistic mix. Include at least
6 `FALSE_ALARM_CANDIDATE` events — a dataset where every rise is a real problem will make any
detector look good and teach you nothing.

Also inject at least two **overlapping** events (e.g. cooling degradation while a tenant
onboards) so attribution has to disambiguate rather than pick the only option.

## Output files

1. `telemetry_1min.parquet` — `ts, site_id, rack_id, slot_id, node_id, tenant_id, metric, value, provenance`
   (long format, `provenance` always `"synthetic"`).
2. `telemetry_10min.parquet`, `telemetry_1h.parquet` — downsampled means, same schema.
3. `topology.csv` — time-varying `slot_id → tenant_id` with `valid_from`, `valid_to`.
4. `events_ground_truth.csv` — `event_id, type, start_ts, end_ts, rack_id, node_id, tenant_id,
   metric, true_crossing_ts, description`.
5. `node_params.csv` — the per-node baselines and noise parameters used, so results are
   reproducible and explainable.
6. `README.md` — the generative model in plain language, the parameters, the seed, and an
   explicit statement that the data is synthetic and must never be presented as measured.

## Generator requirements

- A single `generate.py` with a `--seed` argument; the same seed reproduces the dataset exactly.
- Parameters (event counts, drift rates, baselines, limits) in a `config.yaml`, not hard-coded
  in the body of the script.
- `--duration-days` so I can generate a 7-day version quickly for iteration before committing to
  12 months.
- A `validate.py` that checks the output: no NaNs outside intended dropouts, every labelled
  event is actually visible in the series (assert the crossing really happens), timestamps
  monotonic per node, and summary statistics printed per metric.
- Memory-conscious: 3 racks × 8 slots × 9 metrics × 525,600 minutes is large. Generate and write
  in monthly chunks rather than holding a year in memory.
- Type hints, docstrings, no notebook — a plain runnable script.

## What I will do with it

Replay it through a forecaster that uses robust trend detection plus damped exponential
smoothing with simulated crossing times, and a CUSUM→PELT change-point detector, then measure:

- **Lead time** before each `CAPACITY_EXHAUSTION` event
- **False-alarm rate** against the `FALSE_ALARM_CANDIDATE` events
- **Interval coverage** — how often the actual value fell inside the forecast's 80 % band
- **Change-point precision/recall** against the `REGIME_CHANGE` labels
- **Attribution accuracy** against the labelled responsible tenant

So the ground-truth table must contain everything needed to compute all five, without my having
to re-derive anything by eye.

## Constraints

- No external network calls. numpy, pandas, scipy, pyarrow only.
- Deterministic given a seed.
- Every emitted row carries `provenance: "synthetic"`. Do not add a column or a mode that could
  make this data look measured.
- Do not generate anything that looks like real customer names, real addresses, or real contact
  details. Tenants are `t-alpha` … `t-delta` with generic labels.
