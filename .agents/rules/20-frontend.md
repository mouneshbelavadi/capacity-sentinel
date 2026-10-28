---
trigger: glob
globs: "*.tsx, *.ts, *.css"
---

- **React + TypeScript + Vite.** `strict: true`. No `any`. Types for API payloads are generated
  from or hand-mirrored against `shared/api-contract.md` and live in one file,
  `src/api/contract.ts`.
- **One API client.** All fetches go through it. It attaches the token, parses the error
  envelope, and checks `contract_version` on boot.
- **One WebSocket hook.** It handles reconnect with backoff, resync-via-REST on reconnect, and
  exposes a `connected | reconnecting | stale` state the UI actually shows.
- **Never drive React state at sensor rate.** Batch incoming frames and commit at most every
  500 ms. For the 3D scene, mutate refs inside `useFrame`; do not re-render the tree per frame.
- **`<Canvas frameloop="demand">`** and call `invalidate()` after applying an update. Render on
  data, not on a clock.
- **Every error code in the contract has a rendering branch.** No generic catch-all that
  swallows a known code.
- **Loading, empty, stale and error are designed states**, not spinners bolted on at the end.
  "Stale" matters here: if the socket is down, the numbers on screen are old and the UI must
  say so rather than showing confident stale values.
- **Accessibility floor:** visible keyboard focus, `prefers-reduced-motion` respected, status
  never conveyed by colour alone (always an icon or a text badge too), contrast checked.
- **Design tokens only.** No hard-coded hex in a component.
- **Light theme only** — a professional infrastructure console (Google Cloud Console / Power BI
  grade). No dark theme, no toggle, no `prefers-color-scheme` handling. **Outline icons from one
  set only. No emojis anywhere.** No gradients, glass, glow or decoration.
- Apply every skill listed in the Frontend prompt, and state in the plan how each was applied.
