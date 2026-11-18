import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import React from 'react';

const apiGet = vi.fn();
vi.mock('@/lib/api', () => ({
  __esModule: true,
  default: { get: (...args: unknown[]) => apiGet(...args) },
}));
vi.mock('@/hooks/useUiFlags', () => ({ useUiFlags: () => ({ cacheTtlReports: 300 }) }));

import TrialBalancePage from '../TrialBalancePage';

const DATA = {
  periodStart: '2026-10-31T17:00:00.000Z',
  periodEnd: '2026-11-17T16:59:59.999Z',
  sections: [
    {
      sectionName: 'สินทรัพย์หมุนเวียน', codePrefix: '11',
      rows: [
        { code: '11-1201', name: 'ธนาคาร KBank', type: 'สินทรัพย์', normalBalance: 'Dr', openingDr: '250000', openingCr: '0', periodDr: '45480', periodCr: '138000', closingDr: '157480', closingCr: '0' },
        { code: '11-1202', name: 'ธนาคาร SCB (ค่าใช้จ่าย)', type: 'สินทรัพย์', normalBalance: 'Dr', openingDr: '0', openingCr: '0', periodDr: '0', periodCr: '0', closingDr: '0', closingCr: '0' },
      ],
      totals: { openingDr: '250000', openingCr: '0', periodDr: '45480', periodCr: '138000', closingDr: '157480', closingCr: '0' },
    },
  ],
  totals: { openingDr: '250000', openingCr: '250000', periodDr: '45480', periodCr: '138000', closingDr: '157480', closingCr: '0' },
  isBalanced: { opening: true, period: false, closing: false },
};

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    React.createElement(
      QueryClientProvider,
      { client: qc },
      React.createElement(
        MemoryRouter,
        { initialEntries: ['/finance/trial-balance?start=2026-11-01&end=2026-11-17'] },
        React.createElement(TrialBalancePage),
      ),
    ),
  );
}

describe('TrialBalancePage', () => {
  beforeEach(() => {
    apiGet.mockReset();
    apiGet.mockResolvedValue({ data: DATA });
  });

  it('เรียก API ด้วยวันที่จาก URL', async () => {
    renderPage();
    await waitFor(() =>
      expect(apiGet).toHaveBeenCalledWith('/expenses/ledger/trial-balance', {
        params: { periodStart: '2026-11-01', periodEnd: '2026-11-17' },
      }),
    );
  });

  it('หัวหน้า = งบทดลอง', async () => {
    renderPage();
    expect(screen.getByRole('heading', { level: 1, name: 'งบทดลอง' })).toBeInTheDocument();
    await screen.findByRole('link', { name: 'ธนาคาร KBank' });
  });

  it('ลิงก์ชื่อบัญชีพาไปบัญชีแยกประเภทพร้อมช่วงวันที่', async () => {
    renderPage();
    const link = await screen.findByRole('link', { name: 'ธนาคาร KBank' });
    expect(link).toHaveAttribute(
      'href',
      '/finance/general-ledger?account=11-1201&start=2026-11-01&end=2026-11-17&from=trial-balance',
    );
  });

  it('ซ่อนบัญชีที่ไม่มียอดเป็นค่าเริ่มต้น และแสดงเมื่อยกเลิกติ๊ก', async () => {
    renderPage();
    await screen.findByRole('link', { name: 'ธนาคาร KBank' });
    expect(screen.queryByText('ธนาคาร SCB (ค่าใช้จ่าย)')).toBeNull();
    await userEvent.click(screen.getByRole('checkbox', { name: 'ซ่อนบัญชีที่ไม่มียอด' }));
    expect(await screen.findByText('ธนาคาร SCB (ค่าใช้จ่าย)')).toBeInTheDocument();
  });

  it('สถานะไม่สมดุลบอกเป็นคำ', async () => {
    renderPage();
    expect(await screen.findByText('ไม่สมดุล: ระหว่างงวด, ยอดคงเหลือ')).toBeInTheDocument();
  });
});
