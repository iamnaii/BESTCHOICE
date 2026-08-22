import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import type { ReactNode } from 'react';
import StockAdjustmentsPage from '../StockAdjustmentsPage';

/**
 * Final review carry — ฟอร์มปรับสต็อกเคยไม่ส่ง `approverId` เลย ขณะที่
 * `CreateStockAdjustmentDto.approverId` เป็น `@IsNotEmpty` ⇒ **400 ทุกใบ ทุกเหตุผล**
 * ⇒ `FOUND_POLICY` (Phase 5 Task 3) ไม่เคยถูกใช้จากหน้าจอเลย และเส้นทางกู้เครื่องที่ถูก
 * soft-delete ก็เข้าไม่ถึง. เทสนี้ปักว่าฟอร์มส่งผู้อนุมัติจริง และกรองรายชื่อตามกติกา
 * ฝั่ง service (manager-tier เท่านั้น + ห้ามอนุมัติตัวเอง)
 */

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const apiGet = vi.fn();
const apiPost = vi.fn();
vi.mock('@/lib/api', () => ({
  __esModule: true,
  default: {
    get: (...args: unknown[]) => apiGet(...args),
    post: (...args: unknown[]) => apiPost(...args),
  },
  getErrorMessage: (err: unknown) =>
    err && typeof err === 'object' && 'message' in err ? String((err as Error).message) : 'unknown',
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'me-owner', role: 'OWNER', branchId: null },
    isLoading: false,
    isAuthenticated: true,
  }),
}));

const APPROVERS = [
  { id: 'me-owner', name: 'ฉันเอง', role: 'OWNER' },
  { id: 'u-bm', name: 'ผจก.สาขา ลาดพร้าว', role: 'BRANCH_MANAGER' },
  { id: 'u-fm', name: 'ผจก.การเงิน', role: 'FINANCE_MANAGER' },
  { id: 'u-acc', name: 'ฝ่ายบัญชี', role: 'ACCOUNTANT' },
];

beforeEach(() => {
  apiGet.mockReset();
  apiPost.mockReset();
  apiPost.mockResolvedValue({ data: { id: 'adj-1' } });
  apiGet.mockImplementation(async (url: string) => {
    if (url === '/branches') return { data: [] };
    if (url === '/users/approvers') return { data: APPROVERS };
    if (url === '/stock-adjustments') {
      return { data: { data: [], total: 0, page: 1, totalPages: 1 } };
    }
    if (url === '/stock-adjustments/summary') {
      return { data: { byReason: {}, totalCount: 0, totalValue: 0 } };
    }
    if (url === '/products/stock') {
      return {
        data: {
          products: [
            {
              id: 'p1',
              name: 'iPhone',
              brand: 'Apple',
              model: '13',
              imeiSerial: '3591',
              status: 'LOST',
            },
          ],
        },
      };
    }
    return { data: {} };
  });
});

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
}

async function openModal() {
  render(<StockAdjustmentsPage />, { wrapper });
  await userEvent.click(await screen.findByRole('button', { name: '+ ปรับสต็อก' }));
}

describe('StockAdjustmentsPage — ช่องผู้อนุมัติ (carry: ฟอร์มตาย 400 มาก่อน)', () => {
  it('มี dropdown ผู้อนุมัติที่โหลดจาก /users/approvers', async () => {
    await openModal();
    await waitFor(() => expect(apiGet).toHaveBeenCalledWith('/users/approvers'));
    expect(await screen.findByLabelText(/ผู้อนุมัติ/)).toBeTruthy();
  });

  it('ตัดตัวเองออก (SoD) และตัด ACCOUNTANT ออก (service รับแค่ OWNER/FM/BM)', async () => {
    await openModal();
    const select = (await screen.findByLabelText(/ผู้อนุมัติ/)) as HTMLSelectElement;
    const values = Array.from(select.options).map((o) => o.value);

    expect(values).toContain('u-bm');
    expect(values).toContain('u-fm');
    expect(values).not.toContain('me-owner');
    expect(values).not.toContain('u-acc');
  });

  it('ยังไม่เลือกผู้อนุมัติ → ปุ่มบันทึกกดไม่ได้ (ไม่ยิงคำขอที่ต้อง 400 แน่ ๆ)', async () => {
    await openModal();
    await userEvent.type(screen.getByPlaceholderText(/พิมพ์ชื่อ, ยี่ห้อ, รุ่น, IMEI/), 'iPhone');
    await userEvent.click(await screen.findByRole('button', { name: /Apple 13/ }));

    expect((screen.getByRole('button', { name: 'บันทึก' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it('เลือกสินค้า + ผู้อนุมัติ + เหตุผล "พบเพิ่ม" → POST พร้อม approverId จริง', async () => {
    await openModal();
    await userEvent.type(screen.getByPlaceholderText(/พิมพ์ชื่อ, ยี่ห้อ, รุ่น, IMEI/), 'iPhone');
    await userEvent.click(await screen.findByRole('button', { name: /Apple 13/ }));
    await userEvent.selectOptions(await screen.findByLabelText(/ผู้อนุมัติ/), 'u-bm');
    await userEvent.selectOptions(screen.getByLabelText(/สาเหตุ/), 'FOUND');
    await userEvent.click(screen.getByRole('button', { name: 'บันทึก' }));

    await waitFor(() => expect(apiPost).toHaveBeenCalled());
    expect(apiPost).toHaveBeenCalledWith(
      '/stock-adjustments',
      expect.objectContaining({ productId: 'p1', reason: 'FOUND', approverId: 'u-bm' }),
    );
  });

  // เหตุผล DAMAGED บังคับแนบรูปฝั่ง service (T5-C14) แต่หน้านี้ไม่มีช่องแนบรูป ⇒
  // ห้ามปล่อยให้เลือกแล้วไปตาย 400 (บทเรียน "ห้ามชี้ทางที่ไม่มีจริง" ของเฟสนี้)
  it('เหตุผล "เสียหาย" ถูกปิดไว้พร้อมบอกเหตุผล (ยังไม่มีช่องแนบรูปหลักฐาน)', async () => {
    await openModal();
    const reason = (await screen.findByLabelText(/สาเหตุ/)) as HTMLSelectElement;
    const damaged = Array.from(reason.options).find((o) => o.value === 'DAMAGED');

    expect(damaged?.disabled).toBe(true);
    expect(damaged?.textContent).toMatch(/แนบรูป/);
    expect(reason.value).not.toBe('DAMAGED');
  });
});
