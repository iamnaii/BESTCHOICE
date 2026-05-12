import {
  useFieldArray,
  type Control,
  type UseFormRegister,
  type UseFormWatch,
  type UseFormSetValue,
} from 'react-hook-form';
import { Plus, Trash2, Lightbulb } from 'lucide-react';
import { AccountSearchDropdown } from './AccountSearchDropdown';
import { formatNumberDecimal } from '@/utils/formatters';
import type { OtherIncomeFormValues } from '@/lib/otherIncome.schema';

/** Per-account WHT% suggestion. Soft tooltip — never blocks. */
const WHT_SUGGESTION: Record<string, { pct: number; reason: string }> = {
  '42-1102': { pct: 1, reason: 'นิติบุคคล ออมทรัพย์ (ท.ป.4/2528)' },
  '42-1105': { pct: 1, reason: 'ขายสินทรัพย์ให้นิติบุคคล (ท.ป.4/2528)' },
};

interface Props {
  control: Control<OtherIncomeFormValues>;
  register: UseFormRegister<OtherIncomeFormValues>;
  watch: UseFormWatch<OtherIncomeFormValues>;
  setValue: UseFormSetValue<OtherIncomeFormValues>;
}

function fmt(n: number) {
  return formatNumberDecimal(n, 2);
}

export function ItemsTable({ control, register, watch, setValue }: Props) {
  const { fields, append, remove } = useFieldArray({ control, name: 'items' });
  const items = watch('items');
  const priceType = watch('priceType');

  const computed = items.map((it) => {
    const qty = Number(it.quantity) || 0;
    const unit = Number(it.unitAmount) || 0;
    const disc = Number(it.discountAmount) || 0;
    const vatPct = Number(it.vatPct) || 0;
    const whtPct = Number(it.whtPct) || 0;
    const gross = qty * unit - disc;
    let amountBeforeVat: number;
    let vatAmount: number;
    if (vatPct > 0) {
      if (priceType === 'INCLUSIVE') {
        amountBeforeVat = +(gross / (1 + vatPct / 100)).toFixed(2);
        vatAmount = +(gross - amountBeforeVat).toFixed(2);
      } else {
        amountBeforeVat = gross;
        vatAmount = +((gross * vatPct) / 100).toFixed(2);
      }
    } else {
      amountBeforeVat = gross;
      vatAmount = 0;
    }
    const whtAmount = +((amountBeforeVat * whtPct) / 100).toFixed(2);
    return { amountBeforeVat, vatAmount, whtAmount };
  });

  return (
    <div className="space-y-3">
      {fields.map((f, idx) => {
        const row = computed[idx];
        const code = items[idx]?.accountCode || '42-XXXX';
        const whtPct = Number(items[idx]?.whtPct) || 0;
        return (
          <div key={f.id} className="rounded-lg border bg-card overflow-hidden">
            <div className="flex items-center justify-between px-3 py-2 border-b bg-muted/30">
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold text-foreground">#{idx + 1}</span>
                <span className="font-mono text-xs px-2 py-0.5 rounded bg-primary/10 text-primary font-semibold">
                  {code}
                </span>
              </div>
              {fields.length > 1 && (
                <button
                  type="button"
                  onClick={() => remove(idx)}
                  className="text-muted-foreground hover:text-destructive transition-colors"
                  aria-label="ลบรายการ"
                >
                  <Trash2 size={14} />
                </button>
              )}
            </div>
            <div className="p-3 space-y-3">
              <div>
                <label className="text-xs text-muted-foreground font-medium">บัญชีรายได้</label>
                <div className="mt-1">
                  <AccountSearchDropdown
                    value={items[idx]?.accountCode ?? ''}
                    onChange={(c) => {
                      setValue(`items.${idx}.accountCode`, c, { shouldValidate: true });
                    }}
                    filter={(a) => a.code.startsWith('42-') && a.code !== '42-1103'}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-6 gap-2 text-xs">
                <div>
                  <label className="text-muted-foreground font-medium">จำนวน</label>
                  <input
                    type="number"
                    step="0.01"
                    {...register(`items.${idx}.quantity`)}
                    className="mt-1 w-full border rounded px-2 py-1.5 text-right font-mono bg-background"
                  />
                </div>
                <div>
                  <label className="text-muted-foreground font-medium">ราคา/หน่วย</label>
                  <input
                    type="number"
                    step="0.01"
                    {...register(`items.${idx}.unitAmount`)}
                    className="mt-1 w-full border rounded px-2 py-1.5 text-right font-mono bg-background"
                  />
                </div>
                <div>
                  <label className="text-muted-foreground font-medium">ส่วนลด</label>
                  <input
                    type="number"
                    step="0.01"
                    {...register(`items.${idx}.discountAmount`)}
                    className="mt-1 w-full border rounded px-2 py-1.5 text-right font-mono bg-background"
                  />
                </div>
                <div>
                  <label className="text-muted-foreground font-medium">VAT%</label>
                  <select
                    {...register(`items.${idx}.vatPct`)}
                    className="mt-1 w-full border rounded px-2 py-1.5 text-xs font-mono bg-background"
                  >
                    <option value={0}>0%</option>
                    <option value={7}>7%</option>
                  </select>
                </div>
                <div>
                  <label
                    className="text-muted-foreground font-medium inline-flex items-center gap-1"
                    title="แนะนำ: ดอกเบี้ย 15% / ค่าบริการ 3% / ค่าเช่า 5% / นิติบุคคล 1%"
                  >
                    WHT%
                    {whtPct > 0 && (
                      <span className="inline-flex items-center gap-0.5 text-warning">
                        <Lightbulb size={10} />
                        {whtPct}%
                      </span>
                    )}
                  </label>
                  <select
                    {...register(`items.${idx}.whtPct`)}
                    title="แนะนำ: ดอกเบี้ย 15% / ค่าบริการ 3% / ค่าเช่า 5% / นิติบุคคล 1%"
                    className="mt-1 w-full border rounded px-2 py-1.5 text-xs font-mono bg-background"
                  >
                    {[0, 1, 2, 3, 5, 7, 10, 15].map((p) => (
                      <option key={p} value={p}>
                        {p}%
                      </option>
                    ))}
                  </select>
                  {(() => {
                    const acc = items[idx]?.accountCode ?? '';
                    const sug = WHT_SUGGESTION[acc];
                    if (!sug || whtPct === sug.pct) return null;
                    return (
                      <p className="mt-1 text-[10px] text-muted-foreground inline-flex items-center gap-1">
                        <Lightbulb size={10} className="text-warning" />
                        แนะนำ {sug.pct}% — {sug.reason}
                      </p>
                    );
                  })()}
                </div>
                <div>
                  <label className="text-muted-foreground font-medium">ก่อนภาษี</label>
                  <div className="mt-1 w-full border rounded px-2 py-1.5 text-right font-mono bg-muted/40 text-foreground font-semibold">
                    {fmt(row?.amountBeforeVat ?? 0)}
                  </div>
                </div>
              </div>
              <div>
                <label className="text-xs text-muted-foreground font-medium">คำอธิบาย</label>
                <input
                  type="text"
                  {...register(`items.${idx}.description`)}
                  className="mt-1 w-full border rounded px-2 py-1.5 text-xs bg-background"
                  placeholder="เช่น ดอกเบี้ยเดือน พ.ค. 2569"
                />
              </div>
            </div>
            <div className="flex items-center justify-end gap-4 px-3 py-2 border-t bg-muted/20 text-xs font-mono text-muted-foreground">
              <span>
                VAT: <span className="text-foreground font-semibold">{fmt(row?.vatAmount ?? 0)}</span>
              </span>
              <span>
                WHT: <span className="text-foreground font-semibold">{fmt(row?.whtAmount ?? 0)}</span>
              </span>
              <span className="text-foreground font-semibold">
                รวม: {fmt((row?.amountBeforeVat ?? 0) + (row?.vatAmount ?? 0))}
              </span>
            </div>
          </div>
        );
      })}
      <button
        type="button"
        onClick={() =>
          append({
            accountCode: '42-1102',
            quantity: 1,
            unitAmount: 0,
            discountAmount: 0,
            vatPct: 0,
            whtPct: 1,
            description: '',
          })
        }
        className="w-full inline-flex items-center justify-center gap-2 px-3 py-3 border border-dashed rounded-lg text-sm font-semibold text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
      >
        <Plus size={16} /> เพิ่มบัญชี
      </button>
    </div>
  );
}
