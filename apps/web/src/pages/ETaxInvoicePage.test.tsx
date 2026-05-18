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

  it('renders header showing Phase 1 scope (PDF + CSV)', () => {
    renderPage();
    // P2-SP3: PDF now ม.86/4 compliant; title reflects the upgrade
    expect(screen.getByText(/e-Tax Invoice \(Phase 1: PDF \+ CSV\)/)).toBeInTheDocument();
  });

  it('shows Phase 1 banner: PDF ม.86/4 compliant; Phase 2 = XML submission to RD', () => {
    renderPage();
    const banner = screen.getByTestId('phase2-banner');
    expect(banner).toBeInTheDocument();
    // P2-SP3: confirms PDF is legal paper invoice; XML to RD still pending
    expect(banner.textContent).toMatch(/ใบกำกับภาษี/);
    expect(banner.textContent).toMatch(/ม\.86\/4/);
    expect(banner.textContent).toMatch(/พิมพ์มอบ/);
    // Phase 2 messaging — XML submission + cert still pending
    expect(banner.textContent).toMatch(/XML/);
    expect(banner.textContent).toMatch(/PKCS#7/);
    expect(banner.textContent).toMatch(/ระยะที่ 2/);
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
