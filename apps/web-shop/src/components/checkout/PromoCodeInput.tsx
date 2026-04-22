import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';
import { api } from '../../lib/api';
import { Input } from '../ui/input';
import { Button } from '../ui/button';

interface Props {
  reservationId: string;
  onDiscount: (amount: number, code: string | null) => void;
}

export default function PromoCodeInput({ reservationId, onDiscount }: Props) {
  const [code, setCode] = useState('');
  const mut = useMutation({
    mutationFn: () =>
      api
        .post('/api/shop/checkout/validate-promo', { code, reservationId })
        .then((r) => r.data as { valid: boolean; reason?: string; discountAmount: number }),
    onSuccess: (res) => {
      if (res.valid) {
        toast.success(`ใช้โค้ดได้ ส่วนลด ฿${res.discountAmount.toLocaleString()}`);
        onDiscount(res.discountAmount, code);
      } else {
        toast.error(res.reason ?? 'โค้ดใช้ไม่ได้');
        onDiscount(0, null);
      }
    },
    onError: () => toast.error('ตรวจสอบโค้ดไม่สำเร็จ'),
  });

  return (
    <div className="space-y-2 leading-snug">
      <div className="text-sm font-medium">โค้ดส่วนลด</div>
      <div className="flex gap-2">
        <Input
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          placeholder="ใส่โค้ด"
        />
        <Button onClick={() => mut.mutate()} disabled={!code || mut.isPending}>
          ใช้โค้ด
        </Button>
      </div>
    </div>
  );
}
