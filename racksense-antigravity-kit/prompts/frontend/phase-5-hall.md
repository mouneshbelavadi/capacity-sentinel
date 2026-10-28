# FRONTEND — PHASE 5 · The 3D rack hall (the hero)

> Run `startup.md` first. Phases 1–4 must be working.
> Read `shared/design-system.md` §1 and §4, and `shared/api-contract.md` §3.

---

## Goal of this phase

Replace the flat rack grid with the thing people will remember: a **live 3D rack hall** where
racks and their slots change colour as real sensors change.

This is where the design boldness is spent. Everything around it stays quiet.

It must also stay **fast and honest**: ≥50 fps on an integrated GPU, and a slot whose data you
are not allowed to see must look unmistakably like "not shown", never like "fine".

---

## Stack

`@react-three/fiber` + `@react-three/drei` (`OrbitControls`, `Html`, `Edges`). Nothing else.

**Scope cuts that are not negotiable** — they are what keeps this shippable and fast:
- No imported GLTF data-hall models. Box geometry only.
- No shadows, no post-processing, no physics, no environment maps.
- No loading screen for assets, because there are no assets.

A hand-built hall of boxes with hard black edges matches the design direction better than a
downloaded model would, and it will not cost you the night.

---

## Build

### 1. The scene

- One row of **2–4 racks**, each a box with 8–12 slot boxes inside it.
- **Light, restrained materials.** Rack chassis in a light neutral (`--surface-sunken`), slots
  filled with their status token at low saturation, and a thin `<Edges>` outline in
  `--border-strong` — **not black**. The hall must read as part of the same light console as
  the cards around it, not as a separate dark 3D product.
- Floor: a flat plane in `--canvas` with a faint 1px grid in `--border`. No reflections, no
  gradient, no environment map.
- Soft ambient + one directional light, both low contrast. No shadows.
- Camera: `OrbitControls` with clamped polar angle and zoom so the user cannot end up under the
  floor or inside a rack. Default to a three-quarter view that reads instantly.

### 2. Colour = status, plus a label

Slot colour comes from the API `status` through the **status tokens** (`--ok`, `--warn`,
`--crit`, `--offline`). Never from a threshold computed in the frontend.

Because colour alone is not accessible, every non-OK slot also carries a `<Html>` marker
anchored to it — the same **outline icon** used in the 2D `<StatusBadge>` plus the status word —
and the selected slot shows its full label. A judge with colour-vision deficiency must read the
same hall. **No emojis as markers.**

### 3. Foreign slots — unmistakably not data

A tenant sees the full geometry but foreign slots arrive as `status: "UNKNOWN"`. Render those
with the hatch texture and **no status colour at all** — plus a small "Not your slot" label on
hover.

Do not render them in a neutral grey that could read as OK. The whole point of showing the
geometry is orientation, not implication.

### 4. Performance — the rules that actually matter

- `<Canvas frameloop="demand">`. The scene renders **on data, not on a clock**.
- Call `invalidate()` after applying a batched update from the WebSocket hook.
- Mutate `ref.current.material.color` inside `useFrame` or directly in the update handler —
  **do not re-render the React tree per frame**.
- Past ~100 identical boxes, switch to `InstancedMesh`.
- Telemetry already arrives batched at ≤500 ms from Phase 3; the hall consumes the same batched
  store. It must not subscribe to raw frames.

Measure with the stats panel and the React profiler. If moving a sensor causes a React commit
storm, the wiring is wrong — fix it before adding anything else.

### 5. Interaction

- Hover a slot → outline brightens, tooltip with node ID, tenant and current status.
- Click a slot → selects it; the right column shows that slot's detail and forecast (Phase 4
  components, unchanged).
- Click empty space → deselect.
- **Keyboard parity is required**: the hall is not the only way to select a slot. The left rail
  list stays fully keyboard-navigable and selecting there highlights the slot in 3D. A 3D-only
  interaction would make the app unusable without a mouse.

### 6. The one motion moment

On escalation (OK→WARN→CRIT), the slot gets a **single** 600ms highlight sweep in its status
tint, synchronised with the 2D row highlight from Phase 3. That is the whole motion budget for
the hall.

No idle rotation, no floating, no ambient animation. A hall that drifts on its own is noise and
it will also keep `frameloop="demand"` from ever saving you a frame.

`prefers-reduced-motion: reduce` disables the pulse; the colour change still happens instantly.

### 7. Fallback

If WebGL is unavailable, render the Phase 2 flat rack grid instead, with a one-line note. Do not
show a broken canvas, and do not block the dashboard on 3D.

---

## Skills — apply every one, and report how

Minimum: real-time 3D rendering, performance budgeting, visual design identity, accessibility,
information honesty, design tokens.

Include your measured frame rate and the profiler evidence in the report.

---

## Hard rules

- ≥50 fps with live data on an integrated GPU. Measure it; do not assume it.
- `frameloop="demand"` + `invalidate()`. No per-frame React renders.
- Status from the API, never computed in the frontend.
- Colour never alone — always a letter badge too.
- Foreign slots look like "not shown", never like "fine".
- No GLTF, no shadows, no post-processing, no idle animation.

---

## Acceptance — show me

1. The hall live: warm a real DHT22 and watch a slot go OK → WARN → CRIT with one pulse each.
2. Stats panel showing ≥50 fps with two nodes publishing.
3. Profiler: React commits stay flat while the hall updates.
4. Tenant view: foreign slots hatched, no status colour, "Not your slot" on hover.
5. Keyboard-only: select a slot from the rail, see it highlight in 3D, open its detail.
6. `prefers-reduced-motion: reduce` → no pulse, colour still changes.
7. Force WebGL off → the flat grid fallback, dashboard still fully usable.

## Deliver

Code, skills table, fps and profiler evidence, refreshed `graph.md` and `.agents/context.md`.
Stop here.
