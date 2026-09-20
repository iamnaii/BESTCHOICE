import { describe, it, expect } from 'vitest';
import { NAV_LABELS } from '@/config/work-navigation';
import { resolvePageTitle } from '../resolvePageTitle';

describe('resolvePageTitle — ชื่อหน้าใน breadcrumb แถบบน', () => {
  it('หน้ารายละเอียดสินค้า (/products/:uuid) → ป้ายเดียวกับเมนูคลังสินค้า ไม่ใช่ UUID', () => {
    expect(resolvePageTitle('/products/5f56a45e-7c61-4a98-9b1b-f6c6f281ade6')).toBe(NAV_LABELS.stock);
  });

  it('exact match มาก่อน prefix · prefix ครอบ sub-path', () => {
    expect(resolvePageTitle('/customers')).toBe('ลูกค้า');
    expect(resolvePageTitle('/stock/transfers')).toBe(NAV_LABELS.stock);
    expect(resolvePageTitle('/')).not.toBe('');
  });

  it('หน้าตรวจเครดิต → ชื่อไทยเดียวกับเมนู ไม่ใช่ "credit checks"', () => {
    expect(resolvePageTitle('/credit-checks')).toBe('ตรวจเครดิต');
  });

  it('path ที่ไม่รู้จัก → ใช้ segment สุดท้าย (ขีดกลางเป็นเว้นวรรค)', () => {
    expect(resolvePageTitle('/some/unknown-page')).toBe('unknown page');
  });
});
