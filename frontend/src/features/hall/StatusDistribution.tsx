import React from 'react';
import { Status } from '../../api/contract';
import { Card } from '../../design/Card';
import { CheckCircle, AlertTriangle, AlertOctagon, MinusCircle, X } from 'lucide-react';

interface StatusDistributionProps {
  okCount: number;
  warnCount: number;
  critCount: number;
  offlineCount: number;
  selectedStatus: Status | null;
  onSelectStatus: (status: Status | null) => void;
}

export const StatusDistribution: React.FC<StatusDistributionProps> = ({
  okCount,
  warnCount,
  critCount,
  offlineCount,
  selectedStatus,
  onSelectStatus,
}) => {
  const total = okCount + warnCount + critCount + offlineCount;

  const statuses: Array<{
    status: Status;
    label: string;
    count: number;
    colorClass: string;
    bgClass: string;
    borderClass: string;
    icon: React.ComponentType<{ size?: number; className?: string; strokeWidth?: number }>;
  }> = [
    {
      status: 'OK',
      label: 'OK',
      count: okCount,
      colorClass: 'text-ok',
      bgClass: 'bg-ok-weak/40',
      borderClass: 'border-ok/30',
      icon: CheckCircle,
    },
    {
      status: 'WARN',
      label: 'WARN',
      count: warnCount,
      colorClass: 'text-warn',
      bgClass: 'bg-warn-weak/40',
      borderClass: 'border-warn/30',
      icon: AlertTriangle,
    },
    {
      status: 'CRIT',
      label: 'CRIT',
      count: critCount,
      colorClass: 'text-crit',
      bgClass: 'bg-crit-weak/40',
      borderClass: 'border-crit/30',
      icon: AlertOctagon,
    },
    {
      status: 'OFFLINE',
      label: 'OFFLINE',
      count: offlineCount,
      colorClass: 'text-offline',
      bgClass: 'bg-surface-sunken',
      borderClass: 'border-border',
      icon: MinusCircle,
    },
  ];

  return (
    <Card
      title="Status Distribution"
      subtitle="Click to filter 3D hall bays"
      className="h-full"
      data-testid="status-distribution"
      actions={
        selectedStatus ? (
          <button
            type="button"
            onClick={() => onSelectStatus(null)}
            className="flex items-center gap-1 text-10 font-medium text-primary hover:underline"
            title="Clear active status filter"
          >
            <span>Clear filter</span>
            <X size={11} strokeWidth={2} />
          </button>
        ) : undefined
      }
    >
      <div className="space-y-2.5">
        {/* Proportional Stacked Bar */}
        {total > 0 && (
          <div className="w-full h-2 rounded-full overflow-hidden flex bg-surface-sunken border border-border/60">
            {okCount > 0 && (
              <div
                className="bg-ok h-full transition-all"
                style={{ width: `${(okCount / total) * 100}%` }}
                title={`OK: ${okCount} slots`}
              />
            )}
            {warnCount > 0 && (
              <div
                className="bg-warn h-full transition-all"
                style={{ width: `${(warnCount / total) * 100}%` }}
                title={`WARN: ${warnCount} slots`}
              />
            )}
            {critCount > 0 && (
              <div
                className="bg-crit h-full transition-all"
                style={{ width: `${(critCount / total) * 100}%` }}
                title={`CRIT: ${critCount} slots`}
              />
            )}
            {offlineCount > 0 && (
              <div
                className="bg-offline h-full transition-all"
                style={{ width: `${(offlineCount / total) * 100}%` }}
                title={`OFFLINE: ${offlineCount} slots`}
              />
            )}
          </div>
        )}

        {/* 2x2 Grid of Status Buttons */}
        <div className="grid grid-cols-2 gap-1.5 text-11">
          {statuses.map((item) => {
            const Icon = item.icon;
            const isSelected = selectedStatus === item.status;
            return (
              <button
                key={item.status}
                type="button"
                onClick={() => onSelectStatus(isSelected ? null : item.status)}
                className={`p-2 rounded border flex items-center justify-between transition-colors text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary ${
                  isSelected
                    ? 'border-primary ring-1 ring-primary bg-primary-weak/50 shadow-xs'
                    : 'border-border bg-surface hover:bg-surface-hover'
                }`}
                aria-pressed={isSelected}
                aria-label={`Filter 3D hall by ${item.label} (${item.count} slots)`}
              >
                <div className="flex items-center gap-1.5">
                  <Icon size={13} strokeWidth={1.5} className={item.colorClass} />
                  <span className="font-semibold text-ink">{item.label}</span>
                </div>
                <span className="font-mono font-bold text-ink tabular-nums">{item.count}</span>
              </button>
            );
          })}
        </div>
      </div>
    </Card>
  );
};

