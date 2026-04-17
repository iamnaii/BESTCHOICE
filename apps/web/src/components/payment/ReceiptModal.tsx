import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api, { getErrorMessage } from '@/lib/api';
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
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
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
    onError: (err: unknown) => {
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

  // Determine container max-width based on print size
  const getMaxWidth = () => {
    switch (printSize) {
      case 'a4': return 'max-w-5xl';
      case 'a5': return 'max-w-3xl';
      default: return 'max-w-2xl';
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-start justify-center pt-8 pb-8 print:static print:bg-transparent print:p-0" role="dialog" aria-modal="true" aria-label="ใบเสร็จรับเงิน">
      <div className={`w-full ${getMaxWidth()} bg-background rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[calc(100vh-4rem)] print:max-w-full print:max-h-full print:shadow-none print:rounded-none`}>
        <div className="sticky top-0 z-10 bg-background/95 backdrop-blur-xs border-b px-6 py-4 flex items-center justify-between shrink-0 print:hidden">
          <button type="button" onClick={onClose} className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6"/></svg>
            กลับ
          </button>
          <h2 className="text-lg font-semibold text-foreground">ใบเสร็จรับเงิน</h2>
          <div className="w-16" />
        </div>
        <div className="flex-1 overflow-y-auto flex flex-col">
          <div className="p-6 space-y-5 flex-1">
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
        </div>
      ) : receipt ? (
        <div className="flex flex-col gap-4">
          {/* Print Size Selector - hidden when printing */}
          <div className="rounded-xl border border-border bg-card p-5 print:hidden">
            <div className="flex items-center gap-2.5 mb-4">
              <div className="flex items-center justify-center size-8 rounded-lg bg-warning/10 text-warning">
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
              </div>
              <div>
                <h3 className="text-sm font-semibold text-foreground">รูปแบบการแสดง</h3>
                <p className="text-xs text-muted-foreground">เลือกขนาดสำหรับดูหรือพิมพ์</p>
              </div>
            </div>
            <label className="block text-xs font-medium text-foreground mb-1.5">เลือกรูปแบบ</label>
            <select
              value={printSize}
              onChange={(e) => setPrintSize(e.target.value as PrintSize)}
              className="w-full h-10 px-3 rounded-lg border border-input bg-background text-sm transition-colors hover:border-primary/50 focus:border-primary focus:outline-hidden focus:ring-2 focus:ring-primary/20"
            >
              <option value="mobile">📱 แบบมือถือ</option>
              <option value="a5">📄 พิมพ์ A5 (148×210 มม.)</option>
              <option value="a4">📄 พิมพ์ A4 (210×297 มม.)</option>
            </select>
          </div>

          {/* Receipt Content */}
          <div className="rounded-xl border border-border bg-card p-5 print:border-0 print:p-0">
            <div className="flex items-center gap-2.5 mb-4 print:hidden">
              <div className="flex items-center justify-center size-8 rounded-lg bg-primary/10 text-primary">
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg>
              </div>
              <div>
                <h3 className="text-sm font-semibold text-foreground">ตัวอย่างใบเสร็จ</h3>
                <p className="text-xs text-muted-foreground">พรีวิวก่อนส่งหรือพิมพ์</p>
              </div>
            </div>
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

          </div>

          {/* Void confirmation */}
          {showVoidConfirm && (
            <div className="border border-destructive/30 bg-destructive/10 rounded-lg p-4 print:hidden">
              <div className="text-sm font-medium text-destructive mb-2">ยืนยันยกเลิกใบเสร็จ</div>
              <p className="text-xs text-destructive mb-2">ระบบจะสร้างใบลดหนี้ (Credit Note) อ้างอิงใบเสร็จนี้</p>
              <input
                type="text"
                value={voidReason}
                onChange={(e) => setVoidReason(e.target.value)}
                placeholder="ระบุเหตุผลที่ยกเลิก..."
                className="w-full px-3 py-2 border border-destructive/30 rounded-lg text-sm mb-2"
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
                  className="px-3 py-1.5 text-xs bg-destructive text-destructive-foreground rounded-lg hover:bg-destructive/90 disabled:opacity-50"
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
          </div>
          {receipt && (
            <div className="sticky bottom-0 bg-background/95 backdrop-blur-xs border-t px-6 py-4 flex justify-end gap-3 shrink-0 print:hidden">
              <button
                type="button"
                onClick={onClose}
                className="px-6 py-2.5 text-sm border border-input rounded-lg hover:bg-muted transition-colors"
              >
                ปิด
              </button>
              {!receipt.isVoided && receipt.receiptType !== 'CREDIT_NOTE' && (
                <button
                  type="button"
                  onClick={() => setShowVoidConfirm(true)}
                  className="px-6 py-2.5 text-sm border border-destructive/30 text-destructive rounded-lg hover:bg-destructive/10 font-semibold transition-colors"
                >
                  ยกเลิกใบเสร็จ
                </button>
              )}
              {printSize === 'mobile' ? (
                <button
                  type="button"
                  onClick={handleSendLine}
                  disabled={isSendingLine || !receipt.contract?.customer}
                  className="px-6 py-2.5 text-sm bg-success text-success-foreground rounded-lg hover:bg-success/90 disabled:opacity-50 font-semibold transition-colors shadow-sm flex items-center gap-2"
                  title={!receipt.contract?.customer ? 'ไม่พบข้อมูล LINE ของลูกค้า' : 'ส่งใบเสร็จทาง LINE'}
                >
                  {isSendingLine ? (
                    <span className="animate-spin rounded-full h-4 w-4 border-b-2 border-success-foreground" />
                  ) : (
                    <Send className="h-4 w-4" />
                  )}
                  {isSendingLine ? 'กำลังส่ง...' : 'ส่งทาง LINE'}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleExportPDF}
                  disabled={isGeneratingPDF}
                  className="px-6 py-2.5 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50 font-semibold transition-colors shadow-sm flex items-center gap-2"
                  title="บันทึกเป็น PDF (ตรงกับที่แสดง)"
                >
                  {isGeneratingPDF ? (
                    <span className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary-foreground" />
                  ) : (
                    <Download className="h-4 w-4" />
                  )}
                  {isGeneratingPDF ? 'กำลังสร้าง...' : 'บันทึก PDF'}
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
