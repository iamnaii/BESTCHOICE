import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import WhtReportPage from './WhtReportPage';

vi.mock('@/lib/api', () => {
  return {
    default: {
      get: vi.fn().mockResolvedValue({ data: [] }),
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
        <WhtReportPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('WhtReportPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders 3 WHT tabs (PND1 / PND3 / PND53)', () => {
    renderPage();
    expect(screen.getByRole('tab', { name: 'ภ.ง.ด.1' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'ภ.ง.ด.3' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'ภ.ง.ด.53' })).toBeInTheDocument();
  });

  it('defaults to PND1 tab with payroll subtitle', () => {
    renderPage();
    // The PND1 subtitle should be present
    expect(screen.getByText(/ม.50\(1\)/)).toBeInTheDocument();
  });

  it('clicking ภ.ง.ด.3 swaps subtitle to ม.3 เตรส (individuals)', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('tab', { name: 'ภ.ง.ด.3' }));
    expect(document.body.textContent ?? '').toMatch(/ม\.3 เตรส, ม\.50\(3\)\(4\)/);
  });

  it('clicking ภ.ง.ด.53 swaps subtitle to ทป.4/2528 (juristic)', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('tab', { name: 'ภ.ง.ด.53' }));
    expect(document.body.textContent ?? '').toMatch(/ทป\.4\/2528/);
  });
});
