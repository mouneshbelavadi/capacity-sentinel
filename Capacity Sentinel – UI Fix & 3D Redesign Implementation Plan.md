# Capacity Sentinel – UI Fix & 3D Redesign Implementation Plan

Prepared for Preetham · 28 Oct 2026 · Scope: frontend only, 2-server demo, demo data only, no new features

## 1. Where things stand

This plan is built from your saved chat (the .webarchive). The `capacity-sentinel.zip` itself was not part of this upload, so I could not re-run the tests myself. Everything below about test results comes from the previous session's logs. To continue testing or apply the changes, re-upload the zip.

**Phase 1 work already done in the previous session (in a Linux copy, not yet exported):**

- Audit Log reload loop: a new test ("loads rows and verifies the chain exactly once") fails on your original `AuditView.tsx` and passes on the fixed one, so the bug is confirmed and the fix is verified.
- Racks sidebar did nothing: a `racks` section and route were added in `App.tsx` (`/datacenter/racks`, `/tenant/racks`). Both dashboards got a `view` prop so the Racks page shows the rack rail, 3D hall and summary without the activity feed. The sidebar item highlights correctly.
- `ws.ts`: the changepoint subscribe function was recreated every render, which re-ran consumers' effects on every tick. It is now a stable module-level function.
- `Shell.tsx`: the toast timer was cleared inside the subscription callback, which did nothing. It now uses a ref and is cleaned up on unmount.
- Dead controls (global search box, metric filter dropdown) are now honestly disabled with a tooltip rather than faking behaviour.
- Result: `tsc` clean, 90/90 tests passing (88 original + 2 new).

**Not finished:** exporting the changed files and the diff (the session was cut off by the usage limit), and the live browser pass on `127.0.0.1:9222` (the browser subagent never reported back).

## 2. Phase 1 – Bug fixes (no redesign)

### Remaining checklist

1. Export the changed files: `App.tsx`, `Shell.tsx`, `ws.ts`, `AuditView.tsx`, `DataCenterDashboard.tsx`, `TenantDashboard.tsx`, and `test/phase1-fixes.test.tsx`, plus a single unified diff.
2. Live browser pass on both roles (Operator and Tenant): click every sidebar item, every button, every tab, and watch the Network panel on the Audit page for repeated requests.
3. Confirm the 3D hall behaves: orbit, zoom limits (7–32), click a slot, click empty space to deselect, and check there is no WebGL context loss when switching pages.
4. Check the other views for dead controls: Approvals, Forecast, Access Control, Slot detail panel.
5. Verify the Tenant view's "Racks" page and its role redirect still work.
6. Re-run `tsc -b` and `vitest run` on a clean `npm install` (the original `node_modules` was built on macOS and fails on Linux, which is an environment issue, not a code bug).

### Phase 1 – Prompt A (apply and verify fixes)

> You are working in the `capacity-sentinel/frontend` project. Do NOT add features or redesign anything. Apply only bug fixes. 1) Fix the Audit Log page so it fetches `/api/audit` and `/api/audit/verify` exactly once on mount and again only on explicit user action; find the unstable effect dependency causing the loop and fix it at the source. 2) Make the Racks sidebar item navigate to `/datacenter/racks` (operator) or `/tenant/racks` (tenant) and highlight as active, showing the rack rail, 3D hall and rack summary only. 3) Make `onChangepoint` in `api/ws.ts` a stable function and fix the toast timer in `Shell.tsx` using a ref with cleanup on unmount. 4) Disable (not delete) controls that have no behaviour, with a tooltip. Add tests for the audit single-fetch and racks navigation. Run `npx tsc -b` and `npx vitest run` and show the output. List every file you changed.

### Phase 1 – Prompt B (live verification)

> Using the browser at `127.0.0.1:9222`, log in as Operator, then as Tenant. Visit every sidebar page. For each page, click every visible button, tab, dropdown and table row, and report: what happened, what should have happened, and any console errors. On the Audit page, count network requests over 10 seconds and confirm there is no repeating request. On the 3D hall, test orbit, zoom, slot click, deselect, and switching pages ten times to check for memory or WebGL context errors. Do not change any code in this step. Output a table of remaining bugs with severity (blocker / annoying / cosmetic) and the file most likely responsible.

**Done when:** no repeating network calls, every enabled control does something, every disabled control explains why, tests and typecheck pass.

## 3. Phase 2 – 3D redesign

### 3.1 Target look (from your reference image)

The reference is a dark, cinematic "digital twin" console: a glowing 3D scene in the centre, translucent glass side panels on the left and right, a thin top bar with tabs, and a bottom mode switcher (Power / HVAC / Alarm). We adopt that layout for the data hall, scaled down to your demo.

| Reference element | Our version |
| --- | --- |
| Central 3D building scene | 3D data hall with exactly 2 server racks (Rack A, Rack B), floor grid, soft glow |
| Left glass panels (Overview, Classification, Statistics) | Overview counts, status donut (OK / WARN / CRIT / Offline), rack capacity bars |
| Right glass panels (Consumption, Statistics, Trends) | Power gauge, small stat tiles, one live trend line |
| Callout card floating by the building | Floating label that follows the selected rack or slot |
| Bottom mode switcher | Layer switcher: Status / Power / Thermal / Alarm, which recolours the racks |
| Top bar with tabs | Keep existing nav, restyled |

### 3.2 Design decisions (kept simple)

- **Dark theme only for the hall page and shell**, using new CSS tokens (deep navy background, cyan accent, glass panels with blur and a thin border). Status colours stay semantic: green OK, amber WARN, red CRIT, grey offline.
- **Demo-driven, not data-driven:** a single `demoScenario` module defines scenes such as *Normal*, *Rack A fan fault*, *Rack B overheating*, *Power spike*. The 3D scene reads only from this. A small "Scenario" dropdown lets you trigger them during the demo. No dependence on the real backend.
- **Camera:** three preset positions (Overview, Rack A, Rack B) with a smooth animated fly-to when you click a rack, a rack label, or a button. A "Back to hall" button returns to the overview.
- **Fault visualisation:** WARN gives a slow amber pulse; CRIT gives a red pulse with a floating alarm tag; OFFLINE dims and desaturates the rack; thermal layer shows a heat-glow gradient; power layer scales an emissive strip with load.
- **Performance:** keep the existing `frameloop="demand"` approach where possible, but switch to continuous rendering only while an animation or pulse is active. Cap pixel ratio at 2. Keep the existing 2D fallback for devices without WebGL.
- **Good extras that do not add complexity:** a subtle floor grid and fog, hover highlight with a tooltip, a keyboard shortcut set (1/2/3 for camera presets), and a "reduced motion" setting that disables pulses and camera easing.

### 3.3 3D models – where to get them

All options below have free server-rack or data-centre models. Always check each model's licence (CC0 or CC-BY is fine for a demo; credit if required).

- **Sketchfab** (search "server rack", filter Downloadable and licence CC): download as glTF/GLB.
- **Poly Pizza** (poly.pizza): low-poly CC0/CC-BY models, small files, ideal for a demo.
- **Kenney.nl**: CC0 asset packs; check for a suitable tech or furniture pack.
- **Quaternius**: CC0 low-poly packs.
- **Build it procedurally** (recommended fallback): a rack is a box frame with 8–12 slim "server unit" boxes and small emissive LED planes. It needs no download, matches the existing code, and is easy to recolour per status.

Process for any downloaded model: convert to `.glb`, compress with `gltf-transform` (Draco and texture resize), keep each file under about 2 MB, put it in `public/models/`, and load it with `useGLTF` from `@react-three/drei`.

### 3.4 Work breakdown

1. **Foundations:** dark tokens, glass panel component, layout grid (left rail / centre canvas / right rail / bottom switcher).
2. **Scene:** floor, grid, lighting, fog, two racks (model or procedural), post-processing bloom (light, optional).
3. **Demo engine:** `demoScenario` module and Scenario dropdown; racks and panels subscribe to it.
4. **Interaction:** camera presets with fly-to, click and hover, floating callout, layer switcher.
5. **Panels:** overview counts, status donut, capacity bars, power gauge, trend line, all fed from the demo scenario.
6. **Polish and checks:** reduced motion, WebGL fallback, responsive layout, tests, build.

### Phase 2 – Prompt A (foundation and scene)

> Phase 1 is complete and merged. Now implement Phase 2, part 1, of the redesign. Do not add features beyond this brief. Goal: a dark, glassy 3D data-hall page like a "digital twin" console. 1) Add dark theme tokens (navy background, cyan accent, glass panel style with backdrop blur and thin border) scoped to the Data Hall and Shell; keep status colours green/amber/red/grey. 2) Create a layout with a left panel rail, a centre React Three Fiber canvas, a right panel rail and a bottom layer switcher bar (Status / Power / Thermal / Alarm). 3) In the canvas render a floor with a faint grid, soft lighting, light fog, and exactly 2 server racks. Use a procedural rack (frame plus 10 server-unit boxes with emissive LED strips) unless I supply a `.glb` in `public/models/`. 4) Racks must recolour per layer using a single `getRackVisual(layer, rackState)` helper. 5) Keep the existing WebGL fallback. Keep `tsc` and all tests passing, and add tests for the layer helper. Show me what you changed.

### Phase 2 – Prompt B (demo engine, interaction, panels)

> Continue Phase 2, part 2. Do not change the backend or real API. 1) Create a `demoScenario` module with scenarios: Normal, Rack A fan fault (WARN then CRIT), Rack B overheating, Power spike, Rack B offline. Each defines per-rack status, temperature, power and a short event text. Add a Scenario dropdown that switches between them, plus an optional auto-play that steps through them every 8 seconds. 2) The 3D racks, side panels and trend chart must read only from the active scenario. 3) Add camera presets (Overview, Rack A, Rack B) with a smooth fly-to when a rack or button is clicked, a "Back to hall" button, and keys 1/2/3. 4) Add a floating callout that follows the selected rack and shows name, status, temperature and power. 5) Fault visuals: WARN slow amber pulse, CRIT red pulse with an alarm tag, OFFLINE dim and desaturated. Pulses must only force continuous rendering while active. 6) Add a reduced-motion option that disables pulses and uses instant camera moves. 7) Build the left and right panels (counts, status donut, capacity bars, power gauge, trend) with simple SVG or existing chart components. Add tests for scenario switching and camera preset selection, then run `tsc`, `vitest` and `vite build` and report results.

**Done when:** switching a scenario visibly changes the racks and panels within a second, clicking a rack flies the camera to it and back, and the page stays smooth on a normal laptop.

## 4. Suggested order and effort

| Step | What | Rough effort |
| --- | --- | --- |
| 1 | Phase 1 Prompt A (apply and export fixes) | 1 session |
| 2 | Phase 1 Prompt B (live verification) | 1 session |
| 3 | Choose rack model or go procedural | 30 min |
| 4 | Phase 2 Prompt A | 1–2 sessions |
| 5 | Phase 2 Prompt B | 1–2 sessions |
| 6 | Demo rehearsal with all scenarios | 1 hour |

## 5. Risks to watch

- Usage limits cut the last session short, so run the prompts one at a time and ask for the changed-file list each time.
- Downloaded models can be heavy or badly scaled; the procedural rack is the safe fallback.
- Continuous rendering can drain battery; keep demand-based rendering outside active animations.
- Dark theme should apply to the hall and shell only, so the other views are not broken by token changes.
