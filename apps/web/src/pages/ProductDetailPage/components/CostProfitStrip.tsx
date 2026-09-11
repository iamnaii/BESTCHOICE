import { Lock } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatBaht } from '../utils/buildCustomerSummary';

interface Props {
  /** FM/ACCOUNTANT เห็นทุนได้ แต่ SALES ไม่ได้ (server strip costPrice แล้ว) */
  canSeeCost: boolean;
  costPrice?: string | null;
  profit: number | null;
  /** กำไรคิดจากราคาไหน (index.tsx: ราคาผ่อนถ้ามี ไม่งั้นราคาเงินสด) */
  profitBasis: 'installment' | 'cash';
  basisPrice: number | null;
}

/**
 * แถบทุน/กำไรบรรทัดเดียว — แทนการ์ดใหญ่ 2 ใบของหน้าเดิม (ปัญหาข้อ ④ ใน spec)
 * ทุน/กำไรเป็นข้อมูลต้นทุน: ซ่อนทั้งแถบจาก SALES
 */
export default function CostProfitStrip({
  canSeeCost,
  costPrice,
  profit,
  profitBasis,
  basisPrice,
}: Props) {
  if (!canSeeCost) return null;

  const cost = costPrice != null && costPrice !== '' ? Number(costPrice) : null;
  const pct =
    profit != null && basisPrice != null && basisPrice > 0
      ? Math.round((profit / basisPrice) * 100)
      : null;
  const profitClass =
    profit == null || profit === 0
      ? 'text-muted-foreground'
      : profit > 0
        ? 'text-success'
        : 'text-destructive';

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-border/70 bg-muted/45 px-4 py-3 text-[13px] leading-snug">
      <span className="inline-flex items-center gap-1.5 text-muted-foreground">
        <Lock className="size-3.5" aria-hidden />
        ต้นทุน
      </span>
      <span className="font-mono text-[15px] font-semibold tabular-nums">
        {cost != null && Number.isFinite(cost) ? `${formatBaht(cost)} ฿` : '-'}
      </span>
      <span className="h-4 w-px bg-border" aria-hidden />
      <span className="text-muted-foreground">กำไร</span>
      <span className={cn('font-mono text-[15px] font-semibold tabular-nums', profitClass)}>
        {profit != null ? `${formatBaht(profit)} ฿` : '-'}
      </span>
      {pct != null && (
        <span className="text-muted-foreground">
          ({pct}% ของ{profitBasis === 'installment' ? 'ราคาผ่อน' : 'ราคาเงินสด'})
        </span>
      )}
      <span className="ml-auto text-xs text-muted-foreground">
        แถวนี้เห็นเฉพาะ เจ้าของ · ผู้จัดการ · บัญชี
      </span>
    </div>
  );
}
