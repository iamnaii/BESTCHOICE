import type { StockInventoryScope } from '@installment/shared';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import api from '@/lib/api';
import type { BranchSummary, StockDashboard, StockProduct } from '../types';

export function useStockOverview(filterBranch: string, inventoryScope: StockInventoryScope = 'devices') {
  const { user } = useAuth();
  const isManager = user?.role === 'OWNER' || user?.role === 'BRANCH_MANAGER';

  const summaryQuery = useQuery<{ products: StockProduct[]; summary: BranchSummary[] }>({
    queryKey: ['stock', filterBranch, inventoryScope],
    queryFn: async () => {
      const params: Record<string, string> = { inventoryScope };
      if (filterBranch) params.branchId = filterBranch;
      const { data } = await api.get('/products/stock', { params });
      return data;
    },
  });

  const dashboardQuery = useQuery<StockDashboard>({
    queryKey: ['stock-dashboard', filterBranch, inventoryScope],
    queryFn: async () => {
      const params: Record<string, string> = { inventoryScope };
      if (filterBranch) params.branchId = filterBranch;
      const { data } = await api.get('/products/stock/dashboard', { params });
      return data;
    },
  });

  const warrantyQuery = useQuery<
    { id: string; name: string; brand: string; model: string; warrantyExpireDate: string }[]
  >({
    queryKey: ['warranty-expiring', filterBranch, inventoryScope],
    queryFn: async () => {
      const { data } = await api.get('/products/warranty/expiring', { params: { inventoryScope, ...(filterBranch ? { branchId: filterBranch } : {}) } });
      return data;
    },
  });

  const summary = summaryQuery.data?.summary ?? [];
  const totalInStock = summary.reduce((sum, s) => sum + s.inStock, 0);
  // SALES ไม่ได้รับ totalValue (server redact) → คืน null ทั้งก้อนแทนที่จะรวมเป็น 0
  const totalValue = summary.some((s) => s.totalValue == null)
    ? null
    : summary.reduce((sum, s) => sum + (s.totalValue ?? 0), 0);

  return {
    summaryQuery, dashboardQuery, warrantyQuery,
    isManager,
    summary,
    totalInStock,
    totalValue,
    dashboard: dashboardQuery.data,
    warrantyExpiring: warrantyQuery.data ?? [],
    isLoading: summaryQuery.isLoading || dashboardQuery.isLoading || warrantyQuery.isLoading,
    isError: summaryQuery.isError || dashboardQuery.isError || warrantyQuery.isError,
    retry: () => Promise.all([summaryQuery.refetch(), dashboardQuery.refetch(), warrantyQuery.refetch()]),
  };
}
