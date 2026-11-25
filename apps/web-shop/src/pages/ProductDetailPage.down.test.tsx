import type { ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, expect, it, vi } from 'vitest';
import ProductDetailPage from './ProductDetailPage';

const { get } = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@/lib/api', () => ({ api: { get } }));
vi.mock('@/components/layout/ShopLayout', () => ({
  default: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}));
// เทสต์นี้ดูแค่ว่าหน้าอ่าน ?down= แล้วส่งให้เครื่องคิด — ส่วนอื่นของหน้าแทนด้วยตัวเปล่า
vi.mock('@/components/InstallmentCalculatorCard', () => ({
  InstallmentCalculatorCard: (p: { productId: string; initialDown?: number | null }) => (
    <div
      data-testid="calc"
      data-product={p.productId}
      data-down={p.initialDown == null ? 'none' : String(p.initialDown)}
    />
  ),
}));
vi.mock('@/components/catalog/ProductGallery', () => ({ ProductGallery: () => null }));
vi.mock('@/components/catalog/RelatedSection', () => ({ RelatedSection: () => null }));
vi.mock('@/components/catalog/UnitPicker', () => ({ UnitPicker: () => null }));
vi.mock('@/components/catalog/SpecTable', () => ({ SpecTable: () => null }));
vi.mock('@/components/catalog/WarrantyDetails', () => ({ WarrantyDetails: () => null }));

const detail = {
  id: 'u1',
  brand: 'Apple',
  model: 'iPhone 15',
  storage: '128GB',
  color: 'ดำ',
  category: 'PHONE_USED',
  condition: 'USED',
  deviceOrigin: 'THAI',
  gallery: [],
  gallery360: [],
  cashPrice: 18000,
  installmentPrice: 20000,
  tiers: {
    A: {
      minPrice: 18000,
      maxPrice: 18000,
      units: [
        {
          id: 'u1',
          conditionGrade: 'A',
          deviceOrigin: 'THAI',
          cashPrice: 18000,
          installmentPrice: 20000,
          gallery: [],
          gallery360: [],
        },
      ],
    },
  },
};

function open(url: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[url]}>
        <Routes>
          <Route path="/products/:id" element={<ProductDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  get.mockImplementation((url: string) => {
    if (url === '/api/shop/products/u1') return Promise.resolve({ data: detail });
    if (url.startsWith('/api/shop/installment-preview')) {
      return Promise.resolve({ data: { available: false } });
    }
    return Promise.resolve({ data: {} });
  });
});

it('เปิดด้วย ?down=5000 → ส่งเงินดาวน์ให้เครื่องคิดของเครื่องนั้น', async () => {
  open('/products/u1?down=5000');
  const calc = await screen.findByTestId('calc');
  expect(calc).toHaveAttribute('data-product', 'u1');
  expect(calc).toHaveAttribute('data-down', '5000');
});

it('ไม่มี ?down= หรือไม่ใช่จำนวนเต็มบาท → ไม่ส่ง', async () => {
  const first = open('/products/u1');
  expect(await screen.findByTestId('calc')).toHaveAttribute('data-down', 'none');
  first.unmount();
  open('/products/u1?down=abc');
  expect(await screen.findByTestId('calc')).toHaveAttribute('data-down', 'none');
});
