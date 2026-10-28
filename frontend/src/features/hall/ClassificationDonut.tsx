import React from 'react';
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip } from 'recharts';
import { Card } from '../../design/Card';

export interface SensorDistributionItem {
  type: string;
  name: string;
  count: number;
  color: string;
  isEstimated?: boolean;
}

interface ClassificationDonutProps {
  distribution: SensorDistributionItem[];
}

export const ClassificationDonut: React.FC<ClassificationDonutProps> = ({ distribution }) => {
  const totalSensors = distribution.reduce((sum, item) => sum + item.count, 0);

  return (
    <Card
      title="Classification"
      subtitle="Sensor distribution by telemetry type"
      className="h-full"
      data-testid="classification-donut"
    >
      <div className="flex flex-col sm:flex-row items-center gap-3">
        {/* Donut Chart */}
        <div className="w-[120px] h-[120px] shrink-0 relative flex items-center justify-center">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={distribution}
                dataKey="count"
                nameKey="name"
                cx="50%"
                cy="50%"
                innerRadius={34}
                outerRadius={50}
                paddingAngle={2}
                stroke="#FFFFFF"
                strokeWidth={1.5}
                isAnimationActive={false}
              >
                {distribution.map((entry) => (
                  <Cell key={entry.type} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip
                content={({ active, payload }) => {
                  if (active && payload && payload.length) {
                    const data = payload[0].payload as SensorDistributionItem;
                    const pct = totalSensors > 0 ? ((data.count / totalSensors) * 100).toFixed(0) : 0;
                    return (
                      <div className="bg-surface border border-border rounded p-1.5 shadow-card text-11 text-ink">
                        <span className="font-semibold block">{data.name}</span>
                        <span className="text-ink-2 font-mono tabular-nums">
                          {data.count} sensors ({pct}%)
                        </span>
                        {data.isEstimated && (
                          <span className="block text-10 font-semibold text-accent mt-0.5">
                            ESTIMATED MODEL
                          </span>
                        )}
                      </div>
                    );
                  }
                  return null;
                }}
              />
            </PieChart>
          </ResponsiveContainer>
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
            <span className="text-14 font-mono font-bold text-ink tabular-nums">
              {totalSensors}
            </span>
            <span className="text-9 uppercase tracking-wider text-ink-muted">Sensors</span>
          </div>
        </div>

        {/* Legend / Breakdown List */}
        <div className="flex-1 w-full space-y-1 text-11">
          {distribution.map((item) => {
            const pct = totalSensors > 0 ? ((item.count / totalSensors) * 100).toFixed(0) : 0;
            return (
              <div key={item.type} className="flex items-center justify-between text-ink-2">
                <div className="flex items-center gap-1.5 truncate">
                  <span
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{ backgroundColor: item.color }}
                  />
                  <span className="truncate">{item.name}</span>
                </div>
                <div className="flex items-center gap-1.5 shrink-0 pl-1">
                  <span className="font-mono text-ink font-semibold tabular-nums">
                    {item.count}
                  </span>
                  <span className="text-10 font-mono text-ink-muted w-7 text-right">
                    {pct}%
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </Card>
  );
};

