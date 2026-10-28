---
trigger: always_on
---

# RackSense — core rules

Project: a rack capacity early-warning system (hackathon problem statement AO-02). It predicts
which rack resource runs out, when and why; every AI suggestion is gated behind a human
approval completed by a physical RFID tap.

Ground truth, read before acting: `rules.md`, `shared/api-contract.md`,
`shared/architecture.md`, `shared/tenant-isolation.md`, `shared/hardware-connections.md`.
At session start, run `startup.md`.

## The core rule

**No fake data. No hard-coded values. No invented numbers.** Every displayed number is
`measured`, `estimated`, `inferred`, `ai_generated` or `synthetic` and carries that label in
`meta.quality`. No unlabelled numbers. No mock constants, no `Math.random()` in a render path,
no demo data inside a component or route, no chart drawn with nothing behind it, no empty state
that renders zeros. **When there is no data, say there is no data.**

## Non-negotiables

1. `shared/api-contract.md` is shared face-to-face by backend and frontend. Never change one
   side. To change: bump `CONTRACT_VERSION`, edit the contract, update both sides together,
   append to the Changelog.
2. Tenant isolation is server-side, in `apply_scope(query, scope)` (`repos/scope.py`), called by
   every tenant-data query. A tenant requesting a foreign resource gets **404**, never 403.
3. The word **`admin` is banned** in routes, components, tables, labels, titles and logs. The
   elevated role is `SUPER_USER` ("Super User"). The all-servers view is the **Data Center
   Dashboard**; the scoped view is the **Tenant Dashboard**.
4. The LLM is advisory: no tools, no write access, no authority. `action` from the closed
   whitelist, `evidence` IDs only ones we supplied; violations are discarded and audited.
5. The RFID reader holds no authority. It relays a tap for an action the server already armed
   with a single-use nonce (TTL 60 s) bound to that proposal and device.
6. The audit log is append-only and hash-chained. No UPDATE or DELETE path exists.
7. Nothing writes to a facility control. Telemetry flows up only; the system advises.
8. No secrets in the repo. `.env` / `secrets.h` / NVS, gitignored, with `.example` files.

## Honesty

`measured` and `estimated` never share a line. Power is always `estimated` here (no current
sensor) with its formula in the tooltip. A forecast is always a distribution — if `has_trend`
is false, render "No sustained trend — no exhaustion forecast" and draw no cone; always show
`no_breach_fraction`. MQ135 reports a ratio, never ppm, and "warming up" until preheat ends.
Vibration is relative to a captured baseline, never an absolute ISO zone. Never present "weeks
ahead" as a validated hackathon result.

## Method

Plan before building. Small verifiable steps. Finish what you start — no `TODO`, no stub
returning a constant, no commented-out "for later". Never silently widen scope. Read before you
write; never add a second implementation of scoping, hashing or forecasting. Ask when ambiguous,
especially around isolation, authorization or the audit chain. Verify by running it.

## Finishing a run

Regenerate `graph.md`. Update `.agents/context.md` (state, subsystem table, append-only decision
rows, next actions). State what changed in the contract, or "contract unchanged". List anything
unfinished. A run that edits code without refreshing those two files is not finished.

## Refuse

Mock data to fill a screen · single-number ETAs · ppm from MQ135 · ISO zones on a small fan ·
"measured" power without a sensor · giving the LLM tools, write access or authority · running an
LLM on a microcontroller · client-side-only permission checks · an `admin` route or label ·
editing or deleting an audit row.
