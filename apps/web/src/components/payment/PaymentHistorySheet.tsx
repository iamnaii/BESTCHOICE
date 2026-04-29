import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ChevronDown } from 'lucide-react';
import api, { getErrorMessage } from '@/lib/api';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogBody } from '@/components/ui/dialog';
import Modal from '@/components/ui/Modal';
import { formatDateShort } from '@/utils/formatters';
import { toast } from 'sonner';

interface PaymentItem {
  id: string;
  installmentNo: number;
  dueDate: string;
  amountDue: string;
  amountPaid: string;
  lateFee: string;
  lateFeeWaived: boolean;
  status: string;
  paidDate: string | null;
  paymentMethod: string | null;
  notes: string | null;
  recordedBy: { name: string } | null;
}

interface ReceiptItem {
  id: string;
  receiptNumber: string;
  receiptType: string;
  amount: string;
  installmentNo: number | null;
  paymentId: string | null;
  paymentMethod: string | null;
  transactionRef: string | null;
  isVoided: boolean;
  paidDate: string;
}

const statusLabels: Record<string, { label: string; className: string }> = {
  PENDING: { label: 'รอชำระ', className: 'bg-muted text-foreground' },
  PAID: { label: 'ชำระแล้ว', className: 'bg-success/10 text-success dark:bg-success/15' },
  OVERDUE: { label: 'เกินกำหนด', className: 'bg-destructive/10 text-destructive dark:bg-destructive/15' },
  PARTIALLY_PAID: { label: 'ชำระบางส่วน', className: 'bg-warning/10 text-warning dark:bg-warning/15' },
};

const paymentMethodLabels: Record<string, string> = {
  CASH: 'เงินสด',
  TRANSFER: 'โอนเงิน',
  QR: 'QR PaySolutions',
  CREDIT_CARD: 'บัตรเครดิต',
};

interface PaymentHistorySheetProps {
  contractId: string | null;
  onClose: () => void;
}

async function downloadReceiptPdf(receiptId: string, receiptNumber: string) {
  try {
    const res = await api.get(`/receipts/${receiptId}/pdf`, { responseType: 'blob' });
    const blob = new Blob([res.data], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
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

export default function PaymentHistorySheet({ contractId, onClose }: PaymentHistorySheetProps) {
  const queryClient = useQueryClient();
  const [showWaiveModal, setShowWaiveModal] = useState(false);
  const [waiveTarget, setWaiveTarget] = useState<PaymentItem | null>(null);
  const [waiveReason, setWaiveReason] = useState('');
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const { data: payments = [], isLoading: loadingPayments } = useQuery<PaymentItem[]>({
    queryKey: ['contract-payments', contractId],
    queryFn: async () => {
      const { data } = await api.get(`/payments/contract/${contractId}`, { params: { limit: 200 } });
      return data.data;
    },
    enabled: !!contractId,
  });

  const { data: receipts = [] } = useQuery<ReceiptItem[]>({
    queryKey: ['contract-receipts', contractId],
    queryFn: async () => {
      const { data } = await api.get(`/receipts/contract/${contractId}`);
      return data;
    },
    enabled: !!contractId,
  });

  const waiveMutation = useMutation({
    mutationFn: async ({ paymentId, reason }: { paymentId: string; reason: string }) => {
      const { data } = await api.patch(`/payments/${paymentId}/waive-late-fee`, { reason });
      return data;
    },
    onSuccess: (data) => {
      toast.success(`ยกเว้นค่าปรับ ${data.originalLateFee?.toLocaleString() || ''} บาท สำเร็จ`);
      queryClient.invalidateQueries({ queryKey: ['contract-payments', contractId] });
      queryClient.invalidateQueries({ queryKey: ['pending-payments'] });
      setShowWaiveModal(false);
      setWaiveTarget(null);
      setWaiveReason('');
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });

  // Group receipts by paymentId (each receipt = one transaction within an installment)
  const receiptsByPaymentId = useMemo(() => {
    const map = new Map<string, ReceiptItem[]>();
    for (const r of receipts) {
      if (r.isVoided || !r.paymentId) continue;
      if (r.receiptType !== 'INSTALLMENT' && r.receiptType !== 'PAYMENT') continue;
      const list = map.get(r.paymentId) || [];
      list.push(r);
      map.set(r.paymentId, list);
    }
    // Sort each list oldest → newest (transaction order)
    for (const list of map.values()) {
      list.sort((a, b) => new Date(a.paidDate).getTime() - new Date(b.paidDate).getTime());
    }
    return map;
  }, [receipts]);

  const totalPaid = payments.reduce((s, p) => s + Number(p.amountPaid), 0);
  const totalDue = payments.reduce((s, p) => s + Number(p.amountDue) + Number(p.lateFee), 0);
  const totalRemaining = totalDue - totalPaid;

  const toggleExpand = (paymentId: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(paymentId)) next.delete(paymentId);
      else next.add(paymentId);
      return next;
    });
  };

  return (
    <>
      <Dialog open={!!contractId} onOpenChange={(open) => !open && onClose()}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] flex flex-col p-0 gap-0">
          <DialogHeader className="px-5 py-4 border-b border-border mb-0 text-start">
            <DialogTitle>ประวัติการชำระ</DialogTitle>
          </DialogHeader>

          <DialogBody className="flex-1 overflow-y-auto px-5 py-4 space-y-2">
            {loadingPayments ? (
              <div className="flex items-center justify-center py-12">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
              </div>
            ) : payments.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground text-sm">ไม่พบข้อมูล</div>
            ) : (
              payments.map((p) => {
                const txList = receiptsByPaymentId.get(p.id) || [];
                const txCount = txList.length;
                const isMulti = txCount > 1;
                const isExpanded = expandedIds.has(p.id);
                const remaining = Number(p.amountDue) + Number(p.lateFee) - Number(p.amountPaid);
                const isOverdue = new Date(p.dueDate) < new Date() && p.status !== 'PAID';
                const s = statusLabels[p.status] || { label: p.status, className: 'bg-muted' };

                return (
                  <div
                    key={p.id}
                    className="border border-border rounded-lg bg-card overflow-hidden"
                  >
                    <div
                      className={`p-3 space-y-2 ${isMulti ? 'cursor-pointer hover:bg-accent/50' : ''}`}
                      onClick={isMulti ? () => toggleExpand(p.id) : undefined}
                    >
                      {/* Row header */}
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-bold">งวด {p.installmentNo}</span>
                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${s.className}`}>
                            {s.label}
                          </span>
                          {isMulti && (
                            <span className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-info/10 text-info dark:bg-info/15">
                              {txCount} ครั้ง
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <span className={`text-xs ${isOverdue ? 'text-destructive font-medium' : 'text-muted-foreground'}`}>
                            {formatDateShort(p.dueDate)}
                          </span>
                          {isMulti && (
                            <ChevronDown
                              className={`h-4 w-4 text-muted-foreground transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                            />
                          )}
                        </div>
                      </div>

                      {/* Amounts */}
                      <div className="grid grid-cols-3 gap-2 text-xs">
                        <div>
                          <div className="text-muted-foreground">ยอดที่ต้องจ่าย</div>
                          <div className="font-medium">{Number(p.amountDue).toLocaleString()} ฿</div>
                        </div>
                        <div>
                          <div className="text-muted-foreground">จ่ายแล้ว</div>
                          <div className={`font-medium ${Number(p.amountPaid) > 0 ? 'text-success' : ''}`}>
                            {Number(p.amountPaid).toLocaleString()} ฿
                          </div>
                        </div>
                        <div>
                          <div className="text-muted-foreground">
                            {p.status === 'PARTIALLY_PAID' ? 'คงเหลือ' : 'ค่าปรับ'}
                          </div>
                          <div
                            className={`font-medium ${
                              p.status === 'PARTIALLY_PAID' && remaining > 0
                                ? 'text-warning'
                                : Number(p.lateFee) > 0
                                ? 'text-destructive'
                                : ''
                            }`}
                          >
                            {p.status === 'PARTIALLY_PAID' && remaining > 0
                              ? `${remaining.toLocaleString()} ฿`
                              : Number(p.lateFee) > 0
                              ? `${Number(p.lateFee).toLocaleString()} ฿`
                              : '-'}
                            {p.lateFeeWaived && <span className="text-success ml-1">(ยกเว้น)</span>}
                          </div>
                        </div>
                      </div>

                      {/* Single-tx info: paid date + actions inline */}
                      {!isMulti && p.paidDate && (
                        <div className="text-xs text-muted-foreground">
                          ชำระเมื่อ {formatDateShort(p.paidDate)} {p.recordedBy ? `โดย ${p.recordedBy.name}` : ''}
                        </div>
                      )}

                      {/* Single-tx actions */}
                      {!isMulti && (
                        <div className="flex flex-wrap gap-2 pt-1">
                          {txList[0] && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                downloadReceiptPdf(txList[0].id, txList[0].receiptNumber);
                              }}
                              className="px-2 py-1 text-xs bg-primary text-primary-foreground rounded hover:bg-primary/90"
                            >
                              ใบเสร็จ
                            </button>
                          )}
                          {Number(p.lateFee) > 0 && !p.lateFeeWaived && p.status !== 'PAID' && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setWaiveTarget(p);
                                setWaiveReason('');
                                setShowWaiveModal(true);
                              }}
                              className="px-2 py-1 text-xs border border-warning/40 text-warning rounded hover:bg-warning/10"
                            >
                              ยกเว้นค่าปรับ
                            </button>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Multi-tx expanded list */}
                    {isMulti && isExpanded && (
                      <div className="border-t border-border bg-background/50 p-3 space-y-2">
                        <div className="text-xs text-muted-foreground">รายการชำระทั้งหมด</div>
                        {txList.map((tx, idx) => (
                          <div
                            key={tx.id}
                            className="flex items-center gap-3 bg-card border border-border rounded p-2.5 text-xs"
                          >
                            <div className="w-6 h-6 rounded-full bg-info/15 text-info grid place-items-center text-xs font-semibold flex-shrink-0">
                              {idx + 1}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="font-medium">{formatDateShort(tx.paidDate)}</div>
                              <div className="text-[11px] text-muted-foreground truncate">
                                {paymentMethodLabels[tx.paymentMethod || ''] || tx.paymentMethod || '-'}
                                {tx.transactionRef ? ` · ref ${tx.transactionRef}` : ''}
                              </div>
                            </div>
                            <div className="text-success font-semibold whitespace-nowrap">
                              +{Number(tx.amount).toLocaleString()} ฿
                            </div>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                downloadReceiptPdf(tx.id, tx.receiptNumber);
                              }}
                              className="px-2 py-1 text-[11px] border border-border rounded text-muted-foreground hover:bg-accent hover:text-foreground whitespace-nowrap"
                            >
                              ใบเสร็จ
                            </button>
                          </div>
                        ))}
                        <div className="flex justify-between pt-2 border-t border-dashed border-border text-xs">
                          <span className="text-muted-foreground">รวมจ่ายแล้ว</span>
                          <span className="font-semibold text-warning">
                            {Number(p.amountPaid).toLocaleString()} ฿ / {Number(p.amountDue).toLocaleString()} ฿
                          </span>
                        </div>
                        {Number(p.lateFee) > 0 && !p.lateFeeWaived && p.status !== 'PAID' && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setWaiveTarget(p);
                              setWaiveReason('');
                              setShowWaiveModal(true);
                            }}
                            className="px-2 py-1 text-xs border border-warning/40 text-warning rounded hover:bg-warning/10"
                          >
                            ยกเว้นค่าปรับ {Number(p.lateFee).toLocaleString()} ฿
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </DialogBody>

          {/* Summary footer */}
          {!loadingPayments && payments.length > 0 && (
            <div className="border-t border-border bg-muted/30 px-5 py-3 space-y-1 flex-shrink-0">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">ชำระแล้วรวม</span>
                <span className="font-bold text-success">{totalPaid.toLocaleString()} ฿</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">ยอดคงค้าง</span>
                <span className="font-bold text-destructive">
                  {Math.max(0, totalRemaining).toLocaleString()} ฿
                </span>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Waive Late Fee Modal */}
      {showWaiveModal && waiveTarget && (
        <Modal isOpen title="ยกเว้นค่าปรับ" onClose={() => { setShowWaiveModal(false); setWaiveTarget(null); }}>
          <div className="flex flex-col gap-4">
            <div className="bg-warning/5 dark:bg-warning/10 border border-warning/20 rounded-lg p-3">
              <div className="text-sm"><span className="text-muted-foreground">งวดที่: </span><span className="font-bold">{waiveTarget.installmentNo}</span></div>
              <div className="text-sm"><span className="text-muted-foreground">ค่าปรับปัจจุบัน: </span><span className="font-bold text-destructive">{Number(waiveTarget.lateFee).toLocaleString()} ฿</span></div>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">เหตุผลที่ยกเว้น <span className="text-destructive">*</span></label>
              <input
                type="text"
                value={waiveReason}
                onChange={(e) => setWaiveReason(e.target.value)}
                placeholder="เช่น ลูกค้าชำระล่วงหน้าหลายงวด, ลูกค้าประจำ..."
                className="w-full px-3 py-2 border border-input rounded-lg text-sm"
              />
            </div>
            <div className="flex gap-3">
              <button onClick={() => { setShowWaiveModal(false); setWaiveTarget(null); }} className="flex-1 px-4 py-2 text-sm border border-input rounded-lg">
                ยกเลิก
              </button>
              <button
                onClick={() => waiveMutation.mutate({ paymentId: waiveTarget.id, reason: waiveReason })}
                disabled={!waiveReason.trim() || waiveMutation.isPending}
                className="flex-1 px-4 py-2 text-sm bg-warning text-warning-foreground rounded-lg hover:bg-warning/90 disabled:opacity-50"
              >
                {waiveMutation.isPending ? 'กำลังบันทึก...' : 'ยืนยันยกเว้น'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
