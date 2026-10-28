---
trigger: always_on
---

# Contract discipline (face-to-face)

`shared/api-contract.md` is the single source of truth shared by the backend and the frontend.
They are built face-to-face against it: the frontend may assume nothing that is not written
there, and the backend may return nothing that is not written there.

Never add, rename or remove a field, endpoint, enum value, error code or WebSocket frame type
on one side only.

To change anything in the contract:

1. Bump `CONTRACT_VERSION` (semver).
2. Edit `shared/api-contract.md`.
3. Update **both** the backend and the frontend in the same change.
4. Append a row to the Changelog at the bottom of the contract.
5. Say so in the first line of the commit message.

The backend serves its implemented version at `GET /api/meta`. The frontend checks it on boot
and shows a blocking banner on a major mismatch.

Closed enums you may not extend without a contract bump:

- `meta.quality`: `measured | estimated | inferred | ai_generated`
- Proposal `action`: `REDUCE_TENANT_LOAD | MIGRATE_TENANT | INSPECT_FAN |
  INCREASE_COOLING_SETPOINT_REQUEST | SCHEDULE_MAINTENANCE | NO_ACTION`
- Proposal `status`: `PROPOSED | DISCUSSING | APPROVED_PENDING_TAP | AUTHORIZED | REJECTED |
  EXPIRED`
- Error `code`: the list in §13 of the contract.

If you find drift between code and contract, stop and report it. Do not "fix" it by changing
the contract to match the code without saying so.
