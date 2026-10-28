import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { RackHallCanvas, checkWebGLSupport } from '../features/hall/RackHallCanvas';
import { createHatchTexture, getHatchTexture } from '../features/hall/hatchTexture';
import { Rack } from '../api/contract';
import { DataCenterDashboard } from '../features/datacenter/DataCenterDashboard';
import { TenantDashboard } from '../features/tenant/TenantDashboard';

// Mock topology data
const mockRack: Rack = {
  rack_id: 'rack-01',
  label: 'Rack 01',
  position: { row: 0, col: 0 },
  slots: [
    {
      slot_id: 'rack-01-u12',
      u_start: 12,
      u_height: 2,
      tenant_id: 't-beta',
      tenant_label: 'Beta Compute',
      node_id: 'r1-n1',
      status: 'OK',
    },
    {
      slot_id: 'rack-01-u14',
      u_start: 14,
      u_height: 2,
      tenant_id: 't-alpha',
      tenant_label: 'Alpha Systems',
      node_id: 'r1-n2',
      status: 'CRIT',
    },
    {
      slot_id: 'rack-01-u16',
      u_start: 16,
      u_height: 2,
      tenant_id: null,
      tenant_label: null,
      node_id: null,
      status: 'UNKNOWN',
    },
  ],
};

// Mock apiClient
vi.mock('../api/client', () => ({
  apiClient: {
    get: vi.fn().mockImplementation((path: string) => {
      if (path === '/api/topology') {
        return Promise.resolve({
          site_id: 'site-01',
          racks: [mockRack],
        });
      }
      if (path.includes('/summary')) {
        return Promise.resolve({
          rack_id: 'rack-01',
          status: 'OK',
          worst_margin: {
            node_id: 'r1-n1',
            metric: 't_c',
            margin: 3.6,
            value: {
              value: 23.4,
              unit: 'C',
              meta: {
                quality: 'measured',
                updated_at: new Date().toISOString(),
              },
            },
            limit: 27,
            limit_source: 'ASHRAE 27 °C recommended inlet',
          },
          nodes_online: 2,
          nodes_total: 2,
        });
      }
      return Promise.resolve({});
    }),
  },
  ApiClientError: class extends Error {
    code: string;
    constructor(status: number, code: string, message: string) {
      super(message);
      this.code = code;
    }
  },
}));

// Mock auth store
vi.mock('../app/authStore', () => ({
  useAuthStore: () => ({
    user: {
      user_id: 'u-beta',
      role: 'TENANT',
      tenant_id: 't-beta',
      display_name: 'Beta Compute',
    },
  }),
}));

// Mock WebSocket hook
vi.mock('../api/ws', () => ({
  useWebSocket: () => ({
    status: 'connected',
    nodeStatuses: {
      'r1-n1': { status: 'online', last_seen: new Date().toISOString() },
      'r1-n2': { status: 'online', last_seen: new Date().toISOString() },
    },
    escalationSlotIds: [],
    recentAudits: [],
    telemetry: {},
  }),
}));

describe('Phase 5 — 3D Rack Hall (The Hero)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('WebGL Detection and Graceful Fallback', () => {
    it('checkWebGLSupport returns boolean in current environment', () => {
      const supported = checkWebGLSupport();
      expect(typeof supported).toBe('boolean');
    });

    it('renders 2D fallback when WebGL is unavailable or disabled', () => {
      render(
        <RackHallCanvas
          racks={[mockRack]}
          selectedRackId="rack-01"
          onSelectSlot={vi.fn()}
        />
      );

      // In jsdom without WebGL, fallback is active
      const fallback = screen.getByTestId('hall-fallback');
      expect(fallback).toBeInTheDocument();
      expect(screen.getByText(/2D physical bay elevation view/i)).toBeInTheDocument();
    });

    it('renders 2D RackGrid faithfully in fallback mode so the dashboard is fully usable', () => {
      render(
        <RackHallCanvas
          racks={[mockRack]}
          selectedRackId="rack-01"
          onSelectSlot={vi.fn()}
        />
      );

      // Rack panel and bays should render
      expect(screen.getByTestId('rack-panel-rack-01')).toBeInTheDocument();
      expect(screen.getByText('U12–U13 (2U)')).toBeInTheDocument();
      expect(screen.getByText('U14–U15 (2U)')).toBeInTheDocument();
    });
  });

  describe('Hatch Texture & Tenant Foreign Slot Isolation', () => {
    it('createHatchTexture creates a canvas texture with repeat wrapping', () => {
      const texture = createHatchTexture();
      expect(texture).toBeDefined();
      expect(texture.wrapS).toBe(1000); // THREE.RepeatWrapping is 1000
      expect(texture.wrapT).toBe(1000);
      expect(texture.repeat.x).toBe(2);
      expect(texture.repeat.y).toBe(2);
    });

    it('getHatchTexture returns a cached singleton instance', () => {
      const tex1 = getHatchTexture();
      const tex2 = getHatchTexture();
      expect(tex1).toBe(tex2);
    });

    it('tenant dashboard renders foreign slot hatch notice and shields foreign bays', async () => {
      render(<TenantDashboard />);

      await waitFor(() => {
        expect(screen.getByText(/Tenant Isolation Guarantee/i)).toBeInTheDocument();
      });
      expect(screen.getByText(/Neighbouring bays remain shielded with neutral hatch/i)).toBeInTheDocument();
    });
  });

  describe('Keyboard Navigation Parity', () => {
    it('DataCenterDashboard provides keyboard-accessible bay buttons in the left rail', async () => {
      render(<DataCenterDashboard />);

      // Wait for racks to load
      const rackButton = await screen.findByRole('button', { name: /Select Rack 01/i });
      expect(rackButton).toBeInTheDocument();

      // Click to select rack and reveal bays
      fireEvent.click(rackButton);

      // Keyboard buttons for slots in left rail
      const bayButtons = await screen.findAllByRole('button', { name: /Select slot U/i });
      expect(bayButtons.length).toBeGreaterThanOrEqual(1);

      // Select bay with click or Enter
      fireEvent.click(bayButtons[0]);

      // Verifies slot detail panel slide-in triggers
      expect(screen.getByText(/Details/i)).toBeInTheDocument();
    });

    it('TenantDashboard provides keyboard-accessible bay buttons for owned bays only', async () => {
      render(<TenantDashboard />);

      // Wait for racks to load
      const rackButton = await screen.findByRole('button', { name: /Select Rack 01/i });
      expect(rackButton).toBeInTheDocument();

      fireEvent.click(rackButton);

      // Only owned bays (t-beta owns U12) should be navigable in tenant left rail
      const ownedBayButton = await screen.findByRole('button', { name: /Select bay U12/i });
      expect(ownedBayButton).toBeInTheDocument();

      // Foreign bay U14 (owned by t-alpha) must NOT have a selectable button
      const foreignBayButton = screen.queryByRole('button', { name: /Select bay U14/i });
      expect(foreignBayButton).toBeNull();
    });
  });
});
