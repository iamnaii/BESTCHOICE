import { Link } from 'react-router';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';

export default function TradeInProductHandoff({ productId, pending = true }: {
  productId: string;
  pending?: boolean;
}) {
  const { user } = useAuth();
  const canPrepare = ['OWNER', 'BRANCH_MANAGER'].includes(user?.role ?? '');
  return (
    <div className="rounded-lg border border-success/30 bg-success/5 p-4 space-y-3">
      <p className="font-medium">{pending ? 'รับเครื่องแล้ว — รอเตรียมเครื่องก่อนขาย' : 'บันทึกเครื่องเข้าระบบแล้ว'}</p>
      {pending && <p className="text-sm text-muted-foreground">
        {canPrepare ? 'ตรวจข้อมูลสภาพเครื่อง ตั้งราคาขาย และถ่ายรูป 6 มุมให้ครบ' : 'ถ่ายรูป 6 มุม และให้ผู้จัดการตรวจข้อมูลสภาพเครื่องกับตั้งราคาขาย'} จากนั้นกดยืนยันรูปเพื่อเข้าคลัง เช่นเดียวกับการรับของจาก PO
      </p>}
      <Button asChild variant="outline"><Link to={`/products/${productId}?zone=shop`}>เปิดเครื่อง ดูรูปและราคา</Link></Button>
    </div>
  );
}
