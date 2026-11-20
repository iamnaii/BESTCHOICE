import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const apiGet = vi.fn();
const apiPost = vi.fn();
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  default: { get: (...a: unknown[]) => apiGet(...a), post: (...a: unknown[]) => apiPost(...a), patch: vi.fn(), delete: vi.fn() },
}));
const importFromExcel = vi.fn();
vi.mock('@/utils/excel.util', () => ({
  importFromExcel: (...a: unknown[]) => importFromExcel(...a),
  downloadExcelBuffer: vi.fn(),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
import { toast } from 'sonner';
import { MaxPricesTab } from '../MaxPricesTab';

function Wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  vi.mocked(toast.success).mockClear();
  vi.mocked(toast.error).mockClear();
  apiGet.mockReset().mockResolvedValue({
    data: [
      { id: 'old', gfinSeries: 'iPhone 14', gfinVariant: 'Pro', storage: '128GB', condition: 'HAND_2', maxPrice: '18900.00', modelMatchPattern: 'iPhone 14 Pro', isActive: true, updatedAt: '2026-10-16T00:00:00Z' },
    ],
  });
  apiPost.mockReset().mockResolvedValue({ data: { created: 1, updated: 0, unchanged: 0 } });
  importFromExcel.mockReset().mockResolvedValue([
    { 'รุ่น': 'iPhone 18 Pro', 'ความจุ': '256GB', 'มือ 1/มือ 2': 'มือ 1', 'ราคา': 48900 },
  ]);
});

describe('MaxPricesTab — นำเข้าใบราคา', () => {
  it('อ่านไฟล์ → หน้าตรวจพร้อมคำเตือนแถวรูปแบบเก่า → ยืนยันแล้วส่งรายการ', async () => {
    const { container } = render(<Wrapper><MaxPricesTab /></Wrapper>);
    await screen.findByText('iPhone 14');
    fireEvent.change(container.querySelector('input[type="file"]') as HTMLInputElement, {
      target: { files: [new File(['x'], 'gfin.xlsx')] },
    });
    expect(await screen.findByText('ตรวจรายการก่อนยืนยัน — เพิ่ม 1 · แก้ 0 · ข้าม 0 แถว')).toBeInTheDocument();
    expect(screen.getByText(/มีแถวเดิม 1 แถวที่ตั้งชื่อแบบรุ่นหลัก \+ รุ่นย่อย/)).toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'ยืนยันนำเข้า' }));
    await waitFor(() =>
      expect(apiPost).toHaveBeenCalledWith('/gfin-config/max-prices/import', {
        items: [{ model: 'iPhone 18 Pro', storage: '256GB', condition: 'HAND_1', maxPrice: 48900 }],
      }),
    );
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('นำเข้าใบราคาแล้ว — เพิ่ม 1 · แก้ 0 · เท่าเดิม 0 แถว'));
  });

  it('ชุดที่ 2 ล้ม → แสดงข้อความที่บอกจำนวนแถวที่บันทึกแล้ว', async () => {
    importFromExcel.mockResolvedValue(
      Array.from({ length: 101 }, (_, i) => ({ 'รุ่น': `iPhone ${i}`, 'ความจุ': '128GB', 'มือ 1/มือ 2': 'มือ 2', 'ราคา': 10000 + i })),
    );
    apiPost
      .mockResolvedValueOnce({ data: { created: 100, updated: 0, unchanged: 0 } })
      .mockRejectedValueOnce({ response: { status: 400, data: { message: 'รุ่นซ้ำในไฟล์' } } });
    const { container } = render(<Wrapper><MaxPricesTab /></Wrapper>);
    await screen.findByText('iPhone 14');
    fireEvent.change(container.querySelector('input[type="file"]') as HTMLInputElement, {
      target: { files: [new File(['x'], 'gfin.xlsx')] },
    });
    await userEvent.click(await screen.findByRole('button', { name: 'ยืนยันนำเข้า' }));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('ชุดที่ 2 ส่งไม่สำเร็จ (รุ่นซ้ำในไฟล์) — บันทึกแล้ว 100 แถวจากชุดก่อนหน้า'),
    );
  });
});
