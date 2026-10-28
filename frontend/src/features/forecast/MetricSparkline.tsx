import React from 'react';
import { TelemetryPoint } from '../../api/contract';

export interface MetricSparklineProps {
  points: TelemetryPoint[];
  metric: string;
  unit: string;
  width?: number;
  height?: number;
  color?: string;
  isStale?: boolean;
}

export const MetricSparkline: React.FC<MetricSparklineProps> = ({
  points,
  unit,
  width = 120,
  height = 28,
  color = 'var(--cat-1)',
  isStale = false,
}) => {
  if (!points || points.length === 0) {
    return (
      <span className="text-11 text-ink-muted italic">No readings</span>
    );
  }

  const values = points.map((p) => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const paddingY = 3;
  const usableHeight = height - paddingY * 2;

  // Generate SVG path coordinates
  const coords = points.map((p, idx) => {
    const x = points.length === 1 ? width / 2 : (idx / (points.length - 1)) * (width - 40);
    const y = height - paddingY - ((p.value - min) / range) * usableHeight;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  const pathData = `M ${coords.join(' L ')}`;
  const latestValue = values[values.length - 1];

  return (
    <div
      className="inline-flex items-center gap-2"
      aria-label={`Sparkline trend, current value ${latestValue} ${unit}`}
    >
      <svg
        width={width - 40}
        height={height}
        className="overflow-visible"
        aria-hidden="true"
      >
        <path
          d={pathData}
          fill="none"
          stroke={isStale ? 'var(--ink-muted)' : color}
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      {/* Single direct end label with tabular numeral */}
      <span
        className={`font-mono text-11 font-medium tabular-nums ${
          isStale ? 'text-ink-muted' : 'text-ink'
        }`}
      >
        {latestValue.toFixed(1)} {unit}
      </span>
    </div>
  );
};
