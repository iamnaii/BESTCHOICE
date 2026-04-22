import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../../lib/api';
import type { ShippingMethod, ShippingQuote } from '../../types/shipping';
import { Button } from '../ui/button';

interface Props {
  onNext: (method: ShippingMethod, fee: number) => void;
  onBack: () => void;
}

export default function ShippingStep({ onNext, onBack }: Props) {
  const { data } = useQuery({
    queryKey: ['shipping-methods'],
    queryFn: () => api.get('/api/shop/shipping/methods').then((r) => r.data as ShippingQuote[]),
  });
  const [selected, setSelected] = useState<ShippingMethod | null>(null);
  const methods = data ?? [];
  const picked = methods.find((m) => m.method === selected);

  return (
    <div className="space-y-4 leading-snug">
      <h2 className="text-xl font-bold">วิธีจัดส่ง</h2>
      <div className="space-y-2">
        {methods.map((m) => (
          <button
            key={m.method}
            type="button"
            onClick={() => setSelected(m.method)}
            className={`w-full text-left rounded-xl border p-4 transition-colors ${
              selected === m.method ? 'border-primary bg-primary/5' : 'border-border'
            }`}
          >
            <div className="flex justify-between items-center">
              <div>
                <div className="font-semibold">{m.label}</div>
                <div className="text-sm text-muted-foreground">{m.etaDays}</div>
              </div>
              <div className="font-bold">{m.fee === 0 ? 'ฟรี' : `฿${m.fee}`}</div>
            </div>
          </button>
        ))}
      </div>
      <div className="flex gap-2">
        <Button variant="outline" onClick={onBack}>
          ย้อนกลับ
        </Button>
        <Button disabled={!picked} onClick={() => picked && onNext(picked.method, picked.fee)}>
          ดำเนินการต่อ
        </Button>
      </div>
    </div>
  );
}
