import React, { useEffect } from 'react';
import { X } from 'lucide-react';

export interface DetailPanelProps {
  isOpen: boolean;
  onClose: () => void;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
}

export const DetailPanel: React.FC<DetailPanelProps> = ({
  isOpen,
  onClose,
  title,
  subtitle,
  children,
  footer,
  className = '',
}) => {
  // Close on Escape key
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <>
      {/* Mobile/Tablet Backdrop (below 1280px) */}
      <div
        className="fixed inset-0 bg-ink/20 z-40 xl:hidden transition-opacity"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Slide-in Panel (360px) */}
      <aside
        className={`fixed top-14 right-0 bottom-0 w-[360px] max-w-full bg-surface border-l border-border shadow-panel z-50 flex flex-col transition-transform duration-150 ease-out ${className}`}
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === 'string' ? title : 'Detail Panel'}
      >
        {/* Panel Header */}
        <div className="flex items-start justify-between p-4 border-b border-border">
          <div>
            <h2 className="text-14 font-semibold text-ink leading-snug">{title}</h2>
            {subtitle && <p className="text-12 text-ink-2 mt-0.5">{subtitle}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded text-ink-2 hover:text-ink hover:bg-surface-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
            aria-label="Close panel (Esc)"
          >
            <X size={18} strokeWidth={1.5} />
          </button>
        </div>

        {/* Panel Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">{children}</div>

        {/* Panel Footer */}
        {footer && (
          <div className="p-4 bg-surface-sunken border-t border-border">
            {footer}
          </div>
        )}
      </aside>
    </>
  );
};
