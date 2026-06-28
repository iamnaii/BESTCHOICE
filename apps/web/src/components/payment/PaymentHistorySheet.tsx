import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FileText, X } from 'lucide-react';
import api, { getErrorMessage } from '@/lib/api';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogBody } from '@/components/ui/dialog';
import { formatDateShort, formatNumberDecimal } from '@/utils/formatters';
import { useAuth } from '@/contexts/AuthContext';
import ReceiptVoidDialog from '@/components/payment/ReceiptVoidDialog';
import { toast } from 'sonner';

/* ─── Types ───────────────────────────────────────── */
interface PaymentItem {
  id: string;
  installmentNo: number;
  amountDue: string;
  amountPaid: string;
  lateFee: string;
  lateFeeWaived: boolean;
  waivedAmount: string | null;
  waivedReason: string | null;
  waivedApprovedByName: string | null;
  depositAccountCode: string | null;
  status: string;
  paymentMethod: string | null;
  recordedBy: { name: string } | null;
}
interface ContractInfo {
  contractNumber: string;
  customerName: string | null;
  productName: string | null;
  totalMonths: number;
  advanceBalance: string;
}
interface PaymentsResponse {
  data: PaymentItem[];
  contract?: ContractInfo;
}
interface ReceiptItem {
  id: string;
  receiptNumber: string;
  receiptType: string;
  amount: string;
  installmentNo: number | null;
  paymentId: string | null;
  paymentMethod: string | null;
  paymentStatus: string | null;
  isVoided: boolean;
  paidDate: string;
  issuedByName: string | null;
}

const VOID_ROLES = ['OWNER', 'ACCOUNTANT', 'BRANCH_MANAGER', 'FINANCE_MANAGER'];
// Use the shared money formatter (honours user separator preference + ROUND_HALF_UP).
const money = (n: number | string) => formatNumberDecimal(n, 2);

/** Derived CASE label + token color (no persisted `case` field). */
function caseFor(r: ReceiptItem, p: PaymentItem | undefined): { label: string; cls: string } {
  if (r.receiptType === 'EARLY_PAYOFF') return { label: 'ปิดยอด', cls: 'text-warning' };
  if (r.receiptType === 'DOWN_PAYMENT') return { label: 'ดาวน์', cls: 'text-warning' };
  if (r.receiptType === 'CREDIT_NOTE') return { label: 'ใบลดหนี้', cls: 'text-warning' };
  if (r.paymentStatus === 'PARTIAL') return { label: 'PARTIAL', cls: 'text-info' };
  if (p && Number(r.amount) > Number(p.amountDue)) return { label: 'OVER', cls: 'text-primary' };
  return { label: 'NORMAL', cls: 'text-success' };
}

async function downloadReceiptPdf(receiptId: string, receiptNumber: string) {
  try {
    const res = await api.get(`/receipts/${receiptId}/pdf`, { responseType: 'blob' });
    const url = URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${receiptNumber}.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch (err) {
    toast.error(getErrorMessage(err) || 'ไม่สามารถดาวน์โหลดใบเสร็จ');
  }
}

interface Props {
  contractId: string | null;
  onClose: () => void;
}

export default function PaymentHistorySheet({ contractId, onClose }: Props) {
  const { user } = useAuth();
  const canVoid = VOID_ROLES.includes(user?.role ?? '');
  const [voidTarget, setVoidTarget] = useState<{ id: string; receiptNumber: string } | null>(null);

  const {
    data: pResp,
    isLoading: loadingPayments,
    isError,
  } = useQuery<PaymentsResponse>({
    queryKey: ['contract-payments', contractId],
    queryFn: async () =>
      (await api.get(`/payments/contract/${contractId}`, { params: { limit: 200 } })).data,
    enabled: !!contractId,
  });
  const { data: receipts = [], isLoading: loadingReceipts } = useQuery<ReceiptItem[]>({
    queryKey: ['contract-receipts', contractId],
    queryFn: async () =>
      (await api.get(`/receipts/contract/${contractId}`, { params: { includeVoided: true } })).data,
    enabled: !!contractId,
  });
  const isLoading = loadingPayments || loadingReceipts;

  const payments = pResp?.data ?? [];
  const contract = pResp?.contract;
  const paymentById = useMemo(() => new Map(payments.map((p) => [p.id, p])), [payments]);

  // ─── Summary cards ───
  // paid installments are payment-based; the money totals are collected-only
  // (exclude voided): cumulative = Σ non-voided receipt amounts; late-fee/waiver
  // counted on PAID installments only (not unpaid-overdue accruals).
  const paidCount = payments.filter((p) => p.status === 'PAID').length;
  const cumulativePaid = receipts.filter((r) => !r.isVoided).reduce((s, r) => s + Number(r.amount), 0);
  const paidPayments = payments.filter((p) => p.status === 'PAID');
  const totalLateFee = paidPayments.reduce((s, p) => s + Number(p.lateFee), 0);
  const totalWaived = paidPayments.reduce(
    (s, p) => s + (p.waivedAmount != null ? Number(p.waivedAmount) : p.lateFeeWaived ? Number(p.lateFee) : 0),
    0,
  );

  // One row per receipt (incl. voided), oldest installment first.
  const rows = useMemo(
    () =>
      [...receipts].sort(
        (a, b) =>
          (a.installmentNo ?? 0) - (b.installmentNo ?? 0) ||
          new Date(a.paidDate).getTime() - new Date(b.paidDate).getTime(),
      ),
    [receipts],
  );

  return (
    <>
      <Dialog open={!!contractId} onOpenChange={(open) => !open && onClose()}>
        <DialogContent className="sm:max-w-6xl max-h-[92vh] flex flex-col p-0 gap-0">
          <DialogHeader className="px-5 py-4 border-b border-border mb-0 text-start">
            <DialogTitle className="leading-snug">
              ประวัติการชำระ {contract ? <span className="text-primary font-mono">— {contract.contractNumber}</span> : ''}
            </DialogTitle>
            {contract && (
              <div className="text-xs text-muted-foreground leading-snug mt-0.5">
                {contract.customerName ?? '-'}
                {contract.productName ? ` · ${contract.productName}` : ''}
              </div>
            )}
          </DialogHeader>

          <DialogBody className="flex-1 overflow-auto px-5 py-4 space-y-4">
            {isLoading ? (
              <div className="flex items-center justify-center py-12">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
              </div>
            ) : isError ? (
              <div className="text-center py-10 text-sm text-destructive leading-snug">
                โหลดประวัติการชำระไม่สำเร็จ — กรุณาลองใหม่อีกครั้ง
              </div>
            ) : (
              <>
                {/* ─── 4 summary cards ─── */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <SummaryCard label="งวดที่ชำระแล้ว" value={`${paidCount} / ${contract?.totalMonths ?? '-'}`} tone="success" />
                  <SummaryCard label="ยอดชำระสะสม" value={`${money(cumulativePaid)} ฿`} />
                  <SummaryCard
                    label="ค่าปรับ / อนุโลม"
                    value={`${money(totalLateFee)} / −${money(totalWaived)} ฿`}
                    tone="warning"
                  />
                  <SummaryCard label="เครดิต (21-1103)" value={`${money(contract?.advanceBalance ?? 0)} ฿`} tone="info" />
                </div>

                {/* ─── Receipt-level table ─── */}
                {rows.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground text-sm leading-snug">ไม่พบใบเสร็จ</div>
                ) : (
                  <div className="overflow-x-auto rounded-lg border border-border">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/40 text-xs text-muted-foreground">
                        <tr className="text-left">
                          <Th>เลขที่ใบเสร็จ</Th>
                          <Th>วันที่</Th>
                          <Th>งวด</Th>
                          <Th className="text-right">ยอดต้องชำระ</Th>
                          <Th className="text-right">ยอดรับจริง</Th>
                          <Th>ค่าปรับ/อนุโลม</Th>
                          <Th>CASE</Th>
                          <Th>ช่องทาง</Th>
                          <Th>สถานะ</Th>
                          <Th>ผู้บันทึก</Th>
                          <Th>ผู้อนุมัติ</Th>
                          <Th />
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((r) => {
                          const p = r.paymentId ? paymentById.get(r.paymentId) : undefined;
                          const c = caseFor(r, p);
                          const lateFee = p ? Number(p.lateFee) : 0;
                          const waived = p
                            ? p.waivedAmount != null
                              ? Number(p.waivedAmount)
                              : p.lateFeeWaived
                              ? Number(p.lateFee)
                              : 0
                            : 0;
                          const recorder = p?.recordedBy?.name ?? r.issuedByName ?? '–';
                          return (
                            <tr
                              key={r.id}
                              className={`border-t border-border ${r.isVoided ? 'opacity-50 line-through' : ''}`}
                            >
                              <Td className="font-mono text-xs">{r.receiptNumber}</Td>
                              <Td>{formatDateShort(r.paidDate)}</Td>
                              <Td>{r.installmentNo ?? '–'}{contract ? `/${contract.totalMonths}` : ''}</Td>
                              <Td className="text-right">{p ? `${money(p.amountDue)}` : '–'}</Td>
                              <Td className="text-right">{money(r.amount)}</Td>
                              <Td>
                                {lateFee > 0 ? (
                                  <div className="text-xs leading-snug">
                                    <div className="text-warning">{money(lateFee)}฿</div>
                                    {waived > 0 && <div className="text-success">−อนุโลม {money(waived)}฿</div>}
                                    <div className="text-foreground font-medium">สุทธิ {money(lateFee - waived)}฿</div>
                                    {p?.waivedReason && (
                                      <div className="text-muted-foreground">{p.waivedReason}</div>
                                    )}
                                  </div>
                                ) : (
                                  <span className="text-muted-foreground">0</span>
                                )}
                              </Td>
                              <Td><span className={`font-semibold ${c.cls}`}>{c.label}</span></Td>
                              <Td className="font-mono text-xs">{p?.depositAccountCode ?? '–'}</Td>
                              <Td>
                                {r.isVoided ? (
                                  <span className="px-2 py-0.5 rounded-full text-xs bg-muted text-muted-foreground">VOIDED</span>
                                ) : (
                                  <span className="px-2 py-0.5 rounded-full text-xs bg-success/10 text-success">● PAID</span>
                                )}
                              </Td>
                              <Td>{recorder}</Td>
                              <Td className={p?.waivedApprovedByName ? 'text-primary' : 'text-muted-foreground'}>
                                {p?.waivedApprovedByName ?? '–'}
                              </Td>
                              <Td>
                                {!r.isVoided && (
                                  <div className="flex items-center gap-1">
                                    <button
                                      onClick={() => downloadReceiptPdf(r.id, r.receiptNumber)}
                                      title="ใบเสร็จ (PDF)"
                                      aria-label={`ดาวน์โหลดใบเสร็จ ${r.receiptNumber}`}
                                      className="p-1.5 rounded border border-border text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                                    >
                                      <FileText className="size-3.5" />
                                    </button>
                                    {canVoid && (
                                      <button
                                        onClick={() => setVoidTarget({ id: r.id, receiptNumber: r.receiptNumber })}
                                        title="ยกเลิกใบเสร็จ (ออกใบลดหนี้)"
                                        aria-label={`ยกเลิกใบเสร็จ ${r.receiptNumber}`}
                                        className="p-1.5 rounded border border-destructive/40 text-destructive hover:bg-destructive/10 transition-colors"
                                      >
                                        <X className="size-3.5" />
                                      </button>
                                    )}
                                  </div>
                                )}
                              </Td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}
          </DialogBody>
        </DialogContent>
      </Dialog>

      <ReceiptVoidDialog
        receiptId={voidTarget?.id ?? null}
        receiptNumber={voidTarget?.receiptNumber}
        onClose={() => setVoidTarget(null)}
      />
    </>
  );
}

/* ─── Helpers ───────────────────────────────────────── */
function SummaryCard({ label, value, tone = 'default' }: { label: string; value: string; tone?: 'default' | 'success' | 'warning' | 'info' }) {
  const valueCls =
    tone === 'success' ? 'text-success' : tone === 'warning' ? 'text-warning' : tone === 'info' ? 'text-info' : 'text-foreground';
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="text-xs text-muted-foreground leading-snug">{label}</div>
      <div className={`text-lg font-bold leading-snug mt-0.5 ${valueCls}`}>{value}</div>
    </div>
  );
}
function Th({ children, className = '' }: { children?: React.ReactNode; className?: string }) {
  return <th className={`px-3 py-2 font-medium whitespace-nowrap leading-snug ${className}`}>{children}</th>;
}
function Td({ children, className = '' }: { children?: React.ReactNode; className?: string }) {
  return <td className={`px-3 py-2 align-top whitespace-nowrap leading-snug ${className}`}>{children}</td>;
}
