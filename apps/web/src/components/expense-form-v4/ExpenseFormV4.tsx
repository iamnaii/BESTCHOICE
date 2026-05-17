import { useState, useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import api, { getErrorMessage } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Receipt, Users, Banknote, FileText, Check, CheckCircle2, Clock } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useUiFlags } from '@/hooks/useUiFlags';
import { cn } from '@/lib/utils';
import { ExpenseFormState, newLine, newPayrollLine, newPettyCashLine } from './types';
import { useFormCompute } from './useFormCompute';
import { QuickStartPanel } from './QuickStartPanel';
import { DocTypePicker } from './DocTypePicker';
import { VendorSection } from './VendorSection';
import { ItemLinesSection } from './ItemLinesSection';
import { PayrollLinesSection } from './PayrollLinesSection';
import { SettlementLinesSection } from './SettlementLinesSection';
import { PettyCashLinesSection } from './PettyCashLinesSection';
import { CreditNoteLinesSection } from './CreditNoteLinesSection';
import { CashAccountVisualPicker } from './CashAccountVisualPicker';
import { JePreview } from './JePreview';
import { ApproverSection } from './ApproverSection';
import { AdjustmentSection } from './AdjustmentSection';
import { formatNumberDecimal } from '@/utils/formatters';

interface Props {
  branchId: string;
  onClose: () => void;
  onSaved: () => void;
}

// W3 fix — return YYYY-MM-DD for "today in Asia/Bangkok" (en-CA gives ISO-shaped
// output). Previously used `new Date().toISOString().slice(0,10)` which returns
// UTC-day — after 17:00 BKK that becomes tomorrow's BKK calendar date, so the
// default for the docDate input was off by one half the working day.
const todayBkkIso = (): string =>
  new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });

const initial = (branchId: string, defaultCash: string): ExpenseFormState => {
  const today = new Date();
  return {
    docType: 'EXPENSE_SAMEDAY',
    branchId,
    documentDate: todayBkkIso(),
    vendorName: '',
    vendorTaxId: '',
    taxInvoiceNo: '',
    priceType: 'EXCLUSIVE',
    whtFormType: '',
    paymentMethod: 'CASH',
    depositAccountCode: defaultCash,
    reference: '',
    receiptImageUrl: '',
    note: '',
    approvedById: '',
    fromTemplateId: '',
    lines: [newLine()],
    cnMode: 'LINKED',
    originalDocumentId: '',
    cnReason: '',
    payroll: {
      year: today.getFullYear() + 543,
      month: today.getMonth() + 1,
      payrollPeriod: `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`,
      lines: [newPayrollLine()],
    },
    settlement: {
      selections: new Map(),
      vendorName: '',
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

export function ExpenseFormV4({ branchId, onClose, onSaved }: Props) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  // D1.1.5.1 — Petty Cash feature flag. When disabled, the picker hides the
  // PETTY_CASH_REIMBURSEMENT chip and the form section is not rendered.
  // Auto-flip away from PETTY_CASH_REIMBURSEMENT when the flag flips off
  // mid-session (handled in the effect below).
  const { pettyCashEnabled } = useUiFlags();
  const [showQuickStart, setShowQuickStart] = useState(true);
  const [state, setState] = useState<ExpenseFormState>(() =>
    initial(branchId, user?.defaultCashAccountCode || '11-1101'),
  );

  const patch = (p: Partial<ExpenseFormState>) => setState((s) => ({ ...s, ...p }));

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
  const todayIso = todayBkkIso();
  const invoiceIsToday = state.documentDate === todayIso;
  useEffect(() => {
    if (state.docType === 'EXPENSE_SAMEDAY' && !invoiceIsToday) {
      patch({ docType: 'EXPENSE_ACCRUAL' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.documentDate]);

  const { preview, loading, error } = useFormCompute(state);

  const saveMutation = useMutation({
    mutationFn: async ({ andPost }: { andPost: boolean }) => {
      let createdId: string | null = null;

      if (state.docType === 'EXPENSE_SAMEDAY' || state.docType === 'EXPENSE_ACCRUAL') {
        const payload = {
          documentType: 'EXPENSE',
          branchId: state.branchId,
          documentDate: state.documentDate,
          priceType: state.priceType,
          vendorName: state.vendorName || undefined,
          vendorTaxId: state.vendorTaxId || undefined,
          taxInvoiceNo: state.taxInvoiceNo || undefined,
          whtFormType: state.whtFormType || undefined,
          paymentMethod: state.docType === 'EXPENSE_SAMEDAY' ? state.paymentMethod : undefined,
          depositAccountCode:
            state.docType === 'EXPENSE_SAMEDAY' ? state.depositAccountCode : undefined,
          approvedById: state.approvedById || undefined,
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
        const { data } = await api.post('/expense-documents/payroll', {
          branchId: state.branchId,
          documentDate: state.documentDate,
          payrollPeriod: state.payroll.payrollPeriod,
          depositAccountCode: state.depositAccountCode,
          paymentMethod: 'BANK_TRANSFER',
          lines: state.payroll.lines
            .filter((l) => l.employeeName && parseFloat(l.baseSalary) > 0)
            .map((l) => {
              const validIncome = (l.customIncome ?? []).filter(
                (r) => r.accountCode && parseFloat(r.amount) > 0,
              );
              const validDeduction = (l.customDeduction ?? []).filter(
                (r) => r.accountCode && parseFloat(r.amount) > 0,
              );
              return {
                employeeName: l.employeeName,
                employeeTaxId: l.employeeTaxId || undefined,
                baseSalary: parseFloat(l.baseSalary),
                ssoEmployee: parseFloat(l.ssoEmployee) || 0,
                whtAmount: parseFloat(l.whtAmount) || 0,
                customIncome:
                  validIncome.length > 0
                    ? validIncome.map((r) => ({
                        accountCode: r.accountCode,
                        name: r.name || r.accountCode,
                        amount: parseFloat(r.amount),
                        isTaxable: r.isTaxable,
                      }))
                    : undefined,
                customDeduction:
                  validDeduction.length > 0
                    ? validDeduction.map((r) => ({
                        accountCode: r.accountCode,
                        name: r.name || r.accountCode,
                        amount: parseFloat(r.amount),
                      }))
                    : undefined,
              };
            }),
        });
        createdId = data.id;
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
          lines: validLines.map((l) => ({
            category: l.category,
            description: l.description || undefined,
            quantity: parseFloat(l.quantity) || 1,
            unitPrice: parseFloat(l.unitPrice) || 0,
            discount: parseFloat(l.discount) || 0,
            vatPercent: parseFloat(l.vatPercent) || 0,
            whtPercent: parseFloat(l.whtPercent) || 0,
          })),
        });
        createdId = data.id;
      }

      if (andPost && createdId) {
        await api.post(`/expense-documents/${createdId}/post`);
      }
      return { id: createdId };
    },
    onSuccess: () => {
      toast.success('บันทึกรายจ่ายสำเร็จ');
      queryClient.invalidateQueries({ queryKey: ['expenses'] });
      queryClient.invalidateQueries({ queryKey: ['expenses-summary'] });
      onSaved();
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  });

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

  return (
    <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="w-full max-w-5xl bg-background rounded-xl shadow-modal max-h-[95vh] flex flex-col">
        {/* Header — flex-none so it doesn't shrink */}
        <div className="flex-none bg-background border-b px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onClose}
              className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="size-4" /> กลับ
            </button>
            <div className="flex items-center gap-2 text-lg font-semibold">
              <Receipt className="size-5 text-primary" /> บันทึกค่าใช้จ่ายใหม่
            </div>
          </div>
          <span className="text-xs px-2 py-1 rounded bg-muted text-muted-foreground">DRAFT</span>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {/* Quick Start */}
          {showQuickStart && (
            <QuickStartPanel
              branchId={state.branchId}
              onMode={(m) => {
                if (m === 'blank')
                  setState(initial(branchId, user?.defaultCashAccountCode || '11-1101'));
                if (m === 'copy')
                  toast.info('เปิดหน้ารายการเพื่อเลือกเอกสารเดิมที่จะคัดลอก');
                if (m === 'template') toast.info('เลือก template จาก ใช้บ่อย ด้านล่าง');
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
                  toast.success('นำเข้า template สำเร็จ');
                } catch (e) {
                  toast.error(getErrorMessage(e));
                }
              }}
              onClose={() => setShowQuickStart(false)}
            />
          )}

          {/* Dynamic section numbers — sections are conditionally rendered so we
              compute the counter inline to avoid visible gaps (e.g. 1,3,4,5,6). */}
          {(() => {
            let n = 0;
            const next = () => ++n;
            const showVendor =
              state.docType === 'EXPENSE_SAMEDAY' ||
              state.docType === 'EXPENSE_ACCRUAL' ||
              state.docType === 'CREDIT_NOTE';
            const showCash =
              state.docType === 'EXPENSE_SAMEDAY' ||
              state.docType === 'PAYROLL' ||
              state.docType === 'VENDOR_SETTLEMENT' ||
              state.docType === 'PETTY_CASH_REIMBURSEMENT';
            return (
              <>
                {/* Section: Doc-type picker — always visible (P2-1 chip cards) */}
                <Section num={next()} title="ประเภทเอกสาร" Icon={FileText}>
                  <DocTypePicker
                    value={state.docType}
                    onChange={(t) => patch({ docType: t })}
                    invoiceDateIsToday={invoiceIsToday}
                    pettyCashEnabled={pettyCashEnabled}
                  />
                </Section>

                {/* Section: Vendor — EX/CN only */}
                {showVendor && (
                  <Section num={next()} title="ผู้ขาย & วันที่ใบกำกับ" Icon={Users}>
                    <VendorSection state={state} onChange={patch} />
                  </Section>
                )}

                {/* Section: Lines — mutually exclusive per docType */}
                {(state.docType === 'EXPENSE_SAMEDAY' || state.docType === 'EXPENSE_ACCRUAL') && (
                  <Section num={next()} title="รายการบัญชี" Icon={Receipt}>
                    <ItemLinesSection
                      lines={state.lines}
                      onChange={(lines) => patch({ lines })}
                      priceTypeLabel={state.priceType === 'INCLUSIVE' ? 'ราคารวม VAT' : 'ราคาไม่รวม VAT'}
                    />
                  </Section>
                )}
                {state.docType === 'PAYROLL' && (
                  <Section num={next()} title="งวดเงินเดือน + พนักงาน" Icon={Users}>
                    <PayrollLinesSection
                      value={state.payroll}
                      onChange={(p) => patch({ payroll: p })}
                      documentDate={state.documentDate}
                      onDocumentDateChange={(d) => patch({ documentDate: d })}
                    />
                  </Section>
                )}
                {state.docType === 'VENDOR_SETTLEMENT' && (
                  <Section num={next()} title="เอกสารตั้งหนี้ที่จะล้าง" Icon={FileText}>
                    <SettlementLinesSection
                      branchId={state.branchId}
                      value={state.settlement}
                      onChange={(s) => patch({ settlement: s })}
                    />
                  </Section>
                )}
                {/* D1.1.5.1 — gated by pettyCashEnabled flag. The auto-flip
                    effect above guarantees state.docType won't be Petty Cash
                    while the flag is off, but we keep the && here as a second
                    line of defense for race conditions during the flag fetch. */}
                {state.docType === 'PETTY_CASH_REIMBURSEMENT' && pettyCashEnabled && (
                  <Section num={next()} title="รายการเงินสดย่อย (Petty Cash)" Icon={Receipt}>
                    <PettyCashLinesSection
                      value={state.pettyCash}
                      onChange={(pc) => patch({ pettyCash: pc })}
                    />
                  </Section>
                )}
                {state.docType === 'CREDIT_NOTE' && (
                  <Section num={next()} title="ใบลดหนี้ — เอกสารต้นฉบับ + รายการ" Icon={Receipt}>
                    <CreditNoteLinesSection
                      state={state}
                      onChange={patch}
                      onLinesChange={(lines) => patch({ lines })}
                    />
                  </Section>
                )}

                {/* Section: Cash account (SAMEDAY, PAYROLL, VENDOR_SETTLEMENT) */}
                {showCash && (
                  <Section num={next()} title="ช่องทางจ่ายเงิน" Icon={Banknote}>
                    <CashAccountVisualPicker
                      value={state.depositAccountCode}
                      onChange={(code) => patch({ depositAccountCode: code })}
                    />
                    {state.docType === 'EXPENSE_SAMEDAY' && (
                      <div className="grid grid-cols-3 gap-2 mt-4 text-xs">
                        <Stat label="ที่ต้องจ่าย" value={preview?.totals.netPayment ?? '0.00'} />
                        <Stat label="จ่ายจริง" value={preview?.totals.netPayment ?? '0.00'} />
                        <Stat label="ผลต่าง" value="0.00" highlight />
                      </div>
                    )}
                  </Section>
                )}

                {/* Section: Multi-line Adjustment (Fix Report P0-4, B2 for SE).
                    Shown for SAMEDAY (cash leg = totalAmount − wht; covers
                    overpay/underpay/rounding) and VENDOR_SETTLEMENT (cash leg
                    = sumSettled − wht; covers supplier discounts/fees). ACCRUAL,
                    PAYROLL, CREDIT_NOTE have no client-driven cash leg so the
                    section is hidden. */}
                {(state.docType === 'EXPENSE_SAMEDAY' || state.docType === 'VENDOR_SETTLEMENT') && (
                  <Section num={next()} title="บัญชีปรับผลต่าง (ถ้ามี)" Icon={Receipt}>
                    {(() => {
                      // SAMEDAY pulls netExpected from JE preview (server-computed).
                      // SE has no JE preview yet, so compute locally:
                      // netExpected = Σ selections.amount − whtAmount.
                      let netExpected = '0.00';
                      if (state.docType === 'EXPENSE_SAMEDAY') {
                        netExpected = preview?.totals.netPayment ?? '0.00';
                      } else {
                        const sumSettled = [...state.settlement.selections.values()].reduce(
                          (s, sel) => s + (parseFloat(sel.amount) || 0),
                          0,
                        );
                        const wht = parseFloat(state.settlement.whtAmount) || 0;
                        netExpected = (sumSettled - wht).toFixed(2);
                      }
                      const paidNum =
                        state.amountPaid.trim() !== ''
                          ? parseFloat(state.amountPaid)
                          : parseFloat(netExpected);
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
                    })()}
                  </Section>
                )}

                {/* Section: JE Preview — only meaningful for EXPENSE flows.
                    JePreviewService server-side only handles EXPENSE_SAMEDAY /
                    EXPENSE_ACCRUAL today; PAYROLL / VENDOR_SETTLEMENT /
                    CREDIT_NOTE previews are deferred (I3). */}
                {(state.docType === 'EXPENSE_SAMEDAY' || state.docType === 'EXPENSE_ACCRUAL') && (
                  <Section num={next()} title="AUTO JOURNAL PREVIEW" Icon={Check}>
                    <JePreview preview={preview} loading={loading} error={error} />
                  </Section>
                )}

                {/* Section: Approver */}
                <Section num={next()} title="ผู้บันทึก & ผู้อนุมัติ" Icon={Users}>
                  <ApproverSection
                    approvedById={state.approvedById}
                    onChange={(id) => patch({ approvedById: id })}
                  />
                </Section>
              </>
            );
          })()}
        </div>

        {/* Footer */}
        <div className="flex-none bg-background border-t px-6 py-3 flex items-center justify-between">
          <Button variant="ghost" onClick={onClose} className="gap-1.5">
            <ArrowLeft className="size-4" />
            ยกเลิก
          </Button>
          <div className="flex items-center gap-3 text-xs">
            <span>Items: {itemCount}</span>
            <span className={cn('flex items-center gap-1', ready ? 'text-success' : 'text-muted-foreground')}>
              {ready ? <CheckCircle2 className="size-3" /> : <Clock className="size-3" />}
              {ready ? 'Ready' : 'ยังไม่พร้อม'}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              onClick={() => saveMutation.mutate({ andPost: false })}
              disabled={!ready || saveMutation.isPending}
            >
              บันทึกร่าง
            </Button>
            <Button
              onClick={() => saveMutation.mutate({ andPost: true })}
              disabled={!ready || saveMutation.isPending}
            >
              บันทึก & POST
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Section({
  num,
  title,
  Icon,
  children,
}: {
  num: number;
  title: string;
  Icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="flex items-center gap-2.5 mb-4">
        <span className="flex items-center justify-center size-7 rounded bg-primary/10 text-primary text-sm font-mono font-medium">
          {num}
        </span>
        <Icon className="size-4 text-muted-foreground" />
        <span className="text-sm font-semibold leading-snug">{title}</span>
      </div>
      {children}
    </div>
  );
}

function Stat({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={cn(
        'rounded-lg p-2',
        highlight ? 'bg-success/10 border border-success/30' : 'bg-muted/30',
      )}
    >
      <div className="text-muted-foreground leading-snug">{label}</div>
      <div className="font-mono font-semibold">{formatNumberDecimal(value)}</div>
    </div>
  );
}
