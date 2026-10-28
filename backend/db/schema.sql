-- RackSense SQLite Database Schema (Phase A)
-- Target: SQLite with WAL mode on Arduino UNO Q (Debian Linux)

PRAGMA journal_mode=WAL;
PRAGMA synchronous=NORMAL;
PRAGMA foreign_keys=ON;

CREATE TABLE IF NOT EXISTS sites (
    site_id TEXT PRIMARY KEY,
    label TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS racks (
    rack_id TEXT PRIMARY KEY,
    site_id TEXT NOT NULL REFERENCES sites(site_id),
    label TEXT NOT NULL,
    row INTEGER NOT NULL,
    col INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS tenants (
    tenant_id TEXT PRIMARY KEY,
    label TEXT NOT NULL,
    contact TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS nodes (
    node_id TEXT PRIMARY KEY,
    rack_id TEXT NOT NULL REFERENCES racks(rack_id),
    fw TEXT,
    last_seen_at TEXT,
    status TEXT NOT NULL DEFAULT 'UNKNOWN', -- 'OK', 'WARN', 'CRIT', 'OFFLINE', 'UNKNOWN'
    last_seq INTEGER
);

CREATE TABLE IF NOT EXISTS slots (
    slot_id TEXT PRIMARY KEY,
    rack_id TEXT NOT NULL REFERENCES racks(rack_id),
    u_start INTEGER NOT NULL,
    u_height INTEGER NOT NULL,
    tenant_id TEXT REFERENCES tenants(tenant_id),
    node_id TEXT REFERENCES nodes(node_id)
);

CREATE TABLE IF NOT EXISTS telemetry (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    node_id TEXT NOT NULL REFERENCES nodes(node_id),
    metric TEXT NOT NULL,
    ts TEXT NOT NULL,             -- Device timestamp (ISO 8601 UTC)
    received_at TEXT NOT NULL,    -- Edge server timestamp (ISO 8601 UTC)
    value REAL NOT NULL,
    quality TEXT NOT NULL,        -- 'measured', 'estimated', 'inferred', 'ai_generated', 'synthetic'
    seq INTEGER NOT NULL,
    backfilled INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_telemetry_node_metric_ts ON telemetry (node_id, metric, ts);

-- Audit table: INSERT-ONLY. NO UPDATE and NO DELETE anywhere in the codebase.
CREATE TABLE IF NOT EXISTS audit (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    ts TEXT NOT NULL,
    actor TEXT NOT NULL,
    event TEXT NOT NULL,
    subject_json TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    prev_hash TEXT NOT NULL,
    hash TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS baselines (
    node_id TEXT NOT NULL REFERENCES nodes(node_id),
    metric TEXT NOT NULL,
    value REAL NOT NULL,
    captured_at TEXT NOT NULL,
    sample_count INTEGER NOT NULL,
    PRIMARY KEY (node_id, metric)
);

CREATE TABLE IF NOT EXISTS users (
    user_id TEXT PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL,           -- 'TENANT', 'OPERATOR', 'SUPER_USER'
    tenant_id TEXT REFERENCES tenants(tenant_id),
    display_name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cards (
    uid TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(user_id),
    active INTEGER NOT NULL DEFAULT 1,
    max_risk_tier INTEGER NOT NULL DEFAULT 1,
    issued_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS changepoints (
    cp_id TEXT PRIMARY KEY,
    node_id TEXT NOT NULL REFERENCES nodes(node_id),
    metric TEXT NOT NULL,
    detected_at TEXT NOT NULL,
    located_at TEXT NOT NULL,
    detector TEXT NOT NULL,
    confirmed INTEGER NOT NULL DEFAULT 1,
    before_mean REAL NOT NULL,
    after_mean REAL NOT NULL,
    delta REAL NOT NULL,
    topology_event_json TEXT,
    meta_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS forecast_cache (
    node_id TEXT NOT NULL,
    metric TEXT NOT NULL,
    forecast_id TEXT NOT NULL,
    computed_at TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    PRIMARY KEY (node_id, metric)
);

CREATE TABLE IF NOT EXISTS proposals (
    proposal_id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL,
    scope_json TEXT NOT NULL,
    action TEXT NOT NULL,
    target TEXT NOT NULL,
    rationale TEXT NOT NULL,
    expected_effect TEXT NOT NULL,
    evidence_json TEXT NOT NULL,
    risk_tier TEXT NOT NULL,       -- 'LOW', 'MEDIUM', 'HIGH'
    status TEXT NOT NULL,          -- 'PROPOSED', 'DISCUSSING', 'APPROVED_PENDING_TAP', 'AUTHORIZED', 'REJECTED', 'EXPIRED'
    model TEXT,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS reader_devices (
    device_id TEXT PRIMARY KEY,
    device_secret TEXT NOT NULL,
    secret_hash TEXT NOT NULL,
    label TEXT NOT NULL,
    registered_at TEXT NOT NULL,
    last_seen_at TEXT,
    last_fw TEXT,
    last_rssi INTEGER
);

CREATE TABLE IF NOT EXISTS nonces (
    nonce TEXT PRIMARY KEY,
    proposal_id TEXT NOT NULL REFERENCES proposals(proposal_id),
    reader_device_id TEXT NOT NULL REFERENCES reader_devices(device_id),
    issued_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    consumed_at TEXT,             -- NULL until consumed atomically
    issued_by_user_id TEXT NOT NULL
);
