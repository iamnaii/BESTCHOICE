import { Link, useLocation } from 'react-router';
import { ArrowRight, Store } from 'lucide-react';
import { copy } from '@/lib/copy';
import ShopLayout from '@/components/layout/ShopLayout';
import { Button, Container } from '@/components';
import { usePageMeta } from '@/hooks/usePageMeta';
export default function SellLandingPage() {
  const location = useLocation();
  usePageMeta(copy.sell.pageTitle, copy.sell.description);
  return (
    <ShopLayout>
      <Container narrow className="py-10 md:py-16 leading-snug">
        <div className="mx-auto max-w-xl space-y-6">
          <p className="font-semibold text-secondary-foreground">เบสท์ช้อยส์ · ลพบุรี</p>
          <h1 className="text-3xl font-bold leading-snug md:text-4xl">ขายหรือเทิร์นไอโฟน</h1>
          <p className="text-lg">เลือกเครื่อง ตอบสภาพ แล้วดูราคาประเมินได้เลย</p>
          <p>
            ไม่ต้องสมัครสมาชิก ไม่ต้องถ่ายรูปเครื่อง
            <br />
            นำเครื่องมาตรวจที่ร้านเพื่อยืนยันราคา
          </p>
          <Button asChild size="lg" fullWidth>
            <Link to={{ pathname: '/sell/quote', search: location.search }}>
              เริ่มเช็กราคา
              <ArrowRight size={20} aria-hidden="true" />
            </Link>
          </Button>
          <section className="space-y-3 rounded-2xl bg-secondary p-5 text-secondary-foreground">
            <h2 className="font-semibold">ขายสดหรือใช้เครดิตเทิร์น</h2>
            <p>ขายสด รับเงินที่ร้านหลังตรวจเครื่อง</p>
            <p>{copy.sell.exchangeCreditNote}</p>
            <p>{copy.sell.priceCondition}</p>
          </section>
          <section className="space-y-2 border-t border-border pt-5">
            <h2 className="flex items-center gap-2 font-semibold">
              <Store size={20} aria-hidden="true" />
              มาที่ร้านเบสท์ช้อยส์
            </h2>
            <p>{copy.contact.address}</p>
            <p>{copy.contact.hours}</p>
          </section>
        </div>
      </Container>
    </ShopLayout>
  );
}
