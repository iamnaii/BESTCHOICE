import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ReceiptVoidDialog from '../ReceiptVoidDialog';

/**
 * Regression: PR #780 (ปพพ.386 Wave 3 T2) made `approvedById` required on
 * POST /receipts/:id/void, but this dialog kept sending only { reason } —
 * every void 400'd with "กรุณาระบุผู้อนุมัติการยกเลิก" and there was no field
 * to fill. The dialog must collect an independent approver (SoD) and send it.
 */

const apiGet = vi.fn();
const apiPost = vi.fn();

vi.mock('@/lib/api', () => ({
  default: {
    get: (...args: unknown[]) => apiGet(...args),
    post: (...args: unknown[]) => apiPost(...args),
  },
  getErrorMessage: (e: unknown) => String(e),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'u-me', name: 'ฉันเอง', role: 'ACCOUNTANT' },
    isLoading: false,
    isAuthenticated: true,
  }),
}));

const APPROVERS = [
  { id: 'u-me', name: 'ฉันเอง', role: 'ACCOUNTANT' },
  { id: 'u-boss', name: 'เจ้าของร้าน', role: 'OWNER' },
];

function wrap(ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>;
}

beforeEach(() => {
  vi.clearAllMocks();
  apiGet.mockResolvedValue({ data: APPROVERS });
  apiPost.mockResolvedValue({ data: { creditNote: { id: 'cn-1' } } });
});

describe('ReceiptVoidDialog — SoD approver field', () => {
  it('loads approvers from /users/approvers and excludes the current user (SoD)', async () => {
    render(wrap(<ReceiptVoidDialog receiptId="r-1" receiptNumber="RT-202607-00007" onClose={vi.fn()} />));

    await waitFor(() => expect(apiGet).toHaveBeenCalledWith('/users/approvers'));

    const select = await screen.findByLabelText(/ผู้อนุมัติการยกเลิก/);
    const options = Array.from((select as HTMLSelectElement).options).map((o) => o.value);
    expect(options).toContain('u-boss');
    expect(options).not.toContain('u-me');
  });

  it('keeps ยืนยันยกเลิก disabled until BOTH reason and approver are filled', async () => {
    render(wrap(<ReceiptVoidDialog receiptId="r-1" onClose={vi.fn()} />));

    const submit = screen.getByRole('button', { name: 'ยืนยันยกเลิก' });
    expect(submit).toBeDisabled();

    fireEvent.change(screen.getByPlaceholderText(/ลูกค้าโอนผิดบัญชี/), {
      target: { value: 'บันทึกผิด' },
    });
    expect(submit).toBeDisabled(); // reason alone is not enough

    // Wait for the approver options to load — a native <select> silently
    // ignores a change to a value that has no matching <option> yet.
    await screen.findByRole('option', { name: /เจ้าของร้าน/ });
    fireEvent.change(screen.getByLabelText(/ผู้อนุมัติการยกเลิก/), {
      target: { value: 'u-boss' },
    });
    expect(submit).not.toBeDisabled();
  });

  it('POSTs reason + approvedById to /receipts/:id/void', async () => {
    const onClose = vi.fn();
    render(wrap(<ReceiptVoidDialog receiptId="r-1" onClose={onClose} />));

    fireEvent.change(screen.getByPlaceholderText(/ลูกค้าโอนผิดบัญชี/), {
      target: { value: 'บันทึกผิด' },
    });
    await screen.findByRole('option', { name: /เจ้าของร้าน/ });
    fireEvent.change(screen.getByLabelText(/ผู้อนุมัติการยกเลิก/), {
      target: { value: 'u-boss' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'ยืนยันยกเลิก' }));

    await waitFor(() =>
      expect(apiPost).toHaveBeenCalledWith('/receipts/r-1/void', {
        reason: 'บันทึกผิด',
        approvedById: 'u-boss',
      }),
    );
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('warns when there is no eligible approver (only the current user has a manager role)', async () => {
    apiGet.mockResolvedValue({ data: [{ id: 'u-me', name: 'ฉันเอง', role: 'ACCOUNTANT' }] });
    render(wrap(<ReceiptVoidDialog receiptId="r-1" onClose={vi.fn()} />));

    expect(await screen.findByText(/ไม่มีผู้อนุมัติที่ใช้ได้/)).toBeInTheDocument();
  });

  it('shows a loading hint (NOT the no-approver warning) while the list is fetching', async () => {
    let resolve!: (v: { data: typeof APPROVERS }) => void;
    apiGet.mockReturnValue(new Promise((r) => (resolve = r)));
    render(wrap(<ReceiptVoidDialog receiptId="r-1" onClose={vi.fn()} />));

    expect(screen.getByText(/กำลังโหลดรายชื่อผู้อนุมัติ/)).toBeInTheDocument();
    expect(screen.queryByText(/ไม่มีผู้อนุมัติที่ใช้ได้/)).not.toBeInTheDocument();

    resolve({ data: APPROVERS });
    await screen.findByRole('option', { name: /เจ้าของร้าน/ });
  });

  it('invalidates payment queues + summaries so the un-paid installment reappears (2026-07-08)', async () => {
    // Void now un-pays the installment server-side. The stale-cache regression:
    // with only ['receipts'/'contract-receipts'/'contract-payments'] invalidated,
    // the pending queue (['pending-payments']), the ชำระครบ tab (['paid-payments']),
    // the KPI tiles (['pending-summary'/'daily-summary']) and the JE panel
    // (['contract-journal-entries']) all kept showing the installment as paid.
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    render(
      <QueryClientProvider client={queryClient}>
        <ReceiptVoidDialog receiptId="r-1" onClose={vi.fn()} />
      </QueryClientProvider>,
    );

    fireEvent.change(screen.getByPlaceholderText(/ลูกค้าโอนผิดบัญชี/), {
      target: { value: 'บันทึกผิด' },
    });
    await screen.findByRole('option', { name: /เจ้าของร้าน/ });
    fireEvent.change(screen.getByLabelText(/ผู้อนุมัติการยกเลิก/), {
      target: { value: 'u-boss' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'ยืนยันยกเลิก' }));
    await waitFor(() => expect(apiPost).toHaveBeenCalled());

    const invalidatedKeys = invalidateSpy.mock.calls.map(
      (c) => (c[0] as { queryKey?: unknown[] } | undefined)?.queryKey?.[0],
    );
    for (const key of [
      'receipts',
      'contract-receipts',
      'contract-payments',
      'contract-journal-entries',
      'pending-payments',
      'paid-payments',
      'pending-summary',
      'daily-summary',
    ]) {
      expect(invalidatedKeys).toContain(key);
    }
  });

  it('resets stale reason/approver when the dialog is reopened for a different receipt', async () => {
    // Parents close via setVoidTarget(null) — an external controlled-prop
    // flip Radix does NOT report through onOpenChange — so the reset must
    // happen on receiptId change, or RT-A's reason+approver survive into
    // RT-B's void and ยืนยันยกเลิก is instantly clickable.
    const { rerender } = render(wrap(<ReceiptVoidDialog receiptId="r-1" onClose={vi.fn()} />));

    fireEvent.change(screen.getByPlaceholderText(/ลูกค้าโอนผิดบัญชี/), {
      target: { value: 'เหตุผลของใบแรก' },
    });
    await screen.findByRole('option', { name: /เจ้าของร้าน/ });
    fireEvent.change(screen.getByLabelText(/ผู้อนุมัติการยกเลิก/), {
      target: { value: 'u-boss' },
    });

    rerender(wrap(<ReceiptVoidDialog receiptId={null} onClose={vi.fn()} />));
    rerender(wrap(<ReceiptVoidDialog receiptId="r-2" onClose={vi.fn()} />));

    expect(screen.getByPlaceholderText(/ลูกค้าโอนผิดบัญชี/)).toHaveValue('');
    expect(screen.getByLabelText(/ผู้อนุมัติการยกเลิก/)).toHaveValue('');
    expect(screen.getByRole('button', { name: 'ยืนยันยกเลิก' })).toBeDisabled();
  });
});
