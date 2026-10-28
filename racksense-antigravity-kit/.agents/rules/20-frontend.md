---
trigger: glob
globs: "*.tsx, *.ts, *.css"
---

# Frontend standards

**Stack.** React + TypeScript (`strict: true`, no `any`) + Vite. API payload types live in one
file, `src/api/contract.ts`, mirrored against `shared/api-contract.md`.

**One API client.** Every fetch goes through it: attaches the token, parses the error envelope,
checks `contract_version` on boot and blocks on a major mismatch.

**One WebSocket hook.** Reconnect with backoff, resync via REST on reconnect, and expose a
`connected | reconnecting | stale` state that the UI actually displays. If the socket is down,
the numbers on screen are old and the interface must say so instead of showing confident stale
values.

**Never drive React state at sensor rate.** Batch incoming frames and commit at most every
500 ms. In the 3D scene mutate refs inside `useFrame`; never re-render the tree per frame.
Use `<Canvas frameloop="demand">` and call `invalidate()` after applying an update.

**Honesty rendering.** Every value carries `meta.quality`:

- `measured` → plain value, no badge (the quiet default)
- `estimated` → dashed outline + `EST.` badge + model formula in the tooltip
- `inferred` → italic + `INFERRED` badge + the `basis` string shown next to it
- `ai_generated` → `AI — ADVISORY` badge on a distinct surface

A `measured` series and an `estimated` series never share a line. A forecast with
`has_trend: false` renders "No sustained trend — no exhaustion forecast" and draws no cone.
`no_breach_fraction` is always displayed.

**No fake data.** No mock constants, no `Math.random()` in a render path, no demo data inside a
component, no chart drawn with nothing behind it, no empty state that renders zeros.

**Every contract error code has a rendering branch.** No generic catch-all that swallows a known
code. Loading, empty, stale and error are designed states, not spinners added at the end.

**Accessibility floor.** Visible keyboard focus, `prefers-reduced-motion` respected, status never
conveyed by colour alone (always an icon or text badge as well), contrast checked against the
real surface.

**Design tokens only.** No hard-coded hex in a component.

**Look: a professional infrastructure console** — Google Cloud Console / Power BI grade, dense
and calm. **Light theme only**: no dark theme, no toggle, no `prefers-color-scheme` handling.
**Outline icons from one set only** (Lucide React), constant stroke, always with a label or
`aria-label`. **No emojis anywhere.** No gradients, glass, glow, illustration or decoration.
Cards are `--surface` on `--canvas`, 1px `--border`, radius 8px, one subtle elevation. Body and
table text 13px. `--primary` means interactive or selected and never carries data.

**Naming.** The all-servers view is the **Data Center Dashboard**; the scoped view is the
**Tenant Dashboard**. The string `admin` must not appear in a route, component, label or title.

**Charts.** Pick the form from the data's job before picking colour. Categorical hues are
assigned in a fixed order and never cycled. Sequential is one hue light→dark; diverging is two
hues with a neutral midpoint. Never a dual-axis chart. Status colours are reserved and ship with
an icon and a label. A legend is present for two or more series.
