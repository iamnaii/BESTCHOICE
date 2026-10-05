import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { StockProductStatus } from '../StockProductCells';
import type { StockProduct } from '../../types';

const base = {
  id: 'p1',
  status: 'RESERVED',
  branch: { id: 'br-1', name: 'ลาดพร้าว' },
} as unknown as StockProduct;

describe('StockProductStatus — เครื่องที่ใบจองล็อก (PR 2)', () => {
  it('RESERVED + lockedByBookings → ชิป "จองไว้ · BK-…" ลิงก์ไปใบจอง', () => {
    render(
      <MemoryRouter>
        <StockProductStatus
          product={{
            ...base,
            lockedByBookings: [
              { id: 'bk-1', bookingNumber: 'BK-20260517-0001', customer: { name: 'สมหญิง' } },
            ],
          }}
        />
      </MemoryRouter>,
    );
    const link = screen.getByRole('link', { name: /จองไว้ · BK-20260517-0001 \(สมหญิง\)/ });
    expect(link).toHaveAttribute('href', '/bookings?bookingId=bk-1');
  });

  it('RESERVED โดยไม่มีใบจอง (สัญญาร่าง/ปลดจองทั่วไป) → ป้ายเดิม ไม่มีลิงก์', () => {
    render(
      <MemoryRouter>
        <StockProductStatus product={{ ...base, lockedByBookings: [] }} />
      </MemoryRouter>,
    );
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByText(/จอง|ติดจอง/)).toBeInTheDocument();
  });
});
