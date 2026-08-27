import { describe, it, expect } from 'vitest';
import { resolveActivePath } from '../Sidebar';

// เมนูจริงในโซน "คลัง & จัดซื้อ" ที่ทำให้เกิดปัญหาแถบเขียวสองอัน
const INVENTORY = [
  '/suppliers',
  '/purchase-orders',
  '/purchase-orders/qc',
  '/trade-in',
  '/products',
];

describe('resolveActivePath', () => {
  it('อยู่หน้าเมนูย่อย → เมนูแม่ต้องไม่สว่างด้วย (บั๊กแถบเขียวสองอัน)', () => {
    expect(resolveActivePath(INVENTORY, '/purchase-orders/qc', '')).toBe('/purchase-orders/qc');
  });

  it('อยู่หน้าเมนูแม่ → เมนูแม่สว่าง', () => {
    expect(resolveActivePath(INVENTORY, '/purchase-orders', '')).toBe('/purchase-orders');
  });

  it('หน้ารายละเอียดที่ไม่มีเมนูของตัวเอง → ตกกลับไปสว่างที่เมนูแม่', () => {
    expect(resolveActivePath(INVENTORY, '/suppliers/abc-123', '')).toBe('/suppliers');
  });

  it('ชื่อขึ้นต้นเหมือนกันแต่คนละหน้า ต้องไม่สว่าง', () => {
    // '/products' ห้ามกิน '/products-report' — จึงต้องเทียบขอบด้วย '/'
    expect(resolveActivePath(INVENTORY, '/products-report', '')).toBeNull();
  });

  it('path ที่มี hash ต้องตรงทั้ง pathname และ hash', () => {
    const paths = ['/settings', '/settings/accounting#vat'];
    expect(resolveActivePath(paths, '/settings/accounting', '#vat')).toBe(
      '/settings/accounting#vat',
    );
    expect(resolveActivePath(paths, '/settings/accounting', '#other')).toBe('/settings');
  });

  it('ไม่มีเมนูไหนตรงเลย → null (ไม่ไฮไลต์อะไร)', () => {
    expect(resolveActivePath(INVENTORY, '/dashboard', '')).toBeNull();
  });

  it('เลือกอันที่เจาะจงที่สุด ไม่ใช่อันแรกที่เจอ', () => {
    const paths = ['/a/b/c', '/a', '/a/b'];
    expect(resolveActivePath(paths, '/a/b/c', '')).toBe('/a/b/c');
  });
});
