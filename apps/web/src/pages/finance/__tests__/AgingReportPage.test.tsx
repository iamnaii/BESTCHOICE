import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import React from 'react';

// Mock api BEFORE importing the page
const apiGet = vi.fn();
vi.mock('@/lib/api', () => ({
  __esModule: true,
  default: {
    get: (...args: unknown[]) => apiGet(...args),
  },
}));

// Mock useUiFlags to skip the settings/ui-flags fetch in tests
vi.mock('@/hooks/useUiFlags', () => ({
  useUiFlags: () => ({ cacheTtlReports: 300 }),
}));

// Mock CompanyFilter (depends on AuthContext)
vi.mock('@/components/CompanyFilter', () => ({
  __esModule: true,
  default: () => null,
}));

import AgingReportPage from '../AgingReportPage';

const sampleResponse = {
  asOf: '2026-05-19T00:00:00.000Z',
  summary: {
    bucket_0_30: 10000,
    bucket_31_60: 20000,
    bucket_61_90: 30000,
    bucket_90_plus: 40000,
  },
  customers: [
    {
      customerId: 'c1',
      customerName: 'นาย ก',
      phone: '0812345678',
      totalOverdue: 15000,
      daysOverdue: 45,
      bucket: 'bucket_31_60',
      contracts: 1,
    },
    {
      customerId: 'c2',
      customerName: 'นางสาว ข',
      phone: '0898765432',
      totalOverdue: 35000,
      daysOverdue: 95,
      bucket: 'bucket_90_plus',
      contracts: 2,
    },
  ],
};

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <AgingReportPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('AgingReportPage', () => {
  beforeEach(() => {
    apiGet.mockResolvedValue({ data: sampleResponse });
  });

  it('renders 4 bucket cards with correct labels', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByTestId('aging-buckets')).toBeInTheDocument());
    // Use getAllByText because bucket labels appear both in cards AND in badge column
    expect(screen.getAllByText('0–30 วัน').length).toBeGreaterThan(0);
    expect(screen.getAllByText('31–60 วัน').length).toBeGreaterThan(0);
    expect(screen.getAllByText('61–90 วัน').length).toBeGreaterThan(0);
    expect(screen.getAllByText('90+ วัน').length).toBeGreaterThan(0);
  });

  it('renders customer rows with names', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('นาย ก')).toBeInTheDocument());
    expect(screen.getByText('นางสาว ข')).toBeInTheDocument();
  });

  it('shows correct days overdue for each customer', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('นาย ก')).toBeInTheDocument());
    expect(screen.getByText('45 วัน')).toBeInTheDocument();
    expect(screen.getByText('95 วัน')).toBeInTheDocument();
  });

  it('calls the correct API endpoint', async () => {
    renderPage();
    await waitFor(() => expect(apiGet).toHaveBeenCalled());
    const [url] = apiGet.mock.calls[0] as [string];
    expect(url).toMatch('/expenses/ledger/aging');
  });
});
