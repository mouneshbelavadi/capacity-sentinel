import React from 'react';
import { ResponsiveContainer, AreaChart, Area, Tooltip, XAxis, YAxis } from 'recharts';
import { Card } from '../../design/Card';
import { Activity } from 'lucide-react';

export interface TrendDataPoint {
  ts: string;
  value: number;
}

interface TrendSparklineProps {
  data: TrendDataPoint[];
  metricLabel: string;
  unit: string;
  worstNodeId?: string;
}

export const TrendSparkline: React.FC<TrendSparklineProps> = ({
  data,
  metricLabel,
  unit,
  worstNodeId,
}) => {
  const latestValue = data.length > 0 ? data[data.length - 1].value : null;

  return (
    <Card
      title="Trends"
      subtitle={worstNodeId ? `Worst-margin trend (${worstNodeId})` : 'Worst-margin telemetry trend'}
      className="h-full"
      data-testid="trend-sparkline"
    >
      <div className="space-y-2">
        {/* Metric Headline Value */}
        <div className="flex items-baseline justify-between text-11">
          <div className="flex items-center gap-1.5 truncate text-ink-2">
            <Activity size={13} strokeWidth={1.5} className="text-primary shrink-0" />
            <span className="truncate">{metricLabel}</span>
          </div>
          {latestValue !== null ? (
            <div className="flex items-baseline gap-1 font-mono">
              <span className="font-bold text-14 text-ink tabular-nums">
                {latestValue.toFixed(1)}
              </span>
              <span className="text-10 text-ink-muted">{unit}</span>
            </div>
          ) : (
            <span className="text-10 text-ink-muted">No data</span>
          )}
        </div>

        {/* Recharts AreaChart with No Axes */}
        <div className="w-full h-12 relative">
          {data.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data} margin={{ top: 2, right: 2, bottom: 2, left: 2 }}>
                <defs>
                  <linearGradient id="trendGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#155FA6" stopOpacity={0.35} />
                    <stop offset="95%" stopColor="#155FA6" stopOpacity={0.0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="ts" hide />
                <YAxis hide domain={['auto', 'auto']} />
                <Tooltip
                  content={({ active, payload }) => {
                    if (active && payload && payload.length) {
                      const pt = payload[0].payload as TrendDataPoint;
                      const timeStr = new Date(pt.ts).toLocaleTimeString();
                      return (
                        <div className="bg-surface border border-border rounded p-1.5 shadow-card text-11 text-ink">
                          <div className="font-mono font-semibold tabular-nums">
                            {pt.value.toFixed(2)} {unit}
                          </div>
                          <div className="text-10 text-ink-muted font-mono">{timeStr}</div>
                          <div className="text-10 text-ink-2 truncate mt-0.5">{metricLabel}</div>
                        </div>
                      );
                    }
                    return null;
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="value"
                  stroke="#155FA6"
                  strokeWidth={1.5}
                  fill="url(#trendGradient)"
                  isAnimationActive={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="w-full h-full flex items-center justify-center text-11 text-ink-muted border border-dashed border-border rounded">
              Awaiting telemetry
            </div>
          )}
        </div>
      </div>
    </Card>
  );
};

