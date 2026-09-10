import { UserRole } from '@prisma/client';
import { ROLE_COMPANY_ACCESS } from '@installment/shared';
import {
  countByRole,
  formatCountBlock,
  formatSampleLines,
  planUserCompanyUpdates,
} from './backfill-user-companies.cli';

// เทสต์ชุดนี้เคย import ROLE_ACCESS_MAP จากตัว CLI เอง — map นั้นถูกลบทิ้งแล้วเพราะเป็นสำเนา
// ที่สองของกฎ role → companies ตอนนี้ pin ที่ source of truth จริง (packages/shared/src/company-access.ts)
// ค่าที่ pin ไว้เปลี่ยนไป 2 จุดโดยตั้งใจ (FINANCE_MANAGER, VIEWER) ดูคอมเมนต์ในแต่ละ it
describe('Backfill user companies — role mapping policy', () => {
  it('OWNER has both companies, primary SHOP', () => {
    expect(ROLE_COMPANY_ACCESS.OWNER).toEqual({ accessible: ['SHOP', 'FINANCE'], primary: 'SHOP' });
  });

  it('ACCOUNTANT has both companies, primary FINANCE', () => {
    expect(ROLE_COMPANY_ACCESS.ACCOUNTANT).toEqual({
      accessible: ['SHOP', 'FINANCE'],
      primary: 'FINANCE',
    });
  });

  // เดิม pin ไว้ว่า FINANCE_MANAGER = ['FINANCE'] อย่างเดียว — ผิด และเป็นค่าที่ห้ามเขียนลง prod
  // เพราะ FINANCE_MANAGER_CONFIG มี sidebar section zone 'shop' จริงสองก้อน (fm-shop-ops,
  // fm-online-shop) การเขียน ['FINANCE'] ลงฐานจะลบ pill 'shop' ของ FM ทิ้งทั้งโซนแบบถาวร
  it('FINANCE_MANAGER has both companies, primary FINANCE', () => {
    expect(ROLE_COMPANY_ACCESS.FINANCE_MANAGER).toEqual({
      accessible: ['SHOP', 'FINANCE'],
      primary: 'FINANCE',
    });
  });

  // VIEWER ไม่เคยมีใน map เดิมเลย จึงตกไปที่ fallback ['SHOP'] ทั้งที่เมนู VIEWER เป็น fin เกือบทั้งหมด
  it('VIEWER has both companies, primary FINANCE', () => {
    expect(ROLE_COMPANY_ACCESS.VIEWER).toEqual({
      accessible: ['SHOP', 'FINANCE'],
      primary: 'FINANCE',
    });
  });

  it('SALES has only SHOP', () => {
    expect(ROLE_COMPANY_ACCESS.SALES.accessible).toEqual(['SHOP']);
  });

  it('BRANCH_MANAGER has only SHOP', () => {
    expect(ROLE_COMPANY_ACCESS.BRANCH_MANAGER.accessible).toEqual(['SHOP']);
  });

  // เทสต์ที่สำคัญที่สุดของไฟล์นี้: ทำให้ UNKNOWN_ROLE_COMPANY_ACCESS (fail-open) ไม่มีวันถูกใช้จริง
  // role ใหม่ที่เพิ่มใน enum UserRole แล้วลืมเพิ่มใน map จะทำ CI แดงที่นี่ก่อนขึ้น prod
  describe('exhaustiveness กับ enum UserRole', () => {
    it.each(Object.values(UserRole))('role %s มี entry ใน ROLE_COMPANY_ACCESS', (role) => {
      expect(ROLE_COMPANY_ACCESS[role]).toBeDefined();
    });

    it('ไม่มี key เกินจาก enum (map กับ enum ต้องเท่ากันเป๊ะ)', () => {
      expect(Object.keys(ROLE_COMPANY_ACCESS).sort()).toEqual(Object.values(UserRole).sort());
    });
  });
});

describe('Backfill user companies — การวางแผนก่อนเขียน', () => {
  const candidates = [
    { id: 'u1', email: 'sales@bestchoice.com', role: 'SALES' },
    { id: 'u2', email: 'fin@bestchoice.com', role: 'FINANCE_MANAGER' },
    { id: 'u3', email: 'sales2@bestchoice.com', role: 'SALES' },
  ];

  it('derive ค่าที่จะเขียนจาก role ผ่าน source of truth ตัวเดียว', () => {
    expect(planUserCompanyUpdates(candidates)).toEqual([
      { id: 'u1', email: 'sales@bestchoice.com', role: 'SALES', accessible: ['SHOP'], primary: 'SHOP' },
      {
        id: 'u2',
        email: 'fin@bestchoice.com',
        role: 'FINANCE_MANAGER',
        accessible: ['SHOP', 'FINANCE'],
        primary: 'FINANCE',
      },
      { id: 'u3', email: 'sales2@bestchoice.com', role: 'SALES', accessible: ['SHOP'], primary: 'SHOP' },
    ]);
  });

  it('คัดลอก array ออกมาใหม่ ไม่ส่ง reference ของ ROLE_COMPANY_ACCESS ให้ Prisma', () => {
    const [first] = planUserCompanyUpdates([candidates[0]]);
    expect(first.accessible).not.toBe(ROLE_COMPANY_ACCESS.SALES.accessible);
  });

  it('นับต่อ role ตามลำดับใน ROLE_COMPANY_ACCESS', () => {
    expect(countByRole(planUserCompanyUpdates(candidates))).toEqual([
      { role: 'FINANCE_MANAGER', count: 1 },
      { role: 'SALES', count: 2 },
    ]);
  });

  // RESULT ต้องมี label ตรงกับ SUMMARY บรรทัดต่อบรรทัด แม้ role นั้นจะเขียนจริงได้ 0 แถว
  it('roleOrder บังคับให้ RESULT เรียงเหมือน SUMMARY และคง role ที่ได้ 0 ไว้', () => {
    const plan = planUserCompanyUpdates(candidates);
    const order = countByRole(plan).map((c) => c.role);
    expect(countByRole([plan[0]], order)).toEqual([
      { role: 'FINANCE_MANAGER', count: 0 },
      { role: 'SALES', count: 1 },
    ]);
  });

  it('ทุกบรรทัดที่พิมพ์ขึ้นต้นด้วย TAG (Cloud Logging มี log ปนกัน)', () => {
    const plan = planUserCompanyUpdates(candidates);
    const lines = [
      ...formatCountBlock('SUMMARY', countByRole(plan), '  (would-update)'),
      ...formatSampleLines(plan),
    ];
    expect(lines.every((l) => l.startsWith('[backfill-user-companies]'))).toBe(true);
    expect(lines[0]).toBe('[backfill-user-companies] ===== SUMMARY =====');
    expect(lines.some((l) => l.includes('total') && l.endsWith(': 3  (would-update)'))).toBe(true);
  });

  it('ตัวอย่างจำกัดที่ 5 แถวแล้วต่อท้ายด้วย "... and N more"', () => {
    const many = Array.from({ length: 8 }, (_, i) => ({
      id: `u${i}`,
      email: `u${i}@bestchoice.com`,
      role: 'SALES',
    }));
    const lines = formatSampleLines(planUserCompanyUpdates(many));
    expect(lines).toHaveLength(6);
    expect(lines[5]).toContain('... and 3 more');
  });
});
