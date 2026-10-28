import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import React from 'react';
import { App } from '../App';
import { useAuthStore } from '../app/authStore';
import { setStoredToken, apiClient } from '../api/client';
import { TopologyResponse } from '../api/contract';

describe('Auth and Role Routing', () => {
  beforeEach(() => {
    // Reset auth store & session token before each test
    setStoredToken(null);
    useAuthStore.setState({
      user: null,
      token: null,
      isLoading: false,
      error: null,
    });
    window.history.pushState({}, '', '/');
  });

  it('renders login page when unauthenticated', () => {
    render(<App />);
    expect(screen.getByText('RackSense')).toBeInTheDocument();
    expect(screen.getByText('Infrastructure Capacity Console')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument();
  });

  it('logs in as operator and shows Data Center Dashboard', async () => {
    render(<App />);

    act(() => {
      useAuthStore.getState().setUserManually(
        {
          user_id: 'operator-site',
          role: 'OPERATOR',
          tenant_id: null,
          display_name: 'Mounesh E Belavadi (Operator)',
        },
        'mock-token-operator'
      );
    });

    expect(await screen.findByRole('heading', { level: 1, name: 'Data Center Dashboard' })).toBeInTheDocument();
  });

  it('logs in as tenant and shows Tenant Dashboard', async () => {
    render(<App />);

    act(() => {
      useAuthStore.getState().setUserManually(
        {
          user_id: 'tenant-beta',
          role: 'TENANT',
          tenant_id: 't-beta',
          display_name: 'Beta Compute (Tenant)',
        },
        'mock-token-tenant'
      );
    });

    expect(await screen.findByRole('heading', { level: 1, name: 'Tenant Dashboard' })).toBeInTheDocument();
    expect(screen.getByText(/Scoped to tenant:/i)).toBeInTheDocument();
  });

  it('redirects tenant navigating to /datacenter to /tenant', async () => {
    window.history.pushState({}, '', '/datacenter');
    render(<App />);

    act(() => {
      useAuthStore.getState().setUserManually(
        {
          user_id: 'tenant-beta',
          role: 'TENANT',
          tenant_id: 't-beta',
          display_name: 'Beta Compute (Tenant)',
        },
        'mock-token-tenant'
      );
    });

    // Should redirect to Tenant Dashboard
    expect(await screen.findByRole('heading', { level: 1, name: 'Tenant Dashboard' })).toBeInTheDocument();
    expect(window.location.pathname).toBe('/tenant');
  });

  it('shows Access Control for SUPER_USER', async () => {
    window.history.pushState({}, '', '/datacenter/access');
    render(<App />);

    act(() => {
      useAuthStore.getState().setUserManually(
        {
          user_id: 'superuser-root',
          role: 'SUPER_USER',
          tenant_id: null,
          display_name: 'Mounesh E Belavadi (Super User)',
        },
        'mock-token-superuser'
      );
    });

    expect(await screen.findByRole('heading', { level: 1, name: 'Access Control' })).toBeInTheDocument();
    expect(screen.getByText('Provisioned Tenants')).toBeInTheDocument();
    expect(screen.getByText('Physical RFID Allowlist')).toBeInTheDocument();
  });

  it('renders blocking banner when major contract version mismatch occurs', async () => {
    window.history.pushState({}, '', '/datacenter?test_mismatch=true');
    render(<App />);

    expect(await screen.findByText('Contract Version Mismatch')).toBeInTheDocument();
    expect(screen.getByText('CRITICAL DRIFT')).toBeInTheDocument();
    expect(screen.getByText('2.0.0')).toBeInTheDocument();
  });

  const sampleTopology: TopologyResponse = {
    site_id: 'site-01',
    racks: [
      {
        rack_id: 'rack-01',
        label: 'Rack 01',
        position: { row: 0, col: 0 },
        slots: [
          {
            slot_id: 'rack-01-u12',
            u_start: 12,
            u_height: 4,
            tenant_id: 't-beta',
            tenant_label: 'Beta Compute',
            node_id: 'r1-n1',
            status: 'OK',
          },
        ],
      },
    ],
  };

  it('navigates to /datacenter/racks when operator clicks Racks sidebar item, highlights as active, and shows only rail, 3D hall, and summary', async () => {
    vi.spyOn(apiClient, 'get').mockImplementation(async (url: string) => {
      if (url === '/api/topology') {
        return sampleTopology;
      }
      if (url.startsWith('/api/racks/')) {
        return {
          rack_id: 'rack-01',
          status: 'OK',
          worst_margin: {
            node_id: 'r1-n1',
            metric: 't_c',
            value: {
              value: 23.5,
              unit: '°C',
              meta: { quality: 'measured' },
            },
            limit: 27.0,
            limit_source: 'ASHRAE A1 (Recommended)',
          },
          nodes_online: 1,
          nodes_total: 1,
        };
      }
      return {};
    });

    render(<App />);

    act(() => {
      useAuthStore.getState().setUserManually(
        {
          user_id: 'operator-site',
          role: 'OPERATOR',
          tenant_id: null,
          display_name: 'Mounesh E Belavadi (Operator)',
        },
        'mock-token-operator'
      );
    });

    expect(await screen.findByRole('heading', { level: 1, name: 'Data Center Dashboard' })).toBeInTheDocument();

    // Click Racks navigation item in sidebar
    const racksButton = screen.getByRole('button', { name: 'Racks' });
    fireEvent.click(racksButton);

    expect(window.location.pathname).toBe('/datacenter/racks');
    expect(racksButton).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('heading', { level: 1, name: 'Data Center Racks' })).toBeInTheDocument();

    // The Racks page shows the 3D hall and rack summary
    expect(await screen.findByText('Live 3D Data Hall')).toBeInTheDocument();
    expect(screen.getByText(/Rack.*Summary/)).toBeInTheDocument();

    // The Racks page omits top overview banner, view filters, and recent activity
    expect(screen.queryByText('Site-01 Facility Overview')).not.toBeInTheDocument();
    expect(screen.queryByText('View Filters')).not.toBeInTheDocument();
    expect(screen.queryByText('Recent Activity')).not.toBeInTheDocument();
  });

  it('navigates to /tenant/racks when tenant clicks Racks sidebar item, highlights as active, and shows only rail, 3D hall, and summary', async () => {
    vi.spyOn(apiClient, 'get').mockImplementation(async (url: string) => {
      if (url === '/api/topology') {
        return sampleTopology;
      }
      if (url.startsWith('/api/racks/')) {
        return {
          rack_id: 'rack-01',
          status: 'OK',
          worst_margin: {
            node_id: 'r1-n1',
            metric: 't_c',
            value: {
              value: 23.5,
              unit: '°C',
              meta: { quality: 'measured' },
            },
            limit: 27.0,
            limit_source: 'ASHRAE A1 (Recommended)',
          },
          nodes_online: 1,
          nodes_total: 1,
        };
      }
      return {};
    });

    render(<App />);

    act(() => {
      useAuthStore.getState().setUserManually(
        {
          user_id: 'tenant-beta',
          role: 'TENANT',
          tenant_id: 't-beta',
          display_name: 'Beta Compute (Tenant)',
        },
        'mock-token-tenant'
      );
    });

    expect(await screen.findByRole('heading', { level: 1, name: 'Tenant Dashboard' })).toBeInTheDocument();

    // Click Racks navigation item in sidebar
    const racksButton = screen.getByRole('button', { name: 'Racks' });
    fireEvent.click(racksButton);

    expect(window.location.pathname).toBe('/tenant/racks');
    expect(racksButton).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('heading', { level: 1, name: 'Assigned Racks' })).toBeInTheDocument();

    // The Racks page shows the 3D hall and rack summary
    expect(await screen.findByText('Live 3D Data Hall')).toBeInTheDocument();
    expect(screen.getByText(/Rack.*Summary/)).toBeInTheDocument();

    // The Racks page omits top isolation banner, privacy guarantee, and recent activity
    expect(screen.queryByText(/Scoped to tenant:/i)).not.toBeInTheDocument();
    expect(screen.queryByText('Tenant Isolation Guarantee')).not.toBeInTheDocument();
    expect(screen.queryByText('Your Telemetry Events')).not.toBeInTheDocument();
  });
});
