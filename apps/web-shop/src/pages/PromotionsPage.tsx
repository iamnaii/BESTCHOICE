import { Link } from 'react-router';
import { Gift, MessageCircle } from 'lucide-react';
import ShopLayout from '@/components/layout/ShopLayout';
import {
  Container,
  Section,
  SectionHeader,
  Card,
  CardBody,
  Badge,
  Button,
  StatefulList,
} from '@/components';
import {
  usePromotions,
  promoBenefitLabel,
  promoIcon,
  promoEndsLabel,
} from '@/components/shop/PromotionsStrip';
import { usePageMeta } from '@/hooks/usePageMeta';
import { shopInfo } from '@/lib/copy';
import type { ShopPromotion } from '@/types/promotion';

const CATEGORY_LABELS: Record<string, string> = {
  PHONE_NEW: 'มือถือใหม่',
  PHONE_USED: 'มือถือมือสอง',
  TABLET: 'แท็บเล็ต',
  ACCESSORY: 'อุปกรณ์เสริม',
};

function conditionChips(p: ShopPromotion): string[] {
  const chips: string[] = [];
  if (p.conditions?.minPurchase) {
    chips.push(`ซื้อขั้นต่ำ ฿${Number(p.conditions.minPurchase).toLocaleString()}`);
  }
  for (const c of p.conditions?.categories ?? []) {
    chips.push(CATEGORY_LABELS[c] ?? c);
  }
  if (p.conditions?.productIds?.length) {
    chips.push('เฉพาะรุ่นที่ร่วมรายการ');
  }
  return chips;
}

export default function PromotionsPage() {
  usePageMeta(
    'โปรโมชัน',
    'โปรโมชันและส่วนลด iPhone มือ 1 และมือสองผ่อนได้บัตรประชาชนใบเดียว ร้านมือถือลพบุรี',
  );

  const { data, isLoading, isError, refetch } = usePromotions();

  return (
    <ShopLayout>
      <Section padding="md">
        <Container>
          <SectionHeader
            title="โปรโมชัน"
            description="ดีลและส่วนลดที่ใช้ได้ตอนนี้ — เงื่อนไขเป็นไปตามที่ร้านกำหนด"
          />
          <StatefulList<ShopPromotion>
            isLoading={isLoading}
            isError={isError}
            data={data}
            loadingVariant="card-grid"
            onRetry={() => refetch()}
            emptyState={{
              icon: <Gift className="size-12" />,
              title: 'ยังไม่มีโปรโมชันในขณะนี้',
              description: 'ทักไลน์สอบถามดีลพิเศษ หรือแวะกลับมาดูใหม่เร็วๆ นี้',
            }}
            wrapperClassName="grid grid-cols-1 md:grid-cols-2 gap-4"
            renderItem={(p) => (
              <Card key={p.id} variant="outlined" className="h-full">
                <CardBody className="space-y-3 leading-snug">
                  <div className="flex items-start gap-3">
                    <span className="size-12 rounded-xl bg-emerald-100 text-emerald-600 flex items-center justify-center shrink-0">
                      {promoIcon(p)}
                    </span>
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="font-semibold text-base">{p.name}</div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge variant="success" size="sm">
                          {promoBenefitLabel(p)}
                        </Badge>
                        <span className="text-xs text-muted-foreground">{promoEndsLabel(p)}</span>
                      </div>
                    </div>
                  </div>
                  {p.description && (
                    <p className="text-sm text-muted-foreground">{p.description}</p>
                  )}
                  {conditionChips(p).length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {conditionChips(p).map((c) => (
                        <span
                          key={c}
                          className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground"
                        >
                          {c}
                        </span>
                      ))}
                    </div>
                  )}
                  <div className="flex gap-2 pt-1">
                    <Button asChild variant="primary" size="sm">
                      <Link to="/products">ดูสินค้า</Link>
                    </Button>
                    <Button asChild variant="outline" size="sm">
                      <a href={shopInfo.lineUrl} target="_blank" rel="noreferrer">
                        <MessageCircle className="size-4" aria-hidden="true" />
                        สอบถาม
                      </a>
                    </Button>
                  </div>
                </CardBody>
              </Card>
            )}
          />
        </Container>
      </Section>
    </ShopLayout>
  );
}
