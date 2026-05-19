import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import YearEndClosingPage from './YearEndClosingPage';

// Mutable role for tests that need to swap roles (W4 — FM gets a different UI)
let mockRole: 'OWNER' | 'ACCOUNTANT' | 'FINANCE_MANAGER' | 'BRANCH_MANAGER' | 'SALES' = 'OWNER';

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'user-1', role: mockRole, branchId: null },
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
  mockRole = 'OWNER';
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

  it('renders pa.. (Buddhist Era) year in headings (W1)', async () => {
    apiPost.mockResolvedValueOnce({
      data: {
        year: 2025,
        revenues: [],
        expenses: [{ code: '51-1102', name: 'หนี้สูญ', balance: '500.00' }],
        revenueTotal: '0.00',
        expenseTotal: '500.00',
        netIncome: '-500.00',
        isProfit: false,
        totalSteps: 3,
        alreadyClosed: true,
        closedAt: new Date('2026-01-15T10:30:00.000Z').toISOString(),
        closingBatchId: 'batch-1',
        openMonths: [],
      },
    });
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /ดูตัวอย่างการปิดบัญชี/ }));
    // "ปี 2025 (พ.ศ. 2568)" — 2025 + 543 = 2568. Banner + action card + button
    // each display it — use getAllByText.
    await waitFor(() => {
      const matches = screen.getAllByText(/พ\.ศ\. 2568/);
      expect(matches.length).toBeGreaterThan(0);
    });
    // Banner says "ปิดบัญชีไปแล้ว"
    expect(screen.getByText(/ปิดบัญชีไปแล้ว/)).toBeInTheDocument();
  });

  it('hides post Card for FINANCE_MANAGER and shows role-explainer Alert (W4)', async () => {
    mockRole = 'FINANCE_MANAGER';
    apiPost.mockResolvedValueOnce({
      data: {
        year: 2025,
        revenues: [{ code: '41-1101', name: 'รายได้ดอกเบี้ย', balance: '1000.00' }],
        expenses: [],
        revenueTotal: '1000.00',
        expenseTotal: '0.00',
        netIncome: '1000.00',
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
      expect(screen.getByText('โหมดดูอย่างเดียว')).toBeInTheDocument();
    });
    // No disabled "ปิดบัญชีปี" submit button rendered
    expect(screen.queryByRole('button', { name: /ปิดบัญชีปี/i })).not.toBeInTheDocument();
    // Explainer mentions allowed roles
    expect(screen.getByText(/OWNER และ ACCOUNTANT/)).toBeInTheDocument();
  });

  it('shows post Card for ACCOUNTANT (canPost path)', async () => {
    mockRole = 'ACCOUNTANT';
    apiPost.mockResolvedValueOnce({
      data: {
        year: 2025,
        revenues: [{ code: '41-1101', name: 'รายได้ดอกเบี้ย', balance: '1000.00' }],
        expenses: [],
        revenueTotal: '1000.00',
        expenseTotal: '0.00',
        netIncome: '1000.00',
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
      expect(screen.getByRole('button', { name: /ปิดบัญชีปี/i })).toBeInTheDocument();
    });
    expect(screen.queryByText('โหมดดูอย่างเดียว')).not.toBeInTheDocument();
  });
});
