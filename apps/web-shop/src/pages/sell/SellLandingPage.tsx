import { Banknote, ClipboardCheck, Repeat, Store } from 'lucide-react';
import { copy } from '@/lib/copy';
import ShopLayout from '@/components/layout/ShopLayout';
import { Card, CardBody, Container, LandingHero } from '@/components';
import { usePageMeta } from '@/hooks/usePageMeta';

const OPTIONS = [
  {
    icon: <Banknote className="size-7" aria-hidden="true" />,
    title: copy.sell.cashOption,
    description: 'ตกลงราคาออนไลน์ มารับเงินสด/โอนที่ร้านทันทีหลังตรวจเครื่อง',
  },
  {
    icon: <Repeat className="size-7" aria-hidden="true" />,
    title: copy.sell.exchangeOption,
    description: 'ได้มูลค่าสูงกว่าขายสด — ใช้เป็นส่วนลดเลือกซื้อเครื่องใหม่ในร้าน',
  },
];

const TRUST_POINTS = [
  { title: 'ราคามาตรฐาน ไม่ต้องต่อรอง', description: 'ทุกคำตอบมีราคากำกับชัดเจน เห็นที่หักทุกรายการ' },
  { title: 'ตรวจเครื่องต่อหน้า ปฏิเสธได้', description: 'ยืนยันราคาจริงตอนตรวจเครื่องที่ร้าน ไม่พอใจยกเลิกได้ ฟรี' },
  { title: 'ลบข้อมูลให้ฟรี ปลอดภัย', description: 'ทีมงานช่วยสำรอง/ลบข้อมูลก่อนขาย ใช้บัตรประชาชนใบเดียว' },
];

export default function SellLandingPage() {
  usePageMeta(
    copy.sell.pageTitle,
    'ขายหรือเทิร์น iPhone ลพบุรี รู้ราคาทันทีออนไลน์ รับเงินสดหรือเทิร์นแลกเครื่องใหม่ได้ราคาเพิ่ม',
  );

  return (
    <ShopLayout>
      <LandingHero
        eyebrow="บริการเสริม"
        title="ขาย/เทิร์น iPhone รู้ราคาใน 1 นาที"
        description={copy.sell.description}
        cta={{ label: copy.sell.quoteCta, to: '/sell/quote' }}
        steps={[
          {
            icon: <ClipboardCheck className="size-8" aria-hidden="true" />,
            title: 'เช็คราคาออนไลน์',
            description: 'เลือกรุ่น ตอบแบบประเมิน เห็น 2 ราคาทันที',
          },
          {
            icon: <Repeat className="size-8" aria-hidden="true" />,
            title: 'เลือกทางที่ชอบ',
            description: 'รับเงินสด หรือเทิร์นได้ราคาเพิ่ม',
          },
          {
            icon: <Store className="size-8" aria-hidden="true" />,
            title: 'มาที่ร้าน',
            description: 'ตรวจเครื่องต่อหน้า จ่ายสด/เลือกเครื่องใหม่',
          },
        ]}
      />
      <Container narrow className="py-8 md:py-12 space-y-6">
        <div className="grid gap-3 sm:grid-cols-2">
          {OPTIONS.map((o) => (
            <Card key={o.title} variant="elevated">
              <CardBody className="space-y-2 leading-snug">
                <div className="flex items-center gap-2 font-semibold leading-snug">
                  {o.icon}
                  {o.title}
                </div>
                <p className="text-sm text-muted-foreground leading-snug">{o.description}</p>
              </CardBody>
            </Card>
          ))}
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          {TRUST_POINTS.map((t) => (
            <Card key={t.title} variant="outlined">
              <CardBody className="space-y-1 leading-snug">
                <div className="font-semibold leading-snug">{t.title}</div>
                <p className="text-sm text-muted-foreground leading-snug">{t.description}</p>
              </CardBody>
            </Card>
          ))}
        </div>
      </Container>
    </ShopLayout>
  );
}
