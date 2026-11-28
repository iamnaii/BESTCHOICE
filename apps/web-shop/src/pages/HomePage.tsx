import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import {
  Search,
  ShieldCheck,
  BadgeCheck,
  Wallet,
  Briefcase,
  MessageCircle,
  Smartphone,
  Repeat,
  MapPin,
  Clock,
  FacebookLogo,
} from '@/lib/icons';
import ShopLayout from '@/components/layout/ShopLayout';
import PromotionsStrip from '@/components/shop/PromotionsStrip';
import ClickToLoadMap from '@/components/shop/ClickToLoadMap';
import {
  Container,
  Section,
  SectionHeader,
  TrustStrip,
  HomeHero,
  StatefulList,
  ProductCard,
  Card,
  CardBody,
  Button,
  StaggerChildren,
  type ProductGroup,
} from '@/components';
import { api } from '@/lib/api';
import { copy, shopInfo, lineOaMessageUrl, customerReviews } from '@/lib/copy';
import { usePageMeta } from '@/hooks/usePageMeta';
import { type DownFloor, downFloorText, useKnownDownFloor } from '@/hooks/useDownFloor';

interface CatalogResponse {
  data: ProductGroup[];
  total?: number;
}

// การ์ดดาวน์เปลี่ยนตามสต๊อก (เจ้าของ 2026-11-27 "ใช้หัวพาดกับการ์ด ตามสต๊อค") · ยังไม่รู้ยอด = ไม่บอกตัวเลขดาวน์
const whyUsItems = (downFloor: DownFloor | null) => [
  {
    icon: <BadgeCheck className="size-7" />,
    title: 'บัตรประชาชนใบเดียว',
    description: 'ไม่เช็กบูโร ไม่ต้องใช้บัตรเครดิต ไม่ต้องมีผู้ค้ำ',
  },
  downFloor
    ? {
        icon: <Wallet className="size-7" />,
        title: downFloorText(downFloor),
        description: 'ผ่อนสูงสุด 15 งวด ทักแชท เจ้าหน้าที่ประเมินเรทให้',
      }
    : {
        icon: <Wallet className="size-7" />,
        title: 'ผ่อนสูงสุด 15 งวด',
        description: 'ดาวน์ตามที่หน้าเครื่องแสดง ทักแชท เจ้าหน้าที่ประเมินเรทให้',
      },
  {
    icon: <ShieldCheck className="size-7" />,
    title: 'มือ 2 ประกันร้าน 60 วัน',
    description: 'ตรวจ 30 จุดก่อนส่งมอบ มีปัญหาซ่อม/เปลี่ยนให้ฟรี · เครื่องใหม่ใช้ประกันศูนย์',
  },
  {
    icon: <Briefcase className="size-7" />,
    title: 'ผ่อนได้ทุกอาชีพ',
    description: 'พนักงานบริษัท โรงงาน ค้าขาย ฟรีแลนซ์ นักศึกษา ก็ผ่อนได้',
  },
];

/** กล่องไอคอน (ส่วน A4): พื้นมิ้นต์ ไอคอนเขียวเข้ม 4.68:1 */
const ICON_BOX =
  'inline-flex items-center justify-center size-12 rounded-xl bg-mint-tint text-brand-green-dark';
/** กล่องบนพื้นกรมท่าของส่วนรีวิว — ขอบขาวจาง ไม่ใช่การ์ดขาวทึบ */
const REVIEW_PANEL =
  'flex h-full flex-col gap-3 rounded-2xl bg-white/5 p-5 ring-1 ring-inset ring-white/15 leading-snug';
const REVIEW_LINK =
  'mt-auto inline-flex min-h-11 items-center gap-2 self-start rounded-full px-4 font-head text-sm font-semibold text-white ring-1 ring-inset ring-white/60 transition-colors hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white';

/** ดาวทึบสีเหลืองโปร (#FFC933) — ไอคอนของระบบบังคับแบบสองโทน จึงวาดเอง */
function SolidStar({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden="true">
      <path d="M12 2.5l2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17.3 6.1 20.6l1.3-6.6L2.5 9.4l6.6-.8L12 2.5z" />
    </svg>
  );
}

/** ตัวเลขในหัวข้อเป็นเขียวเข้ม (ส่วน A4 — ดาวน์เริ่ม 0 บาท · 60 วัน) */
function HighlightNumbers({ text }: { text: string }) {
  return (
    <>
      {text.split(/(\d[\d,]*)/).map((part, i) =>
        /^\d/.test(part) ? (
          <span key={i} className="num text-brand-green-dark">
            {part}
          </span>
        ) : (
          part
        ),
      )}
    </>
  );
}

const SERVICE_ITEMS = [
  {
    icon: <Smartphone className="size-7" />,
    title: copy.home.serviceBuyTitle,
    description: copy.home.serviceBuyDescription,
    cta: copy.home.serviceBuyCta,
    to: '/products',
  },
  {
    icon: <Repeat className="size-7" />,
    title: copy.home.serviceSellTitle,
    description: copy.home.serviceSellDescription,
    cta: copy.home.serviceSellCta,
    to: '/sell',
  },
];

export default function HomePage() {
  usePageMeta(
    undefined,
    'iPhone มือ 1 และมือสองคุณภาพ ผ่อนได้บัตรประชาชนใบเดียว ไม่เช็กบูโร ดาวน์เริ่ม 0 บาท มือสองรับประกันร้าน 60 วัน ร้านมือถือลพบุรี',
  );

  const downFloor = useKnownDownFloor();
  const { data, isLoading, isError, refetch } = useQuery<CatalogResponse>({
    queryKey: ['shop', 'home', 'featured'],
    queryFn: () => api.get('/api/shop/products?limit=8&sort=popular').then((r) => r.data),
  });

  return (
    <ShopLayout>
      <HomeHero />

      <PromotionsStrip />

      <Section padding="sm">
        <Container>
          {/* ย่อหน้าแนะนำร้าน (ผลตรวจ SEO ข้อ 12) — อยู่ใน HTML ที่ prerender ให้ Google/AI อ่าน
              ข้อความรวม = copy.home.shopSummary ทุกตัวอักษร (เทสต์ตรวจ) · เวลาเปิดและเบอร์โทรห้ามตัดกลางบรรทัด */}
          <p className="reading-block mb-6 max-w-3xl text-muted-foreground md:mb-8">
            {copy.home.shopSummaryLead} อยู่{shopInfo.street}{' '}
            <span className="whitespace-nowrap">{shopInfo.hours}</span> ทักไลน์{' '}
            {shopInfo.lineHandle} หรือโทร{' '}
            <span className="whitespace-nowrap">{shopInfo.phoneDisplay}</span>
          </p>
          <TrustStrip />
        </Container>
      </Section>

      <Section tone="muted" padding="md">
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

      <Section padding="md">
        <Container>
          <SectionHeader
            title={copy.home.whyUsTitle}
            description="ซื้อ iPhone มือ 1 และมือ 2 อย่างสบายใจ ผ่อนง่าย รับประกันจริง"
          />
          <StaggerChildren className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {whyUsItems(downFloor).map((item, i) => (
              <Card key={i} variant="outlined" className="h-full">
                <CardBody className="space-y-3 leading-snug">
                  <span className={ICON_BOX}>{item.icon}</span>
                  <div className="font-semibold text-base">
                    <HighlightNumbers text={item.title} />
                  </div>
                  <p className="text-sm text-muted-foreground">{item.description}</p>
                </CardBody>
              </Card>
            ))}
          </StaggerChildren>
        </Container>
      </Section>

      <Section tone="muted" padding="md">
        <Container>
          <SectionHeader
            title={copy.home.servicesTitle}
            description={copy.home.servicesDescription}
          />
          <StaggerChildren className="grid grid-cols-1 sm:grid-cols-2 gap-4" stagger={100}>
            {SERVICE_ITEMS.map((s) => (
              <Card key={s.to} variant="outlined" className="h-full">
                <CardBody className="flex h-full flex-col space-y-3 leading-snug">
                  <span className={ICON_BOX}>{s.icon}</span>
                  <div className="font-semibold text-base">{s.title}</div>
                  <p className="text-sm text-muted-foreground flex-1">{s.description}</p>
                  <Button asChild variant="outline" size="md" className="self-start">
                    <Link to={s.to}>{s.cta}</Link>
                  </Button>
                </CardBody>
              </Card>
            ))}
          </StaggerChildren>
        </Container>
      </Section>

      {/* รีวิวจากลูกค้าจริง (ส่วน A4 + B9) — พื้นกรมท่า ตัวขาว 15:1 ดาวเหลือง 9.9:1 ·
          คะแนน/จำนวนรีวิวอ่านจาก shopInfo ชุดเดียวกับหน้าเกี่ยวกับเรา · ข้อความรีวิวมาจาก
          customerReviews ที่เจ้าของร้านใส่เอง — ว่าง = ไม่มีกล่องรีวิว (ห้ามแต่งข้อความขึ้นมา) */}
      <section className="bg-primary py-12 text-primary-foreground md:py-16" aria-labelledby="home-reviews-title">
        <Container>
          <div className="mb-6 space-y-1 md:mb-8">
            <h2 id="home-reviews-title" className="text-2xl font-bold leading-snug md:text-3xl">
              รีวิวจากลูกค้าจริง
            </h2>
            <p className="text-base leading-relaxed text-white/80">
              กดดูรีวิวทั้งหมดได้ที่ Google Maps และเพจ Facebook ของร้าน
            </p>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className={REVIEW_PANEL}>
              <div className="flex items-end gap-3">
                <span className="num text-4xl font-bold leading-none">{shopInfo.googleRating}</span>
                <span
                  className="flex items-center gap-0.5 pb-0.5 text-promo"
                  role="img"
                  aria-label={`คะแนน ${shopInfo.googleRating} จาก 5 ดาว`}
                >
                  {Array.from({ length: 5 }).map((_, i) => (
                    <SolidStar key={i} className="size-5" />
                  ))}
                </span>
              </div>
              <p className="text-sm text-white/80">
                {shopInfo.googleReviewCount} รีวิวบน Google Maps
              </p>
              <a
                href={shopInfo.googleReviewsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className={REVIEW_LINK}
              >
                <MapPin className="size-4" aria-hidden="true" />
                อ่านรีวิวบน Google
              </a>
            </div>
            <div className={REVIEW_PANEL}>
              <div className="num text-4xl font-bold leading-none">38,000+</div>
              <p className="text-sm text-white/80">
                ผู้ติดตามเพจ Facebook รีวิวและเครื่องเข้าใหม่ทุกวัน
              </p>
              <a
                href={shopInfo.facebookReviewsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className={REVIEW_LINK}
              >
                <FacebookLogo className="size-4" aria-hidden="true" />
                อ่านรีวิวบน Facebook
              </a>
            </div>
          </div>
          {customerReviews.length > 0 && (
            <ul className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {customerReviews.map((r) => (
                <li key={`${r.name}-${r.text.slice(0, 16)}`} className={REVIEW_PANEL}>
                  <span className="flex gap-0.5 text-promo" aria-hidden="true">
                    {Array.from({ length: 5 }).map((_, i) => (
                      <SolidStar key={i} className="size-4" />
                    ))}
                  </span>
                  <blockquote className="reading-block text-sm leading-relaxed text-white">
                    “{r.text}”
                  </blockquote>
                  <p className="text-xs text-white/70">
                    {r.name} · รีวิวบน {r.source}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Container>
      </section>

      {/* มาหาเราที่ร้าน — config-driven: รูป/ปุ่มนำทางโผล่เองเมื่อร้านใส่ mapsUrl/storePhotoUrl */}
      <Section padding="md">
        <Container>
          <Card variant="outlined" className="overflow-hidden">
            <div className={shopInfo.storePhotoUrl ? 'md:flex md:items-stretch' : ''}>
              {shopInfo.storePhotoUrl && (
                <div className="md:w-2/5 shrink-0">
                  <img
                    src={shopInfo.storePhotoUrl}
                    alt={copy.home.visitTitle}
                    loading="lazy"
                    className="aspect-video size-full rounded-2xl object-cover"
                  />
                </div>
              )}
              <CardBody className="flex-1 space-y-4 leading-snug">
                <h2 className="text-xl md:text-2xl font-bold leading-snug">
                  {copy.home.visitTitle}
                </h2>
                <p className="text-sm text-muted-foreground leading-snug">
                  {copy.home.visitDescription}
                </p>
                <div className="space-y-2">
                  <div className="flex items-start gap-3">
                    <MapPin
                      className="size-5 text-brand-green shrink-0 mt-0.5"
                      aria-hidden="true"
                    />
                    <p className="text-sm text-muted-foreground leading-snug">{shopInfo.address}</p>
                  </div>
                  <div className="flex items-start gap-3">
                    <Clock className="size-5 text-brand-green shrink-0 mt-0.5" aria-hidden="true" />
                    <p className="text-sm text-muted-foreground leading-snug">{shopInfo.hours}</p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-3 pt-1">
                  {shopInfo.mapsUrl && (
                    <Button asChild variant="primary" size="lg">
                      <a href={shopInfo.mapsUrl} target="_blank" rel="noopener noreferrer">
                        <MapPin className="size-4" aria-hidden="true" />
                        {copy.home.visitNavigateCta}
                      </a>
                    </Button>
                  )}
                  <Button asChild variant="line" size="lg">
                    <a
                      href={lineOaMessageUrl('สนใจนัดหมายเข้ามาดูเครื่องที่ร้านครับ/ค่ะ')}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <MessageCircle className="size-4" aria-hidden="true" />
                      {copy.home.visitLineCta}
                    </a>
                  </Button>
                </div>
              </CardBody>
            </div>
            {/* แผนที่จริงแบบฝัง — จุดเดียวกับปุ่มนำทาง (query เดียวกับ mapsUrl) */}
            <ClickToLoadMap
              src="https://maps.google.com/maps?q=BESTCHOICE%20phone%20shop%20%E0%B8%A5%E0%B8%9E%E0%B8%9A%E0%B8%B8%E0%B8%A3%E0%B8%B5&z=16&output=embed"
              title="แผนที่ร้าน BESTCHOICE ลพบุรี"
            />
          </Card>
        </Container>
      </Section>
    </ShopLayout>
  );
}
