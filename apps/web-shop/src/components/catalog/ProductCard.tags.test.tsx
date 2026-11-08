import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { expect, it } from 'vitest';
import { ProductCard, type ProductGroup } from './ProductCard';

const unit: ProductGroup = {
  id: 'u1',
  kind: 'UNIT',
  brand: 'Apple',
  model: 'iPhone 13',
  storage: '128GB',
  condition: 'USED',
  minPrice: 12900,
  stockCount: 1,
  monthlyPaymentFrom: null,
  stock: { display: 'พร้อมขาย', tone: 'normal' },
  images: [],
  tags: ['ประกันร้าน 60 วัน'],
};

it('keeps a card tag on one line and truncates instead of wrapping', () => {
  render(
    <MemoryRouter>
      <ProductCard product={unit} />
    </MemoryRouter>,
  );
  const label = screen.getByText('ประกันร้าน 60 วัน');
  const pill = label.closest('span.rounded-full') as HTMLElement;
  expect(pill.className).toContain('whitespace-nowrap');
  expect(label.className).toContain('truncate');
});
