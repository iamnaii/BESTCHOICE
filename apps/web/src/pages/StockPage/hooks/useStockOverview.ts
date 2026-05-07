import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import api from '@/lib/api';
import type { BranchSummary, StockDashboard, StockProduct } from '../types';

export function useStockOverview(filterBranch: string) {
  const { user } = useAuth();
  const isManager = user?.role === 'OWNER' || user?.role === 'BRANCH_MANAGER';

  const summaryQuery = useQuery<{ products: StockProduct[]; summary: BranchSummary[] }>({
    queryKey: ['stock', filterBranch],
    queryFn: async () => {
      const params: Record<string, string> = {};
      if (filterBranch) params.branchId = filterBranch;
      const { data } = await api.get('/products/stock', { params });
      return data;
    },
  });

  const dashboardQuery = useQuery<StockDashboard>({
    queryKey: ['stock-dashboard', filterBranch],
    queryFn: async () => {
      const params: Record<string, string> = {};
      if (filterBranch) params.branchId = filterBranch;
      const { data } = await api.get('/products/stock/dashboard', { params });
      return data;
    },
  });

  const warrantyQuery = useQuery<
    { id: string; name: string; brand: string; model: string; warrantyExpireDate: string }[]
  >({
    queryKey: ['warranty-expiring'],
    queryFn: async () => {
      const { data } = await api.get('/products/warranty/expiring');
      return data;
    },
  });

  const summary = summaryQuery.data?.summary ?? [];
  const totalInStock = summary.reduce((sum, s) => sum + s.inStock, 0);
  const totalValue = summary.reduce((sum, s) => sum + s.totalValue, 0);

  return {
    isManager,
    summary,
    totalInStock,
    totalValue,
    dashboard: dashboardQuery.data,
    warrantyExpiring: warrantyQuery.data ?? [],
    isLoading: summaryQuery.isLoading || dashboardQuery.isLoading,
  };
}
