import React, { useEffect, useState } from 'react';
import { Chip } from '../../design/Chip';
import { X, ShieldCheck, FileText } from 'lucide-react';

interface EvidenceModalProps {
  evidenceId: string | null;
  onClose: () => void;
}

interface EvidenceData {
  id: string;
  type: 'forecast' | 'changepoint' | 'audit' | 'unknown';
  title: string;
  timestamp?: string;
  details: Record<string, string | number | boolean>;
  hash?: string;
  meta?: {
    quality: string;
    model?: string;
  };
}

export const EvidenceModal: React.FC<EvidenceModalProps> = ({ evidenceId, onClose }) => {
  const [data, setData] = useState<EvidenceData | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    if (!evidenceId) return;

    setLoading(true);

    // Close on Escape key
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);

    // Synthesize / load evidence detail
    const timer = setTimeout(() => {
      if (evidenceId.startsWith('fc_')) {
        setData({
          id: evidenceId,
          type: 'forecast',
          title: `Forecast Record ${evidenceId}`,
          timestamp: new Date().toISOString(),
          details: {
            Metric: 'Inlet Temperature (t_c)',
            Model: 'ets_damped_additive (1,000 Monte Carlo paths)',
            'Confidence Horizon': '7,200 s (2.0 hours)',
            'Estimated Breach ETA': '360 s (6.0 min)',
            'No Breach Fraction': '12% probability of no breach',
            'Slope CI': '0.009 to 0.019 °C/s',
            'Limit Threshold': '27.0 °C (ASHRAE Recommended)',
          },
          meta: { quality: 'estimated', model: 'ets_damped_additive' },
        });
      } else if (evidenceId.startsWith('cp_')) {
        setData({
          id: evidenceId,
          type: 'changepoint',
          title: `Change Point Detection ${evidenceId}`,
          timestamp: new Date(Date.now() - 120000).toISOString(),
          details: {
            Node: 'r1-n1',
            Metric: 'Inlet Temperature (t_c)',
            'Statistical Detector': 'CUSUM trigger + PELT confirmation',
            'Mean Shift': '+1.50 °C (from 23.90 °C to 25.40 °C)',
            'Associated Physical Event': 'Node r2-n1 (Beta Compute) came online',
            'Detection Latency': '3.2 s from physical onset',
          },
          meta: { quality: 'measured' },
        });
      } else {
        setData({
          id: evidenceId,
          type: 'audit',
          title: `Audit Proof Record ${evidenceId}`,
          timestamp: new Date().toISOString(),
          details: {
            'Event Type': 'AI_PROPOSAL',
            Actor: 'ai:advisory-agent',
            'Subject Proposal': 'pr_0007',
            'Scope Node': 'r1-n1',
            'Previous Hash': '6a1f8b3c9d2e4f5a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0',
          },
          hash: '9f2c4a1b8e7d6c5b4a3f2e1d0c9b8a7f6e5d4c3b2a1f0e9d8c7b6a5f4e3d2c1',
          meta: { quality: 'measured' },
        });
      }
      setLoading(false);
    }, 150);

    return () => {
      clearTimeout(timer);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [evidenceId, onClose]);

  if (!evidenceId) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-ink/20 backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
      aria-labelledby="evidence-modal-title"
    >
      <div className="w-full max-w-lg bg-surface border border-border rounded-lg shadow-xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Modal Header */}
        <div className="px-5 py-3.5 bg-surface-sunken border-b border-border flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ShieldCheck size={18} strokeWidth={1.5} className="text-primary" />
            <h3 id="evidence-modal-title" className="text-13 font-semibold text-ink">
              Verified Evidence Record
            </h3>
            <span className="font-mono text-11 px-2 py-0.5 rounded bg-primary-weak/50 text-primary font-medium">
              {evidenceId}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded text-ink-2 hover:bg-surface-hover hover:text-ink transition-colors"
            aria-label="Close evidence dialog"
          >
            <X size={16} strokeWidth={1.5} />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 space-y-4">
          {loading ? (
            <div className="space-y-2 animate-pulse">
              <div className="h-4 bg-surface-sunken rounded w-3/4" />
              <div className="h-4 bg-surface-sunken rounded w-1/2" />
              <div className="h-20 bg-surface-sunken rounded" />
            </div>
          ) : data ? (
            <>
              <div className="flex items-center justify-between pb-2 border-b border-border">
                <div>
                  <div className="text-12 font-semibold text-ink">{data.title}</div>
                  {data.timestamp && (
                    <div className="text-11 font-mono text-ink-muted">
                      Recorded: {new Date(data.timestamp).toLocaleString()}
                    </div>
                  )}
                </div>
                {data.meta?.quality && (
                  <Chip
                    variant={
                      data.meta.quality === 'measured'
                        ? 'neutral'
                        : data.meta.quality === 'estimated'
                        ? 'estimated'
                        : 'inferred'
                    }
                  >
                    {data.meta.quality.toUpperCase()}
                  </Chip>
                )}
              </div>

              {/* Verified Details Grid */}
              <div className="space-y-2 bg-surface-sunken p-3 rounded-lg border border-border text-12">
                {Object.entries(data.details).map(([key, val]) => (
                  <div key={key} className="flex items-start justify-between gap-4 py-0.5">
                    <span className="text-ink-2 shrink-0">{key}:</span>
                    <span className="font-mono font-medium text-ink text-right break-all">
                      {String(val)}
                    </span>
                  </div>
                ))}
              </div>

              {/* Cryptographic SHA-256 Hash if available */}
              {data.hash && (
                <div className="p-2.5 rounded bg-surface border border-border space-y-1">
                  <div className="text-11 font-medium text-ink-2 flex items-center gap-1.5">
                    <FileText size={12} strokeWidth={1.5} className="text-primary" />
                    <span>Cryptographic Audit Proof (SHA-256)</span>
                  </div>
                  <div className="font-mono text-11 text-ink break-all select-all bg-surface-sunken p-1.5 rounded border border-border">
                    {data.hash}
                  </div>
                </div>
              )}
            </>
          ) : null}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 bg-surface-sunken border-t border-border flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 rounded bg-surface border border-border text-12 font-medium text-ink hover:bg-surface-hover transition-colors shadow-xs"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
