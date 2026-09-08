import { lazy, Suspense } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { DashboardSkeleton } from '@/components/ui/page-skeletons';

const StaffHome = lazy(() => import('./components/StaffHome'));
const ManagementDashboard = lazy(() => import('./ManagementDashboard'));

export default function DashboardPage() {
  const { user } = useAuth();
  if (!user) return <DashboardSkeleton />;
  return (
    <Suspense fallback={<DashboardSkeleton />}>
      {user.role === 'SALES' ? <StaffHome /> : <ManagementDashboard />}
    </Suspense>
  );
}
