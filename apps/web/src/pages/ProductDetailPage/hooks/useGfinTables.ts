import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import type {
  GfinSettingsApi,
  GfinTables,
  MaxPriceApi,
  OverpriceApi,
  RateFactorApi,
} from '../utils/gfinQuote';

/**
 * ตาราง GFIN ทั้ง 4 ชุดสำหรับเครื่องคำนวณ — query key เดิมของ GfinCalculatorCard (ร่วม cache กับหน้าตั้งค่า)
 * คืน `tables` เมื่อครบทุกชุด; ระหว่างโหลดหรือพัง = undefined (การ์ดโชว์สถานะรอ/ไม่มีข้อมูล)
 */
export function useGfinTables(enabled = true) {
  const mappings = useQuery({
    queryKey: ['gfin-max-prices'],
    queryFn: () => api.get<MaxPriceApi[]>('/gfin-config/max-prices').then((r) => r.data),
    enabled,
  });
  const rules = useQuery({
    queryKey: ['gfin-overprice-rules'],
    queryFn: () => api.get<OverpriceApi[]>('/gfin-config/overprice-rules').then((r) => r.data),
    enabled,
  });
  const factors = useQuery({
    queryKey: ['gfin-rate-factors'],
    queryFn: () => api.get<RateFactorApi[]>('/gfin-config/rate-factors').then((r) => r.data),
    enabled,
  });
  const settings = useQuery({
    queryKey: ['gfin-settings'],
    queryFn: () => api.get<GfinSettingsApi>('/gfin-config/settings').then((r) => r.data),
    enabled,
  });

  // อ้างอิงเดิมตราบที่ข้อมูลทั้ง 4 ชุดไม่เปลี่ยน — useMemo ของผู้ใช้ (การ์ดราคาหน้าเพิ่มสินค้า ฯลฯ) จึงไม่คิดใหม่ทุก render
  const tables = useMemo<GfinTables | undefined>(
    () =>
      mappings.data && rules.data && factors.data && settings.data
        ? { mappings: mappings.data, rules: rules.data, factors: factors.data, settings: settings.data }
        : undefined,
    [mappings.data, rules.data, factors.data, settings.data],
  );

  return {
    tables,
    isLoading: mappings.isLoading || rules.isLoading || factors.isLoading || settings.isLoading,
    isError: mappings.isError || rules.isError || factors.isError || settings.isError,
    /** โหลดเฉพาะชุดที่ล้มใหม่ (ปุ่ม "ลองใหม่") */
    retry: () => {
      for (const q of [mappings, rules, factors, settings]) if (q.isError) void q.refetch();
    },
  };
}
