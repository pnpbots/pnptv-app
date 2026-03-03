import React from "react";

interface Column<T> {
  key: string;
  header: string;
  render?: (row: T) => React.ReactNode;
  className?: string;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  data: T[];
  loading?: boolean;
  onRowClick?: (row: T) => void;
  emptyMessage?: string;
  selectable?: boolean;
  selectedIds?: Set<string>;
  onSelectToggle?: (id: string) => void;
  onSelectAll?: () => void;
  getRowId?: (row: T) => string;
}

function SkeletonRow({ cols }: { cols: number }) {
  return (
    <tr>
      {Array.from({ length: cols }).map((_, i) => (
        <td key={i} className="px-4 py-3">
          <div className="h-4 bg-pnp-border rounded animate-pulse" />
        </td>
      ))}
    </tr>
  );
}

export function DataTable<T>({
  columns,
  data,
  loading,
  onRowClick,
  emptyMessage = "No data found",
  selectable,
  selectedIds,
  onSelectToggle,
  onSelectAll,
  getRowId,
}: DataTableProps<T>) {
  const allSelected = data.length > 0 && selectedIds && getRowId && data.every((r) => selectedIds.has(getRowId(r)));

  return (
    <div className="overflow-x-auto rounded-xl border border-pnp-border">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-pnp-border bg-pnp-surface/50">
            {selectable && (
              <th className="px-4 py-3 text-left w-10">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={onSelectAll}
                  className="rounded border-pnp-border"
                />
              </th>
            )}
            {columns.map((col) => (
              <th
                key={col.key}
                className={`px-4 py-3 text-left text-xs font-semibold text-pnp-textSecondary uppercase tracking-wider ${col.className || ""}`}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-pnp-border">
          {loading
            ? Array.from({ length: 5 }).map((_, i) => <SkeletonRow key={i} cols={columns.length + (selectable ? 1 : 0)} />)
            : data.length === 0
              ? (
                <tr>
                  <td colSpan={columns.length + (selectable ? 1 : 0)} className="px-4 py-8 text-center text-pnp-textSecondary">
                    {emptyMessage}
                  </td>
                </tr>
              )
              : data.map((row, idx) => {
                  const rowId = getRowId ? getRowId(row) : String(idx);
                  return (
                    <tr
                      key={rowId}
                      onClick={() => onRowClick?.(row)}
                      className={`${onRowClick ? "cursor-pointer hover:bg-pnp-surface/50" : ""} ${selectedIds?.has(rowId) ? "bg-pnp-accent/10" : ""}`}
                    >
                      {selectable && (
                        <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={selectedIds?.has(rowId) || false}
                            onChange={() => onSelectToggle?.(rowId)}
                            className="rounded border-pnp-border"
                          />
                        </td>
                      )}
                      {columns.map((col) => (
                        <td key={col.key} className={`px-4 py-3 text-pnp-textPrimary ${col.className || ""}`}>
                          {col.render ? col.render(row) : (row as Record<string, unknown>)[col.key] as React.ReactNode}
                        </td>
                      ))}
                    </tr>
                  );
                })}
        </tbody>
      </table>
    </div>
  );
}
