import { cn } from '@/lib/utils';
import type { FinanceSide } from '../../hooks/useInstallmentCalcState';

interface Props {
  value: FinanceSide;
  onChange: (fin: FinanceSide) => void;
  /** รุ่นไม่อยู่ในตาราง GFIN / ยังไม่มีเรท → กดไม่ได้ */
  gfinDisabled: boolean;
}

/** สวิตช์เลือกไฟแนนซ์ — เจ้าของสั่ง (2026-09-11) "ต้องมีส่วนของ GFIN เรทผ่อนด้วย ควรมีให้เลือก" */
export function FinanceSwitch({ value, onChange, gfinDisabled }: Props) {
  const seg = (
    fin: FinanceSide,
    label: string,
    sub: string,
    activeClass: string,
    disabled = false,
  ) => {
    const active = value === fin;
    return (
      <button
        type="button"
        role="tab"
        aria-selected={active}
        disabled={disabled}
        onClick={() => onChange(fin)}
        className={cn(
          'flex h-11 flex-col items-center justify-center rounded-md border border-transparent leading-tight transition-colors',
          active ? cn('bg-card shadow-sm', activeClass) : 'text-muted-foreground hover:text-foreground',
          disabled && 'cursor-not-allowed opacity-55 hover:text-muted-foreground',
        )}
      >
        <span className="text-[13px] font-semibold">{label}</span>
        <span className="text-[11px] font-normal text-muted-foreground">{sub}</span>
      </button>
    );
  };

  return (
    <div
      role="tablist"
      aria-label="เลือกไฟแนนซ์"
      className="grid grid-cols-2 gap-1 rounded-lg bg-muted/60 p-1"
    >
      {seg('bc', 'BESTCHOICE', 'สัญญาของเรา', 'border-primary/45 text-primary')}
      {seg(
        'gfin',
        'GFIN',
        gfinDisabled ? 'ไม่มีข้อมูลรุ่นนี้' : 'ไฟแนนซ์ภายนอก',
        'border-info/45 text-info',
        gfinDisabled,
      )}
    </div>
  );
}
