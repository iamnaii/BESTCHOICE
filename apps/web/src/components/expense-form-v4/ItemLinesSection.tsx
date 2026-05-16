import { useCoaGroups } from '@/hooks/useCoa';
import { Plus, Trash2 } from 'lucide-react';
import { ExpenseLineForm, newLine } from './types';
import { formatNumberDecimal } from '@/utils/formatters';
import { useUiFlags } from '@/hooks/useUiFlags';

interface Props {
  lines: ExpenseLineForm[];
  onChange: (lines: ExpenseLineForm[]) => void;
  priceTypeLabel: string; // 'รวม VAT' | 'ไม่รวม VAT' for display
}

export function ItemLinesSection({ lines, onChange, priceTypeLabel }: Props) {
  const { data: coaData } = useCoaGroups({ type: 'ค่าใช้จ่าย' });
  const groups = coaData?.groups ?? [];

  // D1.1.3.2 — WHT% options sourced from SystemConfig `wht_rates`.
  // D1.1.3.5 — filter out future-dated entries client-side.
  const { whtRates } = useUiFlags();
  const today = new Date();
  const whtOptions: { value: string; label: string }[] = [
    { value: '0', label: '0%' },
    ...whtRates
      .filter((r) => !r.effectiveDate || new Date(r.effectiveDate) <= today)
      .map((r) => ({ value: String(r.rate), label: r.label })),
  ];

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
            <button
              type="button"
              onClick={() => removeLine(line.uid)}
              disabled={lines.length === 1}
              className="text-muted-foreground hover:text-destructive disabled:opacity-30"
              aria-label="ลบรายการ"
            >
              <Trash2 className="size-4" />
            </button>
          </div>
          <div className="space-y-3 p-4">
            <div>
              <label className="mb-1 block text-xs font-medium">บัญชีค่าใช้จ่าย</label>
              <select
                value={line.category}
                onChange={(e) => updateLine(line.uid, { category: e.target.value })}
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
              >
                <option value="">— เลือก —</option>
                {groups.flatMap((g) =>
                  g.accounts.map((a) => (
                    <option key={a.code} value={a.code}>
                      {a.code} — {a.name}
                    </option>
                  )),
                )}
              </select>
            </div>
            <div className="grid grid-cols-6 gap-2">
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
              <label className="mb-1 block text-xs font-medium">คำอธิบาย</label>
              <input
                type="text"
                value={line.description}
                onChange={(e) => updateLine(line.uid, { description: e.target.value })}
                placeholder="ค่าไฟฟ้าสาขา A เดือน เม.ย. 2569"
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
              />
            </div>
          </div>
        </div>
      ))}
      <button
        type="button"
        onClick={addLine}
        className="flex w-full items-center justify-center gap-1.5 rounded-xl border-2 border-dashed border-border py-3 text-sm text-muted-foreground hover:border-primary hover:text-foreground"
      >
        <Plus className="size-4" /> เพิ่มบัญชี
      </button>
      <p className="text-xs text-muted-foreground">
        {priceTypeLabel} — ยอด VAT/WHT คำนวณจาก server เมื่อกด Preview/บันทึก
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
  return (
    <div>
      <label className="mb-1 block text-xs font-medium">{label}</label>
      <input
        type="number"
        step="0.01"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-input bg-background px-3 py-2 text-right font-mono text-sm"
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
  return (
    <div>
      <label className="mb-1 block text-xs font-medium">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
      >
        {options.map((o) => (
          <option key={o} value={o}>
            {o}%
          </option>
        ))}
      </select>
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
  return (
    <div>
      <label className="mb-1 block text-xs font-medium">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}
