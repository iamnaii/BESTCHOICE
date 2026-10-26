import { FormNumberInput } from '@/components/ui/FormNumberInput';
import { formatNumericText } from '@/utils/numericText';
import {
  useFieldArray,
  type Control,
  type UseFormRegister,
  type UseFormSetValue,
} from 'react-hook-form';
import { Plus, Trash2 } from 'lucide-react';
import { AccountSearchDropdown } from './AccountSearchDropdown';
import type { OtherIncomeFormValues } from '@/lib/otherIncome.schema';

interface Props {
  control: Control<OtherIncomeFormValues>;
  register: UseFormRegister<OtherIncomeFormValues>;
  setValue: UseFormSetValue<OtherIncomeFormValues>;
  /** Absolute value of (amountReceived - netExpected). 0 = no adjustment needed. */
  totalDiff: number;
  /** Sign of diff: positive = received > expected, negative = received < expected. */
  diffSign: 'over' | 'under' | 'zero';
  watchedAdjustments: Array<{ amount: number | string; accountCode?: string }>;
}

const adjAccountFilter = (a: { code: string }) =>
  a.code.startsWith('52-') || a.code.startsWith('53-') || a.code.startsWith('11-41');

export function AdjustmentTable({
  control,
  register,
  setValue,
  totalDiff,
  diffSign,
  watchedAdjustments,
}: Props) {
  const { fields, append, remove } = useFieldArray({ control, name: 'adjustments' });
  const sumSpec = (watchedAdjustments ?? []).reduce(
    (s, a) => s + (Number(a.amount) || 0),
    0,
  );
  const remaining = +(totalDiff - sumSpec).toFixed(2);
  const balanced = Math.abs(remaining) < 0.01;

  if (diffSign === 'zero' && fields.length === 0) return null;

  return (
    <div className="rounded-lg border p-3 bg-card">
      <p className="text-sm font-bold mb-2">
        บัญชีบันทึกผลต่าง {formatNumericText(totalDiff.toFixed(2))} ฿{' '}
        <span className="text-muted-foreground font-normal text-xs">
          (รวมต้องเท่ากับผลต่าง)
        </span>
      </p>
      <div className="space-y-2">
        {fields.map((f, idx) => (
          <div key={f.id} className="grid grid-cols-[1.5rem_minmax(0,1fr)_2.75rem] gap-2 items-start sm:grid-cols-12">
            <span className="col-span-1 inline-flex items-center justify-center w-5 h-5 rounded text-[10px] font-bold bg-muted">
              {idx + 1}
            </span>
            <div className="col-span-2 min-w-0 sm:col-span-5">
              <AccountSearchDropdown
                value={watchedAdjustments[idx]?.accountCode ?? ''}
                onChange={(code) => {
                  setValue(`adjustments.${idx}.accountCode`, code, { shouldValidate: true });
                }}
                filter={adjAccountFilter}
                placeholder="เลือกบัญชีปรับ"
              />
              <input
                {...register(`adjustments.${idx}.note`)}
                aria-label={`หมายเหตุผลต่างรายการ ${idx + 1}`}
                placeholder="หมายเหตุ (เช่น ค่าธรรมเนียมแบงก์)"
                className="w-full border rounded px-2 py-1 text-xs mt-1"
              />
            </div>
            <div className="col-start-2 min-w-0 sm:col-span-3 sm:col-start-auto">
              <FormNumberInput unstyled
                step="0.01"
                name={`adjustments.${idx}.amount`} control={control}
                aria-label={`จำนวนผลต่างรายการ ${idx + 1}`}
                className="w-full border rounded px-2 py-1 text-right font-mono"
                placeholder="0.00"
              />
            </div>
            <button data-ui-control="button" data-ui-icon="true"
              type="button"
              onClick={() => remove(idx)}
              aria-label={`ลบผลต่างรายการ ${idx + 1}`}
              className="col-span-1 inline-flex size-6 max-lg:size-11 items-center justify-center rounded-md text-destructive hover:bg-destructive/10"
            >
              <Trash2 size={14} />
            </button>
          </div>
        ))}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button data-ui-control="button"
          type="button"
          onClick={() => append({ accountCode: '', amount: 0, note: '' })}
          className="inline-flex max-lg:min-h-11 items-center gap-1 px-2 py-1 border rounded-md text-xs hover:bg-accent"
        >
          <Plus size={12} /> เพิ่มบัญชี
        </button>
        {!balanced && remaining > 0 && (
          <button
            data-ui-control="button"
            type="button"
            onClick={() => append({ accountCode: '', amount: remaining, note: '' })}
            className="inline-flex max-w-full max-lg:min-h-11 items-center gap-1 px-2 py-1 border rounded-md text-left text-xs bg-primary/10 hover:bg-primary/20"
          >
            <Plus size={12} /> เพิ่มผลต่างที่เหลือ {formatNumericText(remaining.toFixed(2))} ฿
          </button>
        )}
      </div>
      <div className="mt-2 pt-2 border-t text-xs flex flex-wrap justify-between gap-2">
        <span className="text-muted-foreground">รวมผลต่างที่ระบุ:</span>
        <span className="font-mono font-bold">
          {formatNumericText(sumSpec.toFixed(2))} / {formatNumericText(totalDiff.toFixed(2))} ฿
        </span>
      </div>
      {!balanced && (
        <p className="text-[10px] mt-1 text-warning-strong">
          ระบุยอดรวมให้ตรงกับผลต่าง
        </p>
      )}
    </div>
  );
}
