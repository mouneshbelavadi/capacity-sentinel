import React from 'react';

export interface ChipProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: 'neutral' | 'estimated' | 'inferred' | 'ai_generated';
  children: React.ReactNode;
}

export const Chip: React.FC<ChipProps> = ({
  variant = 'neutral',
  className = '',
  children,
  ...props
}) => {
  let variantStyles = 'bg-surface border-border text-ink-2';

  if (variant === 'estimated') {
    variantStyles = 'bg-surface-sunken border-border-strong text-ink-2';
  } else if (variant === 'inferred') {
    variantStyles = 'bg-surface-sunken border-border-strong text-ink-2 italic';
  } else if (variant === 'ai_generated') {
    variantStyles = 'bg-surface-sunken border-border-strong text-ink';
  }

  return (
    <span
      className={`inline-flex items-center px-1.5 py-0.5 rounded text-11 font-medium tracking-wider uppercase border ${variantStyles} ${className}`}
      {...props}
    >
      {children}
    </span>
  );
};
