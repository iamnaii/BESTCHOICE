import { NativeSelect } from '@/components/ui/native-select';
import { useState, useEffect, useCallback, useRef } from 'react';
import { useQueries, type UseQueryResult } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { gsap, useGSAP } from '@/components/motion/gsap';
import { MessageCircle } from '@/lib/icons';
import { Card, CardHeader, CardBody, CardTitle, Button } from '@/components';
import { displayInstallment, minDownAmountFromPct } from '@installment/shared';
import { lineOaMessageUrl, productShareUrl } from '@/lib/copy';
import { cn } from '@/lib/utils';
import { DEFAULT_DETAIL_MONTHS } from '@/lib/installment-defaults';
import { compareBadges, FREE_DOWN_BADGE, isFreeDown } from './installment-compare';

interface PreviewResponse {
  available: boolean;
  reason?: string;
  monthlyPayment?: number;
  downAmount?: number;
  totalWithVat?: number;
  financedAmount?: number;
  months?: number;
  /** BC only — the minimum down payment in percent, straight from the rate
   *  table. The old hardcoded 15 went stale the moment the owner edited it. */
  minDownPct?: number;
  /** งวดที่เลือกได้ของผู้ให้ผ่อนนั้น — BC: งวดที่มีอัตราดอกเบี้ย · GFIN: งวดที่ GFIN รับสำหรับเครื่องนี้ */
  allowedMonths?: number[];
  /** GFIN only — งวดตั้งต้นของเครื่อง (ตัวเดียวกับหน้า "ราคาและเรทผ่อน" / บอท / สติกเกอร์) */
  defaultMonths?: number;
}

type Provider = 'BC' | 'GFIN';

/** หน้าร้านไม่บอกชื่อผู้ให้ผ่อน — ลูกค้าเห็นแค่ "เรท 1 / เรท 2" (เจ้าของ 2026-11-25) */
const PROVIDER_LABEL: Record<Provider, string> = { BC: 'เรท 1', GFIN: 'เรท 2' };

interface Props {
  productId: string;
  cashPrice: number | null;
  installmentPrice: number | null;
  /** เงินดาวน์ที่ลูกค้าพิมพ์ในหน้ารวม (`?down=`) — ค่าเริ่มต้นของเรท 1 ตอนเปิดหน้า · ไม่นับว่าลูกค้าแก้ช่อง */
  initialDown?: number | null;
  /** จำนวนงวดที่การ์ดหน้ารวมแสดง (`?months=`) — ค่าเริ่มต้นของเรท 1 เท่านั้น · เรท 2 ไม่ใช้ */
  initialMonths?: number | null;
}

function formatTHB(n: number): string {
  return n.toLocaleString('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

/** งวดของคำขอแรกของ BESTCHOICE — ตัวเลือกจริงมาจากคำตอบ BC (allowedMonths) · GFIN ให้ server เลือกงวดตั้งต้นเอง */
const INITIAL_MONTHS = DEFAULT_DETAIL_MONTHS;

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
  onUserEdit,
}: {
  installmentPrice: number;
  minDownPct: number;
  pct: number;
  amount: number;
  onCommitPct: (v: number) => void;
  onCommitAmount: (v: number) => void;
  /** ลูกค้าพิมพ์ในช่องเอง (ไม่รวมการปรับขึ้นเป็นขั้นต่ำอัตโนมัติ) */
  onUserEdit: () => void;
}) {
  const [pctRaw, setPctRaw] = useState(String(pct));
  const [amtRaw, setAmtRaw] = useState(String(amount));
  useEffect(() => setPctRaw(String(pct)), [pct]);
  useEffect(() => setAmtRaw(String(amount)), [amount]);

  const minAmount = minDownAmountFromPct(installmentPrice, minDownPct / 100);
  const pctTyped = Number(pctRaw);
  const amtTyped = Number(amtRaw.replace(/,/g, ''));
  const belowMin =
    (pctRaw.trim() !== '' && Number.isFinite(pctTyped) && pctTyped < minDownPct) ||
    (amtRaw.trim() !== '' && Number.isFinite(amtTyped) && amtTyped < minAmount);

  const box =
    'min-h-11 border border-border rounded-md px-2 py-1 text-base md:text-sm bg-background text-foreground ' +
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
      setAmtRaw(String(minDownAmountFromPct(installmentPrice, v / 100)));
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
            onChange={(e) => {
              onUserEdit();
              setPctRaw(e.target.value);
            }}
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
            onChange={(e) => {
              onUserEdit();
              setAmtRaw(e.target.value);
            }}
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

/** ตัวเลือกจำนวนงวดของผู้ให้ผ่อนแต่ละเจ้า — BESTCHOICE กับ GFIN มีงวดไม่เหมือนกัน */
function TermSelect({
  provider,
  options,
  value,
  onChange,
}: {
  provider: Provider;
  options: number[];
  value: number | null;
  onChange: (months: number) => void;
}) {
  if (options.length === 0 || value == null) return null;
  const id = `months-select-${provider.toLowerCase()}`;
  return (
    <div className="flex items-center gap-2">
      <label htmlFor={id} className="text-sm font-medium leading-snug">
        จำนวนงวด
      </label>
      <NativeSelect
        wrapperClassName="max-w-full w-auto"
        id={id}
        aria-label={`จำนวนงวด ${PROVIDER_LABEL[provider]}`}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="min-h-11 rounded-md border border-border bg-background px-3 py-1 text-base md:text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
      >
        {options.map((months) => (
          <option key={months} value={months}>
            {months} งวด
          </option>
        ))}
      </NativeSelect>
    </div>
  );
}

function QuoteOption({
  label,
  query,
  term,
  badges,
}: {
  label: string;
  query: UseQueryResult<PreviewResponse, Error>;
  term: React.ReactNode;
  badges: string[];
}) {
  const highlight = useRef<HTMLDivElement>(null);
  const result = query.data;
  const settled = !query.isFetching && !query.isPending && !query.isError;
  const freeDown = settled && isFreeDown(result);
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
    <div
      className={cn(
        'relative min-h-36 overflow-hidden rounded-xl border p-4',
        freeDown ? 'border-promo/60 bg-sand-50' : 'border-border bg-card',
      )}
    >
      <div
        ref={highlight}
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-primary/10 opacity-0"
      />
      <div className="relative space-y-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <h3 className="text-sm font-semibold text-primary leading-snug">{label}</h3>
          {settled &&
            badges.map((badge) => (
              <span
                key={badge}
                className={cn(
                  'rounded-full px-2 py-0.5 text-xs font-semibold leading-snug whitespace-nowrap',
                  badge === FREE_DOWN_BADGE
                    ? 'bg-promo text-promo-foreground'
                    : 'bg-muted text-accent-foreground',
                )}
              >
                {badge}
              </span>
            ))}
        </div>
        {term}
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
              ฿{formatTHB(displayInstallment(result.monthlyPayment ?? 0))}
              <span className="text-sm font-normal"> / เดือน</span>
            </p>
            <p className="text-sm text-muted-foreground leading-snug">
              {freeDown
                ? `ไม่ต้องวางดาวน์ · ${result.months} งวด`
                : `ดาวน์ ฿${formatTHB(result.downAmount ?? 0)} · ${result.months} งวด`}
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
  initialDown,
  initialMonths,
}: Props & { installmentPrice: number }) {
  // เปิดจากการ์ดหน้ารวมสถานะ ② (คำตัดสิน ข1): เรท 1 เริ่มที่เงินดาวน์นั้น ไม่เกินเพดาน 90%
  // ต่ำกว่าขั้นต่ำของเครื่อง → ช่องเงินดาวน์ปรับขึ้นเองตามกติกาเดิมของมัน
  // ห้ามแตะ downTyped / downEdited ตรงนี้ — เรท 2 ต้องเปิดที่ค่าตั้งต้นจนกว่าลูกค้าจะพิมพ์เอง
  const seedDown =
    initialDown != null && Number.isInteger(initialDown) && initialDown > 0
      ? Math.min(initialDown, Math.floor((installmentPrice * MAX_DOWN_PCT) / 100))
      : null;
  // งวดจากการ์ด: ใส่เป็นค่าเริ่มต้นของเรท 1 เท่านั้น — ถ้าไม่อยู่ใน allowedMonths effect ด้านล่างจัดการเอง
  const seedMonths =
    initialMonths != null && Number.isInteger(initialMonths) && initialMonths > 0
      ? initialMonths
      : INITIAL_MONTHS;
  const [months, setMonths] = useState(seedMonths);
  const [termOptions, setTermOptions] = useState<number[]>([seedMonths]);
  // GFIN: null = ยังไม่เลือก → ให้ server ใช้งวดตั้งต้นของเครื่อง (งวดเรท 2 ของราคากลาง / เพดานกติกา OVER)
  const [gfinMonths, setGfinMonths] = useState<number | null>(null);
  const [gfinTerms, setGfinTerms] = useState<{ options: number[]; defaultMonths: number | null }>({
    options: [],
    defaultMonths: null,
  });
  const [downPct, setDownPct] = useState(
    seedDown != null ? Math.round((seedDown / installmentPrice) * 100) : DEFAULT_DOWN_PCT,
  );
  const [downMode, setDownMode] = useState<'PCT' | 'AMOUNT'>(seedDown != null ? 'AMOUNT' : 'PCT');
  const [downAmountInput, setDownAmountInput] = useState<number | null>(seedDown);
  const [minDownPct, setMinDownPct] = useState(DEFAULT_DOWN_PCT);
  // เรท 2 เปิดที่ค่าตั้งต้นของมัน (ตรงกับการ์ดหน้ารวม) จนกว่าลูกค้าจะแก้ช่องเงินดาวน์ในหน้านี้เอง
  // downTyped = ลูกค้าพิมพ์แล้ว · downEdited = ค่าที่พิมพ์ถูก commit แล้ว (ไม่ยิงคำขอเรท 2 ตั้งแต่ตัวอักษรแรก)
  const downTyped = useRef(false);
  const [downEdited, setDownEdited] = useState(false);
  const markDownTyped = useCallback(() => {
    downTyped.current = true;
  }, []);
  const commitPct = useCallback((value: number) => {
    if (downTyped.current) setDownEdited(true);
    setDownMode('PCT');
    setDownPct(value);
    setDownAmountInput(null);
  }, []);
  const commitAmount = useCallback(
    (value: number) => {
      if (downTyped.current) setDownEdited(true);
      setDownMode('AMOUNT');
      setDownAmountInput(value);
      setDownPct(Math.round((value / installmentPrice) * 100));
    },
    [installmentPrice],
  );

  const quotes = useQueries({
    queries: (['BC', 'GFIN'] as const).map((provider) => {
      const term = provider === 'BC' ? months : gfinMonths;
      // เรท 1 ใช้เงินดาวน์ในช่องเสมอ · เรท 2 ใช้เมื่อลูกค้าแก้ช่องแล้วเท่านั้น
      const sendDown = provider === 'BC' || downEdited;
      return {
        queryKey: [
          'shop-installment-options',
          productId,
          installmentPrice,
          provider,
          term,
          sendDown ? downPct : null,
          sendDown ? downMode : null,
          sendDown ? downAmountInput : null,
        ],
        queryFn: async ({ signal }: { signal: AbortSignal }) => {
          // Endpoint expects a fraction; exact baht are also sent to BOTH providers once edited.
          const params = new URLSearchParams({ productId, provider });
          if (sendDown) {
            params.set('downPct', String(downPct / 100));
            if (downMode === 'AMOUNT' && downAmountInput != null)
              params.set('customDownAmount', String(downAmountInput));
          }
          if (term != null) params.set('months', String(term));
          const { data } = await api.get<PreviewResponse>(
            `/api/shop/installment-preview?${params}`,
            {
              signal,
            },
          );
          return data;
        },
        retry: false,
      };
    }),
  });
  const bcResult = quotes[0].data;
  const gfinResult = quotes[1].data;
  const loading = quotes.some((query) => query.isFetching || query.isPending);
  const hasError = quotes.some((query) => query.isError);
  const anyAvailable = quotes.some((query) => query.data?.available);
  useEffect(() => {
    if (bcResult?.minDownPct != null) setMinDownPct(bcResult.minDownPct);
  }, [bcResult?.minDownPct]);
  // เลือกได้เฉพาะงวดที่ตั้งค่าดอกเบี้ยมีอัตรา · งวดที่เลือกอยู่ไม่มีแล้ว → 12 ถ้ามี ไม่งั้นงวดแรก
  useEffect(() => {
    const allowed = bcResult?.allowedMonths;
    if (!allowed || allowed.length === 0) return;
    setTermOptions(allowed);
    setMonths((current) =>
      allowed.includes(current) ? current : allowed.includes(12) ? 12 : allowed[0],
    );
  }, [bcResult?.allowedMonths]);
  // งวดของ GFIN มาจากคำตอบ GFIN (ไม่ใช่งวดของตั้งค่าดอกเบี้ย BESTCHOICE)
  useEffect(() => {
    const allowed = gfinResult?.allowedMonths;
    if (!allowed || allowed.length === 0) return;
    setGfinTerms({ options: allowed, defaultMonths: gfinResult?.defaultMonths ?? null });
    setGfinMonths((current) => (current == null || allowed.includes(current) ? current : null));
  }, [gfinResult?.allowedMonths, gfinResult?.defaultMonths]);
  const effectiveDownAmount =
    bcResult?.downAmount ??
    downAmountInput ??
    minDownAmountFromPct(installmentPrice, downPct / 100);

  return (
    <Card>
      <CardHeader>
        <CardTitle>เลือกการผ่อน</CardTitle>
      </CardHeader>
      <CardBody className="space-y-4">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
          <DownPaymentInput
            installmentPrice={installmentPrice}
            minDownPct={minDownPct}
            pct={downPct}
            amount={effectiveDownAmount}
            onCommitPct={commitPct}
            onCommitAmount={commitAmount}
            onUserEdit={markDownTyped}
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
          <QuoteOption
            label={PROVIDER_LABEL.BC}
            query={quotes[0]}
            badges={compareBadges(bcResult, gfinResult)}
            term={
              <TermSelect provider="BC" options={termOptions} value={months} onChange={setMonths} />
            }
          />
          <QuoteOption
            label={PROVIDER_LABEL.GFIN}
            query={quotes[1]}
            badges={compareBadges(gfinResult, bcResult)}
            term={
              <TermSelect
                provider="GFIN"
                options={gfinTerms.options}
                value={gfinMonths ?? gfinTerms.defaultMonths ?? gfinResult?.months ?? null}
                onChange={setGfinMonths}
              />
            }
          />
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
