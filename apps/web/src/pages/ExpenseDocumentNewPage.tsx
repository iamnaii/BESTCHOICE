import { useNavigate, Navigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import { ExpenseFormV4 } from '@/components/expense-form-v4/ExpenseFormV4';
import { useAuth } from '@/contexts/AuthContext';

export default function ExpenseDocumentNewPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { data: branches } = useQuery<{ id: string; name: string }[]>({
    queryKey: ['branches'],
    queryFn: async () => (await api.get('/branches')).data,
  });
  const branchId = user?.branchId || branches?.[0]?.id;
  if (!branchId) return <Navigate to="/expenses" replace />;

  return (
    <ExpenseFormV4
      branchId={branchId}
      onClose={() => navigate('/expenses')}
      onSaved={() => navigate('/expenses')}
    />
  );
}
