import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';
import { api } from '../../lib/api';
import { Input } from '../ui/input';
import { Button } from '../ui/button';
import { useAuth } from '../../hooks/useAuth';

interface Props {
  reservationId: string;
  onDiscount: (amount: number, points: number) => void;
}

export default function LoyaltyPointsInput({ reservationId, onDiscount }: Props) {
  const { customer } = useAuth();
  const balance = customer?.loyaltyBalance ?? 0;
  const [pts, setPts] = useState('');
  const mut = useMutation({
    mutationFn: () =>
      api
        .post('/api/shop/checkout/apply-loyalty', { reservationId, points: Number(pts) })
        .then((r) => r.data as { valid: boolean; reason?: string; discountAmount: number }),
    onSuccess: (res) => {
      if (res.valid) {
        toast.success(`ใช้ ${pts} แต้ม ลด ฿${res.discountAmount.toLocaleString()}`);
        onDiscount(res.discountAmount, Number(pts));
      } else {
        toast.error(res.reason ?? 'ใช้แต้มไม่ได้');
        onDiscount(0, 0);
      }
    },
  });

  return (
    <div className="space-y-2 leading-snug">
      <div className="text-sm font-medium">
        แต้มสะสม (ยอด: {balance.toLocaleString()} แต้ม — 1 แต้ม = 1฿)
      </div>
      <div className="flex gap-2">
        <Input
          type="number"
          value={pts}
          onChange={(e) => setPts(e.target.value)}
          placeholder="0"
          min="0"
          max={balance.toString()}
        />
        <Button onClick={() => mut.mutate()} disabled={!pts || mut.isPending}>
          ใช้แต้ม
        </Button>
      </div>
    </div>
  );
}
