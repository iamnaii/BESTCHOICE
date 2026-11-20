import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import type { BcConfigJson } from '@installment/shared';

export const BC_CONFIG_QUERY_KEY = (category: string | undefined) =>
  ['interest-config', category, 'bc'] as const;

/**
 * ตารางดอกเบี้ย BESTCHOICE ของหมวดสินค้า (GET /interest-configs/resolved) — key เดิมของ
 * InstallmentCalculatorCard/useCustomerSummary/สติกเกอร์ จึง dedupe กันเอง · ยิงเฉพาะมือถือและแท็บเล็ต
 * (ชุดเดียวกับสติกเกอร์ · endpoint คืนตั้งค่าของหมวดหรือค่าตั้งต้นของระบบ) · อุปกรณ์เสริมไม่มีผ่อน
 */
export function useBcConfig(category: string | undefined, enabled = true) {
  return useQuery<BcConfigJson>({
    queryKey: BC_CONFIG_QUERY_KEY(category),
    queryFn: async () => {
      const { data } = await api.get<BcConfigJson>(
        `/interest-configs/resolved?category=${category}`,
      );
      return data;
    },
    enabled: enabled && (category === 'PHONE_NEW' || category === 'PHONE_USED' || category === 'TABLET'),
    retry: false,
  });
}
