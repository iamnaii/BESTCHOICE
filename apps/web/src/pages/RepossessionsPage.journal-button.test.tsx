/**
 * "บัญชี" button on RepossessionsPage (spec 2026-09-05 contract-journal-view):
 * both tables — รอยึดเครื่อง (TERMINATED contracts) and ยึดคืน & ขายต่อ — open
 * ContractJournalDialog for the row's contract without leaving the page.
 */
import type { ReactNode } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';

const apiGet = vi.fn();

vi.mock('@/lib/api', () => ({
  default: {
    get: (...args: unknown[]) => apiGet(...args),
    post: vi.fn(),
    patch: vi.fn(),
  },
  getErrorMessage: (e: unknown) => String(e),
}));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'u-owner', name: 'เจ้าของ', role: 'OWNER', branchId: null },
    isLoading: false,
  }),
}));

vi.mock('@/pages/PaymentsPage/components/RepossessionOverlay', () => ({
  RepossessionOverlay: () => <div data-testid="repo-overlay" />,
}));

vi.mock('@/components/contract/ContractJournalDialog', () => ({
  default: (p: { contractId: string | null; contractNumber?: string }) =>
    p.contractId ? (
      <div data-testid="journal-dialog">
        journal:{p.contractId}:{p.contractNumber}
      </div>
    ) : null,
}));

import RepossessionsPage from './RepossessionsPage';

const terminatedContract = {
  id: 'c-term-1',
  contractNumber: 'TEST-20260905-001',
  status: 'TERMINATED',
  monthlyPayment: '5371.00',
  customer: { id: 'cu1', name: 'ลูกค้า รอยึด', phone: '0800000000' },
  product: { id: 'p1', name: 'iPhone 15', brand: 'Apple', model: '15' },
  branch: { id: 'b1', name: 'ลาดพร้าว' },
};

const repossession = {
  id: 'repo-1',
  repossessedDate: '2026-09-01T00:00:00.000Z',
  conditionGrade: 'B',
  appraisalPrice: '7000.00',
  repairCost: '0',
  resellPrice: null,
  status: 'REPOSSESSED',
  notes: null,
  customerRefundEnabled: false,
  customerRefund: null,
  shopCollectOutstanding: '0.00',
  deviceReturnOutstanding: '0.00',
  contract: {
    id: 'c-repo-1',
    contractNumber: 'TEST-20260905-002',
    sellingPrice: '20000.00',
    financedAmount: '17000.00',
    customer: { id: 'cu2', name: 'ลูกค้า ยึดแล้ว', phone: '0800000001' },
    branch: { id: 'b1', name: 'ลาดพร้าว' },
  },
  product: { id: 'p2', name: 'Galaxy S24', brand: 'Samsung', model: 'S24', imeiSerial: null },
  appraisedBy: { id: 'u-owner', name: 'เจ้าของ' },
  creditNote: null,
};

function routeApi() {
  apiGet.mockImplementation((url: string) => {
    if (url.startsWith('/device-returns/awaiting-repossession')) {
      return Promise.resolve({ data: { data: [terminatedContract], total: 1 } });
    }
    if (url.startsWith('/device-returns?')) {
      return Promise.resolve({ data: { data: [], total: 0, page: 1, limit: 100 } });
    }
    if (url.startsWith('/repossessions/profit-loss')) return Promise.resolve({ data: {} });
    if (url.startsWith('/repossessions')) {
      return Promise.resolve({ data: { data: [repossession], total: 1 } });
    }
    return Promise.reject(new Error(`unexpected GET ${url}`));
  });
}

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
}

describe('RepossessionsPage — ปุ่ม บัญชี', () => {
  it('opens the contract journal for a รอยึดเครื่อง row', async () => {
    routeApi();
    render(<RepossessionsPage />, { wrapper });
    await screen.findByText('TEST-20260905-001');

    const buttons = screen.getAllByRole('button', { name: 'บัญชี' });
    expect(buttons.length).toBeGreaterThanOrEqual(2);
    fireEvent.click(buttons[0]);

    expect(screen.getByTestId('journal-dialog')).toHaveTextContent(
      'journal:c-term-1:TEST-20260905-001',
    );
  });

  it('opens the contract journal for a ยึดคืนแล้ว row', async () => {
    routeApi();
    render(<RepossessionsPage />, { wrapper });
    await screen.findByText('TEST-20260905-002');

    const buttons = screen.getAllByRole('button', { name: 'บัญชี' });
    fireEvent.click(buttons[buttons.length - 1]);

    expect(screen.getByTestId('journal-dialog')).toHaveTextContent(
      'journal:c-repo-1:TEST-20260905-002',
    );
  });
});
