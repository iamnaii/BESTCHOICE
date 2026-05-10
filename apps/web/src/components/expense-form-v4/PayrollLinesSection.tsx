import { Plus, Trash2 } from 'lucide-react';
import { PayrollFormFields, newPayrollLine } from './types';
import { formatNumberDecimal } from '@/utils/formatters';
import ThaiDateInput from '@/components/ui/ThaiDateInput';
import { THAI_MONTHS_FULL } from '@/lib/date';

interface Props {
  value: PayrollFormFields;
  onChange: (v: PayrollFormFields) => void;
  documentDate: string;
  onDocumentDateChange: (d: string) => void;
}

export function PayrollLinesSection({ value, onChange, documentDate, onDocumentDateChange }: Props) {
  const updateField = (patch: Partial<PayrollFormFields>) => onChange({ ...value, ...patch });

  const updateLine = (uid: string, p: Partial<(typeof value.lines)[number]>) => {
    onChange({ ...value, lines: value.lines.map((l) => (l.uid === uid ? { ...l, ...p } : l)) });
  };
  const removeLine = (uid: string) => {
    if (value.lines.length === 1) return;
    onChange({ ...value, lines: value.lines.filter((l) => l.uid !== uid) });
  };
  const addLine = () => onChange({ ...value, lines: [...value.lines, newPayrollLine()] });

  const computed = value.lines.map((l) => {
    const base = parseFloat(l.baseSalary) || 0;
    const sso = parseFloat(l.ssoEmployee) || 0;
    const wht = parseFloat(l.whtAmount) || 0;
    return { ...l, netPaid: Math.max(0, base - sso - wht), baseN: base, ssoN: sso, whtN: wht };
  });
  const sumBase = computed.reduce((s, l) => s + l.baseN, 0);
  const sumSso = computed.reduce((s, l) => s + l.ssoN, 0);
  const sumWht = computed.reduce((s, l) => s + l.whtN, 0);
  const sumNet = computed.reduce((s, l) => s + l.netPaid, 0);

  const today = new Date();
  const currentBuddhistYear = today.getFullYear() + 543;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-4">
        <div>
          <label className="block text-xs font-medium mb-1">ปี (พ.ศ.)</label>
          <select
            value={value.year}
            onChange={(e) => {
              const y = Number(e.target.value);
              updateField({
                year: y,
                payrollPeriod: `${y - 543}-${String(value.month).padStart(2, '0')}`,
              });
            }}
            className="w-full px-3 py-2 border border-input rounded-lg text-sm bg-background"
          >
            {[0, 1, 2, 3, 4].map((offset) => {
              const y = currentBuddhistYear - offset;
              return (
                <option key={y} value={y}>
                  {y}
                </option>
              );
            })}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium mb-1">เดือน</label>
          <select
            value={value.month}
            onChange={(e) => {
              const m = Number(e.target.value);
              updateField({
                month: m,
                payrollPeriod: `${value.year - 543}-${String(m).padStart(2, '0')}`,
              });
            }}
            className="w-full px-3 py-2 border border-input rounded-lg text-sm bg-background"
          >
            {THAI_MONTHS_FULL.map((label, idx) => (
              <option key={idx} value={idx + 1}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium mb-1">
            วันที่จ่ายเงิน <span className="text-destructive">*</span>
          </label>
          <ThaiDateInput
            value={documentDate}
            onChange={(e) => onDocumentDateChange(e.target.value)}
            required
            className="w-full px-3 py-2 border border-input rounded-lg text-sm bg-background"
          />
        </div>
      </div>

      <div className="rounded-xl border border-border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="text-left px-3 py-2 font-medium">
                ชื่อ <span className="text-destructive">*</span>
              </th>
              <th className="text-left px-3 py-2 font-medium">เลขบัตร</th>
              <th className="text-right px-3 py-2 font-medium">
                ฐาน <span className="text-destructive">*</span>
              </th>
              <th className="text-right px-3 py-2 font-medium">SSO</th>
              <th className="text-right px-3 py-2 font-medium">WHT</th>
              <th className="text-right px-3 py-2 font-medium">สุทธิ</th>
              <th className="px-3 py-2 w-8"></th>
            </tr>
          </thead>
          <tbody>
            {computed.map((row) => (
              <tr key={row.uid} className="border-t border-border">
                <td className="px-2 py-1">
                  <input
                    type="text"
                    value={row.employeeName}
                    onChange={(e) => updateLine(row.uid, { employeeName: e.target.value })}
                    placeholder="ชื่อ-สกุล"
                    className="w-full px-2 py-1.5 border border-input rounded text-sm bg-background"
                  />
                </td>
                <td className="px-2 py-1">
                  <input
                    type="text"
                    value={row.employeeTaxId}
                    onChange={(e) => updateLine(row.uid, { employeeTaxId: e.target.value })}
                    placeholder="13 หลัก"
                    maxLength={13}
                    className="w-full px-2 py-1.5 border border-input rounded text-sm bg-background"
                  />
                </td>
                <td className="px-2 py-1">
                  <input
                    type="number"
                    step="0.01"
                    value={row.baseSalary}
                    onChange={(e) => updateLine(row.uid, { baseSalary: e.target.value })}
                    className="w-full px-2 py-1.5 border border-input rounded text-sm bg-background text-right font-mono"
                  />
                </td>
                <td className="px-2 py-1">
                  <input
                    type="number"
                    step="0.01"
                    value={row.ssoEmployee}
                    onChange={(e) => updateLine(row.uid, { ssoEmployee: e.target.value })}
                    className="w-full px-2 py-1.5 border border-input rounded text-sm bg-background text-right font-mono"
                  />
                </td>
                <td className="px-2 py-1">
                  <input
                    type="number"
                    step="0.01"
                    value={row.whtAmount}
                    onChange={(e) => updateLine(row.uid, { whtAmount: e.target.value })}
                    className="w-full px-2 py-1.5 border border-input rounded text-sm bg-background text-right font-mono"
                  />
                </td>
                <td className="px-3 py-2 text-right font-mono">
                  {formatNumberDecimal(row.netPaid)}
                </td>
                <td className="px-2 py-1 text-center">
                  <button
                    type="button"
                    onClick={() => removeLine(row.uid)}
                    disabled={value.lines.length === 1}
                    className="text-muted-foreground hover:text-destructive disabled:opacity-30"
                    aria-label="ลบ"
                  >
                    <Trash2 className="size-4" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot className="bg-muted/30 border-t border-border">
            <tr>
              <td colSpan={2} className="px-3 py-2 text-right font-medium">
                รวม
              </td>
              <td className="px-3 py-2 text-right font-mono font-semibold">
                {formatNumberDecimal(sumBase)}
              </td>
              <td className="px-3 py-2 text-right font-mono font-semibold">
                {formatNumberDecimal(sumSso)}
              </td>
              <td className="px-3 py-2 text-right font-mono font-semibold">
                {formatNumberDecimal(sumWht)}
              </td>
              <td className="px-3 py-2 text-right font-mono font-semibold text-primary">
                {formatNumberDecimal(sumNet)}
              </td>
              <td></td>
            </tr>
          </tfoot>
        </table>
      </div>

      <button
        type="button"
        onClick={addLine}
        className="w-full flex items-center justify-center gap-1.5 py-2 border-2 border-dashed border-border rounded-lg text-sm text-muted-foreground hover:text-foreground hover:border-primary"
      >
        <Plus className="size-4" /> เพิ่มพนักงาน
      </button>
    </div>
  );
}
