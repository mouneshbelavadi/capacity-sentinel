# Backend prompts — run in order

Each file is a **standalone prompt**. Paste one per Antigravity session (or one per task).
Never run two at once, and never skip ahead — each phase assumes the one before it is working.

**Before every single prompt, run `startup.md`.** It regenerates `graph.md`, refreshes
`.agents/context.md`, and installs the workspace rules. Do not begin a phase until it printed
`STARTUP COMPLETE`.

| Order | File | Builds | Done when |
|---|---|---|---|
| A | `phase-a-ingest.md` | Schema, Mosquitto, MQTT subscriber, first REST routes | A real DHT22 reading is in SQLite and comes back over REST |
| B | `phase-b-auth-isolation.md` | JWT, roles, `apply_scope()`, the isolation test suite | Two tokens, two different answers from the same URL |
| C | `phase-c-analysis.md` | Margins, ETS forecast, CUSUM+PELT, attribution, power | Warming a DHT22 by hand moves a real countdown |
| D | `phase-d-approval-audit.md` | Proposal state machine, nonce, reader endpoints, hash chain | A tap flips a proposal to AUTHORIZED; tampering breaks verify |
| E | `phase-e-ai.md` | Three advisory LLM roles, validation, RAG, discussion chat | An explanation cites real evidence IDs and nothing else |
| F | `phase-f-realtime.md` | WebSocket, scoped frames, batching, timing tests | MQTT → browser inside 500 ms, scoped per tenant |

## The one thing that must stay true across all six

`shared/api-contract.md` is **face-to-face** with the frontend. The backend implements exactly
what is in it. If a phase needs a contract change: bump `CONTRACT_VERSION`, edit the contract,
update both sides, append to the Changelog, and say so in the commit's first line.

## Reference repositories (same for every phase)

- https://github.com/fastapi/fastapi
- https://github.com/pydantic/pydantic
- https://github.com/encode/uvicorn
- https://github.com/eclipse-mosquitto/mosquitto
- https://github.com/eclipse-paho/paho.mqtt.python
- https://github.com/statsmodels/statsmodels
- https://github.com/deepcharles/ruptures
- https://github.com/scikit-learn/scikit-learn
- https://github.com/numpy/numpy
- https://github.com/pgvector/pgvector
- https://github.com/agronholm/apscheduler
- https://github.com/encode/httpx
- https://github.com/pytest-dev/pytest

Do **not** add LangChain, LlamaIndex, Celery, Redis, Docker, Kubernetes or an ORM migration
framework. Each is a moving part that costs more than it returns on a hackathon timeline and on
a 2–4 GB edge board.

## Layout every phase writes into

```
backend/
  api/          routes only — no logic, no SQL
  services/     forecasting, changepoint, attribution, power, ai, approval, audit
  repos/        every query lives here;  repos/scope.py holds apply_scope()
  db/           schema, connection
  ingest/       mqtt subscriber, payload validation, normalisation
  models/       pydantic models mirroring the contract
  tools/synthetic/   the ONLY place generated data may exist
  tests/
```

A route that runs a query is a bug. SQL outside `repos/` is a bug.
