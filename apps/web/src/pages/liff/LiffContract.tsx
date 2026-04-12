import { useState, useEffect } from 'react';
import { useLiffInit } from '@/hooks/useLiffInit';
import { liffApi } from '@/lib/api';
import { useQuery, useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { QrCode, ChevronDown } from 'lucide-react';
import { formatNumber, formatDateMedium, formatDateShortThai } from '@/utils/formatters';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { LIFF_ERRORS } from '@/constants/liff-errors';

import type {
  LiffPayment as Payment,
  LiffContract as Contract,
  LiffContractResponse as ContractData,
} from '@installment/shared';

const statusConfig: Record<string, { label: string; variant: 'success' | 'destructive' | 'secondary' | 'info' }> = {
  ACTIVE: { label: 'ปกติ', variant: 'success' },
  OVERDUE: { label: 'ค้างชำระ', variant: 'destructive' },
  DEFAULT: { label: 'ผิดนัด', variant: 'destructive' },
  COMPLETED: { label: 'ครบแล้ว', variant: 'secondary' },
  EARLY_PAYOFF: { label: 'ปิดก่อนกำหนด', variant: 'info' },
};

const paymentStatusIcon: Record<string, string> = {
  PAID: '✅',
  OVERDUE: '❌',
  PARTIALLY_PAID: '⏳',
  PENDING: '⬜',
};

export default function LiffContract() {
  const { lineId, loading, error } = useLiffInit();
  const [selectedContract, setSelectedContract] = useState(0);
  const [showAllPayments, setShowAllPayments] = useState(false);

  // ตรวจสอบ payment status เมื่อ redirect กลับจาก Pay Solutions
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const ref = params.get('ref');
    if (!ref) return;

    // ลบ query param ออกจาก URL เพื่อไม่ให้ poll ซ้ำเมื่อ refresh
    window.history.replaceState({}, '', window.location.pathname);

    let attempts = 0;
    const maxAttempts = 20; // poll สูงสุด 60 วินาที (20 × 3s)
    const pollId = setInterval(async () => {
      attempts++;
      try {
        const { data: status } = await liffApi.get(`/paysolutions/status/${ref}`);
        if (status.status === 'PAID') {
          clearInterval(pollId);
          toast.success('ชำระเงินสำเร็จ!');
        } else if (status.status === 'FAILED' || attempts >= maxAttempts) {
          clearInterval(pollId);
          if (status.status === 'FAILED') {
            toast.error('การชำระเงินไม่สำเร็จ กรุณาลองใหม่');
          }
        }
      } catch {
        if (attempts >= maxAttempts) clearInterval(pollId);
      }
    }, 3000);

    return () => clearInterval(pollId);
  }, []);

  // ─── PDPA Consent ───
  const [showConsent, setShowConsent] = useState(false);

  const { data: consentData } = useQuery<{ consent: boolean; consentAt: string | null }>({
    queryKey: ['liff-consent', lineId],
    queryFn: async () => {
      const { data } = await liffApi.get(`/line-oa/liff/consent?lineId=${encodeURIComponent(lineId!)}`);
      return data;
    },
    enabled: !!lineId,
  });

  useEffect(() => {
    if (consentData && !consentData.consent) {
      setShowConsent(true);
    }
  }, [consentData]);

  const consentMutation = useMutation({
    mutationFn: async () => {
      await liffApi.post('/line-oa/liff/consent', { consent: true });
    },
    onSuccess: () => {
      setShowConsent(false);
    },
  });

  const { data, isLoading: dataLoading, error: dataError } = useQuery<ContractData>({
    queryKey: ['liff-contracts', lineId],
    queryFn: async () => {
      try {
        const { data } = await liffApi.get(`/line-oa/liff/contracts?lineId=${encodeURIComponent(lineId!)}`);
        return data;
      } catch (err: unknown) {
        const axiosErr = err as { response?: { status?: number } };
        if (axiosErr.response?.status === 404) throw new Error(LIFF_ERRORS.NOT_REGISTERED);
        throw new Error(LIFF_ERRORS.LOAD_FAILED);
      }
    },
    enabled: !!lineId,
  });

  const payMutation = useMutation({
    mutationFn: async ({ contractId, installmentNo, amount }: { contractId: string; installmentNo: number; amount: number }) => {
      const { data: result } = await liffApi.post('/paysolutions/create-intent', {
        contractId,
        amount,
        lineId,
        installmentNo,
        description: `ชำระค่างวดที่ ${installmentNo}`,
      });
      if (!result.success || !result.paymentUrl) {
        throw new Error(LIFF_ERRORS.PAYMENT_CREATE_FAILED);
      }
      return result as { paymentUrl: string; gatewayRef: string };
    },
    onSuccess: (result) => {
      window.location.href = result.paymentUrl;
    },
    onError: (err: unknown) => {
      toast.error(err instanceof Error ? err.message : 'เกิดข้อผิดพลาด กรุณาลองใหม่');
    },
  });

  // --- Loading ---
  if (loading || dataLoading) {
    return (
      <div className="min-h-screen bg-background p-4 space-y-4">
        <Skeleton className="h-24 w-full rounded-xl" />
        <Skeleton className="h-40 w-full rounded-xl" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }

  // --- Error ---
  const errorMsg = error || (dataError as Error)?.message;
  if (errorMsg) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="max-w-md w-full">
          <CardContent className="text-center py-10">
            <div className="text-destructive text-5xl mb-4">!</div>
            <h2 className="text-lg font-bold mb-2">ไม่สามารถดำเนินการได้</h2>
            <p className="text-muted-foreground text-sm">{errorMsg}</p>
            {errorMsg?.includes('ลงทะเบียน') && (
              <Button variant="primary" size="lg" className="mt-6" asChild>
                <a href={`/liff/register${lineId ? `?lineId=${encodeURIComponent(lineId)}` : ''}`}>ลงทะเบียนเลย</a>
              </Button>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  // --- No contracts ---
  if (!data || data.contracts.length === 0) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="max-w-md w-full">
          <CardContent className="text-center py-10">
            <div className="text-muted-foreground text-5xl mb-4">📋</div>
            <h2 className="text-lg font-bold mb-2">ไม่มีสัญญา</h2>
            <p className="text-muted-foreground text-sm">
              คุณ{data?.customer.name} ยังไม่มีสัญญาที่ใช้งานอยู่
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const contract = data.contracts[selectedContract];
  const payments = contract.payments;
  const displayPayments = showAllPayments ? payments : payments.slice(0, 6);

  // Find next unpaid installment for "ชำระงวดถัดไป" button
  const nextUnpaid = payments.find((p) => p.status !== 'PAID');

  function handlePayClick(payment?: Payment) {
    const target = payment || nextUnpaid;
    if (!target || payMutation.isPending) return;
    const amount = target.amountDue + target.lateFee - target.amountPaid;
    if (amount <= 0) return;
    payMutation.mutate({
      contractId: contract.id,
      installmentNo: target.installmentNo,
      amount,
    });
  }

  return (
    <div className="min-h-screen bg-background p-4 pb-8">
      {/* PDPA Consent Modal */}
      {showConsent && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center p-4">
          <Card className="max-w-md w-full animate-in slide-in-from-bottom-4">
            <CardContent className="py-6">
              <h2 className="text-base font-bold mb-3">ข้อตกลงการใช้งาน</h2>
              <div className="text-xs text-muted-foreground space-y-2 mb-4 max-h-40 overflow-y-auto">
                <p>BEST CHOICE ขอความยินยอมในการเก็บรวบรวม ใช้ และเปิดเผยข้อมูลส่วนบุคคลของท่าน เพื่อวัตถุประสงค์ดังนี้:</p>
                <p>1. การจัดการสัญญาเช่าซื้อและการชำระเงิน</p>
                <p>2. การแจ้งเตือนค่างวดและข้อมูลสัญญาผ่าน LINE</p>
                <p>3. การให้บริการลูกค้าผ่านระบบแชทอัตโนมัติ</p>
                <p>ท่านสามารถถอนความยินยอมได้ตลอดเวลาผ่านหน้าโปรไฟล์</p>
              </div>
              <Button
                variant="primary"
                size="lg"
                className="w-full"
                onClick={() => consentMutation.mutate()}
                disabled={consentMutation.isPending}
              >
                {consentMutation.isPending ? 'กำลังบันทึก...' : 'ยินยอม'}
              </Button>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Header */}
      <div className="bg-primary rounded-xl p-5 text-primary-foreground mb-4">
        <p className="text-xs opacity-80">BEST CHOICE</p>
        <h1 className="text-base font-bold mt-1">สัญญาของฉัน</h1>
        <p className="text-sm opacity-90 mt-1">คุณ{data.customer.name}</p>
      </div>

      {/* Contract Tabs (if multiple) */}
      {data.contracts.length > 1 && (
        <div className="flex gap-2 mb-4 overflow-x-auto pb-1">
          {data.contracts.map((c, i) => (
            <Button
              key={c.id}
              variant={i === selectedContract ? 'primary' : 'outline'}
              size="sm"
              className="shrink-0"
              onClick={() => { setSelectedContract(i); setShowAllPayments(false); }}
            >
              {c.contractNumber}
            </Button>
          ))}
        </div>
      )}

      {/* Contract Summary */}
      <Card className="mb-4">
        <CardContent>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-bold">{contract.contractNumber}</h2>
            <Badge
              variant={statusConfig[contract.status]?.variant || 'secondary'}
              appearance="light"
              size="sm"
            >
              {statusConfig[contract.status]?.label || contract.status}
            </Badge>
          </div>
          <p className="text-muted-foreground text-sm mb-3">{contract.product}</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="text-xs text-muted-foreground">ราคาสินค้า</p>
              <p className="text-sm font-medium">{formatNumber(contract.sellingPrice)} บาท</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">เงินดาวน์</p>
              <p className="text-sm font-medium">{formatNumber(contract.downPayment)} บาท</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">ค่างวด/เดือน</p>
              <p className="text-sm font-bold text-primary">
                {formatNumber(contract.monthlyPayment)} บาท
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">ชำระแล้ว</p>
              <p className="text-sm font-medium text-success">
                {contract.paidInstallments}/{contract.totalMonths} งวด
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">ยอดค้าง</p>
              <p className="text-sm font-bold text-destructive">
                {contract.totalOutstanding > 0
                  ? `${formatNumber(contract.totalOutstanding)} บาท`
                  : 'ครบแล้ว'}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Contract Document Download */}
      <Card className="mb-4">
        <CardContent className="py-3">
          <Button
            variant="outline"
            className="w-full"
            asChild
          >
            <a
              href={`/api/line-oa/liff/contracts/${contract.id}/document`}
              target="_blank"
              rel="noopener noreferrer"
            >
              ดาวน์โหลดสัญญา PDF
            </a>
          </Button>
        </CardContent>
      </Card>

      {/* Pay Next Installment CTA */}
      {nextUnpaid && contract.totalOutstanding > 0 && (
        <Card className="mb-4 border-primary/20 bg-primary/5">
          <CardContent className="py-4">
            <div className="flex items-center justify-between mb-3">
              <div>
                <p className="text-sm font-medium">งวดถัดไป: งวดที่ {nextUnpaid.installmentNo}</p>
                <p className="text-xs text-muted-foreground">
                  ครบกำหนด {formatDateMedium(nextUnpaid.dueDate)}
                </p>
              </div>
              <div className="text-right">
                <p className="text-lg font-bold text-primary">
                  {formatNumber(nextUnpaid.amountDue + nextUnpaid.lateFee - nextUnpaid.amountPaid)} บาท
                </p>
                {nextUnpaid.lateFee > 0 && (
                  <p className="text-xs text-destructive">รวมค่าปรับ {formatNumber(nextUnpaid.lateFee)} บาท</p>
                )}
              </div>
            </div>
            <Button
              variant="primary"
              size="lg"
              className="w-full gap-2"
              onClick={() => handlePayClick()}
              disabled={payMutation.isPending}
            >
              <QrCode className="size-5" />
              {payMutation.isPending ? 'กำลังสร้าง QR...' : 'ชำระค่างวด (สแกน QR)'}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Early Payoff CTA */}
      {['ACTIVE', 'OVERDUE', 'DEFAULT'].includes(contract.status) && contract.totalOutstanding > 0 && (
        <div className="mb-4 text-center">
          <Button variant="outline" size="md" asChild>
            <a href={`/liff/early-payoff?lineId=${encodeURIComponent(lineId)}&contractId=${encodeURIComponent(contract.id)}`}>
              ปิดยอดก่อนกำหนด (ลดดอกเบี้ย 50%)
            </a>
          </Button>
        </div>
      )}

      {/* Payment Schedule */}
      <Card className="mb-4">
        <CardContent>
          <h2 className="text-sm font-bold mb-3">ตารางค่างวด</h2>
          <div className="space-y-2">
            {displayPayments.map((p) => {
              const dueDateStr = formatDateShortThai(p.dueDate);
              const totalAmount = p.amountDue + p.lateFee;
              const isPaid = p.status === 'PAID';
              const isOverdue = p.status === 'OVERDUE';

              return (
                <div
                  key={p.installmentNo}
                  className={`flex items-center justify-between p-3 rounded-lg ${
                    isPaid
                      ? 'bg-success/5'
                      : isOverdue
                        ? 'bg-destructive/5'
                        : 'bg-muted/50'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <span className="text-lg">{paymentStatusIcon[p.status] || '⬜'}</span>
                    <div>
                      <p className="text-sm font-medium">งวดที่ {p.installmentNo}</p>
                      <p className="text-xs text-muted-foreground">{dueDateStr}</p>
                    </div>
                  </div>
                  <div className="text-right flex items-center gap-2">
                    <div>
                      <p
                        className={`text-sm font-medium ${
                          isPaid ? 'text-success' : isOverdue ? 'text-destructive' : ''
                        }`}
                      >
                        {formatNumber(totalAmount)} บาท
                      </p>
                      {isPaid && p.paidDate && (
                        <p className="text-xs text-muted-foreground">
                          {formatDateShortThai(p.paidDate)}
                        </p>
                      )}
                      {p.lateFee > 0 && !isPaid && (
                        <p className="text-xs text-destructive">ค่าปรับ {formatNumber(p.lateFee)} บาท</p>
                      )}
                    </div>
                    {!isPaid && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-xs px-2 py-1 h-auto"
                        onClick={() => handlePayClick(p)}
                        disabled={payMutation.isPending}
                      >
                        <QrCode className="size-3" />
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {payments.length > 6 && !showAllPayments && (
            <Button
              variant="ghost"
              mode="link"
              className="w-full mt-3 text-primary"
              onClick={() => setShowAllPayments(true)}
            >
              ดูทั้งหมด ({payments.length} งวด)
              <ChevronDown className="size-4" />
            </Button>
          )}
        </CardContent>
      </Card>

      {/* Navigation Links */}
      <Card className="mb-4">
        <CardContent className="py-3 space-y-2">
          <Button variant="outline" size="md" className="w-full" asChild>
            <a href={`/liff/history${lineId ? `?lineId=${encodeURIComponent(lineId)}` : ''}`}>
              ประวัติชำระเงิน
            </a>
          </Button>
          <Button variant="outline" size="md" className="w-full" asChild>
            <a href={`/liff/profile${lineId ? `?lineId=${encodeURIComponent(lineId)}` : ''}`}>
              โปรไฟล์ของฉัน
            </a>
          </Button>
        </CardContent>
      </Card>

      {/* Legend */}
      <div className="text-center text-xs text-muted-foreground space-x-3 mb-4">
        <span>✅ ชำระแล้ว</span>
        <span>⬜ รอชำระ</span>
        <span>❌ ค้างชำระ</span>
        <span>⏳ บางส่วน</span>
      </div>

      <p className="text-center text-xs text-muted-foreground">
        BEST CHOICE - ระบบผ่อนชำระมือถือ
      </p>
    </div>
  );
}
