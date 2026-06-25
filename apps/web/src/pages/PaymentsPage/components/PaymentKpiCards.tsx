import { Card, CardContent } from '@/components/ui/card';
import type { PendingSummary } from '../types';

interface PaymentKpiCardsProps {
  summary: PendingSummary | undefined;
  loading: boolean;
  /** Title for the "collected" card, follows the selected period
   *  (รับชำระเดือนนี้ / เดือนที่แล้ว / ทั้งหมด / ช่วงนี้). */
  collectedLabel: string;
}

const ZERO: PendingSummary = {
  pendingCount: 0,
  outstandingPrincipal: 0,
  outstandingLateFee: 0,
  waivedLateFee: 0,
  overdue60Count: 0,
  collectedAmount: 0,
  collectedCount: 0,
};

const baht = (n: number) => n.toLocaleString('th-TH');

export default function PaymentKpiCards({ summary, loading, collectedLabel }: PaymentKpiCardsProps) {
  const s = summary ?? ZERO;

  // accent + value colours use design tokens only (no hardcoded hex). Mirrors
  // the approved mockup: ค่าปรับล่าช้า=orange, อนุโลม/ค้าง60=warning(amber).
  const cards = [
    {
      label: 'รายการรอชำระ',
      value: s.pendingCount.toLocaleString('th-TH'),
      foot: <>ทั้งระบบ</>,
      accent: 'bg-success',
      valueClass: 'text-foreground',
    },
    {
      label: 'ยอดรอเก็บ',
      value: `${baht(s.outstandingPrincipal)} ฿`,
      foot: <>เฉพาะค่างวด</>,
      accent: 'bg-destructive',
      valueClass: 'text-destructive',
    },
    {
      label: 'ค่าปรับล่าช้า (รอเก็บ)',
      value: `${baht(s.outstandingLateFee)} ฿`,
      foot: <>→ <code className="font-mono text-[11px]">Cr.42-1103</code></>,
      accent: 'bg-orange',
      valueClass: 'text-orange',
    },
    {
      label: 'ค่าปรับที่ไม่เรียกเก็บ (อนุโลม)',
      value: `${baht(s.waivedLateFee)} ฿`,
      foot: <>→ <code className="font-mono text-[11px]">Dr.52-1105</code> ส่วนลด</>,
      accent: 'bg-warning',
      valueClass: 'text-warning',
    },
    {
      label: 'ค้าง ≥ 60 วัน',
      value: s.overdue60Count.toLocaleString('th-TH'),
      foot: <>trigger <code className="font-mono text-[11px]">21-2103</code> VAT</>,
      accent: 'bg-warning',
      valueClass: 'text-warning',
    },
    {
      label: collectedLabel,
      value: `${baht(s.collectedAmount)} ฿`,
      foot: <>{s.collectedCount.toLocaleString('th-TH')} รายการ</>,
      accent: 'bg-info',
      valueClass: 'text-foreground',
    },
  ];

  return (
    <div
      className={`grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4 mb-5 ${loading && !summary ? 'animate-pulse' : ''}`}
    >
      {cards.map((c) => (
        <Card
          key={c.label}
          className="hover:shadow-md hover:-translate-y-0.5 transition-all duration-200 overflow-hidden"
        >
          <CardContent className="p-5 relative">
            <div className={`absolute inset-y-0 left-0 w-1 rounded-l-xl ${c.accent}`} />
            <div className="pl-2">
              <div className="text-xs font-medium text-muted-foreground mb-2 leading-snug">{c.label}</div>
              <div className={`text-2xl font-bold tabular-nums leading-snug ${c.valueClass}`}>{c.value}</div>
              <div className="text-[11px] text-muted-foreground mt-1.5 leading-snug">{c.foot}</div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
