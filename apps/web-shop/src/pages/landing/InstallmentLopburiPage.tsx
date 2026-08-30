import { Link } from 'react-router';
import { UserCheck, Clock3, Store, ShieldCheck } from 'lucide-react';
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
 * Landing เจาะคำค้นท้องถิ่น "ผ่อนไอโฟนลพบุรี" — เนื้อหาตอบคำถามตรง ๆ ก่อน
 * แล้วค่อยลงรายละเอียด (answer-first) เพื่อให้ search/AI หยิบไปตอบได้
 * ทุกตัวเลขในหน้านี้ต้องตรงกับ /how-it-works และ /installment-terms เสมอ
 */

const WHY_US = [
  {
    icon: <UserCheck className="size-6 text-emerald-600" aria-hidden="true" />,
    title: 'บัตรประชาชนใบเดียว',
    description: 'ไม่ต้องใช้บัตรเครดิต ไม่ต้องมีผู้ค้ำ ไม่ต้องใช้สลิปเงินเดือน',
  },
  {
    icon: <Clock3 className="size-6 text-emerald-600" aria-hidden="true" />,
    title: 'อนุมัติไว รับเครื่องได้เลย',
    description: 'สมัครออนไลน์หรือที่หน้าร้าน ทราบผลเร็ว ผ่านแล้วรับเครื่องได้ทันที',
  },
  {
    icon: <Store className="size-6 text-emerald-600" aria-hidden="true" />,
    title: 'หน้าร้านจริงในลพบุรี',
    description: `มีหน้าร้านบนถนนนารายณ์มหาราช เปิดทุกวัน 10:00-19:00 น. ลูกค้ารีวิวบน Google กว่า 860 รายการ คะแนน 5.0`,
  },
  {
    icon: <ShieldCheck className="size-6 text-emerald-600" aria-hidden="true" />,
    title: 'เงื่อนไขโปร่งใส',
    description: 'ค่างวดเท่ากันทุกเดือน ไม่มีค่าธรรมเนียมแอบแฝง อ่านเงื่อนไขได้ครบก่อนตัดสินใจ',
  },
];

const STEPS = [
  { no: 1, title: 'เลือกเครื่องที่ถูกใจ', description: 'ดูราคาและค่างวดจริงของทุกเครื่องได้ในหน้าสินค้า ทั้งมือ 1 และมือสอง' },
  { no: 2, title: 'สมัครด้วยบัตรประชาชน', description: 'กรอกข้อมูลออนไลน์ หรือเดินเข้ามาสมัครที่หน้าร้านก็ได้' },
  { no: 3, title: 'เลือกดาวน์และจำนวนงวด', description: 'ดาวน์เริ่มประมาณ 20-30% ของราคาเครื่อง เลือกผ่อน 3, 6, 9 หรือ 12 งวด' },
  { no: 4, title: 'รับเครื่องกลับบ้าน', description: 'อนุมัติแล้วรับเครื่องที่ร้าน หรือให้จัดส่งถึงบ้านทั่วประเทศ' },
];

const FAQS = [
  {
    question: 'ผ่อน iPhone ที่ลพบุรีต้องใช้เอกสารอะไรบ้าง',
    answer: 'ใช้บัตรประชาชนตัวจริงใบเดียวเท่านั้น ไม่ต้องใช้บัตรเครดิต สลิปเงินเดือน หรือผู้ค้ำประกัน',
  },
  {
    question: 'ร้านอยู่ตรงไหนของลพบุรี',
    answer: `ร้าน BESTCHOICE อยู่บนถนนนารายณ์มหาราช อำเภอเมืองลพบุรี เปิดทุกวัน 10:00-19:00 น. โทร ${shopInfo.phoneDisplay}`,
  },
  {
    question: 'ไม่สะดวกมาที่ร้าน สมัครผ่อนออนไลน์ได้ไหม',
    answer: 'ได้ เลือกเครื่องและสมัครผ่อนผ่านเว็บไซต์ได้เลย ทีมงานติดต่อกลับทาง LINE และจัดส่งเครื่องถึงบ้านได้ทั่วประเทศ',
  },
  {
    question: 'เครื่องมือสองผ่อนได้เหมือนเครื่องใหม่ไหม',
    answer: 'ได้เหมือนกันทุกอย่าง เงื่อนไขเดียวกัน — เครื่องมือสองทุกเครื่องผ่านการตรวจสภาพและมีประกันร้าน',
  },
  {
    question: 'ผ่อนกี่งวด ดาวน์เท่าไร',
    answer: 'เลือกผ่อนได้ 3, 6, 9 หรือ 12 งวด เงินดาวน์เริ่มประมาณ 20-30% ของราคาเครื่อง ขึ้นกับรุ่นและจำนวนงวดที่เลือก',
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

export default function InstallmentLopburiPage() {
  usePageMeta(
    'ผ่อน iPhone ลพบุรี บัตรประชาชนใบเดียว',
    'ผ่อน iPhone ที่ลพบุรีด้วยบัตรประชาชนใบเดียว ไม่ใช้บัตรเครดิต ไม่ต้องมีผู้ค้ำ เลือกผ่อน 3-12 งวด มีหน้าร้านจริง รีวิว 5.0 บน Google',
  );

  return (
    <ShopLayout>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: FAQ_JSON_LD }} />
      <CategoryHero
        title="ผ่อน iPhone ลพบุรี"
        description="ผ่อนไอโฟนด้วยบัตรประชาชนใบเดียว ไม่ต้องใช้บัตรเครดิต ไม่ต้องมีผู้ค้ำ — ร้านมือถือลพบุรีที่มีหน้าร้านจริง เลือกผ่อนได้ 3-12 งวด ทั้ง iPhone มือ 1 และมือสอง"
        breadcrumbs={[{ label: 'หน้าแรก', to: '/' }, { label: 'ผ่อน iPhone ลพบุรี' }]}
      />
      <Container>
        <Stack gap={6} className="py-8">
          <section>
            <SectionHeader title="ทำไมคนลพบุรีผ่อนกับ BESTCHOICE" />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {WHY_US.map((w) => (
                <Card key={w.title} variant="outlined">
                  <CardBody>
                    <Stack gap={2} className="leading-snug">
                      {w.icon}
                      <h3 className="font-semibold leading-snug">{w.title}</h3>
                      <p className="text-sm text-muted-foreground leading-snug">{w.description}</p>
                    </Stack>
                  </CardBody>
                </Card>
              ))}
            </div>
          </section>

          <section>
            <SectionHeader title="ผ่อนยังไง — 4 ขั้นตอน" />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {STEPS.map((s) => (
                <Card key={s.no} variant="outlined">
                  <CardBody>
                    <div className="flex items-start gap-3 leading-snug">
                      <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 text-sm font-semibold">
                        {s.no}
                      </span>
                      <div>
                        <h3 className="font-semibold leading-snug">{s.title}</h3>
                        <p className="mt-1 text-sm text-muted-foreground leading-snug">{s.description}</p>
                      </div>
                    </div>
                  </CardBody>
                </Card>
              ))}
            </div>
            <p className="mt-3 text-sm text-muted-foreground leading-snug">
              อ่านขั้นตอนละเอียดได้ที่ <Link to="/how-it-works" className="text-emerald-700 underline">วิธีผ่อน</Link>{' '}
              และเงื่อนไขทั้งหมดที่ <Link to="/installment-terms" className="text-emerald-700 underline">เงื่อนไขการผ่อน</Link>
            </p>
          </section>

          <section>
            <SectionHeader title="คำถามที่คนลพบุรีถามบ่อย" />
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
              <h2 className="text-xl font-bold leading-snug">พร้อมผ่อนแล้ว?</h2>
              <p className="text-sm text-muted-foreground leading-snug">
                ดูเครื่องพร้อมราคาผ่อนจริงทุกเครื่อง หรือทักไลน์ให้ทีมงานช่วยเลือกรุ่นที่เหมาะกับงบ
              </p>
              <div className="flex flex-wrap gap-3">
                <Button asChild variant="primary">
                  <Link to="/products">ดูสินค้าทั้งหมด</Link>
                </Button>
                <Button asChild variant="outline">
                  <a href={lineOaMessageUrl('สนใจผ่อน iPhone ครับ/ค่ะ')} target="_blank" rel="noopener noreferrer">
                    ทักไลน์ {shopInfo.lineHandle}
                  </a>
                </Button>
              </div>
              <p className="text-xs text-muted-foreground leading-snug">
                อ่านเพิ่ม: <Link to="/iphone-มือสอง-ลพบุรี" className="underline">iPhone มือสอง ลพบุรี</Link> ·{' '}
                <Link to="/ผ่อนมือถือไม่ใช้บัตรเครดิต" className="underline">ผ่อนมือถือไม่ใช้บัตรเครดิต</Link>
              </p>
            </Stack>
          </section>
        </Stack>
      </Container>
    </ShopLayout>
  );
}
