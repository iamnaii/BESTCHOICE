import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { expect, it, vi } from 'vitest';
import { CatalogResults } from './CatalogResults';
import type { ProductGroup } from './ProductCard';

const product: ProductGroup = {
  id: 'phone-a',
  kind: 'UNIT',
  brand: 'Apple',
  model: 'iPhone 15',
  storage: '128GB',
  condition: 'USED',
  conditionGrade: 'A',
  minPrice: 21900,
  stockCount: 1,
  monthlyPaymentFrom: 1960,
  downAmount: 5000,
  installmentMonths: 12,
  rate2: null,
  stock: { display: 'พร้อมขาย', tone: 'normal' },
  images: [],
};
const base = {
  products: [product],
  total: 1,
  loading: false,
  error: false,
  updating: false,
  resultKey: 'k',
  priceMode: 'installment' as const,
  onRetry: vi.fn(),
};
const show = (over: Partial<Parameters<typeof CatalogResults>[0]> = {}) =>
  render(
    <MemoryRouter>
      <CatalogResults {...base} {...over} />
    </MemoryRouter>,
  );

it('บรรทัดสรุป สถานะ ②: "พบ N เครื่องที่ดาวน์ได้ด้วยเงิน ฿X"', () => {
  show({ total: 21, down: 5000 });
  expect(screen.getByRole('status')).toHaveTextContent('พบ 21 เครื่องที่ดาวน์ได้ด้วยเงิน ฿5,000');
});

it('บรรทัดสรุป สถานะ ③: "พบ N เครื่องฟรีดาวน์"', () => {
  show({ total: 12, freeDownOnly: true });
  expect(screen.getByRole('status')).toHaveTextContent('พบ 12 เครื่องฟรีดาวน์');
});

it('นอกสองสถานะนั้น → ข้อความเดิม', () => {
  show({ total: 3 });
  expect(screen.getByRole('status')).toHaveTextContent('พบ 3 รายการ');
});

it('สถานะ ② มีเครื่องที่เงินไม่พอ → บรรทัดท้ายรายการ + ปุ่ม "ดูทั้งหมด" ล้างเงินดาวน์', () => {
  const onClearDown = vi.fn();
  show({ total: 21, down: 5000, overBudgetCount: 8, nextDownFrom: 5400, onClearDown });
  expect(
    screen.getByText(/อีก 8 เครื่องต้องดาวน์มากกว่า ฿5,000 \(เริ่มที่ ฿5,400\)/),
  ).toBeInTheDocument();
  const button = screen.getByRole('button', { name: 'ดูทั้งหมด' });
  expect(button.className).toContain('min-h-11');
  fireEvent.click(button);
  expect(onClearDown).toHaveBeenCalledOnce();
});

it('ไม่มีเครื่องถูกตัด หรือไม่ได้ใส่เงินดาวน์ → ไม่มีบรรทัดท้ายรายการ', () => {
  const { unmount } = show({ down: 5000, overBudgetCount: 0 });
  expect(screen.queryByText(/ต้องดาวน์มากกว่า/)).not.toBeInTheDocument();
  unmount();
  show({ overBudgetCount: 8, nextDownFrom: 5400 });
  expect(screen.queryByText(/ต้องดาวน์มากกว่า/)).not.toBeInTheDocument();
});

it('สถานะ ② ไม่มีเครื่องเข้าเงื่อนไข → บอกว่าเงินดาวน์ยังไม่พอ + ปุ่มดูเครื่องฟรีดาวน์ + ปุ่มล้างเงินดาวน์', () => {
  const onClearDown = vi.fn();
  const onShowFreeDown = vi.fn();
  show({
    products: [],
    total: 0,
    down: 500,
    overBudgetCount: 5,
    nextDownFrom: 1000,
    freeDownCount: 3,
    onClearDown,
    onShowFreeDown,
  });
  expect(screen.getByText('เงินดาวน์ ฿500 ยังไม่พอ')).toBeInTheDocument();
  expect(screen.getByText('ดาวน์ต่ำสุดเริ่มที่ ฿1,000')).toBeInTheDocument();
  expect(screen.queryByText('ไม่พบสินค้าตามตัวกรอง')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'ดูเครื่องฟรีดาวน์' }));
  expect(onShowFreeDown).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole('button', { name: 'ล้างเงินดาวน์' }));
  expect(onClearDown).toHaveBeenCalledOnce();
});

it('รายการว่างสถานะ ②: ไม่รู้ดาวน์ต่ำสุด → ไม่มีคำอธิบาย · ไม่มีเครื่องฟรีดาวน์ → ไม่มีปุ่มนั้น', () => {
  show({
    products: [],
    total: 0,
    down: 500,
    overBudgetCount: 5,
    nextDownFrom: null,
    freeDownCount: 0,
  });
  expect(screen.getByText('เงินดาวน์ ฿500 ยังไม่พอ')).toBeInTheDocument();
  expect(screen.queryByText(/ดาวน์ต่ำสุดเริ่มที่/)).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'ดูเครื่องฟรีดาวน์' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'ล้างเงินดาวน์' })).toBeInTheDocument();
});

it('สถานะ ②: ส่งเงินดาวน์ต่อให้การ์ด — ลิงก์ของการ์ดมี ?down=', () => {
  show({ down: 5000 });
  const links = screen.getAllByRole('link');
  expect(links.length).toBeGreaterThan(0);
  for (const a of links) expect(a).toHaveAttribute('href', '/products/phone-a?down=5000');
});

it('รายการว่างโดยไม่มีเครื่องถูกตัดเพราะเงิน (overBudgetCount 0 หรือไม่ส่ง) → ข้อความว่างทั่วไป ไม่ใช่ "เงินดาวน์ยังไม่พอ"', () => {
  const { unmount } = show({ products: [], total: 0, down: 500, overBudgetCount: 0 });
  expect(screen.queryByText(/ยังไม่พอ/)).not.toBeInTheDocument();
  expect(screen.getByText('ไม่พบสินค้าตามตัวกรอง')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'ล้างเงินดาวน์' })).not.toBeInTheDocument();
  unmount();
  show({ products: [], total: 0, down: 500 });
  expect(screen.queryByText(/ยังไม่พอ/)).not.toBeInTheDocument();
  expect(screen.getByText('ไม่พบสินค้าตามตัวกรอง')).toBeInTheDocument();
});

it('บรรทัดท้ายรายการอยู่ท้ายสุดจริง: ยังมีหน้าถัดไป (hasMore) → ไม่แสดง · ไม่มี → แสดง', () => {
  const { unmount } = show({ down: 5000, overBudgetCount: 8, nextDownFrom: 5400, hasMore: true });
  expect(screen.queryByText(/ต้องดาวน์มากกว่า/)).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'ดูทั้งหมด' })).not.toBeInTheDocument();
  unmount();
  show({ down: 5000, overBudgetCount: 8, nextDownFrom: 5400, hasMore: false });
  expect(screen.getByText(/ต้องดาวน์มากกว่า/)).toBeInTheDocument();
});
