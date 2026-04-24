import { useState, useEffect, useRef } from 'react';
import { useParams } from 'react-router';
import { formatDateShort, formatDateTime } from '@/utils/formatters';
import { formatNumber } from '@/utils/formatters';
import {
  ChevronLeft,
  CheckCircle2,
  AlertCircle,
  Loader2,
  RefreshCw,
  ShieldCheck,
  QrCode,
  Smartphone,
  ArrowRight,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useQuery, useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { liffApi } from '@/lib/api';
import { LIFF_ERRORS } from '@/constants/liff-errors';
import { useLiffInit } from '@/hooks/useLiffInit';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';

import type { LiffPaymentLinkData as PaymentLinkData } from '@installment/shared';

interface PaymentIntentResult {
  success: boolean;
  paymentId: string;
  paymentUrl: string;
  gatewayRef: string;
  qrCodeUrl?: string;
}

interface PaymentStatusResult {
  paymentId: string;
  status: 'PENDING' | 'PAID' | 'FAILED';
  gatewayRef?: string;
  gatewayStatus?: string;
  amount: number;
  paidAt?: string;
}

type View = 'loading' | 'ready' | 'gateway-pending' | 'success' | 'failed' | 'error';

export default function LiffPayment() {
  const { token } = useParams<{ token: string }>();
  // useLiffInit restores liffIdToken from the session cache populated by a
  // prior LIFF page in the same tab. Without it, create-intent hits 401
  // because LiffTokenGuard has no X-Liff-Id-Token header to verify.
  const { lineId: hookLineId, loading: authLoading } = useLiffInit();
  const queryLineId =
    new URLSearchParams(window.location.search).get('lineId') || hookLineId || '';

  const [view, setView] = useState<View>('loading');
  const [errorMessage, setErrorMessage] = useState('');
  const [activePaymentId, setActivePaymentId] = useState<string | null>(null);
  const [gatewayRef, setGatewayRef] = useState<string | null>(null);
  const [pollCount, setPollCount] = useState(0);
  const [expirySeconds, setExpirySeconds] = useState<number | null>(null);

  // ─── Fetch payment link data (waits for auth to avoid 401) ───
  const { data } = useQuery<PaymentLinkData | null>({
    queryKey: ['liff-payment', token],
    queryFn: async () => {
      const { data: result } = await liffApi.get(`/line-oa/pay/${token}`);

      if (result?.expiresAt) {
        const expiresMs = new Date(result.expiresAt).getTime();
        if (Number.isFinite(expiresMs) && expiresMs <= Date.now()) {
          setErrorMessage(LIFF_ERRORS.LINK_EXPIRED);
          setView('error');
          return null;
        }
      }

      if (!result || result.status === 'EXPIRED') {
        setErrorMessage(LIFF_ERRORS.LINK_EXPIRED);
        setView('error');
        return null;
      }
      if (result.status === 'USED') {
        setErrorMessage(LIFF_ERRORS.LINK_USED);
        setView('error');
        return null;
      }
      if (result.valid) {
        setView('ready');
        return result;
      }
      setErrorMessage(LIFF_ERRORS.LINK_INVALID);
      setView('error');
      return null;
    },
    enabled: !!token && !authLoading,
  });

  // ─── QR/Payment link expiry countdown ───
  useEffect(() => {
    if (!data?.expiresAt || view !== 'ready') {
      setExpirySeconds(null);
      return;
    }
    const expiresMs = new Date(data.expiresAt).getTime();
    const tick = () => {
      const remaining = Math.max(0, Math.floor((expiresMs - Date.now()) / 1000));
      setExpirySeconds(remaining);
      if (remaining <= 0) {
        setErrorMessage(LIFF_ERRORS.LINK_EXPIRED);
        setView('error');
      }
    };
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [data?.expiresAt, view]);

  // ─── Poll payment status with exponential backoff ───
  const MAX_POLL_ATTEMPTS = 60;
  const pollInterval = pollCount < 10 ? 3000 : pollCount < 30 ? 5000 : 10000;
  const isPolling = !!activePaymentId && view === 'gateway-pending' && pollCount < MAX_POLL_ATTEMPTS;

  const { data: paymentStatus, isError: pollErrored } = useQuery<PaymentStatusResult>({
    queryKey: ['payment-status', activePaymentId],
    queryFn: async () => {
      setPollCount((c) => c + 1);
      const { data: result } = await liffApi.get(`/paysolutions/status/${activePaymentId}`);
      return result;
    },
    enabled: isPolling,
    refetchInterval: isPolling ? pollInterval : false,
    refetchIntervalInBackground: false,
    retry: 3,
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
  });

  const online = useOnlineStatus();
  const wasOffline = useRef(false);
  useEffect(() => {
    if (!online) {
      wasOffline.current = true;
      return;
    }
    if (wasOffline.current) {
      toast.success('เชื่อมต่ออินเทอร์เน็ตอีกครั้งแล้ว');
      wasOffline.current = false;
    }
  }, [online]);

  useEffect(() => {
    if (!paymentStatus) return;
    if (paymentStatus.status === 'PAID') {
      setView('success');
      toast.success('ชำระเงินสำเร็จ!');
    } else if (paymentStatus.status === 'FAILED') {
      setView('failed');
    }
  }, [paymentStatus]);

  const pollTimedOut =
    !!activePaymentId && view === 'gateway-pending' && pollCount >= MAX_POLL_ATTEMPTS;

  // ─── Create payment intent mutation ───
  const createIntentMutation = useMutation({
    mutationFn: async () => {
      if (!data) throw new Error(LIFF_ERRORS.PAYMENT_DATA_NOT_FOUND);
      const payload = {
        contractId: data.contract.id,
        amount: Number(data.amount),
        description: `ชำระค่างวด สัญญา ${data.contract.contractNumber}`,
        lineId: queryLineId || undefined,
        // Only pass installmentNo for single-installment payments. Early-payoff
        // links cover multiple installments — backend validates amount against
        // the single linked installment's outstanding when installmentNo is
        // present and would reject the full payoff as "ยอดไม่ตรง".
        installmentNo: isMultiInstallment ? undefined : data.payment?.installmentNo,
      };
      const { data: result } = await liffApi.post<PaymentIntentResult>(
        '/paysolutions/create-intent',
        payload,
      );
      return result;
    },
    onSuccess: (result) => {
      setActivePaymentId(result.paymentId);
      setGatewayRef(result.gatewayRef);
      if (result.paymentUrl) {
        setView('gateway-pending');
        window.location.href = result.paymentUrl;
      } else {
        toast.error(LIFF_ERRORS.PAYMENT_LINK_MISSING);
      }
    },
    onError: (err: Error) => {
      toast.error(err.message || LIFF_ERRORS.PAYMENT_CREATE_FAILED);
    },
  });

  useEffect(() => {
    if (!token) {
      setErrorMessage(LIFF_ERRORS.LINK_INVALID);
      setView('error');
    }
  }, [token]);

  const amount = data ? Number(data.amount) : 0;
  const payment = data?.payment;
  const dueDate = payment ? formatDateShort(payment.dueDate) : '-';
  // Early-payoff heuristic: link amount exceeds the linked installment's
  // outstanding by more than one installment's worth → multi-installment
  // close. Lets the UI hide the "งวดที่ 1" line that would otherwise
  // mislead a customer paying the full payoff.
  const isMultiInstallment =
    !!payment &&
    amount > Number(payment.amountDue) + Number(payment.lateFee ?? 0) + 0.5;
  const customerName = data?.contract.customer.name ?? '';
  const customerInitial = customerName.charAt(0) || '?';

  const handleGatewayPay = () => createIntentMutation.mutate();
  const handleRetry = () => {
    setActivePaymentId(null);
    setGatewayRef(null);
    setPollCount(0);
    setView('ready');
  };

  // ── Loading ──────────────────────────────────────────
  if (view === 'loading' || authLoading) {
    return (
      <Shell>
        <div className="px-5 pt-6 space-y-4">
          <Skeleton className="h-24 w-full rounded-[22px]" />
          <Skeleton className="h-48 w-full rounded-[22px]" />
          <Skeleton className="h-14 w-full rounded-[20px]" />
        </div>
      </Shell>
    );
  }

  // ── Error ────────────────────────────────────────────
  if (view === 'error') {
    return (
      <Shell>
        <TopBar title="ชำระเงิน" initial={customerInitial} />
        <section className="relative z-[1] px-5 pt-10 pb-8 flex flex-col items-center text-center">
          <div className="grid h-20 w-20 place-items-center rounded-full bg-destructive/10 border border-destructive/30 mb-5">
            <AlertCircle className="size-10 text-destructive" strokeWidth={1.5} />
          </div>
          <h2 className="text-[18px] font-semibold text-foreground tracking-tight leading-snug">
            ไม่สามารถดำเนินการได้
          </h2>
          <p className="mt-2 text-[13px] text-muted-foreground leading-snug max-w-[280px]">
            {errorMessage}
          </p>
          <Button variant="outline" size="lg" className="mt-8 w-full max-w-xs" asChild>
            <a
              href={`/liff/contract${queryLineId ? `?lineId=${encodeURIComponent(queryLineId)}` : ''}`}
            >
              กลับไปดูสัญญา
            </a>
          </Button>
        </section>
      </Shell>
    );
  }

  // ── Payment Failed ───────────────────────────────────
  if (view === 'failed') {
    return (
      <Shell>
        <TopBar title="ชำระเงิน" initial={customerInitial} />
        <section className="relative z-[1] px-5 pt-10 pb-8 flex flex-col items-center text-center">
          <div className="grid h-20 w-20 place-items-center rounded-full bg-destructive/10 border border-destructive/30 mb-5">
            <AlertCircle className="size-10 text-destructive" strokeWidth={1.5} />
          </div>
          <h2 className="text-[18px] font-semibold text-foreground tracking-tight leading-snug">
            การชำระเงินไม่สำเร็จ
          </h2>
          <div className="mt-4 w-full max-w-xs rounded-[18px] border border-amber-200 bg-amber-50 p-4 text-left text-[12px] text-amber-800 leading-snug space-y-1">
            <p className="font-semibold">สาเหตุที่เป็นไปได้:</p>
            <p>· ยอดเงินในบัญชีไม่เพียงพอ</p>
            <p>· QR Code หมดอายุ (ใช้ได้ 30 นาที)</p>
            <p>· การเชื่อมต่อขัดข้อง ลองใหม่อีกครั้ง</p>
          </div>
          {gatewayRef && (
            <p className="mt-3 text-[11px] text-muted-foreground leading-snug">
              เลขอ้างอิง: <span className="font-mono">{gatewayRef}</span>
            </p>
          )}
          <div className="mt-8 w-full max-w-xs space-y-2">
            <Button variant="primary" size="lg" className="w-full" onClick={handleRetry}>
              <RefreshCw className="size-4 mr-2" strokeWidth={2} />
              ลองอีกครั้ง
            </Button>
            <Button variant="ghost" size="lg" className="w-full text-muted-foreground" asChild>
              <a
                href={`/liff/contract${queryLineId ? `?lineId=${encodeURIComponent(queryLineId)}` : ''}`}
              >
                กลับไปดูสัญญา
              </a>
            </Button>
          </div>
        </section>
      </Shell>
    );
  }

  // ── Success ──────────────────────────────────────────
  if (view === 'success') {
    return (
      <Shell>
        <TopBar title="ชำระเงิน" initial={customerInitial} />
        <section className="relative z-[1] px-5 pt-10 pb-8 flex flex-col items-center text-center">
          <div
            className="relative grid h-24 w-24 place-items-center rounded-full mb-5"
            style={{
              background:
                'radial-gradient(circle, rgb(16 185 129 / 0.18) 0%, rgb(16 185 129 / 0.04) 70%)',
            }}
          >
            <div className="grid h-16 w-16 place-items-center rounded-full bg-emerald-500 text-white shadow-lg shadow-emerald-500/30">
              <CheckCircle2 className="size-9" strokeWidth={2} />
            </div>
          </div>
          <h2 className="text-[20px] font-semibold text-foreground tracking-tight leading-snug">
            ชำระเงินสำเร็จ
          </h2>
          <p className="mt-2 text-[13px] text-muted-foreground leading-snug">
            ระบบบันทึกการชำระเรียบร้อยแล้ว
          </p>

          <div className="mt-6 w-full max-w-xs rounded-[22px] border border-border/50 bg-card p-5 shadow-sm space-y-3 text-left">
            <Row label="สัญญา" value={data?.contract.contractNumber ?? '-'} mono />
            {payment && !isMultiInstallment && (
              <Row label="งวดที่" value={`${payment.installmentNo}`} />
            )}
            <Row label="ยอดที่ชำระ" value={`฿${formatNumber(amount)}`} emphasize />
            {gatewayRef && <Row label="เลขอ้างอิง" value={gatewayRef} mono />}
            {paymentStatus?.paidAt && (
              <Row label="เวลา" value={formatDateTime(paymentStatus.paidAt)} />
            )}
          </div>

          <div className="mt-6 w-full max-w-xs space-y-2">
            <Button variant="outline" size="lg" className="w-full" asChild>
              <a
                href={`/liff/contract${queryLineId ? `?lineId=${encodeURIComponent(queryLineId)}` : ''}`}
              >
                ดูสัญญาของฉัน
              </a>
            </Button>
          </div>
        </section>
      </Shell>
    );
  }

  // ── Gateway Pending ──────────────────────────────────
  if (view === 'gateway-pending') {
    return (
      <Shell>
        <TopBar title="รอการชำระเงิน" initial={customerInitial} />
        <section className="relative z-[1] px-5 pt-10 pb-8 flex flex-col items-center text-center">
          <Loader2 className="size-12 text-emerald-600 animate-spin mb-4" strokeWidth={1.75} />
          <h2 className="text-[18px] font-semibold text-foreground tracking-tight leading-snug">
            กำลังรอการชำระเงิน
          </h2>
          <p className="mt-2 text-[13px] text-muted-foreground leading-snug">
            ยอดชำระ{' '}
            <span className="font-mono font-semibold text-emerald-700 tabular-nums">
              ฿{formatNumber(amount)}
            </span>
          </p>
          <p className="mt-2 text-[11.5px] text-muted-foreground/80 leading-snug max-w-[280px]">
            หากชำระเงินแล้ว กรุณารอสักครู่ ระบบกำลังตรวจสอบอัตโนมัติ
          </p>
          {gatewayRef && (
            <p className="mt-3 text-[11px] text-muted-foreground leading-snug">
              เลขอ้างอิง: <span className="font-mono">{gatewayRef}</span>
            </p>
          )}

          {isPolling && (!online || pollErrored) && (
            <div className="mt-4 flex items-center gap-2 rounded-[14px] border border-border/50 bg-muted/60 px-3 py-2 text-[12px] text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" strokeWidth={2} />
              <span>
                {!online ? 'ไม่มีอินเทอร์เน็ต — กำลังรอสัญญาณ' : 'เชื่อมต่อไม่เสถียร กำลังลองใหม่'}
              </span>
            </div>
          )}

          {pollTimedOut && (
            <div className="mt-5 w-full max-w-xs rounded-[18px] border border-amber-200 bg-amber-50 p-4 text-left text-[12px] text-amber-800 leading-snug">
              <p className="font-semibold mb-1">หมดเวลาตรวจสอบอัตโนมัติ</p>
              <p className="mb-2">หากชำระแล้ว ระบบจะยืนยันให้ภายใน 5 นาทีผ่าน LINE</p>
              <p>หากยังไม่ได้รับการยืนยัน ติดต่อ 063-134-6356</p>
            </div>
          )}

          <div className="mt-6 w-full max-w-xs space-y-2">
            {pollTimedOut && (
              <Button variant="outline" size="lg" className="w-full" onClick={() => setPollCount(0)}>
                <RefreshCw className="size-4 mr-2" strokeWidth={2} />
                ตรวจสอบอีกครั้ง
              </Button>
            )}
            <Button
              variant="ghost"
              size="lg"
              className="w-full text-muted-foreground"
              onClick={handleRetry}
            >
              ยกเลิกและทำรายการใหม่
            </Button>
            <Button variant="ghost" size="lg" className="w-full text-muted-foreground" asChild>
              <a
                href={`/liff/contract${queryLineId ? `?lineId=${encodeURIComponent(queryLineId)}` : ''}`}
              >
                กลับไปดูสัญญา
              </a>
            </Button>
          </div>
        </section>
      </Shell>
    );
  }

  // ── Ready (main view) ────────────────────────────────
  if (!data) return null;

  return (
    <Shell>
      <TopBar title="ชำระเงิน" initial={customerInitial} />

      <section className="relative z-[1] px-5 pt-6">
        <div className="text-xs text-muted-foreground leading-snug">สวัสดี</div>
        <div className="text-[17px] font-medium text-foreground tracking-tight leading-snug">
          คุณ{customerName}
        </div>
      </section>

      {/* Hero — emerald chamber, mirrors LiffEarlyPayoff's hero with a
          payment-confirm framing (green vs the discount-amber elsewhere) */}
      <section className="relative z-[1] px-5 pt-7">
        <div
          className="absolute pointer-events-none animate-[float_3.5s_ease-in-out_infinite]"
          style={{
            top: '10px',
            left: '-40px',
            width: '220px',
            height: '220px',
            borderRadius: '50%',
            filter: 'blur(60px)',
            opacity: 0.5,
            background: 'radial-gradient(circle, rgb(16 185 129), transparent 70%)',
          }}
        />
        <div
          className="absolute pointer-events-none animate-[float_3.5s_ease-in-out_infinite_1s]"
          style={{
            top: '60px',
            right: '-40px',
            width: '180px',
            height: '180px',
            borderRadius: '50%',
            filter: 'blur(60px)',
            opacity: 0.4,
            background: 'radial-gradient(circle, rgb(52 211 153), transparent 70%)',
          }}
        />

        <div className="relative">
          <div className="flex items-center justify-between">
            <span className="text-[10.5px] font-semibold uppercase tracking-[0.18em] text-emerald-800">
              {isMultiInstallment ? 'ยอดปิดสัญญา' : 'ยอดที่ต้องชำระ'}
            </span>
            {expirySeconds !== null && expirySeconds > 0 && (
              <span className="font-mono text-[11px] text-muted-foreground tabular-nums">
                หมดอายุใน {Math.floor(expirySeconds / 60).toString().padStart(2, '0')}:
                {(expirySeconds % 60).toString().padStart(2, '0')}
              </span>
            )}
          </div>

          <div className="mt-3 flex items-baseline gap-1.5">
            <span className="font-mono text-[22px] text-emerald-700 font-light leading-none">฿</span>
            <span
              className="font-mono font-light tabular-nums tracking-[-0.035em] text-foreground"
              style={{
                fontSize: 'clamp(38px, 13vw, 60px)',
                lineHeight: '0.95',
              }}
            >
              {formatNumber(amount)}
            </span>
            <span className="ml-2 font-mono text-xs text-muted-foreground leading-snug">บาท</span>
          </div>

          <div className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-emerald-50 border border-emerald-200 px-3 py-1.5 text-[11.5px] leading-snug text-emerald-800">
            <ShieldCheck className="size-3.5 text-emerald-600" strokeWidth={2} />
            ชำระผ่าน Pay Solutions · ปลอดภัย
          </div>

          <button
            type="button"
            className="relative mt-6 w-full overflow-hidden rounded-[20px] px-5 py-[18px] text-white active:scale-[0.985] transition-transform disabled:opacity-60"
            style={{
              background:
                'linear-gradient(135deg, rgb(16 185 129) 0%, rgb(5 150 105) 45%, rgb(6 95 70) 100%)',
              boxShadow: '0 18px 40px -12px rgb(5 150 105 / 0.55)',
            }}
            onClick={handleGatewayPay}
            disabled={createIntentMutation.isPending}
          >
            <span className="relative z-[1] flex items-center justify-between">
              <span className="flex items-center gap-2.5">
                <span className="grid h-8 w-8 place-items-center rounded-xl bg-white/20 backdrop-blur-sm">
                  {createIntentMutation.isPending ? (
                    <Loader2 className="size-[16px] animate-spin" strokeWidth={2} />
                  ) : (
                    <QrCode className="size-[16px]" strokeWidth={2} />
                  )}
                </span>
                <span className="text-[15.5px] font-semibold tracking-tight leading-snug">
                  {createIntentMutation.isPending
                    ? 'กำลังสร้างรายการ...'
                    : `สแกนจ่าย ฿${formatNumber(amount)}`}
                </span>
              </span>
              {!createIntentMutation.isPending && (
                <ArrowRight
                  className="size-5 animate-[bounce_2.4s_ease-in-out_infinite]"
                  strokeWidth={2}
                />
              )}
            </span>
          </button>
        </div>
      </section>

      {/* Section divider */}
      <div className="relative z-[1] mt-8 flex items-center gap-3 px-5">
        <span className="text-[10.5px] font-semibold uppercase tracking-[0.18em] text-muted-foreground leading-snug">
          รายละเอียด
        </span>
        <div className="h-px flex-1 bg-gradient-to-r from-border to-transparent" />
      </div>

      <section className="relative z-[1] mt-4 px-5">
        <div className="rounded-[22px] border border-border/50 bg-card p-5 shadow-sm space-y-3">
          <Row label="ลูกค้า" value={customerName} />
          <Row label="สัญญา" value={data.contract.contractNumber} mono />
          {payment && !isMultiInstallment && (
            <>
              <Row label="งวดที่" value={`${payment.installmentNo}`} />
              <Row label="ครบกำหนด" value={dueDate} />
            </>
          )}
        </div>

        <div className="mt-5 flex items-start gap-2.5 rounded-[18px] border border-border/40 bg-muted/40 px-4 py-3">
          <div className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-emerald-50 text-emerald-600">
            <Smartphone className="size-3.5" strokeWidth={2} />
          </div>
          <div className="text-[11.5px] text-muted-foreground leading-snug">
            รองรับ PromptPay, บัตรเครดิต/เดบิต, Mobile Banking ·{' '}
            <span className="text-foreground font-medium">ระบบยืนยันการชำระอัตโนมัติ</span>
          </div>
        </div>
      </section>

      <div className="relative z-[1] mt-6 px-5">
        <a
          href={`/liff/contract${queryLineId ? `?lineId=${encodeURIComponent(queryLineId)}` : ''}`}
          className="flex items-center justify-center gap-1.5 text-[12.5px] text-muted-foreground hover:text-foreground transition-colors py-3 leading-snug"
        >
          <ChevronLeft className="size-3.5" strokeWidth={2} />
          กลับไปดูสัญญา
        </a>
        <p className="text-center text-[10px] text-muted-foreground/70 tracking-[0.15em] uppercase mt-4 leading-snug">
          Best Choice · ระบบผ่อนชำระ
        </p>
      </div>
    </Shell>
  );
}

// ─── UI primitives (shared DNA with LiffEarlyPayoff) ───────────────────

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="relative min-h-screen overflow-x-hidden"
      style={{ backgroundColor: '#fafaf7' }}
    >
      <div
        className="fixed inset-0 pointer-events-none z-0"
        style={{
          background:
            'radial-gradient(600px 400px at 10% -5%, rgb(16 185 129 / 0.10), transparent 60%),' +
            'radial-gradient(500px 380px at 100% 20%, rgb(52 211 153 / 0.07), transparent 65%),' +
            'radial-gradient(400px 320px at 50% 100%, rgb(99 102 241 / 0.05), transparent 60%)',
        }}
      />
      <div className="relative mx-auto max-w-[430px] pb-16">{children}</div>
    </div>
  );
}

function TopBar({ title, initial }: { title: string; initial: string }) {
  return (
    <header
      className="sticky top-0 z-20 flex items-center justify-between px-5 py-3.5 backdrop-blur-xl border-b border-border/50"
      style={{ backgroundColor: 'rgb(250 250 247 / 0.85)' }}
    >
      <button
        type="button"
        aria-label="ย้อนกลับ"
        className="grid h-9 w-9 place-items-center rounded-full text-foreground hover:bg-accent -ml-1.5"
        onClick={() => window.history.back()}
      >
        <ChevronLeft className="size-5" strokeWidth={1.75} />
      </button>
      <div className="text-[13px] font-medium text-foreground tracking-tight leading-snug">
        {title}
      </div>
      <div className="relative -mr-1.5">
        <div
          className="grid h-9 w-9 place-items-center rounded-full text-[12px] font-semibold text-white shadow-lg shadow-emerald-500/30"
          style={{
            background:
              'linear-gradient(135deg, rgb(52 211 153) 0%, rgb(16 185 129) 60%, rgb(5 150 105) 100%)',
          }}
        >
          {initial}
        </div>
      </div>
    </header>
  );
}

function Row({
  label,
  value,
  mono,
  emphasize,
}: {
  label: string;
  value: string;
  mono?: boolean;
  emphasize?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between">
      <span className="text-[12.5px] text-muted-foreground leading-snug">{label}</span>
      <span
        className={`tabular-nums tracking-tight leading-snug ${mono ? 'font-mono' : ''} ${
          emphasize
            ? 'text-[15px] font-semibold text-emerald-700'
            : 'text-[13.5px] font-medium text-foreground'
        }`}
      >
        {value}
      </span>
    </div>
  );
}
