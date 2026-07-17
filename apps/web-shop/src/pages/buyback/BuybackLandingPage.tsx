import { Banknote, ClipboardCheck, Store } from 'lucide-react';
import { copy } from '@/lib/copy';
import ShopLayout from '@/components/layout/ShopLayout';
import { Card, CardBody, Container, LandingHero } from '@/components';
import { usePageMeta } from '@/hooks/usePageMeta';

const TRUST_POINTS = [
  { title: 'ราคามาตรฐาน ไม่ต้องต่อรอง', description: 'ทุกคำตอบมีราคากำกับชัดเจน เห็น breakdown ทุกรายการหัก' },
  { title: 'ตรวจเครื่องต่อหน้า ปฏิเสธได้', description: 'ยืนยันราคาจริงตอนตรวจเครื่องที่ร้าน ไม่พอใจราคายกเลิกได้ ฟรี' },
  { title: 'ลบข้อมูลให้ฟรี ปลอดภัย', description: 'ทีมงานช่วยสำรอง/ลบข้อมูลก่อนขาย ใช้บัตรประชาชนใบเดียว' },
];

export default function BuybackLandingPage() {
  usePageMeta(
    copy.buyback.pageTitle,
    'รับซื้อ iPhone มือสอง ลพบุรี รู้ราคาทันทีออนไลน์ จ่ายเงินสดที่ร้าน ราคามาตรฐานไม่ต้องต่อรอง',
  );

  return (
    <ShopLayout>
      <LandingHero
        eyebrow="บริการเสริม"
        title="ขาย iPhone รู้ราคาใน 1 นาที"
        description={copy.buyback.description}
        cta={{ label: copy.buyback.quoteCta, to: '/buyback/quote' }}
        steps={[
          {
            icon: <ClipboardCheck className="size-8" aria-hidden="true" />,
            title: 'เช็คราคาออนไลน์',
            description: 'เลือกรุ่น ตอบแบบประเมินสภาพ เห็นราคาทันที',
          },
          {
            icon: <Banknote className="size-8" aria-hidden="true" />,
            title: 'ยืนยันการขาย',
            description: 'ส่งชื่อ-เบอร์ นัดวันเข้าร้าน',
          },
          {
            icon: <Store className="size-8" aria-hidden="true" />,
            title: 'มาที่ร้าน รับเงินสด',
            description: 'ตรวจเครื่องต่อหน้า จ่ายทันที',
          },
        ]}
      />
      <Container narrow className="py-8 md:py-12">
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
