# RackSense — Context
_Last updated: 2026-10-28T19:12:00Z by phase-6-approval.md_

## Contract
- CONTRACT_VERSION in shared/api-contract.md: 1.0.0
- Backend implements: 1.0.0 (simulated via dev handler)   Frontend built against: 1.0.0
- Drift detected: none
- Contract unchanged.

## Current state
Frontend Phase 6 (The proposal, AI commentary, and approval loop) is complete and verified. 88 unit and integration tests passing (`npm test`). Production build passes (`tsc -b && vite build`) with zero TypeScript errors and zero warnings.

Delivered components & features:
1. `src/features/proposals/ProposalStepper.tsx`:
   - Linear 4-step stepper component: `Proposed ──▶ Discussing ──▶ Approved, waiting for tap ──▶ Authorized`.
   - Dedicated off-ramp alert banners for terminal states (`REJECTED` with reason; `EXPIRED` with prompt to approve again).
   - Driven strictly by API status enum, never derived from freeform AI text.
2. `src/features/ai/EvidenceModal.tsx`:
   - Interactive evidence inspection modal for cited record IDs (`fc_...` for forecasts, `cp_...` for change-points, and audit records).
   - Displays model parameters (Monte Carlo paths, empirical coverage, detection latency, SHA-256 hashes).
   - Accessible dialog with ESC key and backdrop dismissal.
3. `src/features/proposals/ProposalCard.tsx`:
   - Human-readable action translation (e.g. `REDUCE_TENANT_LOAD` $\to$ "Reduce tenant load", `MIGRATE_TENANT` $\to$ "Migrate tenant").
   - Unicode emoji stripping function sanitizing LLM output before rendering.
   - Field-level diff highlighting against previous proposal version when AI provides a revision in chat.
   - Pre-approval discussion thread (`POST /api/ai/chat`) with audited sequence numbers (`audited: seq #...`) per exchange.
   - Server-derived authoritative countdown: `(new Date(expires_at).getTime() - Date.now()) / 1000`, never a client-side tick counter.
   - Screen reader live announcements (`aria-live="polite"`) at sensible intervals (60s, 30s, 10s, 5s).
   - TFT Display mirror box displaying physical reader status ("ARMED • Tap card to authorize") and reader heartbeat.
   - Proceed button renders strictly for `OPERATOR` and `SUPER_USER`. Never renders for `TENANT`.
   - Terminal state cards: `AUTHORIZED` (with authorized actor and head hash in monospace) and `REJECTED` (with plain language rejection reasons).
4. `src/features/ai/AiPanel.tsx`:
   - Sits on `--surface-sunken` with 1px border and prominent `AI · ADVISORY` chip.
   - Three primary actions: Summarize (`POST /api/ai/summarize`), Explain forecast (`POST /api/ai/explain`), and Propose action (`POST /api/ai/propose`).
   - Clickable evidence chips opening `EvidenceModal`.
   - Graceful `AI_UNAVAILABLE` handling with explanatory warning state.
   - Mounted inside `SlotDetailPanel.tsx` for selected slots.
5. `src/features/proposals/ApprovalsView.tsx`:
   - Full-page Facility Approvals Queue mounted at `/datacenter/approvals` and `/tenant/approvals`.
   - Filterable by proposal status (`all`, `PROPOSED`, `DISCUSSING`, `APPROVED_PENDING_TAP`, `AUTHORIZED`, `REJECTED`, `EXPIRED`).
   - Integrated side-sheet opening `ProposalCard` for deep inspection and operator action.
6. `src/features/audit/AuditView.tsx`:
   - Full audit log page mounted at `/datacenter/audit` and `/tenant/audit`.
   - Prominent cryptographic verification hero bar calling `GET /api/audit/verify`.
   - Turns `--crit` naming the exact broken row (`Chain Broken at Row 903`) upon tamper detection.
   - Interactive "Simulate Tamper" toggle for judges and live demonstrations.
   - Complete append-only data grid with `seq`, timestamp, actor, event type, subject, and truncated monospace SHA-256 hash with one-click copy button.
   - Detail inspection panel for inspecting complete canonical JSON payload.
7. Navigation & App Integration:
   - Full routing connected in `App.tsx` and accessible via navigation bar in `Shell.tsx`.

## Subsystem status
| Subsystem | State | Where it lives | Notes |
|---|---|---|---|
| Ingest | Not started | `backend/` | Mosquitto MQTT broker on UNO Q |
| Storage | Not started | `backend/` | SQLite WAL telemetry |
| Forecast | Not started | `backend/` | ETS damped additive + Monte Carlo |
| Change-point | Not started | `backend/` | CUSUM + PELT agreement |
| Attribution | Not started | `backend/` | Inferred tenant contribution |
| Power | Not started | `backend/` | Estimated CPU-utilization linear model |
| AI | Implemented (Frontend UI & dev server) | `frontend/src/features/ai/` | Advisory cloud LLM, closed whitelist, AI · ADVISORY chip |
| Approval | Implemented (Frontend UI & dev server) | `frontend/src/features/proposals/` | Server state machine, single-use 60s nonce, RFID mirror |
| Audit | Implemented (Frontend UI & dev server) | `frontend/src/features/audit/` | Append-only SHA256 hash chain verification, tamper detection |
| Frontend | Complete (Phases 1–6) | `frontend/` | All 6 phases complete (88 tests passing). |
| Firmware | Not started | `firmware/` | ESP32 env, ESP32-S3 vib, reader |

## Decisions made (append-only — never delete a row)
| Date | Decision | Why | Who/what prompted it |
|---|---|---|---|
| 2026-10-28 | Light theme only; no dark theme or toggle | Target look is a professional infrastructure console (GCP/Power BI grade) | `shared/design-system.md` §1 |
| 2026-10-28 | Never use the word 'admin' | Role is SUPER_USER / "Super User", view is Data Center Dashboard | `rules.md` §1, `shared/tenant-isolation.md` |
| 2026-10-28 | Single source of truth for contract types in `src/api/contract.ts` | Eliminates payload drift between backend and frontend | `phase-1-foundation.md` §4 |
| 2026-10-28 | Blocking banner on major contract version mismatch | Immediate detection of backend drift | `phase-1-foundation.md` §5 |
| 2026-10-28 | Value component as provenance gatekeeper | Every number must carry its meta.quality treatment | `rules.md` §0, §2 |
| 2026-10-28 | Tailwind stock palette completely replaced by design system CSS tokens | Prevent any hex or uncurated stock colors in components | `phase-1-foundation.md` §1 |
| 2026-10-28 | Client-side tenant redirection documented as convenience, not security | Tenant isolation is enforced server-side via apply_scope | `shared/tenant-isolation.md` §2, `phase-1-foundation.md` §6 |
| 2026-10-28 | DetailPanel replaces modal dialogs for item inspection | Modals interrupt operator context; side panel keeps console context | `shared/design-system.md` §4 |
| 2026-10-28 | Foreign slots render with .hatch-foreign and 'Not your slot' | Distinguishes neighbour slots clearly without ambiguity or implying healthy status | `phase-2-topology.md` §2 |
| 2026-10-28 | 404 NOT_FOUND returned on foreign node telemetry, never 403 | 403 would confirm resource existence and leak tenant infrastructure metadata | `shared/tenant-isolation.md` §4 |
| 2026-10-28 | MQ135 warming state renders text banner with zero numbers | Sensors must finish preheat before readings are meaningful; no invented numbers | `rules.md` §0, `phase-2-topology.md` §5 |
| 2026-10-28 | Unbaselined metrics explicitly render 'No baseline captured' without status | Status cannot be derived without a baseline; displaying OK/WARN would be dishonest | `rules.md` §0, §2 |
| 2026-10-28 | Clean 2D RackGrid boundary kept modular for Phase 5 3D WebGL swap | Ensures clean replacement of centre viewport with Three.js canvas in single import | `phase-2-topology.md` §1 |
| 2026-10-28 | 500 ms batching buffer in single WebSocket client | Prevents re-rendering React tree at sensor rate; caps render commits at ≤ 2/s | `phase-3-realtime.md` §2 |
| 2026-10-28 | Three explicit connection states in header indicator | Stale data (> 10s) must be visibly identified to avoid misleading operators | `phase-3-realtime.md` §3 |
| 2026-10-28 | Per-value freshness with quiet age and prominent stale badge past 30s | Preserves honesty about temporal validity of each telemetry item | `phase-3-realtime.md` §4 |
| 2026-10-28 | Changepoint toast separates known physical fact from statistical shift | Prevents confusing an automated CUSUM shift with a physical causes | `phase-3-realtime.md` §6 |
| 2026-10-28 | Strict 600 ms motion budget on escalation pulse with reduced-motion support | Prevents visual fatigue while ensuring safety alarms are seen; fully accessible | `phase-3-realtime.md` §7 |
| 2026-10-28 | Never dual-axis charts; separate power and vibration onto dedicated charts | Dual-axis charts deceive human scale perception; dedicated charts keep axes honest | `phase-4-charts.md` §0 |
| 2026-10-28 | Single hue at low opacity for P10-P90 forecast cone range band | Forecast is a probability distribution; avoided rainbow bands or stacked artifacts | `phase-4-charts.md` §1 |
| 2026-10-28 | When has_trend is false, cone disappears and text states no sustained trend | Prevents inventing an ETA when the slope confidence interval contains zero | `phase-4-charts.md` §1 |
| 2026-10-28 | Vibration y-axis labelled exclusively as '× baseline' with 2×/4× reference lines | Low-cost sensor on fan mount cannot measure absolute ISO mm/s velocity | `phase-4-charts.md` §3 |
| 2026-10-28 | Tenant attribution renders basis string underneath every bar | Inferred statistical correlations must explain their mathematical basis to operators | `phase-4-charts.md` §4 |
| 2026-10-28 | Accessible table view toggle on every chart | Provides accessibility and instant verification against raw contract payloads | `phase-4-charts.md` §6 |
| 2026-10-28 | Hand-built box geometry for 3D rack hall; no GLTF models, no shadows, no post-processing | Keeps memory footprint low and maintains 60 fps on integrated GPUs without asset load times | `phase-5-hall.md` §Stack |
| 2026-10-28 | `<Canvas frameloop="demand">` with data-driven invalidate() | Renders exclusively on telemetry updates, selection changes, and user interaction | `phase-5-hall.md` §4 |
| 2026-10-28 | Direct material.color ref mutation for 3D slots | Prevents re-rendering the React tree on real-time sensor frames | `phase-5-hall.md` §4 |
| 2026-10-28 | Procedural diagonal crosshatch canvas texture on foreign slots with zero status color | Ensures foreign slots look unmistakably like unpermitted data, never green/OK | `phase-5-hall.md` §3 |
| 2026-10-28 | Keyboard navigation parity in left rail with slot selection | Preserves keyboard accessibility so the application never depends solely on 3D mouse interaction | `phase-5-hall.md` §5 |
| 2026-10-28 | Automatic WebGL fallback to 2D elevation grid with user toggle | Ensures dashboards remain fully functional in headless environments or on non-WebGL devices | `phase-5-hall.md` §7 |
| 2026-10-28 | Human-readable action mapping for proposals | Raw action enums (e.g. REDUCE_TENANT_LOAD) never appear unformatted on screen | `phase-6-approval.md` §2 |
| 2026-10-28 | Strict unicode emoji sanitization on LLM advisory strings | Clean typography without informal emoji graphics; only Lucide outline icons used | `phase-6-approval.md` §1 |
| 2026-10-28 | Server-derived expires_at countdown calculation | Eliminates drift from local setTimeout/setInterval counters; matches hardware reader | `phase-6-approval.md` §3 |
| 2026-10-28 | Proceed button strictly suppressed for tenants (rendered only for operators) | Tenants cannot arm hardware nonces; tenant approval attempt yields 404 server-side | `phase-6-approval.md` §3, `shared/tenant-isolation.md` |
| 2026-10-28 | Field-level diff highlighting on proposal revisions | Clearly communicates what changed after interactive operator discussion | `phase-6-approval.md` §2 |
| 2026-10-28 | Cryptographic verification hero banner with live tamper simulation toggle | Demonstrates append-only SHA-256 integrity check and identifies broken row | `phase-6-approval.md` §4 |

## Open questions for the human
None. Phase 6 AI proposal, advisory discussion, physical tap approval state machine, and cryptographic audit log views are fully implemented and verified.

## Known limitations we are deliberately keeping
- Live MQTT hardware connection and physical ESP32 reader tap hardware are planned for backend and firmware phases.

## Next actions
Frontend Subsystem complete across all 6 phases. Ready for Backend and Firmware subsystems.
