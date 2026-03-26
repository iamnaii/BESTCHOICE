import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api, { getErrorMessage } from '@/lib/api';
import Modal from '@/components/ui/Modal';
import { toast } from 'sonner';
import { Download, Send } from 'lucide-react';
import PrintableReceipt from './PrintableReceipt';
import MobileReceipt from './MobileReceipt';
import { downloadUnifiedReceiptPDF } from '@/utils/unifiedReceiptPdf';
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

type PrintSize = 'mobile' | 'a4' | 'a5';

export default function ReceiptModal({ receiptId, onClose }: ReceiptModalProps) {
  const queryClient = useQueryClient();
  const [showVoidConfirm, setShowVoidConfirm] = useState(false);
  const [voidReason, setVoidReason] = useState('');
  const [printSize, setPrintSize] = useState<PrintSize>('mobile');
  const [isGeneratingPDF, setIsGeneratingPDF] = useState(false);
  const [isSendingLine, setIsSendingLine] = useState(false);

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

  // Send receipt via LINE
  const sendLineMutation = useMutation({
    mutationFn: async (id: string) => {
      const { data } = await api.post(`/receipts/${id}/send-line`);
      return data;
    },
    onSuccess: () => {
      toast.success('ส่งใบเสร็จทาง LINE เรียบร้อยแล้ว');
      setIsSendingLine(false);
    },
    onError: (err: any) => {
      toast.error(getErrorMessage(err));
      setIsSendingLine(false);
    },
  });

  // Handle PDF export via print dialog
  const handleExportPDF = async () => {
    if (!receipt) return;

    setIsGeneratingPDF(true);
    try {
      await downloadUnifiedReceiptPDF(receipt, printSize);
      toast.success('บันทึก PDF สำเร็จ');
    } catch (error) {
      toast.error('ไม่สามารถสร้าง PDF ได้');
    } finally {
      setIsGeneratingPDF(false);
    }
  };


  // Handle send via LINE
  const handleSendLine = () => {
    if (!receipt) return;

    setIsSendingLine(true);
    sendLineMutation.mutate(receipt.id);
  };

  if (!receiptId) return null;

  // Determine modal size based on print size
  const getModalSize = () => {
    switch (printSize) {
      case 'a4': return 'full';  // Use full width for A4
      case 'a5': return '2xl';   // Use 2xl for A5
      default: return 'md';      // mobile
    }
  };

  return (
    <Modal isOpen title="ใบเสร็จรับเงิน" onClose={onClose} size={getModalSize()}>
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
        </div>
      ) : receipt ? (
        <div className="flex flex-col gap-4">
          {/* Print Size Selector - hidden when printing */}
          <div className="print:hidden space-y-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">เลือกรูปแบบการแสดง:</label>
              <select
                value={printSize}
                onChange={(e) => setPrintSize(e.target.value as PrintSize)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              >
                <option value="mobile">📱 แบบมือถือ</option>
                <option value="a5">📄 พิมพ์ A5 (148×210 มม.)</option>
                <option value="a4">📄 พิมพ์ A4 (210×297 มม.)</option>
              </select>
            </div>

          </div>

          {/* Receipt Content */}
          <div id="receipt-print-area" className="font-sarabun overflow-hidden">
            {printSize === 'mobile' ? (
              <MobileReceipt receipt={receipt} />
            ) : (
              <PrintableReceipt
                receipt={receipt}
                size={printSize as 'a4' | 'a5'}
              />
            )}
          </div>

          {/* Action buttons - hidden when printing */}
          <div className="flex flex-col gap-3 pt-3 border-t print:hidden">
            {/* Main action buttons */}
            <div className="flex gap-2">
              {/* Mobile view: LINE + Cancel */}
              {printSize === 'mobile' ? (
                <>
                  <button
                    onClick={handleSendLine}
                    disabled={isSendingLine || !receipt.contract?.customer}
                    className="flex-1 px-4 py-2 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 flex items-center justify-center gap-2"
                    title={!receipt.contract?.customer ? 'ไม่พบข้อมูล LINE ของลูกค้า' : 'ส่งใบเสร็จทาง LINE'}
                  >
                    {isSendingLine ? (
                      <span className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
                    ) : (
                      <Send className="h-4 w-4" />
                    )}
                    {isSendingLine ? 'กำลังส่ง...' : 'ส่งทาง LINE'}
                  </button>

                  {!receipt.isVoided && receipt.receiptType !== 'CREDIT_NOTE' && (
                    <button
                      onClick={() => setShowVoidConfirm(true)}
                      className="flex-1 px-4 py-2 text-sm border border-red-300 text-red-600 rounded-lg hover:bg-red-50"
                    >
                      ยกเลิกใบเสร็จ
                    </button>
                  )}
                </>
              ) : (
                /* Print views (A4, A5, Thermal): PDF + Cancel */
                <>
                  <button
                    onClick={handleExportPDF}
                    disabled={isGeneratingPDF}
                    className="flex-1 px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center justify-center gap-2"
                    title="บันทึกเป็น PDF (ตรงกับที่แสดง)"
                  >
                    {isGeneratingPDF ? (
                      <span className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
                    ) : (
                      <Download className="h-4 w-4" />
                    )}
                    {isGeneratingPDF ? 'กำลังสร้าง...' : 'บันทึก PDF'}
                  </button>

                  {!receipt.isVoided && receipt.receiptType !== 'CREDIT_NOTE' && (
                    <button
                      onClick={() => setShowVoidConfirm(true)}
                      className="flex-1 px-4 py-2 text-sm border border-red-300 text-red-600 rounded-lg hover:bg-red-50"
                    >
                      ยกเลิกใบเสร็จ
                    </button>
                  )}
                </>
              )}
            </div>
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
