import { useQuery } from '@tanstack/react-query';
import { Link, Navigate, useParams } from 'react-router';
import api from '@/lib/api';
import QueryBoundary from '@/components/QueryBoundary';
import { afterSalesKeys } from './after-sales';

/** ตรวจ 404 จาก axios error shape โดยไม่ผูกกับ error class ใดๆ (`api` คืน raw axios error) */
function is404(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const status = (error as { response?: { status?: number } }).response?.status;
  return status === 404;
}

// เส้นทางเก่า /insurance/:id (ใบซ่อม) → หาเคสหลังการขายที่ผูกใบซ่อมนี้แล้วเด้งไป /after-sales/:id
// PR 4 (2026-09-26) — หน้าใบซ่อมเดิม (fallback) ถูกถอดแล้ว: ใบซ่อมทุกใบบน prod มีเคสผูกครบ และพ้น
// กำหนด "≥2 รุ่น deploy" ของสเปกข้อ 11 ⇒ 404 แสดงข้อความ + ลิงก์ไปหน้าหลังการขายแทน
// error อื่น (5xx/เครือข่าย) ยังแสดง error UI + ปุ่มลองใหม่ (A3 final-fix เดิม)
export default function TicketRedirect() {
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

  if (isLoading) return null;
  if (isError && !is404(error)) {
    return (
      <QueryBoundary isLoading={false} isError error={error} onRetry={refetch}>
        <></>
      </QueryBoundary>
    );
  }
  if (data?.id) return <Navigate to={`/after-sales/${data.id}`} replace />;
  return (
    <div className="mx-auto mt-10 max-w-md space-y-3 rounded-xl border border-border bg-card p-6 text-center">
      <p className="text-base font-semibold leading-snug text-foreground">
        ไม่พบเคสหลังการขายของใบซ่อมนี้
      </p>
      <p className="text-sm leading-snug text-muted-foreground">
        งานซ่อมทั้งหมดย้ายมาอยู่ที่หน้า "หลังการขาย" แล้ว — ค้นจาก IMEI
        หรือชื่อ/เบอร์ลูกค้าได้ที่นั่น
      </p>
      <Link
        to="/after-sales"
        className="inline-flex h-10 items-center rounded-lg border border-border bg-card px-3.5 text-sm font-semibold leading-snug text-primary hover:underline"
      >
        ไปหน้าหลังการขาย
      </Link>
    </div>
  );
}
