import { describe, it, expect } from 'vitest';
import { getSidebarForRole, resolveZoneForPath, type MenuSection } from '../menu';

/**
 * ก้อน 3 (2026-10-05) — เมนู "ตัดสินค้า" (`/stock/adjustments`) ต้องมีให้ทุก role ที่ route อนุญาต:
 * ผู้ขอ (SALES/BM/OWNER) + ผู้อ่าน (FM/ACCOUNTANT) · อยู่โซนร้าน (shop) ใต้กลุ่มคลังสินค้า · มีป้ายตัวเลขรออนุมัติ
 */
const ROLES = ['OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES'];
const PATH = '/stock/adjustments';

function flatten(sections: MenuSection[]) {
  const out: { label: string; path?: string; badgeKey?: string }[] = [];
  const walk = (items: unknown[]) => {
    for (const it of items as { label: string; path?: string; badgeKey?: string; items?: unknown[]; children?: unknown[] }[]) {
      out.push({ label: it.label, path: it.path, badgeKey: it.badgeKey });
      if (it.items) walk(it.items);
      if (it.children) walk(it.children);
    }
  };
  for (const s of sections) walk(s.items as unknown[]);
  return out;
}

describe('เมนู ตัดสินค้า', () => {
  // ACCOUNTANT ไม่มีโซนร้าน — เมนูคลังของบัญชีอยู่กลุ่ม "ข้อมูลอ้างอิง" โซนการเงิน (ดีไซน์เดิมของ role นี้)
  it.each(ROLES)('%s เห็นเมนู "ตัดสินค้า" ในโซนที่ตัวเองใช้ พร้อม badge รออนุมัติ', (role) => {
    const zone = resolveZoneForPath(role, PATH);
    expect(zone).toBe(role === 'ACCOUNTANT' ? 'fin' : 'shop');
    const item = flatten(getSidebarForRole(role, zone!)).find((i) => i.path === PATH);
    expect(item?.label).toBe('ตัดสินค้า');
    expect(item?.badgeKey).toBe('stock-adjustment-pending');
  });
});
