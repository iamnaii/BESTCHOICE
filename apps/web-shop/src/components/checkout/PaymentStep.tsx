import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '../../lib/api';
import { Button } from '../ui/button';
import PromoCodeInput from './PromoCodeInput';
import LoyaltyPointsInput from './LoyaltyPointsInput';
import PaymentMethodPicker from './PaymentMethodPicker';
import OrderSummaryCard from './OrderSummaryCard';
import type { PaymentChannel } from '../../types/order';
import type { ShippingAddress, ShippingMethod } from '../../types/shipping';

interface Props {
  reservationId: string;
  productPrice: number;
  shippingMethod: ShippingMethod;
  shippingFee: number;
  shippingAddress: ShippingAddress;
  onBack: () => void;
  onPlaced: (orderNumber: string, paymentUrl?: string) => void;
}

export default function PaymentStep(p: Props) {
  const [promoCode, setPromoCode] = useState<string | null>(null);
  const [promoDiscount, setPromoDiscount] = useState(0);
  const [loyaltyPoints, setLoyaltyPoints] = useState(0);
  const [loyaltyDiscount, setLoyaltyDiscount] = useState(0);
  const [channel, setChannel] = useState<PaymentChannel | null>(null);

  const placeMut = useMutation({
    mutationFn: () =>
      api
        .post('/api/shop/checkout/place', {
          reservationId: p.reservationId,
          shippingMethod: p.shippingMethod,
          shippingAddress: p.shippingAddress,
          paymentChannel: channel,
          promoCode: promoCode ?? undefined,
          loyaltyPointsRedeemed: loyaltyPoints || undefined,
        })
        .then((r) => r.data as { orderNumber: string; paymentUrl?: string }),
    onSuccess: (res) => {
      toast.success('สร้างคำสั่งซื้อสำเร็จ');
      p.onPlaced(res.orderNumber, res.paymentUrl);
    },
    onError: (e: { response?: { data?: { message?: string } } }) =>
      toast.error(e.response?.data?.message ?? 'สร้างคำสั่งซื้อไม่สำเร็จ'),
  });

  return (
    <div className="grid md:grid-cols-3 gap-6 leading-snug">
      <div className="md:col-span-2 space-y-6">
        <h2 className="text-xl font-bold">ชำระเงิน</h2>
        <PromoCodeInput
          reservationId={p.reservationId}
          onDiscount={(amt, code) => {
            setPromoDiscount(amt);
            setPromoCode(code);
          }}
        />
        <LoyaltyPointsInput
          reservationId={p.reservationId}
          onDiscount={(amt, pts) => {
            setLoyaltyDiscount(amt);
            setLoyaltyPoints(pts);
          }}
        />
        <PaymentMethodPicker value={channel} onChange={setChannel} />
      </div>
      <div className="space-y-4">
        <OrderSummaryCard
          productPrice={p.productPrice}
          shippingFee={p.shippingFee}
          promoDiscount={promoDiscount}
          loyaltyDiscount={loyaltyDiscount}
        />
        <div className="flex gap-2">
          <Button variant="outline" onClick={p.onBack}>
            ย้อน
          </Button>
          <Button
            className="flex-1"
            disabled={!channel || placeMut.isPending}
            onClick={() => placeMut.mutate()}
          >
            {placeMut.isPending ? 'กำลังดำเนินการ...' : 'สั่งซื้อ'}
          </Button>
        </div>
      </div>
    </div>
  );
}
