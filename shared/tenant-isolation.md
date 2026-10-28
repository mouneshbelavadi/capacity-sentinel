# RackSense — Tenant Isolation Specification

The requirement, in one line: **a tenant can never see another tenant's data, by any route.**
Elevated users see everything. The all-servers view is called the **Data Center Dashboard** —
never "admin dashboard".

---

## 1. Roles

| Role | Sees | Approve proposals | Manage tenants / users / RFID cards |
|---|---|---|---|
| `TENANT` | Only slots whose `tenant_id` matches their own | No | No |
| `OPERATOR` | Every slot in the site | Yes | No |
| `SUPER_USER` | Every slot in the site | Yes | Yes |

Human-readable labels: "Tenant", "Operator", "Super User". The string `admin` (any case) must
not appear in routes, component names, table names, labels, page titles or log lines.

---

## 2. Naming

| View | Who | Route | Title shown |
|---|---|---|---|
| All racks, all tenants | `OPERATOR`, `SUPER_USER` | `/datacenter` | **Data Center Dashboard** |
| Own slots only | `TENANT` | `/tenant` | **Tenant Dashboard** |
| User / card management | `SUPER_USER` | `/datacenter/access` | **Access Control** |

On login the app routes by role. A `TENANT` who types `/datacenter` is redirected to `/tenant`
— and the server would return `404` for the underlying data anyway, because the frontend is
never the thing enforcing this.

---

## 3. The enforcement rule

> **Isolation is enforced server-side, in the data access layer, exactly once.**

Concretely:

1. Every request resolves a scope from the JWT: `Scope { role, tenant_id, user_id }`.
2. There is **one** function — `apply_scope(query, scope)` — that adds the tenant filter.
3. **Every** query touching telemetry, forecasts, change points, attribution, proposals,
   power or audit goes through it. No exceptions, no "this one is fine".
4. A test asserts that every repository function calls it. If someone adds a new query and
   forgets, the test suite fails. Write that test early, not at the end.

Why one function: scattered `if role == ...` checks in route handlers is how isolation leaks.
One choke point can be read, reviewed and tested in a minute.

---

## 4. Leak-proofing details that are easy to get wrong

**404, not 403.** A `TENANT` asking for a node they do not own gets `NOT_FOUND`. `403` would
confirm the resource exists — that is itself a leak. This is deliberate; do not "fix" it later.

**Topology is geometry-only for tenants.** A tenant must still see the 3D hall, so the rack
geometry is returned — but every slot they do not own comes back with
`tenant_id: null, tenant_label: null, node_id: null, status: "UNKNOWN"`.
They cannot learn who their neighbour is or whether that neighbour is in trouble.

**WebSocket is scoped at subscribe *and* at send.** A client can ask to subscribe to anything;
the server intersects the request with the token's scope. Every outbound frame is checked
again before it is written. Never trust the subscribe list as the filter.

**Aggregates can leak.** A rack-level average over three tenants tells a tenant about the other
two. Rule: a `TENANT` only ever receives aggregates computed over **their own** slots. If an
aggregate would be computed from fewer than their own slots alone, it is not returned.

**Audit rows are scoped too.** A tenant sees audit rows whose `subject` is one of their nodes
or proposals, plus their own actions. They never see another tenant's approvals, taps or
change points. The hash chain still verifies globally — verification returns `ok` and the head
hash, not the hidden rows.

**AI is scoped.** The prompt builder runs *after* the scope filter. The LLM is given only rows
the requesting user may see, so it cannot summarise a neighbour's rack into a tenant's screen.
This matters: an unscoped RAG retrieval is the most likely way to leak in this architecture.

**Errors and timing.** Error bodies must not echo back identifiers the user cannot see. Keep
not-found and not-owned responses structurally identical.

---

## 5. Audit of denials

Every scope denial writes a `SCOPE_DENIED` audit row with the requesting `user_id`, the
requested resource type, and a hashed resource id. It is evidence the isolation works, and it
is a strong thing to show a judge: *"here is the log of the tenant trying to reach rack 2."*

---

## 6. How to demo isolation in 20 seconds

Two browser windows, side by side:

1. Left: logged in as **Operator** → **Data Center Dashboard**, all racks, both tenants, live.
2. Right: logged in as **Beta Compute (Tenant)** → **Tenant Dashboard**, their slot only;
   neighbouring slots render grey with `UNKNOWN`.
3. In the right window, open devtools and `fetch('/api/nodes/r1-n1/telemetry')` — a node that
   belongs to the other tenant. It returns **404**, not data, not 403.
4. Show the `SCOPE_DENIED` row appearing live in the activity grid in the left window.

That sequence proves the isolation is in the server, not in the UI — which is the only version
of the claim worth making.
