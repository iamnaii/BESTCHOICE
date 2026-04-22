import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router';
import { toast } from 'sonner';
import { ArrowRight } from 'lucide-react';
import { api } from '@/lib/api';
import { copy } from '@/lib/copy';
import ShopLayout from '@/components/layout/ShopLayout';
import DeviceSelector, {
  type DeviceSelectorValue,
} from '@/components/device-submit/DeviceSelector';
import ValuationDisplay from '@/components/device-submit/ValuationDisplay';
import {
  Button,
  Card,
  CardBody,
  CategoryHero,
  Container,
  Label,
  StickyBottomBar,
  StickyBottomBarSpacer,
} from '@/components';
import type { BuybackEstimate } from '@/types/buyback';

const CONDITIONS: Array<{ v: 'A' | 'B' | 'C'; label: string; desc: string }> = [
  { v: 'A', label: 'เกรด A', desc: 'เหมือนใหม่ ไม่มีรอย' },
  { v: 'B', label: 'เกรด B', desc: 'มีรอยใช้งานเล็กน้อย' },
  { v: 'C', label: 'เกรด C', desc: 'มีรอยหรือตำหนิชัดเจน' },
];

export default function BuybackQuickQuotePage() {
  const nav = useNavigate();
  const [device, setDevice] = useState<DeviceSelectorValue>({
    brand: '',
    model: '',
    storage: '',
  });
  const [condition, setCondition] = useState<'A' | 'B' | 'C'>('A');
  const [quote, setQuote] = useState<BuybackEstimate | null>(null);

  const deviceReady = !!(device.brand && device.model && device.storage);

  const quickQuote = useMutation({
    mutationFn: () =>
      api
        .post<BuybackEstimate>('/api/shop/buyback/quick-quote', {
          brand: device.brand,
          model: device.model,
          storage: device.storage,
          condition,
        })
        .then((r) => r.data),
    onSuccess: (data) => setQuote(data),
    onError: (e: { response?: { data?: { message?: string } } }) =>
      toast.error(e.response?.data?.message ?? copy.buyback.quoteError),
  });

  const goSubmit = () => {
    const qs = new URLSearchParams({
      brand: device.brand,
      model: device.model,
      storage: device.storage,
      condition,
    }).toString();
    nav(`/buyback/submit?${qs}`);
  };

  const quoteLabel = quickQuote.isPending ? 'กำลังประเมิน...' : copy.buyback.quoteCta;

  return (
    <ShopLayout>
      <CategoryHero
        title="ตีราคาเบื้องต้น"
        breadcrumbs={[
          { label: copy.buyback.pageTitle, to: '/buyback' },
          { label: 'ตีราคา' },
        ]}
      />

      <Container narrow className="py-6 md:py-10 space-y-6 leading-snug">
        <Card variant="elevated">
          <CardBody className="space-y-6 leading-snug">
            <section className="space-y-3">
              <h2 className="font-semibold leading-snug">1. เลือกเครื่อง</h2>
              <DeviceSelector value={device} onChange={setDevice} />
            </section>

            <section className="space-y-3">
              <Label>2. สภาพเครื่อง</Label>
              <div
                className="grid sm:grid-cols-3 gap-2"
                role="radiogroup"
                aria-label="สภาพเครื่อง"
              >
                {CONDITIONS.map((c) => {
                  const selected = condition === c.v;
                  return (
                    <button
                      key={c.v}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      onClick={() => setCondition(c.v)}
                      className={`rounded-xl border p-3 text-left leading-snug transition-colors ${
                        selected
                          ? 'border-emerald-500 bg-emerald-50'
                          : 'border-zinc-200 hover:bg-accent'
                      }`}
                    >
                      <div className="font-semibold leading-snug">{c.label}</div>
                      <div className="text-xs text-muted-foreground leading-snug">
                        {c.desc}
                      </div>
                    </button>
                  );
                })}
              </div>
            </section>

            <div className="hidden md:block">
              <Button
                onClick={() => quickQuote.mutate()}
                disabled={!deviceReady || quickQuote.isPending}
                loading={quickQuote.isPending}
                variant="primary"
                size="lg"
                fullWidth
              >
                {quoteLabel}
              </Button>
            </div>
          </CardBody>
        </Card>

        {quote && (
          <Card variant="outlined">
            <CardBody className="space-y-4 leading-snug">
              <Label>ผลประเมินเบื้องต้น</Label>
              <ValuationDisplay
                min={quote.min}
                max={quote.max}
                available={quote.available}
              />
              <div className="grid gap-3 sm:grid-cols-2">
                <Button
                  onClick={goSubmit}
                  variant="primary"
                  size="lg"
                  fullWidth
                >
                  {copy.buyback.realPriceCta}
                  <ArrowRight className="size-4" aria-hidden="true" />
                </Button>
                <Button asChild variant="outline" size="lg" fullWidth>
                  <Link to="/buyback">กลับ</Link>
                </Button>
              </div>
            </CardBody>
          </Card>
        )}
      </Container>

      <StickyBottomBar>
        <Button
          onClick={() => quickQuote.mutate()}
          disabled={!deviceReady || quickQuote.isPending}
          loading={quickQuote.isPending}
          variant="primary"
          size="lg"
          fullWidth
        >
          {quoteLabel}
        </Button>
      </StickyBottomBar>
      <StickyBottomBarSpacer />
    </ShopLayout>
  );
}
