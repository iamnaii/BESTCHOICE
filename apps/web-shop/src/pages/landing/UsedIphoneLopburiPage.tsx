import { Link } from 'react-router';
import { BadgeCheck, BatteryCharging, ShieldCheck, Repeat } from 'lucide-react';
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
import { shopInfo, lineOaMessageUrl } from '@/lib/copy';
import { usePageMeta } from '@/hooks/usePageMeta';

/**
 * Landing เจาะคำค้น "iPhone มือสอง ลพบุรี" — จุดขายคือความมั่นใจในเครื่องมือสอง
 * (ตรวจสภาพ / เกรด / แบต / ประกันร้าน) + ผ่อนได้เหมือนมือ 1
 */

const QUALITY_POINTS = [
  {
    icon: <BadgeCheck className="size-6 text-emerald-600" aria-hidden="true" />,
    title: 'ตรวจสภาพก่อนขายทุกเครื่อง',
    description: 'เครื่องมือสองทุกเครื่องผ่านการตรวจสภาพ 30 จุด และระบุเกรดสภาพตรงไปตรงมา',
  },
  {
    icon: <BatteryCharging className="size-6 text-emerald-600" aria-hidden="true" />,
    title: 'บอก % สุขภาพแบตจริง',
    description: 'ทุกเครื่องแสดงสุขภาพแบตเตอรี่จริงบนหน้าสินค้า ไม่ต้องลุ้นตอนรับเครื่อง',
  },
  {
    icon: <ShieldCheck className="size-6 text-emerald-600" aria-hidden="true" />,
    title: 'มีประกันร้าน',
    description: 'เครื่องมือสองมีประกันร้านรองรับ พร้อมเงื่อนไขการเปลี่ยน/คืนที่ชัดเจน',
  },
  {
    icon: <Repeat className="size-6 text-emerald-600" aria-hidden="true" />,
    title: 'เอาเครื่องเก่ามาเทิร์นได้',
    description: 'ตีราคาเครื่องเก่าให้ทันที ใช้เป็นส่วนลดแลกเครื่องที่ถูกใจกว่าได้เลย',
  },
];

const FAQS = [
  {
    question: 'ซื้อ iPhone มือสองที่ลพบุรีที่ไหนดี',
    answer: `BESTCHOICE เป็นร้านขาย iPhone มือสองในอำเภอเมืองลพบุรี มีหน้าร้านจริงบนถนนนารายณ์มหาราช เครื่องทุกเครื่องตรวจสภาพและระบุเกรดชัดเจน ลูกค้ารีวิวบน Google กว่า 860 รายการ คะแนน 5.0 เปิดทุกวัน 10:00-19:00 น.`,
  },
  {
    question: 'iPhone มือสองผ่อนได้ไหม',
    answer: 'ผ่อนได้ด้วยบัตรประชาชนใบเดียว เงื่อนไขเดียวกับเครื่องใหม่ทุกอย่าง เลือกผ่อน 3, 6, 9 หรือ 12 งวด',
  },
  {
    question: 'เครื่องมือสองมีประกันไหม',
    answer: 'มีประกันร้านรองรับทุกเครื่อง พร้อมเงื่อนไขการเปลี่ยน/คืนสินค้าที่ประกาศชัดเจนบนเว็บไซต์',
  },
  {
    question: 'เกรดเครื่อง A B C ต่างกันยังไง',
    answer: 'เกรดบอกสภาพภายนอกของตัวเครื่อง — เกรด A สภาพสวยใกล้เคียงเครื่องใหม่, เกรด B มีรอยใช้งานเล็กน้อย, เกรด C มีรอยชัดเจนแต่ใช้งานปกติ ทุกเกรดผ่านการตรวจการทำงานครบทุกจุดเหมือนกัน',
  },
  {
    question: 'อยู่ต่างจังหวัด สั่งซื้อได้ไหม',
    answer: 'ได้ สั่งซื้อผ่านเว็บไซต์แล้วจัดส่งถึงบ้านทั่วประเทศ หรือจะทักไลน์ให้ทีมงานช่วยเลือกเครื่องก่อนก็ได้',
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
    'ร้านขาย iPhone มือสองในลพบุรี ตรวจสภาพทุกเครื่อง บอกเกรดและ % แบตจริง มีประกันร้าน ผ่อนได้ด้วยบัตรประชาชนใบเดียว รับเทิร์นเครื่องเก่า',
  );

  return (
    <ShopLayout>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: FAQ_JSON_LD }} />
      <CategoryHero
        title="iPhone มือสอง ลพบุรี"
        description="เครื่องมือสองคุณภาพ ตรวจสภาพครบทุกเครื่อง บอกเกรดและสุขภาพแบตตรงไปตรงมา มีประกันร้าน — ซื้อสดหรือผ่อนด้วยบัตรประชาชนใบเดียวก็ได้"
        breadcrumbs={[{ label: 'หน้าแรก', to: '/' }, { label: 'iPhone มือสอง ลพบุรี' }]}
      />
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
            <p className="mt-3 text-sm text-muted-foreground leading-snug">
              ทุกเครื่องแสดงรูปถ่ายเครื่องจริง ราคาเงินสด และค่างวดผ่อนบนหน้า{' '}
              <Link to="/products" className="text-emerald-700 underline">สินค้าทั้งหมด</Link>{' '}
              — เงื่อนไขประกันอ่านได้ที่{' '}
              <Link to="/returns" className="text-emerald-700 underline">การรับประกันและคืนสินค้า</Link>
            </p>
          </section>

          <section>
            <SectionHeader title="คำถามที่พบบ่อยเรื่องเครื่องมือสอง" />
            <Stack gap={3}>
              {FAQS.map((f) => (
                <Card key={f.question} variant="outlined">
                  <CardBody>
                    <h3 className="font-semibold leading-snug">{f.question}</h3>
                    <p className="mt-1.5 text-sm text-muted-foreground leading-snug">{f.answer}</p>
                  </CardBody>
                </Card>
              ))}
            </Stack>
          </section>

          <section className="rounded-2xl bg-emerald-50 p-6 md:p-8">
            <Stack gap={3} className="items-start leading-snug">
              <h2 className="text-xl font-bold leading-snug">เลือกเครื่องมือสองที่ถูกใจ</h2>
              <p className="text-sm text-muted-foreground leading-snug">
                ดูเครื่องจริงพร้อมเกรด สุขภาพแบต และค่างวดผ่อนของแต่ละเครื่อง หรือทักไลน์สอบถามก่อนได้
              </p>
              <div className="flex flex-wrap gap-3">
                <Button asChild variant="primary">
                  <Link to="/products?condition=USED">ดู iPhone มือสองทั้งหมด</Link>
                </Button>
                <Button asChild variant="outline">
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
