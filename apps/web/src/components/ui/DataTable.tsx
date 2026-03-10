import { ReactNode, memo } from 'react';

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
      <div className="bg-white rounded-lg border p-8 text-center text-gray-500">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mx-auto mb-3"></div>
        กำลังโหลด...
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg border overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="bg-gray-50 border-b">
              {columns.map((col) => (
                <th
                  key={col.key}
                  className="px-5 py-3.5 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider"
                >
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {data.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="px-4 py-8 text-center text-gray-500">
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              data.map((item, idx) => (
                <tr key={item.id} className={`hover:bg-gray-50 transition-colors${onRowClick || onRowDoubleClick ? ' cursor-pointer' : ''}`} onClick={() => onRowClick?.(item)} onDoubleClick={() => onRowDoubleClick?.(item)}>
                  {columns.map((col) => (
                    <td key={col.key} className="px-5 py-3.5 text-sm text-gray-700">
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
        <div className="flex items-center justify-between px-4 py-3 border-t bg-gray-50">
          <span className="text-sm text-gray-600">
            ทั้งหมด {pagination.total.toLocaleString()} รายการ
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => pagination.onPageChange(pagination.page - 1)}
              disabled={pagination.page <= 1}
              className="px-3 py-1 text-sm border rounded-md hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              ก่อนหน้า
            </button>
            <span className="px-3 py-1 text-sm text-gray-600">
              {pagination.page} / {pagination.totalPages}
            </span>
            <button
              onClick={() => pagination.onPageChange(pagination.page + 1)}
              disabled={pagination.page >= pagination.totalPages}
              className="px-3 py-1 text-sm border rounded-md hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              ถัดไป
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default memo(DataTable) as typeof DataTable;
