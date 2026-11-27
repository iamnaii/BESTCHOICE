import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, expect, it, vi } from 'vitest';
import { ProductCard, type ProductGroup } from './ProductCard';

const unit: ProductGroup = {
  id: 'u1',
  kind: 'UNIT',
  brand: 'Apple',
  model: 'iPhone 13',
  storage: '128GB',
  condition: 'USED',
  conditionGrade: 'A',
  minPrice: 12900,
  stockCount: 1,
  monthlyPaymentFrom: null,
  stock: { display: 'พร้อมขาย', tone: 'normal' },
  images: ['/front.jpg', '/back.jpg', '/left.jpg'],
  tags: [],
};

/** The card plus a detail route, so a test can tell whether a tap navigated. */
const show = (product: ProductGroup) =>
  render(
    <MemoryRouter initialEntries={['/products']}>
      <Routes>
        <Route path="/products" element={<ProductCard product={product} />} />
        <Route path="/products/:id" element={<p>หน้ารายละเอียด</p>} />
      </Routes>
    </MemoryRouter>,
  );
const photo = () => screen.getByRole('img', { name: 'Apple iPhone 13 128GB' });

afterEach(() => vi.unstubAllGlobals());

// ผลตรวจ SEO 27 พ.ย. 2569 ข้อ 8: alt บอกความจุ (และสีของเครื่องมือสอง) ให้ Google Images แยกรุ่นได้
// — สูตรเดียวกับชื่อบนหน้าสินค้า (displayName) จึงไม่ใส่คำว่า "สี" เพิ่มเอง
it('alt ของรูปมือสอง = ยี่ห้อ รุ่น ความจุ สี', () => {
  show({ ...unit, color: 'สีฟ้า' });
  expect(screen.getByRole('img', { name: 'Apple iPhone 13 128GB สีฟ้า' })).toBeInTheDocument();
});

it('alt ของการ์ดเครื่องใหม่ (หลายเครื่องรวมกัน) ไม่ใส่สี เพราะในกองมีหลายสี', () => {
  show({
    ...unit,
    id: 'g1',
    kind: 'GROUP',
    condition: 'NEW',
    conditionGrade: undefined,
    color: 'สีดำ',
  });
  expect(screen.getByRole('img', { name: 'Apple iPhone 13 128GB' })).toBeInTheDocument();
});

it('รูปแสดงครบไม่ถูกตัด: object-contain ในกรอบจัตุรัส (รูปจัตุรัสเต็มกรอบเท่า cover)', () => {
  show(unit);
  expect(photo().className).toContain('object-contain');
  expect(photo().className).not.toContain('object-cover');
  expect(photo().className).toContain('size-full');
  expect(photo().parentElement?.className).toContain('aspect-square');
});

it('การ์ดมีลูกตรง 3 ตัวพอดี (รูป · ข้อมูล · แถบราคา) ให้ subgrid เรียงแถบราคาตรงกันทั้งแถว', () => {
  const { container } = show(unit);
  const card = container.querySelector('article')!;
  expect(card.children).toHaveLength(3);
  expect(card.className).toContain('supports-[grid-template-rows:subgrid]:grid-rows-subgrid');
  expect(card.className).toContain('supports-[grid-template-rows:subgrid]:row-span-3');
});

it('ป้ายสภาพเครื่องอยู่ใต้ชื่อรุ่น ไม่ทับรูป', () => {
  show(unit);
  const chip = screen.getByLabelText('สภาพเครื่องเกรด A');
  expect(photo().closest('a')?.contains(chip)).toBe(false);
  expect(screen.getByRole('heading', { name: 'iPhone 13' }).parentElement?.contains(chip)).toBe(
    true,
  );
});

it('ลูกศรเลื่อนรูปวนครบทุกมุม และอยู่นอกลิงก์ของการ์ด', () => {
  show(unit);
  const next = screen.getByRole('button', { name: 'รูปถัดไป' });
  const prev = screen.getByRole('button', { name: 'รูปก่อนหน้า' });
  expect(next.closest('a')).toBeNull();
  expect(prev.closest('a')).toBeNull();

  fireEvent.click(next);
  expect(photo()).toHaveAttribute('src', '/back.jpg');
  fireEvent.click(next);
  fireEvent.click(next);
  expect(photo()).toHaveAttribute('src', '/front.jpg');
  fireEvent.click(prev);
  expect(photo()).toHaveAttribute('src', '/left.jpg');
  expect(screen.queryByText('หน้ารายละเอียด')).toBeNull();
});

it('ปัดรูปแล้วเปลี่ยนรูปโดยไม่เปิดหน้าสินค้า · แตะเฉย ๆ ยังเปิดหน้าสินค้า', () => {
  class TestPointerEvent extends MouseEvent {
    pointerId = 1;
    isPrimary = true;
  }
  vi.stubGlobal('PointerEvent', TestPointerEvent);
  show(unit);

  fireEvent.pointerDown(photo(), { clientX: 200, clientY: 100, button: 0 });
  fireEvent.pointerUp(photo(), { clientX: 80, clientY: 104, button: 0 });
  fireEvent.click(photo());
  expect(photo()).toHaveAttribute('src', '/back.jpg');
  expect(screen.queryByText('หน้ารายละเอียด')).toBeNull();

  // Vertical drag is page scrolling, not a swipe.
  fireEvent.pointerDown(photo(), { clientX: 200, clientY: 100, button: 0 });
  fireEvent.pointerUp(photo(), { clientX: 190, clientY: 260, button: 0 });
  expect(photo()).toHaveAttribute('src', '/back.jpg');

  fireEvent.pointerDown(photo(), { clientX: 100, clientY: 100, button: 0 });
  fireEvent.pointerUp(photo(), { clientX: 100, clientY: 100, button: 0 });
  fireEvent.click(photo());
  expect(screen.getByText('หน้ารายละเอียด')).toBeInTheDocument();
});

it('รูปเดียว: ไม่มีลูกศรและไม่มีจุดบอกลำดับ', () => {
  const { container } = show({ ...unit, images: ['/front.jpg'] });
  expect(screen.queryByRole('button', { name: 'รูปถัดไป' })).toBeNull();
  expect(container.querySelector('[data-gallery-control]')).toBeNull();
});

it('ไม่มีรูป: ยังขึ้นข้อความแทนรูป', () => {
  show({ ...unit, images: [], thumbnailUrl: undefined });
  expect(screen.getByText('ไม่มีรูป')).toBeInTheDocument();
});
