import { useLiffInit } from '@/hooks/useLiffInit';
import { liffApi } from '@/lib/api';
import { useQuery, useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

import type { LiffEarlyPayoffQuote as EarlyPayoffQuote } from '@installment/shared';

export default function LiffEarlyPayoff() {
  const { lineId, loading, error } = useLiffInit();

  const params = new URLSearchParams(window.location.search);
  const contractId = params.get('contractId') || '';

  const {
    data: quote,
    isLoading: quoteLoading,
    error: quoteError,
  } = useQuery<EarlyPayoffQuote>({
    queryKey: ['liff-early-payoff-quote', lineId, contractId],
    queryFn: async () => {
      if (!contractId) throw new Error('ไม่พบรหัสสัญญา');
      const { data: result } = await liffApi.get(
        `/line-oa/liff/early-payoff-quote?lineId=${encodeURIComponent(lineId!)}&contractId=${encodeURIComponent(contractId)}`,
      );
      return result;
    },
    enabled: !!lineId,
  });

  const payoffMutation = useMutation({
    mutationFn: async () => {
      const { data: result } = await liffApi.post('/line-oa/liff/early-payoff', { lineId, contractId });
      return result as { url: string; token: string; totalPayoff: number };
    },
    onSuccess: (result) => {
      window.location.href = result.url;
    },
    onError: (err: Error) => {
      toast.error(err.message);
    },
  });

  // Loading
  if (loading || quoteLoading) {
    return (
      <div className="min-h-screen bg-background p-4 space-y-4">
        <Skeleton className="h-28 w-full rounded-xl" />
        <Skeleton className="h-64 w-full rounded-xl" />
        <Skeleton className="h-12 w-full rounded-xl" />
      </div>
    );
  }

  // Error
  const errorMsg = error || (quoteError as Error)?.message;
  if (errorMsg) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="max-w-md w-full">
          <CardContent className="text-center py-10">
            <div className="text-destructive text-5xl mb-4">!</div>
            <h2 className="text-lg font-bold mb-2">ไม่สามารถดำเนินการได้</h2>
            <p className="text-muted-foreground text-sm mb-6">{errorMsg}</p>
            <Button variant="outline" asChild>
              <a href={`/liff/contract${lineId ? `?lineId=${encodeURIComponent(lineId)}` : ''}`}>
                กลับไปดูสัญญา
              </a>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Creating payment link
  if (payoffMutation.isPending) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto" />
          <p className="mt-4 text-muted-foreground">กำลังสร้างลิงก์ชำระเงิน...</p>
        </div>
      </div>
    );
  }

  // Quote view
  if (!quote) return null;

  return (
    <div className="min-h-screen bg-background p-4 pb-8">
      {/* Header */}
      <div className="bg-primary rounded-xl p-5 text-primary-foreground mb-4">
        <p className="text-xs opacity-80">BEST CHOICE</p>
        <h1 className="text-base font-bold mt-1">ปิดยอดก่อนกำหนด</h1>
        <p className="text-xs opacity-80 mt-1">สัญญา {quote.contractNumber}</p>
      </div>

      {/* Customer Info */}
      <Card className="mb-4">
        <CardContent className="py-4">
          <p className="text-sm text-muted-foreground">ลูกค้า</p>
          <p className="text-base font-medium">{quote.customerName}</p>
        </CardContent>
      </Card>

      {/* Quote Details */}
      <Card className="mb-4">
        <CardContent>
          <h2 className="text-sm font-bold mb-3">รายละเอียดยอดปิด</h2>
          <div className="space-y-2.5">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">งวดคงเหลือ</span>
              <span className="font-medium">{quote.remainingMonths} งวด</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">เงินต้นคงเหลือ</span>
              <span className="font-medium">{quote.remainingPrincipal.toLocaleString()} บาท</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">ดอกเบี้ยคงเหลือ</span>
              <span className="font-medium">{quote.remainingInterest.toLocaleString()} บาท</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-success">ส่วนลดดอกเบี้ย (50%)</span>
              <span className="font-medium text-success">-{quote.discount.toLocaleString()} บาท</span>
            </div>
            {quote.partiallyPaidCredit > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-success">หักยอดชำระบางส่วน</span>
                <span className="font-medium text-success">-{quote.partiallyPaidCredit.toLocaleString()} บาท</span>
              </div>
            )}
            {quote.unpaidLateFees > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-destructive">ค่าปรับค้างชำระ</span>
                <span className="font-medium text-destructive">+{quote.unpaidLateFees.toLocaleString()} บาท</span>
              </div>
            )}

            <div className="border-t border-border pt-3 flex justify-between items-center">
              <span className="text-sm font-medium">ยอดปิดสัญญา</span>
              <div className="text-right">
                <span className="text-2xl font-bold text-primary">{quote.totalPayoff.toLocaleString()}</span>
                <span className="text-sm text-muted-foreground ml-1">บาท</span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Info Note */}
      <Card className="mb-4 border-primary/20 bg-primary/5">
        <CardContent className="py-3">
          <p className="text-xs text-muted-foreground">
            ยอดปิดสัญญาได้รับส่วนลดดอกเบี้ย 50% จากดอกเบี้ยคงเหลือ กดชำระเพื่อปิดสัญญาทันที
          </p>
        </CardContent>
      </Card>

      {/* Pay Button */}
      <Button
        variant="primary"
        size="lg"
        className="w-full"
        onClick={() => payoffMutation.mutate()}
        disabled={payoffMutation.isPending}
      >
        ชำระเพื่อปิดยอด {quote.totalPayoff.toLocaleString()} บาท
      </Button>

      {/* Back link */}
      <div className="text-center mt-4">
        <Button variant="ghost" className="text-muted-foreground" asChild>
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
