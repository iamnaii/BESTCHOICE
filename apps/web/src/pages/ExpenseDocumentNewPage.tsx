import { useNavigate, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import { ExpenseFormV4 } from '@/components/expense-form-v4/ExpenseFormV4';
import type { DocType } from '@/components/expense-form-v4/types';
import { useAuth } from '@/contexts/AuthContext';
import QueryBoundary from '@/components/QueryBoundary';
import PageHeader from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/button';

// ?type= from the "สร้างเอกสารใหม่" dropdown on ExpensesPage. Previously the
// param was silently dropped and the form always opened on EXPENSE_SAMEDAY —
// the user had to click the doc-type chip a second time.
const TYPE_PARAM_MAP: Record<string, DocType> = {
  PR: 'PAYROLL',
  CN: 'CREDIT_NOTE',
  SE: 'VENDOR_SETTLEMENT',
};

export default function ExpenseDocumentNewPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [searchParams] = useSearchParams();
  const initialDocType = TYPE_PARAM_MAP[searchParams.get('type') ?? ''];
  // R3-2 — ?edit=<docId> เปิดโหมดแก้ไขร่างใบเงินเดือน (PATCH แทน POST)
  const editDocId = searchParams.get('edit') ?? undefined;
  const branches = useQuery<{ id: string; name: string }[]>({
    queryKey: ['branches'],
    queryFn: async () => (await api.get('/branches')).data,
  });
  const branchId = user?.branchId || branches.data?.[0]?.id;

  if (!branchId) {
    return (
      <div className="space-y-6">
        <PageHeader title="สร้างค่าใช้จ่าย" onBack={() => navigate('/expenses')} />
        <QueryBoundary
          isLoading={branches.isPending}
          isError={branches.isError}
          error={branches.error}
          errorTitle="โหลดสาขาไม่สำเร็จ"
          onRetry={() => void branches.refetch()}
        >
          <div className="rounded-xl border border-border bg-card p-6 text-center" role="status">
            <p className="font-medium">ยังไม่มีสาขาที่ใช้สร้างค่าใช้จ่ายได้</p>
            <p className="mt-2 text-sm text-muted-foreground">ให้ผู้ดูแลตรวจสอบสาขาและสิทธิ์ของบัญชี แล้วลองโหลดใหม่</p>
            <Button className="mt-4 min-h-11" variant="outline" onClick={() => void branches.refetch()}>โหลดใหม่</Button>
          </div>
        </QueryBoundary>
      </div>
    );
  }

  return (
    <ExpenseFormV4
      branchId={branchId}
      initialDocType={editDocId ? 'PAYROLL' : initialDocType}
      editDocId={editDocId}
      onClose={() => navigate('/expenses')}
      onSaved={() => navigate('/expenses')}
    />
  );
}
