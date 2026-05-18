import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import YearEndClosingPage from './YearEndClosingPage';

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'owner-1', role: 'OWNER', branchId: null },
    isLoading: false,
    isAuthenticated: true,
  }),
}));

const apiPost = vi.fn();

vi.mock('@/lib/api', () => ({
  default: {
    post: (...args: unknown[]) => apiPost(...args),
    get: vi.fn(),
  },
  getErrorMessage: (e: unknown) => String(e),
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <YearEndClosingPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  apiPost.mockReset();
});

describe('YearEndClosingPage', () => {
  it('renders header + preview button + defaults year to prior year', async () => {
    renderPage();
    expect(await screen.findByText('ปิดบัญชีสิ้นปี')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /ดูตัวอย่างการปิดบัญชี/ })).toBeInTheDocument();

    const select = screen.getByLabelText('ปี (ค.ศ.)') as HTMLSelectElement;
    const expected = new Date().getFullYear() - 1;
    expect(Number(select.value)).toBe(expected);
  });

  it('renders preview data after clicking preview (revenues + expenses + net)', async () => {
    apiPost.mockResolvedValueOnce({
      data: {
        year: 2025,
        revenues: [
          { code: '41-1101', name: 'รายได้ดอกเบี้ย', balance: '100000.00' },
        ],
        expenses: [
          { code: '51-1102', name: 'หนี้สูญ', balance: '20000.00' },
        ],
        revenueTotal: '100000.00',
        expenseTotal: '20000.00',
        netIncome: '80000.00',
        isProfit: true,
        totalSteps: 3,
        alreadyClosed: false,
        closedAt: null,
        closingBatchId: null,
        openMonths: [],
      },
    });

    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /ดูตัวอย่างการปิดบัญชี/ }));

    await waitFor(() => {
      expect(screen.getByText('รายได้ดอกเบี้ย')).toBeInTheDocument();
    });
    expect(screen.getByText('หนี้สูญ')).toBeInTheDocument();
    // Net income summary card label
    expect(screen.getByText('กำไรสุทธิ')).toBeInTheDocument();
    // "ปิดบัญชี" button should appear under preview
    expect(screen.getByRole('button', { name: /ปิดบัญชีปี/i })).toBeInTheDocument();
  });

  it('disables Preview button when year is current/future', async () => {
    renderPage();
    const customInput = screen.getByLabelText('ปีกำหนดเอง') as HTMLInputElement;
    const currentYear = new Date().getFullYear();
    fireEvent.change(customInput, { target: { value: String(currentYear + 1) } });

    const previewBtn = screen.getByRole('button', { name: /ดูตัวอย่างการปิดบัญชี/ });
    await waitFor(() => {
      expect(previewBtn).toBeDisabled();
    });
    // Error hint visible
    expect(
      screen.getByText(new RegExp(`ไม่สามารถปิดบัญชีปี ${currentYear + 1}`)),
    ).toBeInTheDocument();
  });
});
