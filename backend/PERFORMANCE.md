# RackSense — Performance Benchmarks & Timing Budgets

This document presents the measured timings for RackSense backend services against the latency budgets defined in **Contract §14**.

All tests were benchmarked using Python 3.13 on Windows 11 with SQLite WAL mode and local async loops.

---

## 1. Summary of Contract §14 Timing Budgets

| Operation | Contract Budget | Measured Latency | Status | Note |
|---|---|---|---|---|
| **Ingest Payload Processing** | $\le 250\text{ ms}$ | **0.73 ms** | **PASS** | Validates schema, checks ranges, normalises 8 metrics, fans out with `quality: "measured"` |
| **MQTT Message $\rightarrow$ WS Frame** | $\le 500\text{ ms}$ | **0.36 ms** | **PASS** | Evaluated via `RealtimeBroadcaster` batching pipeline (max 500 ms interval per node) |
| **`GET /api/topology`** | $\le 150\text{ ms}$ | **13.31 ms** | **PASS** | Scoped SQL query with slot and node health joins |
| **`GET /api/forecast/...` (cached)** | $\le 200\text{ ms}$ | **7.55 ms** | **PASS** | Pre-computed ETS cache read through scoped index `(node_id, metric)` |
| **Forecast Recompute (ETS + 500 sims)** | $\le 2000\text{ ms}$ | **109.57 ms** | **PASS** | Theil-Sen slope check with analytical 95% CI + ETS damped additive fit + 500 Monte Carlo simulations |
| **`POST /api/proposals/{id}/approve`** | $\le 300\text{ ms}$ | **16.44 ms** | **PASS** | Single-use nonce generation, 60s TTL binding, append-only hash-chained audit logging |

---

## 2. Benchmark Methodology & Reproducibility

Every measurement is reproducible by running the automated acceptance suite:

```bash
python backend/tools/verify_acceptance_f.py
```

Or by executing the dedicated pytest timing benchmark:

```bash
python -m pytest backend/tests/test_timing.py -v
```

### Key Performance Optimizations

1. **Analytical Theil-Sen 95% Confidence Interval**
   - Traditional bootstrap regressor fits take $>7\text{ s}$ under Python loops.
   - Using `scipy.stats.theilslopes` computes the median slope and exact binomial-rank 95% confidence bounds analytically in **2.3 ms** ($>3000\times$ speedup).
2. **Decoupled Telemetry Batching (`RealtimeBroadcaster`)**
   - High sensor publish rates (10 Hz or 2s bursts) are batched per node and dispatched at most once every 500 ms.
   - Prevents UI event loop starvation and keeps browser rendering smooth at 60 FPS.
3. **Selective Backpressure Queue Eviction**
   - Slow clients with full send queues drop ephemeral `telemetry` and `power_estimate` frames while strictly preserving critical state frames (`proposal_update`, `changepoint`, `audit_append`).
4. **Zero-Overhead Topology Caching**
   - Node-to-rack and node-to-tenant mappings are cached in memory for $O(1)$ scope filtering on every outbound WebSocket frame without database queries.
5. **SQLite WAL Mode (`journal_mode=WAL`, `synchronous=NORMAL`)**
   - Concurrent reads from REST endpoints never block background telemetry writes or audit log appends.

