import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { PlanTiles, showsRate2Tile } from './PlanTiles';
import { ProductCard, type ProductGroup } from './ProductCard';

const rate1 = { down: 4485, monthly: 2890, months: 12 };

describe('showsRate2Tile', () => {
  it('ขึ้นเมื่อเรท 2 ใช้เงินดาวน์น้อยกว่าเรท 1 หรือไม่มีเรท 1', () => {
    expect(showsRate2Tile(rate1, { down: 0, monthly: 4061, months: 15 })).toBe(true);
    expect(showsRate2Tile(rate1, { down: 1000, monthly: 3450, months: 15 })).toBe(true);
    expect(showsRate2Tile(null, { down: 5900, monthly: 4821, months: 15 })).toBe(true);
  });
  it('ไม่ขึ้นเมื่อดาวน์เท่ากันหรือมากกว่า หรือไม่มีแผนเรท 2', () => {
    expect(showsRate2Tile(rate1, { down: 4485, monthly: 2500, months: 15 })).toBe(false);
    expect(showsRate2Tile(rate1, { down: 5900, monthly: 2500, months: 15 })).toBe(false);
    expect(showsRate2Tile(rate1, null)).toBe(false);
  });
});

describe('PlanTiles', () => {
  it('เรท 1 + ฟรีดาวน์: สองกล่อง ดาวน์เป็นบาท บรรทัดค่างวดรูป "ผ่อน ฿X × N งวด"', () => {
    const { container } = render(
      <PlanTiles rate1={rate1} rate2={{ down: 0, monthly: 4061, months: 15 }} />,
    );
    expect(screen.getByText('฿4,485')).toBeInTheDocument();
    expect(screen.getByText('ฟรีดาวน์')).toBeInTheDocument();
    const lines = Array.from(container.querySelectorAll('[data-plan-line]')).map((el) =>
      el.textContent?.replace(/\s+/g, ' ').trim(),
    );
    expect(lines).toEqual(['ผ่อน ฿2,890 × 12 งวด', 'ผ่อน ฿4,061 × 15 งวด']);
    for (const el of container.querySelectorAll('[data-plan-line]')) {
      expect(el.className).toContain('whitespace-nowrap');
    }
    expect(container.textContent).not.toContain('%');
    expect(container.textContent).not.toContain('เรท');
  });

  it('เรท 2 ดาวน์น้อยกว่าแต่ไม่ถึง 0: กล่องล่างเขียนดาวน์เป็นบาท ไม่ใช่ "ฟรีดาวน์"', () => {
    const { container } = render(
      <PlanTiles rate1={rate1} rate2={{ down: 1000, monthly: 3450, months: 15 }} />,
    );
    expect(screen.getByText('฿1,000')).toBeInTheDocument();
    expect(screen.queryByText('ฟรีดาวน์')).not.toBeInTheDocument();
    expect(container.querySelector('[data-plan="rate2"]')).not.toBeNull();
    expect(container.querySelector('[data-plan="free-down"]')).toBeNull();
  });

  it('เรท 2 ดาวน์ไม่น้อยกว่า: กล่องเดียว', () => {
    const { container } = render(
      <PlanTiles rate1={rate1} rate2={{ down: 5900, monthly: 2500, months: 15 }} />,
    );
    expect(container.querySelectorAll('[data-plan]')).toHaveLength(1);
  });

  it('freeDownOnly: ไม่มีกล่องเรท 1 เหลือกล่องฟรีดาวน์กล่องเดียว', () => {
    const { container } = render(
      <PlanTiles rate1={rate1} rate2={{ down: 0, monthly: 4061, months: 15 }} freeDownOnly />,
    );
    expect(screen.queryByText('฿4,485')).not.toBeInTheDocument();
    expect(container.querySelectorAll('[data-plan]')).toHaveLength(1);
    expect(screen.getByText('ฟรีดาวน์')).toBeInTheDocument();
  });

  it('หัวข้อ "ฟรีดาวน์" ใช้ leading-snug (ตัวอักษรไทย) ไม่ใช่ leading-tight', () => {
    render(<PlanTiles rate1={rate1} rate2={{ down: 0, monthly: 4061, months: 15 }} />);
    const head = screen.getByText('ฟรีดาวน์');
    expect(head.className).toContain('leading-snug');
    expect(head.className).not.toContain('leading-tight');
  });

  it('ไม่มีทั้งสองแผน: "สอบถามค่างวด"', () => {
    render(<PlanTiles rate1={null} rate2={null} />);
    expect(screen.getByText('สอบถามค่างวด')).toBeInTheDocument();
  });
});

describe('ProductCard โหมดผ่อน', () => {
  const unit: ProductGroup = {
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
  const show = (props: Partial<Parameters<typeof ProductCard>[0]> = {}) =>
    render(
      <MemoryRouter>
        <ProductCard product={unit} priceMode="installment" {...props} />
      </MemoryRouter>,
    );

  it('แสดงสองกล่องจากข้อมูลของ API', () => {
    show();
    expect(screen.getByText('฿4,485')).toBeInTheDocument();
    expect(screen.getByText('ฟรีดาวน์')).toBeInTheDocument();
  });

  it('API รุ่นเก่าไม่มี rate2 → กล่องเดียว ไม่พัง', () => {
    show({ product: { ...unit, rate2: undefined } });
    expect(screen.getByText('฿4,485')).toBeInTheDocument();
    expect(screen.queryByText('ฟรีดาวน์')).not.toBeInTheDocument();
  });

  it('โหมดซื้อสดไม่มีกล่องผ่อน', () => {
    show({ priceMode: 'cash' });
    expect(screen.queryByText('ฟรีดาวน์')).not.toBeInTheDocument();
    expect(screen.getByText('฿29,900')).toBeInTheDocument();
  });
});

describe('บรรทัดค่างวดไม่มีจำนวนงวด / การ์ดฟรีดาวน์อย่างเดียว', () => {
  it('months เป็น null → "ผ่อน ฿X ต่อเดือน" (ไม่มี × N งวด)', () => {
    const { container } = render(
      <PlanTiles rate1={{ down: 4485, monthly: 2890, months: null }} rate2={null} />,
    );
    const lines = Array.from(container.querySelectorAll('[data-plan-line]')).map((el) =>
      el.textContent?.replace(/\s+/g, ' ').trim(),
    );
    expect(lines).toEqual(['ผ่อน ฿2,890 ต่อเดือน']);
    expect(container.textContent).not.toContain('งวด');
  });

  it('ProductCard freeDownOnly: เครื่องที่มีทั้งสองแผน แสดงเฉพาะกล่องฟรีดาวน์', () => {
    const both: ProductGroup = {
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
    const { container } = render(
      <MemoryRouter>
        <ProductCard product={both} priceMode="installment" freeDownOnly />
      </MemoryRouter>,
    );
    expect(container.querySelectorAll('[data-plan]')).toHaveLength(1);
    expect(container.querySelector('[data-plan="free-down"]')).not.toBeNull();
    expect(container.querySelector('[data-plan="rate1"]')).toBeNull();
    expect(screen.queryByText('฿4,485')).not.toBeInTheDocument();
  });
});
