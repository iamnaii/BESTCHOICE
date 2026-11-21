import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import ImportedSalesPage from './ImportedSalesPage';

const get = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', () => ({ default: { get } }));
const summary = {
  totals: { billCount: 2, lineCount: 3, sales: '1234.56', cost: null, profit: null },
  coverage: {
    firstSoldAt: '2026-11-01T00:00:00Z',
    lastSoldAt: '2026-11-08T20:00:00Z',
    verifiedThrough: null,
  },
};
const empty = { data: [], total: 0, page: 1, limit: 50 };
function show() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ImportedSalesPage />
    </QueryClientProvider>,
  );
}
beforeEach(() => {
  get.mockReset().mockImplementation(async (path: string) => ({
    data: path.includes('summary') ? summary : empty,
  }));
});

it('renders_masked_money_without_zero', async () => {
  show();
  expect(await screen.findAllByText('ไม่มีสิทธิ์ดู')).toHaveLength(2);
  expect(screen.getByText('จำนวนบิล')).toBeInTheDocument();
  expect(screen.getByText('จำนวนรายการ')).toBeInTheDocument();
  expect(screen.getByText('฿1,234.56')).toBeInTheDocument();
  expect(screen.getByText('ไม่พบรายการ')).toBeInTheDocument();
  expect(screen.getByText('ยังไม่มีการรับรองช่วงที่ค้น')).toBeInTheDocument();
  expect(screen.getAllByRole('time').map((t) => t.getAttribute('datetime'))).toEqual([
    summary.coverage.firstSoldAt,
    summary.coverage.lastSoldAt,
  ]);
});

it('displays a distinct certified cutoff when supplied', async () => {
  const cutoff = '2026-11-15T08:00:00Z';
  get.mockImplementation(async (path: string) => ({
    data: path.includes('summary')
      ? { ...summary, coverage: { ...summary.coverage, verifiedThrough: cutoff } }
      : empty,
  }));
  show();
  expect((await screen.findAllByRole('time')).map((t) => t.getAttribute('datetime'))).toContain(
    cutoff,
  );
});

it('sends all applied search terms to both endpoints and resets pagination', async () => {
  get.mockImplementation(async (path, { params }) => ({
    data: path.includes('summary') ? summary : { ...empty, total: 51, page: params.page },
  }));
  show();
  fireEvent.click(await screen.findByRole('button', { name: 'ถัดไป' }));
  await waitFor(() =>
    expect(get).toHaveBeenCalledWith('/imported-sales', { params: { limit: 50, page: 2 } }),
  );
  fireEvent.change(screen.getByLabelText('บาร์โค้ด/IMEI'), { target: { value: ' 00101 ' } });
  fireEvent.change(screen.getByLabelText('เลขบิล'), { target: { value: ' B-19 ' } });
  fireEvent.change(screen.getByLabelText('ช่องทางขาย'), { target: { value: 'CASH' } });
  for (const label of ['จากวันที่', 'ถึงวันที่']) {
    fireEvent.click(screen.getByLabelText(label));
    fireEvent.click(await screen.findByRole('button', { name: 'วันนี้' }));
  }
  fireEvent.click(screen.getByRole('button', { name: 'ค้นหา' }));
  const today = new Date();
  const day = [
    today.getFullYear(),
    String(today.getMonth() + 1).padStart(2, '0'),
    String(today.getDate()).padStart(2, '0'),
  ].join('-');
  const filters = {
    barcode: '00101',
    orderNumber: 'B-19',
    saleChannel: 'CASH',
    startDate: day,
    endDate: day,
  };
  await waitFor(() =>
    expect(get).toHaveBeenCalledWith('/imported-sales', {
      params: { ...filters, limit: 50, page: 1 },
    }),
  );
  expect(get).toHaveBeenCalledWith('/imported-sales/summary', { params: filters });
});

it('shows a pending read, then retries a failed request', async () => {
  let fail!: (error: Error) => void;
  get.mockImplementationOnce(
    () =>
      new Promise((_, reject) => {
        fail = reject;
      }),
  );
  show();
  expect(screen.getByRole('status')).toHaveTextContent('กำลังโหลด');
  fail(new Error('offline'));
  expect(await screen.findByRole('alert')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'ลองอีกครั้ง' }));
  expect(await screen.findByText('ไม่พบรายการ')).toBeInTheDocument();
  expect(screen.queryByRole('alert')).toBeNull();
});
