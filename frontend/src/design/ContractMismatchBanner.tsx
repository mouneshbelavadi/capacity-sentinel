import React from 'react';
import { AlertOctagon, RefreshCw, FileText } from 'lucide-react';

export interface ContractMismatchBannerProps {
  clientVersion: string;
  backendVersion: string;
  onDismiss?: () => void;
}

export const ContractMismatchBanner: React.FC<ContractMismatchBannerProps> = ({
  clientVersion,
  backendVersion,
  onDismiss,
}) => {
  return (
    <div
      className="fixed inset-0 z-50 bg-canvas/90 backdrop-blur-sm flex items-center justify-center p-4"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="drift-title"
    >
      <div className="w-full max-w-lg bg-surface border-2 border-crit rounded-lg shadow-panel p-6 text-ink">
        <div className="flex items-start gap-4">
          <div className="p-2 rounded bg-crit-weak text-crit shrink-0">
            <AlertOctagon size={28} strokeWidth={1.5} aria-hidden="true" />
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h2 id="drift-title" className="text-16 font-semibold text-ink">
                Contract Version Mismatch
              </h2>
              <span className="font-mono text-11 uppercase px-1.5 py-0.5 rounded bg-crit-weak text-crit font-medium border border-crit/30">
                CRITICAL DRIFT
              </span>
            </div>

            <p className="text-13 text-ink mt-2 leading-relaxed">
              The backend reports API contract version{' '}
              <code className="font-mono text-12 font-semibold text-crit bg-surface-sunken px-1 py-0.5 rounded border border-border">
                {backendVersion}
              </code>
              , but this frontend build was compiled against contract version{' '}
              <code className="font-mono text-12 font-semibold text-primary bg-surface-sunken px-1 py-0.5 rounded border border-border">
                {clientVersion}
              </code>
              .
            </p>

            <div className="mt-4 p-3 bg-surface-sunken border border-border rounded text-12 text-ink-2 space-y-1">
              <div className="flex items-center gap-1.5 font-medium text-ink">
                <FileText size={14} strokeWidth={1.5} />
                <span>Contract Governance Protocol</span>
              </div>
              <p className="text-11 leading-normal">
                Per <code className="font-mono">shared/api-contract.md</code>, major version updates alter
                field definitions, enums, or endpoint payloads. To prevent data corruption or false alarms,
                the interface is blocked until aligned.
              </p>
            </div>

            <div className="mt-6 flex items-center justify-between gap-3 pt-4 border-t border-border">
              <span className="text-11 text-ink-muted font-mono">
                Code: CONTRACT_VERSION_MISMATCH
              </span>
              <div className="flex items-center gap-2">
                {onDismiss && (
                  <button
                    type="button"
                    onClick={onDismiss}
                    className="px-3 py-1.5 rounded border border-border hover:bg-surface-hover text-12 font-medium text-ink transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                  >
                    Bypass for Inspection
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => window.location.reload()}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-primary hover:bg-primary-hover text-surface text-12 font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                >
                  <RefreshCw size={13} strokeWidth={1.5} />
                  <span>Reload Application</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
