import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ProductPhotosPanel from '../ProductPhotosPanel';

vi.mock('@/lib/api', () => ({
  default: { get: vi.fn(), post: vi.fn(), delete: vi.fn() },
  getErrorMessage: (e: unknown) => String(e),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

import api from '@/lib/api';
import { toast } from 'sonner';

const ALL_SIX = {
  front: 'a',
  back: 'b',
  left: 'c',
  right: 'd',
  top: 'e',
  bottom: 'f',
};

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

/**
 * Fix round 3 [Minor 4] — "ยืนยันรูปครบ" ไม่ได้แปลว่าเข้าคลังเสมอไป: เครื่องรับซื้อที่ยัง
 * ไม่มีราคาขาย (autofill จากตารางราคากลางไม่ match) จะบันทึกรูปสำเร็จแต่ค้างที่
 * `PHOTO_PENDING` — หน้าจอต้องรับสัญญาณนั้นได้ ไม่ใช่บอก "เข้าคลังเรียบร้อย" ทุกกรณี
 */
describe('ProductPhotosPanel — ยืนยันรูปครบ (fix round 3)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (api.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: {
        productId: 'p-1',
        photos: ALL_SIX,
        isCompleted: false,
        completedCount: 6,
        totalCount: 6,
      },
    });
  });

  it('เข้าคลังได้ → toast สำเร็จด้วยข้อความจาก server', async () => {
    (api.post as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: {
        productId: 'p-1',
        isCompleted: true,
        status: 'IN_STOCK',
        enteredStock: true,
        needsPrice: false,
        message: 'ยืนยันรูปครบแล้ว — สินค้าเข้าคลังพร้อมขายเรียบร้อย',
      },
    });

    render(<ProductPhotosPanel productId="p-1" canEdit />, { wrapper });
    await userEvent.click(await screen.findByRole('button', { name: 'ยืนยันรูปครบ' }));

    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith(
        'ยืนยันรูปครบแล้ว — สินค้าเข้าคลังพร้อมขายเรียบร้อย',
      ),
    );
    expect(toast.warning).not.toHaveBeenCalled();
  });

  it('ยังไม่มีราคาขาย → ไม่ error แต่เตือนว่าให้ตั้งราคาก่อน (ไม่บอกว่าเข้าคลังแล้ว)', async () => {
    (api.post as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: {
        productId: 'p-1',
        isCompleted: true,
        status: 'PHOTO_PENDING',
        enteredStock: false,
        needsPrice: true,
        message: 'บันทึกรูปครบแล้ว แต่ยังไม่เข้าคลัง เพราะเครื่องนี้ยังไม่มีราคาขาย',
      },
    });

    render(<ProductPhotosPanel productId="p-1" canEdit />, { wrapper });
    await userEvent.click(await screen.findByRole('button', { name: 'ยืนยันรูปครบ' }));

    await waitFor(() =>
      expect(toast.warning).toHaveBeenCalledWith(
        'บันทึกรูปครบแล้ว แต่ยังไม่เข้าคลัง เพราะเครื่องนี้ยังไม่มีราคาขาย',
      ),
    );
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
  });
});
