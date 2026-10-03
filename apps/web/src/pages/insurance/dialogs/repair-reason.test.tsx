import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import api from '@/lib/api';
import { toast } from 'sonner';
import { CancelDialog } from './CancelDialog';
import { SendBackDialog } from './SendBackDialog';

vi.mock('@/lib/api', async (original) => ({
  ...(await original<typeof import('@/lib/api')>()),
  default: { post: vi.fn() },
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(api.post).mockResolvedValue({ data: {} });
});

describe.each([
  {
    Dialog: CancelDialog,
    action: 'cancel',
    submit: 'ยืนยันยกเลิก',
    close: 'ปิด',
    success: 'ยกเลิกตั๋วแล้ว',
  },
  {
    Dialog: SendBackDialog,
    action: 'send-back',
    submit: 'ส่งซ่อมต่อ',
    close: 'ยกเลิก',
    success: 'ส่งซ่อมต่อแล้ว',
  },
])('$action repair ticket', ({ Dialog, action, submit, close, success }) => {
  function setup() {
    const calls: string[] = [];
    const onClose = vi.fn(() => {
      calls.push('close');
    });
    const onSuccess = vi.fn(() => {
      calls.push('success');
    });
    const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <Dialog ticketId="ticket-1" onClose={onClose} onSuccess={onSuccess} />
      </QueryClientProvider>,
    );
    return { calls, onClose, onSuccess };
  }

  it('requires five characters and sends the exact reason to its own endpoint', async () => {
    const { calls } = setup();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '1234' } });
    fireEvent.click(screen.getByRole('button', { name: submit }));
    await screen.findByText('กรุณาระบุเหตุผลอย่างน้อย 5 ตัวอักษร');
    expect(api.post).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '12345' } });
    fireEvent.click(screen.getByRole('button', { name: submit }));
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith(`/repair-tickets/ticket-1/${action}`, {
        note: '12345',
      }),
    );
    await waitFor(() => expect(calls).toEqual(['success', 'close']));
    expect(toast.success).toHaveBeenCalledWith(success);
    expect(screen.getByRole('button', { name: submit }).className.includes('bg-destructive')).toBe(
      action === 'cancel',
    );
  });

  it('disables repeat submission while the request is pending', async () => {
    let complete!: (value: { data: object }) => void;
    vi.mocked(api.post).mockReturnValue(
      new Promise((resolve) => {
        complete = resolve;
      }),
    );
    const { onSuccess } = setup();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'เหตุผลทดสอบ' } });
    fireEvent.click(screen.getByRole('button', { name: submit }));
    const pending = await screen.findByRole('button', { name: 'กำลังบันทึก...' });
    expect(pending).toBeDisabled();
    fireEvent.click(pending);
    expect(api.post).toHaveBeenCalledTimes(1);
    expect(onSuccess).not.toHaveBeenCalled();
    await act(async () => complete({ data: {} }));
    await waitFor(() => expect(onSuccess).toHaveBeenCalledOnce());
  });

  it('retains the reason on failure and allows retry without closing', async () => {
    vi.mocked(api.post).mockRejectedValueOnce(new Error('บันทึกไม่สำเร็จ'));
    const { onClose, onSuccess } = setup();
    const note = ' เหตุผลทดสอบ ';
    fireEvent.change(screen.getByRole('textbox'), { target: { value: note } });
    fireEvent.click(screen.getByRole('button', { name: submit }));
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(screen.getByRole('textbox')).toHaveValue(note);
    expect(onClose).not.toHaveBeenCalled();
    expect(onSuccess).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: submit }));
    await waitFor(() => expect(onSuccess).toHaveBeenCalledOnce());
    expect(api.post).toHaveBeenLastCalledWith(`/repair-tickets/ticket-1/${action}`, { note });
  });

  it('closes without saving when dismissed', () => {
    const { onClose, onSuccess } = setup();
    fireEvent.click(screen.getByRole('button', { name: close }));
    expect(onClose).toHaveBeenCalledOnce();
    expect(onSuccess).not.toHaveBeenCalled();
    expect(api.post).not.toHaveBeenCalled();
  });
});
