/**
 * "รอยึดเครื่อง" list on RepossessionsPage (owner 2026-09-05).
 *
 * TERMINATED contracts were removed from the รับชำระ queue (GET /payments/pending
 * now scopes to ACTIVE/OVERDUE/DEFAULT — the orchestrator rejects everything
 * else anyway). That queue row was the ONLY UI doorway to JP5 (the wizard's
 * "คืนเครื่อง" tab), so the doorway moves here: the repossessions page lists
 * TERMINATED contracts and opens the same RepossessionOverlay for one of them.
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

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'u-owner', name: 'เจ้าของ', role: 'OWNER', branchId: null },
    isLoading: false,
  }),
}));

// The overlay itself (preview P&L, JP5 submit) is covered elsewhere — here we only
// care that the page hands it the chosen contract.
vi.mock('@/pages/PaymentsPage/components/RepossessionOverlay', () => ({
  RepossessionOverlay: (p: { contractNumber: string; customerName: string }) => (
    <div data-testid="repo-overlay">
      overlay:{p.contractNumber}:{p.customerName}
    </div>
  ),
}));

import RepossessionsPage from './RepossessionsPage';

const terminatedContract = {
  id: 'c-term-1',
  contractNumber: 'TEST-20260827-021',
  status: 'TERMINATED',
  monthlyPayment: '5371.00',
  customer: { id: 'cu1', name: 'ทดสอบ ยึดเครื่อง (บอกเลิกแล้ว) 21', phone: '0800000000' },
  product: { id: 'p1', name: 'iPhone 15', brand: 'Apple', model: '15', category: 'MOBILE' },
  branch: { id: 'b1', name: 'ลาดพร้าว' },
};

function routeApi(awaiting: unknown[]) {
  apiGet.mockImplementation((url: string) => {
    if (url.startsWith('/contracts?status=TERMINATED')) {
      return Promise.resolve({ data: { data: awaiting, total: awaiting.length } });
    }
    if (url.startsWith('/repossessions/profit-loss')) {
      return Promise.resolve({ data: {} });
    }
    if (url.startsWith('/repossessions')) {
      return Promise.resolve({ data: { data: [], total: 0 } });
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

describe('RepossessionsPage — รอยึดเครื่อง (TERMINATED contracts)', () => {
  it('lists TERMINATED contracts fetched from /contracts?status=TERMINATED', async () => {
    routeApi([terminatedContract]);
    render(<RepossessionsPage />, { wrapper });

    expect(await screen.findByText('TEST-20260827-021')).toBeInTheDocument();
    expect(screen.getByText(/ทดสอบ ยึดเครื่อง \(บอกเลิกแล้ว\) 21/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /ยึดเครื่อง/ })).toBeInTheDocument();
    expect(
      apiGet.mock.calls.some(([url]) => String(url).startsWith('/contracts?status=TERMINATED')),
    ).toBe(true);
  });

  it('opens the RepossessionOverlay for the chosen contract', async () => {
    routeApi([terminatedContract]);
    render(<RepossessionsPage />, { wrapper });

    fireEvent.click(await screen.findByRole('button', { name: /ยึดเครื่อง/ }));

    expect(screen.getByTestId('repo-overlay')).toHaveTextContent(
      'overlay:TEST-20260827-021:ทดสอบ ยึดเครื่อง (บอกเลิกแล้ว) 21',
    );
  });

  it('no longer points staff at the payments page to repossess', async () => {
    routeApi([]);
    render(<RepossessionsPage />, { wrapper });

    expect(await screen.findByText(/ไม่มีสัญญาที่บอกเลิกแล้วรอยึดเครื่อง/)).toBeInTheDocument();
    expect(screen.queryByText(/ไปหน้ารับชำระ/)).not.toBeInTheDocument();
  });
});
