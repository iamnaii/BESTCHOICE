/**
 * source of truth เดียวของ "role ไหนเข้าถึงบริษัทไหนได้" — ใช้ร่วมกันทั้ง apps/api และ apps/web
 *
 * ทำไมต้องอยู่ที่นี่: users.accessible_companies เป็น String[] @default([]) ที่ไม่เคยมีเส้นทางไหน
 * เขียนค่าให้ พอ 2026-09-08 ฝั่ง web เอาไปกรอง work zone ด้วยการเช็ค `!companies` — และ array ว่าง
 * เป็น truthy ใน JS — โซนจึงถูกกรองทิ้งหมดและทุกคนเห็นหน้าจอ "ไม่มีสิทธิ์เข้าถึงบริษัท" ส่วนฝั่ง api
 * (EntityScopeGuard) ก็ 403 ด้วยเหตุผลเดียวกันมาตั้งแต่ พ.ค. กฎ "array ว่าง = ยังไม่ตั้งค่า ไม่ใช่
 * ไม่มีสิทธิ์" จึงต้องมีอยู่ชุดเดียวและถูกเรียกจากทั้งสองแอป ไม่ใช่ต่างคนต่างเช็คแบบเดิม
 */

export type Company = 'SHOP' | 'FINANCE';
export const COMPANIES = ['SHOP', 'FINANCE'] as const;

export interface CompanyAccess {
  accessible: readonly Company[];
  primary: Company;
}

// รายชื่อ role ครบตาม enum UserRole ใน apps/api/prisma/schema.prisma:18-30 (6 ค่า)
// อย่าใช้ UserRole จาก packages/shared/src/constants.ts — ตัวนั้นมีแค่ 5 ค่า ไม่มี VIEWER
export const COMPANY_ACCESS_ROLES = [
  'SALES',
  'BRANCH_MANAGER',
  'ACCOUNTANT',
  'FINANCE_MANAGER',
  'OWNER',
  'VIEWER',
] as const;
export type CompanyAccessRole = (typeof COMPANY_ACCESS_ROLES)[number];

// ค่าชุดนี้ derive จาก ZONE_CONFIG (apps/web/src/config/menu.ts) ด้วยกฎ "บริษัทเริ่มต้นของ role
// = บริษัทของ zone ที่ role นั้นมี sidebar section จริง" ไม่ใช่ลอกจาก map เดิมของ CLI backfill —
// ผลคือเมื่อเอาชุดนี้ไปแทนกรณี "ไม่ได้ระบุ companies" ผลลัพธ์ของทั้ง 6 role เท่าพฤติกรรมเดิมเป๊ะ
export const ROLE_COMPANY_ACCESS: Record<CompanyAccessRole, CompanyAccess> = {
  OWNER:           { accessible: ['SHOP', 'FINANCE'], primary: 'SHOP' },
  FINANCE_MANAGER: { accessible: ['SHOP', 'FINANCE'], primary: 'FINANCE' },
  ACCOUNTANT:      { accessible: ['SHOP', 'FINANCE'], primary: 'FINANCE' },
  VIEWER:          { accessible: ['SHOP', 'FINANCE'], primary: 'FINANCE' },
  BRANCH_MANAGER:  { accessible: ['SHOP'],            primary: 'SHOP' },
  SALES:           { accessible: ['SHOP'],            primary: 'SHOP' },
};

// role ที่ไม่รู้จัก = fail-OPEN โดยตั้งใจ: การแยกบริษัทคือ data scoping ตามนิติบุคคล
// ไม่ใช่ขอบเขต authorization (@Roles + RolesGuard คือตัวคุมสิทธิ์จริง) เหตุการณ์นี้
// เกิดจาก fail-closed จึงต้องไม่ทิ้ง fail-closed ไว้ในเส้น fallback อีก
// มีเทสต์ exhaustiveness ฝั่ง apps/api (U6) ที่ทำให้ค่านี้ไม่มีวันถูกใช้จริง
export const UNKNOWN_ROLE_COMPANY_ACCESS: CompanyAccess = {
  accessible: ['SHOP', 'FINANCE'],
  primary: 'SHOP',
};

export function roleCompanyAccess(role: string): CompanyAccess {
  const hit = ROLE_COMPANY_ACCESS[role as CompanyAccessRole];
  if (hit) return hit;
  console.warn(`[company-access] role "${role}" ไม่มีใน ROLE_COMPANY_ACCESS — ใช้ค่า fail-open`);
  return UNKNOWN_ROLE_COMPANY_ACCESS;
}

/**
 * กฎเดียวที่ใช้ทั้ง web และ api:
 *   accessible ว่าง / null / undefined  = "ยังไม่ตั้งค่า" → คืนค่า default ของ role
 *   accessible ไม่ว่าง                   = บังคับใช้ตามนั้นเป๊ะ ห้าม union ห้าม widen
 * ห้ามเขียนเป็น "ถ้า role default เป็น superset ให้ใช้ role default" เด็ดขาด —
 * จะทำให้ e2e เชิงลบแดง 4 ชุด (credit-payment-flow:338, trade-in-buyback:115,182, staff-offer:112)
 */
export function resolveCompanyAccess(
  role: string,
  accessible?: readonly string[] | null,
  primary?: string | null,
): CompanyAccess {
  const valid = (accessible ?? []).filter((c): c is Company => c === 'SHOP' || c === 'FINANCE');
  if (valid.length === 0) return roleCompanyAccess(role);
  const p =
    (primary === 'SHOP' || primary === 'FINANCE') && valid.includes(primary) ? primary : valid[0];
  return { accessible: valid, primary: p };
}

/** true เมื่อ user เข้าถึง company นั้นได้ หลังผ่านกฎ empty→default แล้ว */
export function hasCompanyAccess(
  role: string,
  accessible: readonly string[] | null | undefined,
  required: string,
): boolean {
  return resolveCompanyAccess(role, accessible).accessible.includes(required as Company);
}
