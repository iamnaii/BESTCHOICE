import { useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { MessageCircle, Phone } from 'lucide-react';
import { api } from '@/lib/api';
import { copy } from '@/lib/copy';
import ShopLayout from '@/components/layout/ShopLayout';
import {
  Badge,
  Button,
  Card,
  CardBody,
  CategoryHero,
  Container,
  ErrorState,
  LoadingState,
  Stack,
  Stepper,
} from '@/components';
import type { Buyback, BuybackStatus } from '@/types/buyback';

const STATUS_LABEL: Record<BuybackStatus, string> = {
  PENDING_APPRAISAL: 'รอทีมงานประเมินราคา',
  APPRAISED: 'ประเมินราคาแล้ว',
  ACCEPTED: 'ตกลงราคาแล้ว',
  COMPLETED: 'ดำเนินการเสร็จสิ้น',
  REJECTED: 'ไม่รับซื้อ',
};

const STATUS_BADGE: Record<
  BuybackStatus,
  'default' | 'primary' | 'warning' | 'success' | 'danger'
> = {
  PENDING_APPRAISAL: 'warning',
  APPRAISED: 'primary',
  ACCEPTED: 'primary',
  COMPLETED: 'success',
  REJECTED: 'danger',
};

function statusToStep(status: BuybackStatus): number {
  switch (status) {
    case 'PENDING_APPRAISAL':
      return 1;
    case 'APPRAISED':
      return 2;
    case 'ACCEPTED':
    case 'COMPLETED':
    case 'REJECTED':
      return 3;
    default:
      return 1;
  }
}

function priceValue(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'string' ? Number(v) : v;
  return Number.isFinite(n) ? n : null;
}

export default function BuybackStatusPage() {
  const { id } = useParams<{ id: string }>();
  const { data, isLoading, isError } = useQuery<Buyback>({
    queryKey: ['buyback', id],
    queryFn: () => api.get<Buyback>(`/api/shop/buyback/${id}`).then((r) => r.data),
    enabled: !!id,
    refetchInterval: 60_000,
  });

  if (isLoading) {
    return (
      <ShopLayout>
        <Container narrow className="py-10">
          <LoadingState />
        </Container>
      </ShopLayout>
    );
  }

  if (isError || !data) {
    return (
      <ShopLayout>
        <Container narrow className="py-10">
          <ErrorState title={copy.buyback.statusNotFound} />
        </Container>
      </ShopLayout>
    );
  }

  const offered = priceValue(data.offeredPrice);
  const agreed = priceValue(data.agreedPrice);
  const showOfferActions = data.status === 'APPRAISED' && offered !== null;
  const isInstantQuote = !!data.quoteBreakdown;
  const estimated = priceValue(data.estimatedValue);

  return (
    <ShopLayout>
      <CategoryHero
        title={`${copy.buyback.statusTitle} ${data.id.slice(0, 8)}`}
        breadcrumbs={[
          { label: copy.buyback.pageTitle, to: '/buyback' },
          { label: 'สถานะ' },
        ]}
      />

      <Container narrow className="py-6 md:py-10">
        <Stack gap={4} className="leading-snug">
          <Stepper
            steps={
              isInstantQuote
                ? [{ label: 'ยืนยันราคาแล้ว' }, { label: 'เข้าร้านตรวจเครื่อง' }, { label: 'เสร็จสิ้น' }]
                : [{ label: 'รอประเมิน' }, { label: 'เสนอราคา' }, { label: 'สรุป' }]
            }
            current={statusToStep(data.status)}
          />

          <div className="flex items-center gap-2 leading-snug">
            <span className="text-sm text-muted-foreground">สถานะ</span>
            <Badge variant={STATUS_BADGE[data.status] ?? 'default'} size="lg">
              {data.status === 'PENDING_APPRAISAL' && isInstantQuote
                ? 'ยืนยันราคาแล้ว — รอนัดเข้าร้าน'
                : STATUS_LABEL[data.status] ?? data.status}
            </Badge>
          </div>

          {isInstantQuote && estimated !== null && (
            <Card variant="elevated" className="bg-emerald-50 border-emerald-200">
              <CardBody className="space-y-2 leading-snug">
                <div className="text-sm font-medium text-emerald-800 leading-snug">
                  {copy.buyback.quotedTitle}
                </div>
                <div className="text-4xl font-bold text-emerald-600 leading-snug">
                  ฿{estimated.toLocaleString()}
                </div>
                {data.quoteBreakdown && (
                  <div className="space-y-0.5 text-xs text-emerald-800 leading-snug">
                    <div className="flex justify-between">
                      <span>ราคาสูงสุด</span>
                      <span>฿{Number(data.quoteBreakdown.maxPrice).toLocaleString()}</span>
                    </div>
                    {data.quoteBreakdown.lines
                      .filter((l) => Number(l.amount) > 0)
                      .map((l, i) => (
                        <div key={i} className="flex justify-between">
                          <span>{l.label}</span>
                          <span>−฿{Number(l.amount).toLocaleString()}</span>
                        </div>
                      ))}
                  </div>
                )}
                <p className="text-xs text-emerald-800 leading-snug">{copy.buyback.priceCondition}</p>
                {offered !== null && offered !== estimated && (
                  <p className="text-xs font-semibold text-emerald-900 leading-snug">
                    ราคายืนยันหน้าร้าน: ฿{offered.toLocaleString()}
                  </p>
                )}
              </CardBody>
            </Card>
          )}

          {!isInstantQuote && offered !== null && (
            <Card variant="elevated" className="bg-emerald-50 border-emerald-200">
              <CardBody className="space-y-1 leading-snug">
                <div className="text-sm font-medium text-emerald-800 leading-snug">
                  ราคาที่ทีมงานเสนอ
                </div>
                <div className="text-4xl font-bold text-emerald-600 leading-snug">
                  ฿{offered.toLocaleString()}
                </div>
                {agreed !== null && (
                  <div className="text-sm text-emerald-800 leading-snug">
                    ราคาที่ตกลง: ฿{agreed.toLocaleString()}
                  </div>
                )}
              </CardBody>
            </Card>
          )}

          <Card variant="outlined">
            <CardBody className="space-y-3 leading-snug">
              <div className="font-semibold text-foreground leading-snug">
                {data.deviceBrand} {data.deviceModel} {data.deviceStorage}
              </div>
              <div className="text-sm text-muted-foreground leading-snug">
                {data.deviceCondition && <>เกรด {data.deviceCondition}</>}
                {data.batteryHealth !== null && data.batteryHealth !== undefined && (
                  <> · แบตเตอรี่ {data.batteryHealth}%</>
                )}
              </div>
              {data.notes && (
                <div className="text-sm text-muted-foreground leading-snug">
                  หมายเหตุ: {data.notes}
                </div>
              )}
              {data.photoUrls.length > 0 && (
                <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 pt-2">
                  {data.photoUrls.map((url, i) => (
                    <div
                      key={i}
                      className="relative aspect-square rounded-xl overflow-hidden bg-muted"
                    >
                      <img
                        src={url}
                        alt={`รูปที่ ${i + 1}`}
                        className="h-full w-full object-cover"
                      />
                    </div>
                  ))}
                </div>
              )}
            </CardBody>
          </Card>

          {showOfferActions && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Button
                asChild
                variant="primary"
                size="lg"
                fullWidth
                data-testid="buyback-accept"
              >
                <a
                  href="https://line.me/R/ti/p/@bestchoice"
                  target="_blank"
                  rel="noreferrer"
                >
                  <MessageCircle className="size-4" aria-hidden="true" />
                  {copy.buyback.acceptPrice}
                </a>
              </Button>
              <Button
                asChild
                variant="outline"
                size="lg"
                fullWidth
                className="text-destructive hover:text-destructive border-destructive/40"
                data-testid="buyback-reject"
              >
                <a
                  href="https://line.me/R/ti/p/@bestchoice"
                  target="_blank"
                  rel="noreferrer"
                >
                  <Phone className="size-4" aria-hidden="true" />
                  {copy.buyback.rejectPrice}
                </a>
              </Button>
            </div>
          )}

          <p className="text-xs text-muted-foreground leading-snug">
            {copy.buyback.followUp}
          </p>
        </Stack>
      </Container>
    </ShopLayout>
  );
}
