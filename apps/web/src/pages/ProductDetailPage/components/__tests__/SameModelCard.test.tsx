import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import SameModelCard from '../SameModelCard';
import ActivePromotionsCard from '../ActivePromotionsCard';

// `apiGet` ถูกอ้างถึงเฉพาะ "ตอนเรียก" (ข้างใน arrow) ไม่ใช่ตอน factory ทำงาน
// → ไม่ชน TDZ ของ vi.mock ที่ถูก hoist (pattern เดียวกับ
// components/accounting/__tests__/InternalControlActionBar.test.tsx:32-36)
const apiGet = vi.fn();
vi.mock('@/lib/api', () => ({
  default: { get: (...args: unknown[]) => apiGet(...args) },
  getErrorMessage: () => 'error',
}));

const wrap = (ui: React.ReactElement, client?: QueryClient) => (
  <QueryClientProvider client={client ?? new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter>{ui}</MemoryRouter>
  </QueryClientProvider>
);

// ต้องมี braces — arrow แบบไม่มี braces จะ return ตัว mock (mockReset คืน instance
// ไว้ chain) แล้ว vitest ถือ return value ของ beforeEach เป็น cleanup fn → เรียก
// apiGet() เปล่าๆ หลังจบเทสต์ → เทสต์ที่ mockRejectedValue จะ fail ด้วย error ของ
// ตัวเองตอน vitest await cleanup (บั๊กเดียวกับ "zero-arg call" ใน useCustomerSummary.test)
beforeEach(() => {
  apiGet.mockReset();
});

describe('SameModelCard', () => {
  it('เรียก /products ด้วย model+storage+status ที่ถูกต้อง และตัดเครื่องตัวเองออก', async () => {
    apiGet.mockResolvedValue({
      data: {
        data: [
          { id: 'p-1', color: 'ดำ', storage: '128GB', status: 'IN_STOCK', cashPrice: '15900', branch: { name: 'ลาดพร้าว' } },
          { id: 'p-2', color: 'ขาว', storage: '128GB', status: 'RESERVED', cashPrice: '15500', branch: { name: 'บางแค' } },
        ],
        total: 2,
      },
    });

    render(wrap(<SameModelCard productId="p-1" model="iPhone 13" storage="128GB" />));

    await waitFor(() => expect(apiGet).toHaveBeenCalled());
    expect(apiGet.mock.calls[0][0]).toBe('/products');
    expect(apiGet.mock.calls[0][1]).toEqual({
      params: { model: 'iPhone 13', storage: '128GB', status: 'IN_STOCK,RESERVED', limit: 20 },
    });
    expect(await screen.findByText('บางแค')).toBeInTheDocument();
    expect(screen.queryByText('ลาดพร้าว')).toBeNull();
  });

  it('เครื่องคอลัมน์ราคา null แต่มีราคาใน prices[] → โชว์ราคา fallback ตรงกับการ์ดหลัก (Task-9 C1)', async () => {
    apiGet.mockResolvedValue({
      data: {
        data: [
          { id: 'p-1', color: 'ดำ', storage: '128GB', status: 'IN_STOCK', cashPrice: '15900', installmentPrice: null, prices: [], branch: { name: 'ลาดพร้าว' } },
          {
            id: 'p-3',
            color: 'เขียว',
            storage: '128GB',
            status: 'IN_STOCK',
            cashPrice: null,
            installmentPrice: null,
            prices: [{ label: 'ราคาเงินสด', amount: '14500', isDefault: true }],
            branch: { name: 'บางแค' },
          },
        ],
        total: 2,
      },
    });

    render(wrap(<SameModelCard productId="p-1" model="iPhone 13" storage="128GB" />));

    // ราคาต้องมาจากเส้น getPositiveDisplayPrices (fallback ไป prices[]) ไม่ใช่คอลัมน์ดิบ
    expect(await screen.findByText('14,500 ฿')).toBeInTheDocument();
  });

  it('ไม่มีเครื่องอื่น → ไม่ render การ์ด', async () => {
    apiGet.mockResolvedValue({ data: { data: [{ id: 'p-1', color: 'ดำ', status: 'IN_STOCK', branch: { name: 'ลาดพร้าว' } }], total: 1 } });
    const { container } = render(wrap(<SameModelCard productId="p-1" model="iPhone 13" storage="128GB" />));
    await waitFor(() => expect(apiGet).toHaveBeenCalled());
    await waitFor(() => expect(container.textContent).not.toContain('เครื่องอื่นรุ่นเดียวกัน'));
  });
});

describe('ActivePromotionsCard', () => {
  it('แสดงโปรที่ active พร้อม label ว่ายังไม่กรองรายเครื่อง', async () => {
    apiGet.mockResolvedValue({
      data: [
        { id: 'promo-1', name: 'ลด 500 เมื่อผ่อน 12 งวด', description: 'เฉพาะเดือนนี้', endDate: '2026-08-31T00:00:00.000Z' },
      ],
    });

    render(wrap(<ActivePromotionsCard />));

    expect(await screen.findByText('ลด 500 เมื่อผ่อน 12 งวด')).toBeInTheDocument();
    expect(screen.getByText('เฉพาะเดือนนี้')).toBeInTheDocument();
    expect(screen.getByText('ยังไม่กรองรายเครื่อง (มาใน B3)')).toBeInTheDocument();
    expect(apiGet).toHaveBeenCalledWith('/promotions/active');
  });

  it('ไม่มีโปร / ยิงพลาด (เช่น 403) → ไม่ render การ์ด ไม่พังทั้งหน้า', async () => {
    apiGet.mockRejectedValue(new Error('403'));
    // สร้าง client เองเพื่อรอให้ query "settle" เป็น error จริงๆ ก่อน assert
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { container } = render(wrap(<ActivePromotionsCard />, client));
    await waitFor(() =>
      expect(client.getQueryState(['promotions', 'active'])?.status).toBe('error'),
    );
    expect(container.textContent).not.toContain('โปรที่ใช้ได้ตอนนี้');
  });
});
