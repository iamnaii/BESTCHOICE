import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
const apiGet = vi.fn();
vi.mock('@/lib/api', () => ({
  default: { get: (...args: unknown[]) => apiGet(...args) },
  getErrorMessage: () => 'ไม่สามารถโหลดข้อมูลได้',
}));
import FinanceReceivablePage from './FinanceReceivablePage';
const summary = {
  totalPending: 0,
  totalReceived: 0,
  totalOverdue: 0,
  totalDisputed: 0,
  pendingAmount: '0',
  receivedAmount: '0',
  overdueAmount: '0',
  disputedAmount: '0',
};
function mount(path = '/finance-receivable?startDate=2000-01-01&page=3') {
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter initialEntries={[path]}>
        <FinanceReceivablePage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
const latestQuery = () =>
  new URL(
    [...apiGet.mock.calls].reverse().find(([path]) => path.startsWith('/finance-receivable?'))![0],
    'https://example.invalid',
  ).searchParams;
beforeEach(() => {
  apiGet
    .mockReset()
    .mockImplementation((path: string) =>
      Promise.resolve({
        data:
          path.startsWith('/branches') || path.includes('/companies')
            ? []
            : path.includes('/summary')
              ? summary
              : { data: [], total: 0 },
      }),
    );
});
describe('receivable date filters and failed reads', () => {
  it('sets both date boundaries atomically and clears both with All', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-30T17:30:00Z'));
    try {
      mount();
      await userEvent.click(screen.getByRole('button', { name: 'เดือนนี้' }));
      await waitFor(() => expect(latestQuery().get('startDate')).toBe('2026-10-01'));
      expect(latestQuery().get('endDate')).toBe('2026-10-01');
      expect(latestQuery().get('page')).toBe('1');
      await userEvent.click(screen.getByRole('button', { name: 'ทั้งหมด' }));
      await waitFor(() => expect(latestQuery().has('startDate')).toBe(false));
      expect(latestQuery().has('endDate')).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
  it('shows a recoverable error instead of an empty list when the read fails', async () => {
    apiGet.mockImplementation((path: string) =>
      path.startsWith('/finance-receivable?')
        ? Promise.reject({ response: { status: 500 } })
        : Promise.resolve({ data: path.includes('/summary') ? summary : [] }),
    );
    mount();
    expect(
      await screen.findByRole('heading', { name: 'ไม่สามารถโหลดรายการเงินรับได้' }),
    ).toBeInTheDocument();
    expect(screen.queryByText('ไม่พบรายการเงินรับจากไฟแนนซ์')).not.toBeInTheDocument();
    expect(screen.queryByText('ทั้งหมด 0 รายการ')).not.toBeInTheDocument();
  });
});

describe('receivable row actions', () => {
  const receivable = {
    id: 'receivable-1', financeCompany: 'ไฟแนนซ์ตัวอย่าง', financeRefNumber: 'REF-001',
    expectedAmount: '10000', netExpectedAmount: '10000', receivedAmount: null,
    expectedDate: '2026-10-20', createdAt: '2026-10-19T03:00:00Z',
    status: 'PENDING', commissionRate: null, commissionAmount: null, note: null,
    lastContactedAt: null, lastPromisedDate: null, contactAttemptCount: 0,
    branch: { id: 'branch-1', name: 'สาขาตัวอย่าง' },
    sale: {
      id: 'sale-1', saleNumber: 'SALE-001',
      customer: { id: 'customer-1', name: 'ลูกค้าตัวอย่าง', phone: null },
      product: { id: 'product-1', name: 'iPhone 15' },
      salesperson: { id: 'user-1', name: 'ผู้ขายตัวอย่าง' },
    },
  };
  function mountRow(status = 'PENDING') {
    apiGet.mockImplementation((path: string) => Promise.resolve({
      data: path.startsWith('/finance-receivable?')
        ? { data: [{ ...receivable, status }], total: 1 }
        : path.includes('/summary') ? summary : [],
    }));
    mount('/finance-receivable');
  }

  it('keeps the menu open and opens the selected edit dialog', async () => {
    const user = userEvent.setup();
    mountRow();
    await user.click(await screen.findByRole('button', { name: 'เมนู SALE-001' }));
    await user.click(await screen.findByRole('menuitem', { name: 'แก้ไข' }));
    const dialog = await screen.findByRole('dialog', { name: 'แก้ไขข้อมูล' });
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(within(dialog).getByLabelText('เลข Ref ไฟแนนซ์')).toHaveValue('REF-001');
    await user.clear(within(dialog).getByLabelText('เลข Ref ไฟแนนซ์'));
    await user.type(within(dialog).getByLabelText('เลข Ref ไฟแนนซ์'), 'REF-002');
    expect(within(dialog).getByLabelText('เลข Ref ไฟแนนซ์')).toHaveValue('REF-002');
    await user.click(within(dialog).getByRole('button', { name: 'ยกเลิก' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(screen.getByRole('button', { name: 'เมนู SALE-001' })).toHaveFocus());
  });

  it('supports keyboard opening, Escape dismissal and the dispute dialog', async () => {
    const user = userEvent.setup();
    mountRow();
    const trigger = await screen.findByRole('button', { name: 'เมนู SALE-001' });
    trigger.focus();
    await user.keyboard('{Enter}');
    expect(await screen.findByRole('menuitem', { name: 'แจ้งปัญหา' })).toBeVisible();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
    await waitFor(() => expect(screen.getByRole('button', { name: 'เมนู SALE-001' })).toHaveFocus());
    await user.click(trigger);
    await user.click(await screen.findByRole('menuitem', { name: 'แจ้งปัญหา' }));
    expect(await screen.findByRole('dialog', { name: 'แจ้งปัญหา' })).toBeVisible();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(screen.getByRole('button', { name: 'เมนู SALE-001' })).toHaveFocus());
  });

  it('does not offer another dispute for an already disputed record', async () => {
    mountRow('DISPUTED');
    await userEvent.click(await screen.findByRole('button', { name: 'เมนู SALE-001' }));
    expect(await screen.findByRole('menuitem', { name: 'แก้ไข' })).toBeVisible();
    expect(screen.queryByRole('menuitem', { name: 'แจ้งปัญหา' })).not.toBeInTheDocument();
  });

  it('keeps received records without receipt or edit actions', async () => {
    mountRow('RECEIVED');
    await screen.findByText('ลูกค้าตัวอย่าง');
    expect(screen.queryByRole('button', { name: /^บันทึกรับเงิน$/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'เมนู SALE-001' })).not.toBeInTheDocument();
  });
});
