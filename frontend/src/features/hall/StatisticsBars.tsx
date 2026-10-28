import React from 'react';
import { Card } from '../../design/Card';
import { Chip } from '../../design/Chip';

interface MarginBarItem {
  id: string;
  label: string;
  percentage: number;
  description: string;
  provenance: string;
  isEstimated?: boolean;
}

interface StatisticsBarsProps {
  rackCapacityPct: number;
  thermalMarginPct: number;
  powerMarginPct: number;
}

function getBarColorClass(pct: number): string {
  if (pct > 50) return 'bg-ok';
  if (pct >= 20) return 'bg-warn';
  return 'bg-crit';
}

export const StatisticsBars: React.FC<StatisticsBarsProps> = ({
  rackCapacityPct,
  thermalMarginPct,
  powerMarginPct,
}) => {
  const bars: MarginBarItem[] = [
    {
      id: 'rack-capacity',
      label: 'Rack capacity',
      percentage: Math.min(Math.max(rackCapacityPct, 0), 100),
      description: 'Allocated tenant slots vs physical slot capacity',
      provenance: 'Computed from GET /api/topology slots',
    },
    {
      id: 'thermal-margin',
      label: 'Thermal margin',
      percentage: Math.min(Math.max(thermalMarginPct, 0), 100),
      description: 'Worst thermal headroom to ASHRAE 27 °C recommended limit',
      provenance: 'Derived from GET /api/racks/:id/summary worst_margin',
    },
    {
      id: 'power-est',
      label: 'Power est.',
      percentage: Math.min(Math.max(powerMarginPct, 0), 100),
      description: 'Estimated CPU utilization load vs node capacity headroom',
      provenance: 'Computed by linear-cpu-v1 model via GET /api/power',
      isEstimated: true,
    },
  ];

  return (
    <Card
      title="Statistics"
      subtitle="Operational headroom & capacity margins"
      className="h-full"
      data-testid="statistics-bars"
    >
      <div className="space-y-3">
        {bars.map((bar) => {
          const colorClass = getBarColorClass(bar.percentage);
          return (
            <div
              key={bar.id}
              className="space-y-1 group"
              title={`${bar.description} • ${bar.provenance}`}
            >
              <div className="flex items-center justify-between text-11">
                <div className="flex items-center gap-1.5">
                  <span className="font-medium text-ink">{bar.label}</span>
                  {bar.isEstimated && (
                    <Chip variant="estimated">
                      EST.
                    </Chip>
                  )}
                </div>
                <span className="font-mono font-semibold text-ink tabular-nums">
                  {bar.percentage.toFixed(0)}%
                </span>
              </div>
              {/* Accessible Progress Bar */}
              <div
                className="w-full h-2 rounded-full bg-surface-sunken overflow-hidden border border-border/60"
                role="progressbar"
                aria-valuenow={bar.percentage}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={bar.label}
              >
                <div
                  className={`h-full ${colorClass} transition-all duration-300 rounded-full`}
                  style={{ width: `${bar.percentage}%` }}
                />
              </div>
              <div className="text-10 text-ink-muted truncate">{bar.description}</div>
            </div>
          );
        })}
      </div>
    </Card>
  );
};
