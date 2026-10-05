import { Badge, BadgeDot } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { BOOKING_PAGE_LIMIT } from '../hooks/useBookingsQuery';
import type { Booking } from '../types';
import { fmtMoneyShort, isOpenStatus, STATUS_LABEL, STATUS_VARIANT } from '../utils';
import { ExpiryCell } from './bookingColumns';

/** จอ < 1024px: การ์ดแทนตาราง 9 คอลัมน์ (mockup 2B) */
export function BookingCardList({
  rows,
  nowMs,
  onOpen,
  isLoading,
  total,
  page,
  onPageChange,
  hasActiveFilters,
  onClearFilters,
}: {
  rows: Booking[];
  nowMs: number;
  onOpen: (b: Booking) => void;
  isLoading: boolean;
  total: number;
  page: number;
  onPageChange: (page: number) => void;
  hasActiveFilters: boolean;
  onClearFilters: () => void;
}) {
  if (isLoading && rows.length === 0) {
    return (
      <div className="flex flex-col gap-2.5 p-3" aria-busy="true">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-28 w-full rounded-xl" />
        ))}
      </div>
    );
  }
  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 py-10">
        <p className="text-center text-sm leading-snug text-muted-foreground">ไม่พบใบจอง</p>
        {hasActiveFilters && (
          <Button variant="outline" onClick={onClearFilters}>
            ล้างตัวกรอง
          </Button>
        )}
      </div>
    );
  }
  const totalPages = Math.max(1, Math.ceil(total / BOOKING_PAGE_LIMIT));
  return (
    <>
      <ul className="flex flex-col gap-2.5 p-3">
        {rows.map((b) => {
          const item = b.items[0];
          const balance = Number(b.totalAmount) - Number(b.depositAmount);
          return (
            <li key={b.id}>
              <button
                type="button"
                onClick={() => onOpen(b)}
                aria-label={`เปิดใบจอง ${b.bookingNumber}`}
                className="flex w-full flex-col gap-1.5 rounded-xl border border-border bg-card px-3.5 py-3 text-left shadow-card"
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="font-mono text-xs text-muted-foreground">{b.bookingNumber}</span>
                  <Badge variant={STATUS_VARIANT[b.status]} className="gap-1.5">
                    <BadgeDot />
                    {STATUS_LABEL[b.status]}
                  </Badge>
                </span>
                <span className="flex items-baseline justify-between gap-2">
                  <span className="text-[15px] font-semibold leading-snug">{b.customer.name}</span>
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {b.customer.phone ?? ''}
                  </span>
                </span>
                <span className="truncate text-sm leading-snug">{item?.description ?? '—'}</span>
                <span className="flex items-center justify-between gap-2 text-sm tabular-nums">
                  <span>
                    <span className="text-muted-foreground">มัดจำ </span>
                    <span className="font-medium">{fmtMoneyShort(b.depositAmount)}</span>
                    {isOpenStatus(b.status) && (
                      <>
                        <span className="text-muted-foreground"> · คงเหลือ </span>
                        <span className="font-medium">{fmtMoneyShort(balance)}</span>
                      </>
                    )}
                  </span>
                  <ExpiryCell booking={b} nowMs={nowMs} />
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {totalPages > 1 && (
        <div className="flex items-center justify-between gap-2 px-3 pb-3">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1}
            aria-label="ก่อนหน้า"
            onClick={() => onPageChange(page - 1)}
          >
            ก่อนหน้า
          </Button>
          <span className="text-sm tabular-nums text-muted-foreground">
            หน้า {page}/{totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= totalPages}
            aria-label="ถัดไป"
            onClick={() => onPageChange(page + 1)}
          >
            ถัดไป
          </Button>
        </div>
      )}
    </>
  );
}
