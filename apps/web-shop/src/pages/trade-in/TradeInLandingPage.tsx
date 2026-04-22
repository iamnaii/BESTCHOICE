import { Smartphone, Camera, Handshake } from 'lucide-react';
import { copy } from '@/lib/copy';
import ShopLayout from '@/components/layout/ShopLayout';
import { LandingHero } from '@/components';

export default function TradeInLandingPage() {
  return (
    <ShopLayout>
      <LandingHero
        eyebrow="บริการเสริม"
        title={copy.tradeIn.pageTitle}
        description={copy.tradeIn.description}
        cta={{ label: copy.tradeIn.submitCta, to: '/trade-in/submit' }}
        steps={[
          {
            icon: <Smartphone className="size-8" aria-hidden="true" />,
            title: 'บอกรุ่นและสภาพ',
            description: 'รู้ช่วงราคาทันที',
          },
          {
            icon: <Camera className="size-8" aria-hidden="true" />,
            title: 'ส่งรูปเครื่อง',
            description: 'ประเมินภายใน 24 ชม.',
          },
          {
            icon: <Handshake className="size-8" aria-hidden="true" />,
            title: 'รับเงินสด',
            description: 'หรือเป็นดาวน์เครื่องใหม่',
          },
        ]}
      />
    </ShopLayout>
  );
}
