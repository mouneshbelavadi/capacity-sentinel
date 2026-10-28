# Frontend prompts — run in order

Each file is a **standalone prompt**. Paste one per Antigravity session (or one per task).
Never run two at once, and never skip ahead.

**Before every single prompt, run `startup.md`.** Do not begin a phase until it printed
`STARTUP COMPLETE`.

**Read `shared/design-system.md` before Phase 1 and keep it open for every phase.** It holds the
visual direction, the tokens, the chart specifications and the ten skills you must apply.

| Order | File | Builds | Done when |
|---|---|---|---|
| 1 | `phase-1-foundation.md` | Vite + TS, design tokens, API client, contract types, login, role routing, app shell | Two roles log in and land on different dashboards |
| 2 | `phase-2-topology.md` | Data Center Dashboard + Tenant Dashboard, rack/slot cards, status, empty states | A tenant's screen visibly cannot show a neighbour |
| 3 | `phase-3-realtime.md` | WebSocket hook, live values, provenance badges, connected/stale states | Warming a sensor moves the number within 500 ms |
| 4 | `phase-4-charts.md` | Forecast cone, change-point markers, attribution, estimated power, table views | A real forecast renders with its band and no-breach fraction |
| 5 | `phase-5-hall.md` | The hero: live 3D rack hall in react-three-fiber | Racks change colour live at ≥50 fps |
| 6 | `phase-6-approval.md` | AI panel, proposal → discuss → Proceed → tap, audit view | A card tap flips the UI to AUTHORIZED with the head hash |

## Face-to-face with the backend

`shared/api-contract.md` is the single source of truth. The frontend may assume **nothing** that
is not written there. If you need a change: bump `CONTRACT_VERSION`, edit the contract, update
both sides in the same change, append to the Changelog, and say so in the commit's first line.

Types for every payload live in **one** file, `src/api/contract.ts`, mirrored against the
contract. No payload type is declared anywhere else.

## Reference repositories

- https://github.com/vitejs/vite
- https://github.com/facebook/react
- https://github.com/microsoft/TypeScript
- https://github.com/tailwindlabs/tailwindcss
- https://github.com/pmndrs/react-three-fiber
- https://github.com/pmndrs/drei
- https://github.com/mrdoob/three.js
- https://github.com/recharts/recharts
- https://github.com/pmndrs/zustand
- https://github.com/TanStack/query
- https://github.com/motiondivision/motion
- https://github.com/testing-library/react-testing-library
- https://github.com/microsoft/playwright

Do **not** add a component library that imposes its own look (the design direction is specific
and a generic kit will fight it), a charting wrapper on top of Recharts, Redux, or a CSS-in-JS
runtime.

## Layout every phase writes into

```
frontend/src/
  api/          contract.ts (types), client.ts (the one fetch wrapper), ws.ts (the one socket hook)
  app/          routing, role gates, providers
  design/       tokens.css, primitives (Card, Value, StatusBadge, Chip, KpiTile, DataTable, DetailPanel)
  features/
    datacenter/   Data Center Dashboard
    tenant/       Tenant Dashboard
    hall/         3D rack hall
    forecast/     cone + charts
    approval/     AI panel, proposal flow
    audit/        activity grid + chain verification
  lib/          formatting, provenance helpers, time
```

## The look, in one line

A professional infrastructure console — Google Cloud Console / Power BI grade. **Light theme
only** (no dark theme, no toggle), **outline icons from one set only**, **no emojis**, no
gradients or decoration. Dense, calm, and built for someone who reads it for hours.

## The two rules that outrank convenience

1. **No fake data.** No mock constants, no `Math.random()` in a render path, no demo data inside
   a component, no chart drawn with nothing behind it, no empty state that renders zeros.
   When there is no data, say there is no data.
2. **Never the word `admin`.** The all-servers view is the **Data Center Dashboard**; the scoped
   view is the **Tenant Dashboard**; the elevated role is "Super User".
