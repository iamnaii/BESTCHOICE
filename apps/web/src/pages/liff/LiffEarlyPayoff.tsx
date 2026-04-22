import { useLiffInit } from '@/hooks/useLiffInit';
import { liffApi } from '@/lib/api';
import { useQuery, useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  ChevronLeft,
  ChevronRight,
  Percent,
  CheckCircle2,
  Smartphone,
  Sparkles,
  ArrowRight,
  ShieldCheck,
} from 'lucide-react';
import { formatNumber } from '@/utils/formatters';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { LIFF_ERRORS } from '@/constants/liff-errors';

import type {
  LiffEarlyPayoffQuote as EarlyPayoffQuote,
  LiffContractResponse,
} from '@installment/shared';

const PAYOFF_ELIGIBLE_STATUSES = ['ACTIVE', 'OVERDUE', 'DEFAULT'];

export default function LiffEarlyPayoff() {
  const { lineId, loading, error } = useLiffInit();

  const params = new URLSearchParams(window.location.search);
  const urlContractId = params.get('contractId') || '';

  const { data: contractList, isLoading: listLoading } = useQuery<LiffContractResponse>({
    queryKey: ['liff-contracts', lineId],
    queryFn: async () => {
      const { data: result } = await liffApi.get(
        `/line-oa/liff/contracts?lineId=${encodeURIComponent(lineId!)}`,
      );
      return result;
    },
    enabled: !!lineId,
    staleTime: 60_000,
  });

  const eligibleContracts = (contractList?.contracts ?? []).filter(
    (c) => PAYOFF_ELIGIBLE_STATUSES.includes(c.status) && c.totalOutstanding > 0,
  );
  const contractId =
    urlContractId || (eligibleContracts.length === 1 ? eligibleContracts[0].id : '');

  const {
    data: quote,
    isLoading: quoteLoading,
    error: quoteError,
  } = useQuery<EarlyPayoffQuote>({
    queryKey: ['liff-early-payoff-quote', lineId, contractId],
    queryFn: async () => {
      if (!contractId) throw new Error(LIFF_ERRORS.CONTRACT_ID_MISSING);
      const { data: result } = await liffApi.get(
        `/line-oa/liff/early-payoff-quote?lineId=${encodeURIComponent(lineId!)}&contractId=${encodeURIComponent(contractId)}`,
      );
      return result;
    },
    enabled: !!lineId && !!contractId,
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

  const customerName = quote?.customerName ?? contractList?.customer?.name ?? '';
  const customerInitial = customerName.charAt(0) || '?';

  // ─── Loading ──────────────────────────────────────────
  if (loading || listLoading || (contractId && quoteLoading)) {
    return (
      <Shell>
        <div className="px-5 pt-6 space-y-4">
          <Skeleton className="h-24 w-full rounded-[22px]" />
          <Skeleton className="h-64 w-full rounded-[22px]" />
          <Skeleton className="h-14 w-full rounded-[20px]" />
        </div>
      </Shell>
    );
  }

  // ─── Picker: no contractId + multiple eligible ────────
  if (!contractId && eligibleContracts.length > 1) {
    return (
      <Shell>
        <TopBar title="เลือกสัญญาปิดยอด" initial={customerInitial} />

        <section className="relative z-[1] px-5 pt-6">
          <div className="text-xs text-muted-foreground leading-snug">สวัสดี</div>
          <div className="text-[17px] font-medium text-foreground tracking-tight leading-snug">
            คุณ{customerName}
          </div>
        </section>

        <section className="relative z-[1] px-5 pt-6">
          <div className="flex items-center gap-2">
            <span className="text-[10.5px] font-semibold uppercase tracking-[0.18em] text-amber-800">
              ส่วนลดพิเศษ 50%
            </span>
            <Sparkles className="size-3 text-amber-600" strokeWidth={2} />
          </div>
          <h1 className="mt-2 text-[22px] font-semibold tracking-tight text-foreground leading-tight">
            เลือกสัญญาที่ต้องการปิดยอดก่อนกำหนด
          </h1>
          <p className="mt-2 text-[13px] text-muted-foreground leading-snug">
            ได้รับส่วนลดดอกเบี้ย 50% ทันทีเมื่อปิดยอดก่อนครบสัญญา
          </p>
        </section>

        <div className="relative z-[1] mt-6 flex items-center gap-3 px-5">
          <span className="text-[10.5px] font-semibold uppercase tracking-[0.18em] text-muted-foreground leading-snug">
            สัญญาของคุณ · {eligibleContracts.length} สัญญา
          </span>
          <div className="h-px flex-1 bg-gradient-to-r from-border to-transparent" />
        </div>

        <section className="relative z-[1] px-5 mt-4 space-y-2.5">
          {eligibleContracts.map((c) => (
            <a
              key={c.id}
              href={`/liff/early-payoff?contractId=${encodeURIComponent(c.id)}${lineId ? `&lineId=${encodeURIComponent(lineId)}` : ''}`}
              className="block rounded-[22px] border border-border/50 bg-card p-4 shadow-sm active:scale-[0.99] transition-transform"
            >
              <div className="flex items-start gap-3.5">
                <div
                  className="relative grid h-12 w-12 shrink-0 place-items-center rounded-2xl text-white shadow-lg shadow-amber-500/20"
                  style={{
                    background:
                      'linear-gradient(135deg, rgb(251 191 36) 0%, rgb(245 158 11) 60%, rgb(217 119 6) 100%)',
                  }}
                >
                  <Smartphone className="size-[22px]" strokeWidth={1.5} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="font-semibold text-[14.5px] leading-snug tracking-tight text-foreground truncate">
                    {c.product}
                  </div>
                  <div className="mt-1 font-mono text-[11px] text-muted-foreground tracking-wide leading-snug">
                    {c.contractNumber}
                  </div>
                  <div className="mt-2 flex items-baseline gap-1 flex-wrap">
                    <span className="text-[10.5px] text-muted-foreground leading-snug">คงเหลือ</span>
                    <span className="font-mono text-[13.5px] font-semibold text-foreground tabular-nums tracking-tight">
                      ฿{formatNumber(c.totalOutstanding)}
                    </span>
                  </div>
                </div>
                <ChevronRight className="size-4 text-muted-foreground shrink-0 mt-2" strokeWidth={2} />
              </div>
            </a>
          ))}
        </section>

        <BackToContracts lineId={lineId} />
      </Shell>
    );
  }

  // ─── No eligible contracts ───────────────────────────
  if (!contractId && eligibleContracts.length === 0) {
    return (
      <Shell>
        <TopBar title="ปิดยอดก่อนกำหนด" initial={customerInitial} />

        <section className="relative z-[1] px-5 pt-10 pb-8 flex flex-col items-center text-center">
          <div className="grid h-20 w-20 place-items-center rounded-full bg-emerald-50 border border-emerald-200 mb-5">
            <CheckCircle2 className="size-10 text-emerald-600" strokeWidth={1.5} />
          </div>
          <h2 className="text-[18px] font-semibold text-foreground tracking-tight leading-snug">
            ทุกสัญญาชำระครบแล้ว
          </h2>
          <p className="mt-2 text-[13px] text-muted-foreground leading-snug max-w-[280px]">
            ขณะนี้ไม่มีสัญญาค้างชำระที่สามารถปิดยอดก่อนกำหนดได้
          </p>
          <Button variant="outline" size="lg" className="mt-8 w-full max-w-xs" asChild>
            <a href={`/liff/contract${lineId ? `?lineId=${encodeURIComponent(lineId)}` : ''}`}>
              ดูสัญญาทั้งหมด
            </a>
          </Button>
        </section>
      </Shell>
    );
  }

  // ─── Error ────────────────────────────────────────────
  const errorMsg = error || (quoteError as Error)?.message;
  if (errorMsg) {
    return (
      <Shell>
        <TopBar title="ปิดยอดก่อนกำหนด" initial={customerInitial} />
        <section className="relative z-[1] px-5 pt-10 pb-8 flex flex-col items-center text-center">
          <div className="grid h-20 w-20 place-items-center rounded-full bg-destructive/10 border border-destructive/30 mb-5">
            <span className="text-destructive text-4xl font-light leading-none">!</span>
          </div>
          <h2 className="text-[18px] font-semibold text-foreground tracking-tight leading-snug">
            ไม่สามารถดำเนินการได้
          </h2>
          <p className="mt-2 text-[13px] text-muted-foreground leading-snug max-w-[280px]">{errorMsg}</p>
          <Button variant="outline" size="lg" className="mt-8 w-full max-w-xs" asChild>
            <a href={`/liff/contract${lineId ? `?lineId=${encodeURIComponent(lineId)}` : ''}`}>
              กลับไปดูสัญญา
            </a>
          </Button>
        </section>
      </Shell>
    );
  }

  // ─── Creating payment link ────────────────────────────
  if (payoffMutation.isPending) {
    return (
      <Shell>
        <section className="relative z-[1] min-h-[80vh] flex flex-col items-center justify-center px-5">
          <div className="relative h-16 w-16">
            <div
              className="absolute inset-0 rounded-full animate-spin"
              style={{
                background:
                  'conic-gradient(from 0deg, rgb(245 158 11), rgb(217 119 6), rgb(245 158 11))',
              }}
            />
            <div className="absolute inset-[3px] rounded-full bg-background grid place-items-center">
              <Sparkles className="size-6 text-amber-600" strokeWidth={1.75} />
            </div>
          </div>
          <p className="mt-5 text-[13px] text-muted-foreground leading-snug">
            กำลังสร้างลิงก์ชำระเงิน...
          </p>
        </section>
      </Shell>
    );
  }

  if (!quote) return null;

  // ─── Quote view ───────────────────────────────────────
  const baseBeforeDiscount = quote.remainingPrincipal + quote.remainingInterest;
  const savings = quote.discount + quote.partiallyPaidCredit;

  return (
    <Shell>
      <TopBar title="ปิดยอดก่อนกำหนด" initial={customerInitial} />

      <section className="relative z-[1] px-5 pt-6">
        <div className="text-xs text-muted-foreground leading-snug">สวัสดี</div>
        <div className="text-[17px] font-medium text-foreground tracking-tight leading-snug">
          คุณ{quote.customerName}
        </div>
      </section>

      {/* Hero — discount chamber */}
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
            opacity: 0.55,
            background: 'radial-gradient(circle, rgb(251 191 36), transparent 70%)',
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
            opacity: 0.45,
            background: 'radial-gradient(circle, rgb(16 185 129), transparent 70%)',
          }}
        />

        <div className="relative">
          <div className="flex items-center gap-2">
            <span className="text-[10.5px] font-semibold uppercase tracking-[0.18em] text-amber-800">
              ยอดปิดสัญญา · ส่วนลด 50%
            </span>
            <Sparkles className="size-3 text-amber-600" strokeWidth={2} />
          </div>

          <div className="mt-3 flex items-baseline gap-1.5">
            <span className="font-mono text-[26px] text-amber-700 font-light leading-none">฿</span>
            <span
              className="font-mono font-light tabular-nums tracking-[-0.035em] text-foreground"
              style={{ fontSize: '72px', lineHeight: '0.95' }}
            >
              {formatNumber(quote.totalPayoff)}
            </span>
            <span className="ml-2 font-mono text-xs text-muted-foreground leading-snug">บาท</span>
          </div>

          {savings > 0 && (
            <div className="mt-3 inline-flex items-center gap-2 rounded-full bg-emerald-50 border border-emerald-200 px-3 py-1.5 text-xs leading-snug">
              <Sparkles className="size-3 text-emerald-600" strokeWidth={2} />
              <span className="text-emerald-800">
                ประหยัด <span className="font-semibold">฿{formatNumber(savings)}</span> จากยอดเต็ม{' '}
                <span className="line-through text-emerald-600/70 font-mono">
                  ฿{formatNumber(baseBeforeDiscount + quote.unpaidLateFees)}
                </span>
              </span>
            </div>
          )}

          <button
            type="button"
            className="relative mt-6 w-full overflow-hidden rounded-[20px] px-5 py-[18px] text-white active:scale-[0.985] transition-transform disabled:opacity-60"
            style={{
              background:
                'linear-gradient(135deg, rgb(245 158 11) 0%, rgb(217 119 6) 45%, rgb(180 83 9) 100%)',
              boxShadow: '0 18px 40px -12px rgb(217 119 6 / 0.55)',
            }}
            onClick={() => payoffMutation.mutate()}
            disabled={payoffMutation.isPending}
          >
            <span className="relative z-[1] flex items-center justify-between">
              <span className="flex items-center gap-2.5">
                <span className="grid h-8 w-8 place-items-center rounded-xl bg-white/20 backdrop-blur-sm">
                  <Percent className="size-[16px]" strokeWidth={2} />
                </span>
                <span className="text-[15.5px] font-semibold tracking-tight leading-snug">
                  ชำระเพื่อปิดสัญญาทันที
                </span>
              </span>
              <ArrowRight
                className="size-5 animate-[bounce_2.4s_ease-in-out_infinite]"
                strokeWidth={2}
              />
            </span>
          </button>
        </div>
      </section>

      {/* Section divider */}
      <div className="relative z-[1] mt-8 flex items-center gap-3 px-5">
        <span className="text-[10.5px] font-semibold uppercase tracking-[0.18em] text-muted-foreground leading-snug">
          รายละเอียดยอดปิด
        </span>
        <div className="h-px flex-1 bg-gradient-to-r from-border to-transparent" />
      </div>

      {/* Breakdown — hide interest line, lead with full price + discount */}
      <section className="relative z-[1] mt-4 px-5">
        <div className="rounded-[22px] border border-border/50 bg-card p-5 shadow-sm space-y-3">
          <Row label="งวดคงเหลือ" value={`${quote.remainingMonths} งวด`} />
          <Row
            label="ยอดเต็มก่อนหักส่วนลด"
            value={formatNumber(baseBeforeDiscount)}
            unit="บาท"
            strikethrough
          />

          <div className="h-px bg-border/60" />

          <Row
            label="ส่วนลดพิเศษ 50%"
            value={`−${formatNumber(quote.discount)}`}
            unit="บาท"
            tone="emerald"
            emphasize
          />
          {quote.partiallyPaidCredit > 0 && (
            <Row
              label="หักยอดชำระบางส่วน"
              value={`−${formatNumber(quote.partiallyPaidCredit)}`}
              unit="บาท"
              tone="emerald"
            />
          )}
          {quote.unpaidLateFees > 0 && (
            <Row
              label="ค่าปรับค้างชำระ"
              value={`+${formatNumber(quote.unpaidLateFees)}`}
              unit="บาท"
              tone="destructive"
            />
          )}

          <div className="h-px bg-border/60" />

          <div className="flex items-baseline justify-between">
            <span className="text-[13px] font-semibold text-foreground leading-snug">
              ยอดที่ต้องชำระ
            </span>
            <div className="flex items-baseline gap-1">
              <span className="font-mono text-[22px] font-semibold tabular-nums tracking-tight text-amber-700">
                ฿{formatNumber(quote.totalPayoff)}
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* Contract meta card */}
      <section className="relative z-[1] mt-3 px-5">
        <div className="rounded-[22px] border border-border/50 bg-card/80 backdrop-blur-sm p-4 shadow-sm flex items-center gap-3">
          <div
            className="grid h-11 w-11 shrink-0 place-items-center rounded-xl text-white shadow-md shadow-indigo-500/20"
            style={{
              background:
                'linear-gradient(135deg, rgb(99 102 241) 0%, rgb(59 130 246) 60%, rgb(6 182 212) 100%)',
            }}
          >
            <Smartphone className="size-[18px]" strokeWidth={1.5} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="font-mono text-[10.5px] text-muted-foreground tracking-wide uppercase leading-snug">
              สัญญาที่ปิด
            </div>
            <div className="mt-0.5 font-mono text-[13px] font-medium text-foreground tracking-wide leading-snug">
              {quote.contractNumber}
            </div>
          </div>
        </div>
      </section>

      {/* Info note */}
      <section className="relative z-[1] mt-3 px-5">
        <div className="rounded-[22px] border border-amber-200/60 bg-amber-50/60 p-4 flex items-start gap-3">
          <ShieldCheck className="size-[18px] text-amber-700 shrink-0 mt-0.5" strokeWidth={1.75} />
          <p className="text-[12px] text-amber-900/90 leading-relaxed">
            ส่วนลดพิเศษ 50% เป็นสิทธิ์สำหรับลูกค้าที่ปิดสัญญาก่อนกำหนด ยอดจะปิดสัญญาและย้ายกรรมสิทธิ์เครื่องทันทีหลังชำระสำเร็จ
          </p>
        </div>
      </section>

      <BackToContracts lineId={lineId} />
    </Shell>
  );
}

// ─── UI primitives ─────────────────────────────────────

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative min-h-screen overflow-x-hidden" style={{ backgroundColor: '#fafaf7' }}>
      <div
        className="fixed inset-0 pointer-events-none z-0"
        style={{
          background:
            'radial-gradient(600px 400px at 10% -5%, rgb(251 191 36 / 0.10), transparent 60%),' +
            'radial-gradient(500px 380px at 100% 20%, rgb(16 185 129 / 0.07), transparent 65%),' +
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
          className="grid h-9 w-9 place-items-center rounded-full text-[12px] font-semibold text-white shadow-lg shadow-amber-500/30"
          style={{
            background:
              'linear-gradient(135deg, rgb(251 191 36) 0%, rgb(245 158 11) 60%, rgb(217 119 6) 100%)',
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
  unit,
  tone = 'default',
  strikethrough,
  emphasize,
}: {
  label: string;
  value: string;
  unit?: string;
  tone?: 'default' | 'emerald' | 'destructive';
  strikethrough?: boolean;
  emphasize?: boolean;
}) {
  const valueColor =
    tone === 'emerald'
      ? 'text-emerald-700'
      : tone === 'destructive'
        ? 'text-destructive'
        : strikethrough
          ? 'text-muted-foreground/70'
          : 'text-foreground';
  const valueSize = emphasize ? 'text-[15px] font-semibold' : 'text-[13.5px] font-medium';
  return (
    <div className="flex items-baseline justify-between">
      <span className={`text-[12.5px] leading-snug ${emphasize ? 'text-emerald-700 font-semibold' : 'text-muted-foreground'}`}>
        {label}
      </span>
      <span className="flex items-baseline gap-1">
        <span
          className={`font-mono tabular-nums tracking-tight ${valueSize} ${valueColor} ${strikethrough ? 'line-through' : ''}`}
        >
          {value}
        </span>
        {unit && <span className="text-[11px] text-muted-foreground leading-snug">{unit}</span>}
      </span>
    </div>
  );
}

function BackToContracts({ lineId }: { lineId: string }) {
  return (
    <div className="relative z-[1] mt-6 px-5">
      <a
        href={`/liff/contract${lineId ? `?lineId=${encodeURIComponent(lineId)}` : ''}`}
        className="flex items-center justify-center gap-1.5 text-[12.5px] text-muted-foreground hover:text-foreground transition-colors py-3 leading-snug"
      >
        <ChevronLeft className="size-3.5" strokeWidth={2} />
        กลับไปดูสัญญา
      </a>
      <p className="text-center text-[10px] text-muted-foreground/70 tracking-[0.15em] uppercase mt-4 leading-snug">
        Best Choice · ระบบผ่อนชำระ
      </p>
    </div>
  );
}
