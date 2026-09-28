import { render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation, useParams } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import App from './App';

/**
 * ลิงก์เก่าของฟีเจอร์ที่ถอดแล้ว (ตะกร้า ชำระเงิน สมัครผ่อน ออมดาวน์) ต้องพาไปหน้าที่ยังใช้ได้
 * ไม่ใช่หน้า "ไม่พบหน้านี้" — ลิงก์พวกนี้ยังค้างอยู่ในแชท LINE/โฆษณา/bookmark ของลูกค้า
 *
 * หน้าปลายทางถูกแทนด้วยตัวจำลองที่พิมพ์ path ออกมา เพื่อทดสอบเฉพาะการจับคู่ route
 */

function Probe({ name }: { name: string }) {
  const location = useLocation();
  const params = useParams();
  return (
    <output aria-label="landed">
      {name}|{location.pathname}
      {location.search}|{params.id ?? ''}
    </output>
  );
}

vi.mock('./lib/tracking', () => ({ trackPageView: vi.fn() }));
vi.mock('./components/ScrollToTop', () => ({ ScrollToTop: () => null }));
vi.mock('./pages/CatalogPage', () => ({ default: () => <Probe name="catalog" /> }));
vi.mock('./pages/ProductDetailPage', () => ({ default: () => <Probe name="product" /> }));
vi.mock('./pages/HowItWorksPage', () => ({ default: () => <Probe name="how" /> }));
vi.mock('./pages/account/AccountPage', () => ({ default: () => <Probe name="account" /> }));
vi.mock('./pages/NotFoundPage', () => ({ default: () => <Probe name="notfound" /> }));

function landed(url: string) {
  render(
    <MemoryRouter initialEntries={[url]}>
      <App />
    </MemoryRouter>,
  );
  return screen.getByLabelText('landed').textContent;
}

describe('ลิงก์เก่าของฟีเจอร์ที่ถอดแล้ว', () => {
  it.each([
    ['/cart', 'catalog|/products|'],
    ['/checkout', 'catalog|/products|'],
    ['/checkout/success/ORD-1', 'catalog|/products|'],
    ['/apply', 'how|/how-it-works|'],
    ['/apply/status', 'how|/how-it-works|'],
    ['/apply/success/APP-1', 'how|/how-it-works|'],
    ['/apply/abc-123', 'product|/products/abc-123|abc-123'],
    ['/saving-plan', 'how|/how-it-works|'],
    ['/saving-plan/create', 'how|/how-it-works|'],
    ['/saving-plan/0f0e1d2c', 'how|/how-it-works|'],
    ['/account/saving-plans', 'account|/account|'],
  ])('%s → %s', (from, expected) => {
    expect(landed(from)).toBe(expected);
  });

  // แยกเคสละเทสต์ — render สองครั้งในเทสต์เดียวจะมี <output> สองตัวในจอ
  it.each([
    ['/cart?utm_source=line', 'catalog|/products?utm_source=line|'],
    ['/apply/abc-123?utm_source=fb', 'product|/products/abc-123?utm_source=fb|abc-123'],
  ])('ส่งต่อ query string (utm) ไปด้วย: %s', (from, expected) => {
    expect(landed(from)).toBe(expected);
  });

  it('path ที่ไม่รู้จักยังได้หน้า "ไม่พบหน้านี้" ตามเดิม', () => {
    expect(landed('/no-such-page')).toBe('notfound|/no-such-page|');
  });
});
