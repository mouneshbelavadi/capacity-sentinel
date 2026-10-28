# RackSense — Live Demo & Rehearsal Playbook

> **2.5-Minute Live Presentation Script & Pre-Flight Checklist**  
> *Problem Statement AO-02: "Seeing trouble before the capacity runs out."*  
> Team: **Maverick Marvels** (Team ID: **HM3-P-00493-03**)  

---

## 1. Pre-Flight Checklist (Run 10 Minutes Before Presentation)

Execute these checks before calling judges over:

- [ ] **Run Pre-Flight Script**: Run `python tools/demo_check.py` — ensure all checks return `[PASS]`.
- [ ] **MQ135 Preheat**: Sensor powered continuously since event setup (>24 h burn-in), telemetry reporting `mq_warm: true`.
- [ ] **Vibration Baseline**: Commissioning quiet baseline captured over 5 minutes (recorded in `baselines` table: `0.012 g`).
- [ ] **Clean-Air Baseline**: Clean-air $R_0$ resistance captured for MQ135 probe.
- [ ] **Second Node Ready**: Node 2 (`r2-n1`, representing Tenant Beta) is unplugged from USB power and ready on bench for hot-plugging.
- [ ] **Clocks Synchronized**: All microcontrollers and edge SBC NTP-synced within 1 second.
- [ ] **Audit Chain Green**: Head hash verified (`GET /api/audit/verify` returns `ok: true`).
- [ ] **Browser Windows Prepared**:
  - **Window 1 (Left / Primary Display)**: Logged in as `SUPER_USER` (`super1`) $\to$ **Data Center Dashboard** (`/`).
  - **Window 2 (Right / Secondary Display)**: Logged in as Tenant Alpha (`alpha_user`) $\to$ **Tenant Dashboard** (`/`).
- [ ] **Reader Console Ready**: ESP32-S3 TFT display powered on, showing idle status and fresh heartbeat.
- [ ] **Physical Cards in Pocket**:
  - **Card 1 (Authorized Operator)**: UID `04:A1:B2:C3:D4` (Operator Alice, max risk tier 2).
  - **Card 2 (Unregistered / Intruder)**: Known unregistered UID (e.g. standard metro or office card).

---

## 2. Team Roles

| Role | Teammate | Primary Duty |
|---|---|---|
| **The Narrator** | Speaks to judges | Explains the concepts, delivers the competitor comparisons, and speaks the **honesty lines** out loud. |
| **The Laptop Driver** | Operates screen | Clicks UI, navigates 3D hall, opens proposal revision chat, triggers Proceed. |
| **The Hardware Lead** | Handles physical bench | Cups hands around DHT22, plugs in Node 2, taps cards on reader console. |

---

## 3. The 2.5-Minute Stage Script (Step-by-Step)

```
┌─────────┬──────────────────────┬──────────────────────────────────────────┬──────────────────────┐
│ Time    │ Stage Action         │ What Appears on Screen / Hardware        │ What Narrator Says   │
├─────────┼──────────────────────┼──────────────────────────────────────────┼──────────────────────┤
│ 0:00    │ Stand at screens.    │ 3D Rack Hall green. Inlet at ~24.0 °C.   │ Pitch line:          │
│         │ Laptop shows         │ Margin to 27 °C ASHRAE limit shown as    │ "Grafana only beeps  │
│         │ Data Center view.    │ ~3.0 °C. Live sparkline updating 500 ms. │ after server cooks;  │
│         │                      │ Provenance badges: 'measured'.           │ ours predicts early."│
├─────────┼──────────────────────┼──────────────────────────────────────────┼──────────────────────┤
│ 0:20    │ Hardware Lead gently │ DHT22 temperature rises to ~25.2 °C.     │ "Theil-Sen detects a │
│         │ cups hands around    │ Theil-Sen CI confirms sustained trend.   │ true slope. Notice   │
│         │ Node 1's DHT22.      │ Predictive cone appears:                 │ the forecast gives a │
│         │                      │ 'Breach in 6 min (P10: 3 – P90: 11)'.    │ probability band,    │
│         │                      │ Cone narrows as more samples arrive.     │ not a fake number."  │
├─────────┼──────────────────────┼──────────────────────────────────────────┼──────────────────────┤
│ 0:55    │ Hardware Lead plugs  │ MQTT Last Will connects: `NODE_ONLINE`   │ "Node joining is a   │
│         │ in Node 2 USB cable  │ logged as fact. CUSUM triggers, PELT     │ known hardware fact, │
│         │ ("Tenant Beta").     │ confirms regime shift. Window resets.    │ not a guess. System  │
│         │                      │ Attribution card appears:                │ attributes 78% heat  │
│         │                      │ '78% heat delta from Tenant Beta'.       │ to Beta, not Alpha." │
├─────────┼──────────────────────┼──────────────────────────────────────────┼──────────────────────┤
│ 1:20    │ Hardware Lead taps   │ Accelerometer RMS rises to ~3x baseline. │ HONESTY LINE:        │
│         │ motor or sticks tape │ Rack outline turns red. Status: WARN.    │ "Vibration is        │
│         │ on cooling fan blade.│ Margin shows 'relative to baseline'.     │ relative to baseline │
│         │                      │                                          │ — ISO motor zones    │
│         │                      │                                          │ don't fit 5V fans."  │
├─────────┼──────────────────────┼──────────────────────────────────────────┼──────────────────────┤
│ 1:45    │ Laptop Driver clicks │ AI advisory panel explains problem with  │ "AI computes NO      │
│         │ "Explain & Propose". │ cited evidence IDs. Proposes:            │ numbers. It cannot   │
│         │                      │ REDUCE_TENANT_LOAD on Slot 2.            │ touch switches. Only │
│         │                      │ Power estimate badged: 'estimated'.      │ an operator can act."│
├─────────┼──────────────────────┼──────────────────────────────────────────┼──────────────────────┤
│ 2:05    │ Laptop Driver types  │ AI re-evaluates runbook, updates plan.   │ "Chat revisions stay │
│         │ in chat: 'Why not    │ Status strictly bound to DISCUSSING.     │ strictly discussing. │
│         │ migrate workload?'   │ No authorization bypass possible.        │ Prompt injection     │
│         │                      │                                          │ cannot approve it."  │
├─────────┼──────────────────────┼──────────────────────────────────────────┼──────────────────────┤
│ 2:15    │ Driver clicks        │ Server generates single-use 60s nonce.   │ "60-second window is │
│         │ 'Proceed'. Hardware  │ ESP32-S3 TFT shows armed action.         │ armed. Watch the     │
│         │ Lead taps Card 1.    │ Physical tap accepted: AUTHORIZED!       │ physical tap lock    │
│         │                      │ Head hash printed on screen and TFT.     │ the audit row."      │
├─────────┼──────────────────────┼──────────────────────────────────────────┼──────────────────────┤
│ 2:30    │ Hardware Lead taps   │ Reader displays: 'REJECTED: Card not     │ "An unauthorized tap │
│         │ unregistered Card 2. │ registered'. Audit ledger appends        │ is rejected and      │
│         │                      │ TAP_REJECTED row.                        │ immutably audited."  │
├─────────┼──────────────────────┼──────────────────────────────────────────┼──────────────────────┤
│ 2:40    │ Laptop Driver flips  │ Tenant Alpha's slots visible. Tenant     │ "Tenant isolation:   │
│         │ to Window 2          │ Beta slots show 'Shielded Workload'.     │ 404 stealth. Alpha   │
│         │ (Tenant Dashboard).  │ Clicking Beta slot returns 404 Not Found.│ never even knows     │
│         │                      │ Audit ledger verify reports: 100% OK.    │ Beta exists."        │
└─────────┴──────────────────────┴──────────────────────────────────────────┴──────────────────────┘
```

---

## 4. Mandatory Honesty Lines (Say These Out Loud)

Saying honesty lines **before** a judge asks shows deep technical competence:

1. **On Power Draw**:
   > *"You will notice that power shows an 'EST.' badge. There is no physical current transducer on the mains line; it is estimated from Linux kernel CPU load using the Fan, Weber & Barroso model."*
2. **On Vibration**:
   > *"Vibration is evaluated relative to our 5-minute commissioning baseline, not ISO 10816 absolute zones. ISO vibration zones are calibrated for 15 kW to 300 kW industrial motors and do not apply to small electronics fans."*
3. **On Air Quality**:
   > *"The MQ135 sensor reports a resistance ratio $R_s / R_0$, never ppm. Inexpensive tin-dioxide sensors require over 24 hours of preheating and have broad cross-sensitivities; claiming ppm would be dishonest."*
4. **On Forecast Horizons**:
   > *"Our statistical forecaster targets week-scale capacity in production data centers. What we are validating here on this mock bench is minute-scale thermal inertia. We state week-scale as design intent, not as a validated result on real megawatt halls."*

---

## 5. What NOT to Demo

- **NO Gas Leak with a Lighter or Alcohol**: A flame or butane jet from a lighter trips fire safety alarms, violates venue safety rules, and takes up to 45 minutes for the MQ135 sensor to desorb and recover.
- **NO Real Thermal Overheating**: Do not place heat guns or hair dryers directly onto 3D-printed parts or bare PCB traces. Cupping hands or holding warm breath gently near the DHT22 is completely sufficient to move the slope by 1.5 °C.
- **NO Local LLM on the Microcontrollers**: A 1-billion parameter model is 500 MB. The ESP32-S3 has 512 KB of RAM. Explain this openly to judges if asked.

