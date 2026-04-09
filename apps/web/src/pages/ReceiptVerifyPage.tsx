import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import MobileReceipt from '@/components/payment/MobileReceipt';
import type { Receipt } from '@/types/receipt';
import { CheckCircle2, XCircle, AlertCircle } from 'lucide-react';
import { formatDateTime } from '@/utils/formatters';

export default function ReceiptVerifyPage() {
  const { receiptNumber } = useParams<{ receiptNumber: string }>();

  const { data: receipt, isLoading, error } = useQuery<Receipt>({
    queryKey: ['verify-receipt', receiptNumber],
    queryFn: async () => {
      const { data } = await api.get(`/receipts/number/${receiptNumber}`);
      return data;
    },
    enabled: !!receiptNumber,
    retry: false,
  });

  return (
    <div className="min-h-screen bg-muted/30 py-8 px-4">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-foreground mb-1">ตรวจสอบใบเสร็จ</h1>
          <p className="text-sm text-muted-foreground">Receipt Verification</p>
        </div>

        {isLoading && (
          <div className="flex flex-col items-center justify-center py-16">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mb-4" />
            <p className="text-muted-foreground text-sm">กำลังตรวจสอบใบเสร็จ...</p>
          </div>
        )}

        {error && (
          <div className="rounded-xl border border-border/50 bg-card shadow-sm p-8 text-center">
            <XCircle className="w-14 h-14 text-destructive mx-auto mb-4" />
            <h2 className="text-xl font-bold text-foreground mb-2">ไม่พบใบเสร็จ</h2>
            <p className="text-muted-foreground text-sm">
              ไม่พบใบเสร็จเลขที่ <span className="font-mono text-foreground">{receiptNumber}</span>
            </p>
            <p className="text-muted-foreground text-xs mt-2">กรุณาตรวจสอบเลขใบเสร็จและลองอีกครั้ง</p>
          </div>
        )}

        {receipt && (
          <div>
            {/* Verification Status */}
            {!receipt.isVoided ? (
              <div className="rounded-xl border border-success/30 bg-success/5 dark:bg-success/10 shadow-sm p-6 mb-6 text-center">
                <CheckCircle2 className="w-12 h-12 text-success mx-auto mb-3" />
                <h2 className="text-lg font-bold text-success mb-1">ใบเสร็จถูกต้อง</h2>
                <p className="text-success/80 text-sm">ใบเสร็จนี้ออกโดย {receipt.company?.nameTh || 'BESTCHOICE'}</p>
              </div>
            ) : (
              <div className="rounded-xl border border-warning/30 bg-warning/5 dark:bg-warning/10 shadow-sm p-6 mb-6 text-center">
                <AlertCircle className="w-12 h-12 text-warning mx-auto mb-3" />
                <h2 className="text-lg font-bold text-warning mb-1">ใบเสร็จถูกยกเลิก</h2>
                <p className="text-warning/80 text-sm">ใบเสร็จนี้ถูกยกเลิกแล้ว</p>
                {receipt.voidReason && (
                  <p className="text-warning/70 text-xs mt-2">
                    เหตุผล: {receipt.voidReason}
                  </p>
                )}
              </div>
            )}

            {/* Receipt Display */}
            <MobileReceipt receipt={receipt} />

            {/* Footer Info */}
            <div className="mt-6 rounded-xl border border-border/50 bg-card shadow-sm p-5 text-center">
              <p className="text-xs text-muted-foreground">
                หากพบความผิดปกติ กรุณาติดต่อ
                {receipt.company?.phone && (
                  <span className="block font-medium text-foreground mt-1">
                    โทร: {receipt.company.phone}
                  </span>
                )}
              </p>
              <p className="text-xs text-muted-foreground/60 mt-2">
                ตรวจสอบเมื่อ: {formatDateTime(new Date())}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
