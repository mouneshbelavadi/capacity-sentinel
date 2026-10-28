import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import React from 'react';
import { ProposalStepper } from '../features/proposals/ProposalStepper';
import {
  ProposalCard,
  formatActionLabel,
  stripEmojis,
  mapRejectionReason,
} from '../features/proposals/ProposalCard';
import { AiPanel } from '../features/ai/AiPanel';
import { EvidenceModal } from '../features/ai/EvidenceModal';
import { ApprovalsView } from '../features/proposals/ApprovalsView';
import { AuditView } from '../features/audit/AuditView';
import { useAuthStore } from '../app/authStore';
import { apiClient, ApiClientError } from '../api/client';
import { Proposal } from '../api/contract';

describe('Phase 6 Approval, AI Advisory, and Audit Log Tests', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useAuthStore.setState({
      user: {
        user_id: 'operator-01',
        role: 'OPERATOR',
        tenant_id: null,
        display_name: 'Operator Preetham',
      },
      token: 'mock-token',
      isLoading: false,
      error: null,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const sampleProposal: Proposal = {
    proposal_id: 'pr_0007',
    created_at: '2026-10-28T10:14:00Z',
    status: 'PROPOSED',
    action: 'REDUCE_TENANT_LOAD',
    target: 'r1-n1',
    rationale: 'Thermal breach predicted within 6 minutes at slope +0.014 °C/s due to adjacent rack heating.',
    expected_effect: 'Reduces inlet temperature by 1.8 °C and extends runway by 45 minutes.',
    risk_tier: 'MEDIUM',
    evidence: ['fc_0193', 'cp_0042'],
    meta: {
      quality: 'ai_generated',
      model: 'advisory-v1',
    },
  };

  // 1. Helper formatting & emoji stripping tests
  describe('Helper Functions & Sanitization', () => {
    it('formats raw action enums to human language', () => {
      expect(formatActionLabel('REDUCE_TENANT_LOAD')).toBe('Reduce tenant load');
      expect(formatActionLabel('MIGRATE_TENANT')).toBe('Migrate tenant');
      expect(formatActionLabel('INSPECT_FAN')).toBe('Inspect fan');
      expect(formatActionLabel('INCREASE_COOLING_SETPOINT_REQUEST')).toBe('Increase cooling setpoint request');
      expect(formatActionLabel('SCHEDULE_MAINTENANCE')).toBe('Schedule maintenance');
      expect(formatActionLabel('NO_ACTION')).toBe('No action');
    });

    it('strips unicode emojis from LLM advisory responses', () => {
      const rawText = '🚨 Alert! 🌡️ High temperature detected on rack-01. Recommend migration immediately! ⚠️';
      const clean = stripEmojis(rawText);
      expect(clean).toBe('Alert! High temperature detected on rack-01. Recommend migration immediately!');
      expect(clean).not.toContain('🚨');
      expect(clean).not.toContain('🌡️');
      expect(clean).not.toContain('⚠️');
    });

    it('maps rejection codes to plain language explanations', () => {
      expect(mapRejectionReason('UID_NOT_AUTHORIZED')).toBe('Card not registered');
      expect(mapRejectionReason('HMAC_INVALID')).toBe('Device cryptographic verification failed');
      expect(mapRejectionReason('CLOCK_SKEW')).toBe('Device clock skew exceeded');
      expect(mapRejectionReason('NONCE_EXPIRED')).toBe('Approval window elapsed');
      expect(mapRejectionReason('NONCE_CONSUMED')).toBe('Nonce already consumed');
      expect(mapRejectionReason('DEVICE_UNKNOWN')).toBe('Unknown reader device');
      expect(mapRejectionReason('CUSTOM_ERR')).toBe('CUSTOM_ERR');
    });
  });

  // 2. ProposalStepper tests
  describe('ProposalStepper', () => {
    it('renders all four forward steps in the workflow', () => {
      render(<ProposalStepper status="PROPOSED" />);
      expect(screen.getByText('Proposed')).toBeInTheDocument();
      expect(screen.getByText('Discussing')).toBeInTheDocument();
      expect(screen.getByText('Approved, waiting for tap')).toBeInTheDocument();
      expect(screen.getByText('Authorized')).toBeInTheDocument();
    });

    it('marks current step with aria-current="step"', () => {
      const { rerender } = render(<ProposalStepper status="PROPOSED" />);
      const proposedStep = screen.getByText('Proposed').closest('li');
      expect(proposedStep).toHaveAttribute('aria-current', 'step');

      rerender(<ProposalStepper status="DISCUSSING" />);
      const discussingStep = screen.getByText('Discussing').closest('li');
      expect(discussingStep).toHaveAttribute('aria-current', 'step');

      rerender(<ProposalStepper status="APPROVED_PENDING_TAP" />);
      const approvedStep = screen.getByText('Approved, waiting for tap').closest('li');
      expect(approvedStep).toHaveAttribute('aria-current', 'step');

      rerender(<ProposalStepper status="AUTHORIZED" />);
      const authorizedStep = screen.getByText('Authorized').closest('li');
      expect(authorizedStep).toHaveAttribute('aria-current', 'step');
    });

    it('displays off-ramp banner when REJECTED', () => {
      render(<ProposalStepper status="REJECTED" />);
      expect(
        screen.getByText(/Proposal Rejected by operator or validation policy/i)
      ).toBeInTheDocument();
    });

    it('displays off-ramp banner when EXPIRED', () => {
      render(<ProposalStepper status="EXPIRED" />);
      expect(screen.getByText(/Approval window elapsed/i)).toBeInTheDocument();
    });
  });

  // 3. ProposalCard component tests
  describe('ProposalCard Component', () => {
    it('renders proposal information, AI Advisory badge, and evidence buttons', () => {
      render(<ProposalCard initialProposal={sampleProposal} />);
      expect(screen.getByText(/pr_0007/)).toBeInTheDocument();
      expect(screen.getByText('AI · ADVISORY')).toBeInTheDocument();
      expect(screen.getByText('MEDIUM RISK')).toBeInTheDocument();
      expect(screen.getByText('Reduce tenant load')).toBeInTheDocument();
      expect(screen.getByText('r1-n1')).toBeInTheDocument();
      expect(screen.getByText(/Thermal breach predicted/)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Open evidence record fc_0193/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Open evidence record cp_0042/i })).toBeInTheDocument();
    });

    it('renders Proceed to authorization button for OPERATOR', () => {
      render(<ProposalCard initialProposal={sampleProposal} />);
      expect(
        screen.getByRole('button', { name: /Proceed to physical RFID authorization/i })
      ).toBeInTheDocument();
    });

    it('NEVER renders Proceed to authorization button for TENANT', () => {
      useAuthStore.setState({
        user: {
          user_id: 'tenant-user',
          role: 'TENANT',
          tenant_id: 'alpha-corp',
          display_name: 'Alpha Corp Tenant Lead',
        },
      });

      render(<ProposalCard initialProposal={sampleProposal} />);
      expect(
        screen.queryByRole('button', { name: /Proceed to physical RFID authorization/i })
      ).not.toBeInTheDocument();
    });

    it('initiates approval on Proceed button click and enters waiting-for-tap state', async () => {
      const expiresAt = new Date(Date.now() + 45000).toISOString();
      vi.spyOn(apiClient, 'post').mockResolvedValueOnce({
        proposal_id: 'pr_0007',
        status: 'APPROVED_PENDING_TAP',
        nonce: 'nc_test_123',
        reader_device_id: 'reader-01',
        expires_at: expiresAt,
      });

      render(<ProposalCard initialProposal={sampleProposal} />);
      const proceedBtn = screen.getByRole('button', { name: /Proceed to physical RFID authorization/i });
      fireEvent.click(proceedBtn);

      await waitFor(() => {
        expect(apiClient.post).toHaveBeenCalledWith('/api/proposals/pr_0007/approve', {});
      });

      expect(await screen.findByTestId('waiting-for-tap-banner')).toBeInTheDocument();
      expect(screen.getByText(/Waiting for tap on/i)).toBeInTheDocument();
      expect(screen.getByText('reader-01')).toBeInTheDocument();
      expect(screen.getByText(/TFT Display Mirror/i)).toBeInTheDocument();
      expect(screen.getByText(/ARMED • Tap card to authorize/i)).toBeInTheDocument();
    });

    it('supports pre-approval discussion with revision diffing', async () => {
      vi.spyOn(apiClient, 'post').mockResolvedValueOnce({
        reply: 'Migrating tenant load will reduce inlet temperature more rapidly with zero downtime.',
        proposal_revision: {
          ...sampleProposal,
          action: 'MIGRATE_TENANT',
          rationale: 'Migrating tenant workload to Node r2-n2 eliminates heat concentration immediately.',
        },
      });

      render(<ProposalCard initialProposal={sampleProposal} />);
      const input = screen.getByLabelText(/Ask AI about this proposal/i);
      const sendBtn = screen.getByRole('button', { name: /Send/i });

      fireEvent.change(input, { target: { value: 'Why not migrate instead?' } });
      fireEvent.click(sendBtn);

      await waitFor(() => {
        expect(apiClient.post).toHaveBeenCalledWith('/api/ai/chat', {
          proposal_id: 'pr_0007',
          message: 'Why not migrate instead?',
        });
      });

      // User message rendered with sequence audit tag
      expect(await screen.findByText('Why not migrate instead?')).toBeInTheDocument();
      const auditedTags = screen.getAllByText(/audited: seq #/);
      expect(auditedTags.length).toBeGreaterThanOrEqual(2);

      // Revised action displayed with diff highlight
      expect(await screen.findByText('Migrate tenant')).toBeInTheDocument();
    });

    it('renders terminal AUTHORIZED state with actor and audit head hash', () => {
      const authorizedProposal: Proposal = {
        ...sampleProposal,
        status: 'AUTHORIZED',
      };
      render(<ProposalCard initialProposal={authorizedProposal} />);
      expect(screen.getByTestId('authorized-banner')).toBeInTheDocument();
      expect(screen.getByText(/Authorized by/i)).toBeInTheDocument();
      expect(screen.getByText(/Audit head hash:/i)).toBeInTheDocument();
    });

    it('renders terminal REJECTED state', () => {
      const rejectedProposal: Proposal = {
        ...sampleProposal,
        status: 'REJECTED',
      };
      render(<ProposalCard initialProposal={rejectedProposal} />);
      const banner = screen.getByTestId('rejected-banner');
      expect(banner).toBeInTheDocument();
      expect(within(banner).getByText('Authorization Rejected')).toBeInTheDocument();
    });
  });

  // 4. AiPanel tests
  describe('AiPanel', () => {
    it('renders Summarize, Explain, and Propose buttons with AI ADVISORY chip', () => {
      render(<AiPanel nodeId="r1-n1" />);
      expect(screen.getByText('AI Advisory & Commentary')).toBeInTheDocument();
      expect(screen.getByText('AI · ADVISORY')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Generate AI summary/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Explain forecast model/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Propose action/i })).toBeInTheDocument();
    });

    it('handles Summarize action and renders summary output with evidence buttons', async () => {
      vi.spyOn(apiClient, 'post').mockResolvedValueOnce({
        text: 'Inlet temperature rising linearly towards breach. Recommend mitigating action.',
        evidence: ['fc_0193'],
        generated_at: '2026-10-28T10:15:00Z',
      });

      render(<AiPanel nodeId="r1-n1" />);
      const summarizeBtn = screen.getByRole('button', { name: /Generate AI summary/i });
      fireEvent.click(summarizeBtn);

      await waitFor(() => {
        expect(apiClient.post).toHaveBeenCalledWith('/api/ai/summarize', {
          scope: 'node',
          id: 'r1-n1',
        });
      });

      expect(await screen.findByText(/Inlet temperature rising linearly/i)).toBeInTheDocument();
      expect(screen.getByText('fc_0193')).toBeInTheDocument();
    });

    it('handles Explain Forecast action', async () => {
      vi.spyOn(apiClient, 'post').mockResolvedValueOnce({
        text: 'Forecast model ets_damped_additive detected slope acceleration.',
        evidence: ['cp_0042'],
        generated_at: '2026-10-28T10:15:00Z',
      });

      render(<AiPanel nodeId="r1-n1" forecastId="fc_0193" />);
      const explainBtn = screen.getByRole('button', { name: /Explain forecast model/i });
      fireEvent.click(explainBtn);

      await waitFor(() => {
        expect(apiClient.post).toHaveBeenCalledWith('/api/ai/explain', {
          forecast_id: 'fc_0193',
        });
      });

      expect(await screen.findByText(/detected slope acceleration/i)).toBeInTheDocument();
      expect(screen.getByText('cp_0042')).toBeInTheDocument();
    });

    it('handles Propose Action and mounts the ProposalCard', async () => {
      vi.spyOn(apiClient, 'post').mockResolvedValueOnce(sampleProposal);

      render(<AiPanel nodeId="r1-n1" />);
      const proposeBtn = screen.getByRole('button', { name: /Propose action/i });
      fireEvent.click(proposeBtn);

      await waitFor(() => {
        expect(apiClient.post).toHaveBeenCalledWith('/api/ai/propose', {
          node_id: 'r1-n1',
        });
      });

      expect(await screen.findByTestId('proposal-card')).toBeInTheDocument();
      expect(screen.getByText('Reduce tenant load')).toBeInTheDocument();
    });

    it('handles AI_UNAVAILABLE error gracefully', async () => {
      vi.spyOn(apiClient, 'post').mockRejectedValueOnce(
        new ApiClientError(503, 'AI_UNAVAILABLE', 'LLM advisory service offline')
      );

      render(<AiPanel nodeId="r1-n1" />);
      const summarizeBtn = screen.getByRole('button', { name: /Generate AI summary/i });
      fireEvent.click(summarizeBtn);

      expect(
        await screen.findByText('AI commentary unavailable')
      ).toBeInTheDocument();
    });
  });

  // 5. EvidenceModal tests
  describe('EvidenceModal', () => {
    it('loads and renders forecast evidence detail', async () => {
      render(<EvidenceModal evidenceId="fc_0193" onClose={vi.fn()} />);
      expect(await screen.findByText('Forecast Record fc_0193')).toBeInTheDocument();
      expect(screen.getByText('Inlet Temperature (t_c)')).toBeInTheDocument();
      expect(screen.getByText('ets_damped_additive (1,000 Monte Carlo paths)')).toBeInTheDocument();
      expect(screen.getByText('27.0 °C (ASHRAE Recommended)')).toBeInTheDocument();
    });

    it('loads and renders changepoint evidence detail', async () => {
      render(<EvidenceModal evidenceId="cp_0042" onClose={vi.fn()} />);
      expect(await screen.findByText('Change Point Detection cp_0042')).toBeInTheDocument();
      expect(screen.getByText('CUSUM trigger + PELT confirmation')).toBeInTheDocument();
      expect(screen.getByText('+1.50 °C (from 23.90 °C to 25.40 °C)')).toBeInTheDocument();
    });

    it('triggers onClose when close button is clicked', async () => {
      const handleClose = vi.fn();
      render(<EvidenceModal evidenceId="fc_0193" onClose={handleClose} />);
      const closeBtn = await screen.findByRole('button', { name: /Close evidence dialog/i });
      fireEvent.click(closeBtn);
      expect(handleClose).toHaveBeenCalled();
    });
  });

  // 6. ApprovalsView tests
  describe('ApprovalsView', () => {
    it('loads and displays list of proposals with filtering capability', async () => {
      vi.spyOn(apiClient, 'get').mockResolvedValueOnce({
        proposals: [
          sampleProposal,
          {
            ...sampleProposal,
            proposal_id: 'pr_0008',
            status: 'APPROVED_PENDING_TAP',
            action: 'MIGRATE_TENANT',
          },
        ],
      });

      render(<ApprovalsView />);

      expect(await screen.findByText('Facility Approvals Queue')).toBeInTheDocument();
      expect(screen.getByText('pr_0007')).toBeInTheDocument();
      expect(screen.getByText('pr_0008')).toBeInTheDocument();
      expect(screen.getByText('Reduce tenant load')).toBeInTheDocument();
      expect(screen.getByText('Migrate tenant')).toBeInTheDocument();

      // Filter by APPROVED_PENDING_TAP
      const filterSelect = screen.getByLabelText(/Filter proposals by status/i);
      fireEvent.change(filterSelect, { target: { value: 'APPROVED_PENDING_TAP' } });

      expect(screen.queryByText('pr_0007')).not.toBeInTheDocument();
      expect(screen.getByText('pr_0008')).toBeInTheDocument();
    });
  });

  // 7. AuditView tests
  describe('AuditView', () => {
    const sampleAuditRows = [
      {
        seq: 1842,
        ts: '2026-10-28T10:14:32Z',
        actor: 'user:operator-01',
        event: 'PROPOSAL_APPROVED' as const,
        subject: { proposal_id: 'pr_0007' },
        hash: '9f2c4a1b8e7d6c5b4a3f2e1d0c9b8a7f6e5d4c3b2a1f0e9d8c7b6a5f4e3d2c10',
        prev_hash: '1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b',
        payload: { proposal_id: 'pr_0007', nonce: 'nc_test_123' },
      },
      {
        seq: 1841,
        ts: '2026-10-28T10:14:00Z',
        actor: 'ai:advisory-agent',
        event: 'AI_PROPOSAL' as const,
        subject: { proposal_id: 'pr_0007' },
        hash: '1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b',
        prev_hash: '0000000000000000000000000000000000000000000000000000000000000000',
        payload: { action: 'REDUCE_TENANT_LOAD' },
      },
    ];

    it('renders audit log rows and cryptographic chain verification hero bar', async () => {
      vi.spyOn(apiClient, 'get').mockImplementation(async (url: string) => {
        if (url === '/api/audit') {
          return { rows: sampleAuditRows, total: 2 };
        }
        if (url.startsWith('/api/audit/verify')) {
          return {
            ok: true,
            rows_checked: 1842,
            head_hash: '9f2c4a1b8e7d6c5b4a3f2e1d0c9b8a7f6e5d4c3b2a1f0e9d8c7b6a5f4e3d2c10',
          };
        }
        throw new Error(`Unexpected url ${url}`);
      });

      render(<AuditView />);

      expect(await screen.findByText('Audit Chain Cryptographically Verified')).toBeInTheDocument();
      expect(screen.getByText('Verified')).toBeInTheDocument();
      expect(screen.getByText('1,842')).toBeInTheDocument();
      expect(screen.getByText(/9f2c4a1b8e7d6c5b/)).toBeInTheDocument();

      // Check rows in table
      expect(screen.getByText('#1842')).toBeInTheDocument();
      expect(screen.getAllByText('PROPOSAL_APPROVED').length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText('user:operator-01').length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText('#1841')).toBeInTheDocument();
      expect(screen.getAllByText('AI_PROPOSAL').length).toBeGreaterThanOrEqual(1);
    });

    it('detects and displays tampered hash chain error', async () => {
      vi.spyOn(apiClient, 'get').mockImplementation(async (url: string) => {
        if (url === '/api/audit') {
          return { rows: sampleAuditRows, total: 2 };
        }
        if (url.startsWith('/api/audit/verify')) {
          return {
            ok: false,
            rows_checked: 903,
            head_hash: '9f2c4a1b8e7d6c5b',
            broken_at: 903,
          };
        }
        throw new Error(`Unexpected url ${url}`);
      });

      render(<AuditView />);

      expect(
        await screen.findByText(/Chain Broken at Row 903/i)
      ).toBeInTheDocument();
      expect(screen.getByText(/Hash mismatch detected/i)).toBeInTheDocument();
    });

    it('fetches /api/audit and /api/audit/verify exactly once on mount, and again only on explicit user action', async () => {
      const getSpy = vi.spyOn(apiClient, 'get').mockImplementation(async (url: string) => {
        if (url === '/api/audit') {
          return { rows: sampleAuditRows, total: 2 };
        }
        if (url.startsWith('/api/audit/verify')) {
          return {
            ok: true,
            rows_checked: 1842,
            head_hash: '9f2c4a1b8e7d6c5b4a3f2e1d0c9b8a7f6e5d4c3b2a1f0e9d8c7b6a5f4e3d2c10',
          };
        }
        throw new Error(`Unexpected url ${url}`);
      });

      render(<AuditView />);

      expect(await screen.findByText('Audit Chain Cryptographically Verified')).toBeInTheDocument();
      expect(screen.getByText('#1842')).toBeInTheDocument();

      // Verify that /api/audit and /api/audit/verify were each called exactly once on mount
      const auditCalls = getSpy.mock.calls.filter(([url]) => url === '/api/audit');
      const verifyCalls = getSpy.mock.calls.filter(([url]) => url.startsWith('/api/audit/verify'));

      expect(auditCalls.length).toBe(1);
      expect(verifyCalls.length).toBe(1);

      // Explicit user action: click "Verify chain" button
      const verifyButton = screen.getByRole('button', { name: /Verify audit chain hashes/i });
      fireEvent.click(verifyButton);

      await waitFor(() => {
        const verifyCallsAfterClick = getSpy.mock.calls.filter(([url]) => url.startsWith('/api/audit/verify'));
        expect(verifyCallsAfterClick.length).toBe(2);
      });

      // /api/audit must NOT have been called again (still exactly 1)
      const auditCallsAfterClick = getSpy.mock.calls.filter(([url]) => url === '/api/audit');
      expect(auditCallsAfterClick.length).toBe(1);
    });
  });
});
