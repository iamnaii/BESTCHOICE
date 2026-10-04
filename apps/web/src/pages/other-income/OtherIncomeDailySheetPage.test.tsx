import { render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { beforeEach, expect, it, vi } from 'vitest';
import { otherIncomeApi } from '@/lib/otherIncome';
import type { DailySheet } from '@/lib/otherIncome.types';
import OtherIncomeDailySheetPage from './OtherIncomeDailySheetPage';

vi.mock('@/lib/otherIncome', () => ({ otherIncomeApi: { dailySheet: vi.fn() } }));
vi.mock('@/hooks/useUiFlags', () => ({ useUiFlags: () => ({ defaultTimeRange: 'this_month' }) }));
const sheet: DailySheet = {
  startDate: '2026-10-01',
  endDate: '2026-10-03',
  docs: [],
  summary: { incomeGross: '1234.56', vat: '0', wht: '0', netReceived: '1234.56', docCount: 2 },
  byAccount: [
    { code: '42-1101', name: 'รายได้ทดสอบ', total: '1234.56', count: 2 },
    { code: '42-1102', name: 'คืนเงิน', total: '-0.01', count: 1 },
  ],
  byPayment: [{ code: '11-1101', name: 'เงินสดทดสอบ', total: '0', count: 0 }],
};
beforeEach(() => {
  vi.resetAllMocks();
});
function show(data: DailySheet) {
  vi.mocked(otherIncomeApi.dailySheet).mockResolvedValue(data);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <OtherIncomeDailySheetPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
it('keeps account and payment rows independent, ordered, and formatted to two decimals', async () => {
  show(sheet);
  const tables = await screen.findAllByRole('table');
  expect(tables).toHaveLength(2);
  const accounts = within(tables[0]).getAllByRole('row');
  expect(accounts[1]).toHaveTextContent('42-1101รายได้ทดสอบ21234.56 ฿');
  expect(accounts[2]).toHaveTextContent('42-1102คืนเงิน1-0.01 ฿');
  expect(tables[1]).toHaveTextContent('11-1101เงินสดทดสอบ00.00 ฿');
  expect(tables[1]).not.toHaveTextContent('42-1101');
  expect(screen.getByRole('heading', { name: 'แยกตามบัญชีรายได้' })).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'แยกตามช่องทางชำระ' })).toBeInTheDocument();
});
it('shows an independent empty state without suppressing the other summary', async () => {
  show({ ...sheet, byAccount: [] });
  await screen.findByText('ไม่มีข้อมูล');
  expect(screen.getAllByRole('table')).toHaveLength(1);
  expect(screen.getByRole('table')).toHaveTextContent('เงินสดทดสอบ');
});
