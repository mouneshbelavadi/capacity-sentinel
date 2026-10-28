import React from 'react';

export interface CardProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title'> {
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  footer?: React.ReactNode;
  children: React.ReactNode;
  padding?: 'none' | 'sm' | 'md' | 'lg';
}

export const Card: React.FC<CardProps> = ({
  title,
  subtitle,
  actions,
  footer,
  children,
  padding = 'md',
  className = '',
  ...props
}) => {
  let paddingStyles = 'p-4';
  if (padding === 'none') paddingStyles = 'p-0';
  if (padding === 'sm') paddingStyles = 'p-3';
  if (padding === 'lg') paddingStyles = 'p-5';

  return (
    <div
      className={`bg-surface border border-border rounded-lg shadow-card ${className}`}
      {...props}
    >
      {(title || actions || subtitle) && (
        <div className="flex items-start justify-between gap-4 px-4 py-3 border-b border-border">
          <div>
            {title && (
              <h3 className="text-14 font-semibold text-ink leading-snug">
                {title}
              </h3>
            )}
            {subtitle && (
              <p className="text-12 text-ink-2 mt-0.5">{subtitle}</p>
            )}
          </div>
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </div>
      )}

      <div className={paddingStyles}>{children}</div>

      {footer && (
        <div className="px-4 py-3 bg-surface-sunken border-t border-border rounded-b-lg">
          {footer}
        </div>
      )}
    </div>
  );
};
