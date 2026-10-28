# RackSense — Antigravity build kit

Everything needed to build **RackSense** for hackathon problem statement **AO-02, "Seeing
trouble before the capacity runs out."**

Team Maverick Marvels · Team ID HM3-P-00493-03 · Domain AI & Ops.

**What it is:** a rack capacity early-warning system. It predicts which physical resource runs
out, *when*, and *why*, with honest confidence ranges — and every AI-suggested action is gated
behind a human approval completed by a physical RFID tap, recorded in a tamper-evident audit
chain.

**What is in this kit:** prompts you paste into Antigravity to build the backend and the
frontend, the shared contract both sides are built against, the agent rules, and the complete
firmware. The firmware is the only code here; Antigravity writes the rest.

---

## Use it in this order

```
1. startup.md                          ← run FIRST, every single session, before any prompt
2. prompts/backend/phase-a … phase-f   ← six prompts, one per session, in order
3. prompts/frontend/phase-1 … phase-6  ← six prompts, one per session, in order
4. prompts/03-master-integration.md    ← wire it together, write ANALYSIS.md, rehearse
```

Standalone, use whenever you need them:

```
prompts/04-dataset-generation.md   → paste into another AI tool to generate backtest data
prompts/05-circuit-diagram.md      → paste into a circuit-diagram tool (prose + netlist)
```

The firmware is already written — flash it from `hardware/`.

---

## Files

```
startup.md                  Run before every prompt. Regenerates graph.md, refreshes
                            .agents/context.md, installs the workspace rules, then waits.
rules.md                    The full agent rules, with reasoning.
AGENTS.md                   The enforceable core, ready to drop in the repo root.
.agents/rules/              Antigravity workspace rules with correct frontmatter:
                              00-racksense-core.md   always_on
                              10-contract.md         always_on
                              20-frontend.md         glob: *.tsx, *.ts, *.css
                              30-backend.md          glob: *.py

shared/
  api-contract.md           THE source of truth. Backend and frontend are built face-to-face
                            against this one file. v1.0.0.
  architecture.md           Four layers, every analysis method, and what we refuse to do.
  design-system.md          Visual direction, tokens, chart specs, the ten skills to apply.
  tenant-isolation.md       Roles, scoping rules, and how to prove isolation on stage.
  hardware-connections.md   Full pin map and wiring for all three boards.

prompts/
  backend/   README.md + phase-a-ingest … phase-f-realtime
  frontend/  README.md + phase-1-foundation … phase-6-approval
  03-master-integration.md
  04-dataset-generation.md
  05-circuit-diagram.md

hardware/                   The only code in this kit.
  node_env_esp32/           ESP32 + DHT22 + MQ135 + SW-420
  node_vib_esp32s3/         ESP32-S3 + MPU6050
  auth_console_esp32s3/     ESP32-S3 + RC522 + ILI9488 TFT
```

---

## The five rules everything else serves

1. **No fake data.** Every number is `measured`, `estimated`, `inferred`, `ai_generated` or
   `synthetic`, and carries that label. No mock constants, no placeholder values, no chart drawn
   from nothing. When there is no data, the UI says there is no data.
2. **The contract is face-to-face.** `shared/api-contract.md` is shared by both sides. Never
   change one side — bump the version, edit the contract, update both, append to the Changelog.
3. **Tenant isolation is server-side**, in one function, enforced by a test that fails if any
   new query skips it. A tenant asking for a foreign resource gets **404**, never 403.
4. **The AI advises; it never acts.** No tools, no write access, no authority. Closed action
   whitelist, evidence IDs validated against what we supplied.
5. **The reader holds no authority.** It relays a tap for an action the server already armed
   with a single-use nonce. It cannot arm, decide, or cache.

Plus one naming rule: the all-servers view is the **Data Center Dashboard**, the scoped view is
the **Tenant Dashboard**, the elevated role is **Super User**. The word *admin* appears nowhere.

---

## The look

A professional infrastructure console — Google Cloud Console / Power BI grade. Dense, calm,
built for someone who reads it for hours.

**Light theme only** (no dark theme, no toggle), **outline icons from one set only**,
**no emojis**, no gradients or decoration. Full specification in `shared/design-system.md`.

---

## Hardware

| Board | Role |
|---|---|
| Arduino UNO Q | Edge server: Mosquitto broker + FastAPI + SQLite + the analysis engine |
| ESP32 dev module | Environment node: DHT22, MQ135, SW-420 |
| ESP32-S3 #2 | Vibration node: MPU6050 |
| ESP32-S3 #1 | Authorization console: RC522 + 3.5" ILI9488 TFT |
| Laptop | Dashboard host; calls the cloud LLM |

---

## What this project will not claim

Worth knowing before you present, because saying these first is stronger than being asked:

- **Power is estimated, not measured.** There is no current sensor. The model is a
  CPU-utilisation linear fit with a ±30 % band, and the formula is visible in the UI.
- **The MQ135 reports a ratio, never ppm.** It is broadly cross-sensitive and needs >24 h
  preheat.
- **Vibration is relative to a captured baseline, never an absolute ISO zone.** ISO 10816/20816
  is defined for 15 kW–300 kW machines, not a 5 V fan.
- **An RFID UID is a public identifier, not a secret.** The tap is the second factor after
  dashboard approval, scoped by a single-use nonce with a 60 s TTL and an HMAC.
- **No LLM runs on a microcontroller.** A 1 B model at 4-bit is ~0.5 GB of weights; the ESP32-S3
  has 512 KB SRAM and 8 MB PSRAM. It is off by orders of magnitude.
- **Week-scale forecasting is design intent, not a validated hackathon result.** What was
  validated is minute-scale on a mock rack, and the demo shows minutes.

The honesty is not a disclaimer section. It is the product.
