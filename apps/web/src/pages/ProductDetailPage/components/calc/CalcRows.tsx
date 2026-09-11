import type { ReactNode } from 'react';
import { ChevronRight, Info, TriangleAlert } from 'lucide-react';
import { formatBahtPlain } from '@installment/shared';
import { cn } from '@/lib/utils';

export type CalcTone = 'primary' | 'info';

/** เงิน 2 ทศนิยม (แถวรายละเอียด) — รูปแบบเดิมของการ์ดคำนวณ */
export function formatTHB(n: number): string {
  return n.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** เงินแบบไม่มี .00 (ค่างวดปัดขึ้นของ GFIN · ยอดดาวน์) */
export function formatBaht(n: number): string {
  return formatBahtPlain(n);
}

const toneText: Record<CalcTone, string> = { primary: 'text-primary', info: 'text-info' };
const toneBox: Record<CalcTone, string> = {
  primary: 'border-primary/25 bg-primary/10',
  info: 'border-info/25 bg-info/10',
};

export function ResultBox({
  label,
  amount,
  sub,
  tone,
}: {
  label: string;
  amount: string;
  sub: string;
  tone: CalcTone;
}) {
  return (
    <div className={cn('rounded-lg border p-4', toneBox[tone])}>
      <div className="text-xs text-muted-foreground leading-snug">{label}</div>
      <div className="mt-0.5 flex items-baseline gap-1.5">
        <span className={cn('font-mono text-3xl font-semibold tabular-nums', toneText[tone])}>
          {amount}
        </span>
        <span className="text-sm text-muted-foreground leading-snug">฿ / เดือน</span>
      </div>
      <div className="mt-1.5 text-[13px] text-muted-foreground leading-snug">{sub}</div>
    </div>
  );
}

export function DetailRow({
  label,
  value,
  bold,
  valueClassName,
}: {
  label: ReactNode;
  value: string;
  bold?: boolean;
  valueClassName?: string;
}) {
  return (
    <div
      className={cn(
        'flex items-baseline justify-between gap-3 text-[13px] leading-snug',
        bold && 'font-semibold',
      )}
    >
      <span className={bold ? 'text-foreground' : 'text-muted-foreground'}>{label}</span>
      <span className={cn('font-mono tabular-nums', valueClassName)}>{value}</span>
    </div>
  );
}

/** บรรทัดเทียบอีกไฟแนนซ์งวดเดียวกัน — กด "สลับไปดู" เพื่อเปลี่ยนฝั่ง */
export function CompareRow({
  name,
  tone,
  monthly,
  detail,
  onSwitch,
}: {
  name: string;
  tone: CalcTone;
  monthly: string;
  detail: string;
  onSwitch: () => void;
}) {
  return (
    <div className={cn('rounded-lg border px-3.5 py-2.5', toneBox[tone].replace('/10', '/5'))}>
      <div className="flex items-center justify-between gap-3">
        <span className={cn('text-xs font-semibold', toneText[tone])}>
          {name} <span className="font-normal text-muted-foreground">· งวดเดียวกัน</span>
        </span>
        <button
          type="button"
          onClick={onSwitch}
          className="inline-flex items-center gap-0.5 text-[13px] text-muted-foreground hover:text-foreground leading-snug"
        >
          สลับไปดู
          <ChevronRight className="size-3.5" aria-hidden />
        </button>
      </div>
      <div className="mt-0.5 flex flex-wrap items-baseline gap-1.5">
        <span className={cn('font-mono text-lg font-semibold tabular-nums', toneText[tone])}>
          {monthly}
        </span>
        <span className="text-xs text-muted-foreground leading-snug">฿ / เดือน · {detail}</span>
      </div>
    </div>
  );
}

export function HintLine({ children }: { children: ReactNode }) {
  return <p className="text-xs text-muted-foreground leading-snug">{children}</p>;
}

export function NoticeBox({
  children,
  tone = 'muted',
}: {
  children: ReactNode;
  tone?: 'muted' | 'warning';
}) {
  const Icon = tone === 'warning' ? TriangleAlert : Info;
  return (
    <div
      className={cn(
        'flex items-start gap-2 rounded-lg border px-3.5 py-2.5 text-xs leading-snug',
        tone === 'warning'
          ? 'border-warning/40 bg-warning/10 text-foreground'
          : 'border-dashed border-border text-muted-foreground',
      )}
    >
      <Icon
        className={cn('mt-0.5 size-3.5 shrink-0', tone === 'warning' && 'text-warning')}
        aria-hidden
      />
      <span>{children}</span>
    </div>
  );
}

/**
 * กติกาของร้าน: ส่วนต่างราคาส่งสูงสุด (รวม OVER) กับราคาผ่อนที่ต้องการ เอามาลดดาวน์ให้ลูกค้า
 * โชว์คู่กันเพื่อไม่ให้เผลอเก็บดาวน์ลูกค้าเต็มตามที่แจ้ง GFIN
 */
export function DownCallout({
  downPct,
  declared,
  actual,
  submit,
  ourPrice,
  discount,
}: {
  downPct: number;
  declared: number;
  actual: number;
  submit: number;
  ourPrice: number;
  discount: number;
}) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-x-3 gap-y-2 rounded-lg border border-info/25 bg-info/10 px-3.5 py-2.5">
      <div>
        <div className="text-xs text-muted-foreground leading-snug">ดาวน์ที่แจ้ง GFIN ({downPct}%)</div>
        <div className="font-mono text-[15px] font-semibold tabular-nums">{formatBaht(declared)} ฿</div>
      </div>
      <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
      <div>
        <div className="text-xs text-muted-foreground leading-snug">ลูกค้าจ่ายดาวน์จริง</div>
        <div className="font-mono text-[15px] font-semibold tabular-nums text-info">
          {formatBaht(actual)} ฿
        </div>
      </div>
      <p className="col-span-3 text-xs text-muted-foreground leading-snug">
        หักส่วนต่าง ราคาส่งสูงสุด {formatBaht(submit)} − ราคาผ่อนที่ต้องการ {formatBaht(ourPrice)} ={' '}
        {formatBaht(discount)} ฿ (กติกาของร้าน)
      </p>
    </div>
  );
}
