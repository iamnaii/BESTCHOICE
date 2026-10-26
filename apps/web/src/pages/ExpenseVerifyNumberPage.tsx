import { Link, Navigate, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import PageHeader from '@/components/ui/PageHeader';
import QueryBoundary from '@/components/QueryBoundary';

/** Authenticated compatibility for QR codes printed before ID-based voucher links. */
export default function ExpenseVerifyNumberPage() {
  const { number = '' } = useParams();
  const query = useQuery({
    queryKey: ['expense-verification-number', number],
    queryFn: async () =>
      (await api.get<{ id: string; number: string }>(
        `/expense-documents/verify-number/${encodeURIComponent(number)}`,
      )).data,
    retry: false,
  });
  if (query.data) return <Navigate to={`/expenses/verify/${encodeURIComponent(query.data.id)}`} replace />;
  return (
    <div className="space-y-4">
      <PageHeader title="ตรวจสอบใบสำคัญจ่าย" subtitle={number} />
      <QueryBoundary
        isLoading={query.isLoading}
        isError={query.isError}
        error={query.error}
        errorMessage={(query.error as { response?: { status?: number } } | null)?.response?.status === 404
          ? 'ไม่พบเอกสารในบริษัทและสาขาที่คุณมีสิทธิ์เข้าถึง' : undefined}
        onRetry={() => void query.refetch()}
      >{null}</QueryBoundary>
      {query.isError && (
        <p className="text-sm text-muted-foreground">
          ตรวจสอบว่างานหน้าร้านหรืองานการเงินที่เลือกในเมนูตรงกับเอกสาร
          หรือ <Link to="/expenses" className="inline-flex min-h-11 items-center text-primary underline">เปิดรายการรายจ่าย</Link>
        </p>
      )}
    </div>
  );
}
