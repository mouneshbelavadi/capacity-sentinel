import React from 'react';

export interface Column<T> {
  key: string;
  header: string;
  align?: 'left' | 'center' | 'right';
  width?: string;
  render: (item: T, index: number) => React.ReactNode;
}

export interface DataTableProps<T> {
  columns: Column<T>[];
  data: T[];
  keyExtractor: (item: T, index: number) => string;
  selectedId?: string | null;
  onRowClick?: (item: T) => void;
  emptyState?: React.ReactNode;
  className?: string;
}

export function DataTable<T>({
  columns,
  data,
  keyExtractor,
  selectedId,
  onRowClick,
  emptyState,
  className = '',
}: DataTableProps<T>): React.ReactElement {
  if (data.length === 0 && emptyState) {
    return <div className="p-4">{emptyState}</div>;
  }

  return (
    <div className={`overflow-x-auto border border-border rounded-lg bg-surface ${className}`}>
      <table className="w-full text-left border-collapse">
        <thead>
          <tr className="h-9 bg-surface-sunken border-b border-border">
            {columns.map((col) => {
              const alignClass =
                col.align === 'right'
                  ? 'text-right'
                  : col.align === 'center'
                  ? 'text-center'
                  : 'text-left';

              return (
                <th
                  key={col.key}
                  style={col.width ? { width: col.width } : undefined}
                  className={`px-3 py-2 text-11 font-semibold text-ink-2 uppercase tracking-wider ${alignClass}`}
                >
                  {col.header}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody className="divide-y divide-border text-13">
          {data.map((item, index) => {
            const rowKey = keyExtractor(item, index);
            const isSelected = selectedId === rowKey;
            const isClickable = !!onRowClick;

            return (
              <tr
                key={rowKey}
                onClick={onRowClick ? () => onRowClick(item) : undefined}
                className={`h-9 transition-colors ${
                  isSelected
                    ? 'bg-primary-weak text-ink font-medium'
                    : isClickable
                    ? 'hover:bg-surface-hover cursor-pointer'
                    : ''
                }`}
                tabIndex={isClickable ? 0 : undefined}
                onKeyDown={
                  isClickable
                    ? (e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          onRowClick(item);
                        }
                      }
                    : undefined
                }
              >
                {columns.map((col) => {
                  const alignClass =
                    col.align === 'right'
                      ? 'text-right'
                      : col.align === 'center'
                      ? 'text-center'
                      : 'text-left';

                  return (
                    <td
                      key={col.key}
                      className={`px-3 py-1.5 whitespace-nowrap ${alignClass}`}
                    >
                      {col.render(item, index)}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
