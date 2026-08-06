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
import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import { cn } from '@/lib/utils';
import EmployeeCombobox from '@/components/employees/EmployeeCombobox';
import { type PickableEmployee } from '@/lib/api/employees';
import { ssoConfigApi, ssoConfigKeys } from '@/lib/api/ssoConfig';

interface Props {
  value: PayrollFormFields;
  onChange: (v: PayrollFormFields) => void;
  documentDate: string;
  onDocumentDateChange: (d: string) => void;
}

export interface IncomeOption {
  code: string;
  label: string;
}

// Fallback whitelist per scope while /expense-documents/payroll/meta loads (or
// errors). Mirrors the server-side defaults in PayrollCustomService.loadWhitelist
// — B1 fix: OT = 53-1103 (ค่าล่วงเวลา), NOT 53-1105 (ค่าอบรม สัมมนา).
const FALLBACK_INCOME_WHITELIST: Record<'SHOP' | 'FINANCE', IncomeOption[]> = {
  SHOP: [
    { code: 'S52-1202', label: 'S52-1202 ค่าล่วงเวลา (OT)' },
    { code: 'S52-1204', label: 'S52-1204 โบนัส' },
  ],
  FINANCE: [
    { code: '53-1103', label: '53-1103 ค่าล่วงเวลา (OT)' },
    { code: '53-1104', label: '53-1104 โบนัส' },
  ],
};

// Known cross-scope pairs — lets the scope toggle carry existing custom-income
// rows across instead of wiping them (S52-1202 ↔ 53-1103 OT, S52-1204 ↔ 53-1104 โบนัส).
const SCOPE_SWAP: Record<string, string> = {
  '53-1103': 'S52-1202',
  '53-1104': 'S52-1204',
  'S52-1202': '53-1103',
  'S52-1204': '53-1104',
};

interface PayrollMetaResponse {
  scope: 'SHOP' | 'FINANCE';
  incomeWhitelist: { code: string; name: string }[];
  cashAccounts: { code: string; name: string }[];
}

export function PayrollLinesSection({ value, onChange, documentDate, onDocumentDateChange }: Props) {
  const { taxExemptWarningEnabled } = useUiFlags();
  const updateField = (patch: Partial<PayrollFormFields>) => onChange({ ...value, ...patch });

  const scope = value.entityScope;

  // Whitelist + names come from the server (single source of truth — the old
  // hardcoded list drifted from the seed and mislabeled 53-1105 as OT).
  const meta = useQuery<PayrollMetaResponse>({
    queryKey: ['payroll-meta', scope],
    queryFn: async () =>
      (await api.get(`/expense-documents/payroll/meta?scope=${scope}`)).data,
    staleTime: 5 * 60 * 1000,
  });
  const incomeOptions: IncomeOption[] =
    meta.data?.incomeWhitelist?.length
      ? meta.data.incomeWhitelist.map((r) => ({ code: r.code, label: `${r.code} ${r.name}` }))
      : FALLBACK_INCOME_WHITELIST[scope];

  // Scope toggle — swap known custom-income codes across charts; unknown codes
  // reset to '' (the sub-table re-defaults to the first whitelist option).
  // Deduction codes from the other chart reset to '' too (V19 would reject them).
  const setScope = (next: 'SHOP' | 'FINANCE') => {
    if (next === scope) return;
    const fallbackCode = FALLBACK_INCOME_WHITELIST[next][0].code;
    onChange({
      ...value,
      entityScope: next,
      lines: value.lines.map((l) => ({
        ...l,
        customIncome: (l.customIncome ?? []).map((r) => ({
          ...r,
          accountCode: SCOPE_SWAP[r.accountCode] ?? fallbackCode,
        })),
        customDeduction: (l.customDeduction ?? []).map((r) => ({
          ...r,
          accountCode:
            (next === 'SHOP') === r.accountCode.startsWith('S') ? r.accountCode : '',
        })),
      })),
    });
  };

  const updateLine = (uid: string, p: Partial<PayrollLineForm>) => {
    onChange({ ...value, lines: value.lines.map((l) => (l.uid === uid ? { ...l, ...p } : l)) });
  };

  // PR-C — period-effective SSO ceiling/cap for SSO pre-fill (decision D1).
  const ssoCfg = useQuery({
    queryKey: ssoConfigKeys.effective(documentDate || ''),
    queryFn: () => ssoConfigApi.effective(documentDate || undefined),
    enabled: !!documentDate,
    staleTime: 5 * 60 * 1000,
  });

  const round2 = (n: number) => Math.round(n * 100) / 100;

  const handlePickEmployee = (uid: string, emp: PickableEmployee) => {
    const base = emp.baseSalary != null ? parseFloat(emp.baseSalary) : NaN;
    const patch: Partial<PayrollLineForm> = {
      userId: emp.userId,
      employeeName: emp.name,
      // taxId snapshot is derived server-side on save — clear any stale value.
      employeeTaxId: '',
    };
    if (!Number.isNaN(base)) patch.baseSalary = String(base);
    // F5 — only pre-fill SSO with a CAPPED value. If the period cap hasn't
    // loaded yet, leave SSO for manual entry rather than auto-filling an
    // uncapped base×5% that could exceed the cap and fail server validation.
    const ceiling = ssoCfg.data ? parseFloat(ssoCfg.data.salaryCeiling) : null;
    const rate = ssoCfg.data?.rate ?? 0.05;
    if (emp.ssoEligible && !Number.isNaN(base) && ceiling != null) {
      patch.ssoEmployee = String(round2(Math.min(base, ceiling) * rate));
    }
    updateLine(uid, patch);
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
      {/* คำสั่งเจ้าของ 2026-08-06 — เอกสาร 1 ใบสังกัดฝั่งเดียว */}
      <div>
        <label className="block text-xs font-medium mb-1">กลุ่มพนักงาน</label>
        <div className="inline-flex rounded-lg border border-border overflow-hidden" role="group">
          {(
            [
              { key: 'SHOP', label: 'พนักงานสาขา (SHOP)' },
              { key: 'FINANCE', label: 'ส่วนกลาง (FINANCE)' },
            ] as const
          ).map((opt) => (
            <button
              key={opt.key}
              type="button"
              onClick={() => setScope(opt.key)}
              aria-pressed={scope === opt.key}
              className={cn(
                'px-3 py-1.5 text-sm transition-colors',
                scope === opt.key
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-background text-muted-foreground hover:bg-accent',
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <p className="mt-1 text-xs text-muted-foreground leading-snug">
          {scope === 'SHOP'
            ? 'ลงบัญชีเป็นค่าใช้จ่ายหน้าร้าน (ผัง SHOP: S52-1201) — จ่ายจากบัญชี SHOP'
            : 'ลงบัญชีเป็นค่าใช้จ่ายส่วนกลาง (ผัง FINANCE: 53-1101) — จ่ายจากบัญชี FINANCE'}
        </p>
      </div>

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
                incomeOptions={incomeOptions}
                onUpdate={(p) => updateLine(row.uid, p)}
                onRemove={() => removeLine(row.uid)}
                onPickEmployee={(emp) => handlePickEmployee(row.uid, emp)}
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
  incomeOptions,
  onUpdate,
  onRemove,
  onPickEmployee,
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
  incomeOptions: IncomeOption[];
  onUpdate: (p: Partial<PayrollLineForm>) => void;
  onRemove: () => void;
  onPickEmployee: (emp: PickableEmployee) => void;
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
          <EmployeeCombobox
            value={row.employeeName}
            onSelect={onPickEmployee}
            placeholder="เลือกพนักงาน"
          />
        </td>
        <td className="px-2 py-1">
          <span className="block px-2 py-1.5 text-xs text-muted-foreground italic leading-snug">
            {row.employeeTaxId || '(ดึงเลขบัตรอัตโนมัติตอนบันทึก)'}
          </span>
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
            <CustomIncomeSubTable
              rows={row.customIncome ?? []}
              options={incomeOptions}
              onChange={updateIncome}
            />
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
  options,
  onChange,
}: {
  rows: PayrollCustomIncomeRow[];
  options: IncomeOption[];
  onChange: (rows: PayrollCustomIncomeRow[]) => void;
}) {
  const { taxExemptWarningEnabled } = useUiFlags();
  const update = (uid: string, p: Partial<PayrollCustomIncomeRow>) =>
    onChange(rows.map((r) => (r.uid === uid ? { ...r, ...p } : r)));
  const remove = (uid: string) => onChange(rows.filter((r) => r.uid !== uid));
  const add = () =>
    onChange([...rows, newPayrollCustomIncome({ accountCode: options[0]?.code ?? '' })]);

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
                  {r.accountCode === '' && <option value="">— เลือกบัญชี —</option>}
                  {options.map((opt) => (
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
                  placeholder="เช่น S11-3001 (SHOP) / 11-2199 (FINANCE)"
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
