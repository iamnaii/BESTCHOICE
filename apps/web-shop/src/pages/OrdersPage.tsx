import { useQuery } from '@tanstack/react-query';
import { Package } from 'lucide-react';
import { api } from '../lib/api';
import ShopLayout from '../components/layout/ShopLayout';
import OrderCard from '../components/orders/OrderCard';
import { CategoryHero, Container, StatefulList } from '@/components';
import { copy } from '@/lib/copy';

interface OrderListItem {
  id: string;
  orderNumber: string;
  status: string;
  totalAmount: number | string;
  product: { name: string; gallery: string[] };
}

export default function OrdersPage() {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['my-orders'],
    queryFn: () => api.get('/api/shop/orders').then((r) => r.data as OrderListItem[]),
  });

  return (
    <ShopLayout>
      <CategoryHero
        title={copy.orders.pageTitle}
        breadcrumbs={[
          { label: 'หน้าแรก', to: '/' },
          { label: copy.orders.pageTitle },
        ]}
      />
      <Container>
        <div className="py-6 leading-snug">
          <StatefulList
            loadingVariant="list"
            isLoading={isLoading}
            isError={isError}
            data={data}
            onRetry={() => refetch()}
            emptyState={{
              icon: <Package className="size-12" aria-hidden="true" />,
              title: copy.orders.emptyTitle,
              description: copy.orders.emptyDescription,
              cta: { label: copy.common.viewAll, to: '/products' },
            }}
            renderItem={(o) => <OrderCard key={o.id} order={o} />}
            wrapperClassName="space-y-3"
          />
        </div>
      </Container>
    </ShopLayout>
  );
}
