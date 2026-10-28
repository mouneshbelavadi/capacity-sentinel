/**
 * RackSense — API Contract Types (v1.0.0)
 *
 * This file is the single source of truth hand-mirrored from shared/api-contract.md.
 * No payload type is declared anywhere else in the codebase.
 */

export const CONTRACT_VERSION = '1.0.0';

// ==========================================
// Closed Enums (as TypeScript union types)
// ==========================================

export type Quality =
  | 'measured'
  | 'estimated'
  | 'inferred'
  | 'ai_generated'
  | 'synthetic';

export type Role =
  | 'TENANT'
  | 'OPERATOR'
  | 'SUPER_USER';

export type Status =
  | 'OK'
  | 'WARN'
  | 'CRIT'
  | 'OFFLINE'
  | 'UNKNOWN';

export type Metric =
  | 't_c'
  | 'rh'
  | 'dew_c'
  | 'mq_ratio'
  | 'vib_rms_g'
  | 'vib_crest'
  | 'shock_count'
  | 'power_w';

export type ProposalAction =
  | 'REDUCE_TENANT_LOAD'
  | 'MIGRATE_TENANT'
  | 'INSPECT_FAN'
  | 'INCREASE_COOLING_SETPOINT_REQUEST'
  | 'SCHEDULE_MAINTENANCE'
  | 'NO_ACTION';

export type ProposalStatus =
  | 'PROPOSED'
  | 'DISCUSSING'
  | 'APPROVED_PENDING_TAP'
  | 'AUTHORIZED'
  | 'REJECTED'
  | 'EXPIRED';

export type RiskTier =
  | 'LOW'
  | 'MEDIUM'
  | 'HIGH';

export type AuditEvent =
  | 'TELEMETRY_GAP'
  | 'CHANGE_POINT'
  | 'FORECAST_ISSUED'
  | 'AI_PROPOSAL'
  | 'AI_EVIDENCE_INVALID'
  | 'PROPOSAL_APPROVED'
  | 'TAP_AUTHORIZED'
  | 'TAP_REJECTED'
  | 'NODE_ONLINE'
  | 'NODE_OFFLINE'
  | 'SCOPE_DENIED';

export type ErrorCode =
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'VALIDATION_ERROR'
  | 'CONTRACT_VERSION_MISMATCH'
  | 'NONCE_EXPIRED'
  | 'NONCE_CONSUMED'
  | 'UID_NOT_AUTHORIZED'
  | 'DEVICE_UNKNOWN'
  | 'HMAC_INVALID'
  | 'CLOCK_SKEW'
  | 'AI_EVIDENCE_INVALID'
  | 'AI_ACTION_NOT_WHITELISTED'
  | 'AI_UNAVAILABLE'
  | 'FORECAST_INSUFFICIENT_DATA'
  | 'SENSOR_WARMING_UP'
  | 'RATE_LIMITED'
  | 'INTERNAL';

// ==========================================
// Provenance & Core Envelopes
// ==========================================

export interface MetaProvenance {
  quality: Quality;
  source?: string | null;
  model?: string | null;
  uncertainty_pct?: number | null;
  as_of: string;
  basis?: string | null;
}

export interface ProvenanceValue<T = number> {
  value: T;
  unit: string;
  meta: MetaProvenance;
}

export interface ApiErrorDetail {
  code: ErrorCode;
  message: string;
  detail?: Record<string, unknown>;
}

export interface ApiErrorEnvelope {
  error: ApiErrorDetail;
}

// ==========================================
// Meta & Auth Payloads
// ==========================================

export interface MetaResponse {
  contract_version: string;
  server_time: string;
  site_id: string;
}

export interface LoginRequest {
  username: string;
  password: string;
}

export interface LoginResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  role: Role;
  tenant_id: string | null;
  display_name: string;
}

export interface AuthMeResponse {
  user_id: string;
  role: Role;
  tenant_id: string | null;
  display_name: string;
}

// ==========================================
// Topology Payloads
// ==========================================

export interface Slot {
  slot_id: string;
  u_start: number;
  u_height: number;
  tenant_id: string | null;
  tenant_label: string | null;
  node_id: string | null;
  status: Status;
}

export interface RackPosition {
  row: number;
  col: number;
}

export interface Rack {
  rack_id: string;
  label: string;
  position: RackPosition;
  slots: Slot[];
}

export interface TopologyResponse {
  site_id: string;
  racks: Rack[];
}

export interface TenantInfo {
  tenant_id: string;
  label: string;
  slot_count: number;
  contact: string;
}

export interface TenantsResponse {
  tenants: TenantInfo[];
}

// ==========================================
// Telemetry & Summary Payloads
// ==========================================

export interface TelemetryPoint {
  ts: string;
  value: number;
}

export interface TelemetryResponse {
  node_id: string;
  metric: Metric;
  unit: string;
  step_s: number;
  points: TelemetryPoint[];
  meta: MetaProvenance;
}

export interface WorstMargin {
  metric: Metric;
  node_id: string;
  value: ProvenanceValue;
  limit: number;
  limit_source: string;
}

export interface RackSummaryResponse {
  rack_id: string;
  status: 'OK' | 'WARN' | 'CRIT';
  worst_margin: WorstMargin;
  nodes_online: number;
  nodes_total: number;
}

export interface PowerModelDetail {
  formula: string;
  p_idle_w: number;
  p_busy_w: number;
  u: number;
  calibrated: boolean;
  reference: string;
}

export interface PowerResponse {
  node_id: string;
  value: ProvenanceValue;
  model_detail: PowerModelDetail;
}

// ==========================================
// Forecast & Change Points Payloads
// ==========================================

export interface ForecastCrossing {
  has_trend: boolean;
  p10_s: number | null;
  p50_s: number | null;
  p90_s: number | null;
  no_breach_fraction: number;
}

export interface ForecastSlope {
  value: number;
  unit: string;
  ci_low: number;
  ci_high: number;
}

export interface ForecastCalibration {
  nominal: number;
  empirical_coverage: number;
  widen_factor: number;
}

export interface ForecastResponse {
  forecast_id: string;
  node_id: string;
  metric: Metric;
  limit: number;
  limit_source: string;
  model: string;
  window_start: string;
  window_reason: 'changepoint:cp_0042' | 'cold_start' | 'rolling_30m' | string;
  horizon_s: number;
  history: TelemetryPoint[];
  median: TelemetryPoint[];
  p10: TelemetryPoint[];
  p90: TelemetryPoint[];
  crossing: ForecastCrossing;
  slope: ForecastSlope;
  calibration: ForecastCalibration;
  meta: MetaProvenance;
}

export interface ChangePointShift {
  before_mean: number;
  after_mean: number;
  delta: number;
}

export interface ChangePointTopologyEvent {
  type: 'node_online' | 'node_offline';
  node_id: string;
}

export interface ChangePoint {
  cp_id: string;
  node_id: string;
  metric: Metric;
  detected_at: string;
  located_at: string;
  detector: string;
  confirmed: boolean;
  shift: ChangePointShift;
  topology_event: ChangePointTopologyEvent | null;
  meta: MetaProvenance;
}

export interface ChangePointsResponse {
  changepoints: ChangePoint[];
}

export interface AttributionContributor {
  tenant_id: string;
  tenant_label: string;
  share: number;
  basis: string;
  meta: MetaProvenance;
}

export interface AttributionResponse {
  rack_id: string;
  metric: Metric;
  contributors: AttributionContributor[];
}

// ==========================================
// AI & Proposals Payloads
// ==========================================

export interface AiSummarizeRequest {
  scope: 'site' | 'rack' | 'node';
  id: string;
}

export interface AiSummarizeResponse {
  text: string;
  status_hint: 'OK' | 'WARN' | 'CRIT';
  evidence: string[];
  meta: MetaProvenance;
}

export interface ProposalScope {
  rack_id: string;
  node_id: string;
  tenant_id: string;
}

export interface Proposal {
  proposal_id: string;
  created_at: string;
  scope: ProposalScope;
  action: ProposalAction;
  target: string;
  rationale: string;
  expected_effect: string;
  evidence: string[];
  risk_tier: RiskTier;
  status: ProposalStatus;
  meta: MetaProvenance;
}

export interface ProposalsResponse {
  proposals: Proposal[];
}

export interface AiChatRequest {
  proposal_id: string;
  message: string;
}

export interface AiChatResponse {
  reply: string;
  proposal_revision: Proposal | null;
  meta: MetaProvenance;
}

export interface ApproveProposalResponse {
  proposal_id: string;
  status: 'APPROVED_PENDING_TAP';
  nonce: string;
  expires_at: string;
  reader_device_id: string;
}

export interface RejectProposalResponse {
  proposal_id: string;
  status: 'REJECTED';
}

// ==========================================
// Reader Device Payloads
// ==========================================

export type ReaderPendingResponse =
  | { armed: false }
  | {
      armed: true;
      proposal_id: string;
      nonce: string;
      expires_at: string;
      expires_in_s: number;
      action: ProposalAction;
      target: string;
      line1: string;
      line2: string;
      risk_tier: RiskTier;
    };

export interface ReaderTapRequest {
  uid: string;
  nonce: string;
  ts: number;
  hmac: string;
}

export type ReaderTapResponse =
  | {
      result: 'AUTHORIZED';
      proposal_id: string;
      actor: string;
      audit_hash: string;
      message: string;
    }
  | {
      result: 'REJECTED';
      reason: string;
      message: string;
    };

export interface ReaderHeartbeatRequest {
  fw: string;
  rssi: number;
  uptime_s: number;
}

export interface ReaderHeartbeatResponse {
  server_time: number;
}

// ==========================================
// Audit Payloads
// ==========================================

export interface AuditRowSubject {
  node_id?: string;
  proposal_id?: string;
  [key: string]: unknown;
}

export interface AuditRow {
  seq: number;
  ts: string;
  actor: string;
  event: AuditEvent;
  subject: AuditRowSubject;
  payload: Record<string, unknown>;
  prev_hash: string;
  hash: string;
}

export interface AuditResponse {
  rows: AuditRow[];
}

export interface AuditVerifyResponse {
  ok: boolean;
  rows_checked: number;
  head_hash: string;
  broken_at: number | null;
}

// ==========================================
// WebSocket Frames
// ==========================================

export type WebSocketServerFrame =
  | { type: 'telemetry'; ts: string; data: { node_id: string; metric: Metric; value: number; unit: string; meta: MetaProvenance } }
  | { type: 'node_status'; ts: string; data: { node_id: string; status: 'online' | 'offline'; rssi: number } }
  | { type: 'changepoint'; ts: string; data: ChangePoint }
  | { type: 'forecast_update'; ts: string; data: Partial<ForecastResponse> & { forecast_id: string; crossing: ForecastCrossing } }
  | { type: 'proposal_update'; ts: string; data: Proposal }
  | { type: 'audit_append'; ts: string; data: { seq: number; event: AuditEvent; hash: string } }
  | { type: 'power_estimate'; ts: string; data: { node_id: string; value: number; unit: string; meta: MetaProvenance } };

export type WebSocketClientFrame =
  | { type: 'subscribe'; data: { racks: string[]; metrics: Metric[] } }
  | { type: 'ping'; data: Record<string, never> };
