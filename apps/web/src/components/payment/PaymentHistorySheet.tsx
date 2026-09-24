import DocumentDownloadButton from '@/components/DocumentDownloadButton';
import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BookOpen, FileText, Lock, X } from 'lucide-react';
import api from '@/lib/api';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogBody,
} from '@/components/ui/dialog';
import { formatDateShort, formatNumberDecimal } from '@/utils/formatters';
import { useAuth } from '@/contexts/AuthContext';
import ReceiptVoidDialog from '@/components/payment/ReceiptVoidDialog';
import { JeBlock, type ContractJe } from './JeBlock';
import { computeReceiptFeeDisplay, type FeeInfo } from './computeReceiptFeeDisplay';
import {
  computeCumulativePaid,
  computeFeeTotals,
  jesForReceipt as selectJesForReceipt,
  paidRowsWithoutReceipt,
  receiptLabelsForJes,
  caseForReceipt,
  type CaseTone,
  type ReceiptInstallmentAllocation,
} from './paymentHistoryDerivations';
import type { VoidedReceiptInfo } from '@/pages/PaymentsPage/types';

/* ─── Types ───────────────────────────────────────── */
interface PaymentItem {
  id: string;
  installmentNo: number;
  dueDate: string;
  amountDue: string;
  amountPaid: string;
  paidDate: string | null;
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
  /** พักงวดสุดท้าย — ค่าธรรมเนียมปรับดิว (6a/6b) parked for the LAST installment only. */
  rescheduleAdvanceBalance: string;
  status?: string;
  /** เหตุการณ์ปิดสัญญา (API resolveClosure) — null/undefined = สัญญายังเดินอยู่ */
  closure?: ContractClosure | null;
}
/** คืนเครื่อง/ยึดคืน (JP5) ไม่ออกใบเสร็จ ⇒ หน้าประวัติที่เรียงจากใบเสร็จต้องได้แถวนี้จาก API (เจ้าของ 2026-09-24) */
interface ContractClosure {
  kind: 'DEVICE_RETURN' | 'EARLY_PAYOFF' | 'COMPLETED' | 'CANCELED';
  at: string;
  amount: string | null;
  appraisalPrice: string | null;
  docNumber: string | null;
  receiptNumber: string | null;
  entryNumber: string | null;
  byName: string | null;
}
const CLOSURE_LABEL: Record<ContractClosure['kind'], string> = {
  DEVICE_RETURN: 'คืนเครื่อง / ยึดคืน',
  EARLY_PAYOFF: 'ปิดยอดก่อนกำหนด',
  COMPLETED: 'ผ่อนครบ',
  CANCELED: 'ยกเลิกสัญญา',
};
/** JE ที่ปิดสัญญา: JP5 (flow repossession) / JP4 (flow early-payoff) — ชุดเดียวกับที่ API คัดมาให้หน้านี้ */
const CLOSURE_JE_FLOWS = new Set(['repossession', 'early-payoff']);
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
  lateFeeCollected?: string | null;
  lateFeeWaivedThisReceipt?: string | null;
  hasReceiptFeeHistory?: boolean;
  paymentCase?: string | null;
  installmentAllocations?: ReceiptInstallmentAllocation[] | null;
}
/** แถวในตาราง = ใบเสร็จจริง หรืองวด PAID ที่ไม่มีใบเสร็จ (`noReceipt`) — ดู paidRowsWithoutReceipt */
type HistoryRow = ReceiptItem & { noReceipt?: boolean };

const VOID_REQUEST_ROLES = ['OWNER', 'ACCOUNTANT', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'SALES'];
// Receipt types the backend refuses to void (ReceiptVoidService guards,
// 2026-07-08): CN is itself the reversal document; reschedule fees and
// early payoff have no automatic un-do path. Hide the void button so the
// UI doesn't offer an action that can only error.
const UNVOIDABLE_RECEIPT_TYPES = ['CREDIT_NOTE', 'RESCHEDULE_FEE', 'EARLY_PAYOFF'];
// Use the shared money formatter (honours user separator preference + ROUND_HALF_UP).
const money = (n: number | string) => formatNumberDecimal(n, 2);

/** Semantic tone → token class for the CASE column. */
const CASE_TONE_CLASS: Record<CaseTone, string> = {
  warning: 'text-warning-strong',
  info: 'text-info',
  primary: 'text-primary',
  success: 'text-success',
};

/** Derived CASE label + token color (no persisted `case` field). */
function caseFor(r: ReceiptItem, p: PaymentItem | undefined): { label: string; cls: string } {
  const { label, tone } = caseForReceipt(r, p);
  return { label, cls: CASE_TONE_CLASS[tone] };
}


interface Props {
  contractId: string | null;
  onClose: () => void;
  /** Mockup §11.1 — called after a successful void so the parent (PaymentsPage)
   *  can re-open the record wizard on the now-unpaid installment. Optional:
   *  ContractDetailPage renders this sheet without it. */
  onVoided?: (info: VoidedReceiptInfo) => void;
}

export default function PaymentHistorySheet({ contractId, onClose, onVoided }: Props) {
  const { user } = useAuth();
  const canRequestVoid = VOID_REQUEST_ROLES.includes(user?.role ?? '');
  const [voidTarget, setVoidTarget] = useState<{
    id: string;
    receiptNumber: string;
    info: VoidedReceiptInfo;
  } | null>(null);

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
    queryFn: async () => (await api.get(`/payments/contract/${contractId}/journal-entries`)).data,
    enabled: !!contractId,
  });
  const isLoading = loadingPayments || loadingReceipts;

  // Receipt whose JEs are shown in the บันทึกบัญชี dialog (one page, no
  // scrolling — replaces the old inline row expansion that pushed content
  // below the fold). Component stays mounted between opens — clear when
  // switching contracts.
  const [jeTarget, setJeTarget] = useState<ReceiptItem | null>(null);
  // แถว "ปิดสัญญาแล้ว" เปิดกล่อง JE เดียวกัน แต่เลือก JE ด้วย flow (ไม่มีใบเสร็จให้จับคู่)
  const [closureJeOpen, setClosureJeOpen] = useState(false);
  useEffect(() => {
    setJeTarget(null);
    setClosureJeOpen(false);
  }, [contractId]);

  // Receipt → posted-JE selection (early-payoff by flow, CN → reversal mirrors,
  // else by shared paymentId). Extracted to paymentHistoryDerivations for unit test.
  const jesForReceipt = (r: ReceiptItem): ContractJe[] => selectJesForReceipt(r, journalEntries);
  const closureJes = useMemo(
    () => journalEntries.filter((j) => !!j.flow && CLOSURE_JE_FLOWS.has(j.flow)),
    [journalEntries],
  );
  const jeTargetJes = jeTarget ? jesForReceipt(jeTarget) : closureJeOpen ? closureJes : [];
  // ป้าย "JE ใบนี้เป็นของใบเสร็จใบไหน" — เฉพาะงวดแบ่งชำระ (>1 ใบ) ที่จับคู่ได้ครบ
  const jeReceiptLabels = useMemo(
    () => receiptLabelsForJes(journalEntries, receipts, jeTarget?.paymentId ?? null),
    [journalEntries, receipts, jeTarget?.paymentId],
  );

  const payments = pResp?.data ?? [];
  const contract = pResp?.contract;
  const closure = contract?.closure ?? null;
  const paymentById = useMemo(() => new Map(payments.map((p) => [p.id, p])), [payments]);

  // Per-receipt fee fields come from the linked JE. Cumulative installment fees
  // are only a fallback for entirely legacy histories without receipt attribution.
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
  // payment in the total). Fees use the same receipt history as the table,
  // including fees already collected before a reschedule resets Payment.lateFee.
  const paidCount = payments.filter((p) => p.status === 'PAID').length;

  // One row per receipt (incl. voided) + one row per PAID installment that has
  // no receipt at all (ยกยอดมา/seed — เจ้าของ 2026-09-24 "ประวัติชำระอื่นๆ หายไป"),
  // oldest installment first.
  const rows = useMemo<HistoryRow[]>(
    () =>
      [...receipts, ...paidRowsWithoutReceipt(payments, receipts)].sort(
        (a, b) =>
          (a.installmentNo ?? 0) - (b.installmentNo ?? 0) ||
          new Date(a.paidDate).getTime() - new Date(b.paidDate).getTime(),
      ),
    [receipts, payments],
  );
  // ยอดสะสมนับแถวไม่มีใบเสร็จด้วย (เงินที่บันทึกว่ารับแล้ว) — ไม่งั้นการ์ด "งวดที่ชำระแล้ว 5/6"
  // จะขัดกับยอดสะสมที่เห็นแค่ใบเสร็จใบเดียว
  const cumulativePaid = computeCumulativePaid(rows);
  const { totalLateFee, totalWaived } = computeFeeTotals(receiptFees.values());

  return (
    <>
      <Dialog open={!!contractId} onOpenChange={(open) => !open && onClose()}>
        {/* Fullscreen (inset-5) so all 12 table columns fit without a horizontal
            scrollbar — owner request 2026-07-08. */}
        <DialogContent variant="fullscreen" className="p-0 gap-0">
          <DialogHeader className="px-5 py-4 border-b border-border mb-0 text-start">
            <DialogTitle className="leading-snug">
              ประวัติการชำระ{' '}
              {contract ? (
                <span className="text-primary font-mono">— {contract.contractNumber}</span>
              ) : (
                ''
              )}
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
                  <SummaryCard
                    label="งวดที่ชำระแล้ว"
                    value={`${paidCount} / ${contract?.totalMonths ?? '-'}`}
                    tone="success"
                  />
                  <SummaryCard label="ยอดชำระสะสม" value={`${money(cumulativePaid)} ฿`} />
                  <SummaryCard
                    label="ค่าปรับ / อนุโลม"
                    value={`${money(totalLateFee)} / ${totalWaived > 0 ? `−${money(totalWaived)}` : '0.00'} ฿`}
                    tone="warning"
                  />
                  <SummaryCard
                    label="เครดิต (21-1103)"
                    value={`${money(contract?.advanceBalance ?? 0)} ฿`}
                    tone="info"
                  />
                  {Number(contract?.rescheduleAdvanceBalance ?? 0) > 0 && (
                    <SummaryCard
                      label="พักงวดสุดท้าย"
                      value={`${money(contract?.rescheduleAdvanceBalance ?? 0)} ฿`}
                      tone="warning"
                    />
                  )}
                </div>

                {/* ─── แถวปิดสัญญา (เจ้าของ 2026-09-24) — คืนเครื่อง/ยึดคืน ไม่มีใบเสร็จ จึงต้องมีแถวนี้ ─── */}
                {closure && (
                  <div
                    role="status"
                    data-testid="contract-closure"
                    className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-primary/30 bg-primary/5 px-4 py-3"
                  >
                    <div className="flex items-start gap-3 min-w-0">
                      <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                        <Lock className="size-4" aria-hidden="true" />
                      </span>
                      <div className="min-w-0 leading-snug">
                        <div className="text-sm font-semibold text-foreground">
                          ปิดสัญญาแล้ว — {CLOSURE_LABEL[closure.kind]}
                          <span className="ml-2 font-normal text-muted-foreground">
                            {formatDateShort(closure.at)}
                          </span>
                        </div>
                        <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                          {closure.amount != null && (
                            <span>
                              {closure.kind === 'DEVICE_RETURN' ? 'ยอดปิดสัญญา' : 'ยอดปิด'}{' '}
                              <span className="font-medium text-foreground tabular-nums">
                                {money(closure.amount)} ฿
                              </span>
                            </span>
                          )}
                          {closure.appraisalPrice != null && (
                            <span>
                              ราคาประเมิน{' '}
                              <span className="font-medium text-foreground tabular-nums">
                                {money(closure.appraisalPrice)} ฿
                              </span>
                            </span>
                          )}
                          {closure.docNumber && (
                            <span>
                              ใบรับเครื่องคืน <span className="font-mono">{closure.docNumber}</span>
                            </span>
                          )}
                          {closure.receiptNumber && (
                            <span>
                              ใบเสร็จ <span className="font-mono">{closure.receiptNumber}</span>
                            </span>
                          )}
                          {closure.byName && <span>โดย {closure.byName}</span>}
                        </div>
                      </div>
                    </div>
                    {closure.entryNumber && (
                      <button
                        type="button"
                        onClick={() => setClosureJeOpen(true)}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-input px-3 py-1.5 text-xs font-medium text-foreground hover:bg-accent"
                        aria-label={`ดูบันทึกบัญชีของการปิดสัญญา ${closure.entryNumber}`}
                      >
                        <FileText className="size-3.5" aria-hidden="true" />
                        บันทึกบัญชี <span className="font-mono">{closure.entryNumber}</span>
                      </button>
                    )}
                  </div>
                )}

                {/* ─── Receipt-level table ─── */}
                {rows.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground text-sm leading-snug">
                    ไม่พบใบเสร็จ
                  </div>
                ) : (
                  <div className="overflow-x-auto rounded-lg border border-border">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/40 text-xs text-muted-foreground">
                        <tr className="text-left">
                          <Th>เลขที่ใบเสร็จ</Th>
                          <Th>ดิวชำระ</Th>
                          <Th>วันที่ชำระ</Th>
                          <Th>งวด / การจัดสรรเงิน</Th>
                          <Th className="text-right">ยอดต้องชำระ</Th>
                          <Th className="text-right">ยอดรับจริง</Th>
                          <Th>ค่าปรับ/อนุโลม</Th>
                          <Th>ลักษณะการชำระ</Th>
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
                          const { lateFee, waived, unavailable }: FeeInfo =
                            receiptFees.get(r.id) ??
                            (r.noReceipt && r.paymentId ? feeByPaymentId.get(r.paymentId) : undefined) ?? {
                              lateFee: 0,
                              waived: 0,
                            };
                          const recorder = p?.recordedBy?.name ?? r.issuedByName ?? '–';
                          return (
                            <tr
                              key={r.id}
                              className={`border-t border-border ${r.isVoided ? 'opacity-50 line-through' : ''}`}
                            >
                              <Td className="font-mono text-xs">
                                {r.noReceipt ? (
                                  <span
                                    className="font-sans text-muted-foreground"
                                    title="งวดนี้ถูกบันทึกเป็นชำระแล้วโดยไม่มีใบเสร็จในระบบ (ยกยอดมาจากระบบเก่า / ข้อมูลทดสอบ)"
                                  >
                                    ไม่มีใบเสร็จ
                                  </span>
                                ) : (
                                  r.receiptNumber
                                )}
                              </Td>
                              {/* ดิวชำระ = dueDate ของงวด — ใบเสร็จที่ไม่ผูกงวด (ดาวน์/ปิดยอด/CN) ไม่มีดิว */}
                              <Td>{p ? formatDateShort(p.dueDate) : '–'}</Td>
                              <Td>{formatDateShort(r.paidDate)}</Td>
                              <Td>
                                {r.installmentAllocations?.length ? (
                                  <div className="space-y-1.5">
                                    {r.installmentAllocations.map((allocation) => (
                                      <div key={`${allocation.kind}-${allocation.installmentNo}`}>
                                        <div className="flex items-baseline justify-between gap-4 tabular-nums">
                                          <span>
                                            {allocation.installmentNo}
                                            {contract ? `/${contract.totalMonths}` : ''}
                                          </span>
                                          <span>{money(allocation.amount)} ฿</span>
                                        </div>
                                        {allocation.kind === 'RESCHEDULE_ADVANCE' && (
                                          <div className="text-xs text-warning-strong">ล่วงหน้างวดสุดท้าย</div>
                                        )}
                                      </div>
                                    ))}
                                  </div>
                                ) : (
                                  <>
                                    {r.installmentNo ?? '–'}
                                    {contract ? `/${contract.totalMonths}` : ''}
                                  </>
                                )}
                              </Td>
                              <Td className="text-right">{p ? `${money(p.amountDue)}` : '–'}</Td>
                              <Td className="text-right">{money(r.amount)}</Td>
                              <Td>
                                {unavailable ? (
                                  <span className="text-muted-foreground" title="ไม่พบข้อมูลค่าปรับแยกของใบเสร็จนี้">–</span>
                                ) : lateFee > 0 ? (
                                  <div className="text-xs leading-snug">
                                    <div className="text-warning-strong">{money(lateFee)}฿</div>
                                    {waived > 0 && (
                                      <div className="text-success">−อนุโลม {money(waived)}฿</div>
                                    )}
                                    <div className="text-foreground font-medium">
                                      สุทธิ {money(lateFee - waived)}฿
                                    </div>
                                    {waived > 0 && p?.waivedReason && (
                                      <div className="text-muted-foreground">{p.waivedReason}</div>
                                    )}
                                  </div>
                                ) : (
                                  <span className="text-muted-foreground">0</span>
                                )}
                              </Td>
                              <Td>
                                <span className={`font-semibold ${c.cls}`}>{c.label}</span>
                              </Td>
                              <Td className="font-mono text-xs">{p?.depositAccountCode ?? '–'}</Td>
                              <Td>
                                {r.isVoided ? (
                                  <span className="px-2 py-0.5 rounded-full text-xs bg-muted text-muted-foreground">
                                    VOIDED
                                  </span>
                                ) : (
                                  <span className="px-2 py-0.5 rounded-full text-xs bg-success/10 text-success">
                                    ● PAID
                                  </span>
                                )}
                              </Td>
                              <Td>{recorder}</Td>
                              <Td
                                className={
                                  p?.waivedApprovedByName ? 'text-primary' : 'text-muted-foreground'
                                }
                              >
                                {p?.waivedApprovedByName ?? '–'}
                              </Td>
                              <Td>
                                <div className="flex items-center gap-1">
                                  <button
                                    onClick={() => setJeTarget(r)}
                                    title="ดูบันทึกบัญชี (JE)"
                                    aria-label={
                                      r.noReceipt
                                        ? `ดูบันทึกบัญชีของงวด ${r.installmentNo}`
                                        : `ดูบันทึกบัญชีของใบเสร็จ ${r.receiptNumber}`
                                    }
                                    aria-haspopup="dialog"
                                    className="p-1.5 rounded border border-border text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                                  >
                                    <BookOpen className="size-3.5" />
                                  </button>
                                  {!r.isVoided && !r.noReceipt && (
                                    <>
                                      <DocumentDownloadButton path={`/receipts/${r.id}/pdf`} filename={`${r.receiptNumber}.pdf`}
                                        title="ใบเสร็จ (PDF)"
                                        aria-label={`ดาวน์โหลดใบเสร็จ ${r.receiptNumber}`}
                                        className="p-1.5 rounded border border-border text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                                      >
                                        <FileText className="size-3.5" />
                                      </DocumentDownloadButton>
                                      {canRequestVoid &&
                                        !UNVOIDABLE_RECEIPT_TYPES.includes(r.receiptType) && (
                                          <button
                                            onClick={() =>
                                              setVoidTarget({
                                                id: r.id,
                                                receiptNumber: r.receiptNumber,
                                                info: {
                                                  paymentId: r.paymentId,
                                                  contractNumber: contract?.contractNumber,
                                                },
                                              })
                                            }
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
      <Dialog
        open={!!jeTarget || closureJeOpen}
        onOpenChange={(open) => {
          if (!open) {
            setJeTarget(null);
            setClosureJeOpen(false);
          }
        }}
      >
        <DialogContent
          className={`${jeTargetJes.length > 1 ? 'sm:max-w-[min(96vw,90rem)]' : 'sm:max-w-2xl'} max-h-[94vh] flex flex-col p-0 gap-0`}
        >
          <DialogHeader className="px-5 py-4 border-b border-border mb-0 text-start">
            <DialogTitle className="leading-snug">
              บันทึกบัญชี (JE){' '}
              {jeTarget && (
                <span className="text-primary font-mono">— {jeTarget.receiptNumber}</span>
              )}
              {!jeTarget && closureJeOpen && closure && (
                <span className="text-primary">— ปิดสัญญา ({CLOSURE_LABEL[closure.kind]})</span>
              )}
            </DialogTitle>
            {jeTarget && (
              <div className="text-xs text-muted-foreground leading-snug mt-0.5">
                งวด {jeTarget.installmentNo ?? '–'}
                {contract ? `/${contract.totalMonths}` : ''} · {formatDateShort(jeTarget.paidDate)}{' '}
                · {money(jeTarget.amount)} ฿
              </div>
            )}
            {!jeTarget && closureJeOpen && closure && (
              <div className="text-xs text-muted-foreground leading-snug mt-0.5">
                {formatDateShort(closure.at)}
                {closure.amount != null ? ` · ยอดปิด ${money(closure.amount)} ฿` : ''}
              </div>
            )}
          </DialogHeader>
          <DialogBody className="flex-1 overflow-auto px-5 py-4">
            {loadingJes ? (
              <div className="text-sm text-muted-foreground leading-snug">
                กำลังโหลดบันทึกบัญชี...
              </div>
            ) : jeTargetJes.length === 0 ? (
              <div className="text-sm text-muted-foreground leading-snug text-center py-8">
                ไม่พบบันทึกบัญชี (JE) สำหรับรายการนี้
              </div>
            ) : (
              <div className={`grid gap-3 ${jeTargetJes.length > 1 ? 'lg:grid-cols-2' : ''}`}>
                {jeTargetJes.map((je) => (
                  <JeBlock
                    key={je.id}
                    je={je}
                    receiptLabel={jeReceiptLabels.get(je.id)}
                    openedReceiptNumber={jeTarget?.receiptNumber}
                  />
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
        onVoided={() => {
          if (voidTarget) onVoided?.(voidTarget.info);
        }}
      />
    </>
  );
}

function SummaryCard({
  label,
  value,
  tone = 'default',
}: {
  label: string;
  value: string;
  tone?: 'default' | 'success' | 'warning' | 'info';
}) {
  const valueCls =
    tone === 'success'
      ? 'text-success'
      : tone === 'warning'
        ? 'text-warning-strong'
        : tone === 'info'
          ? 'text-info'
          : 'text-foreground';
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="text-xs text-muted-foreground leading-snug">{label}</div>
      <div className={`text-lg font-bold leading-snug mt-0.5 ${valueCls}`}>{value}</div>
    </div>
  );
}
function Th({ children, className = '' }: { children?: React.ReactNode; className?: string }) {
  return (
    <th className={`px-3 py-2 font-medium whitespace-nowrap leading-snug ${className}`}>
      {children}
    </th>
  );
}
function Td({ children, className = '' }: { children?: React.ReactNode; className?: string }) {
  return (
    <td className={`px-3 py-2 align-top whitespace-nowrap leading-snug ${className}`}>
      {children}
    </td>
  );
}
