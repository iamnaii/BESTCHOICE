import { useSearchParams, useNavigate } from 'react-router';
import { CreditNoteForm } from '@/components/expense-documents/CreditNoteForm';

export default function ExpenseDocumentNewPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const type = params.get('type') ?? 'EX';

  // PR-1 already handles EX via the modal in ExpensesPage; PR-2 adds CN.
  // PR-3 (PR), PR-4 (SE) will extend this switch.
  switch (type) {
    case 'CN':
      return <CreditNoteForm onClose={() => navigate('/expenses')} onSaved={() => navigate('/expenses')} />;
    default:
      // EX still uses the existing modal — redirect home
      navigate('/expenses?openNew=1');
      return null;
  }
}
