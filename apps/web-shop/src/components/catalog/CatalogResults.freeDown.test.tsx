import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { expect, it, vi } from 'vitest';
import { CatalogResults } from './CatalogResults';

const base = {
  products: [],
  total: 0,
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

it('ติ๊กฟรีดาวน์แล้วไม่มีผล → บอกให้เอาเครื่องหมายถูกออก (ไม่ใช่ลองยี่ห้ออื่น)', () => {
  show({ freeDownOnly: true });
  expect(screen.getByText('ยังไม่มีเครื่องฟรีดาวน์ตามตัวกรองนี้')).toBeInTheDocument();
  expect(
    screen.getByText('ลองเอาเครื่องหมายถูกที่ช่อง "ฟรีดาวน์" ออก เพื่อดูเครื่องทั้งหมด'),
  ).toBeInTheDocument();
  expect(screen.queryByText('ไม่พบสินค้าตามตัวกรอง')).not.toBeInTheDocument();
});

it('ไม่ได้ติ๊กฟรีดาวน์ → ข้อความว่างเดิม', () => {
  show();
  expect(screen.getByText('ไม่พบสินค้าตามตัวกรอง')).toBeInTheDocument();
  expect(screen.getByText('ลองเปลี่ยนยี่ห้อหรือช่วงราคา')).toBeInTheDocument();
});
