import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api, { getErrorMessage } from '@/lib/api';
import Modal from '@/components/ui/Modal';
import { toast } from 'sonner';
import A4PrintableReceipt from './A4PrintableReceipt';
import MobileReceipt from './MobileReceipt';
import type { Receipt } from '@/types/receipt';

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
  const [viewMode, setViewMode] = useState<'mobile' | 'a4'>('mobile');

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
    <Modal isOpen title="ใบเสร็จรับเงิน" onClose={onClose} size={viewMode === 'a4' ? 'xl' : 'md'}>
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
        </div>
      ) : receipt ? (
        <div className="flex flex-col gap-4">
          {/* View Mode Toggle - hidden when printing */}
          <div className="flex gap-2 justify-center print:hidden">
            <button
              onClick={() => setViewMode('mobile')}
              className={`px-4 py-2 text-sm rounded-lg transition-colors ${
                viewMode === 'mobile'
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              แบบมือถือ
            </button>
            <button
              onClick={() => setViewMode('a4')}
              className={`px-4 py-2 text-sm rounded-lg transition-colors ${
                viewMode === 'a4'
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              แบบพิมพ์ A4
            </button>
          </div>

          {/* Receipt Content */}
          <div id="receipt-print-area">
            {viewMode === 'mobile' ? (
              <MobileReceipt receipt={receipt} />
            ) : (
              <A4PrintableReceipt receipt={receipt} />
            )}
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
