import { useLiffInit } from '@/hooks/useLiffInit';
import { liffApi, withLiffToken } from '@/lib/api';
import { formatDateShortThai, formatMonthName, formatNumber } from '@/utils/formatters';
import { useQuery } from '@tanstack/react-query';
import {
  ChevronLeft,
  CheckCheck,
  Receipt,
  QrCode,
  Landmark,
  CreditCard,
  Banknote,
  FileText,
  Download,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { LIFF_ERRORS } from '@/constants/liff-errors';

import type {
  LiffHistoryPayment as HistoryPayment,
  LiffHistoryResponse as HistoryData,
} from '@installment/shared';

const methodLabels: Record<string, string> = {
  CASH: 'เงินสด',
  BANK_TRANSFER: 'โอนเงิน',
  PROMPTPAY: 'พร้อมเพย์',
  CREDIT_CARD: 'บัตรเครดิต',
  DEBIT_CARD: 'บัตรเดบิต',
};

const methodIcon: Record<string, React.ComponentType<{ className?: string; strokeWidth?: number }>> = {
  CASH: Banknote,
  BANK_TRANSFER: Landmark,
  PROMPTPAY: QrCode,
  CREDIT_CARD: CreditCard,
  DEBIT_CARD: CreditCard,
};

const THAI_YEAR_OFFSET = 543;

function groupKey(dateStr: string | null): string {
  if (!dateStr) return 'unknown';
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return 'unknown';
  return `${d.getFullYear()}-${d.getMonth()}`;
}

function groupLabel(key: string): string {
  if (key === 'unknown') return 'ไม่ระบุวันที่';
  const [year, month] = key.split('-').map(Number);
  const ref = new Date(year, month, 1);
  return `${formatMonthName(ref)} ${year + THAI_YEAR_OFFSET}`;
}

function groupPayments(payments: HistoryPayment[]): Array<{ key: string; items: HistoryPayment[] }> {
  const map = new Map<string, HistoryPayment[]>();
  // Newest first
  const sorted = [...payments].sort((a, b) => {
    const ta = a.paidDate ? new Date(a.paidDate).getTime() : 0;
    const tb = b.paidDate ? new Date(b.paidDate).getTime() : 0;
    return tb - ta;
  });
  for (const p of sorted) {
    const key = groupKey(p.paidDate);
    const bucket = map.get(key);
    if (bucket) bucket.push(p);
    else map.set(key, [p]);
  }
  return Array.from(map.entries()).map(([key, items]) => ({ key, items }));
}

export default function LiffHistory() {
  const { lineId, loading, error } = useLiffInit();

  const { data, isLoading: dataLoading, error: dataError } = useQuery<HistoryData>({
    queryKey: ['liff-history', lineId],
    queryFn: async () => {
      try {
        const { data } = await liffApi.get(`/line-oa/liff/history?lineId=${encodeURIComponent(lineId!)}`);
        return data;
      } catch (err: unknown) {
        const axiosErr = err as { response?: { status?: number } };
        if (axiosErr.response?.status === 404) throw new Error(LIFF_ERRORS.NOT_REGISTERED);
        throw new Error(LIFF_ERRORS.LOAD_FAILED);
      }
    },
    enabled: !!lineId,
  });

  const customerInitial = (data?.customer?.name ?? '').charAt(0) || '?';

  // ─── Loading ──────────────────────────────────────────
  if (loading || dataLoading) {
    return (
      <Shell>
        <div className="px-5 pt-6 space-y-4">
          <Skeleton className="h-24 w-full rounded-[22px]" />
          <Skeleton className="h-28 w-full rounded-[22px]" />
          <Skeleton className="h-16 w-full rounded-[22px]" />
          <Skeleton className="h-16 w-full rounded-[22px]" />
        </div>
      </Shell>
    );
  }

  // ─── Error ────────────────────────────────────────────
  if (error || dataError) {
    return (
      <Shell>
        <TopBar title="ประวัติชำระเงิน" initial="?" />
        <section className="relative z-[1] px-5 pt-10 pb-8 flex flex-col items-center text-center">
          <div className="grid h-20 w-20 place-items-center rounded-full bg-destructive/10 border border-destructive/30 mb-5">
            <span className="text-destructive text-4xl font-light leading-none">!</span>
          </div>
          <h2 className="text-[18px] font-semibold text-foreground tracking-tight leading-snug">
            ไม่สามารถดำเนินการได้
          </h2>
          <p className="mt-2 text-[13px] text-muted-foreground leading-snug max-w-[280px]">
            {error || (dataError as Error)?.message}
          </p>
        </section>
      </Shell>
    );
  }

  // ─── Empty ────────────────────────────────────────────
  if (!data || data.payments.length === 0) {
    return (
      <Shell>
        <TopBar title="ประวัติชำระเงิน" initial={customerInitial} />
        <section className="relative z-[1] px-5 pt-16 pb-10 flex flex-col items-center text-center">
          <div className="grid h-20 w-20 place-items-center rounded-full bg-muted border border-border mb-5">
            <Receipt className="size-9 text-muted-foreground" strokeWidth={1.5} />
          </div>
          <h2 className="text-[18px] font-semibold text-foreground tracking-tight leading-snug">
            ยังไม่มีประวัติชำระ
          </h2>
          <p className="mt-2 text-[13px] text-muted-foreground leading-snug max-w-[280px]">
            เมื่อคุณชำระงวดแรก รายการจะปรากฏที่นี่พร้อมวันที่และวิธีชำระ
          </p>
          <Button variant="outline" size="lg" className="mt-8 w-full max-w-xs" asChild>
            <a href={`/liff/contract${lineId ? `?lineId=${encodeURIComponent(lineId)}` : ''}`}>
              กลับไปดูสัญญา
            </a>
          </Button>
        </section>
      </Shell>
    );
  }

  const totalPaid = data.payments.reduce((sum, p) => sum + p.amountPaid, 0);
  const totalLateFee = data.payments.reduce((sum, p) => sum + p.lateFee, 0);
  const groups = groupPayments(data.payments);

  // Streak = count of payments paid ON time (no late fee) out of total
  const onTimeCount = data.payments.filter((p) => p.lateFee === 0).length;
  const onTimePct = Math.round((onTimeCount / data.payments.length) * 100);

  return (
    <Shell>
      <TopBar title="ประวัติชำระเงิน" initial={customerInitial} />

      {/* Greeting */}
      <section className="relative z-[1] px-5 pt-6">
        <div className="text-xs text-muted-foreground leading-snug">สวัสดี</div>
        <div className="text-[17px] font-medium text-foreground tracking-tight leading-snug">
          คุณ{data.customer.name}
        </div>
      </section>

      {/* Hero — paid ledger summary */}
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
            background: 'radial-gradient(circle, rgb(16 185 129), transparent 70%)',
          }}
        />
        <div
          className="absolute pointer-events-none animate-[float_3.5s_ease-in-out_infinite_1.2s]"
          style={{
            top: '50px',
            right: '-30px',
            width: '180px',
            height: '180px',
            borderRadius: '50%',
            filter: 'blur(60px)',
            opacity: 0.45,
            background: 'radial-gradient(circle, rgb(59 130 246), transparent 70%)',
          }}
        />

        <div className="relative">
          <div className="flex items-center gap-2">
            <span className="text-[10.5px] font-semibold uppercase tracking-[0.18em] text-emerald-700">
              ชำระแล้วทั้งหมด
            </span>
            <CheckCheck className="size-3 text-emerald-600" strokeWidth={2.5} />
          </div>

          <div className="mt-3 flex items-baseline gap-1.5">
            <span className="font-mono text-[26px] text-emerald-700 font-light leading-none">฿</span>
            <span
              className="font-mono font-light tabular-nums tracking-[-0.035em] text-foreground"
              style={{ fontSize: '60px', lineHeight: '0.95' }}
            >
              {formatNumber(totalPaid)}
            </span>
            <span className="ml-2 font-mono text-xs text-muted-foreground leading-snug">บาท</span>
          </div>

          {/* Stats strip */}
          <div className="mt-4 grid grid-cols-3 gap-2">
            <StatChip
              label="งวดที่ชำระ"
              value={data.payments.length.toString()}
              unit="งวด"
              tone="default"
            />
            <StatChip
              label="ตรงเวลา"
              value={`${onTimePct}`}
              unit="%"
              tone={onTimePct >= 90 ? 'emerald' : 'default'}
            />
            <StatChip
              label="ค่าปรับรวม"
              value={totalLateFee > 0 ? formatNumber(totalLateFee) : '0'}
              unit="บาท"
              tone={totalLateFee > 0 ? 'destructive' : 'muted'}
            />
          </div>
        </div>
      </section>

      {/* Payment groups */}
      <div className="relative z-[1] mt-8">
        {groups.map((g, gIdx) => (
          <div key={g.key} className={gIdx > 0 ? 'mt-6' : ''}>
            <div className="flex items-center gap-3 px-5">
              <span className="text-[10.5px] font-semibold uppercase tracking-[0.18em] text-muted-foreground leading-snug">
                {groupLabel(g.key)}
              </span>
              <div className="h-px flex-1 bg-gradient-to-r from-border to-transparent" />
              <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
                {g.items.length}
              </span>
            </div>

            <div className="mt-3 px-5 space-y-2">
              {g.items.map((p, i) => (
                <PaymentRow key={`${p.contractNumber}-${p.installmentNo}-${i}`} payment={p} />
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Back link */}
      <div className="relative z-[1] mt-8 px-5">
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
            'radial-gradient(600px 400px at 10% -5%, rgb(16 185 129 / 0.09), transparent 60%),' +
            'radial-gradient(500px 380px at 100% 20%, rgb(59 130 246 / 0.08), transparent 65%),' +
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
      <div className="text-[13px] font-medium text-foreground tracking-tight leading-snug">{title}</div>
      <div className="relative -mr-1.5">
        <div
          className="grid h-9 w-9 place-items-center rounded-full text-[12px] font-semibold text-white shadow-lg shadow-emerald-500/30"
          style={{
            background:
              'linear-gradient(135deg, rgb(16 185 129) 0%, rgb(5 150 105) 60%, rgb(13 148 136) 100%)',
          }}
        >
          {initial}
        </div>
      </div>
    </header>
  );
}

function StatChip({
  label,
  value,
  unit,
  tone = 'default',
}: {
  label: string;
  value: string;
  unit?: string;
  tone?: 'default' | 'emerald' | 'destructive' | 'muted';
}) {
  const valueColor =
    tone === 'emerald'
      ? 'text-emerald-700'
      : tone === 'destructive'
        ? 'text-destructive'
        : tone === 'muted'
          ? 'text-muted-foreground'
          : 'text-foreground';
  return (
    <div className="rounded-2xl border border-border/50 bg-card/70 backdrop-blur-sm p-3 shadow-sm">
      <div className="text-[9.5px] font-semibold uppercase tracking-[0.15em] text-muted-foreground leading-snug">
        {label}
      </div>
      <div className="mt-1.5 flex items-baseline gap-1">
        <span className={`font-mono text-[18px] font-medium tabular-nums tracking-tight ${valueColor}`}>
          {value}
        </span>
        {unit && <span className="text-[10px] text-muted-foreground leading-snug">{unit}</span>}
      </div>
    </div>
  );
}

function PaymentRow({ payment }: { payment: HistoryPayment }) {
  const Icon = payment.paymentMethod ? methodIcon[payment.paymentMethod] ?? FileText : FileText;
  const methodLabel = payment.paymentMethod
    ? methodLabels[payment.paymentMethod] ?? payment.paymentMethod
    : 'ชำระแล้ว';
  const wasLate = payment.lateFee > 0;

  return (
    <div className="relative flex items-start gap-3 rounded-[18px] border border-border/50 bg-card px-4 py-3.5 shadow-sm">
      {/* Paid indicator */}
      <div className="shrink-0 pt-1">
        <div
          className={`relative grid h-7 w-7 place-items-center rounded-full ${
            wasLate
              ? 'bg-amber-50 border border-amber-200'
              : 'bg-emerald-50 border border-emerald-200'
          }`}
        >
          <CheckCheck
            className={`size-[13px] ${wasLate ? 'text-amber-700' : 'text-emerald-700'}`}
            strokeWidth={2.5}
          />
        </div>
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2 flex-wrap">
              <span className="text-[13.5px] font-semibold text-foreground tracking-tight leading-snug">
                งวดที่ {payment.installmentNo}
              </span>
              <span className="font-mono text-[10.5px] text-muted-foreground tracking-wide leading-snug">
                {payment.contractNumber}
              </span>
            </div>
            <div className="mt-1 flex items-center gap-1.5 text-[11.5px] text-muted-foreground leading-snug flex-wrap">
              <Icon className="size-[12px]" strokeWidth={1.75} />
              <span>
                {payment.paidDate ? formatDateShortThai(payment.paidDate) : '–'} · {methodLabel}
              </span>
            </div>
          </div>

          <div className="text-right shrink-0">
            <div className="font-mono text-[15px] font-semibold tabular-nums tracking-tight text-foreground leading-none">
              ฿{formatNumber(payment.amountPaid)}
            </div>
            {wasLate && (
              <div className="mt-1 inline-flex items-center gap-1 rounded-full bg-amber-50 border border-amber-200 px-1.5 py-0.5 text-[9.5px] font-medium text-amber-800 leading-none">
                <span>ค่าปรับ</span>
                <span className="font-mono tabular-nums">฿{formatNumber(payment.lateFee)}</span>
              </div>
            )}
            {payment.receiptId && (
              <a
                href={withLiffToken(`/api/line-oa/liff/receipts/${payment.receiptId}/download`)}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-2 inline-flex items-center gap-1 rounded-full bg-emerald-50/70 border border-emerald-200 px-2 py-1 text-[10px] font-medium text-emerald-700 active:scale-[0.97] transition-transform leading-none"
              >
                <Download className="size-[11px]" strokeWidth={2} />
                ใบเสร็จ
              </a>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
