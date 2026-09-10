import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { expect, it, vi } from 'vitest';
import { CatalogResults } from './CatalogResults';
import type { ProductGroup } from './ProductCard';

const product: ProductGroup = {
  id: 'phone-a',
  kind: 'UNIT',
  brand: 'Apple',
  model: 'iPhone 13',
  storage: '128GB',
  condition: 'USED',
  conditionGrade: 'A',
  minPrice: 12900,
  stockCount: 1,
  monthlyPaymentFrom: 1290,
  stock: { display: 'พร้อมขาย', tone: 'normal' },
  images: ['/front.jpg', '/back.jpg'],
};

it('announces loading, empty, error and updated result states with a working retry', () => {
  const onRetry = vi.fn();
  const props = {
    products: undefined,
    total: 0,
    loading: true,
    error: false,
    updating: false,
    resultKey: 'all',
    priceMode: 'cash' as const,
    onRetry,
  };
  const { rerender } = render(
    <MemoryRouter>
      <CatalogResults {...props} />
    </MemoryRouter>,
  );
  expect(screen.getByRole('status')).toHaveTextContent('กำลังค้นหาสินค้า');
  rerender(
    <MemoryRouter>
      <CatalogResults {...props} loading={false} error />
    </MemoryRouter>,
  );
  expect(screen.getByRole('status')).toHaveTextContent('โหลดรายการสินค้าไม่สำเร็จ');
  fireEvent.click(screen.getByRole('button'));
  expect(onRetry).toHaveBeenCalledOnce();
  rerender(
    <MemoryRouter>
      <CatalogResults {...props} loading={false} products={[]} />
    </MemoryRouter>,
  );
  expect(screen.getByRole('status')).toHaveTextContent('พบ 0 รายการ');
  rerender(
    <MemoryRouter>
      <CatalogResults {...props} loading={false} products={[product]} total={1} updating />
    </MemoryRouter>,
  );
  expect(screen.getByRole('status')).toHaveTextContent('กำลังอัปเดต');
  expect(screen.getByRole('article')).toBeInTheDocument();
});

it('preserves existing cards, focus and photo selection when more results arrive', () => {
  const props = {
    products: [product],
    total: 2,
    loading: false,
    error: false,
    updating: false,
    resultKey: 'all',
    priceMode: 'cash' as const,
    onRetry: vi.fn(),
  };
  const { rerender } = render(
    <MemoryRouter>
      <CatalogResults {...props} />
    </MemoryRouter>,
  );
  const photo = screen.getByRole('button', { name: 'ดูรูปที่ 2' });
  fireEvent.click(photo);
  photo.focus();
  const first = screen.getByRole('article');
  rerender(
    <MemoryRouter>
      <CatalogResults
        {...props}
        products={[product, { ...product, id: 'phone-b', model: 'iPhone 14' }]}
      />
    </MemoryRouter>,
  );
  expect(screen.getAllByRole('article')[0]).toBe(first);
  expect(photo).toHaveFocus();
  expect(photo).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByRole('status')).toHaveTextContent('พบ 2 รายการ');
});
