import { useState, useEffect, useCallback, useRef } from 'react';
import { useQueries, type UseQueryResult } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { gsap, useGSAP } from '@/components/motion/gsap';
import { MessageCircle } from 'lucide-react';
import { Card, CardHeader, CardBody, CardTitle, Button } from '@/components';
import { lineOaMessageUrl, productShareUrl } from '@/lib/copy';

interface PreviewResponse {
  available: boolean;
  reason?: string;
  monthlyPayment?: number;
  downAmount?: number;
  totalWithVat?: number;
  financedAmount?: number;
  months?: number;
  gfinSubmitPrice?: number;
  downDiscount?: number;
  /** BC only — the minimum down payment in percent, straight from the rate
   *  table. The old hardcoded 15 went stale the moment the owner edited it. */
  minDownPct?: number;
}

interface Props {
  productId: string;
  cashPrice: number | null;
  installmentPrice: number | null;
}

function formatTHB(n: number): string {
  return n.toLocaleString('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

const MONTHS_OPTIONS = [3, 4, 5, 6, 7, 8, 10, 12];

/** Only used until the first BC answer arrives with the real floor. */
const DEFAULT_DOWN_PCT = 15;
const MAX_DOWN_PCT = 90;
/** Long enough to type a second digit, short enough to feel like a correction. */
const SETTLE_MS = 900;

/**
 * Down payment as a percentage AND as baht, kept in step.
 *
 * Both boxes hold a raw string while the shopper is mid-type. The old field
 * ran `Number(e.target.value)` on every keystroke, so clearing it produced
 * `Number('') === 0` and the whole calculator dropped to a 0% down that the
 * finance side rejects. Values are parsed and clamped on blur or Enter.
 */
function DownPaymentInput({
  installmentPrice,
  minDownPct,
  pct,
  amount,
  onCommitPct,
  onCommitAmount,
}: {
  installmentPrice: number;
  minDownPct: number;
  pct: number;
  amount: number;
  onCommitPct: (v: number) => void;
  onCommitAmount: (v: number) => void;
}) {
  const [pctRaw, setPctRaw] = useState(String(pct));
  const [amtRaw, setAmtRaw] = useState(String(amount));
  useEffect(() => setPctRaw(String(pct)), [pct]);
  useEffect(() => setAmtRaw(String(amount)), [amount]);

  const minAmount = Math.ceil((installmentPrice * minDownPct) / 100);
  const pctTyped = Number(pctRaw);
  const amtTyped = Number(amtRaw.replace(/,/g, ''));
  const belowMin =
    (pctRaw.trim() !== '' && Number.isFinite(pctTyped) && pctTyped < minDownPct) ||
    (amtRaw.trim() !== '' && Number.isFinite(amtTyped) && amtTyped < minAmount);

  const box =
    'min-h-11 border border-border rounded-md px-2 py-1 text-sm bg-background text-foreground ' +
    'focus:outline-none focus:ring-2 focus:ring-primary num text-right';

  function commitPct() {
    const n = Number(pctRaw.replace(/[^\d.]/g, ''));
    if (!Number.isFinite(n) || pctRaw.trim() === '') return setPctRaw(String(pct));
    const v = Math.min(MAX_DOWN_PCT, Math.max(minDownPct, Math.round(n)));
    setPctRaw(String(v));
    onCommitPct(v);
  }
  function commitAmount() {
    const n = Number(amtRaw.replace(/[^\d.]/g, ''));
    if (!Number.isFinite(n) || amtRaw.trim() === '') return setAmtRaw(String(amount));
    // Cap just under the price — a down payment equal to the price is a cash sale.
    const v = Math.min(installmentPrice - 1, Math.max(minAmount, Math.round(n)));
    setAmtRaw(String(v));
    onCommitAmount(v);
  }
  /**
   * One rule for both boxes: when typing settles, commit the clamped value.
   * That is what makes a below-minimum entry snap up on its own, and it also
   * means a perfectly good number no longer waits for a click elsewhere before
   * the other box and the quote catch up.
   *
   * Clamping per keystroke instead would turn "25" into "15" the moment they
   * pressed 2, which is why this waits.
   */
  useEffect(() => {
    if (pctRaw.trim() === '') return;
    const n = Number(pctRaw.replace(/[^\d.]/g, ''));
    if (!Number.isFinite(n)) return;
    const v = Math.min(MAX_DOWN_PCT, Math.max(minDownPct, Math.round(n)));
    if (v === pct && pctRaw === String(v)) return; // already settled
    const t = setTimeout(() => {
      setPctRaw(String(v));
      setAmtRaw(String(Math.ceil((installmentPrice * v) / 100)));
      onCommitPct(v);
    }, SETTLE_MS);
    return () => clearTimeout(t);
  }, [pctRaw, pct, minDownPct, installmentPrice, onCommitPct]);

  useEffect(() => {
    if (amtRaw.trim() === '') return;
    const n = Number(amtRaw.replace(/[^\d.]/g, ''));
    if (!Number.isFinite(n)) return;
    const v = Math.min(installmentPrice - 1, Math.max(minAmount, Math.round(n)));
    if (v === amount && amtRaw === String(v)) return;
    const t = setTimeout(() => {
      setAmtRaw(String(v));
      setPctRaw(String(Math.round((v / installmentPrice) * 100)));
      onCommitAmount(v);
    }, SETTLE_MS);
    return () => clearTimeout(t);
  }, [amtRaw, amount, minAmount, installmentPrice, onCommitAmount]);

  const enterCommits = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      e.currentTarget.blur();
    }
  };

  return (
    <>
      <span className="flex items-center gap-x-2">
        <span className="text-sm font-medium">เงินดาวน์:</span>

        <span className="inline-flex items-center gap-1">
          <input
            id="downpct-input"
            aria-label="เงินดาวน์ เป็นเปอร์เซ็นต์"
            type="number"
            inputMode="numeric"
            value={pctRaw}
            min={minDownPct}
            max={MAX_DOWN_PCT}
            onChange={(e) => setPctRaw(e.target.value)}
            onBlur={commitPct}
            onKeyDown={enterCommits}
            className={`${box} w-16`}
          />
          <span className="text-sm text-muted-foreground">%</span>
        </span>

        <span className="text-sm text-muted-foreground">=</span>

        <span className="inline-flex items-center gap-1">
          <span className="text-sm text-muted-foreground">฿</span>
          <input
            id="downamount-input"
            aria-label="เงินดาวน์ เป็นบาท"
            type="number"
            inputMode="numeric"
            value={amtRaw}
            min={minAmount}
            max={installmentPrice - 1}
            step={500}
            onChange={(e) => setAmtRaw(e.target.value)}
            onBlur={commitAmount}
            onKeyDown={enterCommits}
            className={`${box} w-28`}
          />
        </span>
      </span>

      <p
        className={
          belowMin
            ? 'w-full text-xs text-orange-700 font-medium leading-snug'
            : 'w-full text-xs text-muted-foreground leading-snug'
        }
        role={belowMin ? 'status' : undefined}
      >
        {belowMin
          ? `ต่ำกว่าขั้นต่ำ — กำลังปรับขึ้นเป็น ${minDownPct}% (฿${minAmount.toLocaleString()})`
          : `พิมพ์เป็น % หรือเป็นบาทก็ได้ · ขั้นต่ำ ${minDownPct}% (฿${minAmount.toLocaleString()})`}
      </p>
    </>
  );
}

function QuoteOption({
  label,
  query,
}: {
  label: string;
  query: UseQueryResult<PreviewResponse, Error>;
}) {
  const highlight = useRef<HTMLDivElement>(null);
  const result = query.data;
  useGSAP(
    () => {
      if (query.isFetching || query.isError || !result?.available || !window.matchMedia) return;
      const media = gsap.matchMedia();
      media.add('(prefers-reduced-motion: no-preference)', () => {
        gsap.fromTo(
          highlight.current,
          { opacity: 1 },
          { opacity: 0, duration: 0.9, ease: 'power2.out' },
        );
      });
      return () => media.revert();
    },
    {
      dependencies: [query.dataUpdatedAt, query.isFetching, query.isError, result?.available],
      revertOnUpdate: true,
    },
  );

  return (
    <div className="relative min-h-36 overflow-hidden rounded-xl border border-border bg-card p-4">
      <div
        ref={highlight}
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-primary/10 opacity-0"
      />
      <div className="relative space-y-2">
        <h3 className="text-sm font-semibold text-primary leading-snug">{label}</h3>
        {query.isFetching || query.isPending ? (
          <div aria-hidden="true" className="space-y-2">
            <div className="h-8 w-2/3 animate-pulse rounded bg-muted" />
            <div className="h-4 w-1/2 animate-pulse rounded bg-muted" />
          </div>
        ) : query.isError ? (
          <>
            <p className="text-sm text-muted-foreground leading-snug">
              โหลดค่างวดไม่สำเร็จ ลองอีกครั้งได้
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => query.refetch()}
              aria-label={`ลองคำนวณ ${label} อีกครั้ง`}
            >
              ลองใหม่
            </Button>
          </>
        ) : result?.available ? (
          <>
            <p className="num text-2xl font-bold text-primary leading-snug">
              ฿{formatTHB(result.monthlyPayment ?? 0)}
              <span className="text-sm font-normal"> / เดือน</span>
            </p>
            <p className="text-sm text-muted-foreground leading-snug">
              ดาวน์ ฿{formatTHB(result.downAmount ?? 0)} · {result.months} งวด
            </p>
          </>
        ) : (
          <p className="text-sm text-muted-foreground leading-snug">
            ยังไม่มีแผนผ่อนสำหรับตัวเลือกนี้ ลองเปลี่ยนเงินดาวน์หรืองวด
          </p>
        )}
      </div>
    </div>
  );
}

function InstallmentCalculator({
  productId,
  installmentPrice,
}: Props & { installmentPrice: number }) {
  const [months, setMonths] = useState(12);
  const [downPct, setDownPct] = useState(DEFAULT_DOWN_PCT);
  const [downMode, setDownMode] = useState<'PCT' | 'AMOUNT'>('PCT');
  const [downAmountInput, setDownAmountInput] = useState<number | null>(null);
  const [minDownPct, setMinDownPct] = useState(DEFAULT_DOWN_PCT);
  const commitPct = useCallback((value: number) => {
    setDownMode('PCT');
    setDownPct(value);
    setDownAmountInput(null);
  }, []);
  const commitAmount = useCallback(
    (value: number) => {
      setDownMode('AMOUNT');
      setDownAmountInput(value);
      setDownPct(Math.round((value / installmentPrice) * 100));
    },
    [installmentPrice],
  );

  const quotes = useQueries({
    queries: ['BC', 'GFIN'].map((provider) => ({
      queryKey: [
        'shop-installment-options',
        productId,
        installmentPrice,
        provider,
        months,
        downPct,
        downMode,
        downAmountInput,
      ],
      queryFn: async ({ signal }: { signal: AbortSignal }) => {
        // Endpoint expects a fraction; exact baht are also sent to BOTH providers.
        const params = new URLSearchParams({
          productId,
          provider,
          months: String(months),
          downPct: String(downPct / 100),
        });
        if (downMode === 'AMOUNT' && downAmountInput != null)
          params.set('customDownAmount', String(downAmountInput));
        const { data } = await api.get<PreviewResponse>(`/api/shop/installment-preview?${params}`, {
          signal,
        });
        return data;
      },
      retry: false,
    })),
  });
  const bcResult = quotes[0].data;
  const loading = quotes.some((query) => query.isFetching || query.isPending);
  const hasError = quotes.some((query) => query.isError);
  const anyAvailable = quotes.some((query) => query.data?.available);
  useEffect(() => {
    if (bcResult?.minDownPct != null) setMinDownPct(bcResult.minDownPct);
  }, [bcResult?.minDownPct]);
  const effectiveDownAmount =
    bcResult?.downAmount ?? downAmountInput ?? Math.round((installmentPrice * downPct) / 100);

  return (
    <Card>
      <CardHeader>
        <CardTitle>เลือกการผ่อน</CardTitle>
      </CardHeader>
      <CardBody className="space-y-4">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
          <div className="flex items-center gap-2">
            <label htmlFor="months-select" className="text-sm font-medium">
              จำนวนงวด:
            </label>
            <select
              id="months-select"
              value={months}
              onChange={(event) => setMonths(Number(event.target.value))}
              className="min-h-11 rounded-md border border-border bg-background px-3 py-1 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
            >
              {MONTHS_OPTIONS.map((value) => (
                <option key={value} value={value}>
                  {value} งวด
                </option>
              ))}
            </select>
          </div>
          <DownPaymentInput
            installmentPrice={installmentPrice}
            minDownPct={minDownPct}
            pct={downPct}
            amount={effectiveDownAmount}
            onCommitPct={commitPct}
            onCommitAmount={commitAmount}
          />
        </div>
        <p role="status" aria-live="polite" className="text-sm text-muted-foreground leading-snug">
          {loading
            ? 'กำลังคำนวณค่างวดล่าสุด…'
            : hasError
              ? 'โหลดค่างวดบางรายการไม่สำเร็จ กดลองใหม่ได้'
              : anyAvailable
                ? 'อัปเดตค่างวดตามตัวเลือกแล้ว'
                : 'ยังไม่มีแผนผ่อนสำหรับตัวเลือกนี้'}
        </p>
        <div aria-label="ผลคำนวณค่างวด" aria-busy={loading} className="grid gap-3 md:grid-cols-2">
          <QuoteOption label="BESTCHOICE" query={quotes[0]} />
          <QuoteOption label="GFIN" query={quotes[1]} />
        </div>
        <p className="text-xs text-muted-foreground leading-snug">
          ค่างวดข้างต้นเป็นการประมาณการ — ราคาจริงเป็นไปตามสัญญาที่ลงนาม
        </p>
        <Button asChild variant="primary" size="lg">
          <a
            href={lineOaMessageUrl(`สนใจผ่อนเครื่องนี้ ${productShareUrl(productId)}`)}
            target="_blank"
            rel="noopener noreferrer"
          >
            <MessageCircle className="size-4" aria-hidden="true" />
            ทักแชทผ่อนเครื่องนี้
          </a>
        </Button>
      </CardBody>
    </Card>
  );
}

export function InstallmentCalculatorCard(props: Props) {
  if (!props.installmentPrice) return null;
  // A different physical device starts with its own quote and input state.
  return (
    <InstallmentCalculator
      key={props.productId}
      {...props}
      installmentPrice={props.installmentPrice}
    />
  );
}
