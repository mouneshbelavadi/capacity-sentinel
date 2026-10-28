import React from 'react';
import {
  CheckCircle2,
  AlertTriangle,
  AlertOctagon,
  MinusCircle,
  HelpCircle,
} from 'lucide-react';
import { Status } from '../api/contract';

export interface StatusBadgeProps {
  status: Status;
  size?: 'sm' | 'md';
  className?: string;
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({
  status,
  size = 'md',
  className = '',
}) => {
  const iconSize = size === 'sm' ? 14 : 16;
  const strokeWidth = 1.5;

  let label = 'OK';
  let colorClasses = 'text-ok bg-ok-weak border-ok/20';
  let IconComponent = CheckCircle2;

  switch (status) {
    case 'OK':
      label = 'OK';
      colorClasses = 'text-ok bg-ok-weak border-ok/30';
      IconComponent = CheckCircle2;
      break;
    case 'WARN':
      label = 'WARN';
      colorClasses = 'text-warn bg-warn-weak border-warn/30';
      IconComponent = AlertTriangle;
      break;
    case 'CRIT':
      label = 'CRIT';
      colorClasses = 'text-crit bg-crit-weak border-crit/30';
      IconComponent = AlertOctagon;
      break;
    case 'OFFLINE':
      label = 'OFFLINE';
      colorClasses = 'text-offline bg-surface-sunken border-border';
      IconComponent = MinusCircle;
      break;
    case 'UNKNOWN':
    default:
      label = 'UNKNOWN';
      colorClasses = 'text-ink-muted bg-surface-sunken border-border';
      IconComponent = HelpCircle;
      break;
  }

  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded border text-11 font-medium tabular-nums ${colorClasses} ${className}`}
      role="status"
      aria-label={`Status: ${label}`}
    >
      <IconComponent size={iconSize} strokeWidth={strokeWidth} aria-hidden="true" />
      <span>{label}</span>
    </span>
  );
};
