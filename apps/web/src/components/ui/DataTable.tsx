import { ReactNode } from 'react';

interface Column<T> {
  key: string;
  label: string;
  render?: (item: T) => ReactNode;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  data: T[];
  isLoading?: boolean;
  emptyMessage?: string;
  onRowClick?: (item: T) => void;
}

export default function DataTable<T extends { id: string }>({
  columns,
  data,
  isLoading,
  emptyMessage = 'ไม่พบข้อมูล',
  onRowClick,
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
                  className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider"
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
              data.map((item) => (
                <tr key={item.id} className={`hover:bg-gray-50 transition-colors${onRowClick ? ' cursor-pointer' : ''}`} onClick={() => onRowClick?.(item)}>
                  {columns.map((col) => (
                    <td key={col.key} className="px-4 py-3 text-sm text-gray-700">
                      {col.render
                        ? col.render(item)
                        : (item as Record<string, unknown>)[col.key]?.toString() || '-'}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
