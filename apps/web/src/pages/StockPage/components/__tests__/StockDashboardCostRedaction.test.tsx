import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StockDashboardTab } from '../StockDashboardTab';
import { StockHeroKpi } from '../StockHeroKpi';
import type { StockDashboard } from '../../types';

/**
 * SALES ได้ dashboard ที่ server ตัดต้นทุนออกแล้ว (owner decision 2026-08-04 §1.4):
 * ทุก `value` ที่คิดจาก costPrice เป็น null, slowMovers ไม่มี costPrice,
 * marginOverview เป็น null ทั้งก้อน — หน้าต้องไม่พังและต้องไม่โชว์ตัวเลขบาท
 */
const redacted: StockDashboard = {
  stockAging: [
    { label: '0-30 วัน', min: 0, max: 30, count: 2, value: null },
    { label: '31-60 วัน', min: 31, max: 60, count: 0, value: null },
    { label: '61-90 วัน', min: 61, max: 90, count: 0, value: null },
    { label: '90+ วัน', min: 91, max: Infinity, count: 1, value: null },
  ],
  actionRequired: { inspection: 0, qcPending: 0, photoPending: 0, pendingTransfers: 0, repossessed: 0, agingOver90: 1 },
  valueByStatus: [
    { status: 'IN_STOCK', count: 2, value: null },
    { status: 'RESERVED', count: 1, value: null },
  ],
  byCategory: [{ name: 'PHONE_NEW', count: 3, value: null }],
  byBrand: [{ name: 'Apple', count: 3, value: null }],
  byColor: [{ name: 'Black', count: 3, value: null }],
  byStorage: [{ name: '128GB', count: 3, value: null }],
  stockMovement: [],
  stockTurnover: { avgDaysInStock: 40, soldThisMonth: 1, soldLastMonth: 0, currentStock: 3 },
  topSellers: [],
  slowMovers: [{ name: 'Apple iPhone 13', days: 95 }],
  marginOverview: null,
};

describe('ภาพรวมคลัง — SALES ที่ server ตัดต้นทุนออกแล้ว', () => {
  it('StockDashboardTab ไม่พัง ไม่โชว์ตัวเลขบาท แต่ยังเห็นจำนวนชิ้นตามสถานะ', () => {
    render(<StockDashboardTab dashboard={redacted} isManager={false} />);
    expect(screen.queryByText(/฿/)).toBeNull();
    expect(screen.getByText('อายุสต็อค')).toBeInTheDocument();
    // หัวข้อเปลี่ยนจาก "มูลค่า…" เป็นนับชิ้น เพราะไม่มีมูลค่าให้แสดง
    expect(screen.getByText('สต็อคตามสถานะ')).toBeInTheDocument();
    expect(screen.queryByText('มูลค่าสต็อคตามสถานะ')).toBeNull();
    expect(screen.getByText('Apple iPhone 13')).toBeInTheDocument();
  });

  it('StockHeroKpi ไม่พังเมื่อ marginOverview เป็น null', () => {
    render(<StockHeroKpi totalInStock={3} totalValue={null} dashboard={redacted} isManager={false} />);
    expect(screen.getByText('พร้อมขาย')).toBeInTheDocument();
    expect(screen.queryByText(/฿/)).toBeNull();
  });
});
