import type { ReactNode } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import ProductDetailPage from './ProductDetailPage';

const { get } = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@/lib/api', () => ({ api: { get } }));
vi.mock('@/components/layout/ShopLayout', () => ({
  default: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}));
vi.mock('@/components/InstallmentCalculatorCard', () => ({
  InstallmentCalculatorCard: () => null,
}));
vi.mock('@/components/catalog/ProductGallery', () => ({ ProductGallery: () => null }));
vi.mock('@/components/catalog/RelatedSection', () => ({ RelatedSection: () => null }));
vi.mock('@/components/catalog/UnitPicker', () => ({ UnitPicker: () => null }));
vi.mock('@/components/catalog/SpecTable', () => ({ SpecTable: () => null }));
vi.mock('@/components/catalog/WarrantyDetails', () => ({ WarrantyDetails: () => null }));

const BASE = 'https://www.bestchoicephone.com';
const PHOTO = `${BASE}/api/shop/products/u1/photos/front?v=1`;

const unit = {
  id: 'u1',
  conditionGrade: 'A',
  deviceOrigin: 'THAI',
  cashPrice: 18000,
  installmentPrice: 20000,
  gallery: [PHOTO],
  gallery360: [],
};
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
  tiers: { A: { minPrice: 18000, maxPrice: 18000, units: [unit] } },
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

function jsonLd(container: HTMLElement): Array<Record<string, unknown>> {
  return Array.from(container.querySelectorAll('script[type="application/ld+json"]')).map(
    (s) => JSON.parse(s.innerHTML) as Record<string, unknown>,
  );
}

function mockProduct(product: unknown) {
  get.mockImplementation((url: string) => {
    if (url === '/api/shop/products/u1') return Promise.resolve({ data: product });
    if (url.startsWith('/api/shop/installment-preview')) {
      return Promise.resolve({ data: { available: false } });
    }
    return Promise.resolve({ data: {} });
  });
}

const robots = () => document.querySelector<HTMLMetaElement>('meta[name="robots"]');

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  document.head.querySelectorAll('meta[name="robots"], link[rel="canonical"]').forEach((el) => {
    el.remove();
  });
});

it('หน้าสินค้ามี JSON-LD Product + Offer ตรงกับที่แสดงบนหน้า', async () => {
  mockProduct(detail);
  const { container } = open('/products/u1');
  await screen.findByRole('heading', { level: 1, name: 'Apple iPhone 15 128GB ดำ' });

  const product = jsonLd(container).find((d) => d['@type'] === 'Product');
  expect(product).toMatchObject({
    name: 'Apple iPhone 15 128GB ดำ',
    brand: { '@type': 'Brand', name: 'Apple' },
    itemCondition: 'https://schema.org/UsedCondition',
    image: [PHOTO],
    offers: {
      '@type': 'Offer',
      url: `${BASE}/products/u1`,
      priceCurrency: 'THB',
      price: '18000',
      availability: 'https://schema.org/InStock',
    },
  });
  expect(robots()).toBeNull();
});

it('หน้าสินค้ามี BreadcrumbList ตามแถบเส้นทาง', async () => {
  mockProduct(detail);
  const { container } = open('/products/u1');
  await screen.findByRole('heading', { level: 1 });

  const crumbs = jsonLd(container).find((d) => d['@type'] === 'BreadcrumbList');
  expect(crumbs?.itemListElement).toEqual([
    { '@type': 'ListItem', position: 1, name: 'หน้าแรก', item: `${BASE}/` },
    { '@type': 'ListItem', position: 2, name: 'สินค้าทั้งหมด', item: `${BASE}/products` },
    { '@type': 'ListItem', position: 3, name: 'iPhone 15', item: `${BASE}/products/u1` },
  ]);
});

it('หมดสต็อก (ไม่มีเครื่องพร้อมขาย หน้าไม่แสดงราคา) → Product ไม่มี offers', async () => {
  mockProduct({ ...detail, tiers: {} });
  const { container } = open('/products/u1');
  await screen.findByRole('heading', { level: 1 });

  const product = jsonLd(container).find((d) => d['@type'] === 'Product');
  expect(product).toBeDefined();
  expect(product).not.toHaveProperty('offers');
});

it('สินค้าไม่มีอยู่ (API ตอบ 404) → noindex + title ไม่ใช่ของหน้าแรก + ไม่มี JSON-LD สินค้า', async () => {
  get.mockImplementation((url: string) => {
    if (url === '/api/shop/products/u1') return Promise.reject({ response: { status: 404 } });
    return Promise.resolve({ data: {} });
  });
  const { container } = open('/products/u1');
  await screen.findByRole('heading', { level: 1, name: 'สินค้านี้ไม่พร้อมขายบนเว็บ' });

  await waitFor(() => expect(robots()?.content).toBe('noindex'));
  expect(document.title).toBe('สินค้านี้ไม่พร้อมขายบนเว็บ | BESTCHOICE ลพบุรี');
  expect(jsonLd(container)).toEqual([]);
});

// หน้าลองใหม่เอง 2 ครั้งสำหรับ error ที่ไม่ใช่ 404 (รอราว 3 วินาที) ก่อนขึ้นปุ่ม "ลองใหม่"
it('โหลดไม่สำเร็จชั่วคราว (5xx) → ไม่ใส่ noindex (หน้ายังมีอยู่จริง)', async () => {
  get.mockImplementation((url: string) => {
    if (url === '/api/shop/products/u1') return Promise.reject({ response: { status: 503 } });
    return Promise.resolve({ data: {} });
  });
  open('/products/u1');
  await screen.findByRole('button', { name: /ลองใหม่/ }, { timeout: 8_000 });
  expect(robots()).toBeNull();
}, 15_000);
