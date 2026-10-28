import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import React from 'react';
import { Value } from '../design/Value';
import { Shell } from '../app/Shell';
import { RackGrid } from '../features/datacenter/RackGrid';
import { Rack, Slot } from '../api/contract';
import * as wsModule from '../api/ws';

describe('Phase 3 Realtime & Provenance Tests', () => {
  const sampleRack: Rack = {
    rack_id: 'rack-01',
    label: 'Rack 01',
    position: { row: 0, col: 0 },
    slots: [
      {
        slot_id: 'rack-01-u12',
        u_start: 12,
        u_height: 4,
        tenant_id: 't-alpha',
        tenant_label: 'Alpha Systems',
        node_id: 'r1-n1',
        status: 'OK',
      },
      {
        slot_id: 'rack-01-u18',
        u_start: 18,
        u_height: 4,
        tenant_id: 't-beta',
        tenant_label: 'Beta Compute',
        node_id: 'r1-n2',
        status: 'OK',
      },
    ],
  };

  beforeEach(() => {
    vi.restoreAllMocks();
    wsModule.resetWebSocketForTesting();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllTimers();
    wsModule.resetWebSocketForTesting();
  });

  // Acceptance Test 5: Hover an estimated power value -> formula and live inputs
  it('renders formula and live inputs on hover for estimated power values', () => {
    render(
      <Value
        value={1.08}
        unit="W"
        meta={{
          quality: 'estimated',
          model: 'linear-cpu-v1',
          as_of: new Date().toISOString(),
        }}
        powerFormulaInputs={{
          p_idle_w: 0.45,
          p_busy_w: 1.08,
          u: 0.62,
        }}
      />
    );

    expect(screen.getByText('1.08')).toBeInTheDocument();
    expect(screen.getByText('EST.')).toBeInTheDocument();

    const trigger = screen.getByLabelText(/Estimated value 1.08 W/i);
    fireEvent.mouseEnter(trigger);

    expect(screen.getByText('Estimated Power Model')).toBeInTheDocument();
    expect(screen.getByText('P = P_idle + (P_busy − P_idle)·u')).toBeInTheDocument();
    expect(screen.getByText(/P_idle=0.45W, P_busy=1.08W, u=0.62/i)).toBeInTheDocument();
  });

  // Acceptance Test 4: Per-value freshness & honest stale state
  it('displays age quietly when past cadence, and prominently marks stale past 30s', () => {
    // 15 seconds old (cadence is 2s)
    const fifteenSecAgo = new Date(Date.now() - 15000).toISOString();
    const { rerender } = render(
      <Value
        value={24.61}
        unit="°C"
        asOf={fifteenSecAgo}
        cadence_s={2}
      />
    );

    // Quiet freshness
    expect(screen.getByText(/15s ago/i)).toBeInTheDocument();

    // 48 seconds old (prominently stale past 30s)
    const fortyEightSecAgo = new Date(Date.now() - 48000).toISOString();
    rerender(
      <Value
        value={24.61}
        unit="°C"
        asOf={fortyEightSecAgo}
        cadence_s={2}
      />
    );

    expect(screen.getByText(/48s ago \(stale\)/i)).toBeInTheDocument();
  });

  it('marks value visibly stale when isStale prop is true', () => {
    render(
      <Value
        value={24.61}
        unit="°C"
        isStale={true}
      />
    );

    expect(screen.getByText(/stale/i)).toBeInTheDocument();
  });

  // Acceptance Test 3: Three connection states in Header Indicator
  it('renders the three connection states: Live, Reconnecting, and Last update N s ago', () => {
    // 1. Live state
    const spy1 = vi.spyOn(wsModule, 'useWebSocket').mockReturnValue({
      status: 'connected',
      reconnectAttempt: 0,
      lastFrameAt: new Date(),
      tickAge: 1,
      telemetry: {},
      powerEstimates: {},
      nodeStatuses: {},
      recentAudits: [],
      latestChangePoint: null,
      escalationSlotIds: [],
      subscribe: vi.fn(),
      triggerEscalationPulse: vi.fn(),
      onChangepoint: vi.fn(() => vi.fn()),
    });

    const { rerender, unmount } = render(
      <Shell currentSection="overview" onNavigate={vi.fn()} pageTitle="Data Center Dashboard">
        <div>Content</div>
      </Shell>
    );

    expect(screen.getByText(/Live · 1s/i)).toBeInTheDocument();
    spy1.mockRestore();

    // 2. Reconnecting state
    const spy2 = vi.spyOn(wsModule, 'useWebSocket').mockReturnValue({
      status: 'reconnecting',
      reconnectAttempt: 3,
      lastFrameAt: null,
      tickAge: 5,
      telemetry: {},
      powerEstimates: {},
      nodeStatuses: {},
      recentAudits: [],
      latestChangePoint: null,
      escalationSlotIds: [],
      subscribe: vi.fn(),
      triggerEscalationPulse: vi.fn(),
      onChangepoint: vi.fn(() => vi.fn()),
    });

    rerender(
      <Shell currentSection="overview" onNavigate={vi.fn()} pageTitle="Data Center Dashboard">
        <div>Content</div>
      </Shell>
    );

    expect(screen.getByText(/Reconnecting… \(3\)/i)).toBeInTheDocument();
    spy2.mockRestore();

    // 3. Stale state (> 10s without frames)
    const spy3 = vi.spyOn(wsModule, 'useWebSocket').mockReturnValue({
      status: 'stale',
      reconnectAttempt: 0,
      lastFrameAt: new Date(Date.now() - 48000),
      tickAge: 48,
      telemetry: {},
      powerEstimates: {},
      nodeStatuses: {},
      recentAudits: [],
      latestChangePoint: null,
      escalationSlotIds: [],
      subscribe: vi.fn(),
      triggerEscalationPulse: vi.fn(),
      onChangepoint: vi.fn(() => vi.fn()),
    });

    rerender(
      <Shell currentSection="overview" onNavigate={vi.fn()} pageTitle="Data Center Dashboard">
        <div>Content</div>
      </Shell>
    );

    expect(screen.getByText(/Last update 48 s ago/i)).toBeInTheDocument();
    spy3.mockRestore();
    unmount();
  });

  // Acceptance Test 4: Changepoint toast separates known fact from statistical shift
  it('displays changepoint toast separating the fact from statistical shift', () => {
    let changepointListener: (cp: any) => void = () => {};

    const cpSpy = vi.spyOn(wsModule, 'useWebSocket').mockReturnValue({
      status: 'connected',
      reconnectAttempt: 0,
      lastFrameAt: new Date(),
      tickAge: 0,
      telemetry: {},
      powerEstimates: {},
      nodeStatuses: {},
      recentAudits: [],
      latestChangePoint: null,
      escalationSlotIds: [],
      subscribe: vi.fn(),
      triggerEscalationPulse: vi.fn(),
      onChangepoint: vi.fn((cb) => {
        changepointListener = cb;
        return vi.fn();
      }),
    });

    const { unmount } = render(
      <Shell currentSection="overview" onNavigate={vi.fn()} pageTitle="Data Center Dashboard">
        <div>Content</div>
      </Shell>
    );

    act(() => {
      changepointListener({
        cp_id: 'cp_0042',
        node_id: 'r1-n1',
        metric: 't_c',
        detected_at: new Date().toISOString(),
        located_at: new Date().toISOString(),
        detector: 'cusum+pelt',
        confirmed: true,
        shift: { before_mean: 23.4, after_mean: 25.2, delta: 1.8 },
        topology_event: { type: 'node_online', node_id: 'r2-n1' },
        meta: { quality: 'measured', as_of: new Date().toISOString() },
      });
    });

    // Known fact
    expect(screen.getByText(/Node r2-n1 came online./i)).toBeInTheDocument();
    // Statistical shift
    expect(screen.getByText(/Regime change on r1-n1 \(t_c\) — forecast window reset./i)).toBeInTheDocument();
    cpSpy.mockRestore();
    unmount();
  });

  // Acceptance Test 6: Node status flips slot immediately to OFFLINE
  it('flips slot immediately to OFFLINE and shows Offline since when node_status offline arrives', () => {
    render(
      <RackGrid
        racks={[sampleRack]}
        onSelectSlot={vi.fn()}
        nodeStatuses={{
          'r1-n1': {
            node_id: 'r1-n1',
            status: 'offline',
            offlineSince: '2026-10-28T12:00:00Z',
          },
        }}
      />
    );

    expect(screen.getByText(/Offline since/i)).toBeInTheDocument();
    expect(screen.getByText('OFFLINE')).toBeInTheDocument();
  });

  // Acceptance Test 7: Escalation pulse animation
  it('applies pulse-escalation class on slot when in escalationSlotIds', () => {
    const { container } = render(
      <RackGrid
        racks={[sampleRack]}
        onSelectSlot={vi.fn()}
        escalationSlotIds={['rack-01-u12']}
      />
    );

    expect(container.querySelector('.pulse-escalation')).toBeInTheDocument();
  });

  // Acceptance Test 2: Flat render rate - incoming frames are buffered and flushed at 500 ms in a single commit
  it('batches high-frequency incoming frames and commits at 500 ms interval', () => {
    expect(wsModule.getBufferedFramesCountForTesting()).toBe(0);

    // Rapid incoming frames arriving within < 500ms
    wsModule.pushFrameForTesting({
      type: 'telemetry',
      data: {
        node_id: 'r1-n1',
        metric: 't_c',
        value: 24.5,
        unit: '°C',
        meta: { quality: 'measured', as_of: new Date().toISOString() },
      },
      ts: new Date().toISOString(),
    });

    wsModule.pushFrameForTesting({
      type: 'telemetry',
      data: {
        node_id: 'r1-n1',
        metric: 'rh_pct',
        value: 45.2,
        unit: '%',
        meta: { quality: 'measured', as_of: new Date().toISOString() },
      },
      ts: new Date().toISOString(),
    });

    wsModule.pushFrameForTesting({
      type: 'power_estimate',
      data: {
        node_id: 'r1-n1',
        value: 1.05,
        unit: 'W',
        meta: { quality: 'estimated', model: 'linear-cpu-v1', as_of: new Date().toISOString() },
      },
      ts: new Date().toISOString(),
    });

    // Verify 3 frames are queued in batch buffer before flush
    expect(wsModule.getBufferedFramesCountForTesting()).toBe(3);

    // Trigger batch flush (simulates 500ms timer commit)
    act(() => {
      wsModule.flushBatchForTesting();
    });

    // Buffer is now drained in a single commit
    expect(wsModule.getBufferedFramesCountForTesting()).toBe(0);
  });
});
