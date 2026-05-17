import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import type { ReactNode } from 'react';
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

// Mock CompanyFilter (depends on AuthContext) — render a no-op placeholder
vi.mock('@/components/CompanyFilter', () => ({
  __esModule: true,
  default: () => null,
}));

import { CashFlowPage } from './CashFlowPage';

const sampleResponse = {
  periodStart: '2026-05-01T00:00:00.000Z',
  periodEnd: '2026-05-17T23:59:59.999Z',
  method: 'indirect' as const,
  operating: {
    netIncome: 12000,
    depreciation: 500,
    badDebtProvisionChange: 100,
    unearnedInterestChange: -200,
    arChange: 800,
    inventoryChange: 0,
    apChange: 300,
    vatPayableChange: 50,
    netOperating: 11950,
  },
  investing: {
    ppePurchases: 5000,
    ppeDisposals: 0,
    netInvesting: -5000,
  },
  financing: {
    capitalInjections: 0,
    dividends: 0,
    netFinancing: 0,
  },
  netChange: 6950,
  openingCash: 100000,
  closingCash: 106950,
  actualCashChange: 6950,
  isReconciled: true,
  drift: 0,
};

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    React.createElement(
      QueryClientProvider,
      { client: qc },
      React.createElement(MemoryRouter, null, React.createElement(CashFlowPage)),
    ),
  );
}

describe('CashFlowPage', () => {
  beforeEach(() => {
    apiGet.mockReset();
  });

  it('renders 4 summary cards + 3 sections from API response', async () => {
    apiGet.mockResolvedValue({ data: sampleResponse });
    renderPage();

    // Wait for header (always shown)
    await waitFor(() => {
      expect(screen.getByText('งบกระแสเงินสด')).toBeInTheDocument();
    });

    // 3 section headers
    await waitFor(() => {
      expect(screen.getByText(/กิจกรรมดำเนินงาน \(Operating/)).toBeInTheDocument();
    });
    expect(screen.getByText(/กิจกรรมลงทุน \(Investing\)/)).toBeInTheDocument();
    expect(screen.getByText(/กิจกรรมจัดหาเงิน \(Financing\)/)).toBeInTheDocument();

    // 4 summary cards (use getAllByText — labels appear in both card + section)
    expect(screen.getAllByText('กิจกรรมดำเนินงาน').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('กิจกรรมลงทุน').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('กิจกรรมจัดหาเงิน').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('กระแสเงินสดสุทธิ')).toBeInTheDocument();

    // Method + standard badges — text appears in both subtitle and chip; allow multiple
    expect(screen.getAllByText(/วิธีทางอ้อม \(Indirect Method\)/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('TFRS for NPAEs')).toBeInTheDocument();

    // Reconciliation badge
    expect(screen.getByText(/Reconciled/)).toBeInTheDocument();
  });

  it('shows drift warning when not reconciled', async () => {
    apiGet.mockResolvedValue({
      data: { ...sampleResponse, isReconciled: false, drift: 1234.56 },
    });
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/ข้อมูลคลาดเคลื่อน/)).toBeInTheDocument();
    });
  });
});
