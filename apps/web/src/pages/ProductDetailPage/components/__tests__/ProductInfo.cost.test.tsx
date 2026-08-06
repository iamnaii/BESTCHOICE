import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import ProductInfo from '../ProductInfo';

const product = {
  id: 'p-1',
  name: 'iPhone 13 128GB',
  brand: 'Apple',
  model: 'iPhone 13',
  color: 'ดำ',
  storage: '128GB',
  imeiSerial: '356789012341234',
  serialNumber: null,
  category: 'PHONE_USED',
  costPrice: '12000',
  status: 'IN_STOCK',
  batteryHealth: 89,
  warrantyExpired: true,
  warrantyExpireDate: null,
  hasBox: true,
  accessoryType: null,
  accessoryBrand: null,
  photos: [],
  createdAt: '2026-07-01T00:00:00.000Z',
  branch: { id: 'b-1', name: 'ลาดพร้าว' },
  supplier: null,
  po: null,
  inspection: null,
  prices: [{ id: 'pr-1', label: 'ราคาเงินสด', amount: '15900', isDefault: true }],
};

describe('ProductInfo — การ์ดทุน/กำไร', () => {
  it('ซ่อนทุนและกำไรเมื่อ canSeeCost=false (SALES)', () => {
    render(<ProductInfo product={product} isManager={false} canSeeCost={false} profit={3900} />);
    expect(screen.queryByText('ราคาทุน')).toBeNull();
    expect(screen.queryByText('กำไร')).toBeNull();
    expect(screen.queryByText(/12,000/)).toBeNull();
    // ข้อมูลอื่นยังอยู่
    expect(screen.getByText('ลาดพร้าว')).toBeInTheDocument();
  });

  it('แสดงทุนและกำไรเมื่อ canSeeCost=true', () => {
    render(<ProductInfo product={product} isManager canSeeCost profit={3900} />);
    expect(screen.getByText('ราคาทุน')).toBeInTheDocument();
    expect(screen.getByText('กำไร')).toBeInTheDocument();
    expect(screen.getByText(/12,000/)).toBeInTheDocument();
  });

  it('costPrice ที่ถูก strip ฝั่ง server (undefined) ต้องไม่ทำให้พัง', () => {
    const { costPrice: _dropped, ...stripped } = product;
    render(<ProductInfo product={stripped} isManager={false} canSeeCost={false} profit={null} />);
    expect(screen.getByText('ลาดพร้าว')).toBeInTheDocument();
  });
});
