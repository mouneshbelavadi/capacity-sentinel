import React, { useState } from 'react';
import { apiClient, ApiClientError } from '../../api/client';
import { AiSummarizeResponse, Proposal } from '../../api/contract';
import { Chip } from '../../design/Chip';
import { StatusBadge } from '../../design/StatusBadge';
import { ProposalCard, stripEmojis } from '../proposals/ProposalCard';
import { EvidenceModal } from './EvidenceModal';
import { Sparkles, HelpCircle, ShieldAlert, AlertCircle, FileText } from 'lucide-react';

export interface AiPanelProps {
  nodeId?: string | null;
  rackId?: string | null;
  forecastId?: string | null;
  className?: string;
}

export const AiPanel: React.FC<AiPanelProps> = ({
  nodeId,
  rackId,
  forecastId = 'fc_0193',
  className = '',
}) => {
  const [loadingAction, setLoadingAction] = useState<'summarize' | 'explain' | 'propose' | null>(null);
  const [summaryData, setSummaryData] = useState<AiSummarizeResponse | null>(null);
  const [explanationData, setExplanationData] = useState<AiSummarizeResponse | null>(null);
  const [activeProposal, setActiveProposal] = useState<Proposal | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isAiUnavailable, setIsAiUnavailable] = useState<boolean>(false);
  const [activeEvidenceId, setActiveEvidenceId] = useState<string | null>(null);

  // 1. Summarize action
  const handleSummarize = async () => {
    setLoadingAction('summarize');
    setErrorMessage(null);
    setIsAiUnavailable(false);
    try {
      const scope = nodeId ? 'node' : 'rack';
      const id = nodeId || rackId || 'rack-01';
      const res = await apiClient.post<AiSummarizeResponse>('/api/ai/summarize', {
        scope,
        id,
      });
      // Strip any emoji from LLM
      setSummaryData({
        ...res,
        text: stripEmojis(res.text),
      });
    } catch (err) {
      if (err instanceof ApiClientError && err.code === 'AI_UNAVAILABLE') {
        setIsAiUnavailable(true);
      } else {
        setErrorMessage(
          err instanceof ApiClientError ? err.message : 'Failed to retrieve AI summary'
        );
      }
    } finally {
      setLoadingAction(null);
    }
  };

  // 2. Explain action
  const handleExplain = async () => {
    setLoadingAction('explain');
    setErrorMessage(null);
    setIsAiUnavailable(false);
    try {
      const res = await apiClient.post<AiSummarizeResponse>('/api/ai/explain', {
        forecast_id: forecastId || 'fc_0193',
      });
      setExplanationData({
        ...res,
        text: stripEmojis(res.text),
      });
    } catch (err) {
      if (err instanceof ApiClientError && err.code === 'AI_UNAVAILABLE') {
        setIsAiUnavailable(true);
      } else {
        setErrorMessage(
          err instanceof ApiClientError ? err.message : 'Failed to retrieve forecast explanation'
        );
      }
    } finally {
      setLoadingAction(null);
    }
  };

  // 3. Propose action
  const handlePropose = async () => {
    setLoadingAction('propose');
    setErrorMessage(null);
    setIsAiUnavailable(false);
    try {
      const id = nodeId || rackId || 'r1-n1';
      const res = await apiClient.post<Proposal>('/api/ai/propose', {
        node_id: id,
      });
      setActiveProposal({
        ...res,
        rationale: stripEmojis(res.rationale),
        expected_effect: stripEmojis(res.expected_effect),
      });
    } catch (err) {
      if (err instanceof ApiClientError && err.code === 'AI_UNAVAILABLE') {
        setIsAiUnavailable(true);
      } else {
        setErrorMessage(
          err instanceof ApiClientError ? err.message : 'Failed to generate proposal'
        );
      }
    } finally {
      setLoadingAction(null);
    }
  };

  return (
    <div
      className={`border border-border rounded-lg bg-surface-sunken p-3.5 space-y-3.5 ${className}`}
      data-testid="ai-panel"
    >
      {/* Header with Advisory Badge */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-12 font-semibold text-ink">
          <Sparkles size={15} strokeWidth={1.5} className="text-primary" />
          <span>AI Advisory & Commentary</span>
        </div>
        <Chip variant="ai_generated">AI · ADVISORY</Chip>
      </div>

      {/* Action Buttons Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={handleSummarize}
          disabled={loadingAction !== null}
          className="flex items-center gap-1 px-2.5 py-1.5 rounded bg-surface border border-border text-11 font-medium text-ink hover:bg-surface-hover transition-colors shadow-xs disabled:opacity-50"
          aria-label="Generate AI summary"
        >
          <Sparkles size={12} strokeWidth={1.5} className="text-primary" />
          <span>{loadingAction === 'summarize' ? 'Summarizing...' : 'Summarize'}</span>
        </button>

        <button
          type="button"
          onClick={handleExplain}
          disabled={loadingAction !== null}
          className="flex items-center gap-1 px-2.5 py-1.5 rounded bg-surface border border-border text-11 font-medium text-ink hover:bg-surface-hover transition-colors shadow-xs disabled:opacity-50"
          aria-label="Explain forecast model"
        >
          <HelpCircle size={12} strokeWidth={1.5} className="text-ink-2" />
          <span>{loadingAction === 'explain' ? 'Explaining...' : 'Explain forecast'}</span>
        </button>

        <button
          type="button"
          onClick={handlePropose}
          disabled={loadingAction !== null}
          className="flex items-center gap-1 px-2.5 py-1.5 rounded bg-surface border border-border text-11 font-medium text-primary hover:bg-primary-weak/40 transition-colors shadow-xs disabled:opacity-50"
          aria-label="Propose action"
        >
          <ShieldAlert size={12} strokeWidth={1.5} className="text-primary" />
          <span>{loadingAction === 'propose' ? 'Proposing...' : 'Propose action'}</span>
        </button>
      </div>

      {/* AI Unavailable Notice */}
      {isAiUnavailable && (
        <div
          className="p-3 rounded border border-border bg-surface flex items-start gap-2 text-12 text-ink-2"
          role="status"
          data-testid="ai-unavailable-state"
        >
          <AlertCircle size={15} strokeWidth={1.5} className="text-ink-muted shrink-0 mt-0.5" />
          <div>
            <div className="font-semibold text-ink">AI commentary unavailable</div>
            <p className="text-11 mt-0.5">
              The advisory service is currently offline or unreachable. Telemetry, forecasts, and manual operations remain fully active.
            </p>
          </div>
        </div>
      )}

      {/* Generic Error message */}
      {errorMessage && (
        <div className="text-11 text-crit flex items-center gap-1">
          <AlertCircle size={12} strokeWidth={1.5} />
          <span>{errorMessage}</span>
        </div>
      )}

      {/* 1. Summary Output Card */}
      {summaryData && (
        <div
          className="p-3 rounded-lg border border-border bg-surface space-y-2 text-12 shadow-xs"
          data-testid="ai-summary-card"
        >
          <div className="flex items-center justify-between">
            <span className="text-11 font-semibold uppercase tracking-wider text-ink-muted">
              Operational Summary
            </span>
            {summaryData.status_hint && (
              <StatusBadge status={summaryData.status_hint} size="sm" />
            )}
          </div>
          <p className="text-ink leading-relaxed">{summaryData.text}</p>
          {summaryData.evidence && summaryData.evidence.length > 0 && (
            <div className="pt-2 border-t border-border/80 flex flex-wrap items-center gap-1.5 text-11">
              <span className="text-ink-muted flex items-center gap-1">
                <FileText size={11} strokeWidth={1.5} />
                <span>Evidence:</span>
              </span>
              {summaryData.evidence.map((evId) => (
                <button
                  key={evId}
                  type="button"
                  onClick={() => setActiveEvidenceId(evId)}
                  className="px-1.5 py-0.5 rounded bg-surface-sunken border border-border font-mono text-primary hover:bg-primary-weak/40 transition-colors shadow-2xs"
                  aria-label={`Open evidence record ${evId}`}
                >
                  {evId}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 2. Forecast Explanation Card */}
      {explanationData && (
        <div
          className="p-3 rounded-lg border border-border bg-surface space-y-2 text-12 shadow-xs"
          data-testid="ai-explanation-card"
        >
          <div className="text-11 font-semibold uppercase tracking-wider text-ink-muted">
            Forecast Rationale
          </div>
          <p className="text-ink leading-relaxed">{explanationData.text}</p>
          {explanationData.evidence && explanationData.evidence.length > 0 && (
            <div className="pt-2 border-t border-border/80 flex flex-wrap items-center gap-1.5 text-11">
              <span className="text-ink-muted flex items-center gap-1">
                <FileText size={11} strokeWidth={1.5} />
                <span>Evidence:</span>
              </span>
              {explanationData.evidence.map((evId) => (
                <button
                  key={evId}
                  type="button"
                  onClick={() => setActiveEvidenceId(evId)}
                  className="px-1.5 py-0.5 rounded bg-surface-sunken border border-border font-mono text-primary hover:bg-primary-weak/40 transition-colors shadow-2xs"
                  aria-label={`Open evidence record ${evId}`}
                >
                  {evId}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 3. Proposal Card */}
      {activeProposal && (
        <div className="pt-2">
          <ProposalCard
            initialProposal={activeProposal}
            onUpdated={(updated) => setActiveProposal(updated)}
          />
        </div>
      )}

      {/* Evidence Viewer Dialog */}
      {activeEvidenceId && (
        <EvidenceModal
          evidenceId={activeEvidenceId}
          onClose={() => setActiveEvidenceId(null)}
        />
      )}
    </div>
  );
};
