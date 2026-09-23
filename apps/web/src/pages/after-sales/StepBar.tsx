import { Check } from 'lucide-react';

/**
 * แถบขั้นตอนกลาง (ย้ายมาจาก `HeroSteps` เดิมของ `shop-daily-cash/CashStatusHero.tsx` — ตัดสิน
 * 2026-09-23 R3: วงกลม/เครื่องหมายถูกมีเลขที่เดียว หัวข้อ**ห้าม**มีเลขนำหน้าซ้ำ) วงกลม 26px แสดง
 * เลขลำดับหรือเครื่องหมายถูก · หัวข้อสูง 26px วางกึ่งกลางแนวตั้งกับวงกลม + hint ใต้หัวข้อ
 */
export type StepTone = 'done' | 'now' | 'idle';

export interface StepBarStep {
  tone: StepTone;
  title: string;
  hint?: string;
}

interface StepBarProps {
  steps: StepBarStep[];
  ariaLabel: string;
}

const STEP_DOT: Record<StepTone, string> = {
  done: 'bg-primary text-primary-foreground',
  now: 'border-2 border-warning bg-warning/10 text-foreground',
  idle: 'border-2 border-dashed border-border text-muted-foreground',
};

const GRID_COLS: Record<number, string> = {
  1: 'sm:grid-cols-1',
  2: 'sm:grid-cols-2',
  3: 'sm:grid-cols-3',
  4: 'sm:grid-cols-4',
  5: 'sm:grid-cols-5',
  6: 'sm:grid-cols-6',
};

export default function StepBar({ steps, ariaLabel }: StepBarProps) {
  const gridCols = GRID_COLS[steps.length] ?? 'sm:grid-cols-3';
  return (
    <ol
      aria-label={ariaLabel}
      className={`grid grid-cols-1 gap-y-2.5 rounded-lg border border-border/70 bg-card px-1.5 py-3 ${gridCols}`}
    >
      {steps.map((step, index) => (
        <li
          key={step.title}
          className={`flex items-start gap-2.5 px-3 leading-snug ${index > 0 ? 'sm:border-l sm:border-border/70' : ''}`}
        >
          <span
            aria-hidden
            className={`inline-flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full text-xs font-bold ${STEP_DOT[step.tone]}`}
          >
            {step.tone === 'done' ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : index + 1}
          </span>
          <span className="flex min-w-0 flex-col text-[13px]">
            <span
              className={`flex min-h-[26px] items-center font-semibold ${step.tone === 'idle' ? 'text-muted-foreground' : 'text-foreground'}`}
            >
              {step.title}
            </span>
            {step.hint && <span className="text-muted-foreground">{step.hint}</span>}
          </span>
        </li>
      ))}
    </ol>
  );
}
