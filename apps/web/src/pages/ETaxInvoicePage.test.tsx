import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import ETaxInvoicePage from './ETaxInvoicePage';

vi.mock('@/lib/api', () => {
  return {
    default: {
      get: vi.fn().mockResolvedValue({ data: { data: [], total: 0, page: 1, limit: 50 } }),
    },
  };
});

vi.mock('@/components/CompanyFilter', () => ({
  default: ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
    <select
      data-testid="company-filter"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="">— เลือกบริษัท —</option>
    </select>
  ),
}));

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <ETaxInvoicePage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('ETaxInvoicePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders header with "e-Tax Invoice" title', () => {
    renderPage();
    expect(screen.getByText('e-Tax Invoice')).toBeInTheDocument();
  });

  it('shows Phase 2 banner (XML/PKCS#7)', () => {
    renderPage();
    expect(screen.getByTestId('phase2-banner')).toBeInTheDocument();
    expect(screen.getByText(/ระยะที่ 2/)).toBeInTheDocument();
    expect(screen.getByText(/PKCS#7/)).toBeInTheDocument();
  });

  it('renders Export CSV button (monthly)', () => {
    renderPage();
    expect(screen.getByRole('button', { name: /Export CSV/i })).toBeInTheDocument();
  });

  it('prompts to pick a company when none selected', () => {
    renderPage();
    expect(screen.getByText(/กรุณาเลือกบริษัทเพื่อแสดงรายการ/)).toBeInTheDocument();
  });
});
