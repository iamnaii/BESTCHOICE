import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BookOpen, FileText, X } from 'lucide-react';
import api, { getErrorMessage } from '@/lib/api';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogBody } from '@/components/ui/dialog';
import { formatDateShort, formatNumberDecimal } from '@/utils/formatters';
import { useAuth } from '@/contexts/AuthContext';
import ReceiptVoidDialog from '@/components/payment/ReceiptVoidDialog';
import { computeReceiptFeeDisplay } from './computeReceiptFeeDisplay';
import {
  computeCumulativePaid,
  computeFeeTotals,
  jesForReceipt as selectJesForReceipt,
} from './paymentHistoryDerivations';
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
interface ContractJeLine {
  accountCode: string;
  accountName: string;
  debit: string;
  credit: string;
  description: string;
}
interface ContractJe {
  id: string;
  entryNumber: string;
  entryDate: string;
  postedAt: string | null;
  description: string;
  paymentId: string | null;
  tag: string | null;
  flow: string | null;
  deltaApplied: string | null;
  lateFeePortion: string | null;
  /** Original JE that has since been mirrored out by a receipt void. */
  reversed: boolean;
  reversedByEntryNumber: string | null;
  /** Set on receipt-void REVERSAL JEs — points at the original entry id. */
  originalEntryId: string | null;
  lines: ContractJeLine[];
  totalDebit: string;
  totalCredit: string;
  isBalanced: boolean;
}

const VOID_ROLES = ['OWNER', 'ACCOUNTANT', 'BRANCH_MANAGER', 'FINANCE_MANAGER'];
// Use the shared money formatter (honours user separator preference + ROUND_HALF_UP).
const money = (n: number | string) => formatNumberDecimal(n, 2);

/** Derived CASE label + token color (no persisted `case` field). */
function caseFor(r: ReceiptItem, p: PaymentItem | undefined): { label: string; cls: string } {
  if (r.receiptType === 'EARLY_PAYOFF') return { label: 'ปิดยอด', cls: 'text-warning' };
  if (r.receiptType === 'DOWN_PAYMENT') return { label: 'ดาวน์', cls: 'text-warning' };
  if (r.receiptType === 'CREDIT_NOTE') return { label: 'ใบลดหนี้', cls: 'text-warning' };
  if (r.receiptType === 'RESCHEDULE_FEE') return { label: 'ปรับดิว', cls: 'text-warning' };
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
  // Posted JEs behind each receipt row — soft-linked by metadata.paymentId
  // (EARLY_PAYOFF receipt has paymentId null → matched by flow instead).
  const { data: journalEntries = [], isLoading: loadingJes } = useQuery<ContractJe[]>({
    queryKey: ['contract-journal-entries', contractId],
    queryFn: async () =>
      (await api.get(`/payments/contract/${contractId}/journal-entries`)).data,
    enabled: !!contractId,
  });
  const isLoading = loadingPayments || loadingReceipts;

  // Receipt whose JEs are shown in the บันทึกบัญชี dialog (one page, no
  // scrolling — replaces the old inline row expansion that pushed content
  // below the fold). Component stays mounted between opens — clear when
  // switching contracts.
  const [jeTarget, setJeTarget] = useState<ReceiptItem | null>(null);
  useEffect(() => {
    setJeTarget(null);
  }, [contractId]);

  // Receipt → posted-JE selection (early-payoff by flow, CN → reversal mirrors,
  // else by shared paymentId). Extracted to paymentHistoryDerivations for unit test.
  const jesForReceipt = (r: ReceiptItem): ContractJe[] => selectJesForReceipt(r, journalEntries);
  const jeTargetJes = jeTarget ? jesForReceipt(jeTarget) : [];

  const payments = pResp?.data ?? [];
  const contract = pResp?.contract;
  const paymentById = useMemo(() => new Map(payments.map((p) => [p.id, p])), [payments]);

  // Per-receipt late fee/waiver for display: attribute an installment's fee to its
  // FIRST receipt only (owner UI convention) so split-payment receipts don't each
  // repeat the same 100฿. The ledger still books the fee once (principal-first);
  // this is purely how the history table reads. See computeReceiptFeeDisplay.
  const feeByPaymentId = useMemo(() => {
    const m = new Map<string, { lateFee: number; waived: number }>();
    for (const p of payments) {
      const lateFee = Number(p.lateFee) || 0;
      const waived =
        p.waivedAmount != null ? Number(p.waivedAmount) : p.lateFeeWaived ? lateFee : 0;
      m.set(p.id, { lateFee, waived });
    }
    return m;
  }, [payments]);
  const receiptFees = useMemo(
    () => computeReceiptFeeDisplay(receipts, feeByPaymentId),
    [receipts, feeByPaymentId],
  );

  // ─── Summary cards ───
  // paid installments are payment-based; the money totals are collected-only:
  // cumulative = Σ non-voided receipt amounts EXCLUDING credit notes (a CN row
  // carries the original's POSITIVE amount — counting it would keep a voided
  // payment in the total). Late-fee/waiver counted on installments where
  // collection has STARTED (PAID or amountPaid > 0) — amountPaid-based rather
  // than status so the fee doesn't vanish when the midnight cron flips a
  // PARTIALLY_PAID overdue row back to OVERDUE; pure accruals on untouched
  // overdue rows stay excluded. Matches the per-row fee shown in the table.
  const paidCount = payments.filter((p) => p.status === 'PAID').length;
  const cumulativePaid = computeCumulativePaid(receipts);
  const { totalLateFee, totalWaived } = computeFeeTotals(payments);

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
        {/* Fullscreen (inset-5) so all 12 table columns fit without a horizontal
            scrollbar — owner request 2026-07-08. */}
        <DialogContent variant="fullscreen" className="p-0 gap-0">
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
                    value={`${money(totalLateFee)} / ${totalWaived > 0 ? `−${money(totalWaived)}` : '0.00'} ฿`}
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
                          const { lateFee, waived } = receiptFees.get(r.id) ?? { lateFee: 0, waived: 0 };
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
                                <div className="flex items-center gap-1">
                                  <button
                                    onClick={() => setJeTarget(r)}
                                    title="ดูบันทึกบัญชี (JE)"
                                    aria-label={`ดูบันทึกบัญชีของใบเสร็จ ${r.receiptNumber}`}
                                    aria-haspopup="dialog"
                                    className="p-1.5 rounded border border-border text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                                  >
                                    <BookOpen className="size-3.5" />
                                  </button>
                                  {!r.isVoided && (
                                    <>
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
                                    </>
                                  )}
                                </div>
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

      {/* ─── บันทึกบัญชี (JE) — one-page dialog, no scrolling ───
          Stacks over the history dialog (same pattern as ReceiptVoidDialog).
          Width adapts: one JE stays compact, several JEs go side-by-side so
          everything is visible at once. */}
      <Dialog open={!!jeTarget} onOpenChange={(open) => !open && setJeTarget(null)}>
        <DialogContent
          className={`${jeTargetJes.length > 1 ? 'sm:max-w-[min(96vw,90rem)]' : 'sm:max-w-2xl'} max-h-[94vh] flex flex-col p-0 gap-0`}
        >
          <DialogHeader className="px-5 py-4 border-b border-border mb-0 text-start">
            <DialogTitle className="leading-snug">
              บันทึกบัญชี (JE){' '}
              {jeTarget && <span className="text-primary font-mono">— {jeTarget.receiptNumber}</span>}
            </DialogTitle>
            {jeTarget && (
              <div className="text-xs text-muted-foreground leading-snug mt-0.5">
                งวด {jeTarget.installmentNo ?? '–'}
                {contract ? `/${contract.totalMonths}` : ''} · {formatDateShort(jeTarget.paidDate)} ·{' '}
                {money(jeTarget.amount)} ฿
              </div>
            )}
          </DialogHeader>
          <DialogBody className="flex-1 overflow-auto px-5 py-4">
            {loadingJes ? (
              <div className="text-sm text-muted-foreground leading-snug">กำลังโหลดบันทึกบัญชี...</div>
            ) : jeTargetJes.length === 0 ? (
              <div className="text-sm text-muted-foreground leading-snug text-center py-8">
                ไม่พบบันทึกบัญชี (JE) สำหรับรายการนี้
              </div>
            ) : (
              <div className={`grid gap-3 ${jeTargetJes.length > 1 ? 'lg:grid-cols-2' : ''}`}>
                {jeTargetJes.map((je) => (
                  <JeBlock key={je.id} je={je} />
                ))}
              </div>
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
/** One posted JE rendered as a Dr/Cr grid — same layout as the JOURNAL AUTO
 * section in ContractEarlyPayoff (grid-cols-[80px_1fr_90px_90px]). */
function JeBlock({ je }: { je: ContractJe }) {
  const isVoidReversal = je.flow === 'receipt-void' || je.tag === 'REVERSAL';
  const flowLabel = isVoidReversal
    ? 'กลับรายการ (VOID)'
    : je.flow === 'early-payoff'
    ? 'JP4 — ปิดยอดก่อนกำหนด'
    : 'รับชำระ (2B)';
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2 text-xs leading-snug flex-wrap">
          <span className="font-mono font-semibold text-foreground">{je.entryNumber}</span>
          <span className="text-muted-foreground">{formatDateShort(je.postedAt ?? je.entryDate)}</span>
          <span
            className={`px-1.5 py-0.5 rounded-full font-medium ${
              isVoidReversal ? 'bg-destructive/10 text-destructive' : 'bg-primary/10 text-primary'
            }`}
          >
            {flowLabel}
          </span>
          {je.reversed && (
            <span className="px-1.5 py-0.5 rounded-full bg-warning/10 text-warning font-medium">
              ถูกกลับรายการ{je.reversedByEntryNumber ? ` โดย ${je.reversedByEntryNumber}` : ''}
            </span>
          )}
          {je.deltaApplied && (
            <span className="text-muted-foreground">รับจริง {money(je.deltaApplied)} ฿</span>
          )}
          {je.lateFeePortion && Number(je.lateFeePortion) > 0 && (
            <span className="text-warning">ค่าปรับ {money(je.lateFeePortion)} ฿</span>
          )}
        </div>
        <span
          className={`text-xs font-medium leading-snug ${je.isBalanced ? 'text-success' : 'text-destructive'}`}
        >
          {money(je.totalDebit)} = {money(je.totalCredit)} {je.isBalanced ? 'BALANCED' : 'UNBALANCED'}
        </span>
      </div>
      <div className="space-y-1">
        <div className="grid grid-cols-[80px_1fr_90px_90px] gap-1 text-xs text-muted-foreground font-medium pb-1 border-b border-border">
          <span>รหัส</span>
          <span>บัญชี</span>
          <span className="text-right">Dr</span>
          <span className="text-right">Cr</span>
        </div>
        {je.lines.map((line, idx) => (
          <div key={idx} className="grid grid-cols-[80px_1fr_90px_90px] gap-1 text-xs leading-snug">
            <span className="font-mono text-muted-foreground">{line.accountCode}</span>
            <div className="min-w-0">
              <span className="text-foreground truncate block">{line.accountName}</span>
              {line.description && (
                <span className="text-muted-foreground/70 text-[10px]">{line.description}</span>
              )}
            </div>
            <span className="text-right font-mono text-foreground">
              {parseFloat(line.debit) > 0 ? formatNumberDecimal(line.debit) : ''}
            </span>
            <span className="text-right font-mono text-foreground">
              {parseFloat(line.credit) > 0 ? formatNumberDecimal(line.credit) : ''}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

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
