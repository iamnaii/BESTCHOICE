import { useParams, Link } from 'react-router';
import ShopLayout from '../../components/layout/ShopLayout';

export default function ApplySuccessPage() {
  const { applicationNumber } = useParams<{ applicationNumber: string }>();
  return (
    <ShopLayout>
      <div className="container mx-auto px-4 py-8 max-w-xl text-center leading-snug">
        <div className="text-3xl font-bold mb-4">ส่งใบสมัครแล้ว</div>
        <div className="text-lg mb-4">{applicationNumber}</div>
        <p className="text-muted-foreground mb-6">
          ทีมงานจะติดต่อกลับภายใน 2 ชั่วโมง (เวลาทำการ 09:00–20:00)
        </p>
        <Link to="/" className="text-primary underline-offset-4 hover:underline">
          กลับหน้าแรก
        </Link>
      </div>
    </ShopLayout>
  );
}
