import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Navigate, useParams } from 'react-router';
import api from '@/lib/api';
import QueryBoundary from '@/components/QueryBoundary';
import { afterSalesKeys } from './after-sales';

/** ตรวจ 404 จาก axios error shape โดยไม่ผูกกับ error class ใดๆ (`api` คืน raw axios error) */
function is404(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const status = (error as { response?: { status?: number } }).response?.status;
  return status === 404;
}

// เส้นทางเก่า /insurance/:id (ใบซ่อม) → หาเคสหลังการขายที่ผูกใบซ่อมนี้แล้วเด้งไปหน้าใหม่
// /after-sales/:id — ถ้าไม่พบ (404, ใบซ่อมเก่าที่ยังไม่มีเคสหลังการขาย) แสดงหน้าใบซ่อมเดิม
// ต่อไปตามปกติ ให้ปุ่มภายในที่ยังไม่ย้าย (PR 2) ยังใช้งานได้.
//
// A3 (final-fix brief, 2026-09-24) — fallback ไปหน้าเดิมเฉพาะตอน 404 เท่านั้น (ใบซ่อมเก่าที่ยัง
// ไม่มีเคสหลังการขายจริง ๆ) — error อื่น (5xx/timeout/เครือข่ายล่ม) ต้อง **ไม่** ปล่อยผู้ใช้ไปเจอ
// หน้าใบซ่อมเดิม เพราะปุ่ม bypass ของมันถูกถอดออกจากเส้นทางใหม่แล้ว (R21) — ถ้าเด้งไปหน้าเดิมทุก
// error ผู้ใช้จะเจอหน้าที่ดูใช้งานได้ปกติแต่ที่จริงระบบกำลังพัง ให้แสดง error UI + ปุ่มลองใหม่แทน
export default function TicketRedirect({ fallback }: { fallback: ReactNode }) {
  const { id } = useParams<{ id: string }>();

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: afterSalesKeys.lookup(id ?? ''),
    queryFn: async () => {
      const res = await api.get<{ id: string }>(`/after-sales/by-ticket/${id}`);
      return res.data;
    },
    enabled: !!id,
    retry: false,
  });

  if (!id) return <>{fallback}</>;
  if (isLoading) return null;
  if (isError) {
    if (is404(error)) return <>{fallback}</>;
    return (
      <QueryBoundary isLoading={false} isError error={error} onRetry={refetch}>
        <></>
      </QueryBoundary>
    );
  }
  if (data?.id) return <Navigate to={`/after-sales/${data.id}`} replace />;
  return <>{fallback}</>;
}
