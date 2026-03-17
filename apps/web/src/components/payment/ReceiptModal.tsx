import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api, { getErrorMessage } from '@/lib/api';
import Modal from '@/components/ui/Modal';
import { toast } from 'sonner';

interface Receipt {
  id: string;
  receiptNumber: string;
  contractId: string;
  paymentId: string | null;
  receiptType: string;
  payerName: string;
  receiverName: string;
  amount: string;
  installmentNo: number | null;
  remainingBalance: string | null;
  remainingMonths: number | null;
  paymentMethod: string | null;
  transactionRef: string | null;
  paidDate: string;
  isVoided: boolean;
  voidReason: string | null;
  voidedReceiptId: string | null;
  createdAt: string;
}

const methodLabels: Record<string, string> = {
  CASH: 'เงินสด',
  BANK_TRANSFER: 'โอนเงิน',
  QR_EWALLET: 'QR/E-Wallet',
};

const typeLabels: Record<string, string> = {
  PAYMENT: 'ใบเสร็จรับเงิน',
  DOWN_PAYMENT: 'ใบเสร็จเงินดาวน์',
  EARLY_PAYOFF: 'ใบเสร็จปิดยอด',
  CREDIT_NOTE: 'ใบลดหนี้',
};

interface ReceiptModalProps {
  receiptId: string | null;
  onClose: () => void;
}

export default function ReceiptModal({ receiptId, onClose }: ReceiptModalProps) {
  const queryClient = useQueryClient();
  const [showVoidConfirm, setShowVoidConfirm] = useState(false);
  const [voidReason, setVoidReason] = useState('');

  const { data: receipt, isLoading } = useQuery<Receipt>({
    queryKey: ['receipt', receiptId],
    queryFn: async () => {
      const { data } = await api.get(`/receipts/${receiptId}`);
      return data;
    },
    enabled: !!receiptId,
  });

  const voidMutation = useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }) => {
      const { data } = await api.post(`/receipts/${id}/void`, { reason });
      return data;
    },
    onSuccess: () => {
      toast.success('ยกเลิกใบเสร็จสำเร็จ — สร้างใบลดหนี้แล้ว');
      queryClient.invalidateQueries({ queryKey: ['receipt', receiptId] });
      queryClient.invalidateQueries({ queryKey: ['contract-receipts'] });
      queryClient.invalidateQueries({ queryKey: ['contract-payments'] });
      setShowVoidConfirm(false);
      setVoidReason('');
    },
    onError: (err: any) => toast.error(getErrorMessage(err)),
  });

  if (!receiptId) return null;

  return (
    <Modal isOpen title="ใบเสร็จรับเงิน" onClose={onClose} size="md">
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
        </div>
      ) : receipt ? (
        <div className="flex flex-col gap-4">
          {/* Printable receipt content */}
          <div id="receipt-print-area">
            {/* Header */}
            <div className="text-center border-b pb-3 mb-3">
              <div className="text-lg font-bold">{typeLabels[receipt.receiptType] || receipt.receiptType}</div>
              <div className="text-sm font-mono text-primary">{receipt.receiptNumber}</div>
              {receipt.isVoided && (
                <div className="mt-1 inline-block px-3 py-0.5 bg-red-100 text-red-700 rounded-full text-xs font-medium">
                  ยกเลิกแล้ว
                </div>
              )}
              {receipt.receiptType === 'CREDIT_NOTE' && (
                <div className="mt-1 inline-block px-3 py-0.5 bg-yellow-100 text-yellow-700 rounded-full text-xs font-medium">
                  ใบลดหนี้
                </div>
              )}
            </div>

            {/* Details */}
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">ผู้จ่ายเงิน</span>
                <span className="font-medium">{receipt.payerName}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">ผู้รับเงิน</span>
                <span>{receipt.receiverName}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">จำนวนเงิน</span>
                <span className="font-bold text-lg text-green-600">{Number(receipt.amount).toLocaleString()} ฿</span>
              </div>
              {receipt.installmentNo && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">งวดที่</span>
                  <span>{receipt.installmentNo}</span>
                </div>
              )}
              {receipt.paymentMethod && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">วิธีชำระ</span>
                  <span>{methodLabels[receipt.paymentMethod] || receipt.paymentMethod}</span>
                </div>
              )}
              {receipt.transactionRef && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">เลขอ้างอิง</span>
                  <span className="font-mono text-xs">{receipt.transactionRef}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-muted-foreground">วันที่ชำระ</span>
                <span>{new Date(receipt.paidDate).toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric' })}</span>
              </div>
              {receipt.remainingBalance != null && (
                <div className="flex justify-between border-t pt-2 mt-2">
                  <span className="text-muted-foreground">ยอดคงเหลือ</span>
                  <span className="font-medium">{Number(receipt.remainingBalance).toLocaleString()} ฿</span>
                </div>
              )}
              {receipt.remainingMonths != null && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">งวดที่เหลือ</span>
                  <span>{receipt.remainingMonths} งวด</span>
                </div>
              )}
              {receipt.isVoided && receipt.voidReason && (
                <div className="border-t pt-2 mt-2">
                  <div className="text-xs text-red-600">เหตุผลที่ยกเลิก: {receipt.voidReason}</div>
                </div>
              )}
            </div>
          </div>

          {/* Action buttons - hidden when printing */}
          <div className="flex gap-3 pt-3 border-t print:hidden">
            <button
              onClick={() => window.print()}
              className="flex-1 px-4 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90"
            >
              พิมพ์ใบเสร็จ
            </button>
            {!receipt.isVoided && receipt.receiptType !== 'CREDIT_NOTE' && (
              <button
                onClick={() => setShowVoidConfirm(true)}
                className="px-4 py-2 text-sm border border-red-300 text-red-600 rounded-lg hover:bg-red-50"
              >
                ยกเลิกใบเสร็จ
              </button>
            )}
          </div>

          {/* Void confirmation */}
          {showVoidConfirm && (
            <div className="border border-red-200 bg-red-50 rounded-lg p-4 print:hidden">
              <div className="text-sm font-medium text-red-800 mb-2">ยืนยันยกเลิกใบเสร็จ</div>
              <p className="text-xs text-red-600 mb-2">ระบบจะสร้างใบลดหนี้ (Credit Note) อ้างอิงใบเสร็จนี้</p>
              <input
                type="text"
                value={voidReason}
                onChange={(e) => setVoidReason(e.target.value)}
                placeholder="ระบุเหตุผลที่ยกเลิก..."
                className="w-full px-3 py-2 border border-red-200 rounded-lg text-sm mb-2"
              />
              <div className="flex gap-2">
                <button
                  onClick={() => { setShowVoidConfirm(false); setVoidReason(''); }}
                  className="px-3 py-1.5 text-xs border border-input rounded-lg"
                >
                  ยกเลิก
                </button>
                <button
                  onClick={() => voidMutation.mutate({ id: receipt.id, reason: voidReason })}
                  disabled={!voidReason.trim() || voidMutation.isPending}
                  className="px-3 py-1.5 text-xs bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50"
                >
                  {voidMutation.isPending ? 'กำลังยกเลิก...' : 'ยืนยันยกเลิก'}
                </button>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="text-center py-8 text-muted-foreground text-sm">ไม่พบใบเสร็จ</div>
      )}
    </Modal>
  );
}
