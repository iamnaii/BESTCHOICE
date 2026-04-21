import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import ShopLayout from '../components/layout/ShopLayout';
import OrderCard from '../components/orders/OrderCard';

interface OrderListItem {
  id: string;
  orderNumber: string;
  status: string;
  totalAmount: number | string;
  product: { name: string; gallery: string[] };
}

export default function OrdersPage() {
  const { data } = useQuery({
    queryKey: ['my-orders'],
    queryFn: () => api.get('/api/shop/orders').then((r) => r.data as OrderListItem[]),
  });

  return (
    <ShopLayout>
      <div className="container mx-auto px-4 py-6 space-y-3 max-w-2xl leading-snug">
        <h1 className="text-2xl font-bold mb-2">คำสั่งซื้อของฉัน</h1>
        {(data ?? []).map((o) => (
          <OrderCard key={o.id} order={o} />
        ))}
        {data && data.length === 0 && (
          <div className="text-muted-foreground">ยังไม่มีคำสั่งซื้อ</div>
        )}
      </div>
    </ShopLayout>
  );
}
