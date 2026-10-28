# RackSense — Design System & Skills

Every frontend phase prompt references this file. Read it once, apply it everywhere.

---

## 1. The design direction

**A professional infrastructure console.** The reference points are the Google Cloud Console and
Power BI: dense, calm, trustworthy, built for an operator who stares at it for hours and has to
make a decision from it. Not a marketing page, not a "creative" dashboard, not a toy.

Hard constraints, no exceptions:

| Rule | |
|---|---|
| **Light theme only** | There is no dark theme. Do not build one, do not add a toggle, do not add `prefers-color-scheme` handling. |
| **Outline icons only** | One icon set, outline style, consistent stroke. Never filled icons, never two sets mixed. |
| **No emojis** | Not in the UI, not in labels, not in empty states, not in toasts, not in code comments that render. Status is an outline icon plus a word. |
| **No decoration** | No gradients, no glass, no glow, no illustration, no rounded "fun" shapes, no animated backgrounds. Every pixel earns its place by carrying information. |

**What makes it good rather than merely plain:** density done well. Tight, consistent spacing;
a strict type scale; numbers that align; generous whitespace *between* groups and very little
*inside* them; one accent colour used sparingly so it always means something.

**The hero is the live 3D rack hall**, rendered in the same restrained light palette as
everything else — clean light surfaces, thin neutral edges, status carried by fill colour. It
is the one visually striking element; everything around it stays quiet.

### Avoid (these read as generated, or as unprofessional)

- Emojis or filled/duotone icons anywhere.
- A dark canvas, a dark sidebar, or any dark-mode variant.
- Gradient headers, coloured page backgrounds, decorative blobs.
- Identical rounded cards with a heavy drop shadow under each.
- A tracked-out ALL-CAPS eyebrow label above every heading.
- Accenting one word of a headline in a different colour.
- `→` appended to button text; meta strings joined with middle dots.
- Fade-and-slide-up entrances on every section; hover transitions on every card.
- Using the accent blue for anything that is not interactive or selected.

---

## 2. Colour

Define as CSS custom properties on `:root`. **No hex in a component, ever.** There is no dark
block — light only.

### Surfaces, ink, lines

| Token | Value | Use |
|---|---|---|
| `--canvas` | `#F5F6F8` | page background behind cards |
| `--surface` | `#FFFFFF` | cards, panels, nav, app bar |
| `--surface-sunken` | `#FAFBFC` | table header rows, inset areas |
| `--surface-hover` | `#F1F3F5` | row/item hover |
| `--border` | `#DADCE0` | 1px card and table borders |
| `--border-strong` | `#C4C7CC` | dividers that must read at a glance |
| `--ink` | `#202124` | primary text, headings |
| `--ink-2` | `#5F6368` | secondary text, labels |
| `--ink-muted` | `#80868B` | axis labels, placeholder, disabled |

### Accent — one colour, used sparingly

| Token | Value | Use |
|---|---|---|
| `--primary` | `#155FA6` | interactive, selected, focus ring, primary button |
| `--primary-hover` | `#114E8A` | |
| `--primary-weak` | `#E8F0F9` | selected row background, active nav item |

The accent means "you can act on this" or "this is selected". It is never decoration, and it is
never used to carry data.

### Status — reserved, never reused as a series colour

| Token | Value | State | Outline icon |
|---|---|---|---|
| `--ok` | `#1E8E3E` | OK | `check-circle` |
| `--warn` | `#C77700` | WARN | `alert-triangle` |
| `--crit` | `#C5221F` | CRIT | `alert-octagon` |
| `--offline` | `#80868B` | OFFLINE / UNKNOWN | `minus-circle` |

Each status ships as **icon + colour + word**. Never colour alone — a colour-blind operator must
read the same screen. Status tints for backgrounds: `--ok-weak #E6F4EA`, `--warn-weak #FEF7E0`,
`--crit-weak #FCE8E6`.

### Categorical series — for charts only

Fixed order, never cycled. Deliberately distinct from every status hue so a series can never be
mistaken for a state. A 9th series folds into "Other" or becomes small multiples.

| Order | Token | Value |
|---|---|---|
| 1 | `--cat-1` | `#1F5FA6` |
| 2 | `--cat-2` | `#B5457F` |
| 3 | `--cat-3` | `#0E7C7B` |
| 4 | `--cat-4` | `#6B4FA0` |
| 5 | `--cat-5` | `#44576B` |

**Run the palette validator before shipping** and fix anything that fails. Do not judge
colour-vision separation by eye. If an adjacent pair fails, re-step it rather than adding a
sixth hue.

Sequential (magnitude): one hue, light → dark, from `--cat-1`. Diverging: two hues with a
**neutral grey midpoint** — never a rainbow, never a hue at the midpoint.

### Provenance

| Quality | Treatment |
|---|---|
| `measured` | plain value, no badge — the quiet default |
| `estimated` | 45° hatch fill on the mark, `EST.` chip in `--ink-2`, formula in tooltip |
| `inferred` | `INFERRED` chip, `basis` string shown beside the value |
| `ai_generated` | `AI · ADVISORY` chip on a `--surface-sunken` panel with a `--border` outline |

Chips are small, neutral, uppercase, 11px, letter-spaced — the only uppercase in the interface.

---

## 3. Type

| Role | Family | Notes |
|---|---|---|
| UI, headings, body | **Inter** | 400 / 500 / 600 only. Never 700+ for UI text. |
| Numbers, IDs, hashes, audit rows | **JetBrains Mono** | 400 / 500 |

`font-variant-numeric: tabular-nums` on **every number that can change**. A countdown that
reflows its own width while ticking looks broken.

Scale: `11 / 12 / 13 / 14 / 16 / 20 / 24 / 32`.
Body and table text **13px**; this is a dense console, not an article. Page title 20px/600.
Section heading 14px/600. Label 12px/500 in `--ink-2`. Chip 11px/500.

Line-height 1.45 for text, 1.2 for headings and numbers. Labels are **sentence case** — the only
uppercase is chips and table column headers at 11px with 0.04em tracking.

---

## 4. Layout — console shell

```
┌─ APP BAR  56px ──────────────────────────────────────────────────────────────┐
│ ▦ RackSense     Data Center Dashboard        [search]   ● Live   [MB ▾]      │
├──────────────┬───────────────────────────────────────────┬───────────────────┤
│ NAV 256px    │  CONTENT                                  │ DETAIL PANEL 360px│
│              │  Breadcrumb / Site 01 › Rack 01           │ (slides in on     │
│ ▢ Overview   │  ┌─────────────────────────────────────┐  │  selection)       │
│ ▢ Racks      │  │   live 3D rack hall                 │  │                   │
│ ▢ Forecasts  │  └─────────────────────────────────────┘  │ node, tenant      │
│ ▢ Approvals  │  ┌───────────┐┌───────────┐┌───────────┐  │ current values    │
│ ▢ Audit      │  │ KPI tile  ││ KPI tile  ││ KPI tile  │  │ forecast cone     │
│ ▢ Access     │  └───────────┘└───────────┘└───────────┘  │ evidence          │
│              │  ┌─────────────────────────────────────┐  │ actions           │
│              │  │ Recent activity (data grid)         │  │                   │
└──────────────┴───────────────────────────────────────────┴───────────────────┘
```

- **App bar** 56px, `--surface`, 1px bottom border. Product mark left, page title, global
  search, connection indicator, user menu. No colour fill.
- **Left nav** 256px, `--surface`, collapsible to 56px icons-only. Items are outline icon +
  label, 13px. Active item: `--primary-weak` background, `--primary` text, 3px left rule.
- **Content** on `--canvas`, 24px padding, 16px gap between cards.
- **Detail panel** 360px, slides in from the right on selection, closes with Esc. This replaces
  modals for inspection — modals interrupt, panels let you keep context.
- **Cards**: `--surface`, 1px `--border`, radius **8px**, shadow `0 1px 2px rgba(60,64,67,.08)`.
  One subtle elevation level only. Do not stack shadows to imply hierarchy.
- Content is **left-aligned**. Numbers in tables right-aligned, aligned on the decimal.
- Tables: 36px rows, 11px uppercase header on `--surface-sunken`, 1px row separators, hover
  `--surface-hover`, no zebra striping.

Responsive: below 1280px the detail panel becomes an overlay; below 900px the nav collapses to
icons; below 640px everything stacks single-column with a 16px gutter and no horizontal scroll.

---

## 5. Icons

**One set, outline, consistent stroke.** Recommended: **Lucide React** (outline by default,
tree-shakeable, 1.5px stroke). Material Symbols **Outlined** is an acceptable alternative if you
want a closer Google Cloud feel — but pick one and never mix.

Rules: 16px in tables and nav, 20px in the app bar, 24px only in empty states. Stroke width
stays constant across sizes. Icons are `--ink-2` unless they carry status. Every icon that
conveys meaning has a text label or an `aria-label` — an icon alone is never the only signal.

**No emojis anywhere.**

---

## 6. Motion

Restrained and functional. Durations 120–200ms, `ease-out`.

- Panels slide in, menus fade, rows highlight on update — motion that **answers an action** or
  **shows what changed**.
- On escalation (OK→WARN→CRIT) the affected row and slot get a **single** 600ms highlight sweep
  in the status tint, then settle. That is the only non-user-triggered motion in the product.
- No entrance animations on page load. No hover transitions on every card. No idle animation
  anywhere, including the 3D hall.
- `prefers-reduced-motion: reduce` removes the sweep and all transitions; state changes still
  happen instantly and visibly.

---

## 7. Writing in the interface

Plain verbs, sentence case, no filler, no exclamation marks.

- Name things as an operator would: "Cooling margin", not "thermal_headroom_metric".
- A button says what happens: **Proceed to authorization**, not "Submit".
- An action keeps its name through the flow: Proceed → "Waiting for tap" → "Authorized".
- Errors explain what happened and what to do, and never apologise:
  "Approval window elapsed. Approve again to issue a new 60-second window."
- Empty states are an instruction, not a void: "No readings yet. Nodes report every 2 seconds
  once connected."
- Never invent reassurance. If the socket is stale, show "Last update 48 s ago" rather than a
  confident number.

---

## 8. Skills to apply — apply **every one**, and say how

In your implementation plan include a table: skill → how you applied it in this phase. A skill
you did not apply must be named with a reason, not silently skipped.

| # | Skill | What it demands here |
|---|---|---|
| 1 | **Visual design identity** | The professional console direction above. Light only, outline icons, no emoji, no decoration. Density done well. |
| 2 | **Data visualisation** | Pick the form from the data's job *before* colour. Run the palette validator — never eyeball it. Thin marks, recessive grid, selective direct labels, legend for ≥2 series. **Never a dual-axis chart.** |
| 3 | **Real-time 3D rendering** | `frameloop="demand"` + `invalidate()`; mutate refs in `useFrame`; instancing past ~100 boxes; no GLTF, no shadows, no post-processing, no idle animation. |
| 4 | **Real-time data UI** | Batch frames, commit ≤ every 500 ms; backoff reconnect; REST resync; a visible `connected / reconnecting / stale` state. |
| 5 | **Information honesty** | Every number renders its `meta.quality`. `measured` and `estimated` never share a line. Forecasts are distributions. `no_breach_fraction` always shown. |
| 6 | **Accessibility** | Visible focus ring (2px `--primary`, 2px offset); `prefers-reduced-motion`; status never colour-alone; contrast ≥4.5:1 for text on its real surface; a table view for every chart. |
| 7 | **Design tokens** | Tokens only, no hex in components. No dark theme to maintain. |
| 8 | **Error & empty-state design** | A branch for every contract error code. Loading, empty, stale and error are designed states. |
| 9 | **Information architecture** | Role-based routing: `/datacenter` (Data Center Dashboard), `/tenant` (Tenant Dashboard). Never the word "admin". |
| 10 | **Performance budgeting** | ≥50 fps with the hall live on an integrated GPU. Measure it; do not assume it. |

---

## 9. Chart specifications

House style, applied to every chart: no chart junk, no 3D effects, no shadows on marks.
Gridlines `--border` at 1px, horizontal only. Axis labels 11px `--ink-muted`. Legend top-right,
11px. Tooltip is a white card with 1px border and the same shadow as a panel.

| Chart | Form | Rules |
|---|---|---|
| **Forecast cone** | ComposedChart: history line + median line (dashed) + P10–P90 range area + limit reference line + crossing-window reference area | Band is one hue at ~12% opacity. Limit line `--crit`, dashed, labelled with its source ("ASHRAE 27 °C recommended inlet"). |
| **KPI tile** | Big number + label + delta + sparkline | Number 32px JetBrains Mono tabular. Status as an outline icon + word, never a coloured tile background. |
| **Metric sparkline** | Line, 1.5px, no axes, one direct end label | No dot per point. |
| **Rack status strip** | Categorical cells | Status fill + outline icon + letter. Never colour alone. |
| **Attribution** | Horizontal bars, categorical palette | `basis` string always under the bars; `INFERRED` chip on the panel. |
| **Power** | Line with 45° hatch fill, `EST.` chip | Its own chart. Never the same axis or line as a measured series. |
| **Vibration vs baseline** | Line with 2× and 4× reference lines | Axis labelled "× baseline", never mm/s, never an ISO zone. |
| **Activity / audit** | Data grid | Monospace for seq, event, hash. Filterable. Not a ticker, not a tape. |

Every chart has a **"View as table"** toggle. It is both the accessibility requirement and the
fastest way for a judge to check your numbers against the API.
