import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import {
  Search,
  ShieldCheck,
  BadgeCheck,
  Wallet,
  MessageCircle,
  PiggyBank,
  Target,
  ShoppingBag,
} from 'lucide-react';
import ShopLayout from '@/components/layout/ShopLayout';
import PromotionsStrip from '@/components/shop/PromotionsStrip';
import {
  Container,
  Section,
  SectionHeader,
  TrustStrip,
  HomeHero,
  StatefulList,
  ProductCard,
  ReviewCard,
  Card,
  CardBody,
  Button,
  type ProductGroup,
} from '@/components';
import { api } from '@/lib/api';
import { copy } from '@/lib/copy';
import type { Review } from '@/types/review';

interface CatalogResponse {
  data: ProductGroup[];
  total?: number;
}

const WHY_US_ITEMS = [
  {
    icon: <ShieldCheck className="size-7" />,
    title: 'รับประกันร้าน 30 วัน',
    description: 'ครอบคลุมปัญหาการใช้งานปกติ เปลี่ยน/ซ่อมให้ฟรี',
  },
  {
    icon: <BadgeCheck className="size-7" />,
    title: 'ตรวจสอบ 30 จุดก่อนส่ง',
    description: 'ทุกเครื่องผ่านเช็คแบตเตอรี่ จอ กล้อง ปุ่ม และเซ็นเซอร์ครบ',
  },
  {
    icon: <Wallet className="size-7" />,
    title: 'ผ่อนได้บัตร ปชช. ใบเดียว',
    description: '3-12 งวด ไม่ต้องใช้บัตรเครดิต อนุมัติไว',
  },
  {
    icon: <MessageCircle className="size-7" />,
    title: 'ซัพพอร์ตผ่าน LINE',
    description: 'ทีมงานตอบไวในเวลาทำการ ติดตามสถานะสัญญาได้ทุกขั้น',
  },
];

export default function HomePage() {
  const { data, isLoading, isError, refetch } = useQuery<CatalogResponse>({
    queryKey: ['shop', 'home', 'featured'],
    queryFn: () => api.get('/api/shop/products?limit=8&sort=popular').then((r) => r.data),
  });

  // Real verified-purchase reviews — section hides entirely when none exist.
  // (Replaced the old hardcoded fake testimonials: fake "ซื้อจริง" badges are
  // a trust + misleading-advertising liability.)
  const { data: reviews } = useQuery<Review[]>({
    queryKey: ['shop', 'recent-reviews'],
    queryFn: () => api.get('/api/shop/reviews/recent?limit=6').then((r) => r.data),
    staleTime: 5 * 60 * 1000,
  });

  return (
    <ShopLayout>
      <HomeHero />

      <PromotionsStrip />

      <Section tone="muted" padding="sm">
        <Container>
          <TrustStrip />
        </Container>
      </Section>

      <Section padding="md">
        <Container>
          <SectionHeader
            title={copy.home.featuredTitle}
            cta={{ label: copy.common.viewAll, to: '/products' }}
          />
          <StatefulList<ProductGroup>
            isLoading={isLoading}
            isError={isError}
            data={data?.data}
            loadingVariant="card-grid"
            onRetry={() => refetch()}
            emptyState={{
              icon: <Search className="size-12" />,
              title: 'ยังไม่มีสินค้าในขณะนี้',
              description: 'ลองแวะกลับมาใหม่อีกครั้ง หรือทักไลน์สอบถามรุ่นที่ต้องการ',
            }}
            wrapperClassName="grid grid-cols-2 md:grid-cols-4 gap-4"
            renderItem={(p) => <ProductCard key={p.id} product={p} />}
          />
        </Container>
      </Section>

      <Section tone="emerald" padding="md">
        <Container>
          <SectionHeader
            title={copy.home.whyUsTitle}
            description="ซื้อมือถือมือสองอย่างสบายใจ ผ่อนง่าย รับประกันจริง"
          />
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {WHY_US_ITEMS.map((item, i) => (
              <Card key={i} variant="outlined" className="h-full">
                <CardBody className="space-y-3 leading-snug">
                  <span className="inline-flex items-center justify-center size-12 rounded-xl bg-emerald-100 text-emerald-600">
                    {item.icon}
                  </span>
                  <div className="font-semibold text-base">{item.title}</div>
                  <p className="text-sm text-muted-foreground">{item.description}</p>
                </CardBody>
              </Card>
            ))}
          </div>
        </Container>
      </Section>

      {/* ออมดาวน์ — catches the "ดาวน์ยังไม่พอ" lead that would otherwise bounce */}
      <Section padding="md">
        <Container>
          <Card variant="outlined" className="overflow-hidden">
            <CardBody className="md:flex md:items-center md:gap-8 space-y-5 md:space-y-0 leading-snug">
              <div className="flex-1 space-y-2">
                <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700 bg-emerald-50 rounded-full px-2.5 py-1">
                  <PiggyBank className="size-3.5" aria-hidden="true" />
                  ออมดาวน์
                </span>
                <h2 className="text-xl md:text-2xl font-bold leading-snug">
                  ดาวน์ยังไม่พอ? ออมกับเราก่อนได้ เริ่ม ฿500/เดือน
                </h2>
                <p className="text-sm text-muted-foreground leading-snug">
                  เลือกรุ่นที่อยากได้ ออมทีละน้อยทุกเดือน พอครบเป้าก็ใช้เงินออมเป็นเงินดาวน์รับเครื่องได้เลย
                </p>
                <div className="flex flex-wrap gap-x-5 gap-y-1.5 pt-1 text-sm">
                  <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                    <Target className="size-4 text-emerald-500" aria-hidden="true" />
                    ตั้งเป้ารุ่นที่อยากได้
                  </span>
                  <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                    <PiggyBank className="size-4 text-emerald-500" aria-hidden="true" />
                    ออมรายเดือนตามไหว
                  </span>
                  <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                    <ShoppingBag className="size-4 text-emerald-500" aria-hidden="true" />
                    ครบเป้า = รับเครื่อง
                  </span>
                </div>
              </div>
              <div className="shrink-0">
                <Button asChild variant="primary" size="lg">
                  <Link to="/saving-plan">เริ่มออมดาวน์</Link>
                </Button>
              </div>
            </CardBody>
          </Card>
        </Container>
      </Section>

      {reviews && reviews.length > 0 && (
        <Section padding="md">
          <Container>
            <SectionHeader
              title={copy.home.testimonialsTitle}
              description="เสียงจริงจากลูกค้าที่ซื้อเครื่องและผ่อนกับเรา"
            />
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {reviews.slice(0, 6).map((r) => (
                <ReviewCard key={r.id} review={r} />
              ))}
            </div>
          </Container>
        </Section>
      )}
    </ShopLayout>
  );
}
