import type { ReactNode } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation } from 'react-router';
import { beforeEach, expect, it, vi } from 'vitest';
import CatalogPage from './CatalogPage';

const { get } = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@/lib/api', () => ({ api: { get } }));
// แบนเนอร์หัวหน้าถามยอดดาวน์ตามสต๊อกจาก /api/shop/products ด้วย (คำขอเดียวกับแถบโปรใน ShopLayout ที่จำลองไว้ข้างล่าง)
// — ไฟล์นี้นับเฉพาะคำขอรายการสินค้าของตัวกรอง จึงถอดแบนเนอร์ออกเหมือนกัน (เทสต์ของแบนเนอร์อยู่ที่ CatalogBanner.test.tsx)
vi.mock('@/components/catalog/CatalogBanner', () => ({ CatalogBanner: () => null }));
vi.mock('@/components/layout/ShopLayout', () => ({
  default: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}));

const unit = {
  id: 'u1',
  kind: 'UNIT',
  brand: 'Apple',
  model: 'iPhone 16 Pro Max',
  storage: '256GB',
  condition: 'USED',
  minPrice: 29900,
  stockCount: 1,
  monthlyPaymentFrom: 2890,
  downAmount: 4485,
  installmentMonths: 12,
  rate2: { down: 0, monthly: 4061, months: 15 },
  stock: { display: 'พร้อมขาย', tone: 'normal' },
  images: [],
  tags: [],
};
const page = (over: Record<string, unknown> = {}) => ({
  data: {
    data: [unit],
    total: 1,
    page: 1,
    limit: 12,
    minDownPct: 15,
    monthsOptions: [10, 12],
    freeDownCount: 3,
    ...over,
  },
});

let lastSearch = '';
function Probe() {
  lastSearch = useLocation().search;
  return null;
}
function open(url: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[url]}>
        <Probe />
        <CatalogPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
const listCalls = () =>
  get.mock.calls.map((c) => String(c[0])).filter((u) => u.startsWith('/api/shop/products'));

beforeEach(() => {
  vi.clearAllMocks();
  get.mockImplementation((url: string) =>
    url.startsWith('/api/shop/models') ? Promise.resolve({ data: [] }) : Promise.resolve(page()),
  );
});

it('ลิงก์โฆษณา ?freeDown=1 → ขอ freeDown=true และช่องติ๊กถูกติ๊กอยู่', async () => {
  open('/products?freeDown=1');
  await waitFor(() => expect(listCalls()[0]).toContain('freeDown=true'));
  const boxes = await screen.findAllByRole('checkbox', { name: /ฟรีดาวน์/ });
  expect(boxes.length).toBeGreaterThan(0);
  for (const box of boxes) expect(box).toBeChecked();
});

it('สลับเป็นซื้อสด → freeDown หายจาก URL และจากคำขอ', async () => {
  open('/products?freeDown=1');
  await screen.findAllByRole('checkbox', { name: /ฟรีดาวน์/ });
  fireEvent.click(screen.getByRole('button', { name: 'ซื้อสด' }));
  await waitFor(() => expect(lastSearch).not.toContain('freeDown'));
  await waitFor(() => {
    const calls = listCalls();
    expect(calls[calls.length - 1]).not.toContain('freeDown');
  });
});

it('ติ๊กฟรีดาวน์แล้วคำขอใหม่ยังโหลดอยู่ → ช่องติ๊กไม่หาย และยังแสดง 3 (ไม่ใช่ 0)', async () => {
  open('/products');
  const before = await screen.findAllByRole('checkbox', { name: /ฟรีดาวน์/ });
  expect(before.length).toBeGreaterThan(0);
  get.mockImplementation((url: string) =>
    url.startsWith('/api/shop/models')
      ? Promise.resolve({ data: [] })
      : url.includes('freeDown=true')
        ? new Promise(() => {})
        : Promise.resolve(page()),
  );
  fireEvent.click(before[0]);
  await waitFor(() => expect(listCalls().some((u) => u.includes('freeDown=true'))).toBe(true));
  const during = screen.getAllByRole('checkbox', { name: /ฟรีดาวน์/ });
  expect(during.length).toBe(before.length);
  for (const box of during) expect(box).toBeChecked();
  expect(screen.getAllByText('3 เครื่อง').length).toBeGreaterThan(0);
  expect(screen.queryByText('0 เครื่อง')).not.toBeInTheDocument();
});

it('API รุ่นเก่า (ไม่มี freeDownCount) + ?freeDown=1 → การ์ดไม่ขึ้นโหมดฟรีดาวน์ล้วน (ยังเห็นกล่องเรท 1)', async () => {
  get.mockImplementation((url: string) =>
    url.startsWith('/api/shop/models')
      ? Promise.resolve({ data: [] })
      : Promise.resolve(page({ freeDownCount: undefined })),
  );
  open('/products?freeDown=1');
  
  await waitFor(() => expect(screen.getByText('฿4,485')).toBeInTheDocument());
});
