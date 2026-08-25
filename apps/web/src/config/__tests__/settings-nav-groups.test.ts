import { describe, it, expect } from 'vitest';
import {
  settingsNavGroups,
  settingsNavEntries,
  visibleCategories,
  SETTINGS_GROUP_ORDER,
} from '../settings-access';
import { getSidebarForRole } from '../menu';
import { settingsRegistry } from '../settings-registry';
import type { SettingsRole } from '../settings-registry';

const GEAR_ROLES: SettingsRole[] = ['OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT'];

describe('settingsNavGroups', () => {
  it.each(GEAR_ROLES)('%s: ทุกหมวดที่เห็นต้องอยู่ในกลุ่ม ครบ ไม่ตกหล่น ไม่ซ้ำ', (role) => {
    const cats = visibleCategories(role).map((c) => `/settings/${c.id}`);
    const paths = settingsNavEntries(role).map((e) => e.path);
    // /contacts เพิ่มมาหนึ่งรายการ นอกเหนือจากหมวดใน registry
    expect(paths.filter((p) => p !== '/contacts').sort()).toEqual([...cats].sort());
    expect(new Set(paths).size).toBe(paths.length); // ไม่ซ้ำ
  });

  it('รายชื่อผู้ติดต่อเป็นรายการแรกเสมอ และอยู่กลุ่มองค์กร', () => {
    for (const role of GEAR_ROLES) {
      const groups = settingsNavGroups(role);
      expect(settingsNavEntries(role)[0].path).toBe('/contacts');
      expect(groups[0].id).toBe('org');
      expect(groups[0].entries[0].path).toBe('/contacts');
    }
  });

  it('ลำดับเมนูแบนตรงกับ getSidebarForRole(settings) เป๊ะ — กันสองที่เรียงไม่ตรงกัน', () => {
    for (const role of GEAR_ROLES) {
      const sidebarPaths = getSidebarForRole(role, 'settings')[0].items.map((i) => i.path);
      expect(settingsNavEntries(role).map((e) => e.path)).toEqual(sidebarPaths);
    }
  });

  it('กลุ่มที่ไม่มีรายการถูกตัดทิ้ง และลำดับกลุ่มตาม SETTINGS_GROUP_ORDER', () => {
    for (const role of GEAR_ROLES) {
      const groups = settingsNavGroups(role);
      expect(groups.every((g) => g.entries.length > 0)).toBe(true);
      const order = SETTINGS_GROUP_ORDER.map((g) => g.id);
      const seen = groups.map((g) => g.id);
      expect(seen).toEqual(order.filter((id) => seen.includes(id)));
    }
  });

  it('ACCOUNTANT ไม่เห็นหมวด OWNER-only แต่ยังเห็นรายชื่อผู้ติดต่อ', () => {
    const paths = settingsNavEntries('ACCOUNTANT').map((e) => e.path);
    expect(paths).toContain('/contacts');
    expect(paths).toContain('/settings/accounting');
    expect(paths).toContain('/settings/integrations');
    expect(paths).not.toContain('/settings/system');
    expect(paths).not.toContain('/settings/ai');
  });

  it('role ที่ไม่มีสิทธิ์ตั้งค่า → []', () => {
    expect(settingsNavGroups('SALES' as SettingsRole)).toEqual([]);
    expect(settingsNavEntries('SALES' as SettingsRole)).toEqual([]);
  });

  it('ทุกหมวดใน registry ระบุ group ที่รู้จัก — หมวดใหม่ที่ลืมใส่จะตกกลุ่มท้าย ไม่หาย', () => {
    const known = new Set(SETTINGS_GROUP_ORDER.map((g) => g.id));
    for (const cat of settingsRegistry) {
      expect(known.has(cat.group ?? 'system')).toBe(true);
    }
    // ปักไว้ว่า registry ปัจจุบันระบุครบทุกหมวด (ไม่พึ่ง fallback)
    expect(settingsRegistry.filter((c) => !c.group)).toEqual([]);
  });

  it('ทุกรายการมี icon + label ไม่ว่าง (เมนูย่อโหมด rail พึ่ง icon ล้วน)', () => {
    for (const e of settingsNavEntries('OWNER')) {
      expect(e.icon).toBeTruthy();
      expect(e.label.trim().length).toBeGreaterThan(0);
      expect(e.id.trim().length).toBeGreaterThan(0);
    }
  });
});
