import React from 'react';
import { Card } from '../../design/Card';
import { Chip } from '../../design/Chip';
import { EmptyState } from '../../design/EmptyState';
import { Zap, Gauge } from 'lucide-react';

interface ConsumptionGaugesProps {
  itPowerWatts?: number | null;
  pue?: number | null;
  hasPowerData: boolean;
}

export const ConsumptionGauges: React.FC<ConsumptionGaugesProps> = ({
  itPowerWatts,
  pue = 1.25,
  hasPowerData,
}) => {
  if (!hasPowerData || itPowerWatts === null || itPowerWatts === undefined) {
    return (
      <Card
        title="Consumption"
        subtitle="Estimated facility power"
        className="h-full"
        data-testid="consumption-gauges"
      >
        <EmptyState
          icon={Gauge}
          title="No power data"
          description="Power metrics are estimated from CPU utilization models. Waiting for node power streams."
        />
      </Card>
    );
  }

  const effectivePue = pue ?? 1.25;
  const totalPowerWatts = itPowerWatts * effectivePue;

  return (
    <Card
      title="Consumption"
      subtitle="Estimated power draw & PUE"
      className="h-full"
      data-testid="consumption-gauges"
    >
      <div className="space-y-3">
        {/* PUE Header Numeral */}
        <div
          className="p-2.5 rounded border border-border bg-surface-sunken flex items-center justify-between"
          title="Estimated Power Usage Effectiveness ratio (Facility Total Power ÷ IT Equipment Power)"
        >
          <div className="flex items-center gap-1.5">
            <Gauge size={14} strokeWidth={1.5} className="text-primary" />
            <span className="text-11 font-medium text-ink-2 uppercase">PUE</span>
          </div>
          <div className="flex items-baseline gap-1.5">
            <span className="text-16 font-mono font-bold text-ink tabular-nums">
              est. {effectivePue.toFixed(2)}
            </span>
            <Chip variant="estimated">
              EST.
            </Chip>
          </div>
        </div>

        {/* Two KPI Power Gauges */}
        <div className="grid grid-cols-2 gap-2">
          {/* IT Power (estimated) */}
          <div
            className="p-2.5 rounded border border-border bg-surface flex flex-col justify-between"
            title="Estimated from CPU utilisation × per-board constants. No current sensor fitted."
          >
            <div className="flex items-center justify-between">
              <span className="text-11 font-medium text-ink-2 truncate">IT Power</span>
              <Chip variant="estimated">
                EST.
              </Chip>
            </div>
            <div className="mt-1 flex items-baseline gap-1">
              <Zap size={13} strokeWidth={1.5} className="text-accent shrink-0" />
              <span className="text-16 font-mono font-bold text-ink tabular-nums">
                {itPowerWatts.toFixed(2)}
              </span>
              <span className="text-11 font-mono text-ink-muted">W</span>
            </div>
            <span className="text-10 text-ink-muted mt-1 truncate">Model: linear-cpu-v1</span>
          </div>

          {/* Total Power (estimated) */}
          <div
            className="p-2.5 rounded border border-border bg-surface flex flex-col justify-between"
            title="Total facility power estimated as IT Power × PUE (est. 1.25)."
          >
            <div className="flex items-center justify-between">
              <span className="text-11 font-medium text-ink-2 truncate">Total Power</span>
              <Chip variant="estimated">
                EST.
              </Chip>
            </div>
            <div className="mt-1 flex items-baseline gap-1">
              <Zap size={13} strokeWidth={1.5} className="text-accent shrink-0" />
              <span className="text-16 font-mono font-bold text-ink tabular-nums">
                {totalPowerWatts.toFixed(2)}
              </span>
              <span className="text-11 font-mono text-ink-muted">W</span>
            </div>
            <span className="text-10 text-ink-muted mt-1 truncate">IT Power × PUE</span>
          </div>
        </div>
      </div>
    </Card>
  );
};
