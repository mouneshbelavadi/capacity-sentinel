import React, { useState } from 'react';
import { AttributionResponse, AttributionContributor } from '../../api/contract';
import { Card } from '../../design/Card';
import { Chip } from '../../design/Chip';
import { DataTable, Column } from '../../design/DataTable';
import { Table as TableIcon, BarChart2, ShieldCheck } from 'lucide-react';

export interface TenantAttributionChartProps {
  attribution: AttributionResponse;
  title?: string;
}

const CATEGORICAL_COLORS = [
  'var(--cat-1)',
  'var(--cat-2)',
  'var(--cat-3)',
  'var(--cat-4)',
  'var(--cat-5)',
];

export const TenantAttributionChart: React.FC<TenantAttributionChartProps> = ({
  attribution,
  title = 'Tenant Margin Attribution',
}) => {
  const [viewAsTable, setViewAsTable] = useState<boolean>(false);

  const contributors = attribution?.contributors || [];

  const tableColumns: Column<AttributionContributor>[] = [
    {
      key: 'tenant_label',
      header: 'Tenant Organization',
      render: (item) => (
        <div>
          <span className="font-semibold text-ink">{item.tenant_label}</span>
          <span className="text-11 font-mono text-ink-muted ml-2">({item.tenant_id})</span>
        </div>
      ),
    },
    {
      key: 'share',
      header: 'Attributed Share',
      align: 'right',
      render: (item) => (
        <span className="font-mono text-13 font-semibold text-ink tabular-nums">
          {Math.round(item.share * 100)}%
        </span>
      ),
    },
    {
      key: 'basis',
      header: 'Inferred Basis & Temporal Correlation',
      render: (item) => <span className="text-12 text-ink-2 italic">{item.basis}</span>,
    },
    {
      key: 'provenance',
      header: 'Provenance',
      render: () => <Chip variant="neutral">INFERRED</Chip>,
    },
  ];

  return (
    <Card
      title={title}
      actions={
        <div className="flex items-center gap-2">
          {/* Always render INFERRED badge on the panel per §4 */}
          <Chip variant="neutral">INFERRED</Chip>
          <button
            type="button"
            onClick={() => setViewAsTable(!viewAsTable)}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-11 font-medium bg-surface hover:bg-surface-hover text-ink-2 border border-border transition-colors"
            aria-label={viewAsTable ? 'Switch to bar visualization' : 'Switch to table view'}
          >
            {viewAsTable ? (
              <>
                <BarChart2 size={13} strokeWidth={1.5} />
                <span>View as bars</span>
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
        {/* Basis note on mathematical model */}
        <div className="text-12 text-ink-2 flex items-center gap-2 p-2.5 bg-surface-sunken border border-border rounded-lg">
          <ShieldCheck size={15} strokeWidth={1.5} className="text-primary flex-shrink-0" />
          <span>
            Attribution estimates thermal delta correlation across tenant start events. This is an{' '}
            <strong className="text-ink">inferred statistical correlation</strong>, never a direct physical measurement.
          </span>
        </div>

        {viewAsTable ? (
          <div className="border border-border rounded-lg overflow-hidden">
            <DataTable
              data={contributors}
              columns={tableColumns}
              keyExtractor={(item) => item.tenant_id}
            />
          </div>
        ) : (
          <div className="space-y-4 py-2">
            {contributors.length === 0 ? (
              <div className="p-6 text-center text-12 text-ink-muted bg-surface-sunken rounded border border-border">
                No active tenant contribution correlation detected.
              </div>
            ) : (
              contributors.map((contrib, idx) => {
                const color = CATEGORICAL_COLORS[idx % CATEGORICAL_COLORS.length];
                const pct = Math.round(contrib.share * 100);

                return (
                  <div key={contrib.tenant_id} className="space-y-1.5">
                    {/* Header: Tenant label and share percentage */}
                    <div className="flex items-center justify-between text-12">
                      <div className="flex items-center gap-2">
                        <span
                          className="w-2.5 h-2.5 rounded-full"
                          style={{ backgroundColor: color }}
                          aria-hidden="true"
                        />
                        <span className="font-medium text-ink">{contrib.tenant_label}</span>
                        <span className="font-mono text-11 text-ink-muted">
                          ({contrib.tenant_id})
                        </span>
                      </div>
                      <span className="font-mono font-semibold text-ink tabular-nums text-13">
                        {pct}%
                      </span>
                    </div>

                    {/* Horizontal Bar */}
                    <div
                      className="w-full h-3 bg-canvas rounded overflow-hidden border border-border"
                      role="progressbar"
                      aria-valuenow={pct}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-label={`${contrib.tenant_label} attributed share: ${pct}%`}
                    >
                      <div
                        className="h-full transition-all duration-300"
                        style={{
                          width: `${pct}%`,
                          backgroundColor: color,
                        }}
                      />
                    </div>

                    {/* ALWAYS render the basis string under the bars per §4 */}
                    <div className="text-11 text-ink-2 pl-4 italic leading-relaxed">
                      Basis: {contrib.basis}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>
    </Card>
  );
};
