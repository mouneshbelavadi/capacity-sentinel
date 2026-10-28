import React from 'react';
import { Value } from './Value';
import { MetaProvenance, Status } from '../api/contract';
import { StatusBadge } from './StatusBadge';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';

export interface KpiTileProps {
  label: string;
  value: number | string | null | undefined;
  unit?: string;
  meta?: MetaProvenance;
  decimals?: number;
  delta?: {
    value: number | string;
    trend?: 'up' | 'down' | 'neutral';
    label?: string;
  };
  status?: Status;
  footer?: React.ReactNode;
  className?: string;
}

export const KpiTile: React.FC<KpiTileProps> = ({
  label,
  value,
  unit,
  meta,
  decimals,
  delta,
  status,
  footer,
  className = '',
}) => {
  return (
    <div
      className={`bg-surface border border-border rounded-lg p-4 shadow-card flex flex-col justify-between ${className}`}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-12 font-medium text-ink-2">{label}</span>
        {status && <StatusBadge status={status} size="sm" />}
      </div>

      <div className="my-2">
        <Value
          value={value}
          unit={unit}
          meta={meta}
          decimals={decimals}
          size="kpi"
        />
      </div>

      {(delta || footer) && (
        <div className="flex items-center justify-between text-12 text-ink-2 pt-2 border-t border-border/50">
          {delta && (
            <div className="flex items-center gap-1 font-mono text-11">
              {delta.trend === 'up' && <TrendingUp size={13} className="text-ink-2" />}
              {delta.trend === 'down' && <TrendingDown size={13} className="text-ink-2" />}
              {delta.trend === 'neutral' && <Minus size={13} className="text-ink-muted" />}
              <span className="tabular-nums">{delta.value}</span>
              {delta.label && <span className="text-ink-muted font-sans ml-1">{delta.label}</span>}
            </div>
          )}
          {footer && <div>{footer}</div>}
        </div>
      )}
    </div>
  );
};
