/**
 * สรุปรายวัน — ส่งออก Excel แบบช่วงวัน (owner 2026-08-19: "ส่งออกเป็น EXCEL ได้
 * แต่ต้องเลือกช่วงวันก่อน"). The button stays disabled until BOTH from/to are
 * chosen; the export pulls the range from the API (not the on-screen page) so a
 * multi-day file is complete regardless of pagination.
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

// The real ThaiDateInput is calendar-driven (its inner input is readOnly), so a
// change event cannot drive it from a test — swap in a plain input honouring
// value/onChange/aria-label. The range-state wiring under test lives entirely in
// PaymentSummary.
vi.mock('@/components/ui/ThaiDateInput', () => ({
  default: (props: {
    value: string;
    onChange: (e: { target: { value: string } }) => void;
    'aria-label'?: string;
  }) => (
    <input
      aria-label={props['aria-label'] ?? 'วันที่'}
      value={props.value}
      onChange={(e) => props.onChange({ target: { value: e.target.value } })}
    />
  ),
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

function renderSummary() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <PaymentSummary
        summaryDate="2026-08-16"
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
        data: { from: '2026-08-16', to: '2026-08-18', total: 2, truncated: false, rows: EXPORT_ROWS },
      });
    }
    return Promise.resolve({ data: { month: '2026-08', days: [] } });
  });
});

const setRange = (from: string, to: string) => {
  fireEvent.change(screen.getByLabelText('ตั้งแต่วันที่'), { target: { value: from } });
  fireEvent.change(screen.getByLabelText('ถึงวันที่'), { target: { value: to } });
};

describe('PaymentSummary — ส่งออก Excel แบบช่วงวัน', () => {
  it('export button is DISABLED until both from and to are chosen', () => {
    renderSummary();

    const btn = screen.getByRole('button', { name: /ส่งออก Excel/ });
    expect(btn).toBeDisabled();

    fireEvent.change(screen.getByLabelText('ตั้งแต่วันที่'), { target: { value: '2026-08-16' } });
    expect(btn).toBeDisabled(); // from alone is not a range

    fireEvent.change(screen.getByLabelText('ถึงวันที่'), { target: { value: '2026-08-18' } });
    expect(btn).not.toBeDisabled();
  });

  it('exports the chosen range through the range endpoint, not the page', async () => {
    renderSummary();
    setRange('2026-08-16', '2026-08-18');

    fireEvent.click(screen.getByRole('button', { name: /ส่งออก Excel/ }));

    await waitFor(() =>
      expect(apiGet).toHaveBeenCalledWith(
        '/payments/daily-summary/export?from=2026-08-16&to=2026-08-18',
      ),
    );
    await waitFor(() => expect(exportToExcel).toHaveBeenCalledTimes(1));
    const call = exportToExcel.mock.calls[0][0];
    expect(call.filename).toBe('daily-summary-20260816-20260818.xlsx');
    expect(call.data).toHaveLength(2);
    expect(call.data[0].receiptNumber).toBe('RT-202608-00003');
    // ใบที่ไม่ผูกงวด (ปรับดิว) uses the document-type label, mirroring the table.
    expect(call.data[1].installment).toBe('ค่าปรับดิว');
  });

  it('an inverted range never reaches the API', async () => {
    renderSummary();
    setRange('2026-08-18', '2026-08-16');

    fireEvent.click(screen.getByRole('button', { name: /ส่งออก Excel/ }));

    await waitFor(() => expect(exportToExcel).not.toHaveBeenCalled());
    expect(apiGet).not.toHaveBeenCalledWith(expect.stringContaining('/export'));
  });
});
