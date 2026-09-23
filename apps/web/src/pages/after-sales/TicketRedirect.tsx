import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Navigate, useParams } from 'react-router';
import api from '@/lib/api';
import { afterSalesKeys } from './after-sales';

// เส้นทางเก่า /insurance/:id (ใบซ่อม) → หาเคสหลังการขายที่ผูกใบซ่อมนี้แล้วเด้งไปหน้าใหม่
// /after-sales/:id — ถ้าไม่พบ (404, ใบซ่อมเก่าที่ยังไม่มีเคสหลังการขาย) แสดงหน้าใบซ่อมเดิม
// ต่อไปตามปกติ ให้ปุ่มภายในที่ยังไม่ย้าย (PR 2) ยังใช้งานได้
export default function TicketRedirect({ fallback }: { fallback: ReactNode }) {
  const { id } = useParams<{ id: string }>();

  const { data, isLoading, isError } = useQuery({
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
  if (isError) return <>{fallback}</>;
  if (data?.id) return <Navigate to={`/after-sales/${data.id}`} replace />;
  return <>{fallback}</>;
}
