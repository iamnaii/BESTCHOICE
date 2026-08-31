import { Link } from 'react-router';
import { UserCheck, X, Check } from 'lucide-react';
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
 * Landing เจาะคำค้น "ผ่อนมือถือไม่ใช้บัตรเครดิต" (long-tail ไม่ผูกจังหวัด) —
 * อธิบายกลไกให้คนที่ถูกปฏิเสธจากช่องทางบัตรเครดิต/ไฟแนนซ์ใหญ่เข้าใจว่าทำได้จริงยังไง
 */

const NOT_NEEDED = [
  'บัตรเครดิต',
  'สลิปเงินเดือน',
  'ผู้ค้ำประกัน',
  'เอกสารรายได้ย้อนหลัง',
];

const NEEDED = [
  'บัตรประชาชนตัวจริง 1 ใบ',
  'เงินดาวน์ขั้นต่ำ 15% ของราคาเครื่อง (เริ่มต้นราว 900 บาท)',
];

const FAQS = [
  {
    question: 'ไม่มีบัตรเครดิต ผ่อนโทรศัพท์ได้จริงไหม',
    answer: 'ได้จริง ที่ BESTCHOICE ใช้บัตรประชาชนใบเดียวสมัครผ่อน ไม่ต้องมีบัตรเครดิต เพราะร้านเป็นผู้ให้ผ่อนเอง ไม่ได้ผ่านบริษัทบัตร',
  },
  {
    question: 'อาชีพอิสระ ค้าขาย ไม่มีสลิปเงินเดือน ผ่อนได้ไหม',
    answer: 'ได้ ไม่ต้องใช้สลิปเงินเดือนหรือเอกสารรายได้ — ใช้บัตรประชาชนใบเดียวพร้อมเงินดาวน์ตามเงื่อนไข',
  },
  {
    question: 'ผ่อนแบบนี้ต่างจากผ่อนผ่านบัตรเครดิตยังไง',
    answer: 'ผ่อนผ่านบัตรเครดิตต้องมีวงเงินบัตรและประวัติการเงินผ่านเกณฑ์ธนาคาร ส่วนการผ่อนกับร้านโดยตรงใช้เงินดาวน์กับบัตรประชาชนเป็นหลัก ค่างวดคงที่เท่ากันทุกเดือน แจ้งยอดชัดเจนก่อนเซ็นสัญญา',
  },
  {
    question: 'มีค่าใช้จ่ายแอบแฝงไหม',
    answer: 'ไม่มี ค่างวดที่แจ้งคือยอดที่จ่ายจริงทุกเดือน อ่านเงื่อนไขดอกเบี้ยและการเป็นเจ้าของเครื่องได้ครบถ้วนบนหน้าเงื่อนไขการผ่อนก่อนตัดสินใจ',
  },
  {
    question: 'อยู่ต่างจังหวัด ไม่ได้อยู่ลพบุรี ผ่อนได้ไหม',
    answer: 'ทักไลน์สอบถามได้จากทุกจังหวัด แต่การทำสัญญาผ่อนต้องมารับเครื่องที่ร้านลพบุรี เพื่อยืนยันตัวตนและเซ็นสัญญา',
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

export default function NoCreditCardPage() {
  usePageMeta(
    'ผ่อนมือถือไม่ใช้บัตรเครดิต ใช้บัตรประชาชนใบเดียว',
    'ผ่อนมือถือโดยไม่ต้องมีบัตรเครดิต ไม่เช็กบูโร ไม่ต้องมีผู้ค้ำ — ใช้บัตรประชาชนใบเดียว ผ่อน iPhone มือ 1 และมือสองได้สูงสุด 12 งวด ดาวน์เริ่ม 900 บาท',
  );

  return (
    <ShopLayout>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: FAQ_JSON_LD }} />
      <CategoryHero
        title="ผ่อนมือถือไม่ใช้บัตรเครดิต"
        description="ไม่มีบัตรเครดิตก็ผ่อน iPhone ได้ — ร้านเป็นผู้ให้ผ่อนเองโดยตรง ใช้บัตรประชาชนใบเดียวกับเงินดาวน์ ไม่ต้องมีผู้ค้ำ ไม่ต้องใช้สลิปเงินเดือน"
        breadcrumbs={[{ label: 'หน้าแรก', to: '/' }, { label: 'ผ่อนมือถือไม่ใช้บัตรเครดิต' }]}
      />
      <Container>
        <Stack gap={6} className="py-8">
          <section>
            <SectionHeader title="ใช้อะไรบ้าง — เทียบกันชัด ๆ" />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Card variant="outlined">
                <CardBody>
                  <h3 className="font-semibold leading-snug">สิ่งที่ไม่ต้องมี</h3>
                  <ul className="mt-3 space-y-2">
                    {NOT_NEEDED.map((item) => (
                      <li key={item} className="flex items-center gap-2 text-sm text-muted-foreground leading-snug">
                        <X className="size-4 shrink-0 text-red-500" aria-hidden="true" />
                        {item}
                      </li>
                    ))}
                  </ul>
                </CardBody>
              </Card>
              <Card variant="outlined">
                <CardBody>
                  <h3 className="font-semibold leading-snug">สิ่งที่ต้องมี</h3>
                  <ul className="mt-3 space-y-2">
                    {NEEDED.map((item) => (
                      <li key={item} className="flex items-center gap-2 text-sm text-muted-foreground leading-snug">
                        <Check className="size-4 shrink-0 text-emerald-600" aria-hidden="true" />
                        {item}
                      </li>
                    ))}
                  </ul>
                  <p className="mt-3 flex items-start gap-2 text-sm text-muted-foreground leading-snug">
                    <UserCheck className="size-4 shrink-0 mt-0.5 text-emerald-600" aria-hidden="true" />
                    แค่นี้จริง ๆ — เดินเข้าหน้าร้านลพบุรีได้เลย หรือทักไลน์สอบถามก่อนได้จากทุกจังหวัด
                  </p>
                </CardBody>
              </Card>
            </div>
          </section>

          <section>
            <SectionHeader title="คำถามที่พบบ่อย" />
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
              <h2 className="text-xl font-bold leading-snug">เริ่มเลือกเครื่องได้เลย</h2>
              <p className="text-sm text-muted-foreground leading-snug">
                ทุกเครื่องแสดงค่างวดจริงต่อเดือน ปรับดาวน์และจำนวนงวดดูได้ก่อนตัดสินใจ
              </p>
              <div className="flex flex-wrap gap-3">
                <Button asChild variant="primary" size="lg">
                  <Link to="/products">ดูสินค้าพร้อมค่างวด</Link>
                </Button>
                <Button asChild variant="line" size="lg">
                  <a href={lineOaMessageUrl('สอบถามผ่อนมือถือครับ/ค่ะ')} target="_blank" rel="noopener noreferrer">
                    ทักไลน์ {shopInfo.lineHandle}
                  </a>
                </Button>
              </div>
              <p className="text-xs text-muted-foreground leading-snug">
                อ่านเพิ่ม: <Link to="/ผ่อนไอโฟนลพบุรี" className="underline">ผ่อน iPhone ลพบุรี</Link> ·{' '}
                <Link to="/installment-terms" className="underline">เงื่อนไขการผ่อนฉบับเต็ม</Link>
              </p>
            </Stack>
          </section>
        </Stack>
      </Container>
    </ShopLayout>
  );
}
