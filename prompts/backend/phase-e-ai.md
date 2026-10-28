# BACKEND — PHASE E · AI layer (advisory only)

> Run `startup.md` first. Phases A–D must be working — especially the approval chain, because
> this phase feeds it and must not be able to bypass it.
> Read `shared/api-contract.md` §9 and `shared/architecture.md` §7.

---

## Goal of this phase

Add a cloud LLM that **explains and suggests**, and can do nothing else.

The design brief is OWASP LLM06 "Excessive Agency": minimum functions, human-in-the-loop for
anything with impact, and **authorization enforced downstream, never by the model**. The model
has no tools, no write access, and no path to `AUTHORIZED`.

It also computes **no numbers**. Every figure it mentions was computed by your code in Phase C
and handed to it. If the model produces a number of its own, that is a bug in your prompt, not
a feature.

---

## Where the model runs

A **cloud LLM API**, called from the laptop-side process. Not on the UNO Q, and absolutely not
on a microcontroller: a 1 B-parameter model at 4-bit is roughly 0.5 GB of weights; the ESP32-S3
has 512 KB SRAM and 8 MB PSRAM. It is off by orders of magnitude. Say so in the pitch rather
than implying on-device intelligence you do not have.

Use the provider SDK directly with **JSON-schema structured output**. Do **not** add LangChain
or LlamaIndex — a focused module is lighter and far easier to debug at 2 a.m.

API key in `.env`, gitignored.

---

## Build

### 1. Three roles, three prompts (`services/ai/`)

Each receives a context object you build from **already-computed** values.

**a. Summarizer** — `POST /api/ai/summarize {scope, id}`
Input: latest values, margins, forecast quantiles, change points, node status.
Output: 2–3 sentences + `status_hint` enum + `evidence` IDs.

**b. Explainer** — `POST /api/ai/explain {forecast_id}`
Input: the forecast's **real parameters** — slope with its CI, damping, window start, the
change point that reset the window, crossing-time quantiles, `no_breach_fraction`, calibration
— plus retrieved audit history.
Output: a plain-language "why", citing evidence IDs.

**c. Proposer** — `POST /api/ai/propose {node_id|rack_id}`
Output must match a JSON schema whose `action` is from the closed whitelist, with `target`,
`rationale`, `expected_effect`, `evidence`, `risk_tier`.
Creates a proposal with status `PROPOSED` via the Phase D state machine.

### 2. Validation — this is the important part

Before a response is stored or shown:

| Check | Failure |
|---|---|
| `action` in the whitelist | discard + audit `AI_ACTION_NOT_WHITELISTED` |
| every `evidence` ID was supplied by you in the prompt | discard + audit `AI_EVIDENCE_INVALID` |
| response matches the JSON schema | discard + audit, retry once, then `AI_UNAVAILABLE` |
| no numeric claim outside the supplied context | flag in the audit payload |

Keep the set of supplied evidence IDs for the request and check the response against it
exactly. The model cannot invent evidence, and a response that tries is thrown away rather than
repaired.

### 3. Discussion before approval

```
POST /api/ai/chat {proposal_id, message}
  → { reply, proposal_revision | null, meta }
```

This is the "talk to the AI before you authorize" step. It moves the proposal to `DISCUSSING`.
A revision replaces the proposal's fields, **keeps `proposal_id`**, and appends an audit row
recording the before and after.

**Discussion can never change status to approved.** The only route to `APPROVED_PENDING_TAP` is
`POST /api/proposals/{id}/approve`, by an `OPERATOR` or `SUPER_USER`. Write a test for this.

### 4. RAG

Corpus: audit events, past incidents, and a short **hand-written** runbook (ASHRAE limits, your
baseline rules, what each action means). The runbook is written by a human and committed —
not generated.

Retrieval: embed, then top-k by cosine on `(node/rack, question)`. Use pgvector if Postgres is
already running; otherwise store embeddings in SQLite and do brute-force cosine in numpy. At
hundreds of documents that is instant and removes a moving part.

**The prompt builder runs *after* the scope filter.** This is the most likely way this
architecture leaks between tenants: an unscoped retrieval pulls a neighbour's incident into a
tenant's summary. Build the context from scoped repo calls only, and test it.

### 5. Audit everything

For every AI call write an audit row containing: the role, the model name, the prompt hash, the
evidence IDs supplied, the raw response, the validation result. Enough for a judge to ask "why
did it say that?" and get a real answer.

### 6. Failure behaviour

If the provider is slow or down: return `AI_UNAVAILABLE`. **Never** fall back to a canned
explanation, a template sentence, or a cached answer presented as fresh. The UI will show that
AI commentary is unavailable, which is honest, while all the computed numbers keep working.
The system must be fully usable with the AI switched off.

---

## Hard rules

- The model computes nothing. Every number in its output came from your context object.
- No tools, no function-calling with side effects, no write access, no shell.
- `ai_generated` quality on every AI response, badged as advisory in the UI.
- No path from an AI response to `AUTHORIZED`.
- Scope first, retrieve second, prompt third.
- No local model on the UNO Q during the demo — it would saturate all four cores and starve the
  forecasting loop.

---

## Tests

1. A response with an action outside the whitelist → discarded, `AI_ACTION_NOT_WHITELISTED`
   audited, no proposal created.
2. A response citing an evidence ID you did not supply → discarded, `AI_EVIDENCE_INVALID`
   audited.
3. A malformed JSON response → one retry, then `AI_UNAVAILABLE`, audited.
4. `POST /api/ai/chat` can never produce `APPROVED_PENDING_TAP` or `AUTHORIZED`, with any input
   — including a message that explicitly instructs the model to approve it.
5. **Tenant RAG isolation**: a tenant's summarize call retrieves zero documents belonging to
   another tenant. Assert on the retrieved set, not just the output text.
6. Provider unreachable → every non-AI endpoint still works; the AI endpoints return
   `AI_UNAVAILABLE`.
7. Every AI call produced an audit row with the model name and validation result.

---

## Acceptance — show me live

1. Click Explain on a real forecast → an explanation that cites real evidence IDs, and those
   IDs resolve to real records.
2. Ask "why not migrate instead?" in the proposal chat → a revised proposal, still `DISCUSSING`.
3. Try to talk the model into approving it → status does not move; the audit shows the attempt.
4. Turn the API key off → AI panel says unavailable, every number on the dashboard keeps
   updating.

## Deliver

Code, tests green, the committed hand-written runbook, `.env.example` updated, refreshed
`graph.md` and `.agents/context.md`. Stop here.
