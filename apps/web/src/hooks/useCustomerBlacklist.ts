import { useQuery } from '@tanstack/react-query';
import type { CustomerBlacklistResult } from '@installment/shared';
import api from '@/lib/api';

/**
 * ก้อน 5 C3 — ผลตรวจ blacklist ของลูกค้า (API เป็นผู้ประเมิน; หน้าเว็บแค่แสดง/ตัดสินปุ่ม)
 * staleTime 0: สถานะเปลี่ยนได้ทุกนาที (tag/ยึด/บอกเลิก) — เลือกลูกค้าใหม่ = ถามใหม่เสมอ
 */
export function useCustomerBlacklist(customerId: string | null | undefined) {
  return useQuery<CustomerBlacklistResult>({
    queryKey: ['customer-blacklist', customerId ?? ''],
    queryFn: async () => {
      const { data } = await api.get(`/customers/${customerId}/blacklist`);
      return data;
    },
    enabled: !!customerId,
    staleTime: 0,
  });
}

/** แบบ batch สำหรับตาราง (≤100 id ต่อคำขอ — ฝั่ง API บังคับ) */
export function useCustomerBlacklistBatch(ids: readonly (string | null | undefined)[]) {
  const unique = [...new Set(ids.filter((x): x is string => !!x))].sort();
  const joined = unique.join(',');
  return useQuery<Record<string, CustomerBlacklistResult>>({
    queryKey: ['customer-blacklist-batch', joined],
    queryFn: async () => {
      const { data } = await api.get('/customers/blacklist', { params: { ids: joined } });
      return data;
    },
    enabled: unique.length > 0,
    staleTime: 0,
  });
}
