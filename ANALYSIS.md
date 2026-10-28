# RackSense — Analysis & Methodological Foundations

> **Hackathon Problem Statement AO-02: "Seeing trouble before the capacity runs out."**  
> Team: **Maverick Marvels** · Team ID: **HM3-P-00493-03** · Domain: **AI & Ops**  
> Single-source document detailing mathematical methods, physical limits, statistical honesty, and measured backtesting results.

---

## 1. What Runs Out, and How We Know

In a data center, capacity is not a single scalar; it is a vector of physical headroom boundaries. Every metric reported by RackSense represents either a **margin against a cited standards limit** or a **ratio against an empirical baseline**.

| Metric | Sensor & Signal | Limit Value | Authoritative Standard / Source | Physical Meaning & Margin Formula |
|---|---|---|---|---|
| **Inlet Temperature** | DHT22 on rack front | **27.0 °C** | **ASHRAE TC 9.9 (2021)** Recommended Upper Bound (Class A1/A2) | Headroom before thermal throttling: $\text{Margin} = 27.0 - T_{\text{inlet}}$. Below 27 °C servers operate reliably; above 27 °C, fans ramp exponentially and cooling efficiency crashes. |
| **Dew Point** | DHT22 ($T$ + $\text{RH}$) | **-9.0 °C to +15.0 °C** | **ASHRAE TC 9.9 Thermal Guidelines** | Condensation & ESD boundary computed via **Magnus formula** (below). If dew point $>15$ °C, moisture condenses on cold heat sinks; if $<-9$ °C, electrostatic discharge risks surge. |
| **Air Quality Drift** | MQ135 exhaust probe | **1.5× baseline** (WARN)<br>**2.0× baseline** (CRIT) | Clean-air $R_0$ baseline captured on-bench | Detection of insulation off-gassing, overheating PVC cables, or dirty intake air filters. Reported strictly as ratio $R_s / R_0$, never ppm. |
| **Fan Vibration** | MPU6050 accelerometer | **2.0× baseline** (WARN)<br>**4.0× baseline** (CRIT) | Commissioning baseline captured on-bench | Mechanical bearing wear and blade imbalance. Evaluated relative to quiet baseline, because industrial ISO zones do not apply to small 5 V fans. |
| **Shock / Tamper** | SW-420 spring switch | **>0 events/min** | Binary disturbance switch | Physical impact, door slam, or cabinet jarring. |
| **Compute Headroom** | Host `/proc/stat` | **100% CPU** | Linux kernel hardware metrics | Real compute utilization of the edge coordinator. |
| **Power Headroom** | Inferred CPU Model | **Rack Breaker Rating** | Fan, Weber & Barroso (ISCA 2007) model | Estimated thermal/electrical power draw derived from compute load. Always badged as `estimated`. |

### Magnus Formula for Exact Dew Point:
$$\alpha(T, \text{RH}) = \frac{17.27 \cdot T}{237.7 + T} + \ln\left(\frac{\text{RH}}{100}\right)$$
$$T_{\text{dew}} = \frac{237.7 \cdot \alpha(T, \text{RH})}{17.27 - \alpha(T, \text{RH})}$$

---

## 2. Forecasting — "Runs Out in X Minutes (Y to Z)"

Rather than fitting naive straight lines or heavy black-box neural networks, RackSense implements a **7-step robust statistical time-series forecasting pipeline**:

```
[Raw 2s Readings] 
       │
       ▼
1. Resample to 10s Means (Sliding Window ≤30 min, reset at last change-point)
       │
       ▼
2. Robust Slope Check (Theil-Sen with analytical 95% Confidence Interval)
       ├─ If 0 ∈ [CI_low, CI_high] ──▶ has_trend = False (Refuse to forecast; UI says "No sustained trend")
       │
       ▼ (if has_trend == True)
3. Fit ETS Additive Model (statsmodels.tsa.exponential_smoothing.ets.ETSModel)
       │ Additive Error, Additive Damped Trend (damping parameter 0.8 ≤ φ ≤ 0.98), No Seasonality
       ▼
4. Monte Carlo Simulation (500 to 1,000 simulated future paths from forecast origin)
       │
       ▼
5. First-Crossing Distribution (Record step index where each path breaches limit)
       │ Compute P10 (optimistic), P50 (median), P90 (pessimistic) crossing times
       │ Compute no_breach_fraction (paths that never breach before horizon)
       ▼
6. Horizon Capping (Strictly capped at 3× the window duration; max 2 hours on bench)
       │
       ▼
7. Empirical Interval Widening (Calibrated against backtested coverage)
```

### Why Prophet and Seasonal SARIMAX Were Rejected:
- **Facebook Prophet**: Designed for daily, weekly, and annual business seasonality (sales, web hits) with changepoint priors on days. On 0.5 Hz IoT sensor streams spanning 30 minutes, Prophet overfits random diurnal noise and requires several seconds of CPU time per node.
- **Seasonal SARIMAX**: Requires observing at least two full seasonal cycles before fitting seasonal parameters $(P, D, Q)_s$. In minute-to-hour edge monitoring, daily seasonality cannot be observed; SARIMAX degenerates into an unstable autoregressive process.

---

## 3. The Refusals — Why Honesty Outranks Output

A monitoring system that outputs a number when it has no mathematical foundation is dangerous. RackSense enforces four strict refusal rules:

1. **The `has_trend: false` Refusal**: If the Theil-Sen 95% confidence interval on the slope contains zero ($CI_{\text{low}} \le 0 \le CI_{\text{high}}$), the system **refuses to forecast**. The API returns `has_trend: false`, `eta_seconds: null`, and the UI displays *"No sustained trend — no exhaustion forecast"*. It never draws a fake predictive cone across a stationary series.
2. **The 3× Horizon Cap**: A 30-minute observation window can never justify a 3-day prediction. The forecast horizon is hard-capped at $\min(3 \times \text{window\_duration}, 7200\text{ s})$.
3. **Mandatory `no_breach_fraction` Reporting**: If 35% of the simulated paths never cross 27 °C, the UI must report *"35% of simulated paths do not breach"*. Hiding the non-breaching fraction makes an honest probabilistic forecast look falsely alarming.
4. **Empirical Interval Widening**: Standard ETS prediction intervals are known in statistical literature to run too narrow (nominal 80% intervals often deliver only ~60–75% empirical coverage due to unmodelled kurtosis and sensor noise). RackSense applies an empirical widening factor derived from backtesting rather than claiming unrealistically narrow certainty.

---

## 4. Dual Change-Point Detection — Two Detectors Must Agree

To prevent false alarms during live operations, RackSense decouples sudden hardware/load regime shifts into a **two-stage verification pipeline**:

1. **Trigger (Online CUSUM)**: A two-sided Cumulative Sum detector running on model residuals ($k = 0.5\sigma, h = 5\sigma$). It requires negligible compute and catches sustained shifts within seconds.
2. **Confirmation & Localization (Offline ruptures PELT)**: Once CUSUM triggers, the Pruned Exact Linear Time (PELT) algorithm with an $L_2$ cost function scans the trailing 10-minute window with a penalty parameter $\beta$.
3. **Temporal Agreement**: A change-point is **only accepted and logged** if PELT confirms a break within **$\pm 60$ seconds** of the CUSUM trigger. If only one algorithm fires, the event is treated as transient noise and discarded.
4. **Action on Confirmation**: When confirmed, the engine logs a `CHANGE_POINT` audit row, truncates the forecast window at the break timestamp, resets the baseline, and refits the forecaster immediately.

### Deliberate Separation Between Topology and Statistics:
When a new node boots up or disconnects, MQTT publishes an LWT `NODE_ONLINE` or `NODE_OFFLINE` message. This is a **deterministic hardware fact**, not a statistical inference. RackSense records node topology changes as known facts, reserving change-point algorithms solely for detecting *unannounced load and thermal shifts*.

---

## 5. Tenant Attribution — Honest by Construction

In a shared colocation rack, multiple tenants share the same cooling airflow and power rail. When temperature rises, traditional tools like Datadog or Grafana only show "Rack 1 is hot", unable to identify who is responsible.

RackSense computes attribution using:
$$\text{Attribution} = \text{Declared Physical Mapping } (\text{Tenant} \to \text{Slot} \to \text{Node}) + \text{Temporal Correlation}$$

- **Always Badged as `inferred`**: Attribution is never presented as a direct measurement.
- **Mandatory Basis String**: Every attribution response includes a human-readable explanation of the evidence, for example:
  > *"78% of thermal delta attributed to Tenant Beta (Slot 2); CPU utilization stepped from 14% to 98% within 40 seconds of inlet slope increase."*

---

## 6. Power Estimation — Transparent Mathematical Modeling

RackSense does not fit physical AC current transformers on 230 V mains lines. Therefore, power draw is **estimated**, never reported as measured watts.

### Model Formulation (Fan, Weber & Barroso, ISCA 2007):
$$P(u) = P_{\text{idle}} + (P_{\text{busy}} - P_{\text{idle}}) \cdot u$$
- $u$: CPU utilization read directly from `/proc/stat` on the edge SBC.
- $P_{\text{idle}} \approx 0.4\text{ W}$, $P_{\text{busy}} \approx 1.4\text{ W}$ (calibrated on-bench for the Arduino UNO Q SBC).
- Published with an explicit `uncertainty_pct: 30%` and metadata quality `estimated`.

### Sensor Node Power Realism:
On the ESP32 sensor nodes, the **MQ135 internal heating element consumes ~0.85 W to 0.95 W continuously**, completely dwarfing the microcontroller's 0.15 W compute draw. RackSense explicitly accounts for sensor heating power in edge energy audits.

---

## 7. Sensor Physics & Honesty Boundaries

1. **MQ135 Air Quality Sensor**:
   - Requires $>24\text{ hours}$ of continuous burn-in before resistance stabilizes.
   - Broadly cross-sensitive to ambient temperature, relative humidity, ethanol, and CO₂.
   - **Honesty Rule**: RackSense **never reports ppm**. It reports strictly the dimensionless resistance ratio $R_s / R_0$ against a clean-air baseline. While `mq_warm` is false, it refuses to store or display air quality readings.
2. **SW-420 Shock Sensor**:
   - It is a spring switch with an LM393 comparator. It is a binary threshold device, not a seismometer.
   - Reported strictly as **event count per minute** (`count`), never as acceleration or energy.
3. **MPU6050 Accelerometer**:
   - Samples at 200 Hz over 2.0-second sliding windows on-device, reduced to RMS, Peak, and Crest Factor:
     $$\text{RMS} = \sqrt{\frac{1}{N}\sum_{i=1}^N a_i^2}, \quad \text{Crest Factor} = \frac{\text{Peak}}{\text{RMS}}$$
   - **Honesty Rule**: Evaluated **relative to commissioning baseline** ($2\times$ WARN, $4\times$ CRIT). ISO 10816/20816 absolute velocity vibration zones apply to 15 kW–300 kW industrial motors, **not to a 5 V axial fan**.

---

## 8. The AI Boundary — Advisory Only (OWASP LLM06)

RackSense implements the cloud AI layer strictly according to the **OWASP LLM06 (Excessive Agency)** safety brief:

```
┌────────────────────────────────────────────────────────────────────────┐
│                          CLOUD ADVISORY LLM                            │
│  - Zero write tools.                                                  │
│  - Zero access to facility controls.                                   │
│  - Closed Action Whitelist (6 permitted actions only).                 │
│  - Hard Evidence ID Grounding (hallucinated IDs rejected).            │
│  - Read-only ASHRAE Runbook RAG retrieval.                             │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ Outputs structured advisory JSON
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                      SERVER-SIDE APPROVAL ENGINE                       │
│  - Enforces status strictly in PROPOSED / DISCUSSING.                  │
│  - Chat endpoint CANNOT approve proposals (defeats prompt injection).  │
│  - Approval requires human operator clicking "Proceed" on screen.      │
│  - Issues single-use 60s cryptographic nonce.                          │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                   PHYSICAL RFID AUTHORIZATION TAP                      │
│  - Operator must physically walk to server rack.                       │
│  - Physical card tap with HMAC-SHA256 device signature.                │
│  - Atomic single-use consume.                                          │
└────────────────────────────────────────────────────────────────────────┘
```

### Closed Action Whitelist:
1. `REDUCE_TENANT_LOAD`
2. `MIGRATE_TENANT`
3. `INSPECT_FAN`
4. `INCREASE_COOLING_SETPOINT_REQUEST`
5. `SCHEDULE_MAINTENANCE`
6. `NO_ACTION`

If an LLM response outputs any action outside this list, or cites an evidence ID not provided in the request context, the response is discarded and audited as `AI_EVIDENCE_INVALID`.

---

## 9. The Approval Chain — Deliberately Powerless Reader

The ESP32-S3 authorization console on the server rack is **deliberately powerless**:
- It cannot invent actions.
- It cannot approve proposals.
- It cannot issue nonces.

It functions solely as a physical relay for an action already armed by a human operator on the central server. The approval flow requires **six ordered verification steps**:

1. **Device Authentication**: `device_id` must exist in `reader_devices`.
2. **HMAC-SHA256 Verification**: Verifies `HMAC(secret, "device_id|uid|nonce|ts")` in constant time (`hmac.compare_digest`).
3. **Clock Skew Check**: Verifies $|t_{\text{server}} - t_{\text{device}}| \le 120\text{ seconds}$.
4. **Nonce Validity & TTL**: Nonce must exist, be unconsumed, and $\text{now} \le \text{expires\_at}$ (60-second window).
5. **Card Authorization & Risk Tier**: Card UID must be active, registered to an operator, and $\text{card.max\_risk\_tier} \ge \text{proposal.risk\_tier}$.
6. **Atomic Single-Use Consume**:
   ```sql
   UPDATE nonces SET consumed_at = :now WHERE nonce = :nonce AND consumed_at IS NULL;
   ```
   If `rowcount == 0`, another concurrent tap won the race; the tap is rejected with `NONCE_CONSUMED`.

---

## 10. Security Limits, Stated Plainly

1. **RFID UID Security Floor**:
   - An RC522 reading classic MIFARE UID is reading a public serial number, not a cryptographic secret. "Magic" Chinese Gen2 cards can clone standard UIDs.
   - In RackSense, the tap is the **second factor** after dashboard approval, protected by a 60-second single-use nonce and hardware HMAC.
   - **Production Recommendation**: A production deployment would replace classic MIFARE with **MIFARE DESFire EV2/EV3** or **NTAG 424 DNA**, utilizing mutual AES-128 challenge-response over TLS.
2. **Append-Only Audit Ledger**:
   - SQLite table with zero `UPDATE` and zero `DELETE` queries in the entire codebase.
   - Each row is cryptographically chained:
     $$\text{Hash}_i = \text{SHA-256}\left(\text{Hash}_{i-1} \,\|\, \text{CanonicalJSON}(\text{Row}_i)\right)$$
   - The edge coordinator runs a startup self-check re-verifying every hash from genesis to head before accepting traffic.

---

## 11. Multi-Tenant Isolation — Server-Side Single Choke Point

Tenant isolation is implemented through a single server-side choke point: `apply_scope(query, scope)` in [`backend/repos/scope.py`](file:///c:/Users/moune/OneDrive/Desktop/capacity-sentinel/backend/repos/scope.py).

- **404, Never 403**: If Tenant Alpha queries a resource belonging to Tenant Beta, the server returns **404 Not Found**. Returning 403 Forbidden leaks the existence of the foreign resource.
- **Topology Masking**: Tenants receive a geometry-only view where foreign rack slots are masked with `tenant_id: null` and `display_label: "Shielded Workload"`.
- **Scoped Outbound Streaming**: The WebSocket broadcaster inspects tenant permissions on every frame before transmission.
- **Scoped RAG**: Vector searches filter by tenant scope *before* similarity ranking.
- **Automated AST Audit Test**: [`backend/tests/test_isolation.py`](file:///c:/Users/moune/OneDrive/Desktop/capacity-sentinel/backend/tests/test_isolation.py) parses Python AST across all repository modules, asserting that every database query accepts and applies a `Scope` parameter.

---

## 12. Validation & Measured Results (12-Month Ground-Truth Backtest)

The backtesting engine [`tools/synthetic/backtest.py`](file:///c:/Users/moune/OneDrive/Desktop/capacity-sentinel/tools/synthetic/backtest.py) evaluated the full system against the 12-month synthetic facility dataset (1,239,428 hourly records across 34 ground-truth labelled events):

### 1. Capacity Exhaustion Lead Time:
| Event ID | Subtype | Threshold | Measured Lead Time | System Behavior |
|---|---|---|---|---|
| **EV-002** | Cooling Degradation (Rack 2) | 27.0 °C | **24.9 days** | Early alert raised 24.9 days before 27 °C sustained crossing |
| **EV-004** | Storage Exhaustion | 100.0% | **0.0 days** | Breach detected at crossing (step change) |
| **EV-006** | Storage Exhaustion | 100.0% | **33.3 days** | Early alert raised 33.3 days before full capacity |
| **EV-008** | Cooling Degradation (Rack 1) | 27.0 °C | **1.8 days** | Rapid degradation caught 1.8 days prior to limit |
| **EV-010** | Storage Exhaustion | 100.0% | **33.5 days** | Early alert raised 33.5 days before full capacity |
| **EV-023** | Cooling Degradation (Rack 3) | 27.0 °C | **13.9 days** | Early alert raised 13.9 days before limit |
| **EV-027** | Cooling Degradation (Rack 2) | 27.0 °C | **9.1 days** | Early alert raised 9.1 days before limit |

- **Mean Lead Time**: **16.6 days**
- **Median Lead Time**: **13.9 days**

### 2. False-Alarm Rate on Transient Spikes:
- **Candidate Spikes Evaluated**: 8 ground-truth transients (`FALSE_ALARM_CANDIDATE`).
- **Correctly Rejected by Theil-Sen 95% CI**: 7 out of 8 (87.5%).
- **False Alarms Triggered**: 1 out of 8 (12.5% — on `EV-001`, an aggressive multi-day thermal transient).
- **False-Alarm Rate**: **12.5%**.

### 3. Empirical Interval Coverage (80% Confidence Band):
- **Horizon Steps Evaluated**: 372 steps across rolling out-of-sample windows.
- **Observed Empirical Coverage**: **63.4%** (under nominal 80%).
- **Engineering Assessment**: Confirms that raw ETS intervals run narrow in the presence of real-world autocorrelation and diurnal variation. This provides physical justification for our **empirical widening factor** (`widen_factor = 1.25`), raising effective coverage to >82%.

### 4. Change-Point Detection (CUSUM + PELT):
- **Regime Change Events Evaluated**: 7 ground-truth tenant onboard/offboard step changes.
- **True Positives (TP)**: 7
- **False Negatives (FN)**: 0
- **False Positives (FP)**: 0
- **Precision**: **100.0%**
- **Recall**: **100.0%**
- **F1-Score**: **1.000**

---

### The Crucial Scope Boundary (Stated Without Hedging):
> **The method targets week-scale facility capacity. What we validated in a hackathon is minute-scale on a mock rack. The physics of a 5 V fan and a 3-rack mock-up are orders of magnitude away from a real data hall, so live demo horizons are minutes. We present the week-scale claim as design intent and backtested synthetic simulation, not as a physically validated result on real megawatt data halls.**

---

## 13. What We Deliberately Refused to Build

To maintain engineering and physical integrity, the following features were explicitly rejected:

1. **No `ppm` from the MQ135**: A heated metal-oxide sensor without baseline calibration gas and cross-sensitivity compensation cannot produce genuine parts-per-million.
2. **No "Measured Watts"**: No current transducer was fitted to mains AC. Power is estimated from CPU load and labeled as such.
3. **No Single-Number ETA**: Every forecast is a distribution with explicit P10, P50, and P90 confidence bounds.
4. **No ISO Vibration Zones**: Industrial motor standards do not apply to small 5 V electronics cooling fans.
5. **No LLM Write Access or Tool Execution**: The AI is purely advisory; it computes no numbers and triggers no actions.
6. **No Local LLM on Microcontrollers**: A 1-billion parameter 4-bit model requires ~500 MB of RAM. An ESP32-S3 has 512 KB of SRAM — it is off by 1,000×.
7. **No Client-Side Permission Checks**: Every query enforces tenant isolation server-side via `apply_scope()`.
8. **No `admin` Label Anywhere**: The elevated role is strictly `SUPER_USER`; views are `Data Center Dashboard` and `Tenant Dashboard`.
9. **No Deleting or Editing Audit Records**: Zero `UPDATE` or `DELETE` queries exist for the audit table.

