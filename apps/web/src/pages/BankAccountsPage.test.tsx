import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import BankAccountsPage from './BankAccountsPage';

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'u1', role: 'ACCOUNTANT', branchId: null },
    isLoading: false,
    isAuthenticated: true,
  }),
}));

const apiGet = vi.fn();

vi.mock('@/lib/api', () => ({
  default: {
    get: (...args: unknown[]) => apiGet(...args),
    post: vi.fn(),
  },
  getErrorMessage: (e: unknown) => String(e),
}));

const accounts = [
  {
    id: 'a1',
    accountCode: '11-1101',
    accountName: 'เงินสด — สุทธินีย์ คงเดช',
    bankName: 'เงินสดในมือ',
    accountNumber: null,
    accountType: 'CASH',
    currency: 'THB',
    isActive: true,
    notes: null,
    balance: '12345.67',
  },
  {
    id: 'a2',
    accountCode: '11-1201',
    accountName: 'KBank ธนาคารกสิกรไทย',
    bankName: 'KBank',
    accountNumber: '123-4-56789-0',
    accountType: 'SAVINGS',
    currency: 'THB',
    isActive: true,
    notes: null,
    balance: '987654.32',
  },
];

const renderPage = () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <BankAccountsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
};

describe('BankAccountsPage', () => {
  beforeEach(() => {
    apiGet.mockReset();
  });

  it('renders a card grid with one card per account + masked number', async () => {
    apiGet.mockImplementation((url: string) => {
      if (url === '/bank-accounts') return Promise.resolve({ data: accounts });
      throw new Error(`unexpected: ${url}`);
    });

    renderPage();

    await waitFor(() => {
      expect(screen.getByTestId('bank-account-grid')).toBeInTheDocument();
    });
    expect(screen.getByText('เงินสด — สุทธินีย์ คงเดช')).toBeInTheDocument();
    expect(screen.getByText('KBank ธนาคารกสิกรไทย')).toBeInTheDocument();
    // Account number must be masked — last 5 digits kept, others as 'x'
    // mask keeps last 5 digits: 1234567890 → xxxxx67890 with separators
    expect(screen.getByText(/xxx-x-x6789-0/)).toBeInTheDocument();
    expect(screen.queryByText('123-4-56789-0')).not.toBeInTheDocument();
  });

  it('clicking a card opens the drawer with detail + transactions', async () => {
    apiGet.mockImplementation((url: string) => {
      if (url === '/bank-accounts') return Promise.resolve({ data: accounts });
      if (url === '/bank-accounts/11-1201') {
        return Promise.resolve({
          data: {
            ...accounts[1],
            recentTransactions: [],
          },
        });
      }
      if (url === '/bank-accounts/11-1201/transactions') {
        return Promise.resolve({
          data: { data: [], total: 0, page: 1, limit: 25 },
        });
      }
      throw new Error(`unexpected: ${url}`);
    });

    renderPage();

    await waitFor(() => {
      expect(screen.getByTestId('bank-account-grid')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByLabelText(/เปิดรายละเอียดบัญชี KBank/));

    await waitFor(() => {
      expect(screen.getByTestId('account-drawer-content')).toBeInTheDocument();
    });
    expect(screen.getByText('ยอดคงเหลือปัจจุบัน')).toBeInTheDocument();
    expect(screen.getByText('ยังไม่มีรายการเดินบัญชี')).toBeInTheDocument();
  });
});
