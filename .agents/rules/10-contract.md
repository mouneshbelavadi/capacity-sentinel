---
trigger: always_on
---
The API contract in shared/api-contract.md is the single source of truth shared by the backend
and the frontend. Never add, rename or remove a field, endpoint, enum value or error code on one
side only. To change anything: bump CONTRACT_VERSION, edit shared/api-contract.md, update both
sides in the same change, and append to its Changelog.
