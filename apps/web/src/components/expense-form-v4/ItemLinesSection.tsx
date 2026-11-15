import { NumberInput } from '@/components/ui/NumberInput';
import { NativeSelect } from '@/components/ui/native-select';
import { formControlClass, formLabelClass } from '@/components/ui/form-styles';
import { ReadOnlyField } from '@/components/ui/readonly-field';
import { useId as useFieldId } from 'react';
import { useCoaGroups } from '@/hooks/useCoa';
import { Plus, Trash2 } from 'lucide-react';
import { ExpenseLineForm, newLine } from './types';
import { formatNumberDecimal } from '@/utils/formatters';
import { useUiFlags } from '@/hooks/useUiFlags';
import { whtRatesToSelectOptions } from '@/lib/wht-rates';
import TaxDisallowedHint from './TaxDisallowedHint';
import { useIsMobile } from '@/hooks/useIsMobile';
import { AccountSearchDropdown } from '@/pages/other-income/components/AccountSearchDropdown';
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select';

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
  // อัตรา 0 ที่ตั้งไว้ในค่าระบบซ้ำกับตัวเลือก 0% ที่ helper ใส่ให้เสมอ — ค่าซ้ำทำให้ key ซ้ำและ Select มีสองตัวเลือกค่าเดียวกัน
  const whtOptions = whtRatesToSelectOptions(whtRates).filter(
    (o, i, all) => all.findIndex((x) => x.value === o.value) === i,
  );
  const isMobile = useIsMobile();

  // ชุดบัญชีเดิมของ dropdown นี้ — AccountSearchDropdown โหลดผังทั้งหมด จึงกรองด้วยรหัสชุดนี้
  const expenseCodes = new Set(groups.flatMap((g) => g.accounts.map((a) => a.code)));
  const accountPicker = (line: ExpenseLineForm) => (
    <AccountSearchDropdown
      aria-label="บัญชีค่าใช้จ่าย"
      value={line.category}
      onChange={(code) => updateLine(line.uid, { category: code })}
      filter={(a) => expenseCodes.has(a.code)}
      placeholder="— เลือก —"
    />
  );

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

  const footer = (
    <>
      <button data-ui-control="button"
        type="button"
        onClick={addLine}
        className="flex min-h-11 w-full items-center justify-center gap-1.5 rounded-xl border-2 border-dashed border-border py-3 text-sm text-muted-foreground hover:border-primary hover:text-foreground lg:w-auto lg:px-6"
      >
        <Plus className="size-4" /> เพิ่มบัญชี
      </button>
      <p className="text-xs leading-snug text-muted-foreground">
        {priceTypeLabel} — ระบบคำนวณ VAT และภาษีหัก ณ ที่จ่ายเมื่อดูตัวอย่างหรือบันทึก
      </p>
    </>
  );

  if (isMobile) {
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
                {/* ปุ่มเลือกบัญชีมีชื่อจาก aria-label แล้ว — ป้ายนี้เป็นตัวหนังสือบนจอ */}
                <span className={formLabelClass}>บัญชีค่าใช้จ่าย</span>
                {accountPicker(line)}
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
                  <label htmlFor={`${fieldId}-${line.uid}-before-vat`} className={formLabelClass}>จำนวนเงิน</label>
                  <ReadOnlyField
                    id={`${fieldId}-${line.uid}-before-vat`}
                    align="end"
                    value={formatNumberDecimal(computeBeforeVat(line))}
                    className="font-mono"
                  />
                </div>
              </div>
              <div>
                <label htmlFor={`${fieldId}-${line.uid}-2`} className={formLabelClass}>คำอธิบาย</label>
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
        {footer}
      </div>
    );
  }

  const cell = 'px-[3px] py-1.5 align-top';
  // ช่องตัวเลขในตาราง: กรอบ 44px เท่าช่องอื่น แต่ระยะซ้ายขวาแคบลงให้พอกับคอลัมน์ 96px
  const num = `${formControlClass} px-2 text-right tabular-nums`;
  const head = 'px-2 py-2.5 text-xs font-semibold leading-snug text-muted-foreground whitespace-nowrap';
  return (
    <div className="space-y-3">
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-[52rem] table-fixed text-sm">
          <colgroup>
            <col className="w-6" />
            <col />
            <col className="w-19" />
            <col className="w-24" />
            <col className="w-24" />
            <col className="w-16" />
            <col className="w-24" />
            <col className="w-19" />
            <col className="w-11" />
          </colgroup>
          <thead className="bg-muted/50">
            <tr>
              <th scope="col" className={`${head} text-center`}>#</th>
              <th scope="col" className={`${head} text-left`}>บัญชีค่าใช้จ่าย / คำอธิบาย</th>
              <th scope="col" className={`${head} text-right`}>จำนวน</th>
              <th scope="col" className={`${head} text-right`}>ราคา/หน่วย</th>
              <th scope="col" className={`${head} text-right`}>ส่วนลด</th>
              <th scope="col" className={`${head} text-right`}>VAT%</th>
              <th scope="col" className={`${head} text-right`}>จำนวนเงิน</th>
              <th scope="col" className={`${head} text-right`}>WHT%</th>
              <th scope="col" className={head}><span className="sr-only">ลบ</span></th>
            </tr>
          </thead>
          {/* สัดส่วนคอลัมน์ตามหน้า PEAK (ตัวเลขทั้งหมดแถวเดียว · คำอธิบายอยู่แถวล่างใต้บัญชี) */}
          {lines.map((line, idx) => (
            <tbody key={line.uid} className="border-t border-border">
              <tr>
                <td rowSpan={2} className={`${cell} pt-4 text-center text-xs text-muted-foreground`}>{idx + 1}</td>
                <td className={cell}>{accountPicker(line)}</td>
                <td className={cell}>
                  <NumberInput unstyled id={`${fieldId}-${line.uid}-q`} aria-label="จำนวน" step="0.01"
                    value={line.quantity}
                    onChange={(e) => updateLine(line.uid, { quantity: e.target.value })}
                    className={num} />
                </td>
                <td className={cell}>
                  <NumberInput unstyled id={`${fieldId}-${line.uid}-u`} aria-label="ราคา/หน่วย" step="0.01"
                    value={line.unitPrice}
                    onChange={(e) => updateLine(line.uid, { unitPrice: e.target.value })}
                    className={num} />
                </td>
                <td className={cell}>
                  <NumberInput unstyled id={`${fieldId}-${line.uid}-d`} aria-label="ส่วนลด" step="0.01"
                    value={line.discount}
                    onChange={(e) => updateLine(line.uid, { discount: e.target.value })}
                    className={num} />
                </td>
                <td className={cell}>
                  {/* h-11: ปุ่มสูงเท่าช่องตัวเลขข้าง ๆ (min-h-11 ของ peak-constraints) */}
                  <Select value={line.vatPercent} onValueChange={(v) => updateLine(line.uid, { vatPercent: v })}>
                    <SelectTrigger aria-label="VAT%" className="h-11 w-full px-2">
                      <span className="tabular-nums">{line.vatPercent}%</span>
                    </SelectTrigger>
                    <SelectContent align="end">
                      <SelectItem value="0">0%</SelectItem>
                      <SelectItem value="7">7%</SelectItem>
                    </SelectContent>
                  </Select>
                </td>
                <td className={`${cell} px-2 pt-4 text-right font-medium tabular-nums`}>
                  {formatNumberDecimal(computeBeforeVat(line))}
                </td>
                <td className={cell}>
                  {/* ช่องแคบแบบ PEAK: ปุ่มแสดงแค่อัตรา · รายการที่เปิดออกมาแสดงคำอธิบายเต็ม ("3% — ค่าบริการ") */}
                  <Select value={line.whtPercent} onValueChange={(v) => updateLine(line.uid, { whtPercent: v })}>
                    <SelectTrigger aria-label="WHT%" className="h-11 w-full px-2">
                      <span className="tabular-nums">{`${parseFloat(line.whtPercent) || 0}%`}</span>
                    </SelectTrigger>
                    <SelectContent align="end">
                      {whtOptions.map((o) => (
                        <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </td>
                <td rowSpan={2} className={`${cell} px-0`}>
                  <button data-ui-control="button"
                    type="button"
                    onClick={() => removeLine(line.uid)}
                    disabled={lines.length === 1}
                    className="flex min-h-11 w-full items-center justify-center rounded-md text-muted-foreground hover:text-destructive disabled:opacity-30"
                    aria-label="ลบรายการ"
                  >
                    <Trash2 className="size-4" />
                  </button>
                </td>
              </tr>
              <tr>
                <td className={`${cell} pt-0 pb-2.5`}>
                  <input id={`${fieldId}-${line.uid}-2`}
                    type="text"
                    aria-label="คำอธิบาย"
                    value={line.description}
                    onChange={(e) => updateLine(line.uid, { description: e.target.value })}
                    placeholder="คำอธิบายรายการ"
                    className={formControlClass}
                  />
                </td>
                <td colSpan={6} className={`${cell} pt-0 pb-2.5`}>
                  <div className="flex min-h-11 items-center gap-2 pl-1.5">
                    <label className="flex cursor-pointer items-center gap-2 text-xs leading-snug text-muted-foreground hover:text-foreground">
                      <input
                        type="checkbox"
                        checked={line.taxDisallowed === true}
                        onChange={(e) => updateLine(line.uid, { taxDisallowed: e.target.checked })}
                      />
                      <span>บรรทัดนี้เป็น <span className="font-medium">ค่าใช้จ่ายต้องห้าม</span></span>
                    </label>
                    <TaxDisallowedHint compact />
                  </div>
                </td>
              </tr>
            </tbody>
          ))}
        </table>
      </div>
      {footer}
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
      <label htmlFor={`${fieldId}-3`} className={formLabelClass}>{label}</label>
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
      <label htmlFor={`${fieldId}-4`} className={formLabelClass}>{label}</label>
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
      <label htmlFor={`${fieldId}-5`} className={formLabelClass}>{label}</label>
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
