/**
 * dialog "ส่งกลับใบรับเครื่องคืน" (spec 2026-09-20 §5.3): เหตุผล 10–500 ตัวอักษร →
 * POST /device-returns/:id/reject — ใช้ร่วมกันโดยตาราง "รอ FINANCE ยืนยัน" และ overlay โหมดยืนยัน.
 */
import type { ReactNode } from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const apiPost = vi.fn();
vi.mock('@/lib/api', () => ({
  default: { get: vi.fn(), post: (...a: unknown[]) => apiPost(...a) },
  getErrorMessage: (e: unknown) => String(e),
}));
const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock('sonner', async (importOriginal) => {
  const actual = await importOriginal<typeof import('sonner')>();
  return {
    ...actual,
    toast: {
      ...actual.toast,
      success: (...a: Parameters<typeof actual.toast.success>) => {
        toastSuccess(...a);
        return actual.toast.success(...a);
      },
      error: (...a: unknown[]) => toastError(...a),
    },
  };
});

import { RejectDeviceReturnDialog } from '../RejectDeviceReturnDialog';
import { toast, Toaster } from 'sonner';

const target = {
  id: 'dr-1',
  docNumber: 'DR-20260920-0001',
  returnKind: 'VOLUNTARY' as const,
  contract: {
    id: 'c-1',
    contractNumber: 'TEST-20260920-001',
    status: 'TERMINATED',
    customer: { id: 'cu1', name: 'สมชาย ใจดี' },
    product: { id: 'p1', brand: 'Apple', model: 'iPhone 14', imeiSerial: null },
  },
};

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  toast.dismiss();
  apiPost.mockReset().mockResolvedValue({
    data: {
      ...target,
      status: 'REJECTED',
      contract: { ...target.contract, status: 'ACTIVE' },
      notice: null,
    },
  });
  toastSuccess.mockReset();
  toastError.mockReset();
});

describe('RejectDeviceReturnDialog', () => {
  it('describes a cancellation notification without promising contract continuation', () => {
    render(<RejectDeviceReturnDialog target={target} onClose={() => {}} />, { wrapper });
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('ลูกค้าจะได้รับไลน์แจ้งว่าใบถูกยกเลิก');
    expect(dialog).not.toHaveTextContent('สัญญาเดินต่อ');
  });

  it('renders the returned cross-month notice after rejecting', async () => {
    const notice = 'ใบนี้ข้ามเดือน — ให้ OWNER เปิดงวดใหม่ผ่าน PERIOD_REOPENED ก่อน';
    apiPost.mockResolvedValueOnce({
      data: {
        ...target,
        status: 'REJECTED',
        contract: { ...target.contract, status: 'ACTIVE' },
        notice,
      },
    });
    render(
      <>
        <RejectDeviceReturnDialog target={target} onClose={() => {}} />
        <Toaster />
      </>,
      { wrapper },
    );
    fireEvent.change(screen.getByLabelText(/เหตุผลที่ส่งกลับ/), {
      target: { value: 'ราคาประเมินไม่ถูกต้อง' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'ยืนยันส่งกลับ' }));
    expect(await screen.findByText(notice)).toBeInTheDocument();
  });

  it('does not promise restoration when rejection returns an independently closed contract', async () => {
    apiPost.mockResolvedValueOnce({
      data: {
        ...target,
        status: 'REJECTED',
        contract: { ...target.contract, status: 'COMPLETED' },
        notice: null,
      },
    });
    render(<RejectDeviceReturnDialog target={target} onClose={() => {}} />, { wrapper });
    fireEvent.change(screen.getByLabelText(/เหตุผลที่ส่งกลับ/), {
      target: { value: 'ราคาประเมินไม่ถูกต้อง' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'ยืนยันส่งกลับ' }));
    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith(`ส่งกลับใบ ${target.docNumber} แล้ว`, {
        description: undefined,
      }),
    );
  });

  it('ไม่ render อะไรเมื่อ target = null', () => {
    render(<RejectDeviceReturnDialog target={null} onClose={() => {}} />, { wrapper });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('เหตุผลสั้นกว่า 10 ตัวอักษร → ปุ่มปิด + ข้อความเตือน; ครบแล้ว POST reject → toast + onRejected + onClose', async () => {
    const onClose = vi.fn();
    const onRejected = vi.fn();
    render(<RejectDeviceReturnDialog target={target} onClose={onClose} onRejected={onRejected} />, {
      wrapper,
    });
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('DR-20260920-0001');
    const submit = screen.getByRole('button', { name: 'ยืนยันส่งกลับ' });
    expect(submit).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/เหตุผลที่ส่งกลับ/), { target: { value: 'สั้นไป' } });
    expect(screen.getByText(/ต้องอย่างน้อย 10 ตัวอักษร/)).toBeInTheDocument();
    expect(submit).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/เหตุผลที่ส่งกลับ/), {
      target: { value: 'ราคาประเมินไม่สอดคล้องกับสภาพเครื่อง' },
    });
    expect(submit).toBeEnabled();
    fireEvent.click(submit);

    await waitFor(() =>
      expect(apiPost).toHaveBeenCalledWith('/device-returns/dr-1/reject', {
        reason: 'ราคาประเมินไม่สอดคล้องกับสภาพเครื่อง',
      }),
    );
    await waitFor(() => expect(onRejected).toHaveBeenCalled());
    expect(onClose).toHaveBeenCalled();
    expect(toastSuccess).toHaveBeenCalledWith(
      `ส่งกลับใบ ${target.docNumber} แล้ว`,
      expect.anything(),
    );
  });

  it('ใบยึดเครื่อง (REPOSSESSION) → toast ยืนยันส่งกลับ', async () => {
    apiPost.mockResolvedValueOnce({
      data: { ...target, returnKind: 'REPOSSESSION', status: 'REJECTED', notice: null },
    });
    render(
      <RejectDeviceReturnDialog
        target={{ ...target, returnKind: 'REPOSSESSION' }}
        onClose={() => {}}
      />,
      { wrapper },
    );
    expect(screen.getByRole('dialog')).toHaveTextContent('ลูกค้าจะได้รับไลน์แจ้งว่าใบถูกยกเลิก');
    expect(screen.getByRole('dialog')).not.toHaveTextContent('สัญญาเดินต่อ');
    fireEvent.change(await screen.findByLabelText(/เหตุผลที่ส่งกลับ/), {
      target: { value: 'ใบผิดสัญญา ต้องบันทึกใหม่' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'ยืนยันส่งกลับ' }));
    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith(
        `ส่งกลับใบ ${target.docNumber} แล้ว`,
        expect.anything(),
      ),
    );
  });

  it('validates trimmed boundaries and sends trimmed reason', async () => {
    render(<RejectDeviceReturnDialog target={target} onClose={() => {}} />, { wrapper });
    const input = screen.getByLabelText(/เหตุผลที่ส่งกลับ/);
    const submit = screen.getByRole('button', { name: 'ยืนยันส่งกลับ' });
    expect(input).toHaveAttribute('maxlength', '500');
    for (const value of [' '.repeat(10), 'a'.repeat(9), 'a'.repeat(501)]) {
      fireEvent.change(input, { target: { value } });
      expect(submit).toBeDisabled();
    }
    for (const value of ['a'.repeat(10), 'a'.repeat(500)]) {
      fireEvent.change(input, { target: { value } });
      expect(submit).toBeEnabled();
    }
    fireEvent.change(input, { target: { value: '  ราคาประเมินไม่ถูกต้อง  ' } });
    fireEvent.click(submit);
    await waitFor(() =>
      expect(apiPost).toHaveBeenCalledWith('/device-returns/dr-1/reject', {
        reason: 'ราคาประเมินไม่ถูกต้อง',
      }),
    );
  });

  it('preserves edits when the same record refreshes and clears on switching or reopening', () => {
    const props = { target, onClose: vi.fn() };
    const { rerender } = render(<RejectDeviceReturnDialog {...props} />, { wrapper });
    fireEvent.change(screen.getByLabelText(/เหตุผลที่ส่งกลับ/), {
      target: { value: 'ราคาประเมินไม่ถูกต้อง' },
    });
    rerender(<RejectDeviceReturnDialog {...props} target={{ ...target }} />);
    expect(screen.getByLabelText(/เหตุผลที่ส่งกลับ/)).toHaveValue('ราคาประเมินไม่ถูกต้อง');
    rerender(<RejectDeviceReturnDialog {...props} target={{ ...target, id: 'dr-2' }} />);
    expect(screen.getByLabelText(/เหตุผลที่ส่งกลับ/)).toHaveValue('');
    fireEvent.change(screen.getByLabelText(/เหตุผลที่ส่งกลับ/), {
      target: { value: 'ราคาประเมินไม่ถูกต้อง' },
    });
    rerender(<RejectDeviceReturnDialog {...props} target={null} />);
    rerender(<RejectDeviceReturnDialog {...props} target={{ ...target, id: 'dr-2' }} />);
    expect(screen.getByLabelText(/เหตุผลที่ส่งกลับ/)).toHaveValue('');
  });

  it('locks pending input and dismissal, prevents duplicate sends, and retains reason for retry on error', async () => {
    let reject!: (error: Error) => void;
    apiPost.mockImplementationOnce(
      () =>
        new Promise((_resolve, rejectPromise) => {
          reject = rejectPromise;
        }),
    );
    const onClose = vi.fn();
    const onRejected = vi.fn();
    render(<RejectDeviceReturnDialog target={target} onClose={onClose} onRejected={onRejected} />, {
      wrapper,
    });
    const input = screen.getByLabelText(/เหตุผลที่ส่งกลับ/);
    fireEvent.change(input, { target: { value: 'ราคาประเมินไม่ถูกต้อง' } });
    const submit = screen.getByRole('button', { name: 'ยืนยันส่งกลับ' });
    fireEvent.click(submit);
    fireEvent.click(submit);
    await waitFor(() => expect(input).toBeDisabled());
    expect(screen.getByRole('button', { name: 'ยกเลิก' })).toBeDisabled();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape', code: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
    expect(apiPost).toHaveBeenCalledTimes(1);
    await act(async () => reject(new Error('ส่งกลับไม่สำเร็จ')));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Error: ส่งกลับไม่สำเร็จ'));
    expect(input).toHaveValue('ราคาประเมินไม่ถูกต้อง');
    expect(input).toBeEnabled();
    expect(onRejected).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'ยืนยันส่งกลับ' }));
    await waitFor(() => expect(onRejected).toHaveBeenCalledOnce());
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('uses submitted record for completion and invalidation after target changes without closing the new record', async () => {
    let resolve!: (value: unknown) => void;
    apiPost.mockImplementationOnce(
      () =>
        new Promise((resolvePromise) => {
          resolve = resolvePromise;
        }),
    );
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidate = vi.spyOn(qc, 'invalidateQueries');
    const onClose = vi.fn();
    const onRejected = vi.fn();
    const { rerender } = render(
      <RejectDeviceReturnDialog target={target} onClose={onClose} onRejected={onRejected} />,
      {
        wrapper: ({ children }) => (
          <QueryClientProvider client={qc}>{children}</QueryClientProvider>
        ),
      },
    );
    fireEvent.change(screen.getByLabelText(/เหตุผลที่ส่งกลับ/), {
      target: { value: 'ราคาประเมินไม่ถูกต้อง' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'ยืนยันส่งกลับ' }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledOnce());
    rerender(
      <RejectDeviceReturnDialog
        target={{
          ...target,
          id: 'dr-2',
          docNumber: 'DR-2',
          returnKind: 'REPOSSESSION',
          contract: { ...target.contract, id: 'c-2' },
        }}
        onClose={onClose}
        onRejected={onRejected}
      />,
    );
    await act(async () =>
      resolve({
        data: {
          ...target,
          status: 'REJECTED',
          contract: { ...target.contract, status: 'ACTIVE' },
          notice: null,
        },
      }),
    );
    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith(
        expect.stringContaining('DR-20260920-0001'),
        expect.anything(),
      ),
    );
    expect(toastSuccess).toHaveBeenCalledWith(
      `ส่งกลับใบ ${target.docNumber} แล้ว`,
      expect.anything(),
    );
    for (const queryKey of [
      ['device-returns'],
      ['contracts'],
      ['contract', 'c-1'],
      ['customer-tags'],
    ]) {
      expect(invalidate).toHaveBeenCalledWith({ queryKey });
    }
    expect(onRejected).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
});
