import React from 'react';
import { ProposalStatus } from '../../api/contract';
import { CheckCircle2, Clock, AlertOctagon, ArrowRight } from 'lucide-react';

interface ProposalStepperProps {
  status: ProposalStatus;
  className?: string;
}

interface Step {
  id: string;
  label: string;
  statusMatch: ProposalStatus[];
}

const STEPS: Step[] = [
  { id: 'proposed', label: 'Proposed', statusMatch: ['PROPOSED'] },
  { id: 'discussing', label: 'Discussing', statusMatch: ['DISCUSSING'] },
  { id: 'approved', label: 'Approved, waiting for tap', statusMatch: ['APPROVED_PENDING_TAP'] },
  { id: 'authorized', label: 'Authorized', statusMatch: ['AUTHORIZED'] },
];

export const ProposalStepper: React.FC<ProposalStepperProps> = ({ status, className = '' }) => {
  const isRejected = status === 'REJECTED';
  const isExpired = status === 'EXPIRED';

  // Determine current step index in linear flow
  const getCurrentStepIndex = () => {
    switch (status) {
      case 'PROPOSED':
        return 0;
      case 'DISCUSSING':
        return 1;
      case 'APPROVED_PENDING_TAP':
        return 2;
      case 'AUTHORIZED':
        return 3;
      case 'REJECTED':
      case 'EXPIRED':
      default:
        return -1;
    }
  };

  const currentIdx = getCurrentStepIndex();

  return (
    <div className={`space-y-3 ${className}`} data-testid="proposal-stepper">
      {/* Linear Stepper */}
      <ol
        className="flex items-center justify-between w-full p-2.5 rounded-lg border border-border bg-surface-sunken text-11"
        aria-label="Proposal authorization progress"
      >
        {STEPS.map((step, idx) => {
          const isCompleted = currentIdx > idx;
          const isCurrent = currentIdx === idx;

          return (
            <React.Fragment key={step.id}>
              <li
                className={`flex items-center gap-1.5 font-medium transition-colors ${
                  isCurrent
                    ? 'text-primary font-semibold'
                    : isCompleted
                    ? 'text-ink-2'
                    : 'text-ink-muted'
                }`}
                aria-current={isCurrent ? 'step' : undefined}
              >
                {isCompleted ? (
                  <CheckCircle2 size={14} strokeWidth={1.5} className="text-ok shrink-0" />
                ) : isCurrent ? (
                  <div className="w-3.5 h-3.5 rounded-full border-2 border-primary bg-primary-weak flex items-center justify-center shrink-0">
                    <div className="w-1.5 h-1.5 rounded-full bg-primary" />
                  </div>
                ) : (
                  <div className="w-3.5 h-3.5 rounded-full border border-border bg-surface shrink-0" />
                )}
                <span className="truncate max-w-[130px] sm:max-w-none">{step.label}</span>
              </li>

              {idx < STEPS.length - 1 && (
                <ArrowRight
                  size={12}
                  strokeWidth={1.5}
                  className={`shrink-0 mx-1 ${
                    currentIdx > idx ? 'text-ink-2' : 'text-border'
                  }`}
                  aria-hidden="true"
                />
              )}
            </React.Fragment>
          );
        })}
      </ol>

      {/* Terminal Off-Ramp Badges if Rejected or Expired */}
      {isRejected && (
        <div
          className="flex items-center gap-2 p-2.5 rounded border border-crit/40 bg-crit-weak text-crit text-12 font-medium"
          role="status"
        >
          <AlertOctagon size={16} strokeWidth={1.5} className="shrink-0" />
          <span>Proposal Rejected by operator or validation policy.</span>
        </div>
      )}

      {isExpired && (
        <div
          className="flex items-center gap-2 p-2.5 rounded border border-warn/40 bg-warn-weak text-warn text-12 font-medium"
          role="status"
        >
          <Clock size={16} strokeWidth={1.5} className="shrink-0" />
          <span>Approval window elapsed. Approve again to issue a new 60-second window.</span>
        </div>
      )}
    </div>
  );
};
