/**
 * สรุปรายวัน — ส่งออก Excel ตามวันที่เลือกฝั่งซ้าย (owner 2026-08-19 รอบสอง:
 * "เอาช่วงวันที่กรองฝั่งซ้ายอยู่แล้วก็ได้ ไม่ต้องกรองซ้ำอีกฝั่งขวา") — the tab has
 * ONE date filter; the export follows it. No duplicate from–to pickers. Rows come
 * from the range endpoint with from = to = the selected day, so the file is
 * complete regardless of on-screen pagination.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import PaymentSummary from '../PaymentSummary';

const apiGet = vi.fn();
vi.mock('@/lib/api', () => ({
  default: { get: (...args: unknown[]) => apiGet(...args) },
}));

const exportToExcel = vi.fn();
vi.mock('@/utils/excel.util', () => ({
  exportToExcel: (...args: unknown[]) => exportToExcel(...args),
}));

const EXPORT_ROWS = [
  {
    id: 'r1',
    receiptNumber: 'RT-202608-00003',
    receiptType: 'INSTALLMENT',
    amount: '3771',
    installmentNo: 1,
    paymentMethod: 'CASH',
    paidDate: '2026-08-16T07:00:00.000Z',
    issuedByName: 'เอกนรินทร์ คงเดช',
    contract: { contractNumber: 'TEST-20260809-004', customer: { name: 'ทดสอบ' }, branch: { name: 'ลพบุรี' } },
  },
  {
    id: 'r2',
    receiptNumber: 'RT-202608-00010',
    receiptType: 'RESCHEDULE_FEE',
    amount: '857',
    installmentNo: 7,
    paymentMethod: 'CASH',
    paidDate: '2026-08-16T07:00:00.000Z',
    issuedByName: 'เอกนรินทร์ คงเดช',
    contract: { contractNumber: 'TEST-20260809-004', customer: { name: 'ทดสอบ' }, branch: { name: 'ลพบุรี' } },
  },
];

function renderSummary(summaryDate = '2026-08-16') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <PaymentSummary
        summaryDate={summaryDate}
        onDateChange={() => {}}
        summary={undefined}
        loadingSummary={false}
      />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  apiGet.mockReset();
  exportToExcel.mockReset();
  apiGet.mockImplementation((url: string) => {
    if (url.startsWith('/payments/daily-summary/export')) {
      return Promise.resolve({
        data: { from: '2026-08-16', to: '2026-08-16', total: 2, truncated: false, rows: EXPORT_ROWS },
      });
    }
    return Promise.resolve({ data: { month: '2026-08', days: [] } });
  });
});

describe('PaymentSummary — ส่งออก Excel ตามวันที่ฝั่งซ้าย', () => {
  it('no duplicate range pickers — the left date filter is the only filter', () => {
    renderSummary();

    expect(screen.queryByLabelText('ตั้งแต่วันที่')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('ถึงวันที่')).not.toBeInTheDocument();
    // A date is always selected, so the button is always ready.
    expect(screen.getByRole('button', { name: /ส่งออก Excel/ })).not.toBeDisabled();
  });

  it('exports the day shown on the left filter via the range endpoint', async () => {
    renderSummary('2026-08-16');

    fireEvent.click(screen.getByRole('button', { name: /ส่งออก Excel/ }));

    await waitFor(() =>
      expect(apiGet).toHaveBeenCalledWith(
        '/payments/daily-summary/export?from=2026-08-16&to=2026-08-16',
      ),
    );
    await waitFor(() => expect(exportToExcel).toHaveBeenCalledTimes(1));
    const call = exportToExcel.mock.calls[0][0];
    expect(call.filename).toBe('daily-summary-20260816.xlsx');
    expect(call.data).toHaveLength(2);
    expect(call.data[0].receiptNumber).toBe('RT-202608-00003');
    // ใบที่ไม่ใช่เงินงวดแท้ (ปรับดิว) uses the document-type label, mirroring the table.
    expect(call.data[1].installment).toBe('ค่าปรับดิว');
  });

  it('switching the left date exports THAT day', async () => {
    renderSummary('2026-08-18');

    fireEvent.click(screen.getByRole('button', { name: /ส่งออก Excel/ }));

    await waitFor(() =>
      expect(apiGet).toHaveBeenCalledWith(
        '/payments/daily-summary/export?from=2026-08-18&to=2026-08-18',
      ),
    );
    const call = exportToExcel.mock.calls[0][0];
    expect(call.filename).toBe('daily-summary-20260818.xlsx');
  });
});
