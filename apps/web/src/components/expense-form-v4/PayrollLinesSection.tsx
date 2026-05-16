import { AlertTriangle, ChevronDown, ChevronRight, Plus, Trash2 } from 'lucide-react';
import {
  PayrollFormFields,
  PayrollLineForm,
  PayrollCustomIncomeRow,
  PayrollCustomDeductionRow,
  newPayrollLine,
  newPayrollCustomIncome,
  newPayrollCustomDeduction,
} from './types';
import { formatNumberDecimal } from '@/utils/formatters';
import ThaiDateInput from '@/components/ui/ThaiDateInput';
import { THAI_MONTHS_FULL } from '@/lib/date';
import { useUiFlags } from '@/hooks/useUiFlags';

interface Props {
  value: PayrollFormFields;
  onChange: (v: PayrollFormFields) => void;
  documentDate: string;
  onDocumentDateChange: (d: string) => void;
}

// C2 — Whitelist of custom income account codes (Settings: custom_income_accounts_whitelist).
// Hard-coded here matches the migration seed default. UI can resync from
// API later when /settings page exposes the whitelist editor.
const CUSTOM_INCOME_WHITELIST: { code: string; label: string }[] = [
  { code: '53-1104', label: '53-1104 โบนัส' },
  { code: '53-1105', label: '53-1105 ค่าล่วงเวลา (OT)' },
];

export function PayrollLinesSection({ value, onChange, documentDate, onDocumentDateChange }: Props) {
  const { taxExemptWarningEnabled } = useUiFlags();
  const updateField = (patch: Partial<PayrollFormFields>) => onChange({ ...value, ...patch });

  const updateLine = (uid: string, p: Partial<PayrollLineForm>) => {
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
    const income = (l.customIncome ?? []).reduce(
      (s, r) => s + (parseFloat(r.amount) || 0),
      0,
    );
    const deduction = (l.customDeduction ?? []).reduce(
      (s, r) => s + (parseFloat(r.amount) || 0),
      0,
    );
    const taxableBase = (l.customIncome ?? [])
      .filter((r) => r.isTaxable)
      .reduce((s, r) => s + (parseFloat(r.amount) || 0), base);
    const netPaid = Math.max(0, base + income - sso - wht - deduction);
    const hasExtras = (l.customIncome?.length ?? 0) + (l.customDeduction?.length ?? 0) > 0;
    return {
      ...l,
      baseN: base,
      ssoN: sso,
      whtN: wht,
      incomeN: income,
      deductionN: deduction,
      taxableBaseN: taxableBase,
      netPaid,
      hasExtras,
    };
  });
  const sumBase = computed.reduce((s, l) => s + l.baseN, 0);
  const sumSso = computed.reduce((s, l) => s + l.ssoN, 0);
  const sumWht = computed.reduce((s, l) => s + l.whtN, 0);
  const sumIncome = computed.reduce((s, l) => s + l.incomeN, 0);
  const sumDeduction = computed.reduce((s, l) => s + l.deductionN, 0);
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
              <th className="w-8 px-2 py-2"></th>
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
              <PayrollRow
                key={row.uid}
                row={row}
                disableRemove={value.lines.length === 1}
                onUpdate={(p) => updateLine(row.uid, p)}
                onRemove={() => removeLine(row.uid)}
              />
            ))}
          </tbody>
          <tfoot className="bg-muted/30 border-t border-border">
            <tr>
              <td></td>
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
            {(sumIncome > 0 || sumDeduction > 0) && (
              <tr className="text-xs">
                <td></td>
                <td colSpan={6} className="px-3 py-1 text-right text-muted-foreground">
                  รวมรายได้พิเศษ {formatNumberDecimal(sumIncome)} · รวมหัก {formatNumberDecimal(sumDeduction)}
                  {' · สุทธิ = ฐาน + รายได้พิเศษ − SSO − WHT − หัก'}
                </td>
                <td></td>
              </tr>
            )}
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

function PayrollRow({
  row,
  disableRemove,
  onUpdate,
  onRemove,
}: {
  row: PayrollLineForm & {
    netPaid: number;
    baseN: number;
    ssoN: number;
    whtN: number;
    incomeN: number;
    deductionN: number;
    taxableBaseN: number;
    hasExtras: boolean;
  };
  disableRemove: boolean;
  onUpdate: (p: Partial<PayrollLineForm>) => void;
  onRemove: () => void;
}) {
  const expanded = row._expanded === true;

  const updateIncome = (rows: PayrollCustomIncomeRow[]) => onUpdate({ customIncome: rows });
  const updateDeduction = (rows: PayrollCustomDeductionRow[]) =>
    onUpdate({ customDeduction: rows });

  return (
    <>
      <tr className="border-t border-border">
        <td className="px-2 py-1 text-center">
          <button
            type="button"
            onClick={() => onUpdate({ _expanded: !expanded })}
            className="text-muted-foreground hover:text-foreground"
            aria-label={expanded ? 'ย่อ' : 'ขยาย'}
            aria-expanded={expanded}
          >
            {expanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
          </button>
        </td>
        <td className="px-2 py-1">
          <input
            type="text"
            value={row.employeeName}
            onChange={(e) => onUpdate({ employeeName: e.target.value })}
            placeholder="ชื่อ-สกุล"
            className="w-full px-2 py-1.5 border border-input rounded text-sm bg-background"
          />
        </td>
        <td className="px-2 py-1">
          <input
            type="text"
            value={row.employeeTaxId}
            onChange={(e) => onUpdate({ employeeTaxId: e.target.value })}
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
            onChange={(e) => onUpdate({ baseSalary: e.target.value })}
            className="w-full px-2 py-1.5 border border-input rounded text-sm bg-background text-right font-mono"
          />
        </td>
        <td className="px-2 py-1">
          <input
            type="number"
            step="0.01"
            value={row.ssoEmployee}
            onChange={(e) => onUpdate({ ssoEmployee: e.target.value })}
            className="w-full px-2 py-1.5 border border-input rounded text-sm bg-background text-right font-mono"
          />
        </td>
        <td className="px-2 py-1">
          <input
            type="number"
            step="0.01"
            value={row.whtAmount}
            onChange={(e) => onUpdate({ whtAmount: e.target.value })}
            className="w-full px-2 py-1.5 border border-input rounded text-sm bg-background text-right font-mono"
          />
        </td>
        <td className="px-3 py-2 text-right font-mono">
          {formatNumberDecimal(row.netPaid)}
          {row.hasExtras && (
            <div className="text-[10px] text-muted-foreground mt-0.5">
              +{formatNumberDecimal(row.incomeN)} / −{formatNumberDecimal(row.deductionN)}
            </div>
          )}
        </td>
        <td className="px-2 py-1 text-center">
          <button
            type="button"
            onClick={onRemove}
            disabled={disableRemove}
            className="text-muted-foreground hover:text-destructive disabled:opacity-30"
            aria-label="ลบ"
          >
            <Trash2 className="size-4" />
          </button>
        </td>
      </tr>
      {expanded && (
        <tr className="border-t border-border bg-muted/10">
          <td></td>
          <td colSpan={7} className="px-3 py-3 space-y-3">
            <CustomIncomeSubTable rows={row.customIncome ?? []} onChange={updateIncome} />
            <CustomDeductionSubTable rows={row.customDeduction ?? []} onChange={updateDeduction} />
            {row.taxableBaseN !== row.baseN && (
              <div className="text-xs text-muted-foreground italic">
                ฐานคำนวณ WHT = {formatNumberDecimal(row.taxableBaseN)} (รวมรายได้พิเศษที่เสียภาษี)
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

function CustomIncomeSubTable({
  rows,
  onChange,
}: {
  rows: PayrollCustomIncomeRow[];
  onChange: (rows: PayrollCustomIncomeRow[]) => void;
}) {
  const { taxExemptWarningEnabled } = useUiFlags();
  const update = (uid: string, p: Partial<PayrollCustomIncomeRow>) =>
    onChange(rows.map((r) => (r.uid === uid ? { ...r, ...p } : r)));
  const remove = (uid: string) => onChange(rows.filter((r) => r.uid !== uid));
  const add = () => onChange([...rows, newPayrollCustomIncome()]);

  // D1.2.8.2 — show ม.42 tax-exempt warning when any row marked non-taxable.
  // Gated by SystemConfig TAX_EXEMPT_WARNING_ENABLED (default true, OWNER toggleable).
  const taxExemptRows = rows.filter((r) => !r.isTaxable);
  const showWarning =
    taxExemptWarningEnabled && taxExemptRows.length > 0;

  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      <div className="bg-emerald-50 dark:bg-emerald-950/30 px-3 py-1.5 text-xs font-medium text-emerald-900 dark:text-emerald-100">
        + รายได้พิเศษ (โบนัส / OT / เบี้ยเลี้ยง)
      </div>
      <table className="w-full text-xs">
        <thead className="bg-muted/30 text-muted-foreground">
          <tr>
            <th className="text-left px-2 py-1 w-40">บัญชี</th>
            <th className="text-left px-2 py-1">รายการ</th>
            <th className="text-right px-2 py-1 w-28">จำนวน</th>
            <th className="text-center px-2 py-1 w-16">ภาษี</th>
            <th className="w-8"></th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={5} className="px-2 py-2 text-center text-muted-foreground italic">
                ไม่มี
              </td>
            </tr>
          )}
          {rows.map((r) => (
            <tr key={r.uid} className="border-t border-border">
              <td className="px-2 py-1">
                <select
                  value={r.accountCode}
                  onChange={(e) => update(r.uid, { accountCode: e.target.value })}
                  className="w-full px-1.5 py-1 border border-input rounded text-xs bg-background"
                >
                  {CUSTOM_INCOME_WHITELIST.map((opt) => (
                    <option key={opt.code} value={opt.code}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </td>
              <td className="px-2 py-1">
                <input
                  type="text"
                  value={r.name}
                  onChange={(e) => update(r.uid, { name: e.target.value })}
                  placeholder="คำอธิบาย"
                  className="w-full px-1.5 py-1 border border-input rounded text-xs bg-background"
                />
              </td>
              <td className="px-2 py-1">
                <input
                  type="number"
                  step="0.01"
                  value={r.amount}
                  onChange={(e) => update(r.uid, { amount: e.target.value })}
                  className="w-full px-1.5 py-1 border border-input rounded text-xs bg-background text-right font-mono"
                />
              </td>
              <td className="px-2 py-1 text-center">
                <label
                  className="inline-flex items-center gap-1 cursor-pointer text-xs"
                  title={r.isTaxable ? 'รายได้เสียภาษี' : 'ม.42 ยกเว้นภาษี'}
                >
                  <input
                    type="checkbox"
                    checked={r.isTaxable}
                    onChange={(e) => update(r.uid, { isTaxable: e.target.checked })}
                    className="size-3.5"
                  />
                  <span className={r.isTaxable ? '' : 'text-muted-foreground line-through'}>
                    เสีย
                  </span>
                </label>
              </td>
              <td className="px-1 py-1 text-center">
                <button
                  type="button"
                  onClick={() => remove(r.uid)}
                  className="text-muted-foreground hover:text-destructive"
                  aria-label="ลบรายได้พิเศษ"
                >
                  <Trash2 className="size-3" />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button
        type="button"
        onClick={add}
        className="w-full flex items-center justify-center gap-1 py-1.5 text-xs text-muted-foreground hover:text-foreground border-t border-border"
      >
        <Plus className="size-3" /> เพิ่มรายได้พิเศษ
      </button>
      {showWarning && (
        <div
          role="alert"
          className="flex items-start gap-2 px-3 py-2 border-t border-border bg-warning/5 text-warning"
        >
          <AlertTriangle className="size-3.5 mt-0.5 shrink-0" />
          <div className="text-xs leading-snug">
            <span className="font-medium">ยกเว้นภาษี ม.42</span> —{' '}
            มี {taxExemptRows.length} รายการที่ติ๊กไม่เสียภาษี
            (ป.รัษฎากร ม.42). ตรวจสอบให้แน่ใจว่าเข้าเงื่อนไข เช่น เงินชดเชย ค่าใช้จ่ายเดินทาง
            ตามอัตรา ก่อน POST เพราะ ภ.ง.ด.1 จะไม่นับฐานนี้
          </div>
        </div>
      )}
    </div>
  );
}

function CustomDeductionSubTable({
  rows,
  onChange,
}: {
  rows: PayrollCustomDeductionRow[];
  onChange: (rows: PayrollCustomDeductionRow[]) => void;
}) {
  const update = (uid: string, p: Partial<PayrollCustomDeductionRow>) =>
    onChange(rows.map((r) => (r.uid === uid ? { ...r, ...p } : r)));
  const remove = (uid: string) => onChange(rows.filter((r) => r.uid !== uid));
  const add = () => onChange([...rows, newPayrollCustomDeduction()]);

  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      <div className="bg-amber-50 dark:bg-amber-950/30 px-3 py-1.5 text-xs font-medium text-amber-900 dark:text-amber-100">
        − รายการหัก (คืนเงินยืม / ทดรองจ่าย / ค่ายูนิฟอร์ม)
      </div>
      <table className="w-full text-xs">
        <thead className="bg-muted/30 text-muted-foreground">
          <tr>
            <th className="text-left px-2 py-1 w-32">บัญชี</th>
            <th className="text-left px-2 py-1">รายการ</th>
            <th className="text-right px-2 py-1 w-28">จำนวน</th>
            <th className="w-8"></th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={4} className="px-2 py-2 text-center text-muted-foreground italic">
                ไม่มี
              </td>
            </tr>
          )}
          {rows.map((r) => (
            <tr key={r.uid} className="border-t border-border">
              <td className="px-2 py-1">
                <input
                  type="text"
                  value={r.accountCode}
                  onChange={(e) => update(r.uid, { accountCode: e.target.value })}
                  placeholder="11-2199"
                  className="w-full px-1.5 py-1 border border-input rounded text-xs bg-background font-mono"
                />
              </td>
              <td className="px-2 py-1">
                <input
                  type="text"
                  value={r.name}
                  onChange={(e) => update(r.uid, { name: e.target.value })}
                  placeholder="คำอธิบาย"
                  className="w-full px-1.5 py-1 border border-input rounded text-xs bg-background"
                />
              </td>
              <td className="px-2 py-1">
                <input
                  type="number"
                  step="0.01"
                  value={r.amount}
                  onChange={(e) => update(r.uid, { amount: e.target.value })}
                  className="w-full px-1.5 py-1 border border-input rounded text-xs bg-background text-right font-mono"
                />
              </td>
              <td className="px-1 py-1 text-center">
                <button
                  type="button"
                  onClick={() => remove(r.uid)}
                  className="text-muted-foreground hover:text-destructive"
                  aria-label="ลบรายการหัก"
                >
                  <Trash2 className="size-3" />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button
        type="button"
        onClick={add}
        className="w-full flex items-center justify-center gap-1 py-1.5 text-xs text-muted-foreground hover:text-foreground border-t border-border"
      >
        <Plus className="size-3" /> เพิ่มรายการหัก
      </button>
    </div>
  );
}
