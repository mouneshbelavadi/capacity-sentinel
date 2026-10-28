import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Proposal, ProposalsResponse } from '../../api/contract';
import { apiClient, ApiClientError } from '../../api/client';
import { useAuthStore } from '../../app/authStore';
import { Card } from '../../design/Card';
import { DataTable, Column } from '../../design/DataTable';
import { EmptyState } from '../../design/EmptyState';
import { ErrorState } from '../../design/ErrorState';
import { ProposalCard, formatActionLabel } from './ProposalCard';
import {
  CheckSquare,
  Filter,
  ChevronRight,
  Radio,
  X,
} from 'lucide-react';

export const ApprovalsView: React.FC = () => {
  const { user } = useAuthStore();
  const isTenant = user?.role === 'TENANT';

  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<ApiClientError | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [selectedProposal, setSelectedProposal] = useState<Proposal | null>(null);

  const fetchProposals = useCallback(async () => {
    try {
      const data = await apiClient.get<ProposalsResponse>('/api/proposals');
      setProposals(data.proposals || []);
    } catch (err) {
      setError(
        err instanceof ApiClientError
          ? err
          : new ApiClientError(500, 'INTERNAL', err instanceof Error ? err.message : 'Unknown error')
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    fetchProposals();
  }, [fetchProposals]);

  // Filter proposals by status
  const filteredProposals = useMemo(() => {
    if (statusFilter === 'all') return proposals;
    return proposals.filter((p) => p.status === statusFilter);
  }, [proposals, statusFilter]);

  // Column definitions for the DataTable
  const columns: Column<Proposal>[] = [
    {
      key: 'proposal_id',
      header: 'Proposal ID',
      render: (p) => (
        <span className="font-mono text-12 font-bold text-primary">
          {p.proposal_id}
        </span>
      ),
    },
    {
      key: 'created_at',
      header: 'Created',
      render: (p) => (
        <span className="font-mono text-11 text-ink-2">
          {new Date(p.created_at).toLocaleTimeString()}
        </span>
      ),
    },
    {
      key: 'action',
      header: 'Action',
      render: (p) => (
        <div className="space-y-0.5">
          <div className="font-semibold text-ink text-12">
            {formatActionLabel(p.action)}
          </div>
          <div className="font-mono text-11 text-ink-muted">Target: {p.target}</div>
        </div>
      ),
    },
    {
      key: 'risk_tier',
      header: 'Risk Tier',
      render: (p) => (
        <span
          className={`px-2 py-0.5 rounded text-10 font-mono font-semibold uppercase ${
            p.risk_tier === 'HIGH'
              ? 'bg-crit-weak text-crit border border-crit/30'
              : p.risk_tier === 'MEDIUM'
              ? 'bg-warn-weak text-warn border border-warn/30'
              : 'bg-surface-sunken text-ink-2 border border-border'
          }`}
        >
          {p.risk_tier}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Stepper State',
      render: (p) => {
        if (p.status === 'APPROVED_PENDING_TAP') {
          return (
            <span className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-primary-weak/40 text-primary border border-primary/30 text-11 font-medium font-mono animate-pulse">
              <Radio size={12} strokeWidth={1.5} />
              <span>Waiting for tap</span>
            </span>
          );
        }
        if (p.status === 'AUTHORIZED') {
          return (
            <span className="px-2 py-0.5 rounded bg-ok-weak text-ok border border-ok/30 text-11 font-medium">
              Authorized
            </span>
          );
        }
        if (p.status === 'REJECTED') {
          return (
            <span className="px-2 py-0.5 rounded bg-crit-weak text-crit border border-crit/30 text-11 font-medium">
              Rejected
            </span>
          );
        }
        if (p.status === 'EXPIRED') {
          return (
            <span className="px-2 py-0.5 rounded bg-warn-weak text-warn border border-warn/30 text-11 font-medium">
              Expired
            </span>
          );
        }
        if (p.status === 'DISCUSSING') {
          return (
            <span className="px-2 py-0.5 rounded bg-surface-sunken text-ink border border-border text-11 font-medium">
              Discussing
            </span>
          );
        }
        return (
          <span className="px-2 py-0.5 rounded bg-surface-sunken text-ink-2 border border-border text-11 font-medium">
            Proposed
          </span>
        );
      },
    },
    {
      key: 'actions',
      header: 'Review',
      align: 'right',
      render: (p) => (
        <button
          type="button"
          onClick={() => setSelectedProposal(p)}
          className="flex items-center gap-1 px-2.5 py-1 rounded bg-surface border border-border text-11 font-medium text-primary hover:bg-primary-weak/40 transition-colors shadow-2xs"
          aria-label={`Open review for proposal ${p.proposal_id}`}
        >
          <span>Open</span>
          <ChevronRight size={12} strokeWidth={1.5} />
        </button>
      ),
    },
  ];

  return (
    <div className="space-y-6" data-testid="approvals-view">
      {/* Top Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 bg-surface border border-border rounded-lg shadow-card">
        <div>
          <div className="flex items-center gap-2">
            <CheckSquare size={18} strokeWidth={1.5} className="text-primary" />
            <h2 className="text-14 font-semibold text-ink">
              {isTenant ? 'Tenant Action Proposals' : 'Facility Approvals Queue'}
            </h2>
          </div>
          <p className="text-12 text-ink-2 mt-0.5">
            {isTenant
              ? 'Proposals affecting your server bays. Discussion is active; authorization requires on-site operator tap.'
              : 'Working list of AI-advised operational proposals requiring human discussion and physical RFID card authorization.'}
          </p>
        </div>

        {/* Filter dropdown */}
        <div className="flex items-center gap-2 self-start sm:self-auto">
          <Filter size={14} strokeWidth={1.5} className="text-ink-2" />
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="text-12 p-1.5 rounded border border-border bg-surface text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
            aria-label="Filter proposals by status"
          >
            <option value="all">All Statuses</option>
            <option value="PROPOSED">Proposed</option>
            <option value="DISCUSSING">Discussing</option>
            <option value="APPROVED_PENDING_TAP">Waiting for Tap</option>
            <option value="AUTHORIZED">Authorized</option>
            <option value="REJECTED">Rejected</option>
            <option value="EXPIRED">Expired</option>
          </select>
        </div>
      </div>

      {loading ? (
        <div className="p-8 bg-surface border border-border rounded-lg animate-pulse space-y-3">
          <div className="h-4 bg-surface-sunken rounded w-1/4" />
          <div className="h-10 bg-surface-sunken rounded" />
          <div className="h-10 bg-surface-sunken rounded" />
        </div>
      ) : error ? (
        <ErrorState
          code={error.code}
          message={error.message || 'Unable to retrieve proposals queue'}
          detail={error.detail}
        />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Main List Column */}
          <div className={`${selectedProposal ? 'lg:col-span-7' : 'lg:col-span-12'} transition-all duration-200`}>
            <Card
              title="Operational Proposals"
              subtitle={`Showing ${filteredProposals.length} proposal${filteredProposals.length === 1 ? '' : 's'}`}
            >
              <DataTable
                columns={columns}
                data={filteredProposals}
                keyExtractor={(p) => p.proposal_id}
                emptyState={
                  <EmptyState
                    icon={CheckSquare}
                    title="No Proposals Found"
                    description="No proposals currently match this status filter. Proposals are generated when anomalies or capacity thresholds near exhaustion."
                  />
                }
              />
            </Card>
          </div>

          {/* Side Inspection Column (When selected) */}
          {selectedProposal && (
            <div className="lg:col-span-5 space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-12 font-semibold text-ink uppercase tracking-wider">
                  Selected Proposal Review
                </span>
                <button
                  type="button"
                  onClick={() => setSelectedProposal(null)}
                  className="p-1 rounded text-ink-2 hover:bg-surface-hover hover:text-ink transition-colors"
                  aria-label="Close proposal review"
                >
                  <X size={16} strokeWidth={1.5} />
                </button>
              </div>

              <ProposalCard
                initialProposal={selectedProposal}
                onUpdated={(updated) => {
                  setSelectedProposal(updated);
                  setProposals((prev) =>
                    prev.map((p) => (p.proposal_id === updated.proposal_id ? updated : p))
                  );
                }}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
};
