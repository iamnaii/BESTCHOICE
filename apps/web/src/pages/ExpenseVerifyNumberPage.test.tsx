import { beforeEach, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ExpenseVerifyNumberPage from './ExpenseVerifyNumberPage';

const get = vi.fn();
vi.mock('@/lib/api', () => ({ default: { get: (...args: unknown[]) => get(...args) } }));
function mount() {
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter initialEntries={['/expenses/verify-number/PV-202610-00001']}>
      <Routes>
        <Route path="/expenses/verify-number/:number" element={<ExpenseVerifyNumberPage />} />
        <Route path="/expenses/verify/doc-id" element={<h1>เอกสารที่ตรงกับ QR</h1>} />
      </Routes>
    </MemoryRouter>
  </QueryClientProvider>);
}
beforeEach(() => { get.mockReset(); });
it('opens the exact resolved document', async () => {
  get.mockResolvedValue({ data: { id: 'doc-id', number: 'PV-202610-00001' } });
  mount();
  expect(await screen.findByText('เอกสารที่ตรงกับ QR')).toBeInTheDocument();
  expect(get).toHaveBeenCalledWith('/expense-documents/verify-number/PV-202610-00001');
});
it('shows progress while resolving', () => {
  get.mockReturnValue(new Promise(() => {}));
  mount();
  expect(screen.getByRole('status', { name: 'กำลังโหลด' })).toBeInTheDocument();
});
it('keeps a recoverable failure visible then opens the document after retry', async () => {
  get.mockRejectedValueOnce({ response: { status: 500 } }).mockResolvedValueOnce({ data: { id: 'doc-id' } });
  mount();
  expect(await screen.findByRole('alert')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'ลองใหม่' }));
  expect(await screen.findByText('เอกสารที่ตรงกับ QR')).toBeInTheDocument();
});
it('explains scope and preserves the expense-list escape for a missing document', async () => {
  get.mockRejectedValue({ response: { status: 404, data: { message: 'ไม่พบเอกสารในบริษัทและสาขาที่คุณมีสิทธิ์เข้าถึง' } } });
  mount();
  expect(await screen.findByText('ไม่พบเอกสารในบริษัทและสาขาที่คุณมีสิทธิ์เข้าถึง')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'เปิดรายการรายจ่าย' })).toHaveAttribute('href', '/expenses');
});
