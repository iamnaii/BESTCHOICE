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

/**
 * Fix round 4 [Important 1] — ปุ่ม "ยืนยันรูปครบ" ต้องไม่หายไปตราบใดที่เครื่องยังไม่เข้าคลัง
 *
 * รอบ 3 ทำให้ server เซ็ต `isCompleted = true` **ก่อน** เช็คราคา (ตั้งใจ: งานบันทึกรูป
 * ต้องสำเร็จเสมอ) แต่ปุ่มถูก render ด้วย `!isCompleted` ⇒ กดครั้งแรกแล้วปุ่มหายถาวร
 * ขณะที่ toast บอกให้ "ตั้งราคาแล้วกดยืนยันอีกครั้ง" — คำแนะนำที่ทำตามไม่ได้
 * (เครื่องเทิร์นที่ autofill ราคาไม่ match ค้าง PHOTO_PENDING เงียบ ๆ และ `SALES` ตัน)
 *
 * เงื่อนไขที่ถูกคือ "รูปครบ **และ** ยังไม่เข้าคลัง" — สัญญาณมาจาก server ทางเดียว
 * (`pendingStockEntry`) ไม่ให้หน้าจอประกอบกติกาเองจากสถานะสินค้า
 */
describe('ProductPhotosPanel — ปุ่มยืนยันรูปครบไม่หายจนกว่าจะเข้าคลัง (fix round 4)', () => {
  beforeEach(() => vi.clearAllMocks());

  const photos = (over: Record<string, unknown>) => {
    (api.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: {
        productId: 'p-1',
        photos: ALL_SIX,
        completedCount: 6,
        totalCount: 6,
        ...over,
      },
    });
  };

  it('รูปครบ + ยืนยันไปแล้ว แต่ยังค้าง PHOTO_PENDING → ปุ่มยังอยู่ (กดซ้ำได้หลังตั้งราคา)', async () => {
    photos({ isCompleted: true, pendingStockEntry: true });

    render(<ProductPhotosPanel productId="p-1" canEdit />, { wrapper });

    expect(await screen.findByRole('button', { name: 'ยืนยันรูปครบ' })).toBeTruthy();
  });

  it('เข้าคลังแล้ว → ปุ่มหาย (ยืนยันซ้ำไม่มีผล)', async () => {
    photos({ isCompleted: true, pendingStockEntry: false });

    render(<ProductPhotosPanel productId="p-1" canEdit />, { wrapper });

    await screen.findByText('ครบแล้ว');
    expect(screen.queryByRole('button', { name: 'ยืนยันรูปครบ' })).toBeNull();
  });

  it('ยังไม่เคยยืนยัน → ปุ่มอยู่ตามเดิม (พฤติกรรมเดิมไม่เปลี่ยน)', async () => {
    photos({ isCompleted: false, pendingStockEntry: true });

    render(<ProductPhotosPanel productId="p-1" canEdit />, { wrapper });

    expect(await screen.findByRole('button', { name: 'ยืนยันรูปครบ' })).toBeTruthy();
  });
});
