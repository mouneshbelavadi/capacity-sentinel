# FRONTEND — PHASE 6 · AI panel, the approval flow, and the audit view

> Run `startup.md` first. Phases 1–5 must be working, and backend Phases D and E must be live.
> Read `shared/api-contract.md` §9–§11 and `shared/design-system.md`.

---

## Goal of this phase

The part that makes this more than a dashboard: an operator reads the evidence, **talks to the
AI about it**, decides, and then physically taps a card to authorize. Plus the audit view that
proves none of it can be faked.

The interface's job here is to make the human the decision-maker and make that obvious at every
step.

---

## Build

### 1. The AI panel

Lives in the detail panel for a selected slot or rack. Three actions, three outputs:

| Action | Endpoint | Shows |
|---|---|---|
| Summarize | `POST /api/ai/summarize` | 2–3 sentences + status hint |
| Explain | `POST /api/ai/explain` | why the forecast says what it says |
| Propose action | `POST /api/ai/propose` | a structured proposal card |

Every AI output sits on a `--surface-sunken` panel with a 1px border and an **`AI · ADVISORY`**
chip. It must never look like a system fact. No emoji, no robot icon — a plain outline
`sparkles` or `message-square` icon at most, with the word.

**Evidence is clickable.** Each cited evidence ID (`fc_0193`, `cp_0042`) renders as a chip that
opens the real record — the forecast, the change point, the audit row. An explanation you cannot
verify in one click is just a nice paragraph; this is what makes it accountable.

If the backend returns `AI_UNAVAILABLE`, the panel says "AI commentary unavailable" and
**everything else on the screen keeps working**. Never show a cached or canned explanation as
if it were fresh.

### 2. The proposal card

Shows: action (as a human phrase, not the enum — "Reduce tenant load"), target, rationale,
expected effect, risk tier, evidence chips, and status.

Status as a stepper, so the human always knows where they are:

```
Proposed ──▶ Discussing ──▶ Approved, waiting for tap ──▶ Authorized
```

with `Rejected` and `Expired` as terminal off-ramps. Current step in `--primary`, completed in
`--ink-2`, future in `--ink-muted`. Outline icons only.

### 3. Discussion before approval

A threaded conversation on the proposal (`POST /api/ai/chat`). The operator can ask "why not
migrate instead?" and get a revised proposal.

- A revision renders as a **diff against the previous version** — changed fields highlighted —
  not as a silent replacement. The operator must see what moved.
- The thread is part of the record: show that each exchange is audited.
- **Discussion never approves.** The Proceed button stays exactly where it is, and nothing in
  the chat can move the stepper past "Discussing". If the model claims it has approved
  something, that is text, not state — the stepper reads from the API.

### 4. Proceed → the tap

`POST /api/proposals/{id}/approve` (operator and super user only; the button does not render
for a tenant).

On success the UI enters the **waiting-for-tap** state:

- A prominent countdown from the server's `expires_at` — **not** a client-side 60s timer.
  Compute remaining time from the server timestamp so a slow network cannot desync it.
- "Waiting for tap on `reader-01`" with the reader's last-seen time from its heartbeat, so the
  operator knows the device is actually alive before they walk over to it.
- The exact action and target repeated, matching what the TFT shows. The screen and the device
  must say the same thing — that correspondence is the point.
- A Cancel control.

On the `proposal_update` WebSocket frame:

| Result | UI |
|---|---|
| `AUTHORIZED` | stepper completes; shows **who** authorized (`actor`) and the new audit head hash in monospace |
| `REJECTED` | the specific reason from the contract (`UID_NOT_AUTHORIZED`, `HMAC_INVALID`, …) in plain language |
| `EXPIRED` | "Approval window elapsed. Approve again to issue a new 60-second window." |

The head hash shown here must be **the same string printed on the TFT**. Put them side by side
in the demo — that is the moment the audit chain stops being an abstraction.

### 5. The audit view — `/datacenter/audit`

A proper data grid, not a ticker. Columns: `seq`, timestamp, actor, event, subject, hash
(truncated, monospace, click to copy full).

- Filterable by event type, actor, node, and time range.
- Row click opens the detail panel with the full payload.
- Scoped: a tenant sees only their own rows (and the Audit nav item still appears for them).

**Chain verification**, prominent at the top of the page:

```
[ Verify chain ]   Verified · 1,842 rows · head 9f2c4a1b…   (checked 12s ago)
```

Calls `GET /api/audit/verify`. On failure it goes `--crit` and names the broken row:
"Chain broken at row 903." This control is the single most persuasive thing in the product —
give it room and make it instant.

### 6. The approvals queue — `/datacenter/approvals`

A `<DataTable>` of proposals across the site, filtered by status, with the stepper state per
row and the time remaining on anything `APPROVED_PENDING_TAP`. The operator's working list.

### 7. Tenant view of all this

A tenant can see proposals affecting **their own** slots and can use the discussion chat — but
the Proceed button does not render, and the API returns 404 if they try. Show the stepper so
they can see where their request stands. Transparency without authority.

---

## Skills — apply every one, and report how

Minimum: visual design identity, information honesty, information architecture, error &
empty-state design, accessibility, real-time data UI, design tokens.

Specifically for this phase:
- **Information honesty:** AI output is always chipped as advisory and never styled like a
  system fact. Evidence is always verifiable in one click.
- **Writing:** the action keeps its name through the whole flow — Proceed to authorization →
  Waiting for tap → Authorized. Errors say what happened and what to do next.
- **Accessibility:** the countdown is announced to screen readers at sensible intervals
  (`aria-live="polite"`, not every second); the stepper is a real list with state, not colour
  alone.

---

## Hard rules

- The stepper reads state from the API. Nothing the model writes can move it.
- The countdown derives from the server's `expires_at`, never a local timer.
- No emoji anywhere, including in AI output rendering — if the model returns one, strip it.
- AI panels never look like system facts.
- The Proceed button never renders for a tenant.
- No fabricated audit rows, ever, for any reason, including "to show the layout".

---

## Acceptance — show me live

1. Click Explain on a real forecast → the explanation renders with evidence chips; clicking one
   opens the real record.
2. Ask "why not migrate instead?" → a revised proposal rendered as a diff; stepper still at
   Discussing.
3. Try to talk the AI into approving it → the stepper does not move, and the attempt appears in
   the audit grid.
4. Click Proceed → countdown starts from the server time; the TFT shows the same action.
5. Tap a registered card → Authorized, with `actor` and the head hash — and that hash matches
   what the TFT printed, side by side.
6. Approve again and wait 60 s → Expired, with the correct message.
7. Tap an unregistered card → the specific rejection reason in plain language.
8. Click **Verify chain** → verified, with the row count and head hash. Then hand-edit a row in
   SQLite and verify again → red, naming the broken row.
9. Log in as a tenant → proposals for their slot visible, no Proceed button, 404 if forced.

## Deliver

Code, skills table, refreshed `graph.md` and `.agents/context.md`.

The frontend is complete after this phase. Next: `prompts/03-master-integration.md`.
