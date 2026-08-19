/**
 * สรุปรายวัน — "วันไหนมีสมุดบ้าง" (owner 2026-08-19). The bare date input forced
 * the cashier to guess which days held receipts; the tab now shows clickable
 * chips for every day of the selected month that has data, plus ‹ › day steppers.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import PaymentSummary from '../PaymentSummary';

const apiGet = vi.fn();
vi.mock('@/lib/api', () => ({
  default: { get: (...args: unknown[]) => apiGet(...args) },
}));

function renderSummary(summaryDate = '2026-08-16') {
  const onDateChange = vi.fn();
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <PaymentSummary
        summaryDate={summaryDate}
        onDateChange={onDateChange}
        summary={undefined}
        loadingSummary={false}
      />
    </QueryClientProvider>,
  );
  return { onDateChange };
}

beforeEach(() => {
  apiGet.mockReset();
  apiGet.mockResolvedValue({
    data: {
      month: '2026-08',
      days: [
        { date: '2026-08-16', count: 8, total: 23523 },
        { date: '2026-08-18', count: 2, total: 4814 },
      ],
    },
  });
});

describe('PaymentSummary — วันที่มีรายการ', () => {
  it('fetches the month of the selected date and renders one chip per day', async () => {
    renderSummary('2026-08-16');

    await waitFor(() =>
      expect(apiGet).toHaveBeenCalledWith('/payments/daily-summary/dates?month=2026-08'),
    );
    expect(await screen.findByRole('button', { name: /16 ส\.ค\..*8 ใบ/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /18 ส\.ค\..*2 ใบ/ })).toBeInTheDocument();
  });

  it('clicking a chip jumps straight to that day', async () => {
    const { onDateChange } = renderSummary('2026-08-16');

    fireEvent.click(await screen.findByRole('button', { name: /18 ส\.ค\./ }));

    expect(onDateChange).toHaveBeenCalledWith('2026-08-18');
  });

  it('‹ › steppers move one day without timezone drift', async () => {
    const { onDateChange } = renderSummary('2026-08-16');

    fireEvent.click(screen.getByRole('button', { name: 'วันก่อนหน้า' }));
    expect(onDateChange).toHaveBeenCalledWith('2026-08-15');

    fireEvent.click(screen.getByRole('button', { name: 'วันถัดไป' }));
    expect(onDateChange).toHaveBeenCalledWith('2026-08-17');
  });

  it('stepper crosses a month boundary correctly', async () => {
    const { onDateChange } = renderSummary('2026-08-01');

    fireEvent.click(screen.getByRole('button', { name: 'วันก่อนหน้า' }));

    expect(onDateChange).toHaveBeenCalledWith('2026-07-31');
  });

  it('month with no data renders no chips (and no crash)', async () => {
    apiGet.mockResolvedValue({ data: { month: '2026-08', days: [] } });
    renderSummary('2026-08-16');

    await waitFor(() => expect(apiGet).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: /ใบ\)/ })).not.toBeInTheDocument();
  });
});
