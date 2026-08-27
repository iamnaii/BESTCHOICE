import { describe, it, expect } from 'vitest';
import { resolveZoneForPath, COMMON_PATHS } from '../menu';

/**
 * MainLayout เด้งผู้ใช้กลับ Dashboard พร้อม toast "คุณไม่มีสิทธิ์เข้าถึงหน้านี้" เมื่อ
 * `resolveZoneForPath(role, pathname)` คืน null **และ** มี role อื่นที่มี path นั้นใน
 * sidebar (MainLayout.tsx — บล็อก `anyRoleHasIt`).
 *
 * กติกาที่เทสนี้บังคับ: **ปุ่มที่ render ให้ role ไหน ปลายทางต้องเข้าได้สำหรับ role นั้น**
 * ไม่ใช่ "เมนูต้องมาคู่กัน" (กติกาเดิมที่แรงเกินไป — มันบังคับให้ต้องแจกหน้าสร้างลูกค้าให้
 * ผจก.การเงินทั้งที่ API ไม่รับ วิธีที่ถูกคือซ่อนปุ่มแทน)
 *
 * เคสที่เจอจริง: ผจก.การเงินเข้า /inbox ได้ (App.tsx roles) เห็นปุ่ม "สร้างลูกค้าจากแชทนี้"
 * (Customer360Panel) ซึ่ง navigate ไป /customers — แต่ /customers ไม่เคยอยู่ใน sidebar
 * ของ FM ⇒ กดแล้วเด้งกลับ Dashboard ทุกครั้ง ทั้งที่ API เปิดให้ FM
 * (customers.controller.ts `@Roles(... 'FINANCE_MANAGER' ...)`)
 */

/** ต้องตรงกับ ALL_ROLES ใน MainLayout.tsx */
const ALL_ROLES = ['OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'SALES', 'ACCOUNTANT'];

/**
 * จำลองตรรกะ MainLayout ให้ครบทั้ง 3 ทาง — สำคัญที่ทางที่ 3: path ที่ **ไม่มีอยู่ใน
 * sidebar ของใครเลย** (เช่น /contracts/create, /customers/:id) ถือเป็น common route
 * ผ่านได้ทุกบทบาท เพราะ `anyRoleHasIt` เป็น false ⇒ guard ไม่ทำอะไร
 */
function isReachable(role: string, path: string): boolean {
  if (COMMON_PATHS.has(path)) return true;
  if (resolveZoneForPath(role, path) !== null) return true;
  const inSomeoneSidebar = ALL_ROLES.some((r) => resolveZoneForPath(r, path) !== null);
  return !inSomeoneSidebar;
}

/**
 * ปุ่มในหน้าจอ → (ปลายทาง, บทบาทที่เห็นปุ่มนั้น)
 * `roles` ต้องสะท้อนเงื่อนไข render จริงในโค้ด ไม่ใช่สิ่งที่เราอยากให้เป็น
 */
const RENDERED_CTAS: Array<{ where: string; label: string; path: string; roles: string[] }> = [
  {
    where: 'UnifiedInboxPage/components/Customer360Panel.tsx — ไม่มีเงื่อนไข role',
    label: 'สร้างลูกค้าจากแชทนี้',
    path: '/customers',
    // = ProtectedRoute ของ /inbox ใน App.tsx (ใครเข้าหน้าแชทได้ ก็เห็นปุ่มนี้)
    roles: ['OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'SALES'],
  },
  {
    where: 'CustomersPage.tsx — gate ด้วย `canCreateCustomer`',
    label: '+ เพิ่มลูกค้าใหม่',
    path: '/customer-intake',
    // = @Roles ของ POST /customers และ POST /customers/pre-check/:id/complete
    roles: ['OWNER', 'BRANCH_MANAGER', 'SALES'],
  },
  {
    where: 'CustomerIntakePage/components/FullIntakeStep.tsx — แถบลูกค้าเดิม',
    label: 'ทำสัญญาต่อ',
    path: '/contracts/create',
    roles: ['OWNER', 'BRANCH_MANAGER', 'SALES'],
  },
];

describe('ปุ่มในหน้าจอต้องพาไปหน้าที่ role นั้นเข้าได้จริง', () => {
  it.each(RENDERED_CTAS)('$label ($where)', ({ label, path, roles }) => {
    for (const role of roles) {
      expect(
        isReachable(role, path),
        `${role} เห็นปุ่ม "${label}" แต่เข้า ${path} ไม่ได้ → MainLayout จะเด้งกลับ Dashboard`,
      ).toBe(true);
    }
  });

  // route /credit-checks เปิดให้ 4 บทบาท — ทุกตัวต้องมีเมนูพาไป ไม่งั้นเป็นหน้าที่
  // เข้าได้แต่หาไม่เจอ (และพิมพ์ URL เองก็โดนเด้งเพราะไม่อยู่ใน sidebar ตัวเอง)
  it.each(['OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'SALES'])(
    '%s เข้า /credit-checks ได้',
    (role) => {
      expect(isReachable(role, '/credit-checks')).toBe(true);
    },
  );

  it('บทบาทที่สร้างลูกค้าไม่ได้ ต้องไม่มี /customer-intake ในเมนู', () => {
    // ถ้ามีในเมนู = มีทางเข้า wizard ที่ตันที่ปุ่มบันทึก (API ปฏิเสธ)
    for (const role of ['FINANCE_MANAGER', 'ACCOUNTANT']) {
      expect(
        resolveZoneForPath(role, '/customer-intake'),
        `${role} ไม่ควรมี /customer-intake ในเมนู — API ไม่ให้สร้างลูกค้า`,
      ).toBeNull();
    }
  });
});
