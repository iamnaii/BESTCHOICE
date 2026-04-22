import { Link } from 'react-router';
import { PiggyBank, ShoppingBag, Target } from 'lucide-react';
import ShopLayout from '@/components/layout/ShopLayout';
import { Container, LandingHero } from '@/components';
import { copy } from '@/lib/copy';

export default function SavingPlanLandingPage() {
  return (
    <ShopLayout>
      <LandingHero
        eyebrow="บริการเสริม"
        title={copy.savingPlan.pageTitle}
        description={copy.savingPlan.description}
        cta={{ label: copy.savingPlan.createCta, to: '/saving-plan/create' }}
        steps={[
          {
            icon: <Target className="size-8" />,
            title: 'ตั้งเป้าหมาย',
            description: 'เลือกรุ่นที่อยากได้',
          },
          {
            icon: <PiggyBank className="size-8" />,
            title: 'ออมรายเดือน',
            description: 'เริ่ม 500 บาท/เดือน',
          },
          {
            icon: <ShoppingBag className="size-8" />,
            title: 'แลกเครื่อง',
            description: 'ใช้เงินออมเป็นดาวน์',
          },
        ]}
      />
      <Container>
        <div className="py-6 md:py-8 text-center leading-snug">
          <Link
            to="/account/saving-plans"
            className="inline-flex text-sm text-primary underline-offset-4 hover:underline"
          >
            ดูแผนออมของฉัน
          </Link>
        </div>
      </Container>
    </ShopLayout>
  );
}
