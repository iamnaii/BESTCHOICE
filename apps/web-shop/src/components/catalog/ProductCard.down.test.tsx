import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { DEFAULT_DETAIL_MONTHS } from '@/lib/installment-defaults';
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

describe('จำนวนงวดตามไปหน้ารายละเอียด', () => {
  const show = (
    product: ProductGroup,
    props: { priceMode?: 'installment' | 'cash' | 'combined'; down?: number | null } = {},
    freeDownOnly = false,
  ) => {
    const view = render(
      <MemoryRouter>
        <ProductCard
          product={product}
          priceMode={props.priceMode ?? 'installment'}
          down={props.down}
          freeDownOnly={freeDownOnly}
        />
      </MemoryRouter>,
    );
    const found = hrefs();
    view.unmount();
    return found;
  };
  const six = { ...unit, installmentMonths: 6 };

  it('งวดต่างจากค่าตั้งต้นหน้ารายละเอียด → ?down=…&months=… ทุกลิงก์', () => {
    const found = show(six, { down: 5000 });
    expect(found.length).toBeGreaterThan(0);
    for (const href of found) expect(href).toBe('/products/u1?down=5000&months=6');
  });

  it('ไม่มีเงินดาวน์ที่พิมพ์ → ?months= อย่างเดียว', () => {
    for (const href of show(six)) expect(href).toBe('/products/u1?months=6');
  });

  it('งวดเท่าค่าตั้งต้น หรือไม่มีงวด → ไม่ใส่ months', () => {
    for (const href of show({ ...unit, installmentMonths: DEFAULT_DETAIL_MONTHS }, { down: 5000 })) {
      expect(href).toBe('/products/u1?down=5000');
    }
    for (const href of show({ ...unit, installmentMonths: null })) expect(href).toBe('/products/u1');
  });

  it('งวดเกินเพดานที่หน้ารายละเอียดคิดได้ (36) → ไม่ใส่ months · 36 พอดียังใส่', () => {
    for (const href of show({ ...unit, installmentMonths: 48 }, { down: 5000 })) {
      expect(href).toBe('/products/u1?down=5000');
    }
    for (const href of show({ ...unit, installmentMonths: 37 })) expect(href).toBe('/products/u1');
    for (const href of show({ ...unit, installmentMonths: 36 })) {
      expect(href).toBe('/products/u1?months=36');
    }
  });

  it('โหมดเงินสด / รวม / ไม่มีค่างวดเรท 1 / ไม่มีเงินดาวน์เรท 1 / ฟรีดาวน์อย่างเดียว → ไม่ใส่ months', () => {
    for (const mode of ['cash', 'combined'] as const) {
      for (const href of show(six, { priceMode: mode })) expect(href).toBe('/products/u1');
    }
    for (const href of show({ ...six, monthlyPaymentFrom: null })) expect(href).toBe('/products/u1');
    for (const href of show({ ...six, downAmount: null })) expect(href).toBe('/products/u1');
    for (const href of show(six, { down: 5000 }, true)) expect(href).toBe('/products/u1?down=5000');
  });
});
