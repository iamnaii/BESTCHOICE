import { useAuth } from '@/contexts/AuthContext';
import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import { DashboardSkeleton } from '@/components/ui/page-skeletons';
import QueryBoundary from '@/components/QueryBoundary';
import DashboardAlerts from './components/DashboardAlerts';
import DashboardKPIs from './components/DashboardKPIs';
import DashboardWatchList from './components/DashboardWatchList';
import DashboardRevenue from './components/DashboardRevenue';
import DashboardStaff from './components/DashboardStaff';
import DashboardCharts from './components/DashboardCharts';
import DashboardTables from './components/DashboardTables';
import DashboardMySales from './components/DashboardMySales';
import DashboardFinanceOverview from './components/DashboardFinanceOverview';
import type {
  KPIs,
  MonthlyTrend,
  TopOverdue,
  StatusDistribution,
  BranchComparison,
  MonthlyRevenue,
  AgingSummary,
  StaffPerformance,
  CollectionPipeline,
  DashboardAlert,
  UpsellCandidates,
  WatchList,
  EntityProfit,
  ComparativePL,
} from './types';

export default function DashboardPage() {
  const { user } = useAuth();

  const dashboardStaleTime = 5 * 60 * 1000;

  /* ─── Queries ─── */
  const { data: kpis, isLoading: kpisLoading, isError: kpisError, refetch: refetchKpis } = useQuery<KPIs>({
    queryKey: ['dashboard-kpis'],
    queryFn: async () => (await api.get('/dashboard/kpis')).data,
    staleTime: dashboardStaleTime,
  });

  const { data: trend = [], isError: trendError, refetch: refetchTrend } = useQuery<MonthlyTrend[]>({
    queryKey: ['dashboard-trend'],
    queryFn: async () => (await api.get('/dashboard/monthly-trend')).data,
    staleTime: dashboardStaleTime,
  });

  const { data: topOverdue = [], isError: topOverdueError, refetch: refetchTopOverdue } = useQuery<TopOverdue[]>({
    queryKey: ['dashboard-top-overdue'],
    queryFn: async () => (await api.get('/dashboard/top-overdue')).data,
    staleTime: dashboardStaleTime,
  });

  const { data: statusDist = [], isError: statusDistError, refetch: refetchStatusDist } = useQuery<StatusDistribution[]>({
    queryKey: ['dashboard-status-dist'],
    queryFn: async () => (await api.get('/dashboard/status-distribution')).data,
    staleTime: dashboardStaleTime,
  });

  const { data: branchData = [], isError: branchError, refetch: refetchBranch } = useQuery<BranchComparison[]>({
    queryKey: ['dashboard-branches'],
    queryFn: async () => (await api.get('/dashboard/branch-comparison')).data,
    enabled: user?.role === 'OWNER',
    staleTime: dashboardStaleTime,
  });

  const { data: revenue, isError: revenueError, refetch: refetchRevenue } = useQuery<MonthlyRevenue>({
    queryKey: ['dashboard-revenue'],
    queryFn: async () => (await api.get('/dashboard/monthly-revenue')).data,
    enabled: user?.role !== 'SALES',
    staleTime: dashboardStaleTime,
  });

  const { data: aging, isError: agingError, refetch: refetchAging } = useQuery<AgingSummary>({
    queryKey: ['dashboard-aging'],
    queryFn: async () => (await api.get('/dashboard/aging-summary')).data,
    staleTime: dashboardStaleTime,
  });

  const { data: staffPerf, isError: staffError, refetch: refetchStaff } = useQuery<StaffPerformance>({
    queryKey: ['dashboard-staff'],
    queryFn: async () => (await api.get('/dashboard/staff-performance')).data,
    enabled: user?.role === 'OWNER',
    staleTime: dashboardStaleTime,
  });

  const { data: collectionPipeline, isError: pipelineError, refetch: refetchPipeline } = useQuery<CollectionPipeline>({
    queryKey: ['dashboard-collection-pipeline'],
    queryFn: async () => (await api.get('/overdue/pipeline')).data,
    staleTime: dashboardStaleTime,
  });

  const { data: alerts = [] } = useQuery<DashboardAlert[]>({
    queryKey: ['dashboard-alerts'],
    queryFn: async () => (await api.get('/dashboard/alerts')).data,
    staleTime: 30 * 1000,
    refetchInterval: 60 * 1000,
  });

  const { data: upsell } = useQuery<UpsellCandidates>({
    queryKey: ['dashboard-upsell-candidates'],
    queryFn: async () => (await api.get('/customers/upsell-candidates?limit=5')).data,
    staleTime: dashboardStaleTime,
  });

  const { data: watchListData } = useQuery<WatchList>({
    queryKey: ['dashboard-watch-list'],
    queryFn: async () => (await api.get('/dashboard/watch-list')).data,
    staleTime: 2 * 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
  });

  const { data: entityProfit, isError: entityProfitError } = useQuery<EntityProfit>({
    queryKey: ['dashboard-entity-profit'],
    queryFn: async () => {
      const now = new Date();
      const startDate = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
      const endDate = now.toISOString().slice(0, 10);
      return (await api.get(`/reports/entity-profit?startDate=${startDate}&endDate=${endDate}`)).data;
    },
    enabled: user?.role === 'OWNER' || user?.role === 'FINANCE_MANAGER' || user?.role === 'ACCOUNTANT',
    staleTime: dashboardStaleTime,
    retry: 1,
  });

  const { data: comparativePL } = useQuery<ComparativePL>({
    queryKey: ['dashboard-comparative-pl'],
    queryFn: async () => {
      const now = new Date();
      return (await api.get(`/reports/comparative-pl?year=${now.getFullYear()}&month=${now.getMonth() + 1}`)).data;
    },
    enabled: user?.role === 'OWNER' || user?.role === 'FINANCE_MANAGER' || user?.role === 'ACCOUNTANT',
    staleTime: dashboardStaleTime,
    retry: 1,
  });

  if (kpisLoading && !kpis) return <DashboardSkeleton />;
  if (kpisError) return <QueryBoundary isLoading={false} isError={true} error={null} onRetry={refetchKpis} errorTitle="ไม่สามารถโหลด Dashboard ได้">{null}</QueryBoundary>;

  return (
    <div className="flex flex-col gap-5 lg:gap-7.5">
      {/* Page Title */}
      <div>
        <h1 className="text-xl font-bold text-foreground">Dashboard</h1>
        <p className="text-sm text-muted-foreground mt-1">
          สวัสดี {user?.name} — ภาพรวมธุรกิจและการกำกับพนักงาน
        </p>
      </div>

      {/* Error State */}
      {/* Smart Alerts */}
      <DashboardAlerts alerts={alerts} />

      {/* Role-specific: Sales dashboard */}
      {user?.role === 'SALES' && <DashboardMySales />}

      {/* Role-specific: Finance Manager overview */}
      {user?.role === 'FINANCE_MANAGER' && <DashboardFinanceOverview />}

      {/* KPI Stats */}
      {kpis && <DashboardKPIs kpis={kpis} comparativePL={comparativePL} />}

      {/* Watch List + Upsell */}
      <DashboardWatchList watchListData={watchListData} upsell={upsell} />

      {/* Shortcuts + Revenue + Financial Summary */}
      <DashboardRevenue
        userRole={user?.role}
        kpis={kpis}
        revenue={revenue}
        revenueError={revenueError}
        refetchRevenue={() => refetchRevenue()}
        entityProfit={entityProfit}
        entityProfitError={entityProfitError}
      />

      {/* Aging Buckets + Staff Performance */}
      <DashboardStaff
        userRole={user?.role}
        aging={aging}
        agingError={agingError}
        refetchAging={() => refetchAging()}
        staffPerf={staffPerf}
        staffError={staffError}
        refetchStaff={() => refetchStaff()}
      />

      {/* Charts: Trend + Status Distribution */}
      <DashboardCharts
        trend={trend}
        trendError={trendError}
        refetchTrend={() => refetchTrend()}
        statusDist={statusDist}
        statusDistError={statusDistError}
        refetchStatusDist={() => refetchStatusDist()}
      />

      {/* Top Overdue + Collection Pipeline + Branch Comparison */}
      <DashboardTables
        userRole={user?.role}
        topOverdue={topOverdue}
        topOverdueError={topOverdueError}
        refetchTopOverdue={() => refetchTopOverdue()}
        collectionPipeline={collectionPipeline}
        pipelineError={pipelineError}
        refetchPipeline={() => refetchPipeline()}
        branchData={branchData}
        branchError={branchError}
        refetchBranch={() => refetchBranch()}
      />
    </div>
  );
}
