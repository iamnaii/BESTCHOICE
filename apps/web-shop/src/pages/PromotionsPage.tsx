import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { Gift, MessageCircle } from '@/lib/icons';
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
  ProductCard,
  type ProductGroup,
} from '@/components';
import { api } from '@/lib/api';
import { buildCatalogParams } from './catalog-params';
import {
  usePromotions,
  promoBenefitLabel,
  promoIcon,
  promoEndsLabel,
} from '@/components/shop/PromotionsStrip';
import { usePageMeta } from '@/hooks/usePageMeta';
import { shopInfo } from '@/lib/copy';
import type { ShopPromotion } from '@/types/promotion';
import { formatNumber } from '@/lib/format';

const CATEGORY_LABELS: Record<string, string> = {
  PHONE_NEW: 'มือถือใหม่',
  PHONE_USED: 'มือถือมือ 2',
  TABLET: 'แท็บเล็ต',
  ACCESSORY: 'อุปกรณ์เสริม',
};

function conditionChips(p: ShopPromotion): string[] {
  const chips: string[] = [];
  if (p.conditions?.minPurchase) {
    chips.push(`ซื้อขั้นต่ำ ฿${formatNumber(Number(p.conditions.minPurchase))}`);
  }
  for (const c of p.conditions?.categories ?? []) {
    chips.push(CATEGORY_LABELS[c] ?? c);
  }
  if (p.conditions?.productIds?.length) {
    chips.push('เฉพาะรุ่นที่ร่วมรายการ');
  }
  return chips;
}

/** เครื่องฟรีดาวน์ที่แสดงตอนไม่มีโปรโมชัน (ส่วน B4) — query เดียวกับหน้ารวมที่ติ๊กฟรีดาวน์ */
const FREE_DOWN_PREVIEW = 8;

interface FreeDownResponse {
  data: ProductGroup[];
  /** API รุ่นเก่าไม่ส่งช่องนี้และไม่รู้จักตัวกรองฟรีดาวน์ — ไม่มี = ไม่แสดงส่วนนี้ (กันโชว์เครื่องที่ต้องวางดาวน์) */
  freeDownCount?: number;
}

function FreeDownPhones() {
  const { data } = useQuery<FreeDownResponse>({
    queryKey: ['shop', 'promotions', 'free-down'],
    queryFn: () => {
      const params = buildCatalogParams({
        filters: {},
        sort: 'popular',
        downAmount: null,
        months: null,
        freeDown: true,
        page: 1,
      });
      params.set('limit', String(FREE_DOWN_PREVIEW));
      return api.get(`/api/shop/products?${params}`).then((r) => r.data);
    },
  });
  if (!data || data.freeDownCount === undefined || data.data.length === 0) return null;
  return (
    <div className="mt-10 space-y-4">
      <SectionHeader
        title="เครื่องฟรีดาวน์ตอนนี้"
        description="ไม่ต้องวางเงินดาวน์ ผ่อนได้บัตรประชาชนใบเดียว"
      />
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {data.data.map((p) => (
          <ProductCard key={p.id} product={p} priceMode="installment" freeDownOnly />
        ))}
      </div>
      <Button asChild variant="primary" size="lg">
        <Link to="/products?freeDown=1">ดูเครื่องฟรีดาวน์ทั้งหมด</Link>
      </Button>
    </div>
  );
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
            as="h1"
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
                    <span className="size-12 rounded-xl bg-mint-tint text-brand-green-dark flex items-center justify-center shrink-0">
                      {promoIcon(p)}
                    </span>
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="font-semibold text-base">{p.name}</div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge variant="promo" size="sm">
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
                    <Button asChild variant="line" size="sm">
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
          {!isLoading && !isError && (data?.length ?? 0) === 0 && <FreeDownPhones />}
        </Container>
      </Section>
    </ShopLayout>
  );
}
