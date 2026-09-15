import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import api from '@/lib/api';
import type { CustomerTierResponse } from '@/types/customer-tier';
import type { CreditCheckItem, CustomerDetail } from '../types';

export interface LoyaltyPoints {
  customerId: string;
  customerName: string;
  balance: number;
  lifetimeEarned: number;
  lifetimeRedeemed: number;
  referralCount: number;
}

export interface LoyaltyHistory {
  data: Array<{
    id: string;
    type: 'EARN' | 'REDEEM';
    points: number;
    reason: string;
    contractId: string | null;
    createdAt: string;
  }>;
  total: number;
  page: number;
  limit: number;
}

export interface ReferralStats {
  customerId: string;
  totalReferrals: number;
  referralsWithContract: number;
  totalPointsFromReferrals: number;
  referrals: Array<{ id: string; name: string; createdAt: string; hasContract: boolean }>;
}

export function useCustomerDetailData(id: string | undefined) {
  const { user } = useAuth();

  const {
    data: customer,
    isLoading,
    isError: customerError,
    error: customerErrorDetail,
    refetch: refetchCustomer,
  } = useQuery<CustomerDetail>({
    // GET /customers/:id/detail = findOne + สรุปของหน้านี้ (GET :id เบาไว้ให้อินบ็อกซ์/สร้างสัญญา/OCR)
    // invalidateQueries({ queryKey: ['customer', id] }) ของหน้านี้ยังโดนคีย์นี้ด้วย prefix match
    queryKey: ['customer', id, 'detail'],
    queryFn: async () => { const { data } = await api.get(`/customers/${id}/detail`); return data; },
  });
  useDocumentTitle(customer?.name);

  const { data: creditChecks = [] } = useQuery<CreditCheckItem[]>({
    queryKey: ['customer-credit-checks', id],
    queryFn: async () => { const { data } = await api.get(`/customers/${id}/credit-check`); return data; },
  });

  const { data: tierData } = useQuery<CustomerTierResponse>({
    queryKey: ['customer-tier', id],
    queryFn: async () => {
      const { data } = await api.get(`/customers/${id}/tier`);
      return data;
    },
    enabled: !!id,
    staleTime: 5 * 60 * 1000, // 5 min cache per spec
  });

  // ─── Loyalty queries ───────────────────────────────────────────────────────
  const { data: loyaltyPoints } = useQuery<LoyaltyPoints>({
    queryKey: ['customer-loyalty-points', id],
    queryFn: async () => { const { data } = await api.get(`/loyalty/${id}/points`); return data; },
  });

  const { data: loyaltyHistory } = useQuery<LoyaltyHistory>({
    queryKey: ['customer-loyalty-history', id],
    queryFn: async () => { const { data } = await api.get(`/loyalty/${id}/history?limit=20`); return data; },
  });

  const { data: referralStats } = useQuery<ReferralStats>({
    queryKey: ['customer-referral-stats', id],
    queryFn: async () => { const { data } = await api.get(`/loyalty/referral-stats/${id}`); return data; },
  });

  const { data: activityLogs = { data: [] } } = useQuery({
    queryKey: ['customer-activity', id],
    queryFn: async () => {
      const { data } = await api.get(`/audit/logs?entity=customers&entityId=${id}&limit=20`);
      return data;
    },
    enabled: user?.role === 'OWNER',
  });

  return {
    customer,
    isLoading,
    customerError,
    customerErrorDetail,
    refetchCustomer,
    creditChecks,
    tierData,
    loyaltyPoints,
    loyaltyHistory,
    referralStats,
    activityLogs,
  };
}
