/**
 * RackSense — Single WebSocket Client & Hook
 *
 * Implements shared/api-contract.md §12 and phase-3-realtime.md:
 * - Exactly one WebSocket connection.
 * - Exponential backoff capped at 30 s.
 * - On reconnect: resync via REST, then resubscribe.
 * - Heartbeat: ping/pong every 10 s; dropped connection if pong misses.
 * - Batching: frames buffered and committed at most every 500 ms (≤ 2 commits/s).
 * - Exposes connection states: 'connected' | 'reconnecting' | 'stale'.
 */

import { useEffect, useState } from 'react';
import {
  Metric,
  WebSocketServerFrame,
  WebSocketClientFrame,
  MetaProvenance,
  ChangePoint,
  AuditEvent,
} from './contract';
import { getStoredToken } from './client';

export type ConnectionStatus = 'connected' | 'reconnecting' | 'stale';

export interface TelemetryReading {
  node_id: string;
  metric: Metric;
  value: number;
  unit: string;
  meta: MetaProvenance;
  received_at: string;
}

export interface NodeStatusInfo {
  node_id: string;
  status: 'online' | 'offline';
  rssi?: number;
  offlineSince?: string;
  lastSeen?: string;
}

export interface AuditAppendItem {
  seq: number;
  event: AuditEvent;
  hash: string;
  ts: string;
}

export interface SubscriptionConfig {
  racks: string[];
  metrics: Metric[];
}

export interface RealtimeState {
  status: ConnectionStatus;
  reconnectAttempt: number;
  lastFrameAt: Date | null;
  tickAge: number;
  telemetry: Record<string, TelemetryReading>; // key: `${node_id}:${metric}`
  powerEstimates: Record<string, TelemetryReading>; // key: node_id
  nodeStatuses: Record<string, NodeStatusInfo>; // key: node_id
  recentAudits: AuditAppendItem[];
  latestChangePoint: ChangePoint | null;
  escalationSlotIds: string[]; // Slot IDs currently escalating (single pulse)
}

// Global singleton state so all subscribers share the one connection
type Listener = () => void;
const listeners = new Set<Listener>();

let activeWs: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let heartbeatInterval: ReturnType<typeof setInterval> | null = null;
let pongTimeoutTimer: ReturnType<typeof setTimeout> | null = null;
let flushIntervalTimer: ReturnType<typeof setInterval> | null = null;
let tickTimer: ReturnType<typeof setInterval> | null = null;

let currentSubscription: SubscriptionConfig = { racks: [], metrics: [] };
let resyncCallbacks = new Set<() => Promise<void> | void>();
let changepointCallbacks = new Set<(cp: ChangePoint) => void>();

// Stable changepoint subscription function
export const subscribeChangepoint = (cb: (cp: ChangePoint) => void) => {
  changepointCallbacks.add(cb);
  return () => {
    changepointCallbacks.delete(cb);
  };
};

// 500 ms batch buffer
let incomingFrameBuffer: WebSocketServerFrame[] = [];

// Single source of truth for realtime data
let internalState: RealtimeState = {
  status: 'connected',
  reconnectAttempt: 0,
  lastFrameAt: null,
  tickAge: 0,
  telemetry: {},
  powerEstimates: {},
  nodeStatuses: {},
  recentAudits: [],
  latestChangePoint: null,
  escalationSlotIds: [],
};

export function resetWebSocketForTesting() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }
  if (pongTimeoutTimer) {
    clearTimeout(pongTimeoutTimer);
    pongTimeoutTimer = null;
  }
  if (flushIntervalTimer) {
    clearInterval(flushIntervalTimer);
    flushIntervalTimer = setInterval(flushBatch, 500);
  }
  if (activeWs) {
    activeWs.close();
    activeWs = null;
  }
  incomingFrameBuffer = [];
  internalState = {
    status: 'connected',
    reconnectAttempt: 0,
    lastFrameAt: null,
    tickAge: 0,
    telemetry: {},
    powerEstimates: {},
    nodeStatuses: {},
    recentAudits: [],
    latestChangePoint: null,
    escalationSlotIds: [],
  };
  notify();
}

export function pushFrameForTesting(frame: WebSocketServerFrame) {
  incomingFrameBuffer.push(frame);
}

export function flushBatchForTesting() {
  flushBatch();
}

export function getBufferedFramesCountForTesting(): number {
  return incomingFrameBuffer.length;
}

function notify() {
  listeners.forEach((l) => l());
}

// Reset escalation pulse after single 600 ms animation
function triggerEscalationPulse(slotId: string) {
  if (!internalState.escalationSlotIds.includes(slotId)) {
    internalState = {
      ...internalState,
      escalationSlotIds: [...internalState.escalationSlotIds, slotId],
    };
    notify();

    setTimeout(() => {
      internalState = {
        ...internalState,
        escalationSlotIds: internalState.escalationSlotIds.filter((id) => id !== slotId),
      };
      notify();
    }, 600);
  }
}

// Batch flush: processes all buffered frames every 500 ms in a single commit
function flushBatch() {
  if (incomingFrameBuffer.length === 0) return;

  const frames = incomingFrameBuffer;
  incomingFrameBuffer = [];

  let telemUpdated = false;
  const newTelem = { ...internalState.telemetry };
  const newPower = { ...internalState.powerEstimates };
  const newStatuses = { ...internalState.nodeStatuses };
  const newAudits = [...internalState.recentAudits];
  let newCp = internalState.latestChangePoint;

  frames.forEach((frame) => {
    if (frame.type === 'telemetry') {
      const { node_id, metric, value, unit, meta } = frame.data;
      const key = `${node_id}:${metric}`;
      newTelem[key] = {
        node_id,
        metric,
        value,
        unit,
        meta,
        received_at: frame.ts,
      };
      telemUpdated = true;
    } else if (frame.type === 'power_estimate') {
      const { node_id, value, unit, meta } = frame.data;
      newPower[node_id] = {
        node_id,
        metric: 'power_w',
        value,
        unit,
        meta: {
          ...meta,
          quality: 'estimated',
          model: meta.model || 'linear-cpu-v1',
        },
        received_at: frame.ts,
      };
      telemUpdated = true;
    } else if (frame.type === 'node_status') {
      const { node_id, status, rssi } = frame.data;
      const prev = newStatuses[node_id];
      newStatuses[node_id] = {
        node_id,
        status,
        rssi,
        offlineSince: status === 'offline' ? (prev?.offlineSince || frame.ts) : undefined,
        lastSeen: status === 'online' ? frame.ts : prev?.lastSeen,
      };
      telemUpdated = true;
    } else if (frame.type === 'changepoint') {
      newCp = frame.data;
      changepointCallbacks.forEach((cb) => cb(frame.data));
      telemUpdated = true;
    } else if (frame.type === 'audit_append') {
      const { seq, event, hash } = frame.data;
      newAudits.unshift({
        seq,
        event,
        hash,
        ts: frame.ts,
      });
      if (newAudits.length > 50) newAudits.pop();
      telemUpdated = true;
    }
  });

  if (telemUpdated) {
    internalState = {
      ...internalState,
      telemetry: newTelem,
      powerEstimates: newPower,
      nodeStatuses: newStatuses,
      recentAudits: newAudits,
      latestChangePoint: newCp,
    };
    notify();
  }
}

// Tick timer: calculates tickAge and detects stale state (> 10 s with no frames)
function setupTickTimer() {
  if (tickTimer) clearInterval(tickTimer);
  tickTimer = setInterval(() => {
    if (!internalState.lastFrameAt) {
      if (internalState.status === 'connected') {
        internalState = { ...internalState, tickAge: internalState.tickAge + 1 };
        notify();
      }
      return;
    }

    const elapsed = Math.round((Date.now() - internalState.lastFrameAt.getTime()) / 1000);
    const isStale = elapsed > 10;
    const newStatus = isStale ? 'stale' : 'connected';

    if (internalState.tickAge !== elapsed || internalState.status !== newStatus) {
      internalState = {
        ...internalState,
        tickAge: elapsed,
        status: internalState.status === 'reconnecting' ? 'reconnecting' : newStatus,
      };
      notify();
    }
  }, 1000);
}

// Establish single WebSocket connection
export function connectWebSocket() {
  if (activeWs && (activeWs.readyState === WebSocket.OPEN || activeWs.readyState === WebSocket.CONNECTING)) {
    return;
  }

  const token = getStoredToken() || 'token-operator-session';
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}/ws?token=${encodeURIComponent(token)}`;

  try {
    const ws = new WebSocket(wsUrl);
    activeWs = ws;

    ws.onopen = async () => {
      // 1. Resync via REST first per phase-3-realtime.md §1
      internalState = {
        ...internalState,
        reconnectAttempt: 0,
        status: 'connected',
      };
      notify();

      for (const resync of resyncCallbacks) {
        try {
          await resync();
        } catch {
          // ignore resync error
        }
      }

      // 2. Resubscribe current configuration
      sendSubscribe(currentSubscription);

      // 3. Start 10s ping/pong heartbeat
      if (heartbeatInterval) clearInterval(heartbeatInterval);
      heartbeatInterval = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          const pingFrame: WebSocketClientFrame = { type: 'ping', data: {} };
          ws.send(JSON.stringify(pingFrame));

          // Expect pong within 5s
          if (pongTimeoutTimer) clearTimeout(pongTimeoutTimer);
          pongTimeoutTimer = setTimeout(() => {
            // Missing pong -> drop connection
            ws.close();
          }, 5000);
        }
      }, 10000);
    };

    ws.onmessage = (event) => {
      try {
        const frame = JSON.parse(event.data);
        if (frame.type === 'pong') {
          if (pongTimeoutTimer) {
            clearTimeout(pongTimeoutTimer);
            pongTimeoutTimer = null;
          }
          return;
        }

        const serverFrame = frame as WebSocketServerFrame;
        internalState.lastFrameAt = new Date();
        internalState.tickAge = 0;
        if (internalState.status === 'stale') {
          internalState.status = 'connected';
        }

        // Push into 500ms batch buffer
        incomingFrameBuffer.push(serverFrame);
      } catch {
        // Drop malformed frame
      }
    };

    ws.onclose = () => {
      cleanupSocket();
      scheduleReconnect();
    };

    ws.onerror = () => {
      ws.close();
    };
  } catch {
    scheduleReconnect();
  }
}

function cleanupSocket() {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }
  if (pongTimeoutTimer) {
    clearTimeout(pongTimeoutTimer);
    pongTimeoutTimer = null;
  }
  activeWs = null;
}

function scheduleReconnect() {
  if (reconnectTimer) return;

  const attempt = internalState.reconnectAttempt + 1;
  const backoffMs = Math.min(1000 * Math.pow(1.5, attempt), 30000);

  internalState = {
    ...internalState,
    status: 'reconnecting',
    reconnectAttempt: attempt,
  };
  notify();

  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connectWebSocket();
  }, backoffMs);
}

// Send subscribe frame
function sendSubscribe(sub: SubscriptionConfig) {
  currentSubscription = sub;
  if (activeWs && activeWs.readyState === WebSocket.OPEN) {
    const frame: WebSocketClientFrame = {
      type: 'subscribe',
      data: {
        racks: sub.racks,
        metrics: sub.metrics,
      },
    };
    activeWs.send(JSON.stringify(frame));
  }
}

// Initialize flush timer and tick timer once
if (typeof window !== 'undefined') {
  flushIntervalTimer = setInterval(flushBatch, 500);
  setupTickTimer();
}

/**
 * Main WebSocket Hook
 */
export function useWebSocket(config?: SubscriptionConfig, onResync?: () => Promise<void> | void) {
  const [, setTick] = useState(0);

  // Subscribe component to listener
  useEffect(() => {
    const handler = () => setTick((t) => t + 1);
    listeners.add(handler);
    return () => {
      listeners.delete(handler);
    };
  }, []);

  // Register REST resync handler
  useEffect(() => {
    if (onResync) {
      resyncCallbacks.add(onResync);
      return () => {
        resyncCallbacks.delete(onResync);
      };
    }
  }, [onResync]);

  // Subscription follows the view per phase-3-realtime.md §8
  useEffect(() => {
    if (!config) return;

    const racksChanged =
      config.racks.length !== currentSubscription.racks.length ||
      config.racks.some((r, i) => r !== currentSubscription.racks[i]);
    const metricsChanged =
      config.metrics.length !== currentSubscription.metrics.length ||
      config.metrics.some((m, i) => m !== currentSubscription.metrics[i]);

    if (racksChanged || metricsChanged) {
      sendSubscribe(config);
    }
  }, [config?.racks, config?.metrics]);

  // Connect on first mount
  useEffect(() => {
    connectWebSocket();
  }, []);

  return {
    ...internalState,
    subscribe: sendSubscribe,
    triggerEscalationPulse,
    onChangepoint: subscribeChangepoint,
  };
}
