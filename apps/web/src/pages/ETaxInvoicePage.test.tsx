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

  it('renders header showing Phase 1 scope (Receipt + CSV)', () => {
    renderPage();
    // Critical #6+#7: title makes scope reduction explicit
    expect(screen.getByText(/e-Tax Invoice \(Phase 1: Receipt \+ CSV\)/)).toBeInTheDocument();
  });

  it('shows Phase 1 limitations banner (internal receipt, NOT legal tax invoice)', () => {
    renderPage();
    const banner = screen.getByTestId('phase2-banner');
    expect(banner).toBeInTheDocument();
    // Critical #6+#7: explicit "internal receipt only" disclaimer (scoped to banner)
    expect(banner.textContent).toMatch(/ใบรับเงินภายใน/);
    expect(banner.textContent).toMatch(/ไม่ใช่ใบกำกับภาษีอิเล็กทรอนิกส์ตามกฎหมาย/);
    expect(banner.textContent).toMatch(/ม\.86\/4/);
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
