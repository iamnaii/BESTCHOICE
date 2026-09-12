import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { CustomerTabSummary, CustomerView, ProspectTabSummary } from '../types';

/**
 * การ์ด KPI 5 ใบต่อแท็บ — **กดเพื่อกรอง** และเขียน URL param ชุดเดียวกับที่ดรอปดาวน์เขียน
 * ⇒ กดแล้วลิงก์บุ๊กมาร์กได้ และปุ่มส่งออก Excel ตามตัวกรองนั้นไปด้วย (buildParams ตัวเดียว)
 *
 * "ผ่าน pre-check" ยิง `precheck=FULL_CHECK_PASSED` ไม่ใช่ `PRE_CHECK_PASSED`:
 * ไม่มีโค้ด production ที่ไหนเขียน `checkType: 'PRE'` เลย (ทุก `creditCheck.create` ปล่อยให้
 * schema default `FULL` ทำงาน) ⇒ `PRE_CHECK_PASSED` เป็นค่าที่ข้อมูลจริงไปไม่ถึง
 */

type Tone = 'primary' | 'success' | 'info' | 'warning' | 'destructive' | 'muted';

const TONE_BAR: Record<Tone, string> = {
  primary: 'bg-primary',
  success: 'bg-success',
  info: 'bg-info',
  warning: 'bg-warning',
  destructive: 'bg-destructive',
  muted: 'bg-muted-foreground',
};

const TONE_TEXT: Record<Tone, string> = {
  primary: 'text-foreground',
  success: 'text-success',
  info: 'text-info',
  warning: 'text-warning',
  destructive: 'text-destructive',
  muted: 'text-muted-foreground',
};

export interface KpiCardSpec {
  key: string;
  label: string;
  tone: Tone;
  value: number;
  /** พารามิเตอร์ที่จะเขียน — ค่าว่างหมายถึงลบคีย์นั้น */
  params: Record<string, string>;
}

export function customerKpiCards(summary?: CustomerTabSummary): KpiCardSpec[] {
  return [
    {
      key: 'all',
      label: 'ลูกค้าทั้งหมด',
      tone: 'primary',
      value: summary?.total ?? 0,
      params: { purchase: '', state: '', bought: '' },
    },
    {
      key: 'installment',
      label: 'ผ่อนกับเรา',
      tone: 'success',
      value: summary?.installment ?? 0,
      params: { purchase: 'INSTALLMENT', state: '' },
    },
    {
      key: 'cash',
      label: 'เงินสด',
      tone: 'info',
      value: summary?.cash ?? 0,
      params: { purchase: 'CASH', state: '' },
    },
    {
      key: 'externalFinance',
      label: 'ไฟแนนซ์นอก',
      tone: 'warning',
      value: summary?.externalFinance ?? 0,
      params: { purchase: 'EXTERNAL_FINANCE', state: '' },
    },
    {
      key: 'overdue',
      label: 'ค้างชำระ',
      tone: 'destructive',
      value: summary?.overdue ?? 0,
      params: { purchase: 'INSTALLMENT', state: 'OVERDUE' },
    },
  ];
}

export function prospectKpiCards(summary?: ProspectTabSummary): KpiCardSpec[] {
  return [
    {
      key: 'all',
      label: 'ผู้สนใจทั้งหมด',
      tone: 'primary',
      value: summary?.total ?? 0,
      params: { contacted: '', precheck: '', source: '' },
    },
    {
      key: 'contacted7d',
      label: 'คุยกันใน 7 วัน',
      tone: 'success',
      value: summary?.contacted7d ?? 0,
      params: { contacted: '7d' },
    },
    {
      key: 'checkingCredit',
      label: 'กำลังเช็คเครดิต',
      tone: 'warning',
      value: summary?.checkingCredit ?? 0,
      params: { precheck: 'UNDER_REVIEW' },
    },
    {
      key: 'prechecked',
      label: 'ผ่าน pre-check',
      tone: 'info',
      value: summary?.prechecked ?? 0,
      params: { precheck: 'FULL_CHECK_PASSED' },
    },
    {
      key: 'silent30d',
      label: 'เงียบเกิน 30 วัน',
      tone: 'muted',
      value: summary?.silent30d ?? 0,
      params: { contacted: 'silent30' },
    },
  ];
}

export default function CustomerKpiCards({
  view,
  summary,
  activeKey,
  onPick,
}: {
  view: CustomerView;
  summary?: CustomerTabSummary | ProspectTabSummary;
  /** การ์ดที่ตรงกับตัวกรองปัจจุบัน (ไฮไลต์) */
  activeKey: string;
  onPick: (params: Record<string, string>) => void;
}) {
  const cards =
    view === 'customers'
      ? customerKpiCards(summary as CustomerTabSummary | undefined)
      : prospectKpiCards(summary as ProspectTabSummary | undefined);

  return (
    <div
      role="group"
      aria-label="ตัวเลขสรุป"
      className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-5 lg:gap-4"
    >
      {cards.map((card) => {
        const on = card.key === activeKey;
        return (
          <Card
            key={card.key}
            className={cn(
              'overflow-hidden transition-all duration-200',
              on && 'ring-2 ring-primary/40',
            )}
          >
            <CardContent className="p-0">
              <button
                type="button"
                aria-pressed={on}
                onClick={() => onPick(card.params)}
                className="relative w-full cursor-pointer px-4 py-4 text-left transition-colors hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
              >
                <span
                  aria-hidden="true"
                  className={cn('absolute inset-y-0 left-0 w-1', TONE_BAR[card.tone])}
                />
                <span className="block pl-2">
                  <span className="mb-1.5 block text-xs font-medium leading-snug text-muted-foreground">
                    {card.label}
                  </span>
                  <span
                    className={cn(
                      'block text-2xl font-bold tabular-nums',
                      card.value > 0 ? TONE_TEXT[card.tone] : 'text-muted-foreground',
                    )}
                  >
                    {card.value.toLocaleString()}
                  </span>
                </span>
              </button>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
