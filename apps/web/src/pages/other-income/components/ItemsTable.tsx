import {
  useFieldArray,
  type Control,
  type UseFormRegister,
  type UseFormWatch,
  type UseFormSetValue,
} from 'react-hook-form';
import { Plus, Trash2 } from 'lucide-react';
import { AccountSearchDropdown } from './AccountSearchDropdown';
import type { OtherIncomeFormValues } from '@/lib/otherIncome.schema';

interface Props {
  control: Control<OtherIncomeFormValues>;
  register: UseFormRegister<OtherIncomeFormValues>;
  watch: UseFormWatch<OtherIncomeFormValues>;
  setValue: UseFormSetValue<OtherIncomeFormValues>;
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
      {fields.map((f, idx) => (
        <div key={f.id} className="rounded-lg border p-3 bg-card">
          <div className="flex items-center justify-between mb-2">
            <span className="font-bold text-sm">รายการ #{idx + 1}</span>
            {fields.length > 1 && (
              <button
                type="button"
                onClick={() => remove(idx)}
                className="text-destructive hover:opacity-80"
              >
                <Trash2 size={14} />
              </button>
            )}
          </div>
          <div className="grid grid-cols-12 gap-2 text-xs">
            <div className="col-span-4">
              <label className="text-muted-foreground">บัญชี (42-XXXX)</label>
              <AccountSearchDropdown
                value={items[idx]?.accountCode ?? ''}
                onChange={(code) => {
                  setValue(`items.${idx}.accountCode`, code, { shouldValidate: true });
                }}
                filter={(a) => a.code.startsWith('42-') && a.code !== '42-1103'}
              />
            </div>
            <div className="col-span-1">
              <label className="text-muted-foreground">จำนวน</label>
              <input
                type="number"
                step="0.01"
                {...register(`items.${idx}.quantity`)}
                className="w-full border rounded px-2 py-1 text-right font-mono"
              />
            </div>
            <div className="col-span-2">
              <label className="text-muted-foreground">ราคา</label>
              <input
                type="number"
                step="0.01"
                {...register(`items.${idx}.unitAmount`)}
                className="w-full border rounded px-2 py-1 text-right font-mono"
              />
            </div>
            <div className="col-span-1">
              <label className="text-muted-foreground">ส่วนลด</label>
              <input
                type="number"
                step="0.01"
                {...register(`items.${idx}.discountAmount`)}
                className="w-full border rounded px-2 py-1 text-right font-mono"
              />
            </div>
            <div className="col-span-1">
              <label className="text-muted-foreground">VAT%</label>
              <select
                {...register(`items.${idx}.vatPct`)}
                className="w-full border rounded px-1 py-1 text-xs font-mono"
              >
                <option value={0}>0</option>
                <option value={7}>7</option>
              </select>
            </div>
            <div className="col-span-1">
              <label className="text-muted-foreground">WHT%</label>
              <select
                {...register(`items.${idx}.whtPct`)}
                className="w-full border rounded px-1 py-1 text-xs font-mono"
              >
                {[0, 1, 2, 3, 5, 7, 10, 15].map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </div>
            <div className="col-span-2 text-right">
              <label className="text-muted-foreground">ก่อนภาษี</label>
              <p className="font-mono font-bold">{computed[idx]?.amountBeforeVat.toFixed(2)}</p>
            </div>
          </div>
          <div className="mt-2">
            <label className="text-xs text-muted-foreground">คำอธิบาย (optional)</label>
            <textarea
              {...register(`items.${idx}.description`)}
              rows={1}
              className="w-full border rounded px-2 py-1 text-xs"
              placeholder="เช่น ดอกเบี้ยเดือน พ.ค. 2569"
            />
          </div>
        </div>
      ))}
      <button
        type="button"
        onClick={() =>
          append({
            accountCode: '42-1102',
            quantity: 1,
            unitAmount: 0,
            discountAmount: 0,
            vatPct: 0,
            whtPct: 15,
            description: '',
          })
        }
        className="inline-flex items-center gap-1 px-3 py-2 border rounded-md text-xs font-semibold hover:bg-accent"
      >
        <Plus size={14} /> เพิ่มรายการ
      </button>
    </div>
  );
}
