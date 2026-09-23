import { ArrowLeftRight, Banknote, Wrench, type LucideIcon } from 'lucide-react';
import {
  OUTCOME_LABEL,
  PAYER_LABEL,
  type AfterSalesOutcome,
  type OutcomeOption,
} from './after-sales';

const OUTCOME_ICON: Record<AfterSalesOutcome, LucideIcon> = {
  REPAIR: Wrench,
  SAME_MODEL_EXCHANGE: ArrowLeftRight,
  CASH_SAME_MODEL_EXCHANGE: ArrowLeftRight,
  PRICED_EXCHANGE: Banknote,
};

/** ข้อความคงที่ตอน enabled แต่ยังไม่ implemented — ทางออกนี้มีจริงตามกติกาประกัน แต่โค้ดยังไม่รองรับจนกว่าจะถึง PR 2 */
const NOT_IMPLEMENTED_HINT = 'เปิดใช้ในรอบถัดไป';

interface OutcomePickerProps {
  options: OutcomeOption[];
  value: AfterSalesOutcome | null;
  onChange: (outcome: AfterSalesOutcome) => void;
}

export default function OutcomePicker({ options, value, onChange }: OutcomePickerProps) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      {options.map((option) => {
        const Icon = OUTCOME_ICON[option.outcome];
        const disabled = !option.enabled || !option.implemented;
        const selected = value === option.outcome;
        const subtitle = !option.enabled
          ? option.reason
          : !option.implemented
            ? NOT_IMPLEMENTED_HINT
            : option.outcome === 'REPAIR'
              ? option.payerDefault && PAYER_LABEL[option.payerDefault]
              : option.note;

        return (
          <button
            key={option.outcome}
            type="button"
            aria-pressed={selected}
            disabled={disabled}
            onClick={() => onChange(option.outcome)}
            className={`rounded-xl border p-4 text-left leading-snug ${
              disabled
                ? 'cursor-not-allowed border-border bg-muted text-muted-foreground'
                : selected
                  ? 'border-2 border-primary bg-primary/5'
                  : 'border-border bg-card hover:bg-accent'
            }`}
          >
            <span className="flex items-center gap-2 text-sm font-semibold">
              <Icon aria-hidden className="h-4 w-4 shrink-0" />
              {OUTCOME_LABEL[option.outcome]}
            </span>
            {subtitle && <span className="mt-1 block text-xs">{subtitle}</span>}
          </button>
        );
      })}
    </div>
  );
}
