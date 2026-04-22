import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import ShopLayout from '@/components/layout/ShopLayout';
import DeviceSelector, {
  type DeviceSelectorValue,
} from '@/components/device-submit/DeviceSelector';
import ValuationDisplay from '@/components/device-submit/ValuationDisplay';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
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
      toast.error(e.response?.data?.message ?? 'ประเมินราคาไม่สำเร็จ'),
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

  return (
    <ShopLayout>
      <div className="container mx-auto px-4 py-6 max-w-xl space-y-6 leading-snug">
        <header className="space-y-1">
          <h1 className="text-2xl font-bold">เช็คราคารับซื้อ</h1>
          <p className="text-sm text-muted-foreground">
            เลือกรุ่น + ความจุ + สภาพ เพื่อรับช่วงราคาประเมินทันที
          </p>
        </header>

        <section className="space-y-3">
          <h2 className="font-semibold">1. เลือกเครื่อง</h2>
          <DeviceSelector value={device} onChange={setDevice} />
        </section>

        <section className="space-y-3">
          <h2 className="font-semibold">2. สภาพเครื่อง</h2>
          <div className="grid sm:grid-cols-3 gap-2" role="radiogroup" aria-label="สภาพเครื่อง">
            {CONDITIONS.map((c) => (
              <button
                key={c.v}
                type="button"
                role="radio"
                aria-checked={condition === c.v}
                onClick={() => setCondition(c.v)}
                className={`rounded-xl border p-3 text-left ${
                  condition === c.v
                    ? 'border-primary bg-primary/10'
                    : 'border-border hover:bg-accent'
                }`}
              >
                <div className="font-semibold">{c.label}</div>
                <div className="text-xs text-muted-foreground">{c.desc}</div>
              </button>
            ))}
          </div>
        </section>

        <Button
          onClick={() => quickQuote.mutate()}
          disabled={!deviceReady || quickQuote.isPending}
          size="lg"
          className="w-full"
        >
          {quickQuote.isPending ? 'กำลังประเมิน...' : 'รับราคาประเมิน'}
        </Button>

        {quote && (
          <div className="space-y-3">
            <Label>ผลประเมิน</Label>
            <ValuationDisplay min={quote.min} max={quote.max} available={quote.available} />
            <Button onClick={goSubmit} size="lg" className="w-full">
              ดำเนินการต่อ — ส่งรูปเพื่อรับราคาจริง
            </Button>
            <Button asChild variant="outline" className="w-full">
              <Link to="/buyback">กลับ</Link>
            </Button>
          </div>
        )}
      </div>
    </ShopLayout>
  );
}
