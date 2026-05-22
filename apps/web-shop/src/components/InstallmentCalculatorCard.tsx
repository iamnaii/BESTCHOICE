import { useState, useEffect } from 'react';
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

export function InstallmentCalculatorCard({ productId, installmentPrice }: Props) {
  const [months, setMonths] = useState(12);
  const [downPct, setDownPct] = useState(15);
  const [bcResult, setBcResult] = useState<PreviewResponse | null>(null);
  const [gfinResult, setGfinResult] = useState<PreviewResponse | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!installmentPrice) return;
    const params = new URLSearchParams({
      productId,
      months: String(months),
      downPct: String(downPct / 100),
    });
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
  }, [productId, months, downPct, installmentPrice]);

  // Hide the entire card if no installment price
  if (!installmentPrice) return null;

  // Hide if BOTH providers unavailable (after data loaded)
  const bothUnavailable = bcResult?.available === false && gfinResult?.available === false;
  if (bcResult && gfinResult && bothUnavailable) return null;

  const anyAvailable = bcResult?.available || gfinResult?.available;

  return (
    <Card>
      <CardHeader>
        <CardTitle>เลือกการผ่อน</CardTitle>
      </CardHeader>
      <CardBody className="space-y-4">
        {/* Controls */}
        <div className="flex flex-wrap gap-4 items-center">
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

          <div className="flex items-center gap-2">
            <label htmlFor="downpct-input" className="text-sm font-medium">
              ดาวน์ (%):
            </label>
            <input
              id="downpct-input"
              type="number"
              value={downPct}
              min={15}
              max={90}
              step={5}
              onChange={(e) => setDownPct(Number(e.target.value))}
              className="border border-border rounded-md px-2 py-1 text-sm w-20 bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>
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
        <Button
          variant="primary"
          size="md"
          onClick={() => {
            window.location.href = '/shop/installment-apply';
          }}
        >
          สมัครผ่อนออนไลน์ →
        </Button>
      </CardBody>
    </Card>
  );
}
