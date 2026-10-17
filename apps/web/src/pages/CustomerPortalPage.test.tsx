import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, expect, it, vi } from 'vitest';
import CustomerPortalPage from './CustomerPortalPage';

const { get } = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@/lib/api', () => ({ default: { get } }));
beforeEach(() => vi.clearAllMocks());
function open() {
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter initialEntries={['/customer-access/test-token']}><Routes>
      <Route path="/customer-access/:token" element={<CustomerPortalPage />} />
    </Routes></MemoryRouter>
  </QueryClientProvider>);
}

it('renders the flat public API response without requiring private contract fields', async () => {
  get.mockResolvedValue({ data: {
    contractNumber: 'TEST-001', customerName: 'ลูกค้าทดสอบ', productName: 'Apple iPhone',
    branchName: 'สาขาทดสอบ', status: 'ACTIVE', totalMonths: 2, monthlyPayment: '1000.00',
    payments: [{ installmentNo: 1, amountDue: '1000', amountPaid: '1000', dueDate: '2026-10-01', status: 'PAID' }],
    documents: [], receipts: [],
  } });
  open();
  expect(await screen.findByText('TEST-001')).toBeInTheDocument();
  expect(screen.getByText('ลูกค้าทดสอบ')).toBeInTheDocument();
  expect(screen.getByText('Apple iPhone')).toBeInTheDocument();
  expect(screen.getByText('1/2 งวด')).toBeInTheDocument();
  expect(screen.queryByText(/NaN|Invalid Date|undefined/)).not.toBeInTheDocument();
  expect(get).toHaveBeenCalledWith('/customer-access/test-token');
});

it('shows an expired-token recovery message', async () => {
  get.mockRejectedValue({ response: { data: { message: 'ลิงก์หมดอายุ' } } });
  open();
  expect(await screen.findByText('ลิงก์หมดอายุ')).toBeInTheDocument();
  expect(screen.getByText('กรุณาติดต่อร้านเพื่อขอลิงก์ใหม่')).toBeInTheDocument();
});

it('does not infer a remaining installment balance from payments that include late fees', async () => {
  get.mockResolvedValue({ data: {
    contractNumber: 'WITH-FEE', customerName: 'ลูกค้าทดสอบ', productName: 'Apple iPhone',
    branchName: 'สาขาทดสอบ', status: 'ACTIVE', totalMonths: 2, monthlyPayment: '1000.00',
    payments: [
      { installmentNo: 1, amountDue: '1000', amountPaid: '1050', dueDate: '2026-10-01', status: 'PAID' },
      { installmentNo: 2, amountDue: '1000', amountPaid: '0', dueDate: '2026-11-01', status: 'PENDING' },
    ], documents: [], receipts: [],
  } });
  open();
  expect(await screen.findByText('WITH-FEE')).toBeInTheDocument();
  expect(screen.getByText('ชำระแล้ว: 1,050 ฿')).toBeInTheDocument();
  expect(screen.getByText('1/2 งวด')).toBeInTheDocument();
  expect(screen.queryByText(/คงเหลือ|950 ฿/)).not.toBeInTheDocument();
});
