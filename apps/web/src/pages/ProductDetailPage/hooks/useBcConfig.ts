import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import type { BcConfigJson } from '@installment/shared';

export const BC_CONFIG_QUERY_KEY = (category: string | undefined) =>
  ['interest-config', category, 'bc'] as const;

/**
 * ตารางดอกเบี้ย BESTCHOICE ของหมวดสินค้า (GET /interest-configs/resolved) — key เดิมของ
 * InstallmentCalculatorCard/useCustomerSummary จึง dedupe กันเอง · ยิงเฉพาะมือถือ (หมวดอื่นไม่มีตาราง
 * และ endpoint ตอบ error ซึ่งไม่ควร retry)
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
    enabled: enabled && (category === 'PHONE_NEW' || category === 'PHONE_USED'),
    retry: false,
  });
}
