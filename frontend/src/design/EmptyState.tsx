import React from 'react';
import { LucideIcon, Inbox } from 'lucide-react';

export interface EmptyStateProps {
  title: string;
  description: string;
  icon?: LucideIcon;
  action?: React.ReactNode;
  className?: string;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  title,
  description,
  icon: Icon = Inbox,
  action,
  className = '',
}) => {
  return (
    <div
      className={`flex flex-col items-center justify-center p-8 text-center bg-surface border border-border border-dashed rounded-lg ${className}`}
      role="status"
    >
      <div className="w-10 h-10 rounded-full bg-surface-sunken flex items-center justify-center text-ink-2 mb-3">
        <Icon size={24} strokeWidth={1.5} aria-hidden="true" />
      </div>
      <h4 className="text-14 font-medium text-ink">{title}</h4>
      <p className="text-12 text-ink-2 max-w-sm mt-1 leading-relaxed">
        {description}
      </p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
};
