import { NumberInput } from '@/components/ui/NumberInput';
import { NativeSelect } from '@/components/ui/native-select';
import { formControlClass } from '@/components/ui/form-styles';
import { useId as useFieldId } from 'react';
import { useCoaGroups } from '@/hooks/useCoa';
import { Plus, Trash2 } from 'lucide-react';
import { ExpenseLineForm, newLine } from './types';
import { formatNumberDecimal } from '@/utils/formatters';
import { accountDisplayName } from '@/utils/accountName';
import { useUiFlags } from '@/hooks/useUiFlags';
import { whtRatesToSelectOptions } from '@/lib/wht-rates';
import TaxDisallowedHint from './TaxDisallowedHint';

interface Props {
  lines: ExpenseLineForm[];
  onChange: (lines: ExpenseLineForm[]) => void;
  priceTypeLabel: string; // 'รวม VAT' | 'ไม่รวม VAT' for display
}

export function ItemLinesSection({ lines, onChange, priceTypeLabel }: Props) {
  const fieldId = useFieldId();
  const { data: coaData } = useCoaGroups({ type: 'ค่าใช้จ่าย' });
  const groups = coaData?.groups ?? [];

  // D1.1.3.2 — WHT% options sourced from SystemConfig `wht_rates`.
  // D1.1.3.5 — filter out future-dated entries client-side via helper.
  const { whtRates } = useUiFlags();
  const whtOptions = whtRatesToSelectOptions(whtRates);

  const updateLine = (uid: string, patch: Partial<ExpenseLineForm>) => {
    onChange(lines.map((l) => (l.uid === uid ? { ...l, ...patch } : l)));
  };
  const removeLine = (uid: string) => {
    if (lines.length === 1) return; // keep at least 1
    onChange(lines.filter((l) => l.uid !== uid));
  };
  const addLine = () => {
    onChange([...lines, newLine()]);
  };

  const computeBeforeVat = (l: ExpenseLineForm): string => {
    const q = parseFloat(l.quantity) || 0;
    const u = parseFloat(l.unitPrice) || 0;
    const d = parseFloat(l.discount) || 0;
    return Math.max(0, q * u - d).toFixed(2);
  };

  return (
    <div className="space-y-3">
      {lines.map((line, idx) => (
        <div key={line.uid} className="rounded-xl border border-border bg-card">
          <div className="flex items-center justify-between border-b border-border px-4 py-2">
            <div className="flex items-center gap-2 text-sm font-medium">
              <span className="font-mono text-xs text-muted-foreground">#{idx + 1}</span>
              <span>{line.category || 'เลือกบัญชี'}</span>
            </div>
            <button data-ui-control="button"
              type="button"
              onClick={() => removeLine(line.uid)}
              disabled={lines.length === 1}
              className="flex min-h-11 min-w-11 items-center justify-center rounded-md text-muted-foreground hover:text-destructive disabled:opacity-30"
              aria-label="ลบรายการ"
            >
              <Trash2 className="size-4" />
            </button>
          </div>
          <div className="space-y-3 p-4">
            <div>
              <label htmlFor={`${fieldId}-${line.uid}-1`} className="mb-1 block text-xs font-medium">บัญชีค่าใช้จ่าย</label>
              <NativeSelect wrapperClassName="max-w-full w-full min-w-0" id={`${fieldId}-${line.uid}-1`}
                value={line.category}
                onChange={(e) => updateLine(line.uid, { category: e.target.value })}
                className={formControlClass}
              >
                <option value="">— เลือก —</option>
                {groups.flatMap((g) =>
                  g.accounts.map((a) => (
                    <option key={a.code} value={a.code}>
                      {accountDisplayName(a.name)}
                    </option>
                  )),
                )}
              </NativeSelect>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
              <Field
                label="จำนวน"
                value={line.quantity}
                onChange={(v) => updateLine(line.uid, { quantity: v })}
              />
              <Field
                label="ราคา/หน่วย"
                value={line.unitPrice}
                onChange={(v) => updateLine(line.uid, { unitPrice: v })}
              />
              <Field
                label="ส่วนลด"
                value={line.discount}
                onChange={(v) => updateLine(line.uid, { discount: v })}
              />
              <SelectField
                label="VAT%"
                value={line.vatPercent}
                onChange={(v) => updateLine(line.uid, { vatPercent: v })}
                options={['0', '7']}
              />
              <SelectFieldLabeled
                label="WHT%"
                value={line.whtPercent}
                onChange={(v) => updateLine(line.uid, { whtPercent: v })}
                options={whtOptions}
              />
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">ก่อนภาษี</label>
                <div className="rounded-lg border border-border bg-muted/50 px-3 py-2 text-right font-mono text-sm">
                  {formatNumberDecimal(computeBeforeVat(line))}
                </div>
              </div>
            </div>
            <div>
              <label htmlFor={`${fieldId}-${line.uid}-2`} className="mb-1 block text-xs font-medium">คำอธิบาย</label>
              <input id={`${fieldId}-${line.uid}-2`}
                type="text"
                value={line.description}
                onChange={(e) => updateLine(line.uid, { description: e.target.value })}
                placeholder="ค่าไฟฟ้าสาขา A เดือน เม.ย. 2569"
                className={formControlClass}
              />
            </div>
            {/* Phase A.5 — Per-line tax-disallowed override.
                Rare path — set only when this single line is non-deductible
                while the rest of the doc is deductible (or vice versa).
                Effective rule = doc-level OR line-level.
                Owner B2 (2026-05-17): compact ม.65 ตรี popover next to
                the checkbox so line-level users see the same category
                list. */}
            <div className="flex items-start gap-2">
              <label className="flex items-start gap-2 text-xs cursor-pointer text-muted-foreground hover:text-foreground transition-colors flex-1">
                <input
                  type="checkbox"
                  checked={line.taxDisallowed === true}
                  onChange={(e) => updateLine(line.uid, { taxDisallowed: e.target.checked })}
                  className="mt-0.5"
                />
                <span>
                  บรรทัดนี้เป็น <span className="font-medium">ค่าใช้จ่ายต้องห้าม</span> (ใช้เฉพาะกรณีเอกสารปนรายการที่หักได้+หักไม่ได้ — ปกติติ๊กที่ระดับเอกสารแทน)
                </span>
              </label>
              <TaxDisallowedHint compact />
            </div>
          </div>
        </div>
      ))}
      <button data-ui-control="button"
        type="button"
        onClick={addLine}
        className="flex w-full items-center justify-center gap-1.5 rounded-xl border-2 border-dashed border-border py-3 text-sm text-muted-foreground hover:border-primary hover:text-foreground"
      >
        <Plus className="size-4" /> เพิ่มบัญชี
      </button>
      <p className="text-xs text-muted-foreground">
        {priceTypeLabel} — ระบบคำนวณ VAT และภาษีหัก ณ ที่จ่ายเมื่อดูตัวอย่างหรือบันทึก
      </p>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const fieldId = useFieldId();
  return (
    <div>
      <label htmlFor={`${fieldId}-3`} className="mb-1 block text-xs font-medium">{label}</label>
      <NumberInput unstyled id={`${fieldId}-3`}
        step="0.01"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`${formControlClass} text-right tabular-nums`}
      />
    </div>
  );
}

function SelectField({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
}) {
  const fieldId = useFieldId();
  return (
    <div>
      <label htmlFor={`${fieldId}-4`} className="mb-1 block text-xs font-medium">{label}</label>
      <NativeSelect wrapperClassName="max-w-full w-full min-w-0" id={`${fieldId}-4`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={formControlClass}
      >
        {options.map((o) => (
          <option key={o} value={o}>
            {o}%
          </option>
        ))}
      </NativeSelect>
    </div>
  );
}

/**
 * D1.1.3.2 — labelled-option variant for WHT% where the configured rate
 * carries a Thai explanation (e.g. "3% — ค่าบริการ"). Used in lieu of
 * plain `SelectField` when option labels diverge from the raw value.
 */
function SelectFieldLabeled({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  const fieldId = useFieldId();
  return (
    <div>
      <label htmlFor={`${fieldId}-5`} className="mb-1 block text-xs font-medium">{label}</label>
      <NativeSelect wrapperClassName="max-w-full w-full min-w-0" id={`${fieldId}-5`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={formControlClass}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </NativeSelect>
    </div>
  );
}
