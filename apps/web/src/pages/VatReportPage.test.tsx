import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import VatReportPage from './VatReportPage';

vi.mock('@/lib/api', () => {
  return {
    default: {
      get: vi.fn().mockResolvedValue({ data: [] }),
      post: vi.fn().mockResolvedValue({ data: {} }),
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
        <VatReportPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('VatReportPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders header + RD reference line', () => {
    renderPage();
    expect(screen.getByRole('heading', { name: /ภ\.พ\.30/i })).toBeInTheDocument();
    expect(screen.getByText(/ม\.82\/3, ม\.83/)).toBeInTheDocument();
  });

  it('renders Export XLSX button (disabled until company selected)', () => {
    renderPage();
    const btn = screen.getByRole('button', { name: /ดาวน์โหลด XLSX/i });
    expect(btn).toBeInTheDocument();
    expect(btn).toBeDisabled();
  });

  it('shows prompt to pick a company when none selected', () => {
    renderPage();
    expect(screen.getByText(/กรุณาเลือกบริษัทเพื่อแสดงรายงาน/)).toBeInTheDocument();
  });
});
