# FRONTEND — PHASE 1 · Foundation, design system, auth

> Run `startup.md` first. Do not begin until it printed `STARTUP COMPLETE`.
> Read **`shared/design-system.md` in full** — it is the visual direction, the tokens, and the
> ten skills you must apply. Then `shared/api-contract.md` §0–§3 and `shared/tenant-isolation.md`.

---

## Goal of this phase

The skeleton that everything else hangs on: the design system as real tokens, one API client,
one source of payload types, login, and role-based routing into two differently-named
dashboards.

No charts, no 3D, no AI yet. Get the foundation right and the next five phases are easy.

---

## Stack

Vite + React + TypeScript (`strict: true`, **no `any`**) + Tailwind (configured to emit the
tokens below — not its default palette) + Zustand for the small amount of client state +
TanStack Query for REST.

- Fonts: **Inter** (UI) and **JetBrains Mono** (numbers, IDs, hashes) from Google Fonts.
- Icons: **Lucide React** — outline only, one set, constant stroke. **No emojis anywhere.**

The target look is a professional infrastructure console — Google Cloud Console / Power BI
grade. **Light theme only. Do not build a dark theme or a theme toggle.**

---

## Build

### 1. Design tokens (`src/design/tokens.css`)

Implement the palette, type scale, spacing, borders and elevation from
`shared/design-system.md` §2–§4 as CSS custom properties on a single `:root` block.

**There is no dark theme.** No `@media (prefers-color-scheme: dark)`, no `data-theme`
attribute, no toggle. One set of values.

**No hex in a component, ever.** Tailwind's theme maps onto these variables; do not use
Tailwind's stock colours.

Key facts from the design system you must not soften:
- Cards: `--surface` on a `--canvas` page, **1px** `--border`, radius **8px**, a single subtle
  elevation `0 1px 2px rgba(60,64,67,.08)`. Do not stack shadows to imply hierarchy.
- Body and table text **13px**. This is a dense console, not an article.
- `--primary` means "interactive or selected" and nothing else. It never carries data and is
  never decoration.
- Status is **icon + colour + word**, never colour alone.
- Chips (11px, uppercase, letter-spaced) are the only uppercase text in the product.

### 2. Palette validation

Before you ship the categorical palette, **run the palette validator** on the five categorical
hues in their fixed order. Do not judge colour-vision separation by eye. If an adjacent pair
fails, re-step it — do not add a sixth hue. Paste the validator output into your report.

### 3. Primitives (`src/design/`)

Build these once; every later phase uses them and adds none of its own.

| Primitive | Does |
|---|---|
| `<Card>` | `--surface` panel, 1px `--border`, radius 8px, one subtle elevation; `title`, `actions`, `footer` slots |
| `<Value>` | **the provenance component.** Takes `{value, unit, meta}` and renders the right treatment for `measured` / `estimated` / `inferred` / `ai_generated` per design-system §2 |
| `<StatusBadge>` | OK / WARN / CRIT / OFFLINE — **always** outline icon **plus** colour **plus** word |
| `<Chip>` | the 11px uppercase provenance chip (`EST.`, `INFERRED`, `AI · ADVISORY`) |
| `<KpiTile>` | big tabular number + label + delta + optional sparkline, per design-system §9 |
| `<DataTable>` | 36px rows, 11px uppercase header on `--surface-sunken`, hover highlight, no zebra striping, right-aligned numerics |
| `<DetailPanel>` | the 360px right-hand slide-in inspector; closes on Esc |
| `<EmptyState>` | the honest empty state: what is missing and what will fill it |
| `<ErrorState>` | takes a contract error `code` and renders its specific message |

`<Value>` is the most important component in the app. Every number on every screen goes through
it. If a number is rendered without it, that is a bug — add a lint rule or a test that catches
raw numeric interpolation in feature components.

### 4. Contract types (`src/api/contract.ts`)

Hand-mirror every payload type from `shared/api-contract.md` into this **one** file. Include the
closed enums as TypeScript union types: `Quality`, `Role`, `ProposalStatus`, `ProposalAction`,
`ErrorCode`, `Metric`, `Status`.

No payload type is declared anywhere else in the codebase.

### 5. API client (`src/api/client.ts`)

The single fetch wrapper. It:
- attaches the bearer token,
- parses the `{error: {code, message, detail}}` envelope into a typed error,
- calls `GET /api/meta` on boot and **blocks the app with a full-screen banner** on a major
  `contract_version` mismatch (this is how you catch backend drift in seconds instead of hours),
- never swallows an error code.

### 6. Auth and role routing

- `POST /api/auth/login` → store the token (memory + `sessionStorage`, wrapped in try/catch —
  storage can throw or come back empty).
- `GET /api/auth/me` on refresh.
- Routes:

| Path | Role | Title shown |
|---|---|---|
| `/datacenter` | `OPERATOR`, `SUPER_USER` | **Data Center Dashboard** |
| `/tenant` | `TENANT` | **Tenant Dashboard** |
| `/datacenter/access` | `SUPER_USER` | **Access Control** |

A `TENANT` who types `/datacenter` is redirected to `/tenant`. Say plainly in a code comment
that this redirect is **convenience, not security** — the server returns 404 for the data
regardless, and that is what actually enforces isolation.

**The string `admin` must not appear** in any route, component name, file name, label, page
title or log line.

### 7. App shell

Build the console shell from `shared/design-system.md` §4:

- **App bar**, 56px, `--surface`, 1px bottom border: product mark, page title, global search,
  connection indicator slot (Phase 3 fills it), user menu showing display name and role as
  "Tenant" / "Operator" / "Super User". No colour fill, no gradient.
- **Left nav**, 256px, collapsible to 56px icons-only. Outline icon + 13px label. Active item
  gets `--primary-weak` background, `--primary` text and a 3px left rule. Sections: Overview,
  Racks, Forecasts, Approvals, Audit, and Access Control (Super User only).
- **Content area** on `--canvas`, 24px padding, 16px gaps, with a breadcrumb and page title.
- **Detail panel**, 360px, slides in from the right on selection, closes on Esc. Use this
  instead of modals for inspection — a modal interrupts, a panel keeps context.

Responsive: below 1280px the detail panel becomes an overlay; below 900px the nav collapses to
icons; below 640px everything stacks single-column with a 16px gutter and no horizontal scroll.

### 8. Accessibility floor — from the first commit

Visible focus ring on every interactive element (2px `--primary`, 2px offset).
`prefers-reduced-motion` respected. Status never conveyed by colour alone — always an outline
icon and a word. Text contrast ≥4.5:1 against its real surface. Every meaningful icon has a
label or an `aria-label`.

---

## Skills — apply every one, and report how

In your implementation plan include a table: skill → how you applied it in this phase. A skill
you did not apply must be named with a reason. The ten skills are listed in
`shared/design-system.md` §7.

For this phase, at minimum: visual design identity (§1), design tokens & theming (§7),
accessibility (§6), error & empty-state design (§8), information architecture (§9),
information honesty (§5 — via `<Value>`).

---

## Hard rules

- No mock data. No placeholder numbers "to see the layout". If there is no data yet, the screen
  shows `<EmptyState>` — and that state is **designed**, not a grey box.
- No `any`. No payload types outside `src/api/contract.ts`.
- No hex in a component.
- No component library that imposes its own look.

---

## Acceptance — show me

1. Log in as an operator → **Data Center Dashboard**. Log in as a tenant → **Tenant Dashboard**.
   Different titles, different shells.
2. A tenant typing `/datacenter` is redirected.
3. `grep -ri admin frontend/src` returns nothing.
4. The palette validator output, pasted, with every adjacent pair passing.
5. Contrast audit: every text/surface pair at ≥4.5:1. No dark theme exists anywhere in the
   codebase — `grep -ri "dark\|prefers-color-scheme" frontend/src` returns nothing meaningful.
   No emoji in the source: `grep -P "[\x{1F300}-\x{1FAFF}\x{2600}-\x{27BF}]" -r frontend/src`
   returns nothing.
6. Keyboard-only walkthrough of login → dashboard, focus always visible.
7. Point the client at a backend with a bumped major contract version → the blocking banner
   appears.
8. Phone width: no horizontal scroll, columns stacked.

## Deliver

Code, the skills table, the validator output, refreshed `graph.md` and `.agents/context.md`.
Stop here. Do not start Phase 2.
