import React, { useState } from 'react';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
} from 'recharts';
import { TelemetryPoint } from '../../api/contract';
import { Card } from '../../design/Card';
import { DataTable, Column } from '../../design/DataTable';
import { Table as TableIcon, LineChart as ChartIcon, Activity } from 'lucide-react';

export interface VibrationBaselineChartProps {
  points: TelemetryPoint[];
  baselineRmsG?: number;
  baselineCapturedAt?: string;
  baselineSampleCount?: number;
  title?: string;
  isStale?: boolean;
}

interface VibPoint {
  ts: string;
  displayTime: string;
  ratio: number;
}

export const VibrationBaselineChart: React.FC<VibrationBaselineChartProps> = ({
  points,
  baselineRmsG = 0.012, // Captured commissioning baseline RMS in g
  baselineCapturedAt = '2026-10-28 08:00:00Z',
  baselineSampleCount = 2400,
  title = 'Vibration vs Baseline',
  isStale = false,
}) => {
  const [viewAsTable, setViewAsTable] = useState<boolean>(false);

  // Compute ratio relative to captured baseline
  const data: VibPoint[] = points.map((p) => {
    const ratio = baselineRmsG > 0 ? p.value / baselineRmsG : p.value;
    const d = new Date(p.ts);
    const displayTime = !isNaN(d.getTime())
      ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
      : p.ts;
    return {
      ts: p.ts,
      displayTime,
      ratio: Number(ratio.toFixed(2)),
    };
  });

  const latestRatio = data.length > 0 ? data[data.length - 1].ratio : 1.0;

  const tableColumns: Column<VibPoint>[] = [
    {
      key: 'displayTime',
      header: 'Timestamp',
      render: (item) => <span className="font-mono text-11 text-ink">{item.displayTime}</span>,
    },
    {
      key: 'ratio',
      header: 'Ratio (× Baseline)',
      align: 'right',
      render: (item) => (
        <span
          className={`font-mono text-12 font-medium tabular-nums ${
            item.ratio >= 4 ? 'text-crit' : item.ratio >= 2 ? 'text-warn' : 'text-ok'
          }`}
        >
          {item.ratio.toFixed(2)}×
        </span>
      ),
    },
    {
      key: 'evaluation',
      header: 'Severity Threshold',
      render: (item) =>
        item.ratio >= 4 ? (
          <span className="text-11 font-medium text-crit">CRIT (≥4×)</span>
        ) : item.ratio >= 2 ? (
          <span className="text-11 font-medium text-warn">WARN (≥2×)</span>
        ) : (
          <span className="text-11 text-ok">Normal (&lt;2×)</span>
        ),
    },
    {
      key: 'provenance',
      header: 'Provenance',
      render: () => <span className="text-11 text-ink-2">measured</span>,
    },
  ];

  return (
    <Card
      title={title}
      actions={
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setViewAsTable(!viewAsTable)}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-11 font-medium bg-surface hover:bg-surface-hover text-ink-2 border border-border transition-colors"
            aria-label={viewAsTable ? 'Switch to chart visualization' : 'Switch to table view'}
          >
            {viewAsTable ? (
              <>
                <ChartIcon size={13} strokeWidth={1.5} />
                <span>View as chart</span>
              </>
            ) : (
              <>
                <TableIcon size={13} strokeWidth={1.5} />
                <span>View as table</span>
              </>
            )}
          </button>
        </div>
      }
    >
      <div className="space-y-3">
        {/* Stat strip & baseline provenance caption */}
        <div className="flex flex-wrap items-center justify-between gap-2 p-2.5 bg-surface-sunken border border-border rounded-lg text-12">
          <div className="flex items-center gap-2">
            <Activity size={15} strokeWidth={1.5} className="text-primary" />
            <span className="text-ink-2">Current level:</span>
            <span
              className={`font-mono font-semibold tabular-nums text-13 ${
                latestRatio >= 4 ? 'text-crit' : latestRatio >= 2 ? 'text-warn' : 'text-ink'
              }`}
            >
              {latestRatio.toFixed(2)}× baseline
            </span>
          </div>
          <div className="text-11 text-ink-muted">
            Baseline captured <span className="font-mono">{baselineCapturedAt}</span> over{' '}
            <span className="font-mono">{baselineSampleCount.toLocaleString()}</span> samples
          </div>
        </div>

        {viewAsTable ? (
          <div className="border border-border rounded-lg overflow-hidden">
            <DataTable
              data={data}
              columns={tableColumns}
              keyExtractor={(item) => item.ts}
            />
          </div>
        ) : (
          <div className="h-60 w-full pt-2">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data} margin={{ top: 12, right: 24, left: 10, bottom: 0 }}>
                {/* Horizontal gridlines only per house style */}
                <CartesianGrid
                  strokeDasharray="0"
                  vertical={false}
                  stroke="var(--border)"
                  strokeWidth={1}
                />

                <XAxis
                  dataKey="displayTime"
                  tick={{ fill: 'var(--ink-muted)', fontSize: 11 }}
                  tickLine={false}
                  axisLine={{ stroke: 'var(--border)' }}
                />

                {/* y-axis is explicitly labelled "x baseline" — never mm/s, never an ISO zone */}
                <YAxis
                  tick={{ fill: 'var(--ink-muted)', fontSize: 11 }}
                  tickLine={false}
                  axisLine={{ stroke: 'var(--border)' }}
                  unit="×"
                  label={{
                    value: '× baseline',
                    angle: -90,
                    position: 'insideLeft',
                    fill: 'var(--ink-muted)',
                    fontSize: 11,
                    style: { textAnchor: 'middle' },
                  }}
                  domain={[0, (dataMax: number) => Math.max(5, Math.ceil(dataMax + 0.5))]}
                />

                <Tooltip
                  content={({ active, payload, label }) => {
                    if (!active || !payload || payload.length === 0) return null;
                    const r = payload[0].value as number;
                    return (
                      <div className="bg-surface p-3 border border-border rounded-lg shadow-panel text-12 space-y-1 z-20">
                        <div className="font-mono text-11 text-ink-muted">{label}</div>
                        <div className="font-mono font-semibold text-ink">
                          {r.toFixed(2)}× baseline
                        </div>
                        <div className="text-11 text-ink-2">
                          {r >= 4
                            ? 'CRIT escalation threshold breached (≥4×)'
                            : r >= 2
                            ? 'WARN advisory threshold breached (≥2×)'
                            : 'Normal operating envelope (&lt;2×)'}
                        </div>
                      </div>
                    );
                  }}
                />

                {/* 2x ReferenceLine (WARN) */}
                <ReferenceLine
                  y={2}
                  stroke="var(--warn)"
                  strokeDasharray="4 4"
                  strokeWidth={1.5}
                  label={{
                    value: '2× Baseline (WARN)',
                    position: 'top',
                    fill: 'var(--warn)',
                    fontSize: 11,
                  }}
                />

                {/* 4x ReferenceLine (CRIT) */}
                <ReferenceLine
                  y={4}
                  stroke="var(--crit)"
                  strokeDasharray="4 4"
                  strokeWidth={1.5}
                  label={{
                    value: '4× Baseline (CRIT)',
                    position: 'top',
                    fill: 'var(--crit)',
                    fontSize: 11,
                  }}
                />

                {/* Measured Vibration Line (solid 2px, --cat-3) */}
                <Line
                  type="monotone"
                  dataKey="ratio"
                  name="Vibration Ratio"
                  stroke={isStale ? 'var(--ink-muted)' : 'var(--cat-3)'}
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </Card>
  );
};
