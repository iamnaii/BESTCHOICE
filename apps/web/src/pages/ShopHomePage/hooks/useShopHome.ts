import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import { useUiFlags } from '@/hooks/useUiFlags';
import type { ShopHomeResponse } from '../types';

/** ข้อมูลหน้าหลักหน้าร้านทั้งหน้าจาก endpoint เดียว — staleTime ตั้งโดย OWNER เหมือน ManagementDashboard */
export function useShopHome() {
  const { cacheTtlDashboard } = useUiFlags();
  return useQuery<ShopHomeResponse>({
    queryKey: ['shop-home'],
    queryFn: async () => (await api.get('/shop-home')).data,
    staleTime: cacheTtlDashboard * 1000,
  });
}
