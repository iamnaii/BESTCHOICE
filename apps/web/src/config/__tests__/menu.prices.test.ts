import { describe, it, expect } from 'vitest';
// `?raw` ของ Vite — อ่านซอร์สจริง แบบเดียวกับ route-reachability.test.ts
import appSource from '../../App.tsx?raw';
import { resolvePageTitle } from '@/components/layout/resolvePageTitle';
import { getSidebarForRole, resolveZoneForPath } from '../menu';
import { NAV_LABELS } from '../work-navigation';

/**
 * ช่วง 3 (สเปค 2026-11-19 ข้อ 6) — หน้า "ราคาและเรทผ่อน" ทุกตำแหน่งที่ทำงานหน้าร้านเปิดได้ (รวมพนักงานขาย)
 * เมนูอยู่ถัดจาก "คลังสินค้า" ในกลุ่มเดียวกัน · ACCOUNTANT ไม่มีกลุ่มคลังในโซนร้าน — คลังของบัญชีอยู่ "ข้อมูลอ้างอิง" โซนการเงิน
 */
const ROLES = ['OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES'];
const PATH = '/prices';

describe('เมนู ราคาและเรทผ่อน', () => {
  it('ชื่อเมนูกลาง', () => {
    expect(NAV_LABELS.prices).toBe('ราคาและเรทผ่อน');
  });

  it.each(ROLES)('%s เห็นเมนูถัดจากคลังสินค้าในกลุ่มเดียวกัน', (role) => {
    const zone = resolveZoneForPath(role, PATH);
    expect(zone).toBe(role === 'ACCOUNTANT' ? 'fin' : 'shop');
    const section = getSidebarForRole(role, zone!).find((s) => s.items.some((i) => i.path === PATH));
    expect(section).toBeDefined();
    const paths = section!.items.map((i) => i.path);
    expect(paths.indexOf(PATH)).toBe(paths.indexOf('/stock') + 1);
    expect(section!.items.find((i) => i.path === PATH)?.label).toBe(NAV_LABELS.prices);
  });

  it('VIEWER (ผู้ตรวจสอบภายนอก) ไม่มีเมนูนี้', () => {
    expect(resolveZoneForPath('VIEWER', PATH)).toBeNull();
  });

  it('route /prices อนุญาต 5 ตำแหน่งเดียวกับเมนู และเปิด PriceListPage', () => {
    const block = appSource.split('path="/prices"')[1]?.split('<Route')[0] ?? '';
    expect(block).toContain('<PriceListPage />');
    const roles = [...(block.match(/roles=\{\[([^\]]*)\]\}/)?.[1] ?? '').matchAll(/'(\w+)'/g)].map((m) => m[1]);
    expect([...roles].sort()).toEqual([...ROLES].sort());
  });

  it('breadcrumb ใช้ชื่อเดียวกับเมนู', () => {
    expect(resolvePageTitle(PATH)).toBe('ราคาและเรทผ่อน');
  });
});
