import React from 'react';
import { Card } from '../../design/Card';
import { Value } from '../../design/Value';
import { Server, Cpu, Activity, Building2 } from 'lucide-react';

interface OverviewPanelProps {
  rackCount: number;
  nodesOnline: number;
  nodesTotal: number;
  sensorCount: number;
  tenantCount: number;
  isTenant?: boolean;
}

export const OverviewPanel: React.FC<OverviewPanelProps> = ({
  rackCount,
  nodesOnline,
  nodesTotal,
  sensorCount,
  tenantCount,
  isTenant = false,
}) => {
  return (
    <Card
      title="Overview"
      subtitle="Physical deployment topology"
      className="h-full"
      data-testid="overview-panel"
    >
      <div className="grid grid-cols-2 gap-2 text-12">
        {/* Racks Count */}
        <div className="p-2.5 rounded border border-border bg-surface-sunken flex flex-col justify-between">
          <div className="flex items-center gap-1.5 text-ink-2">
            <Server size={13} strokeWidth={1.5} className="text-primary shrink-0" />
            <span className="text-11 font-medium uppercase tracking-wider">Racks</span>
          </div>
          <div className="mt-1">
            <Value value={rackCount} size="md" />
          </div>
        </div>

        {/* Nodes Online / Total Ratio */}
        <div className="p-2.5 rounded border border-border bg-surface-sunken flex flex-col justify-between">
          <div className="flex items-center gap-1.5 text-ink-2">
            <Cpu size={13} strokeWidth={1.5} className="text-ok shrink-0" />
            <span className="text-11 font-medium uppercase tracking-wider">Nodes</span>
          </div>
          <div className="mt-1 flex items-baseline gap-1">
            <span className="font-mono font-bold text-16 text-ink tabular-nums">
              {nodesOnline}
            </span>
            <span className="text-11 font-mono text-ink-muted">/ {nodesTotal}</span>
          </div>
        </div>

        {/* Total Fitted Sensors */}
        <div className="p-2.5 rounded border border-border bg-surface-sunken flex flex-col justify-between">
          <div className="flex items-center gap-1.5 text-ink-2">
            <Activity size={13} strokeWidth={1.5} className="text-accent shrink-0" />
            <span className="text-11 font-medium uppercase tracking-wider">Sensors</span>
          </div>
          <div className="mt-1">
            <Value value={sensorCount} size="md" />
          </div>
        </div>

        {/* Tenants Count */}
        <div className="p-2.5 rounded border border-border bg-surface-sunken flex flex-col justify-between">
          <div className="flex items-center gap-1.5 text-ink-2">
            <Building2 size={13} strokeWidth={1.5} className="text-ink-2 shrink-0" />
            <span className="text-11 font-medium uppercase tracking-wider">Tenants</span>
          </div>
          <div className="mt-1">
            <Value value={isTenant ? 1 : tenantCount} size="md" />
          </div>
        </div>
      </div>
    </Card>
  );
};

