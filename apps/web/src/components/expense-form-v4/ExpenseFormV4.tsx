import { useState, useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import api, { getErrorMessage } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Receipt, Users, Banknote, FileText, Check, CheckCircle2, Clock } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { cn } from '@/lib/utils';
import { ExpenseFormState, newLine, newPayrollLine } from './types';
import { useFormCompute } from './useFormCompute';
import { QuickStartPanel } from './QuickStartPanel';
import { TypeTabs } from './TypeTabs';
import { VendorSection } from './VendorSection';
import { ItemLinesSection } from './ItemLinesSection';
import { PayrollLinesSection } from './PayrollLinesSection';
import { SettlementLinesSection } from './SettlementLinesSection';
import { CreditNoteLinesSection } from './CreditNoteLinesSection';
import { CashAccountVisualPicker } from './CashAccountVisualPicker';
import { JePreview } from './JePreview';
import { ApproverSection } from './ApproverSection';
import { formatNumberDecimal } from '@/utils/formatters';

interface Props {
  branchId: string;
  onClose: () => void;
  onSaved: () => void;
}

const initial = (branchId: string, defaultCash: string): ExpenseFormState => {
  const today = new Date();
  return {
    docType: 'EXPENSE_SAMEDAY',
    branchId,
    documentDate: today.toISOString().slice(0, 10),
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
  };
};

export function ExpenseFormV4({ branchId, onClose, onSaved }: Props) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [showQuickStart, setShowQuickStart] = useState(true);
  const [state, setState] = useState<ExpenseFormState>(() =>
    initial(branchId, user?.defaultCashAccountCode || '11-1101'),
  );

  const patch = (p: Partial<ExpenseFormState>) => setState((s) => ({ ...s, ...p }));

  // Smart default: switch SAMEDAY → ACCRUAL when invoice date is not today.
  // One-way: only auto-flip from SAMEDAY to ACCRUAL; does not revert manual ACCRUAL selection.
  const todayIso = new Date().toISOString().slice(0, 10);
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
            })),
        };
        const { data } = await api.post('/expense-documents', payload);
        createdId = data.id;
      } else if (state.docType === 'PAYROLL') {
        const { data } = await api.post('/expense-documents/payroll', {
          branchId: state.branchId,
          documentDate: state.documentDate,
          payrollPeriod: state.payroll.payrollPeriod,
          depositAccountCode: state.depositAccountCode,
          paymentMethod: 'BANK_TRANSFER',
          lines: state.payroll.lines
            .filter((l) => l.employeeName && parseFloat(l.baseSalary) > 0)
            .map((l) => ({
              employeeName: l.employeeName,
              employeeTaxId: l.employeeTaxId || undefined,
              baseSalary: parseFloat(l.baseSalary),
              ssoEmployee: parseFloat(l.ssoEmployee) || 0,
              whtAmount: parseFloat(l.whtAmount) || 0,
            })),
        });
        createdId = data.id;
      } else if (state.docType === 'VENDOR_SETTLEMENT') {
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
        });
        createdId = data.id;
      } else if (state.docType === 'CREDIT_NOTE') {
        if (!state.originalDocumentId || !state.cnReason.trim()) {
          throw new Error('กรุณาเลือกเอกสารต้นฉบับและระบุเหตุผล');
        }
        const validLines = state.lines.filter((l) => l.category && parseFloat(l.unitPrice) > 0);
        if (validLines.length === 0) {
          throw new Error('ต้องมีรายการบัญชีอย่างน้อย 1 บรรทัด');
        }
        // Server computes totals from lines — no preview-je hop needed.
        // This also eliminates the float-string-Decimal dance at the money boundary.
        const { data } = await api.post('/expense-documents/credit-note', {
          branchId: state.branchId,
          documentDate: state.documentDate,
          originalDocumentId: state.originalDocumentId,
          reason: state.cnReason,
          depositAccountCode: state.depositAccountCode || undefined,
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
              state.docType === 'VENDOR_SETTLEMENT';
            return (
              <>
                {/* Section: Type tabs — always visible */}
                <Section num={next()} title="ประเภทเอกสาร" Icon={FileText}>
                  <TypeTabs
                    value={state.docType}
                    onChange={(t) => patch({ docType: t })}
                    invoiceDateIsToday={invoiceIsToday}
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

                {/* Section: JE Preview */}
                <Section num={next()} title="AUTO JOURNAL PREVIEW" Icon={Check}>
                  <JePreview preview={preview} loading={loading} error={error} />
                </Section>

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
          <Button variant="ghost" onClick={onClose}>
            ← ยกเลิก
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
