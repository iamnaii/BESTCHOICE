/**
 * RecallCashDialog รับ `kind` เลือก endpoint (spec 2026-09-20 §6.3 "RecallCashDialog รับ type
 * เพื่อใช้กับค่าเครื่องคืน"): RECALL → /recalls/:id/settle-cash (ป้ายเดิมทุกตัว),
 * DEVICE_RETURN → /device-returns/:id/settle-cash (ป้ายค่าเครื่องคืน). body/requestId เหมือนกัน.
 */
import { useState, type ReactNode } from 'react';
import { act, render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const apiGet = vi.fn();
const apiPost = vi.fn();
vi.mock('@/lib/api', () => ({
  default: { get: (...a: unknown[]) => apiGet(...a), post: (...a: unknown[]) => apiPost(...a) },
  getErrorMessage: (e: unknown) => String(e),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { RecallCashDialog } from '../RecallCashDialog';
import { deviceReturnToCashCandidate, recallToCashCandidate } from '../types';
import { toast } from 'sonner';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function wrapper({ children }: { children: ReactNode }) {
  const [qc] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false } } }));
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  vi.mocked(toast.success).mockClear();
  vi.mocked(toast.error).mockClear();
  apiGet.mockReset().mockResolvedValue({
    data: [
      { code: '11-1201', name: 'ธนาคาร KBank' },
      { code: 'S11-1201', name: 'ธนาคาร KBank หน้าร้าน' },
      { code: 'S11-1202', name: 'ธนาคารจ่ายหน้าร้าน' },
    ],
  });
  apiPost.mockReset().mockResolvedValue({
    data: { financeEntryNo: 'JE-1', shopEntryNo: 'SJE-1', deduped: false },
  });
});

describe('RecallCashDialog — kind', () => {
  const candidate = { contractId: 'd1', contractNumber: 'CT-0011', net: '7000.00' };
  const submit = () => screen.getByRole('button', { name: 'บันทึกรับเงินค่าเครื่องคืน' });

  it('preserves the per-open request ID and edited amount across equivalent candidate rerenders and failed retries', async () => {
    apiPost.mockRejectedValueOnce(new Error('retry'));
    const onClose = vi.fn();
    const view = render(
      <RecallCashDialog candidate={candidate} kind="DEVICE_RETURN" onClose={onClose} />,
      { wrapper },
    );
    fireEvent.change(await screen.findByLabelText(/ยอดรับเงินค่าเครื่องคืน/), {
      target: { value: '1234.56' },
    });
    fireEvent.click(submit());
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    const firstBody = apiPost.mock.calls[0][1];
    view.rerender(
      <RecallCashDialog candidate={{ ...candidate }} kind="DEVICE_RETURN" onClose={onClose} />,
    );
    expect(screen.getByLabelText(/ยอดรับเงินค่าเครื่องคืน/)).toHaveValue(1234.56);
    fireEvent.click(submit());
    await waitFor(() => expect(apiPost).toHaveBeenCalledTimes(2));
    expect(apiPost.mock.calls[1][1]).toEqual(firstBody);
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it('ignores same-tick duplicate cash submissions', async () => {
    let resolvePost!: (value: unknown) => void;
    apiPost.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvePost = resolve;
        }),
    );
    const onClose = vi.fn();
    render(<RecallCashDialog candidate={candidate} kind="DEVICE_RETURN" onClose={onClose} />, {
      wrapper,
    });
    await waitFor(() => expect(submit()).toBeEnabled());
    const button = submit();
    act(() => {
      button.click();
      button.click();
    });
    await waitFor(() => expect(apiPost).toHaveBeenCalledTimes(1));
    await act(async () => {
      resolvePost({ data: { financeEntryNo: 'JE-1', shopEntryNo: 'SJE-1', deduped: false } });
    });
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it('locks amount, accounts and every dismissal path while cash posting is pending', async () => {
    let resolvePost!: (value: unknown) => void;
    apiPost.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvePost = resolve;
        }),
    );
    const onClose = vi.fn();
    render(<RecallCashDialog candidate={candidate} kind="DEVICE_RETURN" onClose={onClose} />, {
      wrapper,
    });
    await waitFor(() =>
      expect(screen.getAllByRole('combobox').every((el) => !el.hasAttribute('disabled'))).toBe(
        true,
      ),
    );
    act(() => {
      submit().click();
      screen.getByRole('button', { name: 'ยกเลิก' }).click();
    });
    await screen.findByRole('button', { name: 'กำลังบันทึก...' });
    expect(screen.getByLabelText(/ยอดรับเงินค่าเครื่องคืน/)).toBeDisabled();
    for (const account of screen.getAllByRole('combobox')) expect(account).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'ยกเลิก' }));
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => {
      resolvePost({ data: { financeEntryNo: 'JE-1', shopEntryNo: 'SJE-1', deduped: false } });
    });
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it('does not let an old request close a replacement kind/target and uses a fresh request ID', async () => {
    let resolvePost!: (value: unknown) => void;
    apiPost.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolvePost = resolve;
        }),
    );
    const onClose = vi.fn();
    const view = render(
      <RecallCashDialog candidate={candidate} kind="DEVICE_RETURN" onClose={onClose} />,
      { wrapper },
    );
    fireEvent.click(await screen.findByRole('button', { name: 'บันทึกรับเงินค่าเครื่องคืน' }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledTimes(1));
    const firstId = apiPost.mock.calls[0][1].requestId;
    view.rerender(
      <RecallCashDialog
        candidate={{ contractId: 'r2', contractNumber: 'R-2', net: '500.00' }}
        kind="RECALL"
        onClose={onClose}
      />,
    );
    await act(async () => {
      resolvePost({ data: { financeEntryNo: 'JE-OLD', shopEntryNo: 'SJE-OLD', deduped: false } });
    });
    expect(onClose).not.toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalledWith(
      'รับเงินสดค่าเครื่องคืนสำเร็จ — ใบสำคัญ JE-OLD / SJE-OLD',
    );
    fireEvent.click(screen.getByRole('button', { name: 'บันทึกรับเงินคืน' }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledTimes(2));
    expect(apiPost.mock.calls[1][0]).toBe('/interco-settlement/recalls/r2/settle-cash');
    expect(apiPost.mock.calls[1][1]).toMatchObject({
      amount: 500,
      shopPayoutAccountCode: 'S11-1201',
    });
    expect(apiPost.mock.calls[1][1].requestId).not.toBe(firstId);
  });

  it('normalizes the correct decimal-string balance for each kind', () => {
    expect(recallToCashCandidate).toBeTypeOf('function');
    expect(deviceReturnToCashCandidate).toBeTypeOf('function');
    expect(
      recallToCashCandidate({
        contractId: 'r1',
        contractNumber: 'R-1',
        customerName: 'R',
        recallGl: '500.01',
        shopRecallGl: '500.01',
      }),
    ).toEqual({ contractId: 'r1', contractNumber: 'R-1', net: '500.01' });
    expect(
      deviceReturnToCashCandidate({
        contractId: 'd1',
        contractNumber: 'D-1',
        customerName: 'D',
        deviceReturnGl: '7000.02',
        shopDeviceReturnGl: '7000.02',
      }),
    ).toEqual({ contractId: 'd1', contractNumber: 'D-1', net: '7000.02' });
  });

  it('creates a new request ID when reopened or when only the kind changes', async () => {
    apiPost.mockRejectedValue(new Error('retry'));
    const onClose = vi.fn();
    const view = render(
      <RecallCashDialog candidate={candidate} kind="DEVICE_RETURN" onClose={onClose} />,
      { wrapper },
    );
    fireEvent.click(submit());
    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));
    view.rerender(<RecallCashDialog candidate={null} kind="DEVICE_RETURN" onClose={onClose} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    view.rerender(
      <RecallCashDialog candidate={candidate} kind="DEVICE_RETURN" onClose={onClose} />,
    );
    fireEvent.click(submit());
    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(2));
    view.rerender(<RecallCashDialog candidate={candidate} kind="RECALL" onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'บันทึกรับเงินคืน' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(3));
    const ids = apiPost.mock.calls.map(([, body]) => body.requestId);
    expect(new Set(ids).size).toBe(3);
    expect(ids.every((id) => UUID_RE.test(id))).toBe(true);
    expect(apiPost.mock.calls[2][0]).toBe('/interco-settlement/recalls/d1/settle-cash');
    expect(apiPost.mock.calls[2][1].shopPayoutAccountCode).toBe('S11-1201');
  });

  it('reports the real deduped response and closes after successful settlement', async () => {
    apiPost.mockResolvedValue({
      data: { financeEntryNo: 'JE-1', shopEntryNo: 'SJE-1', deduped: true },
    });
    const onClose = vi.fn();
    render(<RecallCashDialog candidate={candidate} kind="DEVICE_RETURN" onClose={onClose} />, {
      wrapper,
    });
    fireEvent.click(submit());
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(toast.success).toHaveBeenCalledWith('รายการนี้ถูกบันทึกไปก่อนหน้าแล้ว (ไม่บันทึกซ้ำ)');
  });
  it('DEVICE_RETURN: ป้ายค่าเครื่องคืน, ยอด default = deviceReturnGl, POST ไป /device-returns/:id/settle-cash', async () => {
    const candidate = {
      contractId: 'd1',
      contractNumber: 'CT-0011',
      customerName: 'ลูกค้า D',
      net: '7000.00',
    };
    render(<RecallCashDialog candidate={candidate} kind="DEVICE_RETURN" onClose={() => {}} />, {
      wrapper,
    });
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('รับเงินสดค่าเครื่องคืนจากหน้าร้าน')).toBeInTheDocument();
    expect(within(dialog).getByLabelText(/ยอดรับเงินค่าเครื่องคืน/)).toHaveValue(7000);
    fireEvent.click(within(dialog).getByRole('button', { name: 'บันทึกรับเงินค่าเครื่องคืน' }));
    await waitFor(() =>
      expect(apiPost).toHaveBeenCalledWith(
        '/interco-settlement/device-returns/d1/settle-cash',
        expect.objectContaining({
          amount: 7000,
          financeDepositAccountCode: '11-1201',
          shopPayoutAccountCode: 'S11-1202',
          requestId: expect.stringMatching(UUID_RE),
        }),
      ),
    );
  });

  it('RECALL: ป้ายเดิม + endpoint เดิม (byte-identical กับก่อน 2026-09-20)', async () => {
    const candidate = {
      contractId: 'r1',
      contractNumber: 'CT-0009',
      customerName: 'ลูกค้า C',
      net: '500.00',
    };
    render(<RecallCashDialog candidate={candidate} kind="RECALL" onClose={() => {}} />, {
      wrapper,
    });
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('รับเงินสดคืนจากหน้าร้าน')).toBeInTheDocument();
    expect(within(dialog).getByLabelText(/ยอดรับเงินคืน/)).toHaveValue(500);
    fireEvent.click(within(dialog).getByRole('button', { name: 'บันทึกรับเงินคืน' }));
    await waitFor(() =>
      expect(apiPost).toHaveBeenCalledWith(
        '/interco-settlement/recalls/r1/settle-cash',
        expect.objectContaining({
          amount: 500,
          financeDepositAccountCode: '11-1201',
          shopPayoutAccountCode: 'S11-1201',
        }),
      ),
    );
  });

  it.each(['DEVICE_RETURN', 'RECALL'] as const)(
    '%s: ยอดเกิน net → ข้อความ + ปุ่มปิด',
    async (kind) => {
      const candidate = {
        contractId: 'd1',
        contractNumber: 'CT-0011',
        customerName: 'ลูกค้า D',
        net: '7000.00',
      };
      render(<RecallCashDialog candidate={candidate} kind={kind} onClose={() => {}} />, {
        wrapper,
      });
      const dialog = await screen.findByRole('dialog');
      fireEvent.change(within(dialog).getByRole('spinbutton'), {
        target: { value: '7500' },
      });
      expect(
        within(dialog).getByText(
          kind === 'DEVICE_RETURN' ? /เกินค่าเครื่องคืนคงเหลือ/ : /เกินยอดเรียกคืนคงเหลือ/,
        ),
      ).toBeInTheDocument();
      expect(
        within(dialog).getByRole('button', {
          name: kind === 'DEVICE_RETURN' ? 'บันทึกรับเงินค่าเครื่องคืน' : 'บันทึกรับเงินคืน',
        }),
      ).toBeDisabled();
      expect(apiPost).not.toHaveBeenCalled();
    },
  );
});
