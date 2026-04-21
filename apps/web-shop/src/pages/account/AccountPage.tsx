import { Link, useNavigate } from 'react-router';
import ShopLayout from '../../components/layout/ShopLayout';
import { useAuth } from '../../hooks/useAuth';
import { Button } from '../../components/ui/button';

export default function AccountPage() {
  const { customer, logout } = useAuth();
  const nav = useNavigate();
  if (!customer) {
    nav('/login');
    return null;
  }
  return (
    <ShopLayout>
      <div className="container mx-auto px-4 py-6 space-y-3 max-w-xl leading-snug">
        <h1 className="text-2xl font-bold">บัญชีของฉัน</h1>
        <div className="rounded-xl border border-border p-4">
          <div className="font-semibold">{customer.name}</div>
          <div className="text-sm text-muted-foreground">
            {customer.phone ?? '(ยังไม่ผูกเบอร์)'}
          </div>
          <div className="text-sm mt-2">
            แต้มสะสม: <b>{customer.loyaltyBalance}</b> แต้ม
          </div>
        </div>
        <Link
          className="block rounded-xl border border-border p-4 hover:border-primary transition-colors"
          to="/account/addresses"
        >
          ที่อยู่จัดส่ง
        </Link>
        <Link
          className="block rounded-xl border border-border p-4 hover:border-primary transition-colors"
          to="/orders"
        >
          คำสั่งซื้อของฉัน
        </Link>
        <Button variant="outline" onClick={logout}>
          ออกจากระบบ
        </Button>
      </div>
    </ShopLayout>
  );
}
