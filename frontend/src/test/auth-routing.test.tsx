import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import React from 'react';
import { App } from '../App';
import { useAuthStore } from '../app/authStore';
import { setStoredToken } from '../api/client';

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
});
