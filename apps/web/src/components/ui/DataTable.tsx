import { ReactNode, memo } from 'react';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { ChevronLeft, ChevronRight } from 'lucide-react';

interface Column<T> {
  key: string;
  label: string;
  render?: (item: T, col: Column<T>, index: number) => ReactNode;
}

interface PaginationInfo {
  page: number;
  totalPages: number;
  total: number;
  onPageChange: (page: number) => void;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  data: T[];
  isLoading?: boolean;
  emptyMessage?: string;
  onRowClick?: (item: T) => void;
  onRowDoubleClick?: (item: T) => void;
  pagination?: PaginationInfo;
}

function DataTable<T extends { id: string }>({
  columns,
  data,
  isLoading,
  emptyMessage = 'ไม่พบข้อมูล',
  onRowClick,
  onRowDoubleClick,
  pagination,
}: DataTableProps<T>) {
  if (isLoading) {
    return (
      <div className="bg-card rounded-lg border border-border overflow-hidden">
        <div className="p-1">
          <div className="space-y-0">
            {/* Header skeleton */}
            <div className="flex gap-4 px-5 py-3.5 bg-muted/50">
              {columns.map((col) => (
                <Skeleton key={col.key} className="h-3 flex-1 rounded" />
              ))}
            </div>
            {/* Row skeletons */}
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="flex gap-4 px-5 py-3.5 border-t border-border">
                {columns.map((col) => (
                  <Skeleton key={col.key} className="h-4 flex-1 rounded" />
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-card rounded-lg border border-border overflow-hidden shadow-sm">
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="bg-muted/50 border-b border-border">
              {columns.map((col) => (
                <th
                  key={col.key}
                  className="px-5 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider"
                >
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {data.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="px-5 py-10 text-center text-muted-foreground text-sm">
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              data.map((item, idx) => (
                <tr
                  key={item.id}
                  className={cn(
                    'transition-colors hover:bg-muted/50',
                    (onRowClick || onRowDoubleClick) && 'cursor-pointer',
                  )}
                  onClick={() => onRowClick?.(item)}
                  onDoubleClick={() => onRowDoubleClick?.(item)}
                >
                  {columns.map((col) => (
                    <td key={col.key} className="px-5 py-3 text-sm text-foreground">
                      {col.render
                        ? col.render(item, col, idx)
                        : (item as Record<string, unknown>)[col.key]?.toString() || '-'}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {pagination && pagination.totalPages > 1 && (
        <div className="flex items-center justify-between px-5 py-3 border-t border-border bg-muted/30">
          <span className="text-sm text-muted-foreground">
            ทั้งหมด {pagination.total.toLocaleString()} รายการ
          </span>
          <div className="flex items-center gap-1.5">
            <Button
              variant="outline"
              size="sm"
              onClick={() => pagination.onPageChange(pagination.page - 1)}
              disabled={pagination.page <= 1}
            >
              <ChevronLeft className="h-3.5 w-3.5 mr-1" />
              ก่อนหน้า
            </Button>
            <span className="px-3 py-1 text-sm text-muted-foreground tabular-nums">
              {pagination.page} / {pagination.totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => pagination.onPageChange(pagination.page + 1)}
              disabled={pagination.page >= pagination.totalPages}
            >
              ถัดไป
              <ChevronRight className="h-3.5 w-3.5 ml-1" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

export default memo(DataTable) as typeof DataTable;
