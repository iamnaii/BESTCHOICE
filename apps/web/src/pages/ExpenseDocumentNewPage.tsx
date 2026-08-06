import { useNavigate, Navigate, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import { ExpenseFormV4 } from '@/components/expense-form-v4/ExpenseFormV4';
import type { DocType } from '@/components/expense-form-v4/types';
import { useAuth } from '@/contexts/AuthContext';

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
  const { data: branches } = useQuery<{ id: string; name: string }[]>({
    queryKey: ['branches'],
    queryFn: async () => (await api.get('/branches')).data,
  });
  const branchId = user?.branchId || branches?.[0]?.id;
  if (!branchId) return <Navigate to="/expenses" replace />;

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
