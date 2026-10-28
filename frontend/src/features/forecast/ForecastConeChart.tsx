import React, { useState } from 'react';
import {
  ResponsiveContainer,
  ComposedChart,
  Line,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ReferenceArea,
  Legend,
} from 'recharts';
import { ForecastResponse } from '../../api/contract';
import { Card } from '../../design/Card';
import { Chip } from '../../design/Chip';
import { DataTable, Column } from '../../design/DataTable';
import { TrendingUp, AlertTriangle, Table as TableIcon, LineChart as ChartIcon, Info } from 'lucide-react';

export interface ForecastConeChartProps {
  forecast: ForecastResponse;
  title?: string;
}

interface MergedPoint {
  ts: string;
  displayTime: string;
  measured?: number;
  median?: number;
  p10?: number;
  p90?: number;
  bandRange?: [number, number]; // [p10, p90]
  isCrossingWindow?: boolean;
}

export const ForecastConeChart: React.FC<ForecastConeChartProps> = ({
  forecast,
  title = 'Exhaustion Forecast Cone',
}) => {
  const [viewAsTable, setViewAsTable] = useState<boolean>(false);

  const {
    crossing,
    history = [],
    median = [],
    p10 = [],
    p90 = [],
    limit,
    limit_source,
    window_reason,
    calibration,
    horizon_s,
    metric,
  } = forecast;

  // Format headline metrics
  const hasTrend = crossing?.has_trend;
  const p10Min = crossing?.p10_s !== null && crossing?.p10_s !== undefined ? Math.round(crossing.p10_s / 60) : null;
  const p50Min = crossing?.p50_s !== null && crossing?.p50_s !== undefined ? Math.round(crossing.p50_s / 60) : null;
  const p90Min = crossing?.p90_s !== null && crossing?.p90_s !== undefined ? Math.round(crossing.p90_s / 60) : null;
  const noBreachPct = crossing?.no_breach_fraction !== undefined ? Math.round(crossing.no_breach_fraction * 100) : null;
  const horizonHours = Math.round((horizon_s || 7200) / 3600);

  // Derive metric name
  const metricLabel = metric === 't_c' ? 'Cooling margin' : metric === 'vib_rms_g' ? 'Vibration headroom' : 'Capacity';
  const unit = metric === 't_c' ? '°C' : metric === 'power_w' ? 'W' : '';

  // Merge history and forecast data up to horizon_s
  const timeMap = new Map<string, MergedPoint>();

  history.forEach((h) => {
    const d = new Date(h.ts);
    const timeStr = !isNaN(d.getTime()) ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : h.ts;
    timeMap.set(h.ts, {
      ts: h.ts,
      displayTime: timeStr,
      measured: h.value,
    });
  });

  // Attach median, p10, p90
  median.forEach((m) => {
    const existing = timeMap.get(m.ts) || {
      ts: m.ts,
      displayTime: new Date(m.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    };
    existing.median = m.value;
    timeMap.set(m.ts, existing);
  });

  p10.forEach((p) => {
    const existing = timeMap.get(p.ts);
    if (existing) {
      existing.p10 = p.value;
    }
  });

  p90.forEach((p) => {
    const existing = timeMap.get(p.ts);
    if (existing) {
      existing.p90 = p.value;
      if (existing.p10 !== undefined) {
        existing.bandRange = [existing.p10, existing.p90];
      }
    }
  });

  // Sort sequentially
  const chartData: MergedPoint[] = Array.from(timeMap.values()).sort(
    (a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime()
  );

  // Crossing window x-coordinates for ReferenceArea
  let crossingStartTs: string | undefined;
  let crossingEndTs: string | undefined;
  if (hasTrend && crossing.p10_s && crossing.p90_s && history.length > 0) {
    const historyEndTs = new Date(history[history.length - 1].ts).getTime();
    const p10Abs = historyEndTs + crossing.p10_s * 1000;
    const p90Abs = historyEndTs + crossing.p90_s * 1000;

    // Find closest timestamps in chartData
    const p10Match = chartData.find((p) => Math.abs(new Date(p.ts).getTime() - p10Abs) < 60000);
    const p90Match = chartData.find((p) => Math.abs(new Date(p.ts).getTime() - p90Abs) < 60000);
    crossingStartTs = p10Match?.displayTime;
    crossingEndTs = p90Match?.displayTime;
  }

  // Table columns for accessible table view
  const tableColumns: Column<MergedPoint>[] = [
    {
      key: 'displayTime',
      header: 'Timestamp',
      render: (item) => <span className="font-mono text-11 text-ink">{item.displayTime}</span>,
    },
    {
      key: 'measured',
      header: 'Observed (Measured)',
      align: 'right',
      render: (item) =>
        item.measured !== undefined ? (
          <span className="font-mono text-12 font-medium text-ink tabular-nums">
            {item.measured.toFixed(2)} {unit}
          </span>
        ) : (
          <span className="text-ink-muted text-11">—</span>
        ),
    },
    {
      key: 'median',
      header: 'Median P50 (Estimated)',
      align: 'right',
      render: (item) =>
        item.median !== undefined ? (
          <span className="font-mono text-12 text-cat-1 tabular-nums">
            {item.median.toFixed(2)} {unit}
          </span>
        ) : (
          <span className="text-ink-muted text-11">—</span>
        ),
    },
    {
      key: 'p10',
      header: 'P10 Lower (Estimated)',
      align: 'right',
      render: (item) =>
        item.p10 !== undefined ? (
          <span className="font-mono text-11 text-ink-2 tabular-nums">
            {item.p10.toFixed(2)} {unit}
          </span>
        ) : (
          <span className="text-ink-muted text-11">—</span>
        ),
    },
    {
      key: 'p90',
      header: 'P90 Upper (Estimated)',
      align: 'right',
      render: (item) =>
        item.p90 !== undefined ? (
          <span className="font-mono text-11 text-ink-2 tabular-nums">
            {item.p90.toFixed(2)} {unit}
          </span>
        ) : (
          <span className="text-ink-muted text-11">—</span>
        ),
    },
    {
      key: 'provenance',
      header: 'Provenance',
      render: (item) =>
        item.measured !== undefined ? (
          <span className="text-11 text-ink-2">measured</span>
        ) : (
          <Chip variant="neutral">EST.</Chip>
        ),
    },
  ];

  return (
    <Card
      title={title}
      actions={
        <div className="flex items-center gap-2">
          {forecast.meta?.quality && (
            <Chip variant={forecast.meta.quality === 'measured' ? 'neutral' : 'estimated'}>
              {forecast.meta.quality === 'measured' ? 'MEASURED' : 'ESTIMATED'}
            </Chip>
          )}
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
      <div className="space-y-4">
        {/* 1. Headline Stat Tile above the chart per §1 */}
        <div className="p-3.5 bg-surface-sunken border border-border rounded-lg space-y-1.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            {hasTrend ? (
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="text-14 font-semibold text-ink">
                  {metricLabel} runs out in{' '}
                  <span className="font-mono text-16 text-crit font-bold tabular-nums">
                    {p50Min} min
                  </span>
                </span>
                <span className="text-12 font-mono text-ink-2 tabular-nums">
                  · range {p10Min}–{p90Min} min
                </span>
                {noBreachPct !== null && (
                  <span className="text-12 text-ink-2">
                    · <strong className="font-mono text-ink tabular-nums">{noBreachPct}%</strong> of scenarios: no breach within {horizonHours} h
                  </span>
                )}
              </div>
            ) : (
              <div className="flex items-center gap-2 text-ink-2">
                <Info size={16} strokeWidth={1.5} className="text-ink-muted" />
                <span className="text-13 font-medium text-ink">
                  No sustained trend — no exhaustion forecast.
                </span>
              </div>
            )}

            {/* Context markers: Window reset & calibration note */}
            <div className="flex items-center gap-2">
              {window_reason?.startsWith('changepoint:') && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-11 font-medium bg-warn-weak text-warn border border-warn/20">
                  <AlertTriangle size={12} strokeWidth={1.5} />
                  <span>Window reset by regime change</span>
                </span>
              )}
              {calibration && calibration.widen_factor > 1 && (
                <span className="text-11 font-mono text-ink-muted">
                  Interval widened ×{calibration.widen_factor} from observed coverage
                </span>
              )}
            </div>
          </div>
        </div>

        {/* 2. Visual Chart OR Accessible Table View */}
        {viewAsTable ? (
          <div className="border border-border rounded-lg overflow-hidden">
            <DataTable
              data={chartData}
              columns={tableColumns}
              keyExtractor={(item) => item.ts}
            />
          </div>
        ) : (
          <div>
            {!hasTrend ? (
              <div className="p-8 text-center bg-surface border border-border rounded-lg text-ink-2 space-y-1">
                <TrendingUp size={24} strokeWidth={1.5} className="mx-auto text-ink-muted" />
                <p className="text-13 font-medium text-ink">No sustained trend — no exhaustion forecast</p>
                <p className="text-12 text-ink-muted">
                  The slope confidence interval contains zero. No exhaustion cone is calculated while rates are stable.
                </p>
              </div>
            ) : (
              <div className="h-72 w-full pt-2">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart
                    data={chartData}
                    margin={{ top: 12, right: 24, left: 0, bottom: 0 }}
                  >
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
                      interval="preserveStartEnd"
                    />

                    <YAxis
                      tick={{ fill: 'var(--ink-muted)', fontSize: 11 }}
                      tickLine={false}
                      axisLine={{ stroke: 'var(--border)' }}
                      domain={['auto', 'auto']}
                      unit={` ${unit}`}
                    />

                    {/* Tooltip styled as white panel card with 1px border */}
                    <Tooltip
                      content={({ active, payload, label }) => {
                        if (!active || !payload || payload.length === 0) return null;
                        return (
                          <div className="bg-surface p-3 border border-border rounded-lg shadow-panel text-12 space-y-1.5 z-20">
                            <div className="font-mono text-11 text-ink-muted">{label}</div>
                            {payload.map((entry, idx) => (
                              <div key={idx} className="flex items-center justify-between gap-4 font-mono">
                                <span className="text-ink-2">{entry.name}:</span>
                                <span className="font-semibold text-ink">
                                  {typeof entry.value === 'number' ? entry.value.toFixed(2) : entry.value} {unit}
                                </span>
                              </div>
                            ))}
                          </div>
                        );
                      }}
                    />

                    <Legend
                      verticalAlign="top"
                      align="right"
                      iconSize={8}
                      wrapperStyle={{ fontSize: '11px', paddingBottom: '8px' }}
                    />

                    {/* Limit Reference Line */}
                    {limit !== undefined && (
                      <ReferenceLine
                        y={limit}
                        stroke="var(--crit)"
                        strokeDasharray="4 4"
                        strokeWidth={1.5}
                        label={{
                          value: limit_source || `Limit (${limit}${unit})`,
                          position: 'top',
                          fill: 'var(--crit)',
                          fontSize: 11,
                          fontWeight: 500,
                        }}
                      />
                    )}

                    {/* Crossing-time window shading (P10 -> P90) */}
                    {crossingStartTs && crossingEndTs && (
                      <ReferenceArea
                        x1={crossingStartTs}
                        x2={crossingEndTs}
                        fill="var(--crit)"
                        fillOpacity={0.08}
                        stroke="var(--crit)"
                        strokeOpacity={0.2}
                      />
                    )}

                    {/* P10–P90 Range Area (Low opacity, single hue, not a rainbow) */}
                    <Area
                      type="monotone"
                      dataKey="p90"
                      name="P90 Upper"
                      stroke="none"
                      fill="var(--cat-1)"
                      fillOpacity={0.12}
                    />

                    {/* Measured History Line (solid, 2px) */}
                    <Line
                      type="monotone"
                      dataKey="measured"
                      name="Observed"
                      stroke="var(--cat-1)"
                      strokeWidth={2}
                      dot={false}
                      isAnimationActive={false}
                    />

                    {/* Median Forecast Line (dashed, 2px) */}
                    <Line
                      type="monotone"
                      dataKey="median"
                      name="Median Projection"
                      stroke="var(--cat-1)"
                      strokeWidth={2}
                      strokeDasharray="4 4"
                      dot={false}
                      isAnimationActive={false}
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        )}
      </div>
    </Card>
  );
};
