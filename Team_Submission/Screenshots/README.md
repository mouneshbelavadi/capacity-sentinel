# RackSense Screenshots Guide (Phase 2 Submission)

This folder is configured for the required application screenshots as specified in the Phase 2 instructions:

## Required Screenshot Files:
1. **homepage.png**
   - URL: `http://localhost:5173/datacenter`
   - Description: Data Center Dashboard (Site 01 Facility Overview) showing the real-time 3D WebGL data hall (29 racks, 4 rows, walking aisles), live telemetry stats (Nodes Online 2/2), critical path indicators, and top/side navigation bars.

2. **feature_1.png**
   - URL: `http://localhost:5173/datacenter` (with slot selected) OR `http://localhost:5173/datacenter/simulations`
   - Description: Real-time Telemetry & Simulation Engine. Shows measured inlet temperature (24.6 °C), relative humidity, vibration RMS, declared CPU power model (P = P_idle + U * (P_busy - P_idle)), and AI Advisory suggestions with alternative options (Options 1–4).

3. **feature_2.png**
   - URL: `http://localhost:5173/datacenter/audit`
   - Description: Facility Immutable Audit Chain. Shows the green "Audit Chain Cryptographically Verified" banner (verified append-only SHA-256 hash chaining from genesis), head hash, and the "Simulate Tamper" demonstration button.

## Optional Extended Feature Screenshots:
- **feature_3_simulations.png** — Multi-scenario facility stress tests (thermal breach, fan vibration, air stagnation, compute surge) with automated AI mitigations.
- **feature_4_forecasts.png** — Capacity exhaustion distribution cone chart with Theil-Sen slope analysis, ETS damped trend, P10/P50/P90 Monte Carlo cones, and `no_breach_fraction`.
- **feature_5_rfid_login.png** — RFID badge authentication interface (`/login`) with 1-click test cards and cryptographic nonce relay.

*Note: Ready-to-use verified application screenshots are already pre-placed in this directory. You can keep them or replace them with your own fresh captures.*
