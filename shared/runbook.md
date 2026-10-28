# RackSense Operational Runbook & Decision Matrix

> Ground truth operational policies, thermal boundaries, sensor baseline baselines, and closed action definitions.
> Written by Data Center Operations. Committed, not model-generated.

---

## 1. ASHRAE TC 9.9 Thermal Guidelines for Datacom Equipment

RackSense implements the ASHRAE TC 9.9 (2021 revision) thermal limits for enterprise IT equipment (Class A1 / A2 recommended and allowable envelopes):

| Metric | Recommended Envelope | Allowable Class A1 | Allowable Class A2 | Unit | Operational Action Threshold |
|---|---|---|---|---|---|
| **Inlet Temperature (`t_c`)** | 18.0 to 27.0 | 15.0 to 32.0 | 10.0 to 35.0 | °C | **WARN** at 25.0 °C; **CRIT** (Breach) at 27.0 °C (ASHRAE Recommended Upper Bound) |
| **Dew Point (`dew_c`)** | 5.5 to 15.0 | -12.0 to 17.0 | -12.0 to 21.0 | °C | **WARN** at 14.0 °C; **CRIT** at 15.0 °C (Condensation Risk) |
| **Relative Humidity (`rh`)** | 8.0 to 60.0 | 8.0 to 80.0 | 8.0 to 80.0 | % | **WARN** at 55.0%; **CRIT** at 60.0% |

*Magnus Equation for Dew Point:*
$$\gamma(T, RH) = \frac{a \cdot T}{b + T} + \ln\left(\frac{RH}{100}\right)$$
$$T_{\text{dew}} = \frac{b \cdot \gamma(T, RH)}{a - \gamma(T, RH)}$$
where $a = 17.625$, $b = 243.04 \text{ °C}$.

---

## 2. Sensor Commissioning & Baseline Rules

### MQ-135 Air Quality Sensor
- Reports resistance ratio $R_s / R_0$, dimensionless. **Never reported as ppm.**
- **Warmup Rule**: Sensor heater requires a 180-second pre-heat cycle. If `mq_warm == false`, readings are physically uncalibrated and must NOT be forecasted or attributed.
- **Thresholds**:
  - `WARN`: $1.5\times$ baseline ratio. Indicates particulate buildup, dust influx, or filter loading.
  - `CRIT`: $2.0\times$ baseline ratio. Indicates severe airflow obstruction or combustion pre-cursors.

### MPU-6050 Vibration Sensor
- Reports RMS acceleration in $g$ ($9.81 \text{ m/s}^2$).
- **Baseline Rule**: Absolute ISO vibration zones do not apply to small 120mm/40mm rack fans. All vibration evaluation is strictly **relative to a captured baseline** at commissioning.
- **Thresholds**:
  - `WARN`: $2.0\times$ baseline RMS. Indicates fan bearing wear or mechanical looseness.
  - `CRIT`: $4.0\times$ baseline RMS. Imminent fan failure; risk of localized hotspot.

---

## 3. Closed Action Whitelist & Risk Tiers

The advisory AI and operators may ONLY propose actions from this closed whitelist. Any other action is rejected and audited as `AI_ACTION_NOT_WHITELISTED`.

| Action Identifier | Plain Name | Permitted Scope | Risk Tier | Authorized Roles | Description |
|---|---|---|---|---|---|
| `REDUCE_TENANT_LOAD` | Throttle Workload | Node / Slot / Tenant | `MEDIUM` | OPERATOR, SUPER_USER | Request tenant compute orchestrator to shed non-critical batch processing to relieve localized rack heat or power budget. |
| `MIGRATE_TENANT` | Migrate Workload | Tenant / Rack | `HIGH` | SUPER_USER only | Live-migrate virtual machines or containers to an adjacent cooler rack with spare cooling capacity. |
| `INSPECT_FAN` | Physical Fan Inspection | Node / Rack | `LOW` | OPERATOR, SUPER_USER | Dispatch technician to inspect rack exhaust fans, clear debris, or check bearing vibration. Non-disruptive to server software. |
| `INCREASE_COOLING_SETPOINT_REQUEST` | Facility Cooling Request | Rack / Site | `LOW` | OPERATOR, SUPER_USER | Request facility management to decrease CRAC/CRAH chilled-air supply temperature setpoint by 1.0 °C. |
| `SCHEDULE_MAINTENANCE` | Schedule Maintenance Window | Node / Rack | `MEDIUM` | OPERATOR, SUPER_USER | Book maintenance window during next off-peak period for filter replacement or hardware recabling. |
| `NO_ACTION` | Maintain Observation | Any | `LOW` | OPERATOR, SUPER_USER | Observation period only. Telemetry is within margins or the regime change has stabilized. |

---

## 4. Multi-Factor RFID Authorization Policy

1. **Role and Risk Tiers**:
   - `LOW` Risk Actions: Authorizable by any active cardholder with `max_risk_tier >= 1`.
   - `MEDIUM` Risk Actions: Authorizable by active cardholders with `max_risk_tier >= 2`.
   - `HIGH` Risk Actions: Authorizable ONLY by senior operations staff with `max_risk_tier >= 3`.
2. **Authority Decoupling**:
   - Software (including AI) is advisory only. It can only propose (`PROPOSED`).
   - Human operator reviews proposal and clicks Proceed in dashboard (`APPROVED_PENDING_TAP`).
   - Server arms reader with a 60-second single-use nonce.
   - Physical tap on the rack console completes authorization (`AUTHORIZED`).
3. **Audit Ledger**:
   - Every proposal, discussion, approval, tap, and rejection is recorded in an immutable append-only SHA-256 hash chain.

