import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { BookingKpiKey } from '../hooks/useBookingsQuery';
import type { BookingSummary } from '../types';
import { fmtMoneyShort } from '../utils';

type Tone = 'primary' | 'info' | 'success' | 'warning' | 'muted';
const TONE_BAR: Record<Tone, string> = {
  primary: 'bg-primary',
  info: 'bg-info',
  success: 'bg-success',
  warning: 'bg-warning',
  muted: 'bg-muted-foreground',
};
const TONE_TEXT: Record<Tone, string> = {
  primary: 'text-foreground',
  info: 'text-info',
  success: 'text-success',
  warning: 'text-warning-strong',
  muted: 'text-foreground',
};

export interface BookingKpiSpec {
  key: BookingKpiKey | 'forfeited';
  label: string;
  tone: Tone;
  value: string;
  sub?: string;
  /** ไม่มี = การ์ดตัวเลขอย่างเดียว ไม่กดกรอง */
  params?: Record<string, string>;
}

/**
 * การ์ด 6 ใบตาม mockup 1A · ใบที่กดได้ **เขียนทับ status/expiring/all ครบทุกใบ** — กดต่อกันแล้วไม่เหลือ
 * ตัวกรองซ้อนที่มองไม่เห็น (บทเรียน CustomerKpiCards) · ตัวเลขทุกใบมาจาก GET /bookings/summary
 * ซึ่งใช้ where เดียวกับรายการ ⇒ การ์ดกับตารางไม่เถียงกัน
 */
export function bookingKpiCards(summary?: BookingSummary): BookingKpiSpec[] {
  const s = summary;
  return [
    {
      key: 'open',
      label: 'ที่ยังเปิดอยู่',
      tone: 'primary',
      value: String(s?.open ?? 0),
      sub: `ทั้งหมด ${s?.total ?? 0} ใบ`,
      params: { status: '', expiring: '', all: '' },
    },
    {
      key: 'pendingDeposit',
      label: 'รอชำระมัดจำ',
      tone: 'info',
      value: String(s?.pendingDeposit ?? 0),
      sub: 'ยังไม่รับเงิน',
      params: { status: 'PENDING_DEPOSIT', expiring: '', all: '' },
    },
    {
      key: 'paid',
      label: 'มัดจำแล้ว · รอรับเครื่อง',
      tone: 'success',
      value: String(s?.paid ?? 0),
      sub: `ถือมัดจำอยู่ ฿${fmtMoneyShort(s?.paidDepositHeld ?? 0)}`,
      params: { status: 'PAID', expiring: '', all: '' },
    },
    {
      key: 'expiring',
      label: 'ใกล้หมดอายุ (≤ 3 วัน)',
      tone: 'warning',
      value: String(s?.expiringWithin3Days ?? 0),
      sub: 'รวมใบที่รอระบบปิด',
      params: { status: '', expiring: '3', all: '' },
    },
    {
      key: 'closed',
      label: 'ปิดแล้ว',
      tone: 'muted',
      value: String(s?.closed.total ?? 0),
      sub: `ขาย ${s?.closed.converted ?? 0} · ยกเลิก ${s?.closed.canceled ?? 0} · หมดอายุ ${s?.closed.expired ?? 0}`,
      params: { status: 'CLOSED', expiring: '', all: '' },
    },
    {
      key: 'forfeited',
      label: 'มัดจำที่ริบเดือนนี้',
      tone: 'muted',
      value: `฿${fmtMoneyShort(s?.forfeitedThisMonth ?? 0)}`,
      sub: 'ใบหมดอายุที่เคยรับมัดจำ',
      params: undefined,
    },
  ];
}

export default function BookingKpiCards({
  summary,
  activeKey,
  onPick,
}: {
  summary?: BookingSummary;
  activeKey: BookingKpiKey;
  onPick: (params: Record<string, string>) => void;
}) {
  return (
    <div
      role="group"
      aria-label="สรุปใบจอง"
      className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:gap-4 xl:grid-cols-6"
    >
      {bookingKpiCards(summary).map((card) => {
        const active = card.key === activeKey;
        const body = (
          <span className="block pl-2">
            <span className="mb-1.5 block text-xs font-medium leading-snug text-muted-foreground">
              {card.label}
            </span>
            <span className={cn('block text-2xl font-bold tabular-nums', TONE_TEXT[card.tone])}>
              {card.value}
            </span>
            {card.sub && (
              <span className="mt-1 block text-[11px] leading-snug text-muted-foreground">
                {card.sub}
              </span>
            )}
          </span>
        );
        const bar = (
          <span
            aria-hidden="true"
            className={cn('absolute inset-y-0 left-0 w-1', TONE_BAR[card.tone])}
          />
        );
        const params = card.params;
        return (
          <Card
            key={card.key}
            className={cn(
              'overflow-hidden transition-all duration-200',
              active && 'ring-2 ring-primary/40',
            )}
          >
            <CardContent className="p-0">
              {params ? (
                <button
                  type="button"
                  aria-pressed={active}
                  onClick={() => onPick(params)}
                  className="relative w-full cursor-pointer px-4 py-4 text-left transition-colors hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                >
                  {bar}
                  {body}
                </button>
              ) : (
                <div className="relative w-full px-4 py-4 text-left">
                  {bar}
                  {body}
                </div>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
