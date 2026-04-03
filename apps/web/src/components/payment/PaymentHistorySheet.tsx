import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api, { getErrorMessage } from '@/lib/api';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetBody } from '@/components/ui/sheet';
import Modal from '@/components/ui/Modal';
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
  isVoided: boolean;
  paidDate: string;
}

const statusLabels: Record<string, { label: string; className: string }> = {
  PENDING: { label: 'รอชำระ', className: 'bg-muted text-foreground' },
  PAID: { label: 'ชำระแล้ว', className: 'bg-success/10 text-success dark:bg-success/15' },
  OVERDUE: { label: 'เกินกำหนด', className: 'bg-destructive/10 text-destructive dark:bg-destructive/15' },
  PARTIALLY_PAID: { label: 'ชำระบางส่วน', className: 'bg-warning/10 text-warning dark:bg-warning/15' },
};

interface PaymentHistorySheetProps {
  contractId: string | null;
  onClose: () => void;
  onViewReceipt: (receiptId: string) => void;
}

export default function PaymentHistorySheet({ contractId, onClose, onViewReceipt }: PaymentHistorySheetProps) {
  const queryClient = useQueryClient();
  const [showWaiveModal, setShowWaiveModal] = useState(false);
  const [waiveTarget, setWaiveTarget] = useState<PaymentItem | null>(null);
  const [waiveReason, setWaiveReason] = useState('');

  const { data: payments = [], isLoading: loadingPayments } = useQuery<PaymentItem[]>({
    queryKey: ['contract-payments', contractId],
    queryFn: async () => {
      const { data } = await api.get(`/payments/contract/${contractId}`);
      return data;
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
    onError: (err: any) => toast.error(getErrorMessage(err)),
  });

  // Find receipt for a given installment
  const findReceipt = (installmentNo: number) =>
    receipts.find(r => r.installmentNo === installmentNo && r.receiptType === 'PAYMENT' && !r.isVoided);

  const totalPaid = payments.reduce((s, p) => s + Number(p.amountPaid), 0);
  const totalDue = payments.reduce((s, p) => s + Number(p.amountDue) + Number(p.lateFee), 0);
  const totalRemaining = totalDue - totalPaid;

  return (
    <>
      <Sheet open={!!contractId} onOpenChange={(open) => !open && onClose()}>
        <SheetContent side="right" className="w-full sm:max-w-lg overflow-y-auto">
          <SheetHeader>
            <SheetTitle>ประวัติการชำระ</SheetTitle>
          </SheetHeader>
          <SheetBody>
            {loadingPayments ? (
              <div className="flex items-center justify-center py-12">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
              </div>
            ) : payments.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground text-sm">ไม่พบข้อมูล</div>
            ) : (
              <div className="space-y-2">
                {payments.map((p) => {
                  const remaining = Number(p.amountDue) + Number(p.lateFee) - Number(p.amountPaid);
                  const isOverdue = new Date(p.dueDate) < new Date() && p.status !== 'PAID';
                  const receipt = findReceipt(p.installmentNo);
                  const s = statusLabels[p.status] || { label: p.status, className: 'bg-muted' };

                  return (
                    <div key={p.id} className="border rounded-lg p-3 space-y-2">
                      {/* Row header */}
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-bold">งวด {p.installmentNo}</span>
                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${s.className}`}>{s.label}</span>
                        </div>
                        <span className={`text-xs ${isOverdue ? 'text-red-600 font-medium' : 'text-muted-foreground'}`}>
                          {new Date(p.dueDate).toLocaleDateString('th-TH')}
                        </span>
                      </div>

                      {/* Amounts */}
                      <div className="grid grid-cols-3 gap-2 text-xs">
                        <div>
                          <div className="text-muted-foreground">ยอดที่ต้องจ่าย</div>
                          <div className="font-medium">{Number(p.amountDue).toLocaleString()} ฿</div>
                        </div>
                        <div>
                          <div className="text-muted-foreground">จ่ายแล้ว</div>
                          <div className={`font-medium ${Number(p.amountPaid) > 0 ? 'text-green-600' : ''}`}>
                            {Number(p.amountPaid).toLocaleString()} ฿
                          </div>
                        </div>
                        <div>
                          <div className="text-muted-foreground">ค่าปรับ</div>
                          <div className={`font-medium ${Number(p.lateFee) > 0 ? 'text-red-600' : ''}`}>
                            {Number(p.lateFee) > 0 ? `${Number(p.lateFee).toLocaleString()} ฿` : '-'}
                            {p.lateFeeWaived && <span className="text-green-600 ml-1">(ยกเว้น)</span>}
                          </div>
                        </div>
                      </div>

                      {/* Paid info */}
                      {p.paidDate && (
                        <div className="text-xs text-muted-foreground">
                          ชำระเมื่อ {new Date(p.paidDate).toLocaleDateString('th-TH')} {p.recordedBy ? `โดย ${p.recordedBy.name}` : ''}
                        </div>
                      )}

                      {/* Actions */}
                      <div className="flex gap-2 pt-1">
                        {receipt && (
                          <button
                            onClick={() => onViewReceipt(receipt.id)}
                            className="px-2 py-1 text-xs bg-primary text-primary-foreground rounded hover:bg-primary/90"
                          >
                            ใบเสร็จ
                          </button>
                        )}
                        {Number(p.lateFee) > 0 && !p.lateFeeWaived && p.status !== 'PAID' && (
                          <button
                            onClick={() => { setWaiveTarget(p); setWaiveReason(''); setShowWaiveModal(true); }}
                            className="px-2 py-1 text-xs border border-yellow-400 text-yellow-700 rounded hover:bg-yellow-50"
                          >
                            ยกเว้นค่าปรับ
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}

                {/* Summary */}
                <div className="border-t pt-3 mt-3 space-y-1">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">ชำระแล้วรวม</span>
                    <span className="font-bold text-green-600">{totalPaid.toLocaleString()} ฿</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">ยอดคงค้าง</span>
                    <span className="font-bold text-red-600">{Math.max(0, totalRemaining).toLocaleString()} ฿</span>
                  </div>
                </div>
              </div>
            )}
          </SheetBody>
        </SheetContent>
      </Sheet>

      {/* Waive Late Fee Modal */}
      {showWaiveModal && waiveTarget && (
        <Modal isOpen title="ยกเว้นค่าปรับ" onClose={() => { setShowWaiveModal(false); setWaiveTarget(null); }}>
          <div className="flex flex-col gap-4">
            <div className="bg-warning/5 dark:bg-warning/10 border border-warning/20 rounded-lg p-3">
              <div className="text-sm"><span className="text-muted-foreground">งวดที่: </span><span className="font-bold">{waiveTarget.installmentNo}</span></div>
              <div className="text-sm"><span className="text-muted-foreground">ค่าปรับปัจจุบัน: </span><span className="font-bold text-red-600">{Number(waiveTarget.lateFee).toLocaleString()} ฿</span></div>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">เหตุผลที่ยกเว้น <span className="text-red-500">*</span></label>
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
                className="flex-1 px-4 py-2 text-sm bg-yellow-500 text-white rounded-lg hover:bg-yellow-600 disabled:opacity-50"
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
