import { LandingFaq } from '@/components/LandingFaq';
import { Link } from 'react-router';
import { BadgeCheck, BatteryCharging, ShieldCheck, Repeat } from '@/lib/icons';
import {
  CategoryHero,
  Container,
  Stack,
  SectionHeader,
  Card,
  CardBody,
  Button,
} from '@/components';
import ShopLayout from '@/components/layout/ShopLayout';
import { StorePhotos } from '@/components/shop/StorePhotos';
import { shopInfo, lineOaMessageUrl } from '@/lib/copy';
import { usePageMeta } from '@/hooks/usePageMeta';

/**
 * Landing เจาะคำค้น "iPhone มือสอง ลพบุรี" — จุดขายคือความมั่นใจในเครื่องมือสอง
 * (ตรวจสภาพ / แบต / รูปเครื่องจริง / ประกันร้าน) + ผ่อนได้เหมือนมือ 1 — ไม่พูดถึงเกรด (เจ้าของ 2026-11-27 C6)
 */

const QUALITY_POINTS = [
  {
    icon: <BadgeCheck className="size-6 text-brand-green" aria-hidden="true" />,
    title: 'ตรวจสภาพก่อนขายทุกเครื่อง',
    description: 'เครื่องมือสองทุกเครื่องผ่านการตรวจสภาพ 30 จุด พร้อมรูปถ่ายเครื่องจริงบนหน้าสินค้า',
  },
  {
    icon: <BatteryCharging className="size-6 text-brand-green" aria-hidden="true" />,
    title: 'บอก % สุขภาพแบตจริง',
    description: 'ทุกเครื่องแสดงสุขภาพแบตเตอรี่จริงบนหน้าสินค้า ไม่ต้องลุ้นตอนรับเครื่อง',
  },
  {
    icon: <ShieldCheck className="size-6 text-brand-green" aria-hidden="true" />,
    title: 'มีประกันร้าน',
    description: 'เครื่องมือสองมีประกันร้าน 60 วัน และเปลี่ยนเครื่องได้ถ้ามีตำหนิภายใน 7 วัน',
  },
  {
    icon: <Repeat className="size-6 text-brand-green" aria-hidden="true" />,
    title: 'เอาเครื่องเก่ามาเทิร์นได้',
    description: 'ตีราคาเครื่องเก่าให้ทันที ใช้เป็นส่วนลดแลกเครื่องที่ถูกใจกว่าได้เลย',
  },
];

const FAQS = [
  {
    question: 'ซื้อ iPhone มือสองที่ลพบุรีที่ไหนดี',
    answer: `BESTCHOICE เป็นร้านขาย iPhone มือสองในอำเภอเมืองลพบุรี มีหน้าร้านจริงบนถนนนารายณ์มหาราช เครื่องทุกเครื่องตรวจสภาพ บอก % แบตจริง และมีรูปเครื่องจริง ลูกค้ารีวิวบน Google กว่า ${shopInfo.googleReviewCount.replace("+", "")} รายการ คะแนน ${shopInfo.googleRating} เปิดทุกวัน 10:00-19:00 น.`,
  },
  {
    question: 'iPhone มือสองผ่อนได้ไหม',
    answer: 'ผ่อนได้ด้วยบัตรประชาชนใบเดียว เงื่อนไขเดียวกับเครื่องใหม่ทุกอย่าง ผ่อนได้สูงสุด 15 งวด',
  },
  {
    question: 'เครื่องมือสองมีประกันไหม',
    answer: 'มีประกันร้าน 60 วันทุกเครื่อง และเปลี่ยนเครื่องได้ถ้ามีตำหนิภายใน 7 วันหลังรับเครื่อง',
  },
  {
    question: 'ดูสภาพเครื่องได้จากไหน',
    answer: 'หน้าสินค้าแต่ละเครื่องมีรูปถ่ายเครื่องจริงและบอก % สุขภาพแบต หรือมาดูเครื่องจริงที่ร้านก่อนตัดสินใจก็ได้ ทุกเครื่องผ่านการตรวจการทำงานครบทุกจุด',
  },
  {
    question: 'อยู่ต่างจังหวัด สั่งซื้อได้ไหม',
    answer: 'เลือกเครื่องจากหน้าเว็บแล้วทักไลน์สั่งได้จากทุกจังหวัด ทีมงานเช็คเครื่องให้ก่อน — ซื้อเงินสดจัดส่งถึงบ้านทั่วประเทศ ส่วนผ่อนต้องมารับเครื่องที่ร้านลพบุรีเพื่อเซ็นสัญญา',
  },
];

const FAQ_JSON_LD = JSON.stringify({
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: FAQS.map((f) => ({
    '@type': 'Question',
    name: f.question,
    acceptedAnswer: { '@type': 'Answer', text: f.answer },
  })),
});

export default function UsedIphoneLopburiPage() {
  usePageMeta(
    'iPhone มือสอง ลพบุรี ผ่อนได้ มีประกันร้าน',
    'ร้านขาย iPhone มือสองในลพบุรี ตรวจสภาพทุกเครื่อง บอก % แบตจริง มีรูปเครื่องจริง มีประกันร้าน ผ่อนได้ด้วยบัตรประชาชนใบเดียว รับเทิร์นเครื่องเก่า',
  );

  return (
    <ShopLayout>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: FAQ_JSON_LD }} />
      <CategoryHero
        title="iPhone มือสอง ลพบุรี"
        description="เครื่องมือสองคุณภาพ ตรวจสภาพครบทุกเครื่อง บอกสุขภาพแบตตรงไปตรงมา มีรูปเครื่องจริง มีประกันร้าน — ซื้อสดหรือผ่อนด้วยบัตรประชาชนใบเดียวก็ได้"
        breadcrumbs={[{ label: 'หน้าแรก', to: '/' }, { label: 'iPhone มือสอง ลพบุรี' }]}
      />
      <StorePhotos />
      <Container>
        <Stack gap={6} className="py-8">
          <section>
            <SectionHeader title="มือสองที่นี่ ต่างจากซื้อตามกลุ่มยังไง" />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {QUALITY_POINTS.map((q) => (
                <Card key={q.title} variant="outlined">
                  <CardBody>
                    <Stack gap={2} className="leading-snug">
                      {q.icon}
                      <h3 className="font-semibold leading-snug">{q.title}</h3>
                      <p className="text-sm text-muted-foreground leading-snug">{q.description}</p>
                    </Stack>
                  </CardBody>
                </Card>
              ))}
            </div>
            <p className="mt-3 reading-block text-muted-foreground">
              ทุกเครื่องแสดงรูปถ่ายเครื่องจริง ราคาเงินสด และค่างวดผ่อนบนหน้า{' '}
              <Link to="/products" className="text-primary underline">สินค้าทั้งหมด</Link>{' '}
              — เงื่อนไขประกันอ่านได้ที่{' '}
              <Link to="/returns" className="text-primary underline">การรับประกันและการเปลี่ยนเครื่อง</Link>
            </p>
          </section>

          <LandingFaq title="คำถามที่พบบ่อยเรื่องเครื่องมือสอง" items={FAQS} />

          <section className="rounded-2xl bg-mint-tint p-6 md:p-8">
            <Stack gap={3} className="items-start leading-snug">
              <h2 className="text-xl font-bold leading-snug">เลือกเครื่องมือสองที่ถูกใจ</h2>
              <p className="text-sm text-muted-foreground leading-snug">
                ดูรูปเครื่องจริง สุขภาพแบต และค่างวดผ่อนของแต่ละเครื่อง หรือทักไลน์สอบถามก่อนได้
              </p>
              <div className="flex flex-wrap gap-3">
                <Button asChild variant="primary" size="lg">
                  <Link to="/products?condition=USED">ดู iPhone มือสองทั้งหมด</Link>
                </Button>
                <Button asChild variant="line" size="lg">
                  <a href={lineOaMessageUrl('สนใจ iPhone มือสองครับ/ค่ะ')} target="_blank" rel="noopener noreferrer">
                    ทักไลน์ {shopInfo.lineHandle}
                  </a>
                </Button>
              </div>
              <p className="text-xs text-muted-foreground leading-snug">
                อ่านเพิ่ม: <Link to="/ผ่อนไอโฟนลพบุรี" className="underline">ผ่อน iPhone ลพบุรี</Link> ·{' '}
                <Link to="/sell" className="underline">ขาย/เทิร์นเครื่องเก่า</Link>
              </p>
            </Stack>
          </section>
        </Stack>
      </Container>
    </ShopLayout>
  );
}
