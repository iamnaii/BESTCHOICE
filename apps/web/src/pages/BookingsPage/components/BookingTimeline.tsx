import { cn } from '@/lib/utils';
import type { BookingEvent } from '../types';
import { fmtBangkokDateShort, fmtBangkokTime, fmtMoneyShort } from '../utils';

export const METHOD_LABEL: Record<string, string> = {
  CASH: 'เงินสด',
  BANK_TRANSFER: 'โอนธนาคาร',
  QR_EWALLET: 'QR / e-Wallet',
};
const FIELD_LABEL: Record<string, string> = {
  notes: 'หมายเหตุ',
  expireDate: 'วันหมดอายุ',
  depositAmount: 'มัดจำ',
  items: 'เครื่อง',
  customerId: 'ลูกค้า',
  branchId: 'สาขา',
};
const str = (v: unknown): string =>
  typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '';
const money = (v: unknown): number => Number(str(v)) || 0;

export function describeEvent(e: BookingEvent): {
  title: string;
  tone: 'muted' | 'success' | 'primary' | 'destructive';
} {
  const d = e.data ?? {};
  switch (e.kind) {
    case 'BOOKING_CREATED':
      return { title: 'สร้างใบจอง', tone: 'muted' };
    case 'BOOKING_UPDATED': {
      const changed = Array.isArray(d.changed)
        ? (d.changed as string[]).map((k) => FIELD_LABEL[k] ?? k)
        : [];
      return {
        title: changed.length ? `แก้ไข ${changed.join(' · ')}` : 'แก้ไขใบจอง',
        tone: 'muted',
      };
    }
    case 'BOOKING_DEPOSIT_PAID': {
      const method = METHOD_LABEL[str(d.depositMethod)] ?? str(d.depositMethod);
      return { title: method ? `รับมัดจำ · ${method}` : 'รับมัดจำ', tone: 'success' };
    }
    case 'BOOKING_CANCELED': {
      const parts = ['ยกเลิกใบจอง'];
      if (money(d.refundAmount) > 0) parts.push(`คืนมัดจำ ${fmtMoneyShort(money(d.refundAmount))}`);
      if (str(d.cancelReason)) parts.push(str(d.cancelReason));
      return { title: parts.join(' · '), tone: 'destructive' };
    }
    case 'BOOKING_CONVERTED':
      return { title: `ออกใบขาย ${str(d.saleNumber)}`.trim(), tone: 'primary' };
    case 'BOOKING_AUTO_EXPIRED':
      return {
        title:
          money(d.forfeitAmount) > 0
            ? `หมดอายุ · ริบมัดจำ ${fmtMoneyShort(money(d.forfeitAmount))}`
            : 'หมดอายุ',
        tone: 'muted',
      };
    case 'BOOKING_DELETED':
      return { title: 'ลบใบจอง', tone: 'destructive' };
    default:
      return { title: e.kind, tone: 'muted' };
  }
}

const DOT: Record<string, string> = {
  muted: 'bg-muted-foreground',
  success: 'bg-success',
  primary: 'bg-primary',
  destructive: 'bg-destructive',
};

export default function BookingTimeline({ events }: { events: BookingEvent[] }) {
  if (events.length === 0)
    return <p className="text-xs text-muted-foreground">ยังไม่มีเหตุการณ์</p>;
  return (
    <ol className="flex flex-col">
      {events.map((e, i) => {
        const { title, tone } = describeEvent(e);
        const actor = e.kind === 'BOOKING_AUTO_EXPIRED' ? 'ระบบ' : (e.actor?.name ?? '—');
        return (
          <li key={e.id} className={cn('flex gap-3', i < events.length - 1 && 'pb-3.5')}>
            <span className="flex w-3.5 flex-col items-center">
              <span className={cn('mt-1.5 size-2.5 rounded-full', DOT[tone])} />
              {i < events.length - 1 && <span className="mt-1 w-0.5 flex-1 bg-border" />}
            </span>
            <span className="text-[13px] leading-snug">
              <span className="font-medium">{title}</span>
              <span className="block text-xs text-muted-foreground">
                {fmtBangkokDateShort(e.at)} {fmtBangkokTime(e.at)} · {actor}
              </span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}
