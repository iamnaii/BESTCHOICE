import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import ShopAccountingPage from './ShopAccountingPage';

const apiGet = vi.fn();

vi.mock('@/lib/api', () => ({
  default: {
    get: (...args: unknown[]) => apiGet(...args),
    post: vi.fn(),
  },
  getErrorMessage: (e: unknown) => String(e),
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'user-1', role: 'OWNER', branchId: null },
    isLoading: false,
    isAuthenticated: true,
  }),
}));

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <ShopAccountingPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  apiGet.mockReset();
});

describe('ShopAccountingPage', () => {
  it('renders the page header + both tabs', async () => {
    apiGet.mockResolvedValue({
      data: {
        asOfDate: new Date().toISOString(),
        sections: [],
        grandDrTotal: 0,
        grandCrTotal: 0,
        isBalanced: true,
      },
    });
    renderPage();
    expect(await screen.findByText('บัญชีหน้าร้าน (SHOP)')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /งบทดลอง \(SHOP\)/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /งบกำไรขาดทุน \(SHOP\)/ })).toBeInTheDocument();
  });

  it('shows isBalanced badge + grand totals when trial balance loads', async () => {
    apiGet.mockResolvedValue({
      data: {
        asOfDate: new Date().toISOString(),
        sections: [
          {
            sectionName: 'สินทรัพย์หมุนเวียน (SHOP)',
            codePrefix: 'S11',
            rows: [
              {
                code: 'S11-1101',
                name: 'เงินสด - สาขา',
                type: 'สินทรัพย์',
                normalBalance: 'Dr',
                drBalance: '3000.00',
                crBalance: '0.00',
                netBalance: '3000.00',
              },
            ],
            drTotal: '3000.00',
            crTotal: '0.00',
          },
        ],
        grandDrTotal: '3000.00',
        grandCrTotal: '3000.00',
        isBalanced: true,
      },
    });
    renderPage();
    await waitFor(() => expect(screen.getByText('สมดุล')).toBeInTheDocument());
    expect(screen.getByText('S11-1101')).toBeInTheDocument();
    expect(screen.getByText('เงินสด - สาขา')).toBeInTheDocument();
  });

  it('switches to P&L tab and calls /expenses/ledger/shop/profit-loss', async () => {
    apiGet
      // First call: trial-balance (default tab)
      .mockResolvedValueOnce({
        data: {
          asOfDate: new Date().toISOString(),
          sections: [],
          grandDrTotal: 0,
          grandCrTotal: 0,
          isBalanced: true,
        },
      })
      // Second call: profit-loss
      .mockResolvedValueOnce({
        data: {
          periodStart: new Date().toISOString(),
          periodEnd: new Date().toISOString(),
          revenue: { sectionName: 'รายได้รวม', rows: [], total: 0 },
          expenses: { sectionName: 'ค่าใช้จ่ายรวม', rows: [], total: 0 },
          netIncome: 0,
        },
      });
    renderPage();
    // Trial balance loads first
    await waitFor(() => expect(apiGet).toHaveBeenCalled());

    const plTab = screen.getByRole('button', { name: /งบกำไรขาดทุน \(SHOP\)/ });
    fireEvent.click(plTab);

    await waitFor(() => {
      const plCall = apiGet.mock.calls.find((c) =>
        String(c[0]).includes('/expenses/ledger/shop/profit-loss'),
      );
      expect(plCall).toBeTruthy();
    });
    expect(
      await screen.findByText('กำไร(ขาดทุน)สุทธิประจำงวด — SHOP'),
    ).toBeInTheDocument();
  });
});
