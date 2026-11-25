import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { expect, it } from 'vitest';
import { ProductCard, type ProductGroup } from './ProductCard';

const unit: ProductGroup = {
  id: 'u1',
  kind: 'UNIT',
  brand: 'Apple',
  model: 'iPhone 15',
  storage: '128GB',
  condition: 'USED',
  minPrice: 21900,
  stockCount: 1,
  monthlyPaymentFrom: 1960,
  downAmount: 5000,
  installmentMonths: 12,
  rate2: null,
  stock: { display: 'พร้อมขาย', tone: 'normal' },
  images: [],
  tags: [],
};
const hrefs = () => screen.getAllByRole('link').map((a) => a.getAttribute('href'));

it('สถานะ ②: ทุกลิงก์ของการ์ดพา ?down= ไปหน้ารายละเอียด', () => {
  render(
    <MemoryRouter>
      <ProductCard product={unit} priceMode="installment" down={5000} />
    </MemoryRouter>,
  );
  expect(hrefs().length).toBeGreaterThan(0);
  for (const href of hrefs()) expect(href).toBe('/products/u1?down=5000');
});

it('ไม่ได้ใส่เงินดาวน์ (ไม่ส่ง / null / 0) → ลิงก์เดิม', () => {
  for (const down of [undefined, null, 0]) {
    const view = render(
      <MemoryRouter>
        <ProductCard product={unit} priceMode="installment" down={down} />
      </MemoryRouter>,
    );
    for (const href of hrefs()) expect(href).toBe('/products/u1');
    view.unmount();
  }
});
