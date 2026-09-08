import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { expect, it, vi } from 'vitest';
import CreditCheckPanel from './CreditCheckPanel';
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { role: 'FINANCE_MANAGER' } }) }));
vi.mock('@/lib/api', () => ({ default: { get: vi.fn(async () => ({ data: {
  id: 'check', customer: { id: 'customer', name: 'ลูกค้า' }, status: 'MANUAL_REVIEW', checkType: 'FULL',
  aiScore: null, statementFiles: [], aiAnalysis: null, statementMonths: 3,
} })) }, getErrorMessage: () => 'error' }));
it('allows reviewing a scoreless contract check with the verified amount form', async () => {
  render(<QueryClientProvider client={new QueryClient()}><CreditCheckPanel contractId="contract" /></QueryClientProvider>);
  const decision = await screen.findByRole('combobox', { name: 'ผลพิจารณาเครดิต' });
  fireEvent.change(decision, { target: { value: 'APPROVED' } });
  expect(screen.getByLabelText(/รายได้ประจำที่ยืนยัน/)).toBeInTheDocument();
});
