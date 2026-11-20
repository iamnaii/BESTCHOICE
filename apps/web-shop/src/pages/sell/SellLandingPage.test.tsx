import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
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
