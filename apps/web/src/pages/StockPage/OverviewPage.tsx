import { useCallback } from 'react';
import { useNavigate } from 'react-router';
import { useLatestSearchParams } from '@/hooks/useLatestSearchParams';
import { useStockInventoryScope } from './hooks/useStockInventoryScope';
import { InventoryScopeFilter } from './components/InventoryScopeFilter';
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
  const [searchParams, updateParams] = useLatestSearchParams();
  const { inventoryScope, setInventoryScope } = useStockInventoryScope('devices', [
    searchParams,
    updateParams,
  ]);
  const filterBranch = searchParams.get('branchId') ?? '';

  const setFilterBranch = useCallback(
    (v: string) => {
      updateParams((next) => {
        if (v) next.set('branchId', v);
        else next.delete('branchId');
      });
    },
    [updateParams],
  );

  const {
    isManager,
    summary,
    totalInStock,
    totalValue,
    dashboard,
    warrantyExpiring,
    summaryQuery,
    dashboardQuery,
    warrantyQuery,
  } = useStockOverview(filterBranch, inventoryScope);

  const handleActionZoneNav = useCallback(
    (filters: { status?: string; aging?: 'over90' } = {}) => {
      const params = new URLSearchParams(searchParams);
      params.set('inventoryScope', inventoryScope);
      params.set('view', filters.aging || !filters.status ? 'ready' : 'all');
      if (filterBranch) params.set('branchId', filterBranch);
      if (filters.status) params.set('status', filters.status);
      else params.delete('status');
      if (filters.aging) params.set('aging', filters.aging);
      else params.delete('aging');
      const qs = params.toString();
      navigate(`/stock/products${qs ? `?${qs}` : ''}`);
    },
    [filterBranch, navigate, searchParams, inventoryScope],
  );

  return (
    <div>
      <PageHeader
        title="ภาพรวมคลัง"
        subtitle="สต๊อกพร้อมขาย เงินทุน และงานที่ต้องจัดการ"
        action={
          <div className="flex gap-2 flex-wrap">
            <Button variant="outline" size="md" onClick={() => handleActionZoneNav()}>
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

      <InventoryScopeFilter value={inventoryScope} onValueChange={setInventoryScope} />
      <SectionStatus
        label="ยอดคลังและสาขา"
        loading={summaryQuery.isLoading}
        error={summaryQuery.isError}
        retry={() => void summaryQuery.refetch()}
      />
      <SectionStatus
        label="สถิติคลัง"
        loading={dashboardQuery.isLoading}
        error={dashboardQuery.isError}
        retry={() => void dashboardQuery.refetch()}
      />
      {(summaryQuery.data || dashboard) && (
        <>
          <StockHeroKpi
            inventoryScope={inventoryScope}
            totalInStock={
              summaryQuery.data ? totalInStock : (dashboard?.stockTurnover.currentStock ?? null)
            }
            totalValue={summaryQuery.data ? totalValue : null}
            dashboard={dashboard}
            isManager={isManager}
          />

          <SectionStatus
            label="ข้อมูลประกัน"
            loading={warrantyQuery.isLoading}
            error={warrantyQuery.isError}
            retry={() => void warrantyQuery.refetch()}
          />
          <StockActionZone
            warrantyReady={warrantyQuery.isSuccess}
            dashboard={dashboard}
            warrantyExpiring={warrantyExpiring}
            onNavigateToList={handleActionZoneNav}
            onNavigateToTransfers={() => {
              const params = new URLSearchParams(searchParams);
              params.set('inventoryScope', inventoryScope);
              params.set('view', 'outgoing');
              params.set('status', 'PENDING');
              navigate(`/stock/transfers?${params}`);
            }}
          />

          {summaryQuery.data && (
            <BranchSummaryCards
              unit={inventoryScope === 'devices' ? 'เครื่อง' : 'ชิ้น'}
              summary={summary}
              filterBranch={filterBranch}
              setFilterBranch={setFilterBranch}
            />
          )}

          <StockDashboardTab
            dashboard={dashboard}
            isManager={isManager}
            unit={inventoryScope === 'devices' ? 'เครื่อง' : 'ชิ้น'}
          />
        </>
      )}
    </div>
  );
}

function SectionStatus({
  label,
  loading,
  error,
  retry,
}: {
  label: string;
  loading: boolean;
  error: boolean;
  retry: () => void;
}) {
  if (error)
    return (
      <div role="alert" className="rounded-xl border border-destructive/40 p-4 mb-4">
        <p>โหลด{label}ไม่สำเร็จ หรือไม่มีสิทธิ์ดู</p>
        <Button variant="outline" onClick={retry} className="mt-2">
          ลองใหม่เฉพาะ{label}
        </Button>
      </div>
    );
  if (loading)
    return (
      <p role="status" className="p-4 mb-4 rounded-xl bg-muted">
        กำลังโหลด{label}…
      </p>
    );
  return null;
}
