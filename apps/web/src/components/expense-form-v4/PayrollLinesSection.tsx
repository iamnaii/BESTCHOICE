import { NumberInput } from '@/components/ui/NumberInput';
import ScreenTable from '@/components/ui/ScreenTable';
import { NativeSelect } from '@/components/ui/native-select';
import { useId as useUiFieldId, useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronRight, Clock, Coins, CopyPlus, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { suggestMonthlyWht } from '@/utils/pit-withholding';
import {
  PayrollFormFields,
  PayrollLineForm,
  PayrollCustomIncomeRow,
  PayrollCustomDeductionRow,
  newPayrollLine,
  newPayrollCustomIncome,
  newPayrollCustomDeduction,
} from './types';
import {
  AttendanceSummaryBox,
  isAttendanceSource,
  PayrollSystemDeductions,
  PayrollSystemRows,
} from './payroll-system/PayrollSystemRows';
import { PayrollReviewPanel } from './payroll-system/PayrollReviewPanel';
import {
  clawbackCarriedOf,
  clearedSystemData,
  copiedLineFromStored,
  payrollLineTotals,
  withoutStoredSystemData,
  type StoredPayrollLine,
} from './payroll-system/payroll-lines';
import { payrollMetaQuery } from './payroll-system/payroll-meta';
import { formatNumberDecimal } from '@/utils/formatters';
import ThaiDateInput from '@/components/ui/ThaiDateInput';
import { THAI_MONTHS_FULL } from '@/lib/date';
import { useUiFlags } from '@/hooks/useUiFlags';
import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import EmployeeCombobox from '@/components/employees/EmployeeCombobox';
import { type PickableEmployee } from '@/lib/api/employees';
import { ssoConfigApi, ssoConfigKeys } from '@/lib/api/ssoConfig';

interface Props {
  value: PayrollFormFields;
  onChange: (v: PayrollFormFields) => void;
  documentDate: string;
  onDocumentDateChange: (d: string) => void;
  /** สาขาของเอกสาร — ใช้ดึงใบเงินเดือนงวดล่าสุดมาเติม (R3-1 คัดลอกงวดก่อน). */
  branchId?: string;
  /** ใบที่กำลังแก้ (ถ้ามี) — "ดึงข้อมูลงวดล่าสุดมาเติม" ต้องไม่เลือกใบนี้เอง */
  documentId?: string;
  /** Payroll D4 — ปุ่ม "บันทึกร่าง + คิดยอด": บันทึกร่าง (สร้าง/แก้) แล้วโหลดยอดที่ server คิดกลับมา */
  onSaveAndCompute?: () => void;
  computing?: boolean;
  computeDisabled?: boolean;
  /** ผู้ใช้ปัจจุบัน — แผงวันที่ต้องตรวจให้ลิงก์ไปหน้าลงเวลาเฉพาะคนที่เปิดได้ */
  viewer?: { role: string; branchId: string | null } | null;
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

export function PayrollLinesSection({
  value,
  onChange,
  documentDate,
  onDocumentDateChange,
  branchId,
  documentId,
  onSaveAndCompute,
  computing = false,
  computeDisabled = false,
  viewer,
}: Props) {
  const uiFieldId = useUiFieldId();
  const { taxExemptWarningEnabled } = useUiFlags();
  const [copyLoading, setCopyLoading] = useState(false);

  // R3-1 — ดึงใบเงินเดือนล่าสุดของสาขา (ไม่นับใบ VOID) มาเติมทั้งชุด: ฝั่ง +
  // พนักงาน + ฐาน/SSO/WHT + รายได้พิเศษ/รายการหัก. แถวที่ผูกทะเบียน (มี userId)
  // ชื่อ-เลขบัตรถูก re-derive ฝั่ง server ตอนบันทึก (คนลาออก → server แจ้งให้เอาออก);
  // แถว free-text เลขบัตรไม่ถูกคัดลอก (อาจเป็นค่า mask) — ต้องกรอกใหม่ถ้าจำเป็น.
  // SSO cap ถูก validate ใหม่ด้วยวันที่จ่ายของงวดนี้.
  const copyFromLatest = async () => {
    if (!branchId) return;
    setCopyLoading(true);
    try {
      const { data: list } = await api.get<{
        data: Array<{ id: string; status: string; documentDate: string }>;
      }>(`/expense-documents?type=PAYROLL&branchId=${branchId}&limit=10`);
      // ไม่เลือกใบที่กำลังแก้อยู่ (ไม่งั้นได้ร่างตัวเองแล้วรายการปรับปรุงงวดก่อนหาย)
      const candidate = (list.data ?? []).find((d) => d.status !== 'VOIDED' && d.id !== documentId);
      if (!candidate) {
        toast.info('ยังไม่มีใบเงินเดือนเดิมของสาขานี้ให้คัดลอก');
        return;
      }
      const { data: doc } = await api.get<{
        number: string;
        payroll?: {
          entityScope: 'SHOP' | 'FINANCE';
          payrollPeriod: string;
          lines: StoredPayrollLine[];
        } | null;
      }>(`/expense-documents/${candidate.id}`);
      if (!doc.payroll || doc.payroll.lines.length === 0) {
        toast.info('ใบล่าสุดไม่มีรายชื่อพนักงาน');
        return;
      }
      onChange({
        ...value,
        entityScope: doc.payroll.entityScope === 'FINANCE' ? 'FINANCE' : 'SHOP',
        // Payroll D4 — คัดลอกเฉพาะแถวที่กรอกเอง (MANUAL) · แถวระบบคิดใหม่ตอนบันทึก
        lines: doc.payroll.lines.map(copiedLineFromStored),
      });
      toast.success(`ดึงข้อมูลจาก ${doc.number} แล้ว (${doc.payroll.lines.length} คน) — ตรวจยอดก่อนบันทึก`);
    } catch {
      toast.error('ดึงงวดล่าสุดไม่สำเร็จ');
    } finally {
      setCopyLoading(false);
    }
  };

  const scope = value.entityScope;

  // Whitelist + names come from the server (single source of truth — the old
  // hardcoded list drifted from the seed and mislabeled 53-1105 as OT).
  const meta = useQuery(payrollMetaQuery(scope));
  const incomeOptions: IncomeOption[] =
    meta.data?.incomeWhitelist?.length
      ? meta.data.incomeWhitelist.map((r) => ({ code: r.code, label: `${r.code} ${r.name}` }))
      : FALLBACK_INCOME_WHITELIST[scope];
  const accountLabel = (code: string) => incomeOptions.find((o) => o.code === code)?.label ?? code;

  // Scope toggle — swap known custom-income codes across charts; unknown codes
  // reset to '' (the sub-table re-defaults to the first whitelist option).
  // Deduction codes from the other chart reset to '' too (V19 would reject them).
  const setScope = (next: 'SHOP' | 'FINANCE') => {
    if (next === scope) return;
    const fallbackCode = FALLBACK_INCOME_WHITELIST[next][0].code;
    onChange({
      ...value,
      entityScope: next,
      // แถวระบบเป็นของผังฝั่งเดิม — server คิดใหม่ตอนบันทึก
      lines: value.lines.map((l) => ({
        ...withoutStoredSystemData(l),
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

  // เปลี่ยนงวด: แถวระบบ/สรุป/วันที่ต้องตรวจที่เก็บไว้เป็นของงวดเดิม — ล้างทุกบรรทัด (server คิดใหม่ตอนบันทึก)
  const setPeriod = (year: number, month: number) => {
    const payrollPeriod = `${year - 543}-${String(month).padStart(2, '0')}`;
    onChange({
      ...value,
      year,
      month,
      payrollPeriod,
      lines: payrollPeriod === value.payrollPeriod ? value.lines : value.lines.map(withoutStoredSystemData),
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
    const current = value.lines.find((l) => l.uid === uid);
    const patch: Partial<PayrollLineForm> = {
      userId: emp.userId,
      employeeName: emp.name,
      // taxId snapshot is derived server-side on save — clear any stale value.
      employeeTaxId: '',
      // Payroll D4 — แถวระบบ/หักคืนค่าคอม/รายการค่าคอม/สรุป/วันที่ต้องตรวจที่เก็บไว้เป็นของคนเดิม · คนใหม่คิดตอนบันทึก
      ...(current?.userId !== emp.userId ? clearedSystemData() : {}),
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
    // Payroll D4 — รายได้พิเศษ = แถวระบบที่เก็บไว้ (ตามที่บันทึกครั้งล่าสุด) + แถวที่กรอกเอง · ส่วนที่ 2: รายการหัก = กรอกเอง +
    // หักคืนค่าคอม และฐาน WHT หักคืนค่าคอมแล้ว (สูตรเดียวกับ payrollTaxableGross ของ ภ.ง.ด.1 — P2-R18 / P2-R19.2)
    const t = payrollLineTotals(l);
    const hasExtras =
      (l.customIncome?.length ?? 0) + (l.customDeduction?.length ?? 0) + (l.systemDeductions?.length ?? 0) > 0;
    const reviewDays = l.systemNotes?.review.length ?? 0;
    // ป้าย "OT n แถว" นับเฉพาะแถวจากลงเวลา (ส่วนที่ 2 มีแถวค่าคอมใน systemIncome ด้วย)
    const attendanceRows = (l.systemIncome ?? []).filter((r) => isAttendanceSource(r.source)).length;
    // ป้าย "ค่าคอม n" = จำนวนค่าคอมที่บรรทัดนี้จ่าย (กระดาน 1)
    const commissionCount = (l.commissionItems ?? []).filter((i) => i.kind === 'PAY').length;
    // R3-4 — WHT แนะนำ (ขั้นบันได ม.48, ลดหย่อนมาตรฐาน) — advisory เท่านั้น
    const suggestedWht = suggestMonthlyWht(t.taxableBase, t.sso);
    return {
      ...l,
      baseN: t.base,
      ssoN: t.sso,
      whtN: t.wht,
      incomeN: t.income,
      systemIncomeN: t.systemIncome,
      reviewDays,
      attendanceRows,
      commissionCount,
      deductionN: t.deduction,
      clawbackN: t.clawback,
      taxableBaseN: t.taxableBase,
      suggestedWht,
      netPaid: t.netPaid,
      hasExtras,
    };
  });
  const sumBase = computed.reduce((s, l) => s + l.baseN, 0);
  const sumSso = computed.reduce((s, l) => s + l.ssoN, 0);
  const sumWht = computed.reduce((s, l) => s + l.whtN, 0);
  const sumIncome = computed.reduce((s, l) => s + l.incomeN, 0);
  const sumSystemIncome = computed.reduce((s, l) => s + l.systemIncomeN, 0);
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
            <button data-ui-control="button"
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
        {(branchId || onSaveAndCompute) && (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {branchId && (
              <button data-ui-control="button"
                type="button"
                onClick={copyFromLatest}
                disabled={copyLoading}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs border border-dashed border-border rounded-lg text-muted-foreground hover:text-foreground hover:border-primary disabled:opacity-50"
              >
                <CopyPlus className="size-3.5" />
                {copyLoading ? 'กำลังดึงข้อมูล…' : 'ดึงข้อมูลงวดล่าสุดมาเติม'}
              </button>
            )}
            {/* Payroll D4 — บันทึกร่างแล้วแสดงยอดที่ server คิดจากลงเวลา (ไม่มี endpoint ดูตัวอย่างแยก · สเปก §17) */}
            {onSaveAndCompute && (
              <Button
                type="button"
                size="sm"
                onClick={onSaveAndCompute}
                disabled={computing || computeDisabled}
                aria-busy={computing}
              >
                <RefreshCw className={cn('size-3.5', computing && 'animate-spin')} aria-hidden="true" />
                บันทึกร่าง + คิดยอด
              </Button>
            )}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div>
          <label htmlFor={`${uiFieldId}-1`} className="block text-xs font-medium mb-1">ปี (พ.ศ.)</label>
          <NativeSelect wrapperClassName="max-w-full w-full" id={`${uiFieldId}-1`}
            value={value.year}
            onChange={(e) => setPeriod(Number(e.target.value), value.month)}
            className="px-3 py-2 border border-input rounded-lg text-sm bg-background"
          >
            {[0, 1, 2, 3, 4].map((offset) => {
              const y = currentBuddhistYear - offset;
              return (
                <option key={y} value={y}>
                  {y}
                </option>
              );
            })}
          </NativeSelect>
        </div>
        <div>
          <label htmlFor={`${uiFieldId}-2`} className="block text-xs font-medium mb-1">เดือน</label>
          <NativeSelect wrapperClassName="max-w-full w-full" id={`${uiFieldId}-2`}
            value={value.month}
            onChange={(e) => setPeriod(value.year, Number(e.target.value))}
            className="px-3 py-2 border border-input rounded-lg text-sm bg-background"
          >
            {THAI_MONTHS_FULL.map((label, idx) => (
              <option key={idx} value={idx + 1}>
                {label}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div>
          <label htmlFor={`${uiFieldId}-3`} className="block text-xs font-medium mb-1">
            วันที่จ่ายเงิน <span className="text-destructive">*</span>
          </label>
          <ThaiDateInput id={`${uiFieldId}-3`}
            value={documentDate}
            onChange={(e) => onDocumentDateChange(e.target.value)}
            required
            className="w-full px-3 py-2 border border-input rounded-lg text-sm bg-background"
          />
        </div>
      </div>

      <div className="flex flex-wrap items-start gap-4">
        <div className="flex min-w-0 flex-[999_1_40rem] flex-col gap-2">
          <div className="max-w-full overflow-x-auto rounded-xl border border-border" role="region" aria-label="รายการเงินเดือน" tabIndex={0}>
            <ScreenTable className="w-full min-w-[58rem] text-sm">
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
                  <th className="text-right px-3 py-2 font-medium">รายได้พิเศษ</th>
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
                    accountLabel={accountLabel}
                    period={value.payrollPeriod}
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
                    {formatNumberDecimal(sumIncome)}
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
                    <td colSpan={7} className="px-3 py-1 text-right text-muted-foreground leading-snug">
                      รวมรายได้พิเศษ {formatNumberDecimal(sumIncome)}
                      {sumSystemIncome > 0 &&
                        ` (จากระบบ ${formatNumberDecimal(sumSystemIncome)} · กรอกเอง ${formatNumberDecimal(sumIncome - sumSystemIncome)})`}
                      {' · '}รวมหัก {formatNumberDecimal(sumDeduction)}
                      {' · สุทธิ = ฐาน + รายได้พิเศษ − SSO − WHT − หัก'}
                    </td>
                    <td></td>
                  </tr>
                )}
              </tfoot>
            </ScreenTable>
          </div>
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground leading-snug">
            <RefreshCw className="size-3.5 shrink-0" aria-hidden="true" />
            ระบบคิด OT ใหม่ทุกครั้งที่บันทึก
          </p>

          <button data-ui-control="button"
            type="button"
            onClick={addLine}
            className="w-full flex items-center justify-center gap-1.5 py-2 border-2 border-dashed border-border rounded-lg text-sm text-muted-foreground hover:text-foreground hover:border-primary"
          >
            <Plus className="size-4" /> เพิ่มพนักงาน
          </button>
        </div>
        <div className="min-w-0 flex-[1_1_18rem] empty:hidden">
          <PayrollReviewPanel lines={value.lines} viewer={viewer} />
        </div>
      </div>
    </div>
  );
}

function PayrollRow({
  row,
  disableRemove,
  incomeOptions,
  accountLabel,
  period,
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
    systemIncomeN: number;
    reviewDays: number;
    attendanceRows: number;
    commissionCount: number;
    deductionN: number;
    clawbackN: number;
    taxableBaseN: number;
    suggestedWht: number;
    hasExtras: boolean;
  };
  disableRemove: boolean;
  incomeOptions: IncomeOption[];
  accountLabel: (code: string) => string;
  /** งวดของใบ (YYYY-MM) — ตัวเลือกพนักงานให้คนที่ลาออกระหว่างงวดได้ + ป้ายเดือนของสรุปลงเวลา */
  period: string;
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
            period={period}
          />
          {(row.attendanceRows > 0 || row.commissionCount > 0 || row.reviewDays > 0) && (
            <div className="mt-1 flex flex-wrap gap-1">
              {row.attendanceRows > 0 && (
                <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary leading-snug">
                  <Clock className="size-3 shrink-0" aria-hidden="true" />
                  {`OT ${row.attendanceRows} แถว`}
                </span>
              )}
              {row.commissionCount > 0 && (
                <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary leading-snug">
                  <Coins className="size-3 shrink-0" aria-hidden="true" />
                  {`ค่าคอม ${row.commissionCount}`}
                </span>
              )}
              {row.reviewDays > 0 && (
                <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-warning/40 bg-warning/10 px-2 py-0.5 text-xs font-medium text-warning-strong leading-snug">
                  <AlertTriangle className="size-3 shrink-0" aria-hidden="true" />
                  {`ต้องตรวจ ${row.reviewDays} วัน`}
                </span>
              )}
            </div>
          )}
        </td>
        <td className="px-2 py-1">
          <span className="block px-2 py-1.5 text-xs text-muted-foreground italic leading-snug">
            {row.employeeTaxId || '(ดึงเลขบัตรอัตโนมัติตอนบันทึก)'}
          </span>
        </td>
        <td className="px-2 py-1">
          <NumberInput unstyled aria-label="เงินเดือนพื้นฐาน"
            step="0.01"
            value={row.baseSalary}
            onChange={(e) => onUpdate({ baseSalary: e.target.value })}
            className="w-full px-2 py-1.5 border border-input rounded text-sm bg-background text-right font-mono"
          />
        </td>
        <td className={cn('px-3 py-2 text-right font-mono', row.incomeN === 0 && 'text-muted-foreground')}>
          {formatNumberDecimal(row.incomeN)}
        </td>
        <td className="px-2 py-1">
          <NumberInput unstyled aria-label="ประกันสังคมพนักงาน"
            step="0.01"
            value={row.ssoEmployee}
            onChange={(e) => onUpdate({ ssoEmployee: e.target.value })}
            className="w-full px-2 py-1.5 border border-input rounded text-sm bg-background text-right font-mono"
          />
        </td>
        <td className="px-2 py-1">
          <NumberInput unstyled aria-label="ภาษีหัก ณ ที่จ่าย"
            step="0.01"
            value={row.whtAmount}
            onChange={(e) => onUpdate({ whtAmount: e.target.value })}
            className="w-full px-2 py-1.5 border border-input rounded text-sm bg-background text-right font-mono"
          />
          {/* R3-4 — ค่าแนะนำขั้นบันได ม.48 (ลดหย่อนมาตรฐาน) — กดเพื่อใช้ */}
          {row.suggestedWht > 0 && row.whtN !== row.suggestedWht && (
            <button
              type="button"
              onClick={() => onUpdate({ whtAmount: String(row.suggestedWht) })}
              className="block w-full text-right text-[10px] text-muted-foreground hover:text-primary mt-0.5"
              title="ภาษีแนะนำจากขั้นบันได ม.48 หักลดหย่อนมาตรฐาน (ส่วนตัว 60,000 + ค่าใช้จ่าย 50% + ปกส.) — กดเพื่อใช้ค่านี้"
            >
              แนะนำ ~{formatNumberDecimal(row.suggestedWht)}
            </button>
          )}
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
          <td colSpan={8} className="px-3 py-3 space-y-3">
            <PayrollSystemRows
              rows={row.systemIncome}
              commissionItems={row.commissionItems}
              period={period}
              accountLabel={accountLabel}
            />
            <CustomIncomeSubTable
              rows={row.customIncome ?? []}
              options={incomeOptions}
              onChange={updateIncome}
            />
            <PayrollSystemDeductions
              rows={row.systemDeductions ?? []}
              commissionItems={row.commissionItems}
              carried={clawbackCarriedOf(row.systemNotes)?.carried}
              accountLabel={accountLabel}
            />
            <CustomDeductionSubTable rows={row.customDeduction ?? []} onChange={updateDeduction} />
            {row.attendanceSummary && <AttendanceSummaryBox summary={row.attendanceSummary} period={period} />}
            {row.taxableBaseN !== row.baseN && (
              <div className="text-xs text-muted-foreground italic leading-snug">
                ฐานคำนวณ WHT = {formatNumberDecimal(row.taxableBaseN)} (รวมรายได้พิเศษที่เสียภาษี
                {row.clawbackN > 0 && ' − หักคืนค่าคอม'})
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
      <div className="bg-muted/50 px-3 py-1.5 text-xs font-medium text-foreground leading-snug">
        + รายได้พิเศษ (โบนัส / OT / เบี้ยเลี้ยง) — กรอกเอง
      </div>
      <ScreenTable className="w-full text-xs">
        <thead className="bg-muted/30 text-muted-foreground">
          <tr>
            <th className="text-left px-2 py-1 w-40">บัญชี</th>
            <th className="text-left px-2 py-1">รายการ</th>
            <th className="text-right px-2 py-1 w-28">จำนวน</th>
            <th className="text-center px-2 py-1 w-16">ภาษี</th>
            <th className="w-44"></th>
            <th className="w-8"></th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={6} className="px-2 py-2 text-center text-muted-foreground italic">
                ไม่มี
              </td>
            </tr>
          )}
          {rows.map((r) => (
            <tr key={r.uid} className="border-t border-border">
              <td className="px-2 py-1">
                <NativeSelect wrapperClassName="max-w-full w-full" aria-label="บัญชี"
                  value={r.accountCode}
                  onChange={(e) => update(r.uid, { accountCode: e.target.value })}
                  className="px-1.5 py-1 border border-input rounded text-xs bg-background"
                >
                  {r.accountCode === '' && <option value="">— เลือกบัญชี —</option>}
                  {options.map((opt) => (
                    <option key={opt.code} value={opt.code}>
                      {opt.label}
                    </option>
                  ))}
                </NativeSelect>
              </td>
              <td className="px-2 py-1">
                <input aria-label="คำอธิบาย"
                  type="text"
                  value={r.name}
                  onChange={(e) => update(r.uid, { name: e.target.value })}
                  placeholder="คำอธิบาย"
                  className="w-full px-1.5 py-1 border border-input rounded text-xs bg-background"
                />
              </td>
              <td className="px-2 py-1">
                <NumberInput unstyled aria-label="จำนวนเงิน"
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
              <td className="px-2 py-1">
                {/* Payroll D4 — แก้ OT ที่จ่ายขาดของเดือนก่อน: ส่ง isAdjustment ⇒ server ไม่นับเป็น OT ที่กรอกซ้ำ */}
                <label className="inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap text-xs leading-snug">
                  <input
                    type="checkbox"
                    checked={r.isAdjustment}
                    onChange={(e) => update(r.uid, { isAdjustment: e.target.checked })}
                    className="size-3.5"
                  />
                  รายการปรับปรุงงวดก่อน
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
      </ScreenTable>
      <button data-ui-control="button"
        type="button"
        onClick={add}
        className="w-full flex items-center justify-center gap-1 py-1.5 text-xs text-muted-foreground hover:text-foreground border-t border-border"
      >
        <Plus className="size-3" /> เพิ่มรายได้พิเศษ
      </button>
      {showWarning && (
        <div
          role="alert"
          className="flex items-start gap-2 px-3 py-2 border-t border-border bg-warning/5 text-warning-strong"
        >
          <AlertTriangle className="size-3.5 mt-0.5 shrink-0" />
          <div className="text-xs leading-snug">
            <span className="font-medium">ยกเว้นภาษี ม.42</span> —{' '}
            มี {taxExemptRows.length} รายการที่ติ๊กไม่เสียภาษี
            (ป.รัษฎากร ม.42). ตรวจสอบให้แน่ใจว่าเข้าเงื่อนไข เช่น เงินชดเชย ค่าใช้จ่ายเดินทาง
            ตามอัตรา ก่อน ลงบัญชี เพราะ ภ.ง.ด.1 จะไม่นับฐานนี้
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
      <div className="bg-warning/10 px-3 py-1.5 text-xs font-medium text-warning-strong leading-snug">
        − รายการหัก (คืนเงินยืม / ทดรองจ่าย / ค่ายูนิฟอร์ม)
      </div>
      <ScreenTable className="w-full text-xs">
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
                <input aria-label="บัญชี"
                  type="text"
                  value={r.accountCode}
                  onChange={(e) => update(r.uid, { accountCode: e.target.value })}
                  placeholder="เช่น S11-3001 (SHOP) / 11-2199 (FINANCE)"
                  className="w-full px-1.5 py-1 border border-input rounded text-xs bg-background font-mono"
                />
              </td>
              <td className="px-2 py-1">
                <input aria-label="คำอธิบาย"
                  type="text"
                  value={r.name}
                  onChange={(e) => update(r.uid, { name: e.target.value })}
                  placeholder="คำอธิบาย"
                  className="w-full px-1.5 py-1 border border-input rounded text-xs bg-background"
                />
              </td>
              <td className="px-2 py-1">
                <NumberInput unstyled aria-label="จำนวนเงิน"
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
      </ScreenTable>
      <button data-ui-control="button"
        type="button"
        onClick={add}
        className="w-full flex items-center justify-center gap-1 py-1.5 text-xs text-muted-foreground hover:text-foreground border-t border-border"
      >
        <Plus className="size-3" /> เพิ่มรายการหัก
      </button>
    </div>
  );
}
