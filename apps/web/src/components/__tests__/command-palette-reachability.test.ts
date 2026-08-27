import { describe, it, expect } from 'vitest';
import { quickActions } from '../CommandPalette';
import { resolveZoneForPath, COMMON_PATHS } from '@/config/menu';

/**
 * CommandPalette กรองรายการด้วย `filterByRole`:
 *   `!item.roles || (user && item.roles.includes(user.role))`
 * ⇒ รายการที่ไม่ประกาศ `roles` โชว์ให้ **ทุก** บทบาท
 *
 * ส่วน MainLayout เด้งกลับ Dashboard เมื่อ path ไม่อยู่ใน sidebar ของบทบาทนั้น
 * แต่อยู่ใน sidebar ของบทบาทอื่น ⇒ รายการที่ไม่ประกาศ roles แล้วปลายทางเข้าไม่ได้
 * = ปุ่มที่กดแล้วเด้ง ซึ่ง TypeScript จับไม่ได้เลย
 */

/** ต้องตรงกับ ALL_ROLES ใน MainLayout.tsx */
const ALL_ROLES = ['OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'SALES', 'ACCOUNTANT'];

function isReachable(role: string, path: string): boolean {
  if (COMMON_PATHS.has(path)) return true;
  if (resolveZoneForPath(role, path) !== null) return true;
  // ไม่อยู่ใน sidebar ของใครเลย = common route ผ่านได้ทุกบทบาท
  return !ALL_ROLES.some((r) => resolveZoneForPath(r, path) !== null);
}

describe('CommandPalette quickActions — ทุกรายการที่โชว์ต้องกดได้', () => {
  it.each(quickActions.map((q) => [q.label, q] as const))('%s', (_label, entry) => {
    const audience = entry.roles ?? ALL_ROLES;
    const broken = audience.filter((r) => !isReachable(r, entry.path));
    expect(
      broken,
      `"${entry.label}" → ${entry.path} : ${broken.join(', ')} เห็นรายการนี้แต่กดแล้วเด้ง ` +
        `(ใส่ roles ให้ตรงกับ sidebar หรือเพิ่ม path เข้า sidebar ของบทบาทนั้น)`,
    ).toEqual([]);
  });
});
