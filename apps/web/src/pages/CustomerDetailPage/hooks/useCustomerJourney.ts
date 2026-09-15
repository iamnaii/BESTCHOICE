import { useEffect } from 'react';
import { useInfiniteQuery, useQuery, type InfiniteData, type QueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import type { JourneyEventGroup, JourneyListResponse, JourneyRedirect, JourneySummary } from '@installment/shared';
import api from '@/lib/api';

/** GET /customers/:id/journey — ชนิดจาก shared (Task 1) ห้ามประกาศซ้ำ */
export type CustomerJourneyResult = JourneyListResponse | JourneyRedirect;
/** GET /customers/:id/journey/summary */
export type JourneySummaryResult = JourneySummary | JourneyRedirect;

export const JOURNEY_PAGE_SIZE = 30;

/**
 * หลังคำสั่งบนหน้าลูกค้าที่เขียนประวัติการเดินทาง (ตรวจเครดิต · วิเคราะห์/ตีตกเครดิต · แก้ข้อมูล · เติมเบอร์)
 * prefix ครอบทุกชุดกลุ่มของแท็บและการ์ดกิจกรรมล่าสุด + แถบขั้น — main.tsx ปิด refetchOnWindowFocus จึงไม่รีเฟรชเอง
 */
export function invalidateCustomerJourney(queryClient: QueryClient, customerId: string) {
  queryClient.invalidateQueries({ queryKey: ['customer-journey', customerId] });
  queryClient.invalidateQueries({ queryKey: ['customer-journey-summary', customerId] });
}

export function isJourneyRedirect(
  value: CustomerJourneyResult | JourneySummaryResult | null | undefined,
): value is JourneyRedirect {
  return !!value && 'redirectToCustomerId' in value;
}

export function useCustomerJourney(
  customerId: string,
  groups: readonly JourneyEventGroup[] | null,
  options: { limit?: number; enabled?: boolean; include?: string } = {},
) {
  const limit = options.limit ?? JOURNEY_PAGE_SIZE;
  return useInfiniteQuery<
    CustomerJourneyResult,
    Error,
    InfiniteData<CustomerJourneyResult>,
    readonly unknown[],
    string | undefined
  >({
    // key ตามสัญญากลาง — limit / include ไม่อยู่ใน key ได้เพราะแท็บส่ง groups = null หรือกลุ่มเดียว (+ include=counts)
    // ส่วนการ์ดภาพรวมส่ง 3 กลุ่ม (OVERVIEW_GROUPS) และไม่ส่ง include จึงไม่มีทางชนกัน
    queryKey: ['customer-journey', customerId, groups],
    initialPageParam: undefined,
    queryFn: async ({ pageParam }) => {
      const params: Record<string, string | number> = { limit };
      if (groups && groups.length > 0) params.groups = groups.join(',');
      if (pageParam) params.cursor = pageParam;
      // include มีผลเฉพาะหน้าแรกฝั่ง API — หน้าที่มี cursor ไม่ส่ง
      else if (options.include) params.include = options.include;
      const { data } = await api.get<CustomerJourneyResult>(`/customers/${customerId}/journey`, { params });
      return data;
    },
    getNextPageParam: (last) => (isJourneyRedirect(last) ? undefined : last.nextCursor ?? undefined),
    enabled: (options.enabled ?? true) && !!customerId,
    staleTime: 30_000,
  });
}

export function useJourneySummary(customerId: string, enabled = true) {
  return useQuery<JourneySummaryResult>({
    queryKey: ['customer-journey-summary', customerId],
    queryFn: async () => {
      const { data } = await api.get<JourneySummaryResult>(`/customers/${customerId}/journey/summary`);
      return data;
    },
    enabled: enabled && !!customerId,
    staleTime: 60_000,
  });
}

/**
 * ลิงก์เก่าที่ชี้ id ของผู้สนใจที่ถูกรวมแล้ว → summary ตอบ { redirectToCustomerId } → ไปหน้าลูกค้าจริงแบบ replace
 * ต้องเรียกก่อน early return ของหน้า: GET /customers/:id/detail ของ id ที่ถูกลบตอบ 404 (findDetail → findOne เช็ค deletedAt)
 * คืน JourneySummary เมื่อพร้อมใช้ ไม่งั้น null (กำลังโหลด / redirect / error / 404 / บทบาทไม่มีสิทธิ์)
 */
export function useJourneySummaryRedirect(customerId: string, enabled: boolean): JourneySummary | null {
  const navigate = useNavigate();
  const { data } = useJourneySummary(customerId, enabled);
  const redirectTo = isJourneyRedirect(data) ? data.redirectToCustomerId : null;

  useEffect(() => {
    if (redirectTo) navigate(`/customers/${redirectTo}`, { replace: true });
  }, [redirectTo, navigate]);

  if (!data || isJourneyRedirect(data)) return null;
  return data;
}
