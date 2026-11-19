import { useId } from 'react';
import { NumberInput } from '@/components/ui/NumberInput';
import { formControlClass } from '@/components/ui/form-styles';
import { cn } from '@/lib/utils';
import type { RateRowForm } from './rate-rows';

export default function RateRowsEditor({
  rows,
  onChange,
  error,
}: {
  rows: RateRowForm[];
  onChange: (rows: RateRowForm[]) => void;
  error?: string;
}) {
  const fieldId = useId();
  const update = (index: number, patch: Partial<RateRowForm>) =>
    onChange(rows.map((r, i) => (i === index ? { ...r, ...patch } : r)));

  return (
    <section aria-labelledby={`${fieldId}-title`} className="rounded-lg border border-border p-3">
      <h3 id={`${fieldId}-title`} className="text-sm font-semibold leading-snug text-foreground">
        ดอกเบี้ยรายงวด
      </h3>
      <p className="mt-1 text-xs leading-snug text-muted-foreground">
        ใส่ดอกเบี้ยรวมทั้งสัญญาแยกตามจำนวนงวด เช่น 10 งวด 50% · มีตารางนี้แล้ว สัญญาและหน้าราคาจะใช้อัตราในตาราง
        และเลือกได้เฉพาะงวดที่มีในตาราง
      </p>

      {rows.length === 0 ? (
        <p className="mt-3 text-xs leading-snug text-muted-foreground">
          ยังไม่มีตาราง — ใช้ดอกเบี้ยต่อเดือน × จำนวนงวด และเลือกได้ทุกงวดในช่วงต่ำสุด–สูงสุด
        </p>
      ) : (
        <div className="mt-3 space-y-2">
          {rows.map((row, index) => (
            <div key={index} className="grid grid-cols-[1fr_1fr_auto] items-end gap-2">
              <div>
                <label htmlFor={`${fieldId}-m-${index}`} className="mb-1 block text-xs text-muted-foreground">
                  จำนวนงวด
                </label>
                <NumberInput
                  unstyled
                  id={`${fieldId}-m-${index}`}
                  min="1"
                  step="1"
                  value={row.months}
                  onChange={(e) => update(index, { months: Number(e.target.value) })}
                  className={cn(formControlClass, 'w-full')}
                />
              </div>
              <div>
                <label htmlFor={`${fieldId}-r-${index}`} className="mb-1 block text-xs text-muted-foreground">
                  ดอกเบี้ยรวม (%)
                </label>
                <NumberInput
                  unstyled
                  id={`${fieldId}-r-${index}`}
                  min="0"
                  step="0.01"
                  value={row.ratePct}
                  onChange={(e) => update(index, { ratePct: Number(e.target.value) })}
                  className={cn(formControlClass, 'w-full')}
                />
              </div>
              <button
                type="button"
                data-ui-control="button"
                aria-label={`ลบแถว ${row.months} งวด`}
                onClick={() => onChange(rows.filter((_, i) => i !== index))}
                className="rounded-lg px-3 text-sm text-destructive hover:bg-destructive/10"
              >
                ลบ
              </button>
            </div>
          ))}
        </div>
      )}

      <button
        type="button"
        data-ui-control="button"
        onClick={() => onChange([...rows, { months: 12, ratePct: 50 }])}
        className="mt-3 rounded-lg border border-input px-3 text-sm text-foreground hover:bg-accent"
      >
        + เพิ่มงวด
      </button>
      {error && <p className="mt-2 text-xs leading-snug text-destructive">{error}</p>}
    </section>
  );
}
