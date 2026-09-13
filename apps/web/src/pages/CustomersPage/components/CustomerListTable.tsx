import { Search, Users } from 'lucide-react';
import DataTable, { type Column, type TableSort } from '@/components/ui/DataTable';
import QueryBoundary from '@/components/QueryBoundary';
import { customerTableMinWidth } from './CustomerCells';

/**
 * `<DataTable>` ใบเดียวของหน้านี้ — ลอกการเรียกที่เจ้าของเคาะมาจาก `StockListTab.tsx:556-581`
 * รวมทั้ง `[&_th]:normal-case` ที่ทำให้หัวคอลัมน์เลิกตะโกน
 *
 * `isLoading={false}` ที่ `QueryBoundary` — ตัวตารางมี skeleton ในตัวอยู่แล้ว ถ้าปล่อยให้
 * boundary ถือสถานะโหลด toolbar กับตำแหน่งเลื่อนจะกระพริบทุกครั้งที่เรียงใหม่
 *
 * `key={view}` บังคับให้ remount เมื่อสลับแท็บ — สองแท็บมีคอลัมน์คนละชุด และ
 * `columnVisibility` ของ DataTable ถูก seed จาก `defaultHidden` ครั้งเดียวตอน mount
 */
export default function CustomerListTable<T extends { id: string }>({
  view,
  columns,
  rows,
  isLoading,
  isError,
  error,
  onRetry,
  sort,
  onSortChange,
  onRowClick,
  emptyMessage,
  hasFilters,
  onClearFilters,
  summaryNode,
  pagination,
}: {
  view: string;
  columns: Column<T>[];
  rows: T[];
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  onRetry: () => void;
  sort: TableSort | null;
  onSortChange: (sort: TableSort | null) => void;
  onRowClick: (row: T) => void;
  emptyMessage: string;
  hasFilters: boolean;
  /** ปุ่มในหน้าจอว่าง — คำอธิบายพูดถึง "ล้างตัวกรอง" จึงต้องมีปุ่มนั้นจริง */
  onClearFilters: () => void;
  summaryNode?: React.ReactNode;
  pagination?: { page: number; totalPages: number; total: number; onPageChange: (p: number) => void };
}) {
  return (
    <QueryBoundary
      isLoading={false}
      isError={isError}
      error={error}
      onRetry={onRetry}
      errorTitle="ไม่สามารถโหลดรายชื่อได้"
    >
      <DataTable
        key={view}
        className="rounded-none border-0 shadow-none [&_th]:normal-case [&_th]:tracking-normal [&_th]:text-foreground/75"
        maxHeight="max(280px, calc(100dvh - 360px))"
        columns={columns}
        sort={sort}
        onSortChange={onSortChange}
        data={rows}
        isLoading={isLoading}
        emptyMessage={emptyMessage}
        emptyIcon={hasFilters ? Search : Users}
        emptyDescription={hasFilters ? 'ลองเปลี่ยนคำค้นหาหรือล้างตัวกรอง' : undefined}
        emptyActionLabel={hasFilters ? 'ล้างตัวกรอง' : undefined}
        onEmptyAction={hasFilters ? onClearFilters : undefined}
        columnToggle
        density="dense"
        minWidth={`${customerTableMinWidth(columns)}px`}
        onRowClick={onRowClick}
        toolbar={summaryNode}
        pagination={pagination}
      />
    </QueryBoundary>
  );
}
