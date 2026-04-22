import { Banknote, ScanSearch, Wallet } from 'lucide-react';
import { copy } from '@/lib/copy';
import ShopLayout from '@/components/layout/ShopLayout';
import { LandingHero } from '@/components';

export default function BuybackLandingPage() {
  return (
    <ShopLayout>
      <LandingHero
        eyebrow="บริการเสริม"
        title={copy.buyback.pageTitle}
        description={copy.buyback.description}
        cta={{ label: copy.buyback.quoteCta, to: '/buyback/quote' }}
        steps={[
          {
            icon: <Banknote className="size-8" aria-hidden="true" />,
            title: 'บอกรุ่นและสภาพ',
            description: 'ใช้เวลา 30 วินาที',
          },
          {
            icon: <ScanSearch className="size-8" aria-hidden="true" />,
            title: 'รับราคาเบื้องต้น',
            description: 'เห็นช่วงราคาก่อนตัดสินใจ',
          },
          {
            icon: <Wallet className="size-8" aria-hidden="true" />,
            title: 'ได้เงินสดทันที',
            description: 'จ่ายเงินสด/โอนเมื่อนัดรับเครื่อง',
          },
        ]}
      />
    </ShopLayout>
  );
}
