import { useEffect, useRef } from 'react';
import { Link, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2 } from 'lucide-react';
import { api } from '../lib/api';
import ShopLayout from '../components/layout/ShopLayout';
import OrderStatusBadge from '../components/orders/OrderStatusBadge';
import { useCartStore } from '../stores/cartStore';
import { useTrackEvent } from '../hooks/useTrackEvent';
import { Container, Stack, Card, CardBody, Button } from '@/components';
import { copy } from '@/lib/copy';

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
        <Container>
          <div className="py-10 text-muted-foreground leading-snug">{copy.common.loading}</div>
        </Container>
      </ShopLayout>
    );
  }

  const isPending = data.status === 'PENDING_PAYMENT';

  return (
    <ShopLayout>
      <Container narrow>
        <div className="py-10">
          <Stack gap={6} className="items-center text-center leading-snug">
            <CheckCircle2 className="size-20 text-emerald-500" aria-hidden="true" />
            <h1 className="text-3xl font-bold">{copy.orderSuccess.pageTitle}</h1>
            <OrderStatusBadge status={data.status} />

            <Card variant="outlined" className="w-full text-left">
              <CardBody>
                <Stack gap={2}>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground text-sm">
                      {copy.orderSuccess.orderNumberLabel}
                    </span>
                    <span className="font-semibold">{data.orderNumber}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground text-sm">
                      {copy.orderSuccess.totalLabel}
                    </span>
                    <span className="font-bold">
                      ฿{Number(data.totalAmount ?? 0).toLocaleString()}
                    </span>
                  </div>
                  {data.paymentChannel && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground text-sm">
                        {copy.orderSuccess.paymentChannelLabel}
                      </span>
                      <span className="font-medium">{data.paymentChannel}</span>
                    </div>
                  )}
                </Stack>
              </CardBody>
            </Card>

            <Card variant="outlined" className="w-full text-left">
              <CardBody>
                <div className="font-semibold mb-3">{copy.orderSuccess.nextStepsTitle}</div>
                <ol className="space-y-2 text-sm leading-snug">
                  <li className="flex gap-3">
                    <span className="size-6 shrink-0 rounded-full bg-emerald-100 text-emerald-700 inline-flex items-center justify-center text-xs font-semibold">
                      1
                    </span>
                    <span>{copy.orderSuccess.nextStep1}</span>
                  </li>
                  <li className="flex gap-3">
                    <span className="size-6 shrink-0 rounded-full bg-emerald-100 text-emerald-700 inline-flex items-center justify-center text-xs font-semibold">
                      2
                    </span>
                    <span>{copy.orderSuccess.nextStep2}</span>
                  </li>
                  <li className="flex gap-3">
                    <span className="size-6 shrink-0 rounded-full bg-emerald-100 text-emerald-700 inline-flex items-center justify-center text-xs font-semibold">
                      3
                    </span>
                    <span>{copy.orderSuccess.nextStep3}</span>
                  </li>
                </ol>
                <div className="mt-4 text-sm text-muted-foreground">
                  {isPending ? copy.orderSuccess.pendingPaymentNote : copy.orderSuccess.paidNote}
                </div>
              </CardBody>
            </Card>

            <div className="flex flex-col sm:flex-row gap-3 w-full pt-2">
              <Button asChild variant="primary" size="lg" fullWidth>
                <Link to={`/orders/${data.orderNumber}`}>{copy.orderSuccess.viewOrderCta}</Link>
              </Button>
              <Button asChild variant="outline" size="lg" fullWidth>
                <Link to="/">{copy.orderSuccess.continueShoppingCta}</Link>
              </Button>
            </div>
          </Stack>
        </div>
      </Container>
    </ShopLayout>
  );
}
