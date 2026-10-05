import { Ban, Clock, ExternalLink, HandCoins, MoreHorizontal } from 'lucide-react';
import type { Column } from '@/components/ui/DataTable';
import { Badge, BadgeDot } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import type { Booking } from '../types';
import {
  describeExpiry,
  fmtMoneyShort,
  formatCreated,
  isOpenStatus,
  STATUS_LABEL,
  STATUS_VARIANT,
} from '../utils';

export interface BookingRowActions {
  onOpen: (b: Booking) => void;
  onCollectDeposit: (b: Booking) => void;
  onCancel: (b: Booking) => void;
  canMutate: boolean;
}

/** รวม 1,120 px = งบตารางโซน shop บนจอ 1440 (เมนูซ้าย 292 + ขอบ 28) — ห้ามซ่อนคอลัมน์ บีบให้พอดีเท่านั้น */
export const BOOKING_COLUMN_WIDTHS = {
  number: 136,
  customer: 190,
  product: 236,
  branch: 92,
  deposit: 108,
  balance: 100,
  status: 118,
  expiry: 96,
  menu: 44,
} as const;
const px = (n: number) => `${n}px`;

const TONE_CLASS = {
  normal: 'text-foreground',
  soon: 'text-warning-strong font-medium',
  today: 'text-warning-strong font-semibold',
  overdue: 'text-destructive font-semibold',
  closed: 'text-muted-foreground',
} as const;

export function ExpiryCell({ booking, nowMs }: { booking: Booking; nowMs: number }) {
  const info = describeExpiry(booking, nowMs);
  return (
    <span className="block min-w-0 leading-snug">
      <span className={cn('inline-flex items-center gap-1', TONE_CLASS[info.tone])}>
        {(info.tone === 'soon' || info.tone === 'today' || info.tone === 'overdue') && (
          <Clock aria-hidden="true" className="size-3.5" />
        )}
        {info.label}
      </span>
      {info.sub && (
        <span className="block truncate text-[11px] text-muted-foreground">{info.sub}</span>
      )}
    </span>
  );
}

const balanceOf = (b: Booking) => Number(b.totalAmount) - Number(b.depositAmount);

export function bookingColumns(nowMs: number, actions: BookingRowActions): Column<Booking>[] {
  return [
    {
      key: 'bookingNumber',
      label: 'เลขที่ / สร้างเมื่อ',
      sortable: true,
      sortKey: 'createdAt',
      width: px(BOOKING_COLUMN_WIDTHS.number),
      className: 'pl-4',
      headerClassName: 'pl-4',
      render: (b) => (
        <div className="leading-snug">
          <span className="font-mono text-xs">{b.bookingNumber}</span>
          <span className="block text-[11px] text-muted-foreground">
            {formatCreated(b.createdAt)}
          </span>
        </div>
      ),
    },
    {
      key: 'customer',
      label: 'ลูกค้า',
      width: px(BOOKING_COLUMN_WIDTHS.customer),
      render: (b) => (
        <div className="min-w-0 leading-snug">
          <span className="block truncate font-medium">{b.customer.name}</span>
          <span className="block text-[11px] tabular-nums text-muted-foreground">
            {b.customer.phone ?? '—'}
          </span>
        </div>
      ),
    },
    {
      key: 'product',
      label: 'สินค้าที่จอง',
      width: px(BOOKING_COLUMN_WIDTHS.product),
      render: (b) => {
        const item = b.items[0];
        const imei = item?.product?.imeiSerial;
        return (
          <div className="min-w-0 leading-snug">
            <span className="block truncate">{item?.description ?? '—'}</span>
            <span className="block truncate text-[11px] text-muted-foreground">
              {imei
                ? `IMEI …${imei.slice(-4)}`
                : item?.productId
                  ? 'ผูกเครื่องแล้ว'
                  : 'ไม่ได้ผูกเครื่อง'}
            </span>
          </div>
        );
      },
    },
    {
      key: 'branch',
      label: 'สาขา',
      width: px(BOOKING_COLUMN_WIDTHS.branch),
      render: (b) => <span className="block truncate">{b.branch.name}</span>,
    },
    {
      key: 'deposit',
      label: 'มัดจำ',
      align: 'right',
      width: px(BOOKING_COLUMN_WIDTHS.deposit),
      render: (b) => (
        <div className="leading-snug tabular-nums">
          <span className="font-medium">{fmtMoneyShort(b.depositAmount)}</span>
          <span className="block text-[11px] text-muted-foreground">
            จาก {fmtMoneyShort(b.totalAmount)}
          </span>
        </div>
      ),
    },
    {
      key: 'balance',
      label: 'คงเหลือ',
      align: 'right',
      width: px(BOOKING_COLUMN_WIDTHS.balance),
      render: (b) => {
        if (!isOpenStatus(b.status)) return <span className="text-muted-foreground">—</span>;
        const balance = balanceOf(b);
        return balance <= 0 ? (
          <span className="text-muted-foreground">0</span>
        ) : (
          <span className="font-medium tabular-nums">{fmtMoneyShort(balance)}</span>
        );
      },
    },
    {
      key: 'status',
      label: 'สถานะ',
      width: px(BOOKING_COLUMN_WIDTHS.status),
      render: (b) => (
        <Badge variant={STATUS_VARIANT[b.status]} className="gap-1.5 whitespace-nowrap">
          <BadgeDot />
          {STATUS_LABEL[b.status]}
        </Badge>
      ),
    },
    {
      key: 'expireDate',
      label: 'หมดอายุ',
      sortable: true,
      width: px(BOOKING_COLUMN_WIDTHS.expiry),
      render: (b) => <ExpiryCell booking={b} nowMs={nowMs} />,
    },
    {
      key: 'menu',
      label: '',
      align: 'center',
      width: px(BOOKING_COLUMN_WIDTHS.menu),
      render: (b) => (
        <div onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-7"
                aria-label={`การกระทำ ${b.bookingNumber}`}
              >
                <MoreHorizontal className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => actions.onOpen(b)}>
                <ExternalLink className="size-4" /> เปิด
              </DropdownMenuItem>
              {actions.canMutate && b.status === 'PENDING_DEPOSIT' && (
                <DropdownMenuItem onSelect={() => actions.onCollectDeposit(b)}>
                  <HandCoins className="size-4" /> รับมัดจำ
                </DropdownMenuItem>
              )}
              {actions.canMutate && isOpenStatus(b.status) && (
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  onSelect={() => actions.onCancel(b)}
                >
                  <Ban className="size-4" /> ยกเลิกใบจอง
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      ),
    },
  ];
}
