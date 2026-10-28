import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SimulationsView } from '../features/simulations/SimulationsView';
import { LoginPage } from '../features/auth/LoginPage';
import { apiClient } from '../api/client';
import { useAuthStore } from '../app/authStore';

// Mock apiClient
vi.mock('../api/client', () => {
  return {
    apiClient: {
      get: vi.fn(),
      post: vi.fn(),
    },
    ApiClientError: class ApiClientError extends Error {
      code: string;
      constructor(code: string, message: string) {
        super(message);
        this.code = code;
      }
    },
    getStoredToken: vi.fn(() => null),
    setStoredToken: vi.fn(),
  };
});

describe('Simulations & AI Chat Integration Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders simulation scenarios grid with realistic fault cases', async () => {
    vi.mocked(apiClient.get).mockResolvedValueOnce([
      {
        id: 'thermal_breach',
        title: 'Thermal Breach (ASHRAE TC9.9 Breach)',
        category: 'temperature',
        severity: 'CRIT',
        target_rack: 'rack-01',
        target_bay: 'U12–U15',
        target_node: 'r1-n1',
        tenant: 'Beta Compute',
        description: 'Inlet temperature climbs to 28.2 C.',
        metric: 't_c',
        unit: '°C',
        baseline_val: '24.6 °C',
        simulated_val: '28.2 °C',
        delta: '+3.6 °C',
      },
    ]);

    render(<SimulationsView />);

    expect(
      screen.getByText(/Multi-Scenario Facility Simulation Engine/i)
    ).toBeInTheDocument();

    await waitFor(() => {
      expect(
        screen.getByText('Thermal Breach (ASHRAE TC9.9 Breach)')
      ).toBeInTheDocument();
    });

    expect(screen.getByText(/Beta Compute/i)).toBeInTheDocument();
  });

  it('runs a simulation and renders automated AI suggestion with alternatives', async () => {
    vi.mocked(apiClient.get).mockResolvedValueOnce([]);
    vi.mocked(apiClient.post).mockResolvedValueOnce({
      scenario_id: 'thermal_breach',
      status: 'COMPLETED',
      scenario: {
        id: 'thermal_breach',
        title: 'Thermal Breach (ASHRAE TC9.9 Breach)',
        category: 'temperature',
        severity: 'CRIT',
        target_rack: 'rack-01',
        target_bay: 'U12–U15',
        target_node: 'r1-n1',
        tenant: 'Beta Compute',
        description: 'Inlet temperature climbs to 28.2 C.',
        metric: 't_c',
        unit: '°C',
        baseline_val: '24.6 °C',
        simulated_val: '28.2 °C',
        delta: '+3.6 °C',
      },
      points_injected: 10,
      summary: 'Injected 10 t_c points (+3.6 °C) on r1-n1. Telemetry broadcasted.',
      proposal: {
        proposal_id: 'pr_sim_100',
        action: 'MIGRATE_TENANT',
        target: 'r1-n1',
        rationale: 'Thermal breach observed: inlet temp 28.2 C.',
        expected_effect: 'Reduces thermal load by 40%.',
        evidence: ['ev_node_r1-n1'],
        risk_tier: 'MEDIUM',
        status: 'PROPOSED',
        alternative_options: [
          {
            action: 'REDUCE_TENANT_LOAD',
            label: 'Option 1: Workload Throttle',
            rationale: 'Curtail compute bursts.',
          },
        ],
        meta: { quality: 'ai_generated', as_of: '2026-10-29T00:00:00Z' },
      },
      timestamp: '2026-10-29T00:00:00Z',
    });

    render(<SimulationsView />);

    const runButtons = screen.getAllByRole('button', { name: /Run Simulation/i });
    fireEvent.click(runButtons[0]);

    await waitFor(() => {
      expect(
        screen.getByText(/Simulation Executed: Thermal Breach/i)
      ).toBeInTheDocument();
      expect(screen.getByText(/MIGRATE_TENANT/i)).toBeInTheDocument();
      expect(screen.getByText(/Option 1: Workload Throttle/i)).toBeInTheDocument();
    });
  });

  it('allows chatting with AI to discuss or revise the proposal', async () => {
    vi.mocked(apiClient.get).mockResolvedValueOnce([]);
    vi.mocked(apiClient.post)
      .mockResolvedValueOnce({
        scenario_id: 'thermal_breach',
        status: 'COMPLETED',
        scenario: {
          id: 'thermal_breach',
          title: 'Thermal Breach',
          target_node: 'r1-n1',
          target_rack: 'rack-01',
        },
        points_injected: 10,
        summary: 'Executed',
        proposal: {
          proposal_id: 'pr_sim_100',
          action: 'MIGRATE_TENANT',
          target: 'r1-n1',
          rationale: 'Thermal breach',
          expected_effect: 'Cools down',
          evidence: [],
          risk_tier: 'MEDIUM',
          status: 'PROPOSED',
          meta: { quality: 'ai_generated', as_of: 'now' },
        },
        timestamp: 'now',
      })
      .mockResolvedValueOnce({
        reply: 'We can throttle workload by 25% instead of a full migration.',
        proposal_revision: {
          proposal_id: 'pr_sim_100',
          action: 'REDUCE_TENANT_LOAD',
          target: 'r1-n1',
          rationale: 'Throttling CPU preserves tenant placement while cooling rack.',
          expected_effect: 'Sheds 250W.',
          evidence: [],
          risk_tier: 'LOW',
          status: 'DISCUSSING',
          meta: { quality: 'ai_generated', as_of: 'now' },
        },
      });

    render(<SimulationsView />);

    // Run simulation
    const runButtons = screen.getAllByRole('button', { name: /Run Simulation/i });
    fireEvent.click(runButtons[0]);

    await waitFor(() => {
      expect(screen.getByPlaceholderText(/Ask AI about alternatives/i)).toBeInTheDocument();
    });

    // Chat with AI
    const chatInput = screen.getByPlaceholderText(/Ask AI about alternatives/i);
    fireEvent.change(chatInput, { target: { value: 'Why not throttle power instead?' } });

    const sendBtn = screen.getByRole('button', { name: /Send/i });
    fireEvent.click(sendBtn);

    await waitFor(() => {
      expect(
        screen.getByText(/We can throttle workload by 25% instead of a full migration./i)
      ).toBeInTheDocument();
      // Proposal action revised to REDUCE_TENANT_LOAD
      expect(screen.getByText(/REDUCE_TENANT_LOAD/i)).toBeInTheDocument();
    });
  });

  it('renders RFID badge login tab and simulates physical tap', async () => {
    vi.mocked(apiClient.post).mockResolvedValueOnce({
      access_token: 'fake-jwt-token',
      token_type: 'bearer',
      expires_in: 3600,
      role: 'OPERATOR',
      tenant_id: null,
      display_name: 'Shift Operator',
    });

    render(<LoginPage />);

    // Switch to RFID Badge Tap tab
    const rfidTab = screen.getByRole('button', { name: /RFID Badge Tap/i });
    fireEvent.click(rfidTab);

    expect(screen.getByText(/Physical RFID Reader Terminal/i)).toBeInTheDocument();
    expect(screen.getByText('Operator Badge')).toBeInTheDocument();

    // Click Operator Badge tap button
    const opBadge = screen.getByText('Operator Badge');
    fireEvent.click(opBadge);

    await waitFor(() => {
      expect(apiClient.post).toHaveBeenCalledWith('/api/auth/rfid-login', {
        card_uid: '04:A1:B2:C3:D4',
      });
    });
  });
});
