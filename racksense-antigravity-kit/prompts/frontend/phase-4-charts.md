# FRONTEND — PHASE 4 · Forecast cone, charts, attribution

> Run `startup.md` first. Phases 1–3 must be working, and backend Phase C must be serving real
> forecasts. Read `shared/api-contract.md` §5–§8 and `shared/design-system.md` §8.

---

## Goal of this phase

Render the answer to *"what runs out, when, and why"* — as a **distribution**, with the
uncertainty visible rather than hidden.

The chart that matters is the forecast cone. Everything else supports it.

---

## Method — colour comes last

For every chart, in this order:

1. **Pick the form from the data's job** — magnitude, identity, polarity, change over time, or
   a single headline number. Sometimes the right answer is not a chart: the headline
   "runs out in 6 min" is a **stat tile**, not a plot.
2. **Assign colour by the job it does** — categorical (identity), sequential (magnitude),
   status (state). Categorical hues in the fixed order from `shared/design-system.md` §2,
   never cycled.
3. **Validate the palette with the validator script.** Do not eyeball colour-vision separation.
4. **Apply mark specs**: thin marks, 2px lines, ≥8px markers, recessive grid and axes,
   selective direct labels — never a number on every point.
5. **Add the hover layer**: crosshair + tooltip on line/area, per-mark tooltip on bars.
6. **Accessibility pass**: legend for ≥2 series, a table view for every chart, status never
   colour-alone (outline icon + word), text contrast ≥4.5:1 on the real surface.

House style for every chart: no chart junk, no 3D effects, no shadows on marks. Horizontal
gridlines only, 1px `--border`. Axis labels 11px `--ink-muted`. Legend top-right, 11px. Tooltip
is a white card with a 1px border and the same elevation as a panel. **No emojis, no filled
icons.**

**Never a dual-axis chart.** Two measures of different scale means two charts, small multiples,
or indexing to a common base. This is the single most common chart mistake and it is banned here.

---

## Build

### 1. The forecast cone (the centrepiece)

Recharts `ComposedChart`:

- history `Line` (measured, solid, 2px)
- median forecast `Line` (dashed to distinguish projection from observation)
- **P10–P90 `Area`** as a range band, one hue at low opacity — not a rainbow, not stacked bands
- `ReferenceLine` at the limit, in `--crit`, dashed, **labelled with its source**:
  "ASHRAE 27 °C recommended inlet"
- `ReferenceArea` shading the crossing-time window (P10→P90 on the x-axis)

Above the chart, the headline stat tile:

> **Cooling margin runs out in 6 min** · range 3–11 min · 12% of scenarios: no breach within 2 h

Required behaviours:

| Backend says | UI shows |
|---|---|
| `has_trend: false` | **"No sustained trend — no exhaustion forecast."** No cone. No ETA. No guess. |
| `no_breach_fraction` present | **always displayed**, in the headline. Hiding it makes an honest forecast look alarming. |
| `window_reason: "changepoint:cp_0042"` | a marker at the window start: "Window reset by regime change" |
| `calibration.widen_factor > 1` | a note: "Interval widened ×1.18 from observed coverage" |

Never extrapolate past the returned `horizon_s`. The backend capped it at 3× the fitted window
for a reason; drawing beyond it re-introduces the overclaim the cap removed.

### 2. Metric sparklines

One per metric on the slot detail: 2px line, no axis labels, one direct end label, tabular
figures, no dot per point. Measured only.

### 3. Vibration vs baseline

Line with `ReferenceLine`s at **2× (WARN)** and **4× (CRIT)**. The y-axis is labelled
**"× baseline"** — never mm/s, never an ISO zone. Add a caption naming when the baseline was
captured and over how many samples.

### 4. Attribution

Horizontal bars, categorical palette, one bar per contributing tenant. **Always** render the
`basis` string under the bars, and the `INFERRED` badge on the panel. Never let it read as a
measurement.

### 5. Estimated power

Line with the 45° hatch fill and the `EST.` badge. It gets **its own chart** — never the same
axis or line as a measured series. Tooltip carries the formula and the live inputs.

### 6. Table view — every chart

A "View as table" toggle on every chart. It is both the accessibility requirement and the
fastest way for a judge to check your numbers against the API. The table shows the same values
with their provenance labels intact.

### 7. Honest empty and insufficient states

| Code | Shown |
|---|---|
| `FORECAST_INSUFFICIENT_DATA` | "Not enough history yet. Forecasting starts after ~5 minutes of readings." |
| no baseline | "No baseline captured for this metric." |
| `SENSOR_WARMING_UP` | "Warming up." **Never a number, never a chart.** |

A chart is never drawn with nothing behind it.

---

## Skills — apply every one, and report how

Minimum: data visualisation (the whole method above), information honesty, accessibility,
design tokens, performance budgeting, error & empty-state design.

In your report, include the palette validator output and a one-line justification for each
chart's chosen form.

---

## Hard rules

- A forecast is always a distribution. No single-number ETA, anywhere, ever.
- `no_breach_fraction` always visible.
- No dual-axis charts.
- `measured` and `estimated` never share a line or an axis.
- Vibration in × baseline, never mm/s. MQ135 as a ratio, never ppm.
- No chart rendered from no data.

---

## Acceptance — show me

1. Warm a real DHT22 → the cone appears, the band narrows as the trend firms, the headline
   counts down, the no-breach fraction updates.
2. Let it cool until the slope CI contains zero → the cone **disappears** and the panel reads
   "No sustained trend — no exhaustion forecast".
3. Power on a second node → the window-reset marker appears at the change point.
4. Tape a fan blade → vibration crosses 2× and the axis still reads "× baseline".
5. Every chart's table view, with provenance labels intact.
6. The palette validator output, all adjacent pairs passing against the light surface.
7. A metric with no baseline → text, no chart.

## Deliver

Code, skills table, validator output, chart-form justifications, refreshed `graph.md` and
`.agents/context.md`. Stop here.
