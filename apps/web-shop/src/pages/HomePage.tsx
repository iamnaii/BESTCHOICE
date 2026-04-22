import { useQuery } from '@tanstack/react-query';
import { Search, ShieldCheck, BadgeCheck, Wallet, MessageCircle } from 'lucide-react';
import ShopLayout from '@/components/layout/ShopLayout';
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

const FAKE_TESTIMONIALS: Review[] = [
  {
    id: 'home-review-1',
    rating: 5,
    title: 'ประทับใจมาก บริการดีเยี่ยม',
    comment:
      'เครื่องแท้ สภาพดีกว่าที่คิด พนักงานใจดี ตอบคำถามครบ ผ่อนจบใน 6 เดือน แนะนำเลยครับ',
    verified: true,
    createdAt: new Date().toISOString(),
    customer: { name: 'คุณเอ' },
  },
  {
    id: 'home-review-2',
    rating: 5,
    title: 'ผ่อนง่าย อนุมัติไว',
    comment:
      'แค่บัตรประชาชนใบเดียว ไม่ต้องมีสลิปเงินเดือน เซ็นสัญญาที่ร้านแป๊บเดียวก็ได้เครื่อง',
    verified: true,
    createdAt: new Date().toISOString(),
    customer: { name: 'คุณบี' },
  },
  {
    id: 'home-review-3',
    rating: 5,
    title: 'กล้าการันตีคุณภาพ',
    comment:
      'iPhone มือสองแต่เหมือนเครื่องใหม่เลย ตรวจเช็คละเอียดมาก แบตดี จอไม่มีรอย',
    verified: true,
    createdAt: new Date().toISOString(),
    customer: { name: 'คุณซี' },
  },
];

export default function HomePage() {
  const { data, isLoading, isError, refetch } = useQuery<CatalogResponse>({
    queryKey: ['shop', 'home', 'featured'],
    queryFn: () => api.get('/api/shop/products?limit=8&sort=popular').then((r) => r.data),
  });

  return (
    <ShopLayout>
      <HomeHero />

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
            renderItem={(p) => <ProductCard key={`${p.brand}-${p.model}`} product={p} />}
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

      <Section padding="md">
        <Container>
          <SectionHeader
            title={copy.home.testimonialsTitle}
            description="เสียงจริงจากลูกค้าที่ซื้อเครื่องและผ่อนกับเรา"
          />
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {FAKE_TESTIMONIALS.map((r) => (
              <ReviewCard key={r.id} review={r} />
            ))}
          </div>
        </Container>
      </Section>
    </ShopLayout>
  );
}
