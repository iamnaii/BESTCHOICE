import { CalendarDays } from 'lucide-react';
import DataTable, { type TableSort } from '@/components/ui/DataTable';
import { useIsMobile } from '@/hooks/useIsMobile';
import { BOOKING_PAGE_LIMIT } from '../hooks/useBookingsQuery';
import type { Booking } from '../types';
import { bookingColumns, type BookingRowActions } from './bookingColumns';
import { BookingCardList } from './BookingCardList';

export { BookingCardList };

/** DataTable รายงานการเรียงด้วย `col.key` แต่ API รู้จัก `createdAt`/`expireDate` — แปลงสองทางที่นี่ที่เดียว */
const COLUMN_TO_API: Record<string, string> = {
  bookingNumber: 'createdAt',
  expireDate: 'expireDate',
};
const API_TO_COLUMN: Record<string, string> = {
  createdAt: 'bookingNumber',
  expireDate: 'expireDate',
};
export const toApiSort = (s: TableSort | null): TableSort | null =>
  s ? { ...s, key: COLUMN_TO_API[s.key] ?? s.key } : null;
export const toColumnSort = (s: TableSort | null): TableSort | null =>
  s ? { ...s, key: API_TO_COLUMN[s.key] ?? s.key } : null;

export default function BookingTable({
  rows,
  total,
  page,
  onPageChange,
  sort,
  onSortChange,
  isLoading,
  nowMs,
  actions,
  hasActiveFilters,
  onClearFilters,
}: {
  rows: Booking[];
  total: number;
  page: number;
  onPageChange: (page: number) => void;
  sort: TableSort | null;
  onSortChange: (sort: TableSort | null) => void;
  isLoading: boolean;
  nowMs: number;
  actions: BookingRowActions;
  hasActiveFilters: boolean;
  onClearFilters: () => void;
}) {
  const isMobile = useIsMobile();
  if (isMobile) return <BookingCardList rows={rows} nowMs={nowMs} onOpen={actions.onOpen} />;
  return (
    <DataTable<Booking>
      columns={bookingColumns(nowMs, actions)}
      data={rows}
      isLoading={isLoading}
      density="dense"
      minWidth="1120px"
      sort={toColumnSort(sort)}
      onSortChange={(next) => onSortChange(toApiSort(next))}
      onRowClick={actions.onOpen}
      emptyIcon={CalendarDays}
      emptyMessage={hasActiveFilters ? 'ไม่พบใบจองตามตัวกรอง' : 'ยังไม่มีใบจองที่เปิดอยู่'}
      emptyDescription={
        hasActiveFilters
          ? 'ลองล้างตัวกรองหรือค้นด้วยเลขที่/ชื่อ/เบอร์โทร'
          : 'ใบที่ปิดแล้วดูได้จากการ์ด “ปิดแล้ว”'
      }
      emptyActionLabel={hasActiveFilters ? 'ล้างตัวกรอง' : undefined}
      onEmptyAction={hasActiveFilters ? onClearFilters : undefined}
      pagination={{
        page,
        totalPages: Math.max(1, Math.ceil(total / BOOKING_PAGE_LIMIT)),
        total,
        onPageChange,
      }}
    />
  );
}
