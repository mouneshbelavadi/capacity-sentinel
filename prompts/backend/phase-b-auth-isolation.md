# BACKEND — PHASE B · Auth and tenant isolation

> Run `startup.md` first. Phase A must be working — a real sensor reading reachable over REST.
> Read `shared/tenant-isolation.md` in full, and `shared/api-contract.md` §2, §3.

---

## Goal of this phase

**A tenant can never see another tenant's data, by any route.** Elevated users see everything.

This is the phase judges will actually try to break, and it is the one that is easiest to get
subtly wrong. Build the enforcement in **one place** and write the test that proves nobody can
bypass it — before you build anything else on top.

---

## Roles

| Role | Sees | Approves proposals | Manages tenants/users/cards |
|---|---|---|---|
| `TENANT` | Only slots whose `tenant_id` matches their own | No | No |
| `OPERATOR` | Every slot in the site | Yes | No |
| `SUPER_USER` | Every slot in the site | Yes | Yes |

**The string `admin` is banned** — in routes, table names, model names, variables, labels, log
lines, everywhere. The elevated role is `SUPER_USER`, shown to humans as "Super User".

---

## Build

### 1. Tables

`users` (`user_id`, `username`, `password_hash`, `role`, `tenant_id`, `display_name`),
`cards` (`uid`, `user_id`, `active`, `max_risk_tier`, `issued_at`).

Password hashing: `argon2` or `bcrypt`. Never store a plaintext password, never log one.

### 2. JWT login

```
POST /api/auth/login   → access_token, token_type, expires_in, role, tenant_id, display_name
GET  /api/auth/me      → user_id, role, tenant_id, display_name
```

Short expiry (e.g. 8 h is fine for a hackathon). Signing key from `.env`, never committed.

### 3. The scope object

```python
@dataclass(frozen=True)
class Scope:
    role: Literal["TENANT", "OPERATOR", "SUPER_USER"]
    tenant_id: str | None
    user_id: str
```

Resolved once per request from the JWT by a FastAPI dependency. Never reconstructed inside a
service or a repo.

### 4. `repos/scope.py` — the single choke point

```python
def apply_scope(query, scope: Scope):
    """The ONE place tenant filtering happens. Every tenant-data query calls this."""
```

It adds `WHERE tenant_id = :tenant_id` (joined via `slots` where needed) for `TENANT`, and is a
no-op for `OPERATOR` / `SUPER_USER`.

**Every** repo function that touches telemetry, forecasts, change points, attribution,
proposals, power or audit takes a `Scope` and calls it. No `if role ==` checks scattered in
route handlers — that is exactly how isolation leaks.

### 5. Scope every existing route

Rewrite Phase A's routes to be scoped:

- `GET /api/topology` — a `TENANT` gets the **full rack geometry** (so the 3D hall still
  renders) but every slot they do not own returns
  `tenant_id: null, tenant_label: null, node_id: null, status: "UNKNOWN"`. They cannot learn who
  their neighbour is or whether that neighbour is in trouble.
- `GET /api/nodes/{id}/telemetry` — a foreign node returns **404**, never 403.
- `GET /api/racks/{id}/summary` — a `TENANT` gets a summary computed over **their own slots
  only**. If it would be computed over anything else, it is not returned.
- `GET /api/audit` — scoped to rows whose subject is one of their nodes/proposals, plus their
  own actions.

### 6. Why 404 and not 403

`403` confirms the resource exists. That is itself a leak. A tenant asking for a foreign node
gets `NOT_FOUND`, structurally identical to asking for a node that does not exist. This is
deliberate — do not "fix" it in a later phase.

### 7. Denial auditing

Every scope denial writes a `SCOPE_DENIED` audit row: requesting `user_id`, resource type, and a
**hashed** resource id. It is evidence the isolation works, and it is a strong thing to show a
judge live.

### 8. Aggregate leakage

An average across three tenants tells a tenant about the other two. Rule: a `TENANT` only ever
receives aggregates computed over their own slots. Audit every aggregate you have for this.

---

## The tests — write these now, not at the end

`tests/test_isolation.py`:

1. **Per-resource 404.** Parametrised over *every* resource type (telemetry, summary, forecast,
   changepoints, attribution, power, proposals, audit): a `TENANT` token requesting another
   tenant's resource gets `404`, and the body contains no identifier they should not see.
2. **The enumeration test.** Introspect every public function in `repos/` and assert it accepts
   a `Scope` parameter and calls `apply_scope`. This test must **fail** when someone adds a new
   query and forgets. Write it so the failure message names the offending function.
3. **Topology redaction.** A tenant's `/api/topology` contains the right number of racks and
   slots, and every foreign slot has `tenant_id: null`, `node_id: null`, `status: "UNKNOWN"`.
4. **Aggregate scoping.** A rack summary for a tenant is computed only from their slots.
5. **No `admin` string.** A test that greps the source tree for `admin` (case-insensitive,
   excluding this rule's own text) and fails if it appears in `backend/`.
6. **Denial audit.** A denied request produces exactly one `SCOPE_DENIED` row.

---

## Acceptance — show me

1. Two tokens (operator, tenant), the same URL, two different correct answers.
2. `curl` as a tenant for a foreign node → `404` with the contract error envelope.
3. The enumeration test passing — then deliberately add an unscoped repo function and show it
   **failing**, then remove it.
4. A `SCOPE_DENIED` row appearing after a denied request.
5. `grep -ri admin backend/` returns nothing.

---

## Deliver

- Scoped routes, `repos/scope.py`, the test suite green.
- `tools/seed_users.py` reading a **human-edited** YAML of real users, roles and card UIDs.
  Nothing generated, nothing random. Committed example only.
- Update `backend/README.md` with the auth flow.
- Refresh `graph.md` and `.agents/context.md`. State contract status.

Stop here. Do not start Phase C.
