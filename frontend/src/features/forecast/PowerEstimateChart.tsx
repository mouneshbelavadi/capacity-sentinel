import React, { useState } from 'react';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from 'recharts';
import { TelemetryPoint, PowerModelDetail } from '../../api/contract';
import { Card } from '../../design/Card';
import { Chip } from '../../design/Chip';
import { DataTable, Column } from '../../design/DataTable';
import { Table as TableIcon, LineChart as ChartIcon, Zap } from 'lucide-react';

export interface PowerEstimateChartProps {
  points: TelemetryPoint[];
  modelDetail?: PowerModelDetail;
  title?: string;
}

interface PowerPoint {
  ts: string;
  displayTime: string;
  value: number;
}

export const PowerEstimateChart: React.FC<PowerEstimateChartProps> = ({
  points,
  modelDetail = {
    formula: 'P = P_idle + (P_busy − P_idle)·u',
    p_idle_w: 0.45,
    p_busy_w: 1.4,
    u: 0.62,
    calibrated: false,
    reference: 'Fan, Weber & Barroso (ISCA 2007); UNO Q idle/load figures from independent bench tests',
  },
  title = 'Estimated Node Power Consumption',
}) => {
  const [viewAsTable, setViewAsTable] = useState<boolean>(false);

  const data: PowerPoint[] = points.map((p) => {
    const d = new Date(p.ts);
    const displayTime = !isNaN(d.getTime())
      ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
      : p.ts;
    return {
      ts: p.ts,
      displayTime,
      value: Number(p.value.toFixed(2)),
    };
  });

  const tableColumns: Column<PowerPoint>[] = [
    {
      key: 'displayTime',
      header: 'Timestamp',
      render: (item) => <span className="font-mono text-11 text-ink">{item.displayTime}</span>,
    },
    {
      key: 'value',
      header: 'Estimated Power (W)',
      align: 'right',
      render: (item) => (
        <span className="font-mono text-12 font-semibold text-ink tabular-nums">
          {item.value.toFixed(2)} W
        </span>
      ),
    },
    {
      key: 'model',
      header: 'Estimation Model',
      render: () => (
        <span className="text-11 text-ink-2 font-mono">
          linear-cpu-v1 ({modelDetail.formula})
        </span>
      ),
    },
    {
      key: 'provenance',
      header: 'Provenance',
      render: () => <Chip variant="neutral">EST.</Chip>,
    },
  ];

  return (
    <Card
      title={title}
      actions={
        <div className="flex items-center gap-2">
          {/* Always EST. badge on estimated power */}
          <Chip variant="neutral">EST.</Chip>
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
        {/* Model formula advisory box with live inputs */}
        <div className="p-2.5 bg-surface-sunken border border-border rounded-lg text-12 space-y-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Zap size={15} strokeWidth={1.5} className="text-primary" />
              <span className="text-ink-2">Model:</span>
              <code className="font-mono font-semibold text-ink text-11 bg-surface px-1.5 py-0.5 rounded border border-border">
                {modelDetail.formula}
              </code>
            </div>
            <div className="font-mono text-11 text-ink-2">
              Inputs: P_idle={modelDetail.p_idle_w}W, P_busy={modelDetail.p_busy_w}W, u={modelDetail.u}
            </div>
          </div>
          <p className="text-11 text-ink-muted leading-tight">
            Independent estimated metric. Never shares an axis or series line with measured physical telemetry.
          </p>
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
              <AreaChart data={data} margin={{ top: 12, right: 24, left: 10, bottom: 0 }}>
                {/* SVG defs for 45° diagonal hatch pattern fill */}
                <defs>
                  <pattern
                    id="power-hatch-45"
                    width="8"
                    height="8"
                    patternTransform="rotate(45 0 0)"
                    patternUnits="userSpaceOnUse"
                  >
                    <line
                      x1="0"
                      y1="0"
                      x2="0"
                      y2="8"
                      stroke="var(--cat-1)"
                      strokeWidth="2"
                      strokeOpacity="0.3"
                    />
                  </pattern>
                </defs>

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

                <YAxis
                  tick={{ fill: 'var(--ink-muted)', fontSize: 11 }}
                  tickLine={false}
                  axisLine={{ stroke: 'var(--border)' }}
                  unit=" W"
                  domain={[0, (dataMax: number) => Math.max(2, Math.ceil(dataMax + 0.5))]}
                />

                {/* Tooltip carries the formula and live inputs per §5 */}
                <Tooltip
                  content={({ active, payload, label }) => {
                    if (!active || !payload || payload.length === 0) return null;
                    const val = payload[0].value as number;
                    return (
                      <div className="bg-surface p-3 border border-border rounded-lg shadow-panel text-12 space-y-1.5 z-20 max-w-xs">
                        <div className="font-mono text-11 text-ink-muted">{label}</div>
                        <div className="flex items-center justify-between font-mono">
                          <span className="text-ink-2">Estimated Power:</span>
                          <span className="font-semibold text-ink">{val.toFixed(2)} W</span>
                        </div>
                        <div className="p-1.5 bg-surface-sunken rounded border border-border text-11 space-y-0.5">
                          <div className="font-semibold text-ink">Formula:</div>
                          <div className="font-mono text-ink-2">{modelDetail.formula}</div>
                          <div className="text-ink-muted font-mono text-10">
                            P_idle={modelDetail.p_idle_w}W, P_busy={modelDetail.p_busy_w}W, u={modelDetail.u}
                          </div>
                        </div>
                      </div>
                    );
                  }}
                />

                {/* Estimated Power Area with 45° hatch fill pattern */}
                <Area
                  type="monotone"
                  dataKey="value"
                  name="Estimated Power"
                  stroke="var(--cat-1)"
                  strokeWidth={2}
                  fill="url(#power-hatch-45)"
                  isAnimationActive={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </Card>
  );
};
