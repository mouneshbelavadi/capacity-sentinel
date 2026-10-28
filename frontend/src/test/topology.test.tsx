import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { RackGrid } from '../features/datacenter/RackGrid';
import { RackSummaryCard } from '../features/datacenter/RackSummaryCard';
import { SlotDetailPanel } from '../features/topology/SlotDetailPanel';
import { IsolationSplitView } from '../features/datacenter/IsolationSplitView';
import { Rack, Slot, TopologyResponse, RackSummaryResponse } from '../api/contract';
import { apiClient, ApiClientError } from '../api/client';

describe('Phase 2 Topology & Isolation Tests', () => {
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

  const scopedTenantRack: Rack = {
    rack_id: 'rack-01',
    label: 'Rack 01',
    position: { row: 0, col: 0 },
    slots: [
      {
        slot_id: 'rack-01-u12',
        u_start: 12,
        u_height: 4,
        tenant_id: null,
        tenant_label: null,
        node_id: null,
        status: 'UNKNOWN',
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
  });

  // Acceptance Test 1: Operator and Tenant rendering
  it('renders all tenant slots and node IDs in operator view', () => {
    const handleSelect = vi.fn();
    render(
      <RackGrid
        racks={[sampleRack]}
        onSelectSlot={handleSelect}
        isTenant={false}
      />
    );

    expect(screen.getByText('Alpha Systems')).toBeInTheDocument();
    expect(screen.getByText('Beta Compute')).toBeInTheDocument();
    expect(screen.getByText('r1-n1')).toBeInTheDocument();
    expect(screen.getByText('r1-n2')).toBeInTheDocument();
    expect(screen.queryByText('Not your slot')).toBeNull();
  });

  it('renders foreign slots with .hatch-foreign and "Not your slot" in tenant view', () => {
    const handleSelect = vi.fn();
    const { container } = render(
      <RackGrid
        racks={[scopedTenantRack]}
        onSelectSlot={handleSelect}
        isTenant={true}
        tenantId="t-beta"
      />
    );

    // Foreign slot is shielded
    expect(screen.getByText('Not your slot')).toBeInTheDocument();
    expect(screen.getByText('Shielded')).toBeInTheDocument();
    expect(container.querySelector('.hatch-foreign')).toBeInTheDocument();

    // Alpha Systems and foreign node r1-n1 must NOT appear
    expect(screen.queryByText('Alpha Systems')).toBeNull();
    expect(screen.queryByText('r1-n1')).toBeNull();

    // Tenant's own slot appears normally
    expect(screen.getByText('Beta Compute')).toBeInTheDocument();
    expect(screen.getByText('r1-n2')).toBeInTheDocument();
  });

  // Acceptance Test 2: Foreign node telemetry 404
  it('renders "That node isn\'t in your view." when node telemetry returns 404', async () => {
    vi.spyOn(apiClient, 'get').mockRejectedValue(
      new ApiClientError(404, 'NOT_FOUND', "That node isn't in your view.")
    );

    const foreignSlot: Slot = {
      slot_id: 'rack-01-u12',
      u_start: 12,
      u_height: 4,
      tenant_id: 't-alpha',
      tenant_label: 'Alpha Systems',
      node_id: 'r1-n1',
      status: 'OK',
    };

    render(
      <SlotDetailPanel
        slot={foreignSlot}
        rack={sampleRack}
        isOpen={true}
        onClose={vi.fn()}
        isTenant={true}
      />
    );

    await waitFor(() => {
      expect(screen.getByText("That node isn't in your view.")).toBeInTheDocument();
    });
    expect(screen.getByText(/authorized tenant scope/i)).toBeInTheDocument();
  });

  // Acceptance Test 4: Unbaselined metric honesty (no status, no fake number)
  it('displays "No baseline captured" with no status for unbaselined metric', async () => {
    vi.spyOn(apiClient, 'get').mockResolvedValue({
      node_id: 'r1-n2',
      metric: 't_c',
      unit: '°C',
      step_s: 10,
      points: [{ ts: new Date().toISOString(), value: 24.61 }],
      meta: {
        quality: 'measured',
        source: 'node:r1-n2:dht22',
        as_of: new Date().toISOString(),
      },
    });

    const ownedSlot: Slot = {
      slot_id: 'rack-01-u18',
      u_start: 18,
      u_height: 4,
      tenant_id: 't-beta',
      tenant_label: 'Beta Compute',
      node_id: 'r1-n2',
      status: 'OK',
    };

    render(
      <SlotDetailPanel
        slot={ownedSlot}
        rack={sampleRack}
        isOpen={true}
        onClose={vi.fn()}
        isTenant={false}
      />
    );

    await waitFor(() => {
      expect(
        screen.getByText('No baseline captured. Capture one to enable status and forecasting.')
      ).toBeInTheDocument();
    });
  });

  // Acceptance Test 5: MQ135 warming up state (never a number)
  it('displays "Warming up" and never renders a number when MQ135 is preheating', async () => {
    vi.spyOn(apiClient, 'get').mockImplementation(async (path: string) => {
      if (path.includes('metric=mq_ratio')) {
        throw new ApiClientError(
          400,
          'SENSOR_WARMING_UP',
          'Warming up — the MQ135 needs its preheat before any reading is meaningful.'
        );
      }
      return {
        node_id: 'r2-n3',
        metric: 't_c',
        unit: '°C',
        step_s: 10,
        points: [{ ts: new Date().toISOString(), value: 24.0 }],
        meta: {
          quality: 'measured',
          source: 'node:r2-n3:dht22',
          as_of: new Date().toISOString(),
        },
      };
    });

    const warmingSlot: Slot = {
      slot_id: 'rack-02-u24',
      u_start: 24,
      u_height: 4,
      tenant_id: 't-beta',
      tenant_label: 'Beta Compute',
      node_id: 'r2-n3',
      status: 'OK',
    };

    render(
      <SlotDetailPanel
        slot={warmingSlot}
        rack={sampleRack}
        isOpen={true}
        onClose={vi.fn()}
        isTenant={false}
      />
    );

    await waitFor(() => {
      expect(
        screen.getByText('Warming up — the MQ135 needs its preheat before any reading is meaningful.')
      ).toBeInTheDocument();
    });

    // Ensure no fake ppm or ratio number is rendered for air quality
    expect(screen.queryByText(/ppm/i)).toBeNull();
  });

  // Acceptance Test 6: Backend error handling (never renders zeros)
  it('displays <ErrorState> and does not render 0s when backend fails', async () => {
    vi.spyOn(apiClient, 'get').mockRejectedValue(
      new ApiClientError(500, 'INTERNAL', 'Data store connection failed')
    );

    render(<RackSummaryCard rackId="rack-01" />);

    await waitFor(() => {
      expect(screen.getByText('Data store connection failed')).toBeInTheDocument();
    });

    // Confirms no fake 0 or placeholder is drawn
    expect(screen.queryByTestId('rack-summary-content')).toBeNull();
  });

  // Acceptance Test 7: Keyboard navigation
  it('supports keyboard navigation via Enter and Space to select slots', () => {
    const handleSelect = vi.fn();
    render(
      <RackGrid
        racks={[sampleRack]}
        onSelectSlot={handleSelect}
        isTenant={false}
      />
    );

    const slotButton = screen.getByRole('button', { name: /Slot rack-01-u18/i });

    // Press Enter
    fireEvent.keyDown(slotButton, { key: 'Enter', code: 'Enter' });
    expect(handleSelect).toHaveBeenCalledTimes(1);

    // Press Space
    fireEvent.keyDown(slotButton, { key: ' ', code: 'Space' });
    expect(handleSelect).toHaveBeenCalledTimes(2);
  });

  // Acceptance Test 3: Prove Isolation Split View dual token fetch and probe
  it('renders dual perspectives in Prove Isolation split view', async () => {
    vi.spyOn(apiClient, 'get').mockImplementation(async (path: string, options?: RequestInit) => {
      const headers = (options?.headers as Record<string, string>) || {};
      const auth = headers['Authorization'] || '';
      if (auth.includes('tenant')) {
        return {
          site_id: 'site-01',
          racks: [scopedTenantRack],
        } as TopologyResponse;
      }
      return {
        site_id: 'site-01',
        racks: [sampleRack],
      } as TopologyResponse;
    });

    // Mock window.fetch for direct foreign node probe test
    const fetchMock = vi.fn().mockResolvedValue({
      status: 404,
      text: async () =>
        JSON.stringify({
          error: {
            code: 'NOT_FOUND',
            message: "That node isn't in your view.",
          },
        }),
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<IsolationSplitView isOpen={true} onClose={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText('Live Tenant Isolation Proof')).toBeInTheDocument();
      expect(screen.getByText('Unrestricted Facility View')).toBeInTheDocument();
      expect(screen.getByText('Beta Compute Scoped View')).toBeInTheDocument();
    });

    // Test the live foreign node probe button
    const probeButton = screen.getByRole('button', { name: /Run Probe as Tenant/i });
    fireEvent.click(probeButton);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/nodes/r1-n1/telemetry',
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer token-tenant-session',
          }),
        })
      );
      expect(screen.getByText(/404 NOT_FOUND/i)).toBeInTheDocument();
    });
  });
});
