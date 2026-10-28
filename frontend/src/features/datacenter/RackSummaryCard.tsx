import React, { useEffect, useState } from 'react';
import { apiClient, ApiClientError } from '../../api/client';
import { RackSummaryResponse } from '../../api/contract';
import { Card } from '../../design/Card';
import { Value } from '../../design/Value';
import { StatusBadge } from '../../design/StatusBadge';
import { ErrorState } from '../../design/ErrorState';
import { Gauge, Server } from 'lucide-react';

export interface RackSummaryCardProps {
  rackId: string;
  rackLabel?: string;
  className?: string;
}

export const RackSummaryCard: React.FC<RackSummaryCardProps> = ({
  rackId,
  rackLabel,
  className = '',
}) => {
  const [summary, setSummary] = useState<RackSummaryResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<ApiClientError | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    apiClient
      .get<RackSummaryResponse>(`/api/racks/${rackId}/summary`)
      .then((data) => {
        if (!cancelled) {
          setSummary(data);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(
            err instanceof ApiClientError
              ? err
              : new ApiClientError(500, 'INTERNAL', err.message || 'Failed to load rack summary')
          );
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [rackId]);

  const displayTitle = rackLabel ? `${rackLabel} Summary` : `Rack ${rackId} Summary`;

  // Designed Loading State (Skeleton layout matching real geometry)
  if (loading) {
    return (
      <Card title={displayTitle} subtitle="Real-time margin limits & capacity status" className={className}>
        <div className="space-y-4 animate-pulse" data-testid="rack-summary-skeleton">
          <div className="flex items-center justify-between pb-3 border-b border-border">
            <div className="h-4 w-28 bg-surface-sunken rounded" />
            <div className="h-6 w-16 bg-surface-sunken rounded" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="h-16 bg-surface-sunken rounded p-3" />
            <div className="h-16 bg-surface-sunken rounded p-3" />
          </div>
          <div className="p-3 bg-surface-sunken rounded space-y-2">
            <div className="h-4 w-36 bg-border rounded" />
            <div className="h-6 w-24 bg-border rounded" />
          </div>
        </div>
      </Card>
    );
  }

  // Designed Error State
  if (error || !summary) {
    return (
      <Card title={displayTitle} subtitle="Real-time margin limits & capacity status" className={className}>
        <ErrorState
          code={error?.code || 'INTERNAL'}
          message={error?.message || 'Unable to retrieve rack summary from data layer'}
        />
      </Card>
    );
  }

  const { worst_margin, nodes_online, nodes_total, status } = summary;

  // Metric human label mapping
  const metricLabels: Record<string, string> = {
    t_c: 'Inlet Temperature',
    rh: 'Relative Humidity',
    dew_c: 'Dew Point',
    mq_ratio: 'Air Quality (Rs/R0)',
    vib_rms_g: 'Vibration RMS',
    vib_crest: 'Vibration Crest Factor',
    shock_count: 'Mechanical Shock Events',
    power_w: 'Rack Power',
  };

  const metricTitle = metricLabels[worst_margin.metric] || worst_margin.metric;

  return (
    <Card
      title={displayTitle}
      subtitle="Real-time thermal & mechanical margins to operational limits"
      className={className}
      actions={<StatusBadge status={status} size="md" />}
    >
      <div className="space-y-4" data-testid="rack-summary-content">
        {/* Nodes Online Ratio */}
        <div className="grid grid-cols-2 gap-3">
          <div className="p-3 rounded border border-border bg-surface-sunken">
            <span className="block text-11 font-medium text-ink-2 uppercase tracking-wide">
              Nodes Online
            </span>
            <div className="mt-1 flex items-baseline gap-1.5">
              <span className="text-20 font-bold font-mono tabular-nums text-ink">
                {nodes_online}
              </span>
              <span className="text-12 font-mono text-ink-muted">/ {nodes_total}</span>
            </div>
            <span className="text-11 text-ink-muted mt-1 block">
              {nodes_online === nodes_total ? 'All reporting' : `${nodes_total - nodes_online} offline`}
            </span>
          </div>

          <div className="p-3 rounded border border-border bg-surface-sunken">
            <span className="block text-11 font-medium text-ink-2 uppercase tracking-wide">
              Worst Node
            </span>
            <div className="mt-1 flex items-center gap-1.5">
              <Server size={14} strokeWidth={1.5} className="text-ink-muted" />
              <span className="text-14 font-semibold font-mono text-primary">
                {worst_margin.node_id}
              </span>
            </div>
            <span className="text-11 text-ink-muted mt-1 block">Critical path sensor</span>
          </div>
        </div>

        {/* Worst Margin Callout Box */}
        <div className="p-3.5 rounded-lg border border-border bg-surface flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <Gauge size={14} strokeWidth={1.5} className="text-ink-2" />
              <span className="text-12 font-semibold text-ink">{metricTitle}</span>
            </div>
            <span className="text-11 font-mono text-ink-muted">
              metric: {worst_margin.metric}
            </span>
          </div>

          {/* Current Reading */}
          <div className="flex items-baseline justify-between pt-1 border-t border-border/60">
            <span className="text-12 text-ink-2">Current Reading:</span>
            <Value
              value={worst_margin.value.value}
              unit={worst_margin.value.unit}
              meta={worst_margin.value.meta}
              size="lg"
            />
          </div>

          {/* Limit & Source */}
          <div className="pt-2 border-t border-border/60 text-11 space-y-1">
            <div className="flex items-baseline justify-between">
              <span className="text-ink-2 font-medium">Limit:</span>
              <span className="font-mono tabular-nums font-semibold text-ink">
                {worst_margin.limit} {worst_margin.value.unit}
              </span>
            </div>
            <div className="text-11 text-ink-muted">
              Source: <span className="text-ink-2 font-medium">{worst_margin.limit_source}</span>
            </div>
          </div>
        </div>
      </div>
    </Card>
  );
};
