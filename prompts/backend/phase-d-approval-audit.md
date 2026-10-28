# BACKEND — PHASE D · Approval chain and audit

> Run `startup.md` first. Phases A–C must be working.
> Read `shared/api-contract.md` §9–§11 and `shared/architecture.md` §8–§9.

---

## Goal of this phase

Build the part that makes this project more than a dashboard: **an action cannot happen because
software decided it should.** A human reads the evidence, approves in the dashboard, and then
physically taps a card. The server owns the whole state machine; the reader device holds no
authority at all.

The reader is deliberately powerless. A device that could invent its own authority would be a
way to launder an unapproved action into something that looks official.

---

## The state machine (server-owned, nowhere else)

```
PROPOSED ──(human discusses)──> DISCUSSING ──┐
   │                                         │
   └──────── (human clicks Proceed) ─────────┴──> APPROVED_PENDING_TAP
                                                      │ nonce issued, TTL 60 s,
                                                      │ bound to (proposal_id, reader_device_id)
                            ┌─────────────────────────┼──────────────────────┐
                            ▼                         ▼                      ▼
                     valid tap → AUTHORIZED     TTL elapsed → EXPIRED   human → REJECTED
```

Discussion **never** approves. Approval **never** executes — in this build `AUTHORIZED` is the
terminal state and the system still does not touch a facility control.

---

## Build

### 1. Tables

`proposals` (`proposal_id`, `created_at`, `scope_json`, `action`, `target`, `rationale`,
`expected_effect`, `evidence_json`, `risk_tier`, `status`, `model`, `updated_at`)

`nonces` (`nonce` PK, `proposal_id`, `reader_device_id`, `issued_at`, `expires_at`,
`consumed_at` NULL, `issued_by_user_id`)

`reader_devices` (`device_id`, `secret_hash`, `label`, `registered_at`, `last_seen_at`,
`last_fw`, `last_rssi`)

Reuse `cards` from Phase B (`uid`, `user_id`, `active`, `max_risk_tier`).

### 2. Proposal creation

In this phase create proposals through an operator-triggered endpoint so you can test the chain
without the LLM. Phase E replaces the body with the model's output; the state machine does not
change.

`action` is a **closed whitelist**:
```
REDUCE_TENANT_LOAD | MIGRATE_TENANT | INSPECT_FAN
| INCREASE_COOLING_SETPOINT_REQUEST | SCHEDULE_MAINTENANCE | NO_ACTION
```
Anything else is rejected and audited as `AI_ACTION_NOT_WHITELISTED`.

`risk_tier` ∈ `LOW | MEDIUM | HIGH`, and a card may only authorize up to its `max_risk_tier`.

### 3. Approve → arm

```
POST /api/proposals/{id}/approve      # OPERATOR or SUPER_USER only; TENANT gets 404
  200: { proposal_id, status: "APPROVED_PENDING_TAP", nonce, expires_at, reader_device_id }
```

- Nonce: `secrets.token_urlsafe(32)`. Single use. TTL **60 s**. Bound to both the proposal and
  one reader device.
- Issuing a second approval for the same proposal invalidates the first nonce.
- Write `PROPOSAL_APPROVED` to the audit chain with the approving `user_id`.

```
POST /api/proposals/{id}/reject       → status REJECTED, audited
GET  /api/proposals?status=...        → scoped list
```

A background job expires nonces past their TTL and moves the proposal to `EXPIRED` with an
audit row.

### 4. Reader endpoints (device-facing)

```
GET  /api/reader/{device_id}/pending
POST /api/reader/{device_id}/tap
POST /api/reader/{device_id}/heartbeat
```

`/pending` returns `{armed: false}` or the armed action **with pre-rendered ASCII lines**
(`line1`, `line2`) for the TFT. The device renders text; it does not compose meaning. Keep the
lines ASCII — embedded text libraries do not shape Devanagari or Tamil conjuncts, so the server
sends romanised ASCII and the screen shows that.

`/tap` body: `{uid, nonce, ts, hmac}` where
`hmac = HMAC-SHA256(device_secret, f"{device_id}|{uid}|{nonce}|{ts}")`, hex.

**Verify in exactly this order.** Each failure returns `REJECTED` with its reason **and writes a
`TAP_REJECTED` audit row**:

1. `device_id` registered → else `DEVICE_UNKNOWN`
2. HMAC valid → else `HMAC_INVALID`  *(constant-time compare — `hmac.compare_digest`)*
3. `|server_now − ts| ≤ 120 s` → else `CLOCK_SKEW`
4. nonce exists, unconsumed, unexpired, bound to this `device_id` → else `NONCE_EXPIRED` /
   `NONCE_CONSUMED`
5. `uid` in `cards`, `active`, and `card.max_risk_tier >= proposal.risk_tier` → else
   `UID_NOT_AUTHORIZED`
6. Consume **atomically**:
   ```sql
   UPDATE nonces SET consumed_at = :now WHERE nonce = :n AND consumed_at IS NULL
   ```
   Check `rowcount == 1`. If it is 0, another request won the race → `NONCE_CONSUMED`.
   Only then set the proposal to `AUTHORIZED` and write `TAP_AUTHORIZED`.

Response carries `actor` (the card holder's display name) and `audit_hash` (the new head hash),
which the device prints on the TFT.

### 5. Security honesty

Record this in `.agents/context.md` and be ready to say it on stage:

> An RFID UID is a **public identifier, not a secret** — "magic" cards can carry an arbitrary
> UID. The tap is the **second factor** after dashboard approval, scoped by a single-use nonce
> with a 60 s TTL and an HMAC over `device_id|uid|nonce|ts` to defeat replay. A rogue reader is
> rejected because it has no registered per-device secret. Production would use DESFire EV2/EV3
> or NTAG 424 DNA with AES challenge–response, over TLS.

Do not overclaim this. The honest version is stronger than a false one.

### 6. Audit chain hardening

- `hash = SHA256(prev_hash || canonical_json(row_without_hash))`, sorted keys, no whitespace,
  UTF-8, genesis `"0"*64`.
- Single writer lock so concurrent appends cannot interleave and break the chain.
- `GET /api/audit/verify` recomputes the **whole** chain and returns
  `{ok, rows_checked, head_hash, broken_at}`.
- Verification is global, but `GET /api/audit` rows are scoped — a tenant sees their own rows
  and still gets a truthful `ok` and head hash.
- **There is no UPDATE and no DELETE path to this table in the codebase.** If one exists,
  delete it.

Events to log in this phase: `AI_PROPOSAL`, `PROPOSAL_APPROVED`, `TAP_AUTHORIZED`,
`TAP_REJECTED`, `SCOPE_DENIED`, plus the Phase A events.

---

## Tests

1. **Nonce single-use under concurrency** — fire 20 simultaneous valid taps with the same
   nonce; exactly one returns `AUTHORIZED`, nineteen return `NONCE_CONSUMED`.
2. Expired nonce → `NONCE_EXPIRED`, proposal moves to `EXPIRED`, audited.
3. Bad HMAC → `HMAC_INVALID`, audited, and the nonce is **not** consumed.
4. Clock skew beyond 120 s → `CLOCK_SKEW`.
5. Unregistered card → `UID_NOT_AUTHORIZED`, audited.
6. A `LOW`-tier card tapping a `HIGH`-tier proposal → `UID_NOT_AUTHORIZED`.
7. Unknown `device_id` → `DEVICE_UNKNOWN`.
8. A `TENANT` calling `/approve` → `404`.
9. Hand-edit one audit row in SQLite → `/api/audit/verify` returns `ok: false` with the correct
   `broken_at`.
10. The audit chain holds under 500 concurrent appends.
11. `grep` finds no UPDATE or DELETE statement against the audit table.

---

## Acceptance — show me live

1. Create a proposal → approve → the TFT shows the armed action and a 60 s countdown.
2. Tap a registered card → `AUTHORIZED`, and the head hash printed on the TFT matches
   `/api/audit/verify`'s `head_hash` on screen.
3. Approve again, wait 60 s without tapping → `EXPIRED`, audited.
4. Tap an unregistered card → `REJECTED — Card not registered`, audited.
5. Tamper with a row in the database → verify goes red and names the row.

## Deliver

Code, tests green, `tools/register_reader.py` (human-entered device + secret, nothing
generated into the repo), updated README, refreshed `graph.md` and `.agents/context.md`.
Stop here.
