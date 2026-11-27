import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { copy } from '@/lib/copy';
import SellLandingPage from './SellLandingPage';
vi.mock('@/components/layout/ShopLayout', () => ({
  default: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}));
it('starts assessment directly while preserving the supplied device and attribution', () => {
  render(
    <MemoryRouter initialEntries={['/sell?model=iPhone%2017&storage=256GB&utm_source=line']}>
      <SellLandingPage />
    </MemoryRouter>,
  );
  const href = screen.getByRole('link', { name: 'เริ่มเช็กราคา' }).getAttribute('href');
  const url = new URL(href!, 'http://localhost');
  expect(url.pathname).toBe('/sell/quote');
  expect(url.searchParams.get('model')).toBe('iPhone 17');
  expect(url.searchParams.get('storage')).toBe('256GB');
  expect(url.searchParams.get('utm_source')).toBe('line');
  expect(
    screen.queryByText(/1 นาที|ใช้บัตรประชาชนใบเดียว|สำรอง\/ลบข้อมูล/),
  ).not.toBeInTheDocument();
  expect(screen.getByText(/ไม่จ่ายเป็นเงินสด/)).toBeInTheDocument();
  expect(screen.getByText(/ราคายืนยันจริงตอนตรวจเครื่องที่ร้าน/)).toBeInTheDocument();
});

// ── หน้าแรก /sell แบบ ข (เจ้าของเลือก 2026-11-27): ข้อความสั้น + การ์ด 3 ขั้นตอน ไม่มีรูป ──
function renderLanding() {
  return render(
    <MemoryRouter initialEntries={['/sell']}>
      <SellLandingPage />
    </MemoryRouter>,
  );
}
const flat = (el: HTMLElement) => (el.textContent ?? '').replace(/\s+/g, ' ');
const count = (haystack: string, needle: string) => haystack.split(needle).length - 1;

it('ใต้หัวข้อบอกประโยชน์บรรทัดเดียว และใต้ปุ่มมีสองข้อ แยกกันคนละข้อ', () => {
  renderLanding();
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('ขายหรือเทิร์น iPhone');
  expect(screen.getByText('รู้ราคาประเมินก่อนมาร้าน')).toBeInTheDocument();
  expect(screen.getByText('ไม่ต้องสมัครสมาชิก')).toBeInTheDocument();
  expect(screen.getByText('ไม่ต้องถ่ายรูปเครื่อง')).toBeInTheDocument();
});

it('ลูกค้าเห็น 3 ขั้นตอนตามลำดับก่อนกดปุ่ม', () => {
  renderLanding();
  expect(screen.getByRole('heading', { level: 2, name: '3 ขั้นตอน' })).toBeInTheDocument();
  const steps = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
  expect(steps).toEqual([
    'เลือกรุ่น แล้วตอบสภาพเครื่อง',
    'นำเครื่องมาที่ร้าน',
    'เลือกขายสด หรือเทิร์น',
  ]);
  expect(screen.getByRole('list', { name: '3 ขั้นตอน' }).tagName).toBe('OL');
});

it('สองประโยคบังคับใช้ของเดิมตามตัวอักษร และแต่ละประโยคอยู่ที่เดียว', () => {
  const { container } = renderLanding();
  const text = flat(container);
  expect(count(text, copy.sell.priceCondition)).toBe(1);
  expect(count(text, copy.sell.exchangeCreditNote)).toBe(1);
  expect(count(text, 'ราคายืนยันจริงตอนตรวจเครื่องที่ร้าน')).toBe(1);
  expect(count(text, 'ไม่จ่ายเป็นเงินสด')).toBe(1);
  expect(text).toContain('ขายสด รับเงินที่ร้านหลังตรวจเครื่อง');
});

it('ที่อยู่และเวลาเปิดร้านมาจากข้อมูลร้านชุดเดียวกับหน้าติดต่อ', () => {
  const { container } = renderLanding();
  const text = flat(container);
  expect(text).toContain(copy.contact.address);
  expect(text).toContain(copy.contact.hours);
});

it('แต่ละเรื่องพูดครั้งเดียว — ข้อความเดิมที่ซ้ำกันถูกตัดออก', () => {
  const { container } = renderLanding();
  const text = flat(container);
  expect(text).not.toContain('นำเครื่องมาตรวจที่ร้านเพื่อยืนยันราคา');
  expect(text).not.toContain('มาที่ร้านเบสท์ช้อยส์');
  expect(text).not.toContain('เลือกเครื่อง ตอบสภาพ แล้วดูราคาประเมินได้เลย');
  expect(text).not.toContain('เช็ค');
});

it('ทั้งหน้ามีลิงก์เดียวคือปุ่มเริ่มเช็กราคา และไม่มีรูป (แบบ ข)', () => {
  const { container } = renderLanding();
  const links = screen.getAllByRole('link');
  expect(links).toHaveLength(1);
  expect(links[0]).toHaveAccessibleName('เริ่มเช็กราคา');
  expect(container.querySelector('img')).toBeNull();
});
