import { lazy, Suspense } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useLayout } from '@/components/layout/LayoutContext';
import { DashboardSkeleton } from '@/components/ui/page-skeletons';

const StaffHome = lazy(() => import('./components/StaffHome'));
const ManagementDashboard = lazy(() => import('./ManagementDashboard'));
const ShopHomePage = lazy(() => import('@/pages/ShopHomePage'));

/**
 * หน้า `/` เลือกตามโซนที่สวิตช์เมนูอยู่ (workZone ไม่ใช่ currentZone — กดเฟืองตั้งค่าแล้วกลับมา
 * ยังได้หน้าเดิมที่ทำงานอยู่): โซนหน้าร้าน → หน้าหลักหน้าร้านทุกบทบาท; โซนการเงิน → ของเดิม
 */
export default function DashboardPage() {
  const { user } = useAuth();
  const { workZone } = useLayout();
  if (!user) return <DashboardSkeleton />;
  return (
    <Suspense fallback={<DashboardSkeleton />}>
      {workZone === 'shop' ? (
        <ShopHomePage />
      ) : user.role === 'SALES' ? (
        <StaffHome />
      ) : (
        <ManagementDashboard />
      )}
    </Suspense>
  );
}
