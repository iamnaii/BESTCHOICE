import { useState, useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import api, { getErrorMessage } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Receipt, Users, Banknote, FileText, Check } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { cn } from '@/lib/utils';
import { ExpenseFormState, newLine, newPayrollLine } from './types';
import { useFormCompute } from './useFormCompute';
import { QuickStartPanel } from './QuickStartPanel';
import { TypeTabs } from './TypeTabs';
import { VendorSection } from './VendorSection';
import { ItemLinesSection } from './ItemLinesSection';
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
      const isEx = state.docType === 'EXPENSE_SAMEDAY' || state.docType === 'EXPENSE_ACCRUAL';
      if (!isEx) {
        throw new Error('PR/SE/CN paths wired in Task 20');
      }
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
      if (andPost) await api.post(`/expense-documents/${data.id}/post`);
      return data;
    },
    onSuccess: () => {
      toast.success('บันทึกรายจ่ายสำเร็จ');
      queryClient.invalidateQueries({ queryKey: ['expenses'] });
      queryClient.invalidateQueries({ queryKey: ['expenses-summary'] });
      onSaved();
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  });

  const itemCount = state.lines.filter((l) => l.category).length;
  const ready = !!preview && preview.totals.balanced && itemCount > 0;

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-start justify-center pt-8 pb-8 overflow-y-auto">
      <div className="w-full max-w-5xl bg-background rounded-xl shadow-lg min-h-[80vh]">
        {/* Header */}
        <div className="sticky top-0 z-10 bg-background/95 backdrop-blur-sm border-b px-6 py-4 flex items-center justify-between">
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

        <div className="p-6 space-y-5">
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

          {/* Section 1: Type tabs */}
          <Section num={1} title="ประเภทเอกสาร" Icon={FileText}>
            <TypeTabs
              value={state.docType}
              onChange={(t) => patch({ docType: t })}
              invoiceDateIsToday={invoiceIsToday}
            />
          </Section>

          {/* Section 2: Vendor — EX/CN only */}
          {(state.docType === 'EXPENSE_SAMEDAY' ||
            state.docType === 'EXPENSE_ACCRUAL' ||
            state.docType === 'CREDIT_NOTE') && (
            <Section num={2} title="ผู้ขาย & วันที่ใบกำกับ" Icon={Users}>
              <VendorSection state={state} onChange={patch} />
            </Section>
          )}

          {/* Section 3: Lines — EX only (PR/SE/CN in Task 20) */}
          {(state.docType === 'EXPENSE_SAMEDAY' || state.docType === 'EXPENSE_ACCRUAL') && (
            <Section num={3} title="รายการบัญชี" Icon={Receipt}>
              <ItemLinesSection
                lines={state.lines}
                onChange={(lines) => patch({ lines })}
                priceTypeLabel={state.priceType === 'INCLUSIVE' ? 'ราคารวม VAT' : 'ราคาไม่รวม VAT'}
              />
            </Section>
          )}

          {/* PR/SE/CN placeholder until Task 20 */}
          {(state.docType === 'PAYROLL' ||
            state.docType === 'VENDOR_SETTLEMENT' ||
            state.docType === 'CREDIT_NOTE') && (
            <Section num={3} title="รายการ" Icon={Receipt}>
              <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground leading-snug">
                {state.docType === 'PAYROLL' && 'แบบฟอร์มเงินเดือนจะเชื่อมในขั้นถัดไป'}
                {state.docType === 'VENDOR_SETTLEMENT' && 'แบบฟอร์มจ่ายเจ้าหนี้จะเชื่อมในขั้นถัดไป'}
                {state.docType === 'CREDIT_NOTE' && 'แบบฟอร์มใบลดหนี้จะเชื่อมในขั้นถัดไป'}
              </div>
            </Section>
          )}

          {/* Section 4: Cash account (Same-day only) */}
          {state.docType === 'EXPENSE_SAMEDAY' && (
            <Section num={4} title="ช่องทางจ่ายเงิน" Icon={Banknote}>
              <CashAccountVisualPicker
                value={state.depositAccountCode}
                onChange={(code) => patch({ depositAccountCode: code })}
              />
              <div className="grid grid-cols-3 gap-2 mt-4 text-xs">
                <Stat label="ที่ต้องจ่าย" value={preview?.totals.netPayment ?? '0.00'} />
                <Stat label="จ่ายจริง" value={preview?.totals.netPayment ?? '0.00'} />
                <Stat label="ผลต่าง" value="0.00" highlight />
              </div>
            </Section>
          )}

          {/* Section 5: JE Preview */}
          <Section num={5} title="AUTO JOURNAL PREVIEW" Icon={Check}>
            <JePreview preview={preview} loading={loading} error={error} />
          </Section>

          {/* Section 6: Approver */}
          <Section num={6} title="ผู้บันทึก & ผู้อนุมัติ" Icon={Users}>
            <ApproverSection
              approvedById={state.approvedById}
              onChange={(id) => patch({ approvedById: id })}
            />
          </Section>
        </div>

        {/* Footer */}
        <div className="sticky bottom-0 bg-background/95 backdrop-blur-sm border-t px-6 py-3 flex items-center justify-between">
          <Button variant="ghost" onClick={onClose}>
            ← ยกเลิก
          </Button>
          <div className="flex items-center gap-3 text-xs">
            <span>Items: {itemCount}</span>
            <span className={ready ? 'text-success' : 'text-muted-foreground'}>
              {ready ? '✓ Ready' : '⌛ ยังไม่พร้อม'}
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
