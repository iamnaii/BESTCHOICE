import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  COMPANY_ACCESS_ROLES,
  ROLE_COMPANY_ACCESS,
  UNKNOWN_ROLE_COMPANY_ACCESS,
  hasCompanyAccess,
  resolveCompanyAccess,
  roleCompanyAccess,
  type CompanyAccess,
  type CompanyAccessRole,
} from './company-access';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ROLE_COMPANY_ACCESS', () => {
  // key ต้องตรงกับ COMPANY_ACCESS_ROLES เป๊ะทั้งสองทาง — role ที่ตกหล่นจะเงียบไปตกที่
  // UNKNOWN_ROLE_COMPANY_ACCESS แทนที่จะได้ค่าที่ตั้งใจ (เทสต์ฝั่ง apps/api ยังไล่เทียบกับ
  // enum UserRole ของ Prisma อีกชั้นหนึ่ง)
  it('มี key ครบทั้ง 6 role และไม่มี key เกิน', () => {
    expect(Object.keys(ROLE_COMPANY_ACCESS).sort()).toEqual([...COMPANY_ACCESS_ROLES].sort());
  });

  const expected: Array<[CompanyAccessRole, CompanyAccess]> = [
    ['OWNER', { accessible: ['SHOP', 'FINANCE'], primary: 'SHOP' }],
    ['FINANCE_MANAGER', { accessible: ['SHOP', 'FINANCE'], primary: 'FINANCE' }],
    ['ACCOUNTANT', { accessible: ['SHOP', 'FINANCE'], primary: 'FINANCE' }],
    ['VIEWER', { accessible: ['SHOP', 'FINANCE'], primary: 'FINANCE' }],
    ['BRANCH_MANAGER', { accessible: ['SHOP'], primary: 'SHOP' }],
    ['SALES', { accessible: ['SHOP'], primary: 'SHOP' }],
  ];

  it.each(expected)('%s ได้สิทธิ์ตามตารางที่ derive จาก ZONE_CONFIG', (role, access) => {
    expect(ROLE_COMPANY_ACCESS[role]).toEqual(access);
  });
});

describe('resolveCompanyAccess', () => {
  it('array ว่าง = ยังไม่ตั้งค่า → คืนค่า default ของ role (นี่คือกฎที่ดับ outage 2026-09-08)', () => {
    expect(resolveCompanyAccess('SALES', [])).toEqual(ROLE_COMPANY_ACCESS.SALES);
  });

  it.each([undefined, null] as const)('ค่า %s ให้ผลเดียวกับ array ว่าง', (companies) => {
    expect(resolveCompanyAccess('OWNER', companies)).toEqual(ROLE_COMPANY_ACCESS.OWNER);
  });

  // เทสต์กัน regress ที่สำคัญที่สุดของไฟล์นี้: ห้าม union กับ default ของ role และห้าม widen
  // เป็น superset เด็ดขาด ไม่งั้น OWNER ที่ถูกจำกัดไว้ที่ FINANCE จะได้ SHOP คืนมาเงียบ ๆ
  // และ e2e เชิงลบ 4 ชุด (credit-payment-flow, trade-in-buyback ×2, staff-offer) จะแดง
  it('array ไม่ว่าง = บังคับใช้เป๊ะ ไม่ union กับค่า default ของ role', () => {
    expect(resolveCompanyAccess('OWNER', ['FINANCE'])).toEqual({
      accessible: ['FINANCE'],
      primary: 'FINANCE',
    });
  });

  it('primaryCompany เป็น null (สภาพจริงบน prod) → ใช้ accessible ตัวแรก', () => {
    expect(resolveCompanyAccess('ACCOUNTANT', ['SHOP', 'FINANCE'], null)).toEqual({
      accessible: ['SHOP', 'FINANCE'],
      primary: 'SHOP',
    });
  });

  it('primary ที่ไม่อยู่ใน accessible ถูก downgrade ลงมาเป็นตัวแรกของ accessible', () => {
    expect(resolveCompanyAccess('SALES', ['SHOP'], 'FINANCE')).toEqual({
      accessible: ['SHOP'],
      primary: 'SHOP',
    });
  });

  it('ค่าที่ไม่ใช่ SHOP/FINANCE ถูกกรองทิ้ง เหลือศูนย์ = ยังไม่ตั้งค่า → ค่า default ของ role', () => {
    expect(resolveCompanyAccess('SALES', ['GARBAGE'])).toEqual(ROLE_COMPANY_ACCESS.SALES);
  });
});

describe('roleCompanyAccess', () => {
  it('role ที่ไม่รู้จัก → fail-open พร้อมเตือนใน log', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(roleCompanyAccess('SOMETHING_NEW')).toEqual(UNKNOWN_ROLE_COMPANY_ACCESS);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('SOMETHING_NEW');
  });
});

describe('hasCompanyAccess', () => {
  it.each([
    ['SALES', [] as string[], 'SHOP', true],
    ['SALES', [] as string[], 'FINANCE', false],
    ['SALES', ['FINANCE'], 'SHOP', false],
  ])('role %s + companies %j ขอ %s → %s', (role, companies, required, allowed) => {
    expect(hasCompanyAccess(role as string, companies as string[], required as string)).toBe(
      allowed,
    );
  });
});
