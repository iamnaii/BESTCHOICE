import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import PaymentTable from '../PaymentTable';
import type { PendingPayment } from '../../types';

// QrSentBadge (rendered on non-PAID rows) queries active partial-payment links.
vi.mock('@/lib/api', () => ({
  default: { get: vi.fn(() => Promise.resolve({ data: [] })) },
  getErrorMessage: (e: unknown) => String(e),
}));

/**
 * ชำระครบ tab renders the same table in mode="paid": read-only rows — no batch
 * checkbox, no รับชำระ button, a วันที่ชำระ column, and no overdue-red on the
 * due date (a settled installment is never "overdue").
 */

function makePayment(overrides: Partial<PendingPayment> = {}): PendingPayment {
  return {
    id: 'pay-1',
    installmentNo: 3,
    dueDate: '2026-06-05T00:00:00.000Z', // past date
    amountDue: '1515.83',
    amountPaid: '1515.83',
    lateFee: '0',
    status: 'PAID',
    paidDate: '2026-06-04T10:00:00.000Z',
    monthlyPrincipal: null,
    monthlyInterest: null,
    monthlyCommission: null,
    vatAmount: null,
    contract: {
      id: 'ct-1',
      contractNumber: 'CT-2026-0001',
      totalMonths: 12,
      monthlyPayment: '1515.83',
      advanceBalance: '0',
      customer: { id: 'cus-1', name: 'ลูกค้า ก', phone: '0812345678' },
      branch: { id: 'br-1', name: 'ลาดพร้าว' },
    },
    ...overrides,
  };
}

const noop = () => {};

function renderTable(mode: 'pending' | 'paid', payments: PendingPayment[]) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <PaymentTable
        mode={mode}
        pendingPayments={payments}
        loadingPending={false}
        selectedIds={new Set()}
        onToggleSelect={noop}
        onToggleAll={noop}
        onOpenPayModal={vi.fn()}
        onViewHistory={vi.fn()}
        batchTotal={0}
        onShowBatchModal={noop}
        onClearSelection={noop}
      />
    </QueryClientProvider>,
  );
}

describe('PaymentTable — mode="paid" (ชำระครบ tab)', () => {
  it('hides the batch checkbox and รับชำระ button; keeps ประวัติ', () => {
    renderTable('paid', [makePayment()]);

    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'รับชำระ' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'ประวัติ' })).toBeInTheDocument();
  });

  it('shows the วันที่ชำระ column and the paid-tab title', () => {
    renderTable('paid', [makePayment()]);

    expect(screen.getByText('วันที่ชำระ')).toBeInTheDocument();
    expect(screen.getByText('รายการชำระครบ')).toBeInTheDocument();
  });

  it('does NOT paint a past due date as overdue-red for settled rows', () => {
    const { container } = renderTable('paid', [makePayment()]);

    // In pending mode a past dueDate gets text-destructive; a PAID row must not.
    const destructiveDates = Array.from(container.querySelectorAll('.text-destructive'));
    expect(destructiveDates.map((el) => el.textContent)).not.toContain('5 มิ.ย. 2569');
  });

  it('pending mode still shows checkbox + รับชำระ (regression guard)', () => {
    renderTable('pending', [makePayment({ status: 'PENDING', amountPaid: '0', paidDate: null })]);

    expect(screen.getByRole('checkbox')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'รับชำระ' })).toBeInTheDocument();
    expect(screen.queryByText('วันที่ชำระ')).not.toBeInTheDocument();
  });

  it('labels early-payoff rows (notes "[ปิดก่อนกำหนด]") so a partial ชำระแล้ว is explained', () => {
    renderTable('paid', [makePayment({ amountPaid: '900', notes: '[ปิดก่อนกำหนด]' })]);

    expect(screen.getByText('ปิดยอดก่อนกำหนด')).toBeInTheDocument();
  });

  it('labels advance-credit rows (notes "ใช้เครดิต ... บาท")', () => {
    renderTable('paid', [makePayment({ amountPaid: '0', notes: 'ใช้เครดิต 1,515.83 บาท' })]);

    expect(screen.getByText('หักจากเครดิตล่วงหน้า')).toBeInTheDocument();
  });

  it('does NOT show settlement badges in pending mode even when notes match', () => {
    renderTable('pending', [
      makePayment({ status: 'PENDING', amountPaid: '0', paidDate: null, notes: '[ปิดก่อนกำหนด]' }),
    ]);

    expect(screen.queryByText('ปิดยอดก่อนกำหนด')).not.toBeInTheDocument();
  });
});
