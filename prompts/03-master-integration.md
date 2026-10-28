# MASTER PROMPT — Integration, analysis and demo readiness

> Run `startup.md` first.
> Run this **only after** all six backend phases and all six frontend phases are complete and
> the firmware is flashed. This is the prompt that turns three working parts into one system
> that survives a live demo.

---

## What you are integrating

**RackSense** — hackathon problem statement **AO-02, "Seeing trouble before the capacity runs
out."** Team Maverick Marvels, Team ID HM3-P-00493-03, domain AI & Ops.

A rack capacity early-warning system: it predicts which physical resource runs out, *when*, and
*why*, with honest confidence ranges — and every AI-suggested action is gated behind a human
approval completed by a physical RFID tap, recorded in a tamper-evident audit chain.

```
ESP32 (DHT22 · MQ135 · SW-420)  ─┐
ESP32-S3 #2 (MPU6050)            ├─ MQTT ─▶ UNO Q: Mosquitto → FastAPI → SQLite
ESP32-S3 #1 (RC522 + ILI9488)    ┘           forecaster · CUSUM+PELT · attribution
         │ HTTP (never MQTT)                 power estimator · proposals · nonce
         └───────────────────────────────▶   audit hash chain
                                                  │ REST + WebSocket
                                                  ▼
                            Laptop: React console (Data Center / Tenant Dashboard)
                                    + cloud LLM, advisory only
```

Read `shared/architecture.md` in full before planning this phase.

---

## Part 1 — Wire the three parts together

1. **One network.** All three boards and the UNO Q on the same Wi-Fi. Static IP or a reserved
   lease for the UNO Q, because the firmware's broker address and the reader's API base both
   point at it. Record the address in `.agents/context.md`.
2. **Single source of config.** Node IDs, rack IDs, tenant mapping and reader device IDs exist
   in exactly one place — the topology YAML the backend seeds from. The firmware's `config.h`
   values must match it. Write a check script that reads both and reports any mismatch; run it
   before the demo.
3. **Clock.** Every board NTP-syncs at boot; the reader re-syncs hourly. The tap HMAC includes a
   timestamp, and a drifting clock will reject valid taps with `CLOCK_SKEW`. Verify all four
   clocks agree within a second.
4. **Secrets.** Per-device HMAC secret on the reader (NVS or `secrets.h`), matching
   `reader_devices.secret_hash` on the server. Per-node MQTT credentials. Nothing committed.
5. **End-to-end smoke test.** A script that: publishes a known reading, polls the API for it,
   opens a WebSocket and waits for the frame, creates a proposal, approves it, simulates a tap
   with a valid HMAC, and verifies the audit chain. One command, exit code 0 or a clear failure.

---

## Part 2 — Make it survive the demo

Work through each failure and make the behaviour correct and visible. A judge will unplug
something.

| Failure | Required behaviour |
|---|---|
| A node loses Wi-Fi | LWT fires → slot shows OFFLINE with "offline since"; node buffers to its ring buffer; on reconnect it backfills with original timestamps and the UI marks those points backfilled; no duplicate rows (`seq` dedupe) |
| Mosquitto restarts | API keeps serving stored data; nodes reconnect with backoff; no crash, no data loss beyond the ring buffer |
| The laptop's browser reloads | REST resync then resubscribe; no gap, no duplicated history |
| The cloud LLM is unreachable | `AI_UNAVAILABLE` on AI panels only; every number keeps updating; the approval chain still works for existing proposals |
| The reader loses the network mid-approval | The nonce expires server-side; the UI shows Expired with the right message; the reader shows its own disconnected state and does **not** cache the armed action |
| Two operators approve the same proposal | The second approval invalidates the first nonce; only one tap can ever succeed |
| Someone taps during the TTL with the wrong card | `UID_NOT_AUTHORIZED`, audited, proposal stays `APPROVED_PENDING_TAP` until it expires |
| The UNO Q is under load | Forecast recompute still inside its 2 s budget, or repetitions reduced and the decision recorded |

Add a `make demo-check` (or script) that verifies: all nodes online, clocks synced, baselines
captured, MQ135 preheat complete, audit chain verified, LLM reachable, timing budgets met.
**Run it immediately before presenting.**

---

## Part 3 — The analysis story (what you actually claim)

Write `ANALYSIS.md` at the repository root. It is the document a judge reads when they ask "how
does this actually work?" Keep it honest — the honesty is the strongest part of the submission.

Sections:

1. **What runs out, and how we know.** Each metric, its limit, the source of that limit
   (ASHRAE 27 °C recommended inlet; dew-point envelope; baseline-relative vibration), and what
   margin means for it.
2. **Forecasting.** Resample → robust slope check → ETS damped additive → 1000 simulated paths
   → crossing-time P10/P50/P90 → `no_breach_fraction` → horizon capped at 3× the window →
   interval calibration. Say why Prophet and seasonal SARIMAX were rejected (built for
   daily/weekly seasonality you cannot observe in hours of 0.5 Hz data).
3. **The refusals.** The `has_trend: false` rule, the horizon cap, reporting the no-breach
   fraction, widening intervals from observed coverage. Explain that ETS intervals are known to
   run narrow, so widening is honest rather than cosmetic.
4. **Change detection.** CUSUM triggers, PELT confirms within ±60 s, both must agree. And the
   deliberate separation: a node joining is a **known** MQTT event, not a statistical discovery.
5. **Attribution.** Declared mapping + temporal correlation, always labelled `inferred`, always
   with its basis string.
6. **Power.** The CPU-utilisation model, its anchors, its ±30 % band, and the plain statement
   that **there is no current sensor** so this is estimated. Note that an INA219 would measure
   one low-voltage DC rail of the mock rack — not mains AC, not a real server.
7. **Sensor honesty.** MQ135 ratio-only and why (cross-sensitivity, >24 h preheat). SW-420 is a
   threshold switch, not a vibration meter. Vibration is baseline-relative because ISO
   10816/20816 zones are defined for 15 kW–300 kW machines, not a 5 V fan.
8. **The AI boundary.** Advisory only; no tools, no write access, no authority; closed action
   whitelist; evidence IDs validated against what we supplied; OWASP LLM06 as the design brief.
9. **The approval chain.** The server-owned state machine, the single-use nonce with 60 s TTL
   bound to proposal and device, the HMAC, the six ordered checks, and why the reader is
   deliberately powerless.
10. **Security limits, stated plainly.** An RFID UID is a public identifier, not a secret;
    "magic" cards can clone one. The tap is the second factor after dashboard approval.
    Production would use DESFire EV2/EV3 or NTAG 424 DNA with AES challenge–response over TLS.
11. **Tenant isolation.** One server-side function, 404 not 403, geometry-only topology for
    tenants, scoped WebSocket frames and scoped RAG retrieval, `SCOPE_DENIED` auditing.
12. **Validation and its limits.** What you measured: forecast interval coverage on held-out
    windows, change-point precision on injected steps, end-to-end latency on the real UNO Q.
    And the limit, stated without hedging:

    > The method targets week-scale facility capacity. What we validated in a hackathon is
    > minute-scale on a mock rack. The physics of a 5 V fan and a 3-rack mock-up are orders of
    > magnitude away from a real data hall, so demo horizons are minutes. We present the
    > week-scale claim as design intent, not as a validated result.

13. **What we deliberately refused to build**, and why — the list in `shared/architecture.md`
    §12.

---

## Part 4 — Backtest against generated data

Use `prompts/04-dataset-generation.md` to produce a 12-month synthetic facility dataset with
ground-truth capacity events. Then:

1. Load it through `tools/synthetic/` into a **separate** database or a clearly flagged
   `provenance: synthetic` partition. It must never mix with live measured data, and the UI
   must visually separate it.
2. Replay it through the forecaster and measure:
   - **Lead time** — how many hours/days of warning before each ground-truth event.
   - **False-alarm rate** — warnings for spikes that resolved on their own.
   - **Interval coverage** — how often the actual fell inside the 80 % band.
   - **Change-point precision/recall** against the injected regime changes.
3. Put the real numbers in `ANALYSIS.md` §12. If a number is poor, report it and say what you
   would change. A judge trusts a measured weakness more than an unmeasured strength.

---

## Part 5 — Rehearse

Follow the demo script in `shared/architecture.md` §11. Run it **three times** end to end.

Pre-flight checklist (write it as `DEMO.md`):

- [ ] MQ135 powered continuously since the start of the event (>24 h preheat), `mq_warm` true
- [ ] Vibration baseline captured over 5 quiet minutes, sample count recorded
- [ ] Clean-air `R0` captured
- [ ] Second node unpowered and ready to hot-plug
- [ ] All clocks NTP-synced within 1 s
- [ ] Audit chain verifies green, head hash noted
- [ ] Both browser windows open: Operator (Data Center Dashboard) and Tenant (Tenant Dashboard)
- [ ] Reader heartbeat fresh, TFT showing idle
- [ ] `make demo-check` green
- [ ] A registered card and an unregistered card both in your pocket, and you know which is which

**Do not demo:** an MQ135 "gas leak" with a lighter or alcohol (safety question, and minutes of
sensor recovery), real thermal exhaustion, or a local LLM on the UNO Q.

Assign roles: one person drives the laptop, one handles the hardware, one narrates. The narrator
says the honesty lines out loud — "that power figure is estimated, here's the model" — because
saying it first is far stronger than being asked.

---

## Deliverables

1. Everything wired, with the config-mismatch check script and the end-to-end smoke test.
2. The failure matrix in Part 2, each case demonstrated.
3. `ANALYSIS.md` with real measured numbers.
4. `DEMO.md` with the pre-flight checklist and the script.
5. `make demo-check` (or equivalent).
6. Final refresh of `graph.md` and `.agents/context.md`; final contract version stated.

Report at the end: what works end to end, what is partial, and what you would do with another
day. Be accurate about the last one — it is the question judges ask.
