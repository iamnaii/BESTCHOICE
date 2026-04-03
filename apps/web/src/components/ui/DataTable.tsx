import { ReactNode, memo, useMemo, useState, useCallback } from 'react';
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  flexRender,
  createColumnHelper,
  type SortingState,
  type ColumnDef,
  type RowSelectionState,
  type VisibilityState,
} from '@tanstack/react-table';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  ChevronLeft,
  ChevronRight,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Search,
  Columns3,
  Check,
  ChevronsLeft,
  ChevronsRight,
  Inbox,
} from 'lucide-react';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';

export interface Column<T> {
  key: string;
  label: string;
  sortable?: boolean;
  hideable?: boolean;
  render?: (item: T, col: Column<T>, index: number) => ReactNode;
}

interface PaginationInfo {
  page: number;
  totalPages: number;
  total: number;
  onPageChange: (page: number) => void;
}

interface BulkAction<T> {
  label: string;
  icon?: ReactNode;
  variant?: 'primary' | 'destructive' | 'outline';
  onAction: (selectedItems: T[]) => void;
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
  /** Enable row selection checkboxes */
  selectable?: boolean;
  /** Bulk actions shown when rows are selected */
  bulkActions?: BulkAction<T>[];
  /** Show column visibility toggle */
  columnToggle?: boolean;
  /** Toolbar content (rendered between search and column toggle) */
  toolbar?: ReactNode;
  /** Density: compact (py-2), default (py-3), spacious (py-4) */
  density?: 'compact' | 'default' | 'spacious';
}

const densityPadding = {
  compact: 'py-2',
  default: 'py-3',
  spacious: 'py-4',
};

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
  selectable = false,
  bulkActions,
  columnToggle = false,
  toolbar,
  density = 'default',
}: DataTableProps<T>) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [globalFilter, setGlobalFilter] = useState('');
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});

  const tanstackColumns = useMemo<ColumnDef<T, unknown>[]>(() => {
    const helper = createColumnHelper<T>();
    const cols: ColumnDef<T, unknown>[] = [];

    // Selection checkbox column
    if (selectable) {
      cols.push({
        id: '_select',
        header: ({ table }) => (
          <input
            type="checkbox"
            className="size-4 rounded border-border accent-primary cursor-pointer"
            checked={table.getIsAllPageRowsSelected()}
            onChange={table.getToggleAllPageRowsSelectedHandler()}
            aria-label="เลือกทั้งหมด"
          />
        ),
        cell: ({ row }) => (
          <input
            type="checkbox"
            className="size-4 rounded border-border accent-primary cursor-pointer"
            checked={row.getIsSelected()}
            onChange={row.getToggleSelectedHandler()}
            onClick={(e) => e.stopPropagation()}
            aria-label={`เลือกแถว ${row.index + 1}`}
          />
        ),
        enableSorting: false,
        size: 40,
      });
    }

    // Data columns
    columns.forEach((col) => {
      cols.push(
        helper.accessor(
          (row) => (row as Record<string, unknown>)[col.key],
          {
            id: col.key,
            header: col.label,
            enableSorting: col.sortable !== false && !col.render,
            enableHiding: col.hideable !== false,
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
    });

    return cols;
  }, [columns, selectable]);

  const table = useReactTable({
    data,
    columns: tanstackColumns,
    state: {
      sorting,
      globalFilter: searchable ? globalFilter : undefined,
      rowSelection: selectable ? rowSelection : {},
      columnVisibility,
    },
    enableRowSelection: selectable,
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    onRowSelectionChange: selectable ? setRowSelection : undefined,
    onColumnVisibilityChange: setColumnVisibility,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: (searchable) ? getFilteredRowModel() : undefined,
    globalFilterFn: 'includesString',
    getRowId: (row) => row.id,
  });

  const selectedRows = useMemo(() => {
    if (!selectable) return [];
    return table.getSelectedRowModel().rows.map((r) => r.original);
  }, [selectable, table, rowSelection]);

  const clearSelection = useCallback(() => setRowSelection({}), []);

  const cellPadding = densityPadding[density];

  if (isLoading) {
    return (
      <div className="bg-card rounded-xl border border-border overflow-hidden shadow-card" role="status" aria-label="กำลังโหลดข้อมูล">
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
  const hasToolbar = searchable || columnToggle || toolbar || (selectable && selectedRows.length > 0);

  return (
    <div className="bg-card rounded-xl border border-border overflow-hidden shadow-card">
      {/* Toolbar */}
      {hasToolbar && (
        <div className="flex items-center justify-between gap-3 flex-wrap px-5 py-3 border-b border-border">
          <div className="flex items-center gap-3 flex-1 min-w-0">
            {/* Search */}
            {searchable && (
              <div className="relative max-w-sm">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder={searchPlaceholder}
                  value={globalFilter}
                  onChange={(e) => setGlobalFilter(e.target.value)}
                  className="pl-9 h-9"
                />
              </div>
            )}

            {/* Custom toolbar content */}
            {toolbar}

            {/* Bulk actions bar */}
            {selectable && selectedRows.length > 0 && (
              <div className="flex items-center gap-2 ml-auto">
                <span className="text-2sm text-muted-foreground font-medium">
                  เลือก {selectedRows.length} รายการ
                </span>
                {bulkActions?.map((action) => (
                  <Button
                    key={action.label}
                    variant={action.variant === 'destructive' ? 'destructive' : action.variant === 'primary' ? 'primary' : 'outline'}
                    size="sm"
                    onClick={() => {
                      action.onAction(selectedRows);
                      clearSelection();
                    }}
                  >
                    {action.icon}
                    {action.label}
                  </Button>
                ))}
                <Button variant="ghost" size="sm" onClick={clearSelection}>
                  ยกเลิก
                </Button>
              </div>
            )}
          </div>

          {/* Column visibility toggle */}
          {columnToggle && (
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="gap-1.5">
                  <Columns3 className="size-3.5" />
                  คอลัมน์
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-52 p-2">
                <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-2 py-1.5 mb-1">
                  แสดง/ซ่อนคอลัมน์
                </div>
                {table.getAllLeafColumns()
                  .filter((col) => col.id !== '_select' && col.getCanHide())
                  .map((col) => (
                    <button
                      key={col.id}
                      onClick={() => col.toggleVisibility()}
                      className={cn(
                        'flex items-center gap-2 w-full px-2 py-1.5 rounded-md text-sm transition-colors',
                        col.getIsVisible()
                          ? 'text-foreground hover:bg-muted'
                          : 'text-muted-foreground hover:bg-muted',
                      )}
                    >
                      <div className={cn(
                        'size-4 rounded border flex items-center justify-center',
                        col.getIsVisible()
                          ? 'bg-primary border-primary text-white'
                          : 'border-border',
                      )}>
                        {col.getIsVisible() && <Check className="size-3" />}
                      </div>
                      {typeof col.columnDef.header === 'string'
                        ? col.columnDef.header
                        : columns.find((c) => c.key === col.id)?.label || col.id}
                    </button>
                  ))}
              </PopoverContent>
            </Popover>
          )}
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px]">
          <thead>
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id} className="bg-muted/50 border-b border-border">
                {headerGroup.headers.map((header) => {
                  const canSort = header.column.getCanSort();
                  const sorted = header.column.getIsSorted();
                  const isSelect = header.id === '_select';
                  return (
                    <th
                      key={header.id}
                      className={cn(
                        'px-5 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider',
                        canSort && 'cursor-pointer select-none hover:text-foreground transition-colors',
                        isSelect && 'w-10 px-3',
                      )}
                      onClick={canSort ? header.column.getToggleSortingHandler() : undefined}
                    >
                      {header.isPlaceholder ? null : (
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
                      )}
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody className="divide-y divide-border">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={table.getVisibleLeafColumns().length} className="px-5 py-16 text-center">
                  <div className="flex flex-col items-center gap-3">
                    <div className="size-12 rounded-2xl bg-muted flex items-center justify-center">
                      <Inbox className="size-6 text-muted-foreground/50" />
                    </div>
                    <div className="text-sm font-medium text-muted-foreground">{emptyMessage}</div>
                  </div>
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr
                  key={row.id}
                  className={cn(
                    'transition-colors hover:bg-muted/50',
                    (onRowClick || onRowDoubleClick) && 'cursor-pointer',
                    row.getIsSelected() && 'bg-primary/5',
                  )}
                  onClick={() => onRowClick?.(row.original)}
                  onDoubleClick={() => onRowDoubleClick?.(row.original)}
                >
                  {row.getVisibleCells().map((cell) => (
                    <td
                      key={cell.id}
                      className={cn(
                        'px-5 text-sm text-foreground',
                        cellPadding,
                        cell.column.id === '_select' && 'w-10 px-3',
                      )}
                    >
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination — enhanced */}
      {pagination && pagination.totalPages > 1 && (
        <div className="flex items-center justify-between px-5 py-3 border-t border-border bg-muted/30">
          <span className="text-sm text-muted-foreground">
            ทั้งหมด {pagination.total.toLocaleString()} รายการ
          </span>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              mode="icon"
              onClick={() => pagination.onPageChange(1)}
              disabled={pagination.page <= 1}
              aria-label="หน้าแรก"
            >
              <ChevronsLeft className="h-3.5 w-3.5" />
            </Button>
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
            <Button
              variant="ghost"
              size="sm"
              mode="icon"
              onClick={() => pagination.onPageChange(pagination.totalPages)}
              disabled={pagination.page >= pagination.totalPages}
              aria-label="หน้าสุดท้าย"
            >
              <ChevronsRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

export default memo(DataTable) as typeof DataTable;
