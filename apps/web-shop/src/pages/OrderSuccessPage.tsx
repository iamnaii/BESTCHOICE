import { useEffect, useRef } from 'react';
import { useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import ShopLayout from '../components/layout/ShopLayout';
import OrderStatusBadge from '../components/orders/OrderStatusBadge';
import { useCartStore } from '../stores/cartStore';
import { useTrackEvent } from '../hooks/useTrackEvent';

export default function OrderSuccessPage() {
  const { orderNumber } = useParams<{ orderNumber: string }>();
  const cart = useCartStore();
  const track = useTrackEvent();
  const firedRef = useRef(false);

  const { data } = useQuery({
    queryKey: ['order', orderNumber],
    queryFn: () => api.get(`/api/shop/orders/${orderNumber}`).then((r) => r.data),
    refetchInterval: (query) =>
      query.state.data?.status === 'PENDING_PAYMENT' ? 3000 : false,
    enabled: !!orderNumber,
  });

  useEffect(() => {
    if (data?.status === 'PAID') cart.clear();
    if (data?.status === 'PAID' && !firedRef.current) {
      track('Purchase', { value: Number(data.totalAmount ?? 0), currency: 'THB' });
      firedRef.current = true;
    }
  }, [data?.status, data?.totalAmount, cart, track]);

  if (!data) {
    return (
      <ShopLayout>
        <div className="p-8 text-muted-foreground">กำลังโหลด...</div>
      </ShopLayout>
    );
  }

  return (
    <ShopLayout>
      <div className="container mx-auto px-4 py-8 max-w-xl text-center leading-snug">
        <div className="text-3xl font-bold mb-4">สั่งซื้อสำเร็จ</div>
        <div className="text-lg mb-2">{data.orderNumber}</div>
        <OrderStatusBadge status={data.status} />
        <div className="mt-4 text-muted-foreground">
          {data.status === 'PENDING_PAYMENT'
            ? 'รอชำระเงิน...'
            : 'ทางร้านจะจัดส่งภายใน 1 วันทำการ'}
        </div>
      </div>
    </ShopLayout>
  );
}
