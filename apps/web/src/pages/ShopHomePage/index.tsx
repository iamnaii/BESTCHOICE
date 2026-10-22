import { Link } from 'react-router';
import { PackagePlus, Plus, Search } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { useCommandPalette } from '@/components/CommandPalette';
import PageHeader from '@/components/ui/PageHeader';
import QueryBoundary from '@/components/QueryBoundary';
import { DashboardSkeleton } from '@/components/ui/page-skeletons';
import { Button } from '@/components/ui/button';
import MyTodayTasksCard from '@/pages/DashboardPage/components/MyTodayTasksCard';
import HomeActionsGrid from '@/pages/DashboardPage/components/HomeActionsGrid';
import { useShopHome } from './hooks/useShopHome';
import TodayKpiStrip from './components/TodayKpiStrip';
import WatchList from './components/WatchList';
import MonthlyChart from './components/MonthlyChart';
import TopSellersCard from './components/TopSellersCard';
import SlowMoversCard from './components/SlowMoversCard';
import { thaiDateLong, timeHHMM } from './format';

const CAN_SELL = new Set(['OWNER', 'BRANCH_MANAGER', 'SALES']);

/**
 * หน้าหลักหน้าร้าน — หน้า `/` เมื่อสวิตช์เมนูอยู่โซนหน้าร้าน
 * (spec docs/superpowers/specs/2026-10-22-shop-home-dashboard-design.md · mockup canvas AeXB44haXjLfvXYm5kjUeR)
 */
export default function ShopHomePage() {
  useDocumentTitle('หน้าหลักหน้าร้าน');
  const { user } = useAuth();
  const { open: openSearch } = useCommandPalette();
  const q = useShopHome();
  const role = user?.role ?? '';
  const isSales = role === 'SALES';

  return (
    <QueryBoundary
      isLoading={q.isLoading}
      isError={q.isError}
      error={q.error}
      loadingFallback={<DashboardSkeleton />}
      errorTitle="โหลดหน้าหลักหน้าร้านไม่สำเร็จ"
      errorMessage="ลองโหลดอีกครั้ง หรือเปิดหน้าภาพรวมคลังจากเมนูได้"
      onRetry={() => {
        void q.refetch();
      }}
    >
      {q.data && (
        <div className="flex flex-col gap-5">
          <PageHeader
            title="หน้าหลักหน้าร้าน"
            subtitle={`${q.data.branch.name} · ${thaiDateLong(q.data.generatedAt)} · อัปเดต ${timeHHMM(q.data.generatedAt)}`}
            action={
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" className="min-h-10" onClick={openSearch}>
                  <Search className="size-4" aria-hidden="true" />
                  ค้นหาลูกค้า / IMEI
                </Button>
                {!isSales && (
                  <Button variant="outline" className="min-h-10" asChild>
                    <Link to="/purchase-orders">
                      <PackagePlus className="size-4" aria-hidden="true" />
                      รับของเข้า
                    </Link>
                  </Button>
                )}
                {CAN_SELL.has(role) && (
                  <Button className="min-h-10" asChild>
                    <Link to="/pos">
                      <Plus className="size-4" aria-hidden="true" />
                      ขายสินค้า
                    </Link>
                  </Button>
                )}
              </div>
            }
          />

          <TodayKpiStrip today={q.data.today} />

          {isSales && <HomeActionsGrid role={role} />}

          <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] gap-4 items-stretch">
            <WatchList items={q.data.watch} role={role} />
            <MonthlyChart monthly={q.data.monthly} thisMonth={q.data.thisMonth} />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-stretch">
            <TopSellersCard data={q.data.topSellers30d} />
            <SlowMoversCard slowMovers={q.data.slowMovers} stockAging={q.data.stockAging} />
          </div>

          {isSales && <MyTodayTasksCard />}
        </div>
      )}
    </QueryBoundary>
  );
}
