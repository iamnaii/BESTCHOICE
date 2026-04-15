import { useLiffInit } from '@/hooks/useLiffInit';
import { liffApi } from '@/lib/api';
import { useQuery } from '@tanstack/react-query';
import { formatDateMedium } from '@/utils/formatters';
import { FileText, Download } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { LIFF_ERRORS } from '@/constants/liff-errors';

interface ReceiptItem {
  id: string;
  receiptNumber: string;
  receiptType: string;
  amount: number;
  paidDate: string;
  paymentMethod: string | null;
  installmentNo: number | null;
  contractNumber: string;
  hasFile: boolean;
}

const typeLabels: Record<string, { label: string; variant: 'success' | 'info' | 'secondary' }> = {
  PAYMENT: { label: 'ค่างวด', variant: 'success' },
  DOWN_PAYMENT: { label: 'เงินดาวน์', variant: 'info' },
  EARLY_PAYOFF: { label: 'ปิดยอด', variant: 'info' },
  CREDIT_NOTE: { label: 'ใบลดหนี้', variant: 'secondary' },
};

export default function LiffReceipts() {
  const { lineId, loading, error } = useLiffInit();

  const { data, isLoading, error: dataError } = useQuery<ReceiptItem[]>({
    queryKey: ['liff-receipts', lineId],
    queryFn: async () => {
      const { data } = await liffApi.get('/line-oa/liff/receipts');
      return data;
    },
    enabled: !!lineId,
  });

  if (loading || isLoading) {
    return (
      <div className="min-h-screen bg-background p-4 space-y-4">
        <Skeleton className="h-24 w-full rounded-xl" />
        <Skeleton className="h-20 w-full rounded-xl" />
        <Skeleton className="h-20 w-full rounded-xl" />
        <Skeleton className="h-20 w-full rounded-xl" />
      </div>
    );
  }

  if (error || dataError) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="max-w-md w-full">
          <CardContent className="text-center py-10">
            <div className="text-destructive text-5xl mb-4">!</div>
            <h2 className="text-lg font-bold mb-2">{LIFF_ERRORS.LOAD_FAILED}</h2>
            <p className="text-muted-foreground text-sm">{error || (dataError as Error)?.message}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const receipts = data || [];

  if (receipts.length === 0) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="max-w-md w-full">
          <CardContent className="text-center py-10">
            <FileText className="size-12 text-muted-foreground/40 mx-auto mb-4" />
            <h2 className="text-lg font-bold mb-2">ยังไม่มีใบเสร็จ</h2>
            <p className="text-muted-foreground text-sm">ใบเสร็จจะปรากฏหลังชำระเงินสำเร็จ</p>
            <Button variant="primary" size="lg" className="mt-6" asChild>
              <a href={`/liff/contract${lineId ? `?lineId=${encodeURIComponent(lineId)}` : ''}`}>
                กลับไปดูสัญญา
              </a>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const totalAmount = receipts.reduce((sum, r) => sum + r.amount, 0);

  return (
    <div className="min-h-screen bg-background p-4 pb-8">
      {/* Header */}
      <div className="bg-gradient-to-r from-[#1e3a5f] to-[#059669] rounded-xl p-5 text-white shadow-md mb-4">
        <p className="text-xs opacity-80">BEST CHOICE</p>
        <h1 className="text-base font-bold mt-1">ใบเสร็จของฉัน</h1>
        <p className="text-xs opacity-80 mt-1">{receipts.length} รายการ</p>
      </div>

      {/* Summary */}
      <Card className="mb-4">
        <CardContent className="py-4">
          <div className="flex justify-between items-center">
            <div>
              <p className="text-xs text-muted-foreground">ชำระรวมทั้งหมด</p>
              <p className="text-lg font-bold text-success">{totalAmount.toLocaleString()} บาท</p>
            </div>
            <div className="text-right">
              <p className="text-xs text-muted-foreground">จำนวนใบเสร็จ</p>
              <p className="text-lg font-bold">{receipts.length}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Receipt List */}
      <div className="space-y-2">
        {receipts.map((r) => {
          const typeInfo = typeLabels[r.receiptType] || { label: r.receiptType, variant: 'secondary' as const };
          return (
            <Card key={r.id}>
              <CardContent className="py-3">
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{r.receiptNumber}</span>
                    <Badge variant={typeInfo.variant} size="sm">{typeInfo.label}</Badge>
                  </div>
                  {r.hasFile && (
                    <Button
                      variant="ghost"
                      size="sm"
                      asChild
                    >
                      <a
                        href={`/api/line-oa/liff/receipts/${r.id}/download`}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <Download className="size-4" />
                      </a>
                    </Button>
                  )}
                </div>
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>
                    {r.contractNumber}
                    {r.installmentNo ? ` · งวด ${r.installmentNo}` : ''}
                  </span>
                  <span>{formatDateMedium(r.paidDate)}</span>
                </div>
                <p className="text-sm font-medium text-success mt-1">
                  {r.amount.toLocaleString()} บาท
                </p>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Back */}
      <div className="text-center mt-4">
        <Button variant="ghost" mode="link" className="text-primary" asChild>
          <a href={`/liff/contract${lineId ? `?lineId=${encodeURIComponent(lineId)}` : ''}`}>
            ← กลับไปดูสัญญา
          </a>
        </Button>
      </div>

      <p className="text-center text-xs text-muted-foreground mt-4">
        BEST CHOICE - ระบบผ่อนชำระมือถือ
      </p>
    </div>
  );
}
