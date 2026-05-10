import { useSearchParams, useNavigate, Navigate } from 'react-router';
import { CreditNoteForm } from '@/components/expense-documents/CreditNoteForm';
import { PayrollForm } from '@/components/expense-documents/PayrollForm';
import { SettlementForm } from '@/components/expense-documents/SettlementForm';

export default function ExpenseDocumentNewPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const type = params.get('type') ?? 'EX';

  switch (type) {
    case 'CN':
      return (
        <CreditNoteForm
          onClose={() => navigate('/expenses')}
          onSaved={() => navigate('/expenses')}
        />
      );
    case 'PR':
      return (
        <PayrollForm
          onClose={() => navigate('/expenses')}
          onSaved={() => navigate('/expenses')}
        />
      );
    case 'SE':
      return (
        <SettlementForm
          onClose={() => navigate('/expenses')}
          onSaved={() => navigate('/expenses')}
        />
      );
    default:
      // EX uses the existing modal — declarative redirect (no side effect in render)
      return <Navigate to="/expenses?openNew=1" replace />;
  }
}
