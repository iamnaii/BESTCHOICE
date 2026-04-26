import { useState, useEffect } from 'react';
import { useLiffInit } from '@/hooks/useLiffInit';
import { liffApi, withLiffToken } from '@/lib/api';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  QrCode,
  ChevronDown,
  ChevronLeft,
  Calendar,
  CheckCircle2,
  Smartphone,
  Download,
  Percent,
  Lock,
  ArrowRight,
  CircleDot,
  Clock,
  AlertCircle,
  CheckCheck,
} from 'lucide-react';
import { formatNumber, formatDateMedium, formatDateShortThai } from '@/utils/formatters';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { LIFF_ERRORS } from '@/constants/liff-errors';

import type {
  LiffPayment as Payment,
  LiffContract as Contract,
  LiffContractResponse as ContractData,
} from '@installment/shared';

const statusBadge: Record<string, { label: string; dot: string; ring: string; text: string }> = {
  ACTIVE: {
    label: 'ปกติ',
    dot: 'bg-emerald-500',
    ring: 'bg-emerald-50 border-emerald-200',
    text: 'text-emerald-800',
  },
  OVERDUE: {
    label: 'ค้างชำระ',
    dot: 'bg-destructive',
    ring: 'bg-destructive/10 border-destructive/30',
    text: 'text-destructive',
  },
  DEFAULT: {
    label: 'ผิดนัด',
    dot: 'bg-destructive',
    ring: 'bg-destructive/10 border-destructive/30',
    text: 'text-destructive',
  },
  COMPLETED: {
    label: 'ครบแล้ว',
    dot: 'bg-muted-foreground',
    ring: 'bg-muted border-border',
    text: 'text-muted-foreground',
  },
  EARLY_PAYOFF: {
    label: 'ปิดก่อนกำหนด',
    dot: 'bg-indigo-500',
    ring: 'bg-indigo-50 border-indigo-200',
    text: 'text-indigo-700',
  },
};

const dunningLabel: Record<string, string | null> = {
  NONE: null,
  REMINDER: null,
  NOTICE: 'กรุณาชำระเร็วที่สุด',
  FINAL_WARNING: 'แจ้งเตือนสุดท้าย',
  LEGAL_ACTION: 'เข้าสู่ขั้นตอนทางกฎหมาย',
};

// (Audit finding P2) Compute days remaining in Asia/Bangkok regardless of the
// customer's device timezone. Previously `setHours(0,...)` snapped to device
// local time, so a customer in UTC saw "ครบกำหนดพรุ่งนี้" when it was actually
// today in Bangkok (or vice versa). Use the en-CA YYYY-MM-DD locale trick to
// extract the calendar date in Asia/Bangkok, then diff in whole days.
function daysUntil(dateStr: string | Date): number {
  const tz = 'Asia/Bangkok';
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const dueParts = fmt.format(new Date(dateStr));
  const nowParts = fmt.format(new Date());
  const due = new Date(`${dueParts}T00:00:00+07:00`);
  const now = new Date(`${nowParts}T00:00:00+07:00`);
  return Math.round((due.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

export default function LiffContract() {
  const { lineId, loading, error } = useLiffInit();
  const [selectedContract, setSelectedContract] = useState(0);
  const [showAllPayments, setShowAllPayments] = useState(false);
  const queryClient = useQueryClient();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const ref = params.get('ref');
    if (!ref) return;
    window.history.replaceState({}, '', window.location.pathname);

    let attempts = 0;
    const maxAttempts = 20;
    const pollId = setInterval(async () => {
      attempts++;
      try {
        const { data: status } = await liffApi.get(`/paysolutions/status/${ref}`);
        if (status.status === 'PAID') {
          clearInterval(pollId);
          toast.success('ชำระเงินสำเร็จ!');
          // (Audit finding C1) Without this, the contract list query stays
          // stale and the UI still shows the installment as unpaid even after
          // the gateway confirmed PAID — customer thinks the payment failed
          // and re-pays.
          queryClient.invalidateQueries({ queryKey: ['liff-contracts', lineId] });
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
  }, [lineId, queryClient]);

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
    if (consentData && !consentData.consent) setShowConsent(true);
  }, [consentData]);

  const consentMutation = useMutation({
    mutationFn: async () => {
      await liffApi.post('/line-oa/liff/consent', { consent: true });
    },
    onSuccess: () => setShowConsent(false),
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

  if (loading || dataLoading) {
    return (
      <div className="min-h-screen bg-background p-4 space-y-4">
        <Skeleton className="h-12 w-full rounded-xl" />
        <Skeleton className="h-52 w-full rounded-2xl" />
        <Skeleton className="h-28 w-full rounded-2xl" />
        <Skeleton className="h-44 w-full rounded-2xl" />
      </div>
    );
  }

  const errorMsg = error || (dataError as Error)?.message;
  if (errorMsg) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="max-w-md w-full">
          <CardContent className="text-center py-10">
            <AlertCircle className="mx-auto size-12 text-destructive mb-4" strokeWidth={1.5} />
            <h2 className="text-lg font-bold mb-2">ไม่สามารถดำเนินการได้</h2>
            <p className="text-muted-foreground text-sm">{errorMsg}</p>
            {errorMsg?.includes('ลงทะเบียน') && (
              <Button variant="primary" size="lg" className="mt-6" asChild>
                <a href={`/liff/register${lineId ? `?lineId=${encodeURIComponent(lineId)}` : ''}`}>
                  ลงทะเบียนเลย
                </a>
              </Button>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!data || data.contracts.length === 0) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="max-w-md w-full">
          <CardContent className="text-center py-10">
            <Smartphone className="mx-auto size-12 text-muted-foreground mb-4" strokeWidth={1.5} />
            <h2 className="text-lg font-bold mb-2">ไม่มีสัญญา</h2>
            <p className="text-muted-foreground text-sm leading-snug">
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
  const nextUnpaid = payments.find((p) => p.status !== 'PAID');
  const paidCount = payments.filter((p) => p.status === 'PAID').length;
  const totalCount = contract.totalMonths;
  const progressOffset = 283 * (1 - paidCount / totalCount);
  const daysOverdue = (contract as Contract & { daysOverdue?: number }).daysOverdue ?? 0;
  const stageLabel = dunningLabel[(contract as Contract & { dunningStage?: string }).dunningStage ?? 'NONE'];
  const status = statusBadge[contract.status] ?? statusBadge.ACTIVE;

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

  const nextDue = nextUnpaid ? daysUntil(nextUnpaid.dueDate) : 0;
  const nextAmount = nextUnpaid ? nextUnpaid.amountDue + nextUnpaid.lateFee - nextUnpaid.amountPaid : 0;
  const customerInitial = data.customer.name?.charAt(0) ?? '?';

  return (
    <div className="relative min-h-screen overflow-x-hidden" style={{ backgroundColor: '#fafaf7' }}>
      {/* Background mesh */}
      <div
        className="fixed inset-0 pointer-events-none z-0"
        style={{
          background:
            'radial-gradient(600px 400px at 10% -5%, rgb(16 185 129 / 0.09), transparent 60%),' +
            'radial-gradient(500px 380px at 100% 20%, rgb(59 130 246 / 0.08), transparent 65%),' +
            'radial-gradient(400px 320px at 50% 100%, rgb(245 158 11 / 0.06), transparent 60%)',
        }}
      />

      <div className="relative mx-auto max-w-[430px] pb-16">
        {/* PDPA Consent Modal */}
        {showConsent && (
          <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center p-4">
            <Card className="max-w-md w-full animate-in slide-in-from-bottom-4">
              <CardContent className="py-6">
                <h2 className="text-base font-bold mb-3 leading-snug">ข้อตกลงการใช้งาน</h2>
                <div className="text-xs text-muted-foreground space-y-2 mb-4 max-h-40 overflow-y-auto leading-snug">
                  <p>
                    BEST CHOICE ขอความยินยอมในการเก็บรวบรวม ใช้ และเปิดเผยข้อมูลส่วนบุคคลของท่าน เพื่อวัตถุประสงค์ดังนี้:
                  </p>
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

        {/* Top bar */}
        <header className="sticky top-0 z-20 flex items-center justify-between px-5 py-3.5 backdrop-blur-xl border-b border-border/50" style={{ backgroundColor: 'rgb(250 250 247 / 0.85)' }}>
          <button
            type="button"
            aria-label="ย้อนกลับ"
            className="grid h-9 w-9 place-items-center rounded-full text-foreground hover:bg-accent -ml-1.5"
            onClick={() => window.history.back()}
          >
            <ChevronLeft className="size-5" strokeWidth={1.75} />
          </button>
          <div className="text-[13px] font-medium text-foreground tracking-tight leading-snug">สัญญาของฉัน</div>
          <div className="relative -mr-1.5">
            <div className="grid h-9 w-9 place-items-center rounded-full bg-gradient-to-br from-emerald-500 to-teal-600 text-[12px] font-semibold text-white shadow-lg shadow-emerald-500/30">
              {customerInitial}
            </div>
            <span className="absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full bg-emerald-500 ring-2" style={{ boxShadow: '0 0 0 2px #fafaf7' }} />
          </div>
        </header>

        {/* Greeting */}
        <section className="relative z-[1] px-5 pt-6">
          <div className="text-xs text-muted-foreground leading-snug">สวัสดี</div>
          <div className="text-[17px] font-medium text-foreground tracking-tight leading-snug">
            คุณ{data.customer.name}
          </div>
        </section>

        {/* Contract tabs (multi-contract) */}
        {data.contracts.length > 1 && (
          <section className="relative z-[1] mt-4 px-5">
            <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
              {data.contracts.map((c, i) => {
                const isActive = i === selectedContract;
                const cfg = statusBadge[c.status] ?? statusBadge.ACTIVE;
                const productLabel = c.product.split(' ').slice(0, 2).join(' ');
                return (
                  <button
                    type="button"
                    key={c.id}
                    className={`shrink-0 flex items-center gap-2 min-w-[110px] rounded-2xl border px-3 py-2 transition-colors ${
                      isActive
                        ? 'bg-foreground border-foreground text-background'
                        : 'bg-card border-border text-foreground'
                    }`}
                    onClick={() => {
                      setSelectedContract(i);
                      setShowAllPayments(false);
                    }}
                  >
                    <span className={`inline-block size-1.5 rounded-full ${cfg.dot}`} />
                    <span className="flex flex-col items-start leading-tight">
                      <span className="font-mono text-[10px] opacity-70">{c.contractNumber}</span>
                      <span className="text-xs">{productLabel}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </section>
        )}

        {/* Hero: Next payment */}
        {nextUnpaid && contract.totalOutstanding > 0 && (
          <section className="relative z-[1] px-5 pt-7">
            {/* Aurora glows */}
            <div
              className="absolute pointer-events-none animate-[float_3.5s_ease-in-out_infinite]"
              style={{
                top: '10px',
                left: '-40px',
                width: '220px',
                height: '220px',
                borderRadius: '50%',
                filter: 'blur(60px)',
                opacity: 0.55,
                background: 'radial-gradient(circle, rgb(16 185 129), transparent 70%)',
              }}
            />
            <div
              className="absolute pointer-events-none animate-[float_3.5s_ease-in-out_infinite_1s]"
              style={{
                top: '50px',
                right: '-30px',
                width: '180px',
                height: '180px',
                borderRadius: '50%',
                filter: 'blur(60px)',
                opacity: 0.5,
                background: 'radial-gradient(circle, rgb(59 130 246), transparent 70%)',
              }}
            />

            <div className="relative">
              <div className="flex items-center gap-2">
                <span className="text-[10.5px] font-semibold uppercase tracking-[0.18em] text-emerald-700">
                  งวดถัดไป
                </span>
                <span className="h-1 w-1 rounded-full bg-emerald-500" />
                <span className="text-[11px] font-semibold text-emerald-700 tracking-wide flex items-center gap-1 leading-snug">
                  <CircleDot className="size-2.5" />
                  {nextDue > 0 ? `อีก ${nextDue} วัน` : nextDue === 0 ? 'วันนี้' : `เลย ${Math.abs(nextDue)} วัน`}
                </span>
              </div>

              <div className="mt-3 flex items-baseline gap-1.5">
                <span className="font-mono text-[26px] text-emerald-600 font-light leading-none">฿</span>
                <span
                  className="font-mono font-light tabular-nums tracking-[-0.035em] text-foreground"
                  style={{ fontSize: '72px', lineHeight: '0.95' }}
                >
                  {formatNumber(nextAmount)}
                </span>
                <span className="ml-2 font-mono text-xs text-muted-foreground leading-snug">บาท</span>
              </div>

              <div className="mt-3 inline-flex items-center gap-2 rounded-full bg-card/70 backdrop-blur-sm border border-border/60 px-3 py-1.5 text-xs text-foreground shadow-sm leading-snug">
                <Calendar className="size-3 text-emerald-600" strokeWidth={1.75} />
                <span>
                  งวดที่ <span className="font-semibold">{nextUnpaid.installmentNo}</span> จาก {totalCount} ·{' '}
                  <span className="font-medium">{formatDateMedium(nextUnpaid.dueDate)}</span>
                </span>
              </div>

              {nextUnpaid.lateFee > 0 && (
                <div className="mt-2 text-[11px] text-destructive font-medium leading-snug">
                  รวมค่าปรับ {formatNumber(nextUnpaid.lateFee)} บาท
                </div>
              )}

              <button
                type="button"
                className="relative mt-6 w-full overflow-hidden rounded-[20px] px-5 py-[18px] text-white active:scale-[0.985] transition-transform disabled:opacity-60"
                style={{
                  background: 'linear-gradient(135deg, rgb(5 150 105) 0%, rgb(4 120 87) 40%, rgb(13 148 136) 100%)',
                  boxShadow: '0 18px 40px -12px rgb(5 150 105 / 0.55)',
                }}
                onClick={() => handlePayClick()}
                disabled={payMutation.isPending}
              >
                <span className="relative z-[1] flex items-center justify-between">
                  <span className="flex items-center gap-2.5">
                    <span className="grid h-8 w-8 place-items-center rounded-xl bg-white/20 backdrop-blur-sm">
                      <QrCode className="size-[17px]" strokeWidth={1.75} />
                    </span>
                    <span className="text-[15.5px] font-semibold tracking-tight leading-snug">
                      {payMutation.isPending ? 'กำลังสร้าง QR...' : 'ชำระค่างวดตอนนี้'}
                    </span>
                  </span>
                  {!payMutation.isPending && (
                    <ArrowRight
                      className="size-5 animate-[bounce_2.4s_ease-in-out_infinite]"
                      strokeWidth={2}
                    />
                  )}
                </span>
              </button>
            </div>
          </section>
        )}

        {/* Progress + Balance */}
        <section className="relative z-[1] mt-7 mx-5">
          <div className="rounded-[22px] border border-border/50 bg-card/80 backdrop-blur-sm p-5 shadow-sm grid grid-cols-[112px_1fr] gap-5 items-center">
            <div className="relative h-[112px] w-[112px]">
              <svg viewBox="0 0 112 112" className="h-full w-full -rotate-90">
                <defs>
                  <linearGradient id="ringGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor="rgb(16 185 129)" />
                    <stop offset="50%" stopColor="rgb(13 148 136)" />
                    <stop offset="100%" stopColor="rgb(59 130 246)" />
                  </linearGradient>
                </defs>
                <circle cx="56" cy="56" r="45" fill="none" stroke="currentColor" strokeWidth="6" className="text-border" />
                <circle
                  cx="56"
                  cy="56"
                  r="45"
                  fill="none"
                  stroke="url(#ringGrad)"
                  strokeWidth="6"
                  strokeLinecap="round"
                  strokeDasharray="283"
                  strokeDashoffset={progressOffset}
                  style={{ transition: 'stroke-dashoffset 1.6s cubic-bezier(0.16, 1, 0.3, 1)' }}
                />
              </svg>
              <div className="absolute inset-0 grid place-items-center">
                <div className="text-center">
                  <div className="font-mono text-[24px] font-medium leading-none text-foreground tabular-nums">
                    {paidCount}
                    <span className="text-muted-foreground font-light">/{totalCount}</span>
                  </div>
                  <div className="mt-1 text-[9px] text-muted-foreground tracking-[0.18em] uppercase font-semibold leading-snug">
                    ผ่อนแล้ว
                  </div>
                </div>
              </div>
            </div>

            <div>
              <div className="text-[10.5px] font-semibold uppercase tracking-[0.18em] text-muted-foreground leading-snug">
                ยอดคงเหลือ
              </div>
              <div className="mt-1.5 font-mono text-[24px] font-semibold text-foreground leading-none tracking-tight tabular-nums">
                ฿{formatNumber(contract.totalOutstanding)}
              </div>
              <div className="mt-2.5 flex items-center gap-2 flex-wrap">
                <span className={`relative inline-flex h-2 w-2 rounded-full ${status.dot}`}>
                  <span className={`absolute inset-0 rounded-full ${status.dot} opacity-60 animate-ping`} />
                </span>
                <span className={`text-[11.5px] font-medium ${status.text} leading-snug`}>
                  {status.label}
                </span>
                {daysOverdue > 0 && (
                  <span className="text-[11px] font-medium text-destructive leading-snug">
                    · ค้าง {daysOverdue} วัน
                  </span>
                )}
                {stageLabel && (
                  <span className="text-[11px] font-medium text-destructive leading-snug">· {stageLabel}</span>
                )}
              </div>
            </div>
          </div>
        </section>

        {/* Section divider: เกี่ยวกับสัญญา */}
        <div className="relative z-[1] mt-8 flex items-center gap-3 px-5">
          <span className="text-[10.5px] font-semibold uppercase tracking-[0.18em] text-muted-foreground leading-snug">
            เกี่ยวกับสัญญา
          </span>
          <div className="h-px flex-1 bg-gradient-to-r from-border to-transparent" />
        </div>

        {/* Contract detail card */}
        <section className="relative z-[1] mt-4 px-5">
          <div className="rounded-[22px] border border-border/50 bg-card p-5 shadow-sm">
            <div className="flex items-start gap-4">
              <div
                className="relative grid h-[56px] w-[56px] shrink-0 place-items-center rounded-2xl text-white shadow-lg shadow-indigo-500/20"
                style={{
                  background: 'linear-gradient(135deg, rgb(99 102 241) 0%, rgb(59 130 246) 60%, rgb(6 182 212) 100%)',
                }}
              >
                <Smartphone className="size-[26px]" strokeWidth={1.5} />
                <span className="absolute -top-1 -right-1 grid h-5 w-5 place-items-center rounded-full bg-emerald-500 shadow ring-2 ring-card">
                  <CheckCheck className="size-2.5 text-white" strokeWidth={3.5} />
                </span>
              </div>
              <div className="min-w-0 flex-1">
                <div className="font-semibold text-[16px] leading-snug tracking-tight text-foreground">
                  {contract.product}
                </div>
                <div className="mt-1 font-mono text-[11.5px] text-muted-foreground tracking-wide leading-snug">
                  {contract.contractNumber}
                </div>
                <div className="mt-2.5 flex items-center gap-1.5 flex-wrap">
                  <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold tracking-wide ${status.ring} ${status.text}`}>
                    <span className={`h-1 w-1 rounded-full ${status.dot}`} />
                    {status.label}
                  </span>
                  <span className="inline-flex items-center gap-1 rounded-full bg-indigo-50 border border-indigo-200 px-2 py-0.5 text-[10px] font-semibold text-indigo-700 tracking-wide">
                    {totalCount} งวด
                  </span>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Action row: PDF + early payoff */}
        <section className="relative z-[1] mt-3 px-5 grid grid-cols-[1fr_1.2fr] gap-2.5">
          <a
            href={withLiffToken(`/api/line-oa/liff/contracts/${contract.id}/document`)}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-2 rounded-2xl border border-border/50 bg-card px-3 py-3.5 text-[13px] font-medium text-foreground active:scale-[0.98] transition-transform shadow-sm leading-snug"
          >
            <Download className="size-[15px] text-indigo-700" strokeWidth={1.75} />
            สัญญาผ่อน
          </a>

          {['ACTIVE', 'OVERDUE', 'DEFAULT'].includes(contract.status) && contract.totalOutstanding > 0 ? (
            <a
              href={`/liff/early-payoff?lineId=${encodeURIComponent(lineId)}&contractId=${encodeURIComponent(contract.id)}`}
              className="relative overflow-hidden flex items-center justify-center gap-2 rounded-2xl px-3 py-3.5 text-[13px] font-semibold text-amber-950 active:scale-[0.98] transition-transform shadow-lg shadow-amber-500/25 leading-snug"
              style={{
                background: 'linear-gradient(135deg, rgb(253 230 138) 0%, rgb(251 191 36) 50%, rgb(245 158 11) 100%)',
              }}
            >
              <span className="relative z-[1] grid h-[22px] w-[22px] place-items-center rounded-md bg-amber-900 text-white">
                <Percent className="size-3" strokeWidth={3} />
              </span>
              <span className="relative z-[1]">ปิดยอด · ลดดอกเบี้ย 50%</span>
            </a>
          ) : (
            <a
              href={`/liff/history${lineId ? `?lineId=${encodeURIComponent(lineId)}` : ''}`}
              className="flex items-center justify-center gap-2 rounded-2xl border border-border/50 bg-card px-3 py-3.5 text-[13px] font-medium text-foreground active:scale-[0.98] transition-transform shadow-sm leading-snug"
            >
              <Clock className="size-[15px] text-indigo-700" strokeWidth={1.75} />
              ประวัติชำระเงิน
            </a>
          )}
        </section>

        {/* Schedule section header */}
        <div className="relative z-[1] mt-9 flex items-center gap-3 px-5">
          <span className="text-[10.5px] font-semibold uppercase tracking-[0.18em] text-muted-foreground leading-snug">
            ตารางชำระเงิน
          </span>
          <div className="h-px flex-1 bg-gradient-to-r from-border to-transparent" />
          <span className="text-[11px] font-mono font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2 py-0.5 tabular-nums leading-snug">
            {paidCount} / {totalCount}
          </span>
        </div>

        {/* Schedule timeline */}
        <section className="relative z-[1] mt-4 mx-5">
          <div className="rounded-[22px] border border-border/50 bg-card p-4 shadow-sm">
            <ol className="relative">
              <div
                className="absolute left-[5.5px] top-3 bottom-3 w-px bg-gradient-to-b from-emerald-300 via-border to-border"
                aria-hidden="true"
              />

              {displayPayments.map((p) => {
                const isPaid = p.status === 'PAID';
                const isOverdue = p.status === 'OVERDUE';
                const isCurrent = p === nextUnpaid;
                const totalAmount = p.amountDue + p.lateFee;

                let dotClass = 'border-2 border-border bg-card';
                if (isPaid) dotClass = 'border-2 border-emerald-600 bg-emerald-600';
                else if (isOverdue) dotClass = 'border-2 border-destructive bg-card';
                else if (isCurrent) dotClass = 'border-2 border-emerald-600 bg-card';

                const dotShadow = isCurrent ? '0 0 0 5px rgb(16 185 129 / 0.15)' : undefined;

                return (
                  <li
                    key={p.installmentNo}
                    className="relative pl-7 py-2.5 flex items-center justify-between gap-3"
                  >
                    <span
                      className={`absolute left-0 top-1/2 -translate-y-1/2 size-3 rounded-full z-[1] ${dotClass}`}
                      style={dotShadow ? { boxShadow: dotShadow } : undefined}
                    />

                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <span
                        className={`text-[13px] leading-snug ${
                          isPaid ? 'text-muted-foreground' : isOverdue ? 'text-destructive font-semibold' : 'text-foreground font-semibold'
                        }`}
                      >
                        งวดที่ {p.installmentNo}
                      </span>
                      <span className="text-[11px] text-muted-foreground leading-snug">
                        {formatDateShortThai(p.dueDate)}
                      </span>
                      {isCurrent && (
                        <span
                          className="rounded-full text-white px-2 py-0.5 text-[9.5px] font-semibold tracking-wide shadow-sm leading-snug"
                          style={{ background: 'linear-gradient(90deg, rgb(16 185 129), rgb(13 148 136))' }}
                        >
                          ถึงกำหนด
                        </span>
                      )}
                      {isPaid && (
                        <CheckCircle2 className="size-3.5 text-emerald-600" strokeWidth={2} />
                      )}
                      {isOverdue && !isCurrent && (
                        <span className="rounded-full bg-destructive/10 text-destructive px-2 py-0.5 text-[9.5px] font-semibold leading-snug">
                          เลย {p.lateFee > 0 ? formatNumber(p.lateFee) + ' บาท' : 'กำหนด'}
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <span
                        className={`font-mono text-[13px] tabular-nums leading-snug ${
                          isPaid
                            ? 'text-muted-foreground line-through'
                            : isOverdue
                              ? 'text-destructive font-semibold'
                              : isCurrent
                                ? 'text-foreground font-semibold'
                                : 'text-muted-foreground'
                        }`}
                      >
                        ฿{formatNumber(totalAmount)}
                      </span>
                      {!isPaid && !isCurrent && (
                        <button
                          type="button"
                          className="grid h-7 w-7 place-items-center rounded-lg border border-border/70 bg-card text-muted-foreground hover:text-foreground hover:border-border active:scale-95 transition"
                          aria-label={`ชำระงวดที่ ${p.installmentNo}`}
                          onClick={() => handlePayClick(p)}
                          disabled={payMutation.isPending}
                        >
                          <QrCode className="size-3.5" strokeWidth={1.75} />
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}

              {payments.length > 6 && (
                <li className="relative pl-7 pt-3">
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 text-xs font-medium text-indigo-600 hover:text-indigo-700 leading-snug"
                    onClick={() => setShowAllPayments(!showAllPayments)}
                  >
                    {showAllPayments ? 'ย่อรายการ' : `แสดงอีก ${payments.length - 6} งวด`}
                    <ChevronDown
                      className={`size-3 transition-transform ${showAllPayments ? 'rotate-180' : ''}`}
                    />
                  </button>
                </li>
              )}
            </ol>
          </div>
        </section>

        {/* Secondary navigation */}
        <section className="relative z-[1] mt-4 px-5 grid grid-cols-2 gap-2.5">
          <a
            href={`/liff/history${lineId ? `?lineId=${encodeURIComponent(lineId)}` : ''}`}
            className="flex items-center justify-center gap-1.5 rounded-2xl border border-border/50 bg-card px-3 py-2.5 text-[12px] font-medium text-muted-foreground hover:text-foreground active:scale-[0.98] transition leading-snug"
          >
            <Clock className="size-3.5" strokeWidth={1.75} />
            ประวัติชำระเงิน
          </a>
          <a
            href={`/liff/profile${lineId ? `?lineId=${encodeURIComponent(lineId)}` : ''}`}
            className="flex items-center justify-center gap-1.5 rounded-2xl border border-border/50 bg-card px-3 py-2.5 text-[12px] font-medium text-muted-foreground hover:text-foreground active:scale-[0.98] transition leading-snug"
          >
            <Smartphone className="size-3.5" strokeWidth={1.75} />
            โปรไฟล์ของฉัน
          </a>
        </section>

        {/* Trust footer */}
        <footer className="relative z-[1] mt-10 px-5">
          <div
            className="rounded-2xl px-4 py-3.5 flex items-center justify-between"
            style={{
              background: 'linear-gradient(135deg, rgb(10 13 18) 0%, rgb(42 47 57) 100%)',
            }}
          >
            <div className="flex items-center gap-2.5 text-white/80">
              <span className="grid h-7 w-7 place-items-center rounded-lg bg-emerald-500/20 text-emerald-400">
                <Lock className="size-3.5" strokeWidth={2} />
              </span>
              <div>
                <div className="text-[11px] font-semibold text-white tracking-wide leading-snug">
                  เข้ารหัส SSL
                </div>
                <div className="text-[9.5px] text-white/50 tracking-wider uppercase leading-snug">
                  ปลอดภัย 100%
                </div>
              </div>
            </div>
            <div className="text-right">
              <div className="text-[9px] text-white/40 tracking-[0.2em] uppercase font-semibold leading-snug">
                Best Choice
              </div>
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
}
