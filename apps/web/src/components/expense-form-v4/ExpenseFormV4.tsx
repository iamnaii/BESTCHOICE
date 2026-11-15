import { buildExpenseLinePayload } from './expense-line-payload';
import { useAccountingPermissions } from '@/hooks/useAccountingPermissions';
import { getApprovalReason } from '@/hooks/useApprovalActions';
import { useState, useEffect, useRef, useId } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import api, { getErrorMessage } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { AlertTriangle, ArrowLeft, CheckCircle2, Clock, Star } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useUiFlags } from '@/hooks/useUiFlags';
import { cn } from '@/lib/utils';
import { DocType, ExpenseFormState, newLine, newPayrollLine, newPettyCashLine } from './types';
import {
  formLineFromStored,
  payrollLinesPayload,
  stripTypedOtRows,
  STRIP_TYPED_OT_TOAST,
  type StoredPayrollLine,
} from './payroll-system/payroll-lines';
import { payrollMetaQuery } from './payroll-system/payroll-meta';
import { CashAccountSelect, SHOP_CASH_ACCOUNT_CODES } from '@/components/CashAccountSelect';
import { formLabelClass } from '@/components/ui/form-styles';
import { useFormCompute } from './useFormCompute';
import { QuickStartPanel } from './QuickStartPanel';
import { canManagePayroll } from './payroll-system/payroll-roles';
import { VendorSection, PricingSection } from './VendorSection';
import { ItemLinesSection } from './ItemLinesSection';
import { PayrollLinesSection } from './PayrollLinesSection';
import { SettlementLinesSection } from './SettlementLinesSection';
import { PettyCashLinesSection } from './PettyCashLinesSection';
import { CreditNoteLinesSection } from './CreditNoteLinesSection';
import { JePreview } from './JePreview';
import { DocCard } from './layout/DocCard';
import { DocHeader } from './layout/DocHeader';
import { docTypeLabel } from './layout/DocTypeMenu';
import { FormRow } from './layout/FormRow';
import { PaymentSection } from './layout/PaymentSection';
import { StickyActionBar } from './layout/StickyActionBar';
import { SummaryBox } from './layout/SummaryBox';
import { ApproverSection } from './ApproverSection';
import { AdjustmentSection } from './AdjustmentSection';
import { isPayrollEditable } from './payroll-system/payroll-status';
import { formatNumberDecimal } from '@/utils/formatters';

interface Props {
  branchId: string;
  onClose: () => void;
  onSaved: () => void;
  /** Pre-select a doc type (e.g. /expenses/new?type=PR → 'PAYROLL'). Previously
   *  the query param was silently dropped and the form always opened on
   *  EXPENSE_SAMEDAY. */
  initialDocType?: DocType;
  /** R3-2 (2026-08-06) — แก้ไขร่างใบเงินเดือน: โหลดเอกสาร DRAFT มาเติมฟอร์ม
   *  แล้วบันทึกด้วย PATCH /expense-documents/:id/payroll แทน POST.
   *  รองรับเฉพาะ PAYROLL — ประเภทอื่นยังสร้างใหม่อย่างเดียว. */
  editDocId?: string;
  /** Payroll D4 — "บันทึกร่าง + คิดยอด" บันทึกแล้วอยู่ในโหมดแก้ไขของร่างนั้น · หน้าที่เปิดฟอร์มเปลี่ยน URL เป็น ?edit=<id> ได้ */
  onDraftSaved?: (id: string) => void;
  /** ชื่อสาขาของเอกสาร — แสดงที่หัวการ์ด */
  branchName?: string;
}

/** ใบเงินเดือนตามที่ `GET /expense-documents/:id` คืน (เฉพาะที่ฟอร์มใช้) */
interface PayrollDocForEdit {
  id: string;
  number?: string;
  documentType: string;
  status: string;
  branchId: string;
  documentDate: string;
  depositAccountCode: string | null;
  description: string | null;
  note: string | null;
  reference: string | null;
  payroll?: {
    entityScope: 'SHOP' | 'FINANCE';
    payrollPeriod: string;
    lines: StoredPayrollLine[];
  } | null;
}

const SENT_BACK_STATUS_LABEL: Record<string, string> = { PENDING_APPROVAL: 'รออนุมัติ', APPROVED: 'อนุมัติแล้ว' };
/** 409 ที่บอกว่า "ยังไม่ถึงเวลา" (ไม่ใช่ข้อผิดพลาดของข้อมูล) — แสดงโทนเตือน */
const PAYROLL_NOT_YET_CODES = ['PAYROLL_SUBMIT_CUTOFF', 'PAYROLL_CUTOFF'];
/** บันทึกสำเร็จแต่โหลดใบกลับไม่ได้ — ไม่ใช่ "บันทึกไม่สำเร็จ" · ปุ่มที่อ้างถึงอยู่บนหน้านี้ */
const PAYROLL_RELOAD_FAILED =
  'บันทึกร่างแล้ว แต่โหลดยอดที่ระบบคิดไม่สำเร็จ — กด บันทึกร่าง + คิดยอด อีกครั้ง';

/** ใบเงินเดือนบันทึกแล้ว แต่ขั้นถัดไป (ส่งขออนุมัติ/ลงบัญชี) ไม่สำเร็จ — ใบยังเป็นร่าง ฟอร์มต้องแก้ใบนี้ต่อ ไม่สร้างใหม่ */
class PayrollSavedError extends Error {
  constructor(
    readonly docId: string,
    readonly cause: unknown,
  ) {
    super('payroll saved; follow-up step failed');
  }
}

const errorCodeOf = (e: unknown): string | undefined => {
  const code = (e as { response?: { data?: { code?: unknown } } } | null)?.response?.data?.code;
  return typeof code === 'string' ? code : undefined;
};

// W3 fix — return YYYY-MM-DD for "today in Asia/Bangkok" (en-CA gives ISO-shaped
// output). Previously used `new Date().toISOString().slice(0,10)` which returns
// UTC-day — after 17:00 BKK that becomes tomorrow's BKK calendar date, so the
// default for the docDate input was off by one half the working day.
const todayBkkIso = (): string =>
  new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });

// D1.3.4.2 — count whole days between two BKK calendar days (`YYYY-MM-DD`).
// Returns `(today - docDate)` in days. Negative when docDate is in the future.
// Computed via Date.UTC noon to dodge DST cliffs (Thailand has no DST today,
// but defensive coding for future timezone-rule changes).
const daysBetweenBkkIso = (todayIso: string, docDateIso: string): number => {
  const [ty, tm, td] = todayIso.split('-').map(Number);
  const [dy, dm, dd] = docDateIso.split('-').map(Number);
  if (!ty || !tm || !td || !dy || !dm || !dd) return 0;
  const ms =
    Date.UTC(ty, tm - 1, td, 12, 0, 0) - Date.UTC(dy, dm - 1, dd, 12, 0, 0);
  return Math.round(ms / (24 * 60 * 60 * 1000));
};

const initial = (
  branchId: string,
  defaultCash: string,
  initialDocType?: DocType,
): ExpenseFormState => {
  const today = new Date();
  return {
    docType: initialDocType ?? 'EXPENSE_SAMEDAY',
    branchId,
    documentDate: todayBkkIso(),
    vendorName: '',
    vendorTaxId: '',
    vendorSupplierId: '',
    taxInvoiceNo: '',
    priceType: 'EXCLUSIVE',
    whtFormType: '',
    paymentMethod: 'CASH',
    depositAccountCode: defaultCash,
    reference: '',
    receiptImageUrl: '',
    note: '',
    fromTemplateId: '',
    lines: [newLine()],
    cnMode: 'LINKED',
    originalDocumentId: '',
    cnReason: '',
    payroll: {
      year: today.getFullYear() + 543,
      month: today.getMonth() + 1,
      payrollPeriod: `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`,
      // คำสั่งเจ้าของ 2026-08-06 — default พนักงานสาขา (SHOP).
      entityScope: 'SHOP',
      lines: [newPayrollLine()],
    },
    settlement: {
      selections: new Map(),
      vendorName: '',
      vendorSupplierId: '',
      whtAmount: '0',
      whtFormType: '',
    },
    pettyCash: {
      custodianName: '',
      lines: [newPettyCashLine()],
    },
    adjustments: [],
    amountPaid: '',
    // Phase A.5 — default false (deductible). Accountant flips for non-deductible
    // expenses (gifts > 2,000, personal expenses, tax penalties, etc.).
    taxDisallowed: false,
  };
};

export function ExpenseFormV4({ branchId, onClose, onSaved, initialDocType, editDocId, onDraftSaved, branchName }: Props) {
  const { user } = useAuth();
  const permissions = useAccountingPermissions();
  const queryClient = useQueryClient();
  const payById = useId();
  // D1.1.5.1 — Petty Cash feature flag. When disabled, the picker hides the
  // PETTY_CASH_REIMBURSEMENT chip and the form section is not rendered.
  // Auto-flip away from PETTY_CASH_REIMBURSEMENT when the flag flips off
  // mid-session (handled in the effect below).
  // D1.3.4.1 — smartDoctypeSwitchEnabled gates the SAMEDAY→ACCRUAL auto-flip.
  // D1.3.4.2 — smartSwitchThresholdDays adds a tolerance: only flip when
  // (today − docDate) > threshold. Default 0 = legacy behavior.
  const { smartDoctypeSwitchEnabled, smartSwitchThresholdDays, pettyCashEnabled, approvalEnabled, approvalThreshold, approvalRequiredDocTypes } =
    useUiFlags();
  const [showQuickStart, setShowQuickStart] = useState(true);
  const [state, setState] = useState<ExpenseFormState>(() =>
    // ผู้จัดการสาขาทำใบเงินเดือนไม่ได้ — ?type=PR ของเขาเปิดฟอร์มรายจ่ายปกติ
    initial(branchId, user?.defaultCashAccountCode || '11-1101', initialDocType === 'PAYROLL' && !canManagePayroll(user?.role) ? undefined : initialDocType),
  );

  const patch = (p: Partial<ExpenseFormState>) => setState((s) => ({ ...s, ...p }));

  // R3-2 — โหลดใบเงินเดือนมาเติมฟอร์ม (edit mode) · Payroll D4 — รวมใบที่รออนุมัติ/อนุมัติแล้ว (ส่งกลับเป็นร่าง)
  const [editLoaded, setEditLoaded] = useState(false);
  const editQuery = useQuery({
    queryKey: ['expense-doc-edit', editDocId],
    queryFn: async () => (await api.get(`/expense-documents/${editDocId}`)).data,
    // โหลดครั้งแรกเท่านั้น — หลัง "บันทึกร่าง + คิดยอด" ฟอร์มโหลดใบเอง (openSavedDraft) แม้ host เปลี่ยน ?edit=
    enabled: !!editDocId && !editLoaded,
    staleTime: 0,
    // ไม่เก็บใบไว้ข้ามการเปิดฟอร์ม — เปิด "แก้ไข" ใหม่ต้องได้ใบล่าสุด ไม่งั้นบันทึกทับรุ่นที่ใหม่กว่า
    gcTime: 0,
  });
  // ใบที่ฟอร์มนี้แก้อยู่ — เริ่มจาก ?edit= หรือได้มาหลัง "บันทึกร่าง + คิดยอด" สร้างใบ (บันทึกครั้งถัดไป = PATCH)
  const [draftId, setDraftId] = useState<string | undefined>(editDocId);
  const [loadedStatus, setLoadedStatus] = useState<string | null>(null);
  const [loadedNumber, setLoadedNumber] = useState<string | undefined>();
  // ข้อความจาก server ของใบเงินเดือน (มี `code`) — แสดงในฟอร์มแทน toast
  const [payrollNotice, setPayrollNotice] = useState<{ message: string; tone: 'error' | 'warning' } | null>(null);
  const noticeRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (payrollNotice) noticeRef.current?.focus();
  }, [payrollNotice]);

  const applyPayrollDoc = (doc: PayrollDocForEdit & { payroll: NonNullable<PayrollDocForEdit['payroll']> }) => {
    const [py, pm] = doc.payroll.payrollPeriod.split('-').map((v) => parseInt(v, 10));
    setState((s) => ({
      ...s,
      docType: 'PAYROLL',
      branchId: doc.branchId,
      documentDate: doc.documentDate.slice(0, 10),
      depositAccountCode: doc.depositAccountCode ?? s.depositAccountCode,
      note: doc.note ?? '',
      reference: doc.reference ?? '',
      payroll: {
        year: py + 543,
        month: pm,
        payrollPeriod: doc.payroll.payrollPeriod,
        entityScope: doc.payroll.entityScope === 'FINANCE' ? 'FINANCE' : 'SHOP',
        // Payroll D4 (R6) — แถวที่คนกรอกเข้าตารางกรอกเอง · แถวระบบแยกไว้แสดงอย่างเดียว (ไม่ส่งกลับ)
        lines: doc.payroll.lines.map((l) => {
          const line = formLineFromStored(l);
          const before = s.payroll.lines.find((p) => p.userId && p.userId === line.userId);
          return before?._expanded ? { ...line, _expanded: true } : line;
        }),
      },
    }));
    setLoadedStatus(doc.status);
    setLoadedNumber(doc.number);
    setShowQuickStart(false);
  };

  useEffect(() => {
    // ใช้เฉพาะข้อมูลที่โหลดหลังเปิดฟอร์มนี้ (ข้อมูลใน cache อาจเก่ากว่าที่ server มี)
    if (!editDocId || !editQuery.data || !editQuery.isFetchedAfterMount || editLoaded) return;
    const doc = editQuery.data as PayrollDocForEdit;
    // Payroll D4 คำตัดสิน 6 — แก้ใบที่รออนุมัติ/อนุมัติแล้วได้ (บันทึกแล้ว server ตั้งกลับเป็นร่าง)
    if (!isPayrollEditable(doc) || !doc.payroll) {
      toast.error('แก้ไขได้เฉพาะใบเงินเดือนที่เป็นร่าง รออนุมัติ หรืออนุมัติแล้ว');
      onClose();
      return;
    }
    applyPayrollDoc({ ...doc, payroll: doc.payroll });
    setEditLoaded(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editDocId, editQuery.data, editQuery.isFetchedAfterMount, editLoaded]);

  /**
   * ใบเงินเดือนถูกเขียนแล้ว — รายการ หน้ารายละเอียด และใบที่ฟอร์มแก้ไขเคยโหลดไว้ ต้องโหลดใหม่ ·
   * D4 ส่วนที่ 2: การบันทึกดึง/ปล่อยค่าคอมเข้าใบ ⇒ ชิป "อยู่ในใบเงินเดือน" ของหน้าค่าคอมเปลี่ยน
   */
  const forgetCachedPayroll = (id: string) => {
    queryClient.invalidateQueries({ queryKey: ['expense-document', id] });
    queryClient.removeQueries({ queryKey: ['expense-doc-edit', id] });
    queryClient.invalidateQueries({ queryKey: ['commissions'] });
  };

  /** หลังบันทึก: อยู่ในโหมดแก้ไขของร่างนั้น แล้วโหลดใบกลับ (แถวระบบ + วันที่ต้องตรวจที่ server คิด) */
  const openSavedDraft = async (id: string) => {
    setDraftId(id);
    setEditLoaded(true);
    onDraftSaved?.(id);
    const { data } = await api.get<PayrollDocForEdit>(`/expense-documents/${id}`);
    if (data.payroll) applyPayrollDoc({ ...data, payroll: data.payroll });
  };

  // Payroll: pin the cash account to the scope's chart (SHOP → S11-XXXX,
  // FINANCE → 11-XXXX). Fires on entering the payroll form and on scope toggle;
  // leaving PAYROLL restores the user's default FINANCE cash account.
  useEffect(() => {
    setState((s) => {
      const isShopCode = s.depositAccountCode.startsWith('S');
      if (s.docType === 'PAYROLL') {
        if (s.payroll.entityScope === 'SHOP' && !isShopCode) {
          return { ...s, depositAccountCode: 'S11-1202' }; // SCB (SHOP จ่าย)
        }
        if (s.payroll.entityScope === 'FINANCE' && isShopCode) {
          return { ...s, depositAccountCode: user?.defaultCashAccountCode || '11-1201' };
        }
      } else if (isShopCode) {
        return { ...s, depositAccountCode: user?.defaultCashAccountCode || '11-1101' };
      }
      return s;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.docType, state.payroll.entityScope]);

  // D1.1.5.1 — if flag flips off while user is on the Petty Cash form,
  // revert to the safe default doctype so the form doesn't render an empty
  // shell. Smart Default logic above will re-pick SAMEDAY vs ACCRUAL on next
  // documentDate change.
  useEffect(() => {
    if (!pettyCashEnabled && state.docType === 'PETTY_CASH_REIMBURSEMENT') {
      patch({ docType: 'EXPENSE_SAMEDAY' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pettyCashEnabled]);

  // Smart default: switch SAMEDAY → ACCRUAL when invoice date is not today.
  // One-way: only auto-flip from SAMEDAY to ACCRUAL; does not revert manual ACCRUAL selection.
  // W3 fix — compare against BKK calendar day, not UTC slice, to match the
  // user's perception of "today" in Thailand.
  // D1.3.4.1 — gated by `smartDoctypeSwitchEnabled` (OWNER toggle, default
  // true). When false the user must pick the docType manually.
  // D1.3.4.2 — only flip when `(today − docDate) > smartSwitchThresholdDays`.
  const todayIso = todayBkkIso();
  const invoiceIsToday = state.documentDate === todayIso;
  const daysBackdated = daysBetweenBkkIso(todayIso, state.documentDate);
  useEffect(() => {
    if (!smartDoctypeSwitchEnabled) return;
    if (
      state.docType === 'EXPENSE_SAMEDAY' &&
      !invoiceIsToday &&
      daysBackdated > smartSwitchThresholdDays
    ) {
      patch({ docType: 'EXPENSE_ACCRUAL' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.documentDate, smartDoctypeSwitchEnabled, smartSwitchThresholdDays]);

  const { preview, loading, error } = useFormCompute(state);

  const requiresApproval = approvalEnabled && (!!getApprovalReason({
    totalAmount: Number(preview?.totals.totalAmount ?? 0),
    docType: state.docType.startsWith('EXPENSE_') ? 'EXPENSE' : state.docType,
    approvalThreshold,
    approvalRequiredDocTypes,
  }) || !permissions.can('EXPENSE_POST'));
  const maySubmit = requiresApproval || permissions.can('EXPENSE_POST');

  const saveMutation = useMutation({
    mutationFn: async ({ andPost }: { andPost: boolean; stay?: boolean }) => {
      if (andPost && !maySubmit) throw new Error("ไม่มีสิทธิ์บันทึกและ ลงบัญชี รายจ่าย");
      let createdId: string | null = null;
      // R20 — ฉบับที่เพิ่งบันทึก (ใบเงินเดือน) — ลงบัญชีต่อทันทีต้องส่งกลับเป็น expectedUpdatedAt
      let savedVersion: string | undefined;

      if (state.docType === 'EXPENSE_SAMEDAY' || state.docType === 'EXPENSE_ACCRUAL') {
        const payload = {
          documentType: 'EXPENSE',
          branchId: state.branchId,
          documentDate: state.documentDate,
          priceType: state.priceType,
          vendorName: state.vendorName || undefined,
          vendorTaxId: state.vendorTaxId || undefined,
          vendorSupplierId: state.vendorSupplierId || undefined,
          taxInvoiceNo: state.taxInvoiceNo || undefined,
          whtFormType: state.whtFormType || undefined,
          paymentMethod: state.docType === 'EXPENSE_SAMEDAY' ? state.paymentMethod : undefined,
          depositAccountCode:
            state.docType === 'EXPENSE_SAMEDAY' ? state.depositAccountCode : undefined,
          fromTemplateId: state.fromTemplateId || undefined,
          // Phase A.5 — doc-level non-deductible flag. Server defaults to false
          // if omitted; we always send the explicit boolean so the value is
          // round-trippable.
          taxDisallowed: state.taxDisallowed,
          lines: state.lines
            .filter((l) => l.category && parseFloat(l.unitPrice) > 0)
            .map((l) => ({
              category: l.category,
              description: l.description || undefined,
              quantity: parseFloat(l.quantity) || 1,
              unitPrice: parseFloat(l.unitPrice) || 0,
              discount: parseFloat(l.discount) || 0,
              vatPercent: parseFloat(l.vatPercent) || 0,
              whtPercent: parseFloat(l.whtPercent) || 0,
              // Per-line override; backend interprets undefined as false.
              taxDisallowed: l.taxDisallowed === true ? true : undefined,
            })),
          // Fix Report P0-4 — pass adjustments + amountPaid when set.
          // Backend V12/V13/V14 verify the signed sum closes the diff.
          adjustments:
            state.adjustments.length > 0
              ? state.adjustments
                  .filter((a) => a.accountCode && parseFloat(a.amount) > 0)
                  .map((a) => ({
                    accountCode: a.accountCode,
                    side: a.side,
                    amount: a.amount,
                    note: a.note || undefined,
                  }))
              : undefined,
          amountPaid: state.amountPaid.trim() ? state.amountPaid : undefined,
        };
        const { data } = await api.post('/expense-documents', payload);
        createdId = data.id;
      } else if (state.docType === 'PAYROLL') {
        // C2 — forward customIncome + customDeduction. Server V16/V17/V18
        // re-validate: whitelist, deduction ≤ gross, taxable-base calc.
        // R3-2 — edit mode: PATCH ทับร่างเดิม (ไม่ส่ง branchId — ห้ามย้ายสาขา)
        // Payroll D4 — ไม่ส่งแถวระบบ (server คิดใหม่ทุกครั้งที่บันทึก) · บรรทัดที่บันทึกแล้วและระบบคิด OT ให้
        // เอาแถว OT ที่กรอกเองออกก่อน (บรรทัดใหม่ให้ server ตัดสิน → MANUAL_OT_DUPLICATE แสดงในฟอร์ม)
        const attendanceCodes = await queryClient
          .fetchQuery(payrollMetaQuery(state.payroll.entityScope))
          .then((m) => m.attendanceAccountCodes ?? [])
          .catch(() => [] as string[]);
        const stripped = stripTypedOtRows(state.payroll.lines, attendanceCodes);
        if (stripped.removed > 0) {
          toast.info(STRIP_TYPED_OT_TOAST);
          setState((s) => ({
            ...s,
            payroll: { ...s.payroll, lines: stripTypedOtRows(s.payroll.lines, attendanceCodes).lines },
          }));
        }
        const payrollPayload = {
          documentDate: state.documentDate,
          payrollPeriod: state.payroll.payrollPeriod,
          entityScope: state.payroll.entityScope,
          depositAccountCode: state.depositAccountCode,
          paymentMethod: 'BANK_TRANSFER',
          lines: payrollLinesPayload(stripped.lines),
        };
        if (draftId) {
          const { data } = await api.patch(
            `/expense-documents/${draftId}/payroll`,
            payrollPayload,
          );
          createdId = data.id;
          savedVersion = data.updatedAt;
        } else {
          const { data } = await api.post('/expense-documents/payroll', {
            branchId: state.branchId,
            ...payrollPayload,
          });
          createdId = data.id;
          savedVersion = data.updatedAt;
        }
      } else if (state.docType === 'VENDOR_SETTLEMENT') {
        // B2 — forward adjustments + amountPaid when the user has reconciled
        // a supplier discount / bank fee / rounding diff. Server-side V12
        // re-validates Σ signed(adjustments) === amountPaid − (sumSettled − wht).
        const hasAdjustments = state.adjustments.length > 0;
        const hasAmountPaid = state.amountPaid.trim() !== '';
        const { data } = await api.post('/expense-documents/settlement', {
          branchId: state.branchId,
          documentDate: state.documentDate,
          depositAccountCode: state.depositAccountCode,
          paymentMethod: 'BANK_TRANSFER',
          vendorName: state.settlement.vendorName || undefined,
          vendorSupplierId: state.settlement.vendorSupplierId || undefined,
          whtFormType: state.settlement.whtFormType || undefined,
          withholdingTax: parseFloat(state.settlement.whtAmount) || undefined,
          lines: [...state.settlement.selections.values()].map((s) => ({
            clearedDocumentId: s.docId,
            amountSettled: parseFloat(s.amount) || 0,
          })),
          amountPaid: hasAmountPaid ? state.amountPaid : undefined,
          adjustments: hasAdjustments
            ? state.adjustments.map((a) => ({
                accountCode: a.accountCode,
                side: a.side,
                amount: a.amount,
                note: a.note || undefined,
              }))
            : undefined,
        });
        createdId = data.id;
      } else if (state.docType === 'PETTY_CASH_REIMBURSEMENT') {
        // C1.6 — Petty Cash POST. Backend validates V20 (limit, supplier, account)
        // and routes JE via PettyCashTemplate. Per-line supplierName is required;
        // no WHT (vendors with WHT use regular EXPENSE flow).
        const validLines = state.pettyCash.lines.filter(
          (l) => l.supplierName.trim() && l.category && parseFloat(l.amount) > 0,
        );
        if (validLines.length === 0) {
          throw new Error('ต้องมีรายการอย่างน้อย 1 บรรทัด (ระบุผู้ขาย + บัญชี + จำนวน)');
        }
        const { data } = await api.post('/expense-documents/petty-cash', {
          branchId: state.branchId,
          documentDate: state.documentDate,
          depositAccountCode: state.depositAccountCode,
          custodianName: state.pettyCash.custodianName || undefined,
          description: state.note || undefined,
          lines: validLines.map((l) => ({
            supplierName: l.supplierName.trim(),
            supplierId: l.supplierId || undefined,
            category: l.category,
            description: l.description || undefined,
            amount: parseFloat(l.amount),
            vatPercent: parseFloat(l.vatPercent) || 0,
            taxInvoiceNo: l.taxInvoiceNo || undefined,
          })),
        });
        createdId = data.id;
      } else if (state.docType === 'CREDIT_NOTE') {
        const isStandalone = state.cnMode === 'STANDALONE';
        if (!state.cnReason.trim()) {
          throw new Error('กรุณาระบุเหตุผลในการลดหนี้');
        }
        if (!isStandalone && !state.originalDocumentId) {
          throw new Error('โหมด LINKED ต้องเลือกเอกสารต้นฉบับ');
        }
        if (isStandalone && !state.vendorName.trim()) {
          throw new Error('โหมด STANDALONE ต้องระบุชื่อผู้ขาย');
        }
        const validLines = state.lines.filter((l) => l.category && parseFloat(l.unitPrice) > 0);
        if (validLines.length === 0) {
          throw new Error('ต้องมีรายการบัญชีอย่างน้อย 1 บรรทัด');
        }
        // Server computes totals from lines — no preview-je hop needed.
        // This also eliminates the float-string-Decimal dance at the money boundary.
        const { data } = await api.post('/expense-documents/credit-note', {
          mode: state.cnMode,
          branchId: state.branchId,
          documentDate: state.documentDate,
          originalDocumentId: isStandalone ? undefined : state.originalDocumentId,
          vendorName: isStandalone ? state.vendorName.trim() : undefined,
          vendorTaxId: isStandalone ? state.vendorTaxId.trim() || undefined : undefined,
          reason: state.cnReason,
          // STANDALONE per mockup §4 defaults to AP-clearing (Dr 21-1104) — omit
          // depositAccountCode so the backend takes the no-deposit branch.
          // LINKED retains the existing behavior (backend uses original.status
          // to decide Dr 21-1104 vs Dr cash; sends current cash account anyway
          // for POSTED-original refund flow).
          depositAccountCode: isStandalone ? undefined : state.depositAccountCode || undefined,
          note: state.note || undefined,
          lines: validLines.map(buildExpenseLinePayload),
        });
        createdId = data.id;
      }

      let submittedForApproval = false;
      if (andPost && createdId) {
        // คำสั่งเจ้าของ 2026-08-06 — เงินเดือนต้องผ่านการอนุมัติก่อนจ่าย. เมื่อ
        // approval workflow เปิด เอกสาร PAYROLL ห้าม POST ตรง (backend ปฏิเสธ
        // ด้วย approval_required_doc_types อยู่แล้ว) — ส่งขออนุมัติแทน.
        try {
          if (requiresApproval) {
            await api.post(`/expense-documents/${createdId}/submit-for-approval`);
            submittedForApproval = true;
          } else if (savedVersion) {
            await api.post(`/expense-documents/${createdId}/post`, { expectedUpdatedAt: savedVersion });
          } else {
            await api.post(`/expense-documents/${createdId}/post`);
          }
        } catch (e) {
          // Payroll D4 — ส่งก่อนเวลาปิดงวด (PAYROLL_SUBMIT_CUTOFF) ฯลฯ: ใบที่บันทึกแล้วยังเป็นร่าง
          if (state.docType === 'PAYROLL') throw new PayrollSavedError(createdId, e);
          throw e;
        }
      }
      return { id: createdId, submittedForApproval };
    },
    onSuccess: async (result, { stay }) => {
      queryClient.invalidateQueries({ queryKey: ['expenses'] });
      queryClient.invalidateQueries({ queryKey: ['expenses-summary'] });
      if (state.docType === 'PAYROLL' && result.id) forgetCachedPayroll(result.id);
      if (stay && result.id) {
        // "บันทึกร่าง + คิดยอด" — อยู่ต่อในโหมดแก้ไขของร่างนี้ พร้อมยอดที่ server คิด
        try {
          await openSavedDraft(result.id);
          toast.success('บันทึกร่างแล้ว — ยอดในใบเป็นยอดที่ระบบคิดล่าสุด');
        } catch {
          toast.error(PAYROLL_RELOAD_FAILED);
        }
        return;
      }
      toast.success(
        result?.submittedForApproval ? 'บันทึกและส่งขออนุมัติแล้ว' : 'บันทึกรายจ่ายสำเร็จ',
      );
      onSaved();
    },
    onError: (e) => {
      if (e instanceof PayrollSavedError) {
        queryClient.invalidateQueries({ queryKey: ['expenses'] });
        queryClient.invalidateQueries({ queryKey: ['expenses-summary'] });
        forgetCachedPayroll(e.docId);
        const code = errorCodeOf(e.cause);
        setPayrollNotice({
          message: getErrorMessage(e.cause),
          tone: code && PAYROLL_NOT_YET_CODES.includes(code) ? 'warning' : 'error',
        });
        void openSavedDraft(e.docId).catch(() => toast.error(PAYROLL_RELOAD_FAILED));
        return;
      }
      if (state.docType === 'PAYROLL' && errorCodeOf(e)) {
        // MANUAL_OT_DUPLICATE / NOT_IN_BRANCH ฯลฯ — ข้อความของ server ระบุชื่อพนักงาน แสดงค้างไว้ในฟอร์ม
        setPayrollNotice({ message: getErrorMessage(e), tone: 'error' });
        return;
      }
      toast.error(getErrorMessage(e));
    },
  });
  const startSave = (v: { andPost: boolean; stay?: boolean }) => {
    setPayrollNotice(null);
    saveMutation.mutate(v);
  };

  const itemCount =
    state.docType === 'PAYROLL'
      ? state.payroll.lines.filter((l) => l.employeeName && parseFloat(l.baseSalary) > 0).length
      : state.docType === 'VENDOR_SETTLEMENT'
        ? state.settlement.selections.size
        : state.docType === 'PETTY_CASH_REIMBURSEMENT'
          ? state.pettyCash.lines.filter(
              (l) => l.supplierName.trim() && l.category && parseFloat(l.amount) > 0,
            ).length
          : state.docType === 'CREDIT_NOTE'
            ? state.lines.filter((l) => l.category && parseFloat(l.unitPrice) > 0).length
            : state.lines.filter((l) => l.category).length;

  const isPreviewType =
    state.docType === 'EXPENSE_SAMEDAY' || state.docType === 'EXPENSE_ACCRUAL';
  const ready = isPreviewType
    ? !!preview && preview.totals.balanced && itemCount > 0
    : itemCount > 0;

  // ---- ส่วนของหน้าจอ (ไม่มีผลกับ payload) ----
  const [showJe, setShowJe] = useState(false);
  const [dirty, setDirty] = useState(false);
  const markDirty = () => setDirty(true);
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  useEffect(() => {
    if (saveMutation.isSuccess) setDirty(false);
  }, [saveMutation.isSuccess, saveMutation.submittedAt]);

  const money = (v?: string) => (v === undefined ? '—' : formatNumberDecimal(v));
  const hasAdjustmentData = state.adjustments.length > 0 || state.amountPaid.trim() !== '';
  const clearAdjustments = () => patch({ adjustments: [], amountPaid: '' });
  const backdatedHint =
    smartDoctypeSwitchEnabled &&
    state.docType === 'EXPENSE_ACCRUAL' &&
    !invoiceIsToday &&
    daysBackdated > smartSwitchThresholdDays;
  const statusLabel = (loadedStatus && SENT_BACK_STATUS_LABEL[loadedStatus]) || 'ร่าง';
  const showVendor = isPreviewType || state.docType === 'CREDIT_NOTE';
  const showPayment = isPreviewType || state.docType === 'PAYROLL' || state.docType === 'VENDOR_SETTLEMENT' || state.docType === 'PETTY_CASH_REIMBURSEMENT';
  const hasAdjustmentSection = isPreviewType || state.docType === 'VENDOR_SETTLEMENT';

  // R3-2 — edit mode: อย่าแสดงฟอร์มเปล่าระหว่างโหลดร่าง (กันผู้ใช้เริ่มกรอกผิดใบ)
  if (editDocId && !editLoaded) {
    // โหลดไม่สำเร็จ (เครือข่าย / ไม่มีสิทธิ์ / ใบถูกลบ) — เดิมหมุนค้างไม่มีทางออก
    if (editQuery.isError) {
      return (
        <DocCard>
          <div role="alert" className="flex flex-col gap-3 py-8 text-sm">
            <p className="flex items-center gap-2 font-semibold leading-snug text-destructive">
              <AlertTriangle className="size-4 shrink-0" aria-hidden="true" /> โหลดใบเงินเดือนไม่สำเร็จ
            </p>
            <p className="text-muted-foreground leading-snug">{getErrorMessage(editQuery.error)}</p>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" className="min-h-11" onClick={onClose}>ปิด</Button>
              <Button type="button" className="min-h-11" onClick={() => void editQuery.refetch()}>ลองใหม่</Button>
            </div>
          </div>
        </DocCard>
      );
    }
    return (
      <DocCard>
        <div role="status" className="flex items-center gap-3 py-8 text-sm text-muted-foreground">
          <Clock className="size-4 animate-pulse" aria-hidden="true" /> กำลังโหลดร่างใบเงินเดือน…
        </div>
      </DocCard>
    );
  }

  // บัญชีปรับผลต่าง — สูตรเดิม (SAMEDAY อ่านยอดสุทธิจาก server · SE คิดจากบิลที่เลือก − ภาษีหัก ณ ที่จ่าย)
  const adjustmentNode = hasAdjustmentSection
    ? (() => {
        let netExpected = '0.00';
        if (isPreviewType) {
          netExpected = preview?.totals.netPayment ?? '0.00';
        } else {
          const sumSettled = [...state.settlement.selections.values()].reduce(
            (s, sel) => s + (parseFloat(sel.amount) || 0),
            0,
          );
          const wht = parseFloat(state.settlement.whtAmount) || 0;
          netExpected = (sumSettled - wht).toFixed(2);
        }
        const paidNum = state.amountPaid.trim() !== '' ? parseFloat(state.amountPaid) : parseFloat(netExpected);
        const netNum = parseFloat(netExpected) || 0;
        const diff = (paidNum - netNum).toFixed(2);
        return (
          <AdjustmentSection
            diff={diff}
            amountPaid={state.amountPaid}
            onAmountPaidChange={(v) => patch({ amountPaid: v })}
            adjustments={state.adjustments}
            onChange={(rows) => patch({ adjustments: rows })}
            netExpected={netExpected}
          />
        );
      })()
    : null;

  return (
    <div
      className="-mb-[calc(5rem+env(safe-area-inset-bottom,0px))] pt-4 lg:-mb-8"
      onInputCapture={markDirty}
      onChangeCapture={markDirty}
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          onClick={onClose}
          className="flex min-h-11 shrink-0 items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" /> กลับ
        </button>
        {!showQuickStart && !editDocId && (
          <Button type="button" variant="outline" className="min-h-11 gap-1.5" onClick={() => setShowQuickStart(true)}>
            <Star className="size-4" aria-hidden="true" /> ใช้แม่แบบ
          </Button>
        )}
      </div>

      {showQuickStart && (
        <div className="mb-4">
          <QuickStartPanel
            branchId={state.branchId}
            onMode={(m) => {
              if (m === 'blank')
                setState(initial(branchId, user?.defaultCashAccountCode || '11-1101'));
              if (m === 'copy')
                toast.info('เปิดหน้ารายการเพื่อเลือกเอกสารเดิมที่จะคัดลอก');
              if (m === 'template') toast.info("เลือกแม่แบบจาก ใช้บ่อย ด้านล่าง");
            }}
            onPickTemplate={async (tplId) => {
              try {
                const { data } = await api.post(`/expense-templates/${tplId}/instantiate`);
                setState((s) => ({
                  ...s,
                  fromTemplateId: tplId,
                  vendorName: data.vendorName ?? '',
                  lines:
                    (data.expenseDetail?.lines ?? []).length > 0
                      ? data.expenseDetail.lines.map(
                          (l: {
                            category: string;
                            description?: string;
                            quantity: string;
                            unitPrice: string;
                            discount?: string;
                            vatPercent: string;
                            whtPercent: string;
                          }) =>
                            newLine({
                              category: l.category,
                              description: l.description ?? '',
                              quantity: l.quantity?.toString() ?? '1',
                              unitPrice: l.unitPrice?.toString() ?? '',
                              discount: l.discount?.toString() ?? '0',
                              vatPercent: l.vatPercent?.toString() ?? '7',
                              whtPercent: l.whtPercent?.toString() ?? '0',
                            }),
                        )
                      : [newLine()],
                }));
                toast.success("นำเข้าแม่แบบสำเร็จ");
              } catch (e) {
                toast.error(getErrorMessage(e));
              }
            }}
            onClose={() => setShowQuickStart(false)}
          />
        </div>
      )}

      <DocCard
        banner={
          loadedStatus && SENT_BACK_STATUS_LABEL[loadedStatus] ? (
            <p role="status" className="flex items-start gap-2 rounded-lg border border-info/30 bg-info/10 px-3 py-2 text-sm text-foreground leading-snug">
              {/* ตัวหนังสือสีฟ้าบนพื้นฟ้าอ่อนต่ำกว่า 4.5:1 — สีอยู่ที่ไอคอน ตัวหนังสือใช้สีปกติ */}
              <Clock className="size-4 mt-0.5 shrink-0 text-info" aria-hidden="true" />
              {`ใบนี้${SENT_BACK_STATUS_LABEL[loadedStatus]} — บันทึกแล้วใบจะกลับเป็นร่าง ต้องส่งขออนุมัติอีกครั้ง`}
            </p>
          ) : undefined
        }
      >
        <DocHeader
          docType={state.docType}
          onDocTypeChange={(t) => patch({ docType: t })}
          pettyCashEnabled={pettyCashEnabled}
          payrollEnabled={canManagePayroll(user?.role)}
          typeLocked={!!draftId}
          statusLabel={statusLabel}
          branchName={branchName}
          documentNumber={loadedNumber}
          taxInvoice={showVendor ? { value: state.taxInvoiceNo, onChange: (v) => patch({ taxInvoiceNo: v }) } : undefined}
        />

        {showVendor && (
          <FormRow title="ข้อมูลผู้ขาย" complete={!!state.vendorName && !!state.documentDate}>
            <VendorSection state={state} onChange={patch} />
          </FormRow>
        )}
        {showVendor && (
          <FormRow title="ราคาและภาษี" complete>
            <PricingSection state={state} onChange={patch} />
          </FormRow>
        )}

        {isPreviewType && (
          <FormRow title="รายการ" layout="stacked" complete={itemCount > 0}>
            <ItemLinesSection
              lines={state.lines}
              onChange={(lines) => patch({ lines })}
              priceTypeLabel={state.priceType === 'INCLUSIVE' ? 'ราคารวม VAT' : 'ราคาไม่รวม VAT'}
            />
          </FormRow>
        )}
        {state.docType === 'PAYROLL' && (
          <FormRow title="งวดเงินเดือน + พนักงาน" layout="stacked">
            <PayrollLinesSection
              value={state.payroll}
              onChange={(p) => patch({ payroll: p })}
              documentDate={state.documentDate}
              onDocumentDateChange={(d) => patch({ documentDate: d })}
              branchId={state.branchId}
              documentId={draftId}
              onSaveAndCompute={() => startSave({ andPost: false, stay: true })}
              computing={saveMutation.isPending}
              computeDisabled={!ready}
              viewer={user ? { role: user.role, branchId: user.branchId } : null}
            />
          </FormRow>
        )}
        {state.docType === 'VENDOR_SETTLEMENT' && (
          <FormRow title="เอกสารตั้งหนี้ที่จะล้าง" layout="stacked">
            <SettlementLinesSection
              branchId={state.branchId}
              value={state.settlement}
              onChange={(s) => patch({ settlement: s })}
            />
          </FormRow>
        )}
        {/* D1.1.5.1 — gated by pettyCashEnabled flag. The auto-flip
            effect above guarantees state.docType won't be Petty Cash
            while the flag is off, but we keep the && here as a second
            line of defense for race conditions during the flag fetch. */}
        {state.docType === 'PETTY_CASH_REIMBURSEMENT' && pettyCashEnabled && (
          <FormRow title="รายการเงินสดย่อย" layout="stacked">
            <PettyCashLinesSection value={state.pettyCash} onChange={(pc) => patch({ pettyCash: pc })} />
          </FormRow>
        )}
        {state.docType === 'CREDIT_NOTE' && (
          <FormRow title="ใบลดหนี้ — เอกสารต้นฉบับ + รายการ" layout="stacked">
            <CreditNoteLinesSection state={state} onChange={patch} onLinesChange={(lines) => patch({ lines })} />
          </FormRow>
        )}

        {isPreviewType && (
          <FormRow title="สรุปข้อมูล">
            <SummaryBox
              rows={[
                { label: 'มูลค่าก่อนภาษี', value: money(preview?.totals.subtotal) },
                { label: 'ภาษีมูลค่าเพิ่ม', value: money(preview?.totals.vatAmount) },
                { label: 'หัก ณ ที่จ่าย', value: money(preview?.totals.withholdingTax) },
              ]}
              total={{ label: 'จำนวนเงินทั้งสิ้น', value: money(preview?.totals.totalAmount) }}
            />
          </FormRow>
        )}

        {showPayment && (
          <PaymentSection
            picker={
              <div className="w-full sm:max-w-md">
                <label htmlFor={payById} className={formLabelClass}>ชำระโดย</label>
                <CashAccountSelect
                  id={payById}
                  placeholder="ชำระโดย"
                  value={state.depositAccountCode}
                  onChange={(code) => patch({ depositAccountCode: code })}
                  codes={
                    state.docType === 'PAYROLL' && state.payroll.entityScope === 'SHOP'
                      ? SHOP_CASH_ACCOUNT_CODES
                      : undefined
                  }
                />
              </div>
            }
            unpaid={
              isPreviewType
                ? {
                    active: state.docType === 'EXPENSE_ACCRUAL',
                    onMarkUnpaid: () => patch({ docType: 'EXPENSE_ACCRUAL' }),
                    onMarkPaid: () => patch({ docType: 'EXPENSE_SAMEDAY' }),
                    backdatedHint,
                  }
                : undefined
            }
            advanced={
              adjustmentNode ? { hasData: hasAdjustmentData, onClear: clearAdjustments, content: adjustmentNode } : undefined
            }
            footer={
              state.docType === 'PAYROLL' ? (
                <p className="text-xs text-muted-foreground leading-snug">
                  {state.payroll.entityScope === 'SHOP'
                    ? 'เงินเดือนพนักงานสาขาจ่ายจากบัญชีของหน้าร้าน (SHOP) เท่านั้น'
                    : 'เงินเดือนส่วนกลางจ่ายจากบัญชีของ FINANCE'}
                </p>
              ) : isPreviewType ? (
                <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <span className="text-sm leading-snug text-muted-foreground">ยอดชำระสุทธิ (หลังหัก ณ ที่จ่าย)</span>
                  <span className="text-lg font-bold tabular-nums leading-snug">{money(preview?.totals.netPayment)} บาท</span>
                </div>
              ) : undefined
            }
          />
        )}

        {isPreviewType && (
          <FormRow
            title="ตัวอย่างรายการบัญชี"
            layout="stacked"
            action={
              <div className="flex flex-wrap items-center justify-end gap-x-4 gap-y-1">
                <span className={cn('flex items-center gap-1.5 text-sm leading-snug', preview?.totals.balanced ? 'text-primary' : 'text-muted-foreground')}>
                  {preview?.totals.balanced && <CheckCircle2 className="size-4 shrink-0" aria-hidden="true" />}
                  {error
                    ? 'คำนวณไม่ได้'
                    : !preview
                      ? loading ? 'กำลังคำนวณ…' : 'ยังไม่มีรายการ'
                      : preview.totals.balanced
                        ? `สมดุล เดบิต ${formatNumberDecimal(preview.totals.drSum)} = เครดิต ${formatNumberDecimal(preview.totals.crSum)}`
                        : 'ยังไม่สมดุล'}
                </span>
                <button
                  type="button"
                  aria-expanded={showJe || !!error}
                  onClick={() => setShowJe((v) => !v)}
                  className="min-h-11 px-1 text-sm font-medium leading-snug text-primary"
                >
                  ย่อ/ขยาย
                </button>
              </div>
            }
          >
            {(showJe || !!error) && <JePreview preview={preview} loading={loading} error={error} />}
          </FormRow>
        )}

        <FormRow title="ผู้บันทึก & ผู้อนุมัติ">
          <ApproverSection />
        </FormRow>
      </DocCard>

      <StickyActionBar
        notices={
          <>
            {!maySubmit && (
              <p className="mx-auto w-full max-w-6xl px-4 py-2 text-sm text-muted-foreground lg:px-7" role="status">
                {permissions.isError ? 'โหลดสิทธิ์ไม่สำเร็จ' : permissions.isPending ? 'กำลังตรวจสอบสิทธิ์…' : "ไม่มีสิทธิ์ลงบัญชี รายจ่าย — สามารถบันทึกร่างได้"}
                {permissions.isError && <Button variant="ghost" onClick={() => permissions.refetch()}>ลองใหม่</Button>}
              </p>
            )}
            {payrollNotice && (
              <div
                ref={noticeRef}
                tabIndex={-1}
                role="alert"
                className={cn(
                  'flex items-start gap-2 border-b px-4 py-2 text-sm leading-snug focus:outline-hidden lg:px-7',
                  payrollNotice.tone === 'warning'
                    ? 'border-warning/40 bg-warning/10 text-warning-strong'
                    : 'border-destructive/30 bg-destructive/10 text-destructive',
                )}
              >
                {payrollNotice.tone === 'warning' ? (
                  <Clock className="size-4 mt-0.5 shrink-0" aria-hidden="true" />
                ) : (
                  <AlertTriangle className="size-4 mt-0.5 shrink-0" aria-hidden="true" />
                )}
                <p className="min-w-0">{payrollNotice.message}</p>
              </div>
            )}
          </>
        }
        summary={
          <>
            <span className="font-semibold">{docTypeLabel(state.docType)}</span>
            <span className="text-muted-foreground">{itemCount} รายการ</span>
            <span className={cn('flex items-center gap-1', ready ? 'text-success' : 'text-muted-foreground')}>
              {ready ? <CheckCircle2 className="size-3" /> : <Clock className="size-3" />}
              {ready ? 'พร้อมบันทึก' : 'ยังไม่ครบ'}
            </span>
          </>
        }
      >
        <Button variant="ghost" onClick={onClose} className="col-span-2 min-h-11 sm:col-span-1">
          ยกเลิก
        </Button>
        <Button
          className="h-auto min-h-11 whitespace-normal py-2"
          variant="outline"
          onClick={() => startSave({ andPost: false })}
          disabled={!ready || saveMutation.isPending}
        >
          บันทึกร่าง
        </Button>
        <Button
          className="h-auto min-h-11 whitespace-normal py-2"
          onClick={() => startSave({ andPost: true })}
          disabled={!ready || saveMutation.isPending || !maySubmit}
          title={!maySubmit ? "ไม่มีสิทธิ์ลงบัญชี รายจ่าย — สามารถบันทึกร่างได้" : undefined}
        >
          {requiresApproval ? 'บันทึกและขออนุมัติ' : 'บันทึกและลงบัญชี'}
        </Button>
      </StickyActionBar>
    </div>
  );
}
