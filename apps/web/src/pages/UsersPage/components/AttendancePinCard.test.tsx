import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AttendancePinCard from './AttendancePinCard';

/** ก้อน 10 D3 Task 10 — การ์ด "รหัสตอกบัตร" บนหน้าผู้ใช้ (OWNER): รีเซ็ต → แสดงรหัสครั้งเดียว · ไม่ refetch users.detail (กันทับฟอร์มที่แก้ค้าง) */
const apiMock = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() }));
vi.mock('@/lib/api', () => ({ default: apiMock, getErrorMessage: (e: unknown) => (e as Error)?.message ?? String(e) }));
const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn(), message: vi.fn() }));
vi.mock('sonner', () => ({ toast: toastMock }));

function wrap(hasPin: boolean) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const invalidate = vi.spyOn(qc, 'invalidateQueries');
  render(<QueryClientProvider client={qc}><AttendancePinCard userId="u1" userName="วรรณา ส." hasPin={hasPin} /></QueryClientProvider>);
  return { invalidate };
}

beforeEach(() => {
  vi.clearAllMocks();
  apiMock.post.mockResolvedValue({ data: { pin: '483921' } });
});

describe('AttendancePinCard', () => {
  it('P1 reset → POST /users/:id/attendance-pin/reset, shows the pin once with "แสดงครั้งเดียว", never invalidates users.detail', async () => {
    const { invalidate } = wrap(false);
    expect(screen.getByText(/ยังไม่มีรหัส/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /ตั้งรหัสตอกบัตร/ }));
    await screen.findByText('483921');
    expect(apiMock.post).toHaveBeenCalledWith('/users/u1/attendance-pin/reset');
    expect(screen.getByText(/แสดงครั้งเดียว/)).toBeInTheDocument();
    expect(invalidate).not.toHaveBeenCalledWith(expect.objectContaining({ queryKey: expect.arrayContaining(['users']) }));
  });

  it('P2 with an existing pin the action is "รีเซ็ตรหัส" and asks for confirmation first', async () => {
    wrap(true);
    expect(screen.getByText(/มีรหัสแล้ว/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /รีเซ็ตรหัส/ }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(screen.getByRole('button', { name: /^รีเซ็ต$/ }));
    await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith('/users/u1/attendance-pin/reset'));
    expect(dialog).not.toBeInTheDocument();
    await screen.findByText('483921');
  });
});
