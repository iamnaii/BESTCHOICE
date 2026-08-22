import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router';
import { Card, CardHeader, CardBody, CardTitle, Badge, Button } from '@/components';

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
    'border border-border rounded-md px-2 py-1 text-sm bg-background text-foreground ' +
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

export function InstallmentCalculatorCard({ productId, installmentPrice }: Props) {
  const nav = useNavigate();
  const [months, setMonths] = useState(12);
  const [downPct, setDownPct] = useState(DEFAULT_DOWN_PCT);
  /**
   * Which box the shopper last committed. Typing baht sends `customDownAmount`
   * so the quote uses that exact figure — deriving a percentage from it would
   * come back as ฿4,998.67 when they asked for ฿5,000.
   */
  const [downMode, setDownMode] = useState<'PCT' | 'AMOUNT'>('PCT');
  const [downAmountInput, setDownAmountInput] = useState<number | null>(null);
  const [bcResult, setBcResult] = useState<PreviewResponse | null>(null);
  const [gfinResult, setGfinResult] = useState<PreviewResponse | null>(null);
  const [loading, setLoading] = useState(false);

  const commitPct = useCallback((v: number) => {
    setDownMode('PCT');
    setDownPct(v);
    setDownAmountInput(null);
  }, []);
  const commitAmount = useCallback(
    (v: number) => {
      setDownMode('AMOUNT');
      setDownAmountInput(v);
      if (installmentPrice) setDownPct(Math.round((v / installmentPrice) * 100));
    },
    [installmentPrice],
  );

  useEffect(() => {
    if (!installmentPrice) return;
    const params = new URLSearchParams({ productId, months: String(months) });
    // NOTE: this endpoint takes downPct as a FRACTION (0.15), unlike
    // /shop/products which takes a percent. Do not "tidy" one to match.
    //
    // downPct always goes along, even when the shopper typed baht: BC prefers
    // customDownAmount and quotes the exact figure, while GFIN has no
    // customDownAmount path at all and would otherwise fall back to its own
    // hardcoded 30% — leaving the two cards compared at different terms.
    params.set('downPct', String(downPct / 100));
    if (downMode === 'AMOUNT' && downAmountInput != null) {
      params.set('customDownAmount', String(downAmountInput));
    }
    let cancelled = false;
    const fetchBoth = async () => {
      setLoading(true);
      try {
        const [bc, gfin] = await Promise.all([
          fetch(`/api/shop/installment-preview?${params.toString()}&provider=BC`).then((r) =>
            r.json(),
          ),
          fetch(`/api/shop/installment-preview?${params.toString()}&provider=GFIN`).then((r) =>
            r.json(),
          ),
        ]);
        if (!cancelled) {
          setBcResult(bc as PreviewResponse);
          setGfinResult(gfin as PreviewResponse);
        }
      } catch {
        if (!cancelled) {
          setBcResult({ available: false });
          setGfinResult({ available: false });
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void fetchBoth();
    return () => {
      cancelled = true;
    };
  }, [productId, months, downPct, downMode, downAmountInput, installmentPrice]);

  // Hide the entire card if no installment price
  if (!installmentPrice) return null;

  // Hide if BOTH providers unavailable (after data loaded)
  const bothUnavailable = bcResult?.available === false && gfinResult?.available === false;
  if (bcResult && gfinResult && bothUnavailable) return null;

  const anyAvailable = bcResult?.available || gfinResult?.available;
  // The floor comes from whichever BC answer we last got — valid or not, the
  // API sends it — and only falls back while the very first request is in
  // flight. Never a hardcoded percentage.
  const minDownPct = bcResult?.minDownPct ?? DEFAULT_DOWN_PCT;
  // Show what the quote actually used, not what was typed: the API clamps.
  const effectiveDownAmount =
    bcResult?.downAmount ?? downAmountInput ?? Math.round((installmentPrice * downPct) / 100);

  return (
    <Card>
      <CardHeader>
        <CardTitle>เลือกการผ่อน</CardTitle>
      </CardHeader>
      <CardBody className="space-y-4">
        {/* Controls */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
          <div className="flex items-center gap-2">
            <label htmlFor="months-select" className="text-sm font-medium">
              จำนวนงวด:
            </label>
            <select
              id="months-select"
              value={months}
              onChange={(e) => setMonths(Number(e.target.value))}
              className="border border-border rounded-md px-2 py-1 text-sm bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
            >
              {MONTHS_OPTIONS.map((m) => (
                <option key={m} value={m}>
                  {m} งวด
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

        {/* Results */}
        {loading && (
          <div className="grid md:grid-cols-2 gap-3">
            {[0, 1].map((i) => (
              <div key={i} className="rounded-xl border border-border p-4 space-y-2">
                <div className="h-4 bg-muted animate-pulse rounded w-1/3" />
                <div className="h-8 bg-muted animate-pulse rounded w-2/3" />
                <div className="h-3 bg-muted animate-pulse rounded w-1/2" />
              </div>
            ))}
          </div>
        )}

        {!loading && anyAvailable && (
          <div className="grid md:grid-cols-2 gap-3">
            {bcResult?.available && (
              <div className="rounded-xl border-2 border-emerald-300 bg-emerald-50 p-4 space-y-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-emerald-700">BESTCHOICE</span>
                  <Badge variant="success" size="sm">
                    ของเรา
                  </Badge>
                </div>
                <div className="text-2xl font-bold text-emerald-700 leading-snug">
                  ฿{formatTHB(bcResult.monthlyPayment ?? 0)}
                  <span className="text-sm font-normal text-emerald-600"> / เดือน</span>
                </div>
                <div className="text-xs text-emerald-600 leading-snug">
                  ดาวน์: ฿{formatTHB(bcResult.downAmount ?? 0)}
                </div>
              </div>
            )}

            {gfinResult?.available && (
              <div className="rounded-xl border-2 border-blue-300 bg-blue-50 p-4 space-y-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-blue-700">GFIN</span>
                  <Badge variant="outline" size="sm">
                    ไฟแนนซ์นอก
                  </Badge>
                </div>
                <div className="text-2xl font-bold text-blue-700 leading-snug">
                  ฿{formatTHB(gfinResult.monthlyPayment ?? 0)}
                  <span className="text-sm font-normal text-blue-600"> / เดือน</span>
                </div>
                <div className="text-xs text-blue-600 leading-snug">
                  ดาวน์: ฿{formatTHB(gfinResult.downAmount ?? 0)}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Disclaimer */}
        <p className="text-xs text-muted-foreground leading-snug">
          ค่างวดข้างต้นเป็นการประมาณการ — ราคาจริงเป็นไปตามสัญญาที่ลงนาม
        </p>

        {/* CTA */}
        <Button variant="primary" size="md" onClick={() => nav(`/apply/${productId}`)}>
          สมัครผ่อนออนไลน์ →
        </Button>
      </CardBody>
    </Card>
  );
}
