import { useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import PageHeader from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/button';
import { Plus, Printer, ListChecks } from 'lucide-react';
import { BranchSummaryCards } from './components/BranchSummaryCards';
import { StockHeroKpi } from './components/StockHeroKpi';
import { StockActionZone } from './components/StockActionZone';
import { StockDashboardTab } from './components/StockDashboardTab';
import { useStockOverview } from './hooks/useStockOverview';

export default function StockOverviewPage() {
  useDocumentTitle('ภาพรวมคลัง');
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const filterBranch = searchParams.get('branchId') ?? '';

  const setFilterBranch = useCallback(
    (v: string) => {
      const next = new URLSearchParams(searchParams);
      if (v) next.set('branchId', v);
      else next.delete('branchId');
      setSearchParams(next, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  const { isManager, summary, totalInStock, totalValue, dashboard, warrantyExpiring } =
    useStockOverview(filterBranch);

  const handleActionZoneNav = useCallback(
    (status?: string) => {
      const params = new URLSearchParams();
      if (filterBranch) params.set('branchId', filterBranch);
      if (status) params.set('status', status);
      const qs = params.toString();
      navigate(`/stock/products${qs ? `?${qs}` : ''}`);
    },
    [filterBranch, navigate],
  );

  return (
    <div>
      <PageHeader
        title="ภาพรวมคลัง"
        subtitle="KPIs · งานต้องทำ · สาขา · สถิติ"
        action={
          <div className="flex gap-2 flex-wrap">
            <Button variant="outline" size="md" onClick={() => navigate('/stock/products')}>
              <ListChecks className="size-4" />
              รายการสินค้า
            </Button>
            <Button variant="outline" size="md" onClick={() => navigate('/stickers')}>
              <Printer className="size-4" />
              พิมพ์สติกเกอร์
            </Button>
            {isManager && (
              <Button variant="primary" size="md" onClick={() => navigate('/products/create')}>
                <Plus className="size-4" />
                เพิ่มสินค้า
              </Button>
            )}
          </div>
        }
      />

      <StockHeroKpi
        totalInStock={totalInStock}
        totalValue={totalValue}
        dashboard={dashboard}
        isManager={isManager}
      />

      <StockActionZone
        dashboard={dashboard}
        warrantyExpiring={warrantyExpiring}
        onNavigateToList={handleActionZoneNav}
      />

      <BranchSummaryCards
        summary={summary}
        filterBranch={filterBranch}
        setFilterBranch={setFilterBranch}
      />

      <StockDashboardTab dashboard={dashboard} isManager={isManager} />
    </div>
  );
}
