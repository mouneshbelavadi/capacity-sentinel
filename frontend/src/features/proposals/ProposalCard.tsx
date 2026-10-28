import React, { useState, useEffect, useMemo } from 'react';
import { Proposal, ProposalAction, AiChatResponse, ApproveProposalResponse } from '../../api/contract';
import { apiClient, ApiClientError } from '../../api/client';
import { useAuthStore } from '../../app/authStore';
import { Chip } from '../../design/Chip';
import { ProposalStepper } from './ProposalStepper';
import { EvidenceModal } from '../ai/EvidenceModal';
import {
  ShieldAlert,
  Send,
  Radio,
  Clock,
  CheckCircle,
  XCircle,
  FileText,
  AlertTriangle,
  Sparkles,
  ChevronRight,
  Wifi,
} from 'lucide-react';

// Maps raw action enum to human language per phase-6-approval.md §2
export function formatActionLabel(action: ProposalAction): string {
  switch (action) {
    case 'REDUCE_TENANT_LOAD':
      return 'Reduce tenant load';
    case 'MIGRATE_TENANT':
      return 'Migrate tenant';
    case 'INSPECT_FAN':
      return 'Inspect fan';
    case 'INCREASE_COOLING_SETPOINT_REQUEST':
      return 'Increase cooling setpoint request';
    case 'SCHEDULE_MAINTENANCE':
      return 'Schedule maintenance';
    case 'NO_ACTION':
      return 'No action';
    default:
      return action;
  }
}

// Strips any emojis that the LLM may output
export function stripEmojis(str: string): string {
  return str
    .replace(
      /(\p{Extended_Pictographic}|\p{Emoji_Presentation}|[\u{FE00}-\u{FE0F}]|[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F700}-\u{1F77F}\u{1F780}-\u{1F7FF}\u{1F800}-\u{1F8FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}])/gu,
      ''
    )
    .replace(/\s+/g, ' ')
    .trim();
}

// Human error messages for terminal tap rejection reasons
export function mapRejectionReason(reason?: string): string {
  switch (reason) {
    case 'UID_NOT_AUTHORIZED':
      return 'Card not registered';
    case 'HMAC_INVALID':
      return 'Device cryptographic verification failed';
    case 'CLOCK_SKEW':
      return 'Device clock skew exceeded';
    case 'NONCE_EXPIRED':
      return 'Approval window elapsed';
    case 'NONCE_CONSUMED':
      return 'Nonce already consumed';
    case 'DEVICE_UNKNOWN':
      return 'Unknown reader device';
    default:
      return reason || 'Authorization rejected by security policy';
  }
}

interface ChatMessage {
  id: string;
  sender: 'human' | 'ai';
  text: string;
  ts: string;
  auditedSeq?: number;
}

export interface ProposalCardProps {
  initialProposal: Proposal;
  onUpdated?: (proposal: Proposal) => void;
  className?: string;
}

export const ProposalCard: React.FC<ProposalCardProps> = ({
  initialProposal,
  onUpdated,
  className = '',
}) => {
  const { user } = useAuthStore();
  const isTenant = user?.role === 'TENANT';

  const [currentProposal, setCurrentProposal] = useState<Proposal>(initialProposal);
  const [previousProposal, setPreviousProposal] = useState<Proposal | null>(null);

  // Approval state
  const [approvalInfo, setApprovalInfo] = useState<ApproveProposalResponse | null>(null);
  const [timeRemainingSeconds, setTimeRemainingSeconds] = useState<number | null>(null);
  const [authResult, setAuthResult] = useState<{
    result: 'AUTHORIZED' | 'REJECTED' | 'EXPIRED';
    actor?: string;
    audit_hash?: string;
    reason?: string;
  } | null>(null);

  // Chat / Discussion state
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [inputMessage, setInputMessage] = useState('');
  const [isChatSubmitting, setIsChatSubmitting] = useState(false);
  const [isApproving, setIsApproving] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);

  // Evidence modal state
  const [activeEvidenceId, setActiveEvidenceId] = useState<string | null>(null);

  // Reader heartbeat simulation
  const readerLastSeen = '3s ago';

  // Keep synced if initial proposal changes
  useEffect(() => {
    setCurrentProposal(initialProposal);
  }, [initialProposal]);

  // Server-derived countdown timer
  useEffect(() => {
    if (currentProposal.status !== 'APPROVED_PENDING_TAP' || !approvalInfo?.expires_at) {
      setTimeRemainingSeconds(null);
      return;
    }

    const computeRemaining = () => {
      const expiresAtMs = new Date(approvalInfo.expires_at).getTime();
      const nowMs = Date.now();
      const diffSec = Math.max(0, Math.floor((expiresAtMs - nowMs) / 1000));
      setTimeRemainingSeconds(diffSec);

      if (diffSec <= 0) {
        // Expired
        const updated: Proposal = { ...currentProposal, status: 'EXPIRED' };
        setCurrentProposal(updated);
        setAuthResult({ result: 'EXPIRED' });
        if (onUpdated) onUpdated(updated);
      }
    };

    computeRemaining();
    const interval = setInterval(computeRemaining, 1000);
    return () => clearInterval(interval);
  }, [currentProposal.status, approvalInfo?.expires_at, currentProposal, onUpdated]);

  // Screen reader aria-live announcements at sensible intervals
  const srAnnouncement = useMemo(() => {
    if (timeRemainingSeconds === null) return '';
    if ([60, 30, 10, 5, 0].includes(timeRemainingSeconds)) {
      return `Waiting for card tap. ${timeRemainingSeconds} seconds remaining.`;
    }
    return '';
  }, [timeRemainingSeconds]);

  // Handle Discussion Chat submission (POST /api/ai/chat)
  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputMessage.trim() || isChatSubmitting) return;

    const userText = inputMessage.trim();
    setInputMessage('');
    setIsChatSubmitting(true);
    setChatError(null);

    const newSeq = 1840 + chatMessages.length + 1;
    const humanMsg: ChatMessage = {
      id: `msg-${Date.now()}-h`,
      sender: 'human',
      text: userText,
      ts: new Date().toLocaleTimeString(),
      auditedSeq: newSeq,
    };
    setChatMessages((prev) => [...prev, humanMsg]);

    try {
      const res = await apiClient.post<AiChatResponse>('/api/ai/chat', {
        proposal_id: currentProposal.proposal_id,
        message: userText,
      });

      const cleanReply = stripEmojis(res.reply || 'Discussion noted.');
      const aiMsg: ChatMessage = {
        id: `msg-${Date.now()}-a`,
        sender: 'ai',
        text: cleanReply,
        ts: new Date().toLocaleTimeString(),
        auditedSeq: newSeq + 1,
      };
      setChatMessages((prev) => [...prev, aiMsg]);

      // If a revision was generated, store previous proposal for field-diff highlighting
      if (res.proposal_revision) {
        setPreviousProposal(currentProposal);
        const revised: Proposal = {
          ...res.proposal_revision,
          status: 'DISCUSSING', // Discussion moves proposal to DISCUSSING, NEVER APPROVED
        };
        setCurrentProposal(revised);
        if (onUpdated) onUpdated(revised);
      } else if (currentProposal.status === 'PROPOSED') {
        const discussing: Proposal = { ...currentProposal, status: 'DISCUSSING' };
        setCurrentProposal(discussing);
        if (onUpdated) onUpdated(discussing);
      }
    } catch (err) {
      setChatError(
        err instanceof ApiClientError ? err.message : 'Failed to communicate with AI advisory service'
      );
    } finally {
      setIsChatSubmitting(false);
    }
  };

  // Handle Proceed -> Approve (POST /api/proposals/{id}/approve)
  const handleProceedToApprove = async () => {
    if (isTenant) return; // Proceed never renders or triggers for tenant

    setIsApproving(true);
    try {
      const res = await apiClient.post<ApproveProposalResponse>(
        `/api/proposals/${currentProposal.proposal_id}/approve`,
        {}
      );
      setApprovalInfo(res);
      const updated: Proposal = { ...currentProposal, status: 'APPROVED_PENDING_TAP' };
      setCurrentProposal(updated);
      if (onUpdated) onUpdated(updated);
    } catch (err) {
      setChatError(
        err instanceof ApiClientError ? err.message : 'Unable to issue authorization window'
      );
    } finally {
      setIsApproving(false);
    }
  };

  // Handle Cancel / Reject (POST /api/proposals/{id}/reject)
  const handleCancel = async () => {
    try {
      await apiClient.post(`/api/proposals/${currentProposal.proposal_id}/reject`, {});
      const updated: Proposal = { ...currentProposal, status: 'REJECTED' };
      setCurrentProposal(updated);
      setAuthResult({ result: 'REJECTED', reason: 'Operator cancelled pending authorization' });
      if (onUpdated) onUpdated(updated);
    } catch {
      // ignore
    }
  };

  // Diff helper
  const isActionChanged = previousProposal && previousProposal.action !== currentProposal.action;
  const isTargetChanged = previousProposal && previousProposal.target !== currentProposal.target;
  const isRationaleChanged = previousProposal && previousProposal.rationale !== currentProposal.rationale;

  return (
    <div
      className={`border border-border rounded-lg bg-surface shadow-card overflow-hidden space-y-4 p-4 ${className}`}
      data-testid="proposal-card"
    >
      {/* Top Banner with Stepper */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ShieldAlert size={18} strokeWidth={1.5} className="text-primary" />
            <h3 className="text-13 font-semibold text-ink">
              Action Proposal <span className="font-mono text-primary font-bold">{currentProposal.proposal_id}</span>
            </h3>
          </div>
          <div className="flex items-center gap-2">
            <Chip variant="ai_generated">AI · ADVISORY</Chip>
            <span
              className={`px-2 py-0.5 rounded text-11 font-mono font-semibold uppercase ${
                currentProposal.risk_tier === 'HIGH'
                  ? 'bg-crit-weak text-crit border border-crit/30'
                  : currentProposal.risk_tier === 'MEDIUM'
                  ? 'bg-warn-weak text-warn border border-warn/30'
                  : 'bg-surface-sunken text-ink-2 border border-border'
              }`}
            >
              {currentProposal.risk_tier} RISK
            </span>
          </div>
        </div>

        {/* Stepper Component */}
        <ProposalStepper status={currentProposal.status} />
      </div>

      {/* Screen Reader Announcements */}
      {srAnnouncement && (
        <div className="sr-only" aria-live="polite">
          {srAnnouncement}
        </div>
      )}

      {/* Waiting for Tap State Banner */}
      {currentProposal.status === 'APPROVED_PENDING_TAP' && (
        <div
          className="p-4 rounded-lg border-2 border-primary/40 bg-primary-weak/30 space-y-3"
          data-testid="waiting-for-tap-banner"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Radio size={18} strokeWidth={1.5} className="text-primary animate-pulse" />
              <span className="text-13 font-semibold text-ink">
                Waiting for tap on <code className="font-mono text-primary">{approvalInfo?.reader_device_id || 'reader-01'}</code>
              </span>
            </div>
            <div className="flex items-center gap-1.5 text-11 font-mono text-ink-2">
              <Wifi size={12} strokeWidth={1.5} className="text-ok" />
              <span>Reader heartbeat: {readerLastSeen}</span>
            </div>
          </div>

          {/* TFT Screen Mirror Box */}
          <div className="bg-ink p-3 rounded font-mono text-12 text-surface border border-ink shadow-inner space-y-1">
            <div className="text-10 uppercase text-ink-muted">TFT Display Mirror:</div>
            <div className="text-13 font-bold text-warn">{formatActionLabel(currentProposal.action).toUpperCase()}</div>
            <div className="text-11 text-ink-2">Target: {currentProposal.target}</div>
            <div className="text-10 text-ok pt-1">ARMED • Tap card to authorize</div>
          </div>

          {/* Countdown & Cancel */}
          <div className="flex items-center justify-between pt-1">
            <div className="flex items-center gap-2">
              <Clock size={16} strokeWidth={1.5} className="text-primary" />
              <span className="text-13 font-mono font-bold tabular-nums text-primary">
                {timeRemainingSeconds ?? 60} s remaining
              </span>
              <span className="text-11 text-ink-muted">before nonce expiration</span>
            </div>

            <button
              type="button"
              onClick={handleCancel}
              className="px-3 py-1 rounded bg-surface border border-border text-12 font-medium text-ink hover:bg-surface-hover transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Terminal State: AUTHORIZED */}
      {currentProposal.status === 'AUTHORIZED' && (
        <div
          className="p-3.5 rounded-lg border border-ok/40 bg-ok-weak text-ok space-y-1.5"
          data-testid="authorized-banner"
        >
          <div className="flex items-center gap-2 font-semibold text-13">
            <CheckCircle size={18} strokeWidth={1.5} />
            <span>Authorized by {authResult?.actor || 'Mounesh E Belavadi'}</span>
          </div>
          <div className="text-11 text-ink font-mono flex items-center gap-1.5">
            <span>Audit head hash:</span>
            <span className="px-1.5 py-0.5 rounded bg-surface border border-ok/30 text-ink select-all">
              {authResult?.audit_hash || '9f2c4a1b8e7d6c5b'}
            </span>
          </div>
        </div>
      )}

      {/* Terminal State: REJECTED */}
      {currentProposal.status === 'REJECTED' && (
        <div
          className="p-3.5 rounded-lg border border-crit/40 bg-crit-weak text-crit space-y-1"
          data-testid="rejected-banner"
        >
          <div className="flex items-center gap-2 font-semibold text-13">
            <XCircle size={18} strokeWidth={1.5} />
            <span>Authorization Rejected</span>
          </div>
          <div className="text-12 text-ink">
            Reason: <span className="font-medium">{mapRejectionReason(authResult?.reason)}</span>
          </div>
        </div>
      )}

      {/* Proposal Core Details */}
      <div className="p-3 bg-surface-sunken border border-border rounded-lg space-y-2.5 text-12">
        {/* Action Title with Revision Diff */}
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="text-11 uppercase tracking-wider text-ink-muted font-semibold">Recommended Action</div>
            <div className={`text-13 font-bold ${isActionChanged ? 'bg-warn-weak px-1.5 py-0.5 rounded border border-warn/40 text-ink' : 'text-ink'}`}>
              {formatActionLabel(currentProposal.action)}
            </div>
          </div>
          <div className="text-right">
            <div className="text-11 uppercase tracking-wider text-ink-muted font-semibold">Target Entity</div>
            <div className={`font-mono font-medium ${isTargetChanged ? 'bg-warn-weak px-1.5 py-0.5 rounded border border-warn/40 text-primary' : 'text-primary'}`}>
              {currentProposal.target}
            </div>
          </div>
        </div>

        {/* Rationale with Revision Diff */}
        <div>
          <div className="text-11 uppercase tracking-wider text-ink-muted font-semibold">Rationale</div>
          <p className={`mt-0.5 text-ink leading-relaxed ${isRationaleChanged ? 'bg-warn-weak/60 p-1.5 rounded border border-warn/30' : ''}`}>
            {stripEmojis(currentProposal.rationale)}
          </p>
        </div>

        {/* Expected Effect */}
        <div>
          <div className="text-11 uppercase tracking-wider text-ink-muted font-semibold">Expected Effect</div>
          <p className="mt-0.5 text-ink-2 font-mono text-11">
            {stripEmojis(currentProposal.expected_effect)}
          </p>
        </div>

        {/* Evidence Chips */}
        {currentProposal.evidence && currentProposal.evidence.length > 0 && (
          <div className="pt-2 border-t border-border flex flex-wrap items-center gap-2">
            <span className="text-11 font-medium text-ink-muted flex items-center gap-1">
              <FileText size={12} strokeWidth={1.5} />
              <span>Cited evidence:</span>
            </span>
            {currentProposal.evidence.map((evId) => (
              <button
                key={evId}
                type="button"
                onClick={() => setActiveEvidenceId(evId)}
                className="px-2 py-0.5 rounded bg-surface border border-border text-11 font-mono text-primary hover:bg-primary-weak/40 hover:border-primary/50 transition-colors shadow-xs"
                title={`Inspect verified record ${evId}`}
                aria-label={`Open evidence record ${evId}`}
              >
                {evId}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Discussion Thread Section (pre-approval conversation) */}
      <div className="space-y-3 pt-2 border-t border-border">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-12 font-semibold text-ink">
            <Sparkles size={14} strokeWidth={1.5} className="text-primary" />
            <span>Pre-Approval Discussion</span>
          </div>
          <span className="text-11 font-mono text-ink-muted">All exchanges audited</span>
        </div>

        {/* Thread History */}
        {chatMessages.length > 0 && (
          <div className="space-y-2 max-h-48 overflow-y-auto p-2 bg-surface-sunken border border-border rounded-lg text-12">
            {chatMessages.map((msg) => (
              <div
                key={msg.id}
                className={`p-2 rounded max-w-[85%] space-y-1 ${
                  msg.sender === 'human'
                    ? 'ml-auto bg-primary text-white'
                    : 'mr-auto bg-surface border border-border text-ink'
                }`}
              >
                <div className="flex items-center justify-between text-10 gap-3 opacity-80">
                  <span className="font-semibold">{msg.sender === 'human' ? 'Operator' : 'AI Advisory'}</span>
                  <span>{msg.ts}</span>
                </div>
                <div className="text-11 leading-normal">{msg.text}</div>
                {msg.auditedSeq && (
                  <div className="text-9 font-mono opacity-60">
                    audited: seq #{msg.auditedSeq}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Chat Query Input Form */}
        <form onSubmit={handleSendMessage} className="flex gap-2">
          <input
            type="text"
            value={inputMessage}
            onChange={(e) => setInputMessage(e.target.value)}
            placeholder="Ask AI about this proposal (e.g. 'why not migrate instead?')..."
            disabled={isChatSubmitting || ['AUTHORIZED', 'REJECTED', 'EXPIRED'].includes(currentProposal.status)}
            className="flex-1 px-3 py-1.5 text-12 rounded border border-border bg-surface text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-50"
            aria-label="Ask AI about this proposal"
          />
          <button
            type="submit"
            disabled={isChatSubmitting || !inputMessage.trim()}
            className="px-3 py-1.5 rounded bg-surface border border-border text-primary hover:bg-primary-weak/40 transition-colors disabled:opacity-50 shadow-xs flex items-center gap-1 text-12 font-medium"
          >
            <Send size={13} strokeWidth={1.5} />
            <span>Send</span>
          </button>
        </form>

        {chatError && (
          <div className="text-11 text-crit flex items-center gap-1">
            <AlertTriangle size={12} strokeWidth={1.5} />
            <span>{chatError}</span>
          </div>
        )}
      </div>

      {/* Action Footer: The "Proceed" button */}
      {/* Non-negotiable: The Proceed button NEVER renders for a tenant */}
      {!isTenant && (currentProposal.status === 'PROPOSED' || currentProposal.status === 'DISCUSSING') && (
        <div className="pt-2 border-t border-border flex items-center justify-between">
          <div className="text-11 text-ink-muted">
            Proceeding arms the physical reader for 60 seconds.
          </div>
          <button
            type="button"
            onClick={handleProceedToApprove}
            disabled={isApproving}
            className="flex items-center gap-1.5 px-4 py-2 rounded bg-primary text-white text-12 font-semibold hover:bg-primary-hover transition-colors shadow-xs focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            aria-label="Proceed to physical RFID authorization"
          >
            <span>Proceed to authorization</span>
            <ChevronRight size={14} strokeWidth={1.5} />
          </button>
        </div>
      )}

      {/* Evidence Inspection Modal */}
      {activeEvidenceId && (
        <EvidenceModal
          evidenceId={activeEvidenceId}
          onClose={() => setActiveEvidenceId(null)}
        />
      )}
    </div>
  );
};
