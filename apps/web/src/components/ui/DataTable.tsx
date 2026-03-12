import { ReactNode, memo, useMemo, useState } from 'react';
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  flexRender,
  createColumnHelper,
  type SortingState,
  type ColumnDef,
} from '@tanstack/react-table';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ChevronLeft, ChevronRight, ArrowUpDown, ArrowUp, ArrowDown, Search } from 'lucide-react';

interface Column<T> {
  key: string;
  label: string;
  sortable?: boolean;
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
  searchable?: boolean;
  searchPlaceholder?: string;
}

function DataTable<T extends { id: string }>({
  columns,
  data,
  isLoading,
  emptyMessage = 'ไม่พบข้อมูล',
  onRowClick,
  onRowDoubleClick,
  pagination,
  searchable = false,
  searchPlaceholder = 'ค้นหา...',
}: DataTableProps<T>) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [globalFilter, setGlobalFilter] = useState('');

  const tanstackColumns = useMemo<ColumnDef<T, unknown>[]>(() => {
    const helper = createColumnHelper<T>();
    return columns.map((col) =>
      helper.accessor(
        (row) => (row as Record<string, unknown>)[col.key],
        {
          id: col.key,
          header: col.label,
          enableSorting: col.sortable !== false && !col.render,
          cell: (info) => {
            if (col.render) {
              return col.render(info.row.original, col, info.row.index);
            }
            const val = info.getValue();
            return val != null ? String(val) : '-';
          },
        },
      ),
    );
  }, [columns]);

  const table = useReactTable({
    data,
    columns: tanstackColumns,
    state: {
      sorting,
      globalFilter: searchable ? globalFilter : undefined,
    },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: searchable ? getFilteredRowModel() : undefined,
    globalFilterFn: 'includesString',
  });

  if (isLoading) {
    return (
      <div className="bg-card rounded-lg border border-border overflow-hidden">
        <div className="p-1">
          <div className="space-y-0">
            <div className="flex gap-4 px-5 py-3.5 bg-muted/50">
              {columns.map((col) => (
                <Skeleton key={col.key} className="h-3 flex-1 rounded" />
              ))}
            </div>
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

  const rows = table.getRowModel().rows;

  return (
    <div className="bg-card rounded-lg border border-border overflow-hidden shadow-sm">
      {/* Search bar */}
      {searchable && (
        <div className="px-5 py-3 border-b border-border">
          <div className="relative max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder={searchPlaceholder}
              value={globalFilter}
              onChange={(e) => setGlobalFilter(e.target.value)}
              className="pl-9 h-9"
            />
          </div>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id} className="bg-muted/50 border-b border-border">
                {headerGroup.headers.map((header) => {
                  const canSort = header.column.getCanSort();
                  const sorted = header.column.getIsSorted();
                  return (
                    <th
                      key={header.id}
                      className={cn(
                        'px-5 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider',
                        canSort && 'cursor-pointer select-none hover:text-foreground transition-colors',
                      )}
                      onClick={canSort ? header.column.getToggleSortingHandler() : undefined}
                    >
                      <div className="flex items-center gap-1.5">
                        {flexRender(header.column.columnDef.header, header.getContext())}
                        {canSort && (
                          <span className="inline-flex">
                            {sorted === 'asc' ? (
                              <ArrowUp className="h-3.5 w-3.5 text-primary" />
                            ) : sorted === 'desc' ? (
                              <ArrowDown className="h-3.5 w-3.5 text-primary" />
                            ) : (
                              <ArrowUpDown className="h-3.5 w-3.5 opacity-30" />
                            )}
                          </span>
                        )}
                      </div>
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody className="divide-y divide-border">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="px-5 py-10 text-center text-muted-foreground text-sm">
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr
                  key={row.id}
                  className={cn(
                    'transition-colors hover:bg-muted/50',
                    (onRowClick || onRowDoubleClick) && 'cursor-pointer',
                  )}
                  onClick={() => onRowClick?.(row.original)}
                  onDoubleClick={() => onRowDoubleClick?.(row.original)}
                >
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id} className="px-5 py-3 text-sm text-foreground">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
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
