import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import React from 'react';

const apiGet = vi.fn();
vi.mock('@/lib/api', () => ({
  __esModule: true,
  default: {
    get: (...args: unknown[]) => apiGet(...args),
  },
}));

vi.mock('@/hooks/useUiFlags', () => ({
  useUiFlags: () => ({ cacheTtlReports: 300 }),
}));

vi.mock('@/components/CompanyFilter', () => ({
  __esModule: true,
  default: () => null,
}));

import { EquityStatementPage } from './EquityStatementPage';

const sampleResponse = {
  periodStart: '2026-05-01T00:00:00.000Z',
  periodEnd: '2026-05-17T23:59:59.999Z',
  rows: [
    {
      accountCode: '31-1101',
      accountName: 'หุ้นสามัญ',
      opening: 100000,
      increases: [],
      decreases: [],
      totalIncrease: 0,
      totalDecrease: 0,
      closing: 100000,
    },
    {
      accountCode: '31-1102',
      accountName: 'ส่วนเกินมูลค่าหุ้น',
      opening: 0,
      increases: [],
      decreases: [],
      totalIncrease: 0,
      totalDecrease: 0,
      closing: 0,
    },
    {
      accountCode: '32-1101',
      accountName: 'กำไร(ขาดทุน)สะสม',
      opening: 50000,
      increases: [],
      decreases: [],
      totalIncrease: 0,
      totalDecrease: 0,
      closing: 50000,
    },
    {
      accountCode: '33-1101',
      accountName: 'กำไร(ขาดทุน)สุทธิประจำปี',
      opening: 0,
      increases: [
        {
          entryDate: '2026-05-05T00:00:00.000Z',
          entryNumber: 'JE-202605-001',
          description: 'ปิดบัญชีรายได้',
          amount: 12345,
        },
      ],
      decreases: [],
      totalIncrease: 12345,
      totalDecrease: 0,
      closing: 12345,
    },
  ],
  currentYearProfit: 12345,
  caveat:
    'ค่าประมาณกำไรปีปัจจุบัน — ยังไม่ปิดบัญชีจริงเข้า 33-1101 / 32-1101 (รอปิดบัญชีสิ้นปี)',
  totalOpening: 150000,
  totalClosing: 162345,
};

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    React.createElement(
      QueryClientProvider,
      { client: qc },
      React.createElement(MemoryRouter, null, React.createElement(EquityStatementPage)),
    ),
  );
}

describe('EquityStatementPage', () => {
  beforeEach(() => {
    apiGet.mockReset();
  });

  it('renders matrix table + caveat banner', async () => {
    apiGet.mockResolvedValue({ data: sampleResponse });
    renderPage();

    // Caveat banner visible — match the wording emitted by the page
    await waitFor(() => {
      expect(screen.getByText(/ค่าประมาณกำไรปีปัจจุบัน/)).toBeInTheDocument();
    });

    // All 4 equity rows present
    expect(screen.getByText('หุ้นสามัญ')).toBeInTheDocument();
    expect(screen.getByText('ส่วนเกินมูลค่าหุ้น')).toBeInTheDocument();
    expect(screen.getByText('กำไร(ขาดทุน)สะสม')).toBeInTheDocument();
    expect(screen.getByText('กำไร(ขาดทุน)สุทธิประจำปี')).toBeInTheDocument();

    // Column headers
    expect(screen.getByText('ยอดต้นงวด')).toBeInTheDocument();
    expect(screen.getByText('ยอดปลายงวด')).toBeInTheDocument();

    // Title
    expect(
      screen.getAllByText(/งบแสดงการเปลี่ยนแปลงในส่วนของผู้ถือหุ้น/)[0],
    ).toBeInTheDocument();
  });
});
