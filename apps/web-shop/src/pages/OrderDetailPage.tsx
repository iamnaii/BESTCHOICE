import { useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import ShopLayout from '../components/layout/ShopLayout';
import OrderStatusBadge from '../components/orders/OrderStatusBadge';
import {
  CategoryHero,
  Container,
  Stack,
  Card,
  CardBody,
  Stepper,
  type StepperStep,
} from '@/components';
import { copy } from '@/lib/copy';
import { media } from '@/lib/media-placeholders';

// Horizontal Stepper steps derived from status enum:
// PENDING_PAYMENT -> PAID -> PACKING -> SHIPPED -> DELIVERED -> COMPLETED
const STATUS_ORDER = [
  'PENDING_PAYMENT',
  'PAID',
  'PACKING',
  'SHIPPED',
  'DELIVERED',
  'COMPLETED',
] as const;

const STATUS_STEPS: StepperStep[] = [
  { label: 'รอชำระ' },
  { label: 'ชำระแล้ว' },
  { label: 'แพ็คสินค้า' },
  { label: 'จัดส่ง' },
  { label: 'ส่งถึง' },
  { label: 'เสร็จสิ้น' },
];

function statusIndex(status: string): number {
  const i = STATUS_ORDER.indexOf(status as (typeof STATUS_ORDER)[number]);
  return i < 0 ? 1 : i + 1;
}

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
        <Container>
          <div className="py-10 text-muted-foreground leading-snug">{copy.common.loading}</div>
        </Container>
      </ShopLayout>
    );
  }

  const addr = data.shippingAddress;
  const productImg = data.product?.gallery?.[0] ?? media('product.placeholder');

  return (
    <ShopLayout>
      <CategoryHero
        title={`คำสั่งซื้อ ${data.orderNumber}`}
        breadcrumbs={[
          { label: copy.orderDetail.breadcrumbList, to: '/orders' },
          { label: data.orderNumber },
        ]}
      />
      <Container>
        <div className="py-6 leading-snug">
          <Stack gap={6}>
            {/* Header row: status + timestamp */}
            <div className="flex justify-between items-start">
              <div>
                <div className="text-sm text-muted-foreground">
                  สร้างเมื่อ {new Date(data.createdAt).toLocaleString('th-TH')}
                </div>
              </div>
              <OrderStatusBadge status={data.status} />
            </div>

            {/* Status stepper (horizontal) */}
            <Card variant="outlined">
              <CardBody>
                <Stepper steps={STATUS_STEPS} current={statusIndex(data.status)} />
              </CardBody>
            </Card>

            {/* Product card */}
            <Card variant="outlined">
              <CardBody>
                <div className="flex gap-4 leading-snug">
                  <div className="h-20 w-20 rounded-xl overflow-hidden bg-muted shrink-0">
                    <img
                      src={productImg}
                      alt={data.product?.name ?? copy.orderDetail.productTitle}
                      className="h-full w-full object-cover"
                    />
                  </div>
                  <div className="flex-1 space-y-1 min-w-0">
                    <div className="font-semibold truncate">{data.product?.name}</div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">ราคาสินค้า</span>
                      <span>฿{Number(data.productPrice).toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">
                        ค่าจัดส่ง ({data.shippingMethod})
                      </span>
                      <span>฿{Number(data.shippingFee).toLocaleString()}</span>
                    </div>
                    {Number(data.promoDiscount) > 0 && (
                      <div className="flex justify-between text-sm text-primary">
                        <span>ส่วนลด ({data.promoCode})</span>
                        <span>-฿{Number(data.promoDiscount).toLocaleString()}</span>
                      </div>
                    )}
                    {Number(data.loyaltyDiscount) > 0 && (
                      <div className="flex justify-between text-sm text-primary">
                        <span>ใช้แต้ม {data.loyaltyPointsUsed} แต้ม</span>
                        <span>-฿{Number(data.loyaltyDiscount).toLocaleString()}</span>
                      </div>
                    )}
                    <div className="border-t pt-2 mt-2 flex justify-between font-bold">
                      <span>รวม</span>
                      <span>฿{Number(data.totalAmount).toLocaleString()}</span>
                    </div>
                  </div>
                </div>
              </CardBody>
            </Card>

            {/* Shipping address card */}
            {addr && (
              <Card variant="outlined">
                <CardBody>
                  <div className="font-semibold mb-2">{copy.orderDetail.shippingAddressTitle}</div>
                  <div className="text-sm space-y-1 leading-snug">
                    <div>
                      {addr.recipientName} · {addr.phone}
                    </div>
                    <div className="text-muted-foreground">
                      {addr.line1} {addr.line2 ?? ''} {addr.subDistrict} {addr.district}{' '}
                      {addr.province} {addr.postalCode}
                    </div>
                  </div>
                </CardBody>
              </Card>
            )}

            {/* Payment info */}
            {(data.paymentChannel || data.paidAt) && (
              <Card variant="outlined">
                <CardBody>
                  <div className="font-semibold mb-2">{copy.orderDetail.paymentInfoTitle}</div>
                  <div className="text-sm space-y-1 leading-snug">
                    {data.paymentChannel && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">
                          {copy.orderDetail.paymentChannelLabel}
                        </span>
                        <span className="font-medium">{data.paymentChannel}</span>
                      </div>
                    )}
                    {data.paidAt && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">
                          {copy.orderDetail.paidAtLabel}
                        </span>
                        <span>{new Date(data.paidAt).toLocaleString('th-TH')}</span>
                      </div>
                    )}
                  </div>
                </CardBody>
              </Card>
            )}

            {/* Tracking */}
            {data.trackingNumber && (
              <Card variant="outlined">
                <CardBody>
                  <div className="font-semibold mb-1">{copy.orderDetail.trackingTitle}</div>
                  <div className="text-sm text-primary">{data.trackingNumber}</div>
                </CardBody>
              </Card>
            )}
          </Stack>
        </div>
      </Container>
    </ShopLayout>
  );
}
