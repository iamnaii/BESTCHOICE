/**
 * ห้ามข้ามงวด (owner 2026-08-19) — a queue row whose contract still has an
 * EARLIER unpaid installment must not offer รับชำระ (or batch selection): the
 * server guard would reject it anyway; the UI says why up front.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import PaymentTable from '../PaymentTable';
import type { PendingPayment } from '../../types';

const basePayment = (over: Partial<PendingPayment>): PendingPayment => ({
  id: 'pay-1',
  installmentNo: 1,
  dueDate: '2026-08-01T00:00:00.000Z',
  amountDue: '3671',
  amountPaid: '0',
  lateFee: '0',
  status: 'OVERDUE',
  monthlyPrincipal: null,
  monthlyInterest: null,
  monthlyCommission: null,
  vatAmount: null,
  contract: {
    id: 'c1',
    contractNumber: 'TEST-20260809-004',
    totalMonths: 12,
    monthlyPayment: '3671',
    advanceBalance: '0',
    rescheduleAdvanceBalance: '0',
    customer: { id: 'cu1', name: 'ทดสอบ', phone: '0800000000' },
    branch: { id: 'b1', name: 'ลพบุรี' },
  },
  ...over,
});

function renderTable(payments: PendingPayment[]) {
  const onOpenPayModal = vi.fn();
  const onToggleSelect = vi.fn();
  // QrSentBadge inside the table uses react-query — a bare client is enough
  // (its query only fires per-payment and resolves to nothing in jsdom).
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <PaymentTable
      pendingPayments={payments}
      loadingPending={false}
      selectedIds={new Set()}
      onToggleSelect={onToggleSelect}
      onToggleAll={() => {}}
      onOpenPayModal={onOpenPayModal}
      onViewHistory={() => {}}
      batchTotal={0}
      onShowBatchModal={() => {}}
      onClearSelection={() => {}}
      />
    </QueryClientProvider>,
  );
  return { onOpenPayModal, onToggleSelect };
}

describe('PaymentTable — ห้ามข้ามงวด', () => {
  it('disables รับชำระ on a row with an earlier unpaid installment', () => {
    const { onOpenPayModal } = renderTable([
      basePayment({ id: 'pay-3', installmentNo: 3, hasEarlierUnpaid: true }),
    ]);

    const btn = screen.getByRole('button', { name: /รับชำระ/ });
    expect(btn).toBeDisabled();
    fireEvent.click(btn);
    expect(onOpenPayModal).not.toHaveBeenCalled();
  });

  it('explains WHY via the title tooltip', () => {
    renderTable([basePayment({ id: 'pay-3', installmentNo: 3, hasEarlierUnpaid: true })]);

    expect(screen.getByRole('button', { name: /รับชำระ/ })).toHaveAttribute(
      'title',
      expect.stringContaining('ตามลำดับงวด'),
    );
  });

  it('keeps รับชำระ enabled on the earliest unpaid row', () => {
    const { onOpenPayModal } = renderTable([
      basePayment({ id: 'pay-2', installmentNo: 2, hasEarlierUnpaid: false }),
    ]);

    const btn = screen.getByRole('button', { name: /รับชำระ/ });
    expect(btn).not.toBeDisabled();
    fireEvent.click(btn);
    expect(onOpenPayModal).toHaveBeenCalledTimes(1);
  });

  it('also blocks batch selection for out-of-order rows', () => {
    const { onToggleSelect } = renderTable([
      basePayment({ id: 'pay-3', installmentNo: 3, hasEarlierUnpaid: true }),
    ]);

    const checkbox = screen.getByRole('checkbox', { name: /เลือกงวดที่ 3/ });
    expect(checkbox).toBeDisabled();
    fireEvent.click(checkbox);
    expect(onToggleSelect).not.toHaveBeenCalled();
  });

  it('legacy rows without the flag behave as before (enabled)', () => {
    renderTable([basePayment({ id: 'pay-1', installmentNo: 1 })]);

    expect(screen.getByRole('button', { name: /รับชำระ/ })).not.toBeDisabled();
  });
});
