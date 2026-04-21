import { useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import ShopLayout from '../components/layout/ShopLayout';
import OrderStatusBadge from '../components/orders/OrderStatusBadge';
import OrderTimeline from '../components/orders/OrderTimeline';

export default function OrderDetailPage() {
  const { orderNumber } = useParams<{ orderNumber: string }>();
  const { data } = useQuery({
    queryKey: ['order', orderNumber],
    queryFn: () => api.get(`/api/shop/orders/${orderNumber}`).then((r) => r.data),
    enabled: !!orderNumber,
    refetchInterval: 10000,
  });
  if (!data) {
    return (
      <ShopLayout>
        <div className="p-8 text-muted-foreground">กำลังโหลด...</div>
      </ShopLayout>
    );
  }
  const addr = data.shippingAddress;
  return (
    <ShopLayout>
      <div className="container mx-auto px-4 py-6 space-y-4 max-w-2xl leading-snug">
        <div className="flex justify-between items-start">
          <div>
            <h1 className="text-xl font-bold">{data.orderNumber}</h1>
            <div className="text-sm text-muted-foreground">
              สร้างเมื่อ {new Date(data.createdAt).toLocaleString('th-TH')}
            </div>
          </div>
          <OrderStatusBadge status={data.status} />
        </div>
        <OrderTimeline status={data.status} />
        <div className="rounded-xl border border-border p-4 space-y-1">
          <div className="font-semibold">{data.product.name}</div>
          <div className="flex justify-between">
            <span>ราคาสินค้า</span>
            <span>฿{Number(data.productPrice).toLocaleString()}</span>
          </div>
          <div className="flex justify-between">
            <span>ค่าจัดส่ง ({data.shippingMethod})</span>
            <span>฿{Number(data.shippingFee).toLocaleString()}</span>
          </div>
          {Number(data.promoDiscount) > 0 && (
            <div className="flex justify-between text-primary">
              <span>ส่วนลด ({data.promoCode})</span>
              <span>-฿{Number(data.promoDiscount).toLocaleString()}</span>
            </div>
          )}
          {Number(data.loyaltyDiscount) > 0 && (
            <div className="flex justify-between text-primary">
              <span>ใช้แต้ม {data.loyaltyPointsUsed} แต้ม</span>
              <span>-฿{Number(data.loyaltyDiscount).toLocaleString()}</span>
            </div>
          )}
          <div className="border-t mt-2 pt-2 flex justify-between font-bold">
            <span>รวม</span>
            <span>฿{Number(data.totalAmount).toLocaleString()}</span>
          </div>
        </div>
        {addr && (
          <div className="rounded-xl border border-border p-4 text-sm space-y-1">
            <div className="font-semibold mb-1">ที่อยู่จัดส่ง</div>
            <div>
              {addr.recipientName} · {addr.phone}
            </div>
            <div className="text-muted-foreground">
              {addr.line1} {addr.line2 ?? ''} {addr.subDistrict} {addr.district} {addr.province}{' '}
              {addr.postalCode}
            </div>
          </div>
        )}
        {data.trackingNumber && (
          <div className="rounded-xl border border-border p-4 text-sm space-y-1">
            <div className="font-semibold">หมายเลขพัสดุ</div>
            <div className="text-primary">{data.trackingNumber}</div>
          </div>
        )}
      </div>
    </ShopLayout>
  );
}
