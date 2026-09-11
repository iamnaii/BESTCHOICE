import { describe, it, expect } from 'vitest';
import { COMPANY_ACCESS_ROLES } from './company-access';
import {
  SELF_APPROVAL_ROLES,
  canApproveAccountingDoc,
  canSelfApproveAccountingDoc,
} from './accounting-self-approval';

describe('canSelfApproveAccountingDoc', () => {
  // ไล่ครบทุก role ที่มีจริงในระบบ ไม่ใช่แค่ตัวที่นึกออก — role ใหม่ที่เพิ่มเข้ามาแล้วลืม
  // ตัดสินใจ จะถูกจับตรงนี้ว่า "ยังไม่ได้เคาะ" แทนที่จะหลุดเป็นอนุมัติเองได้เงียบ ๆ
  const expected: Array<[string, boolean]> = [
    ['OWNER', true],
    ['FINANCE_MANAGER', true],
    ['BRANCH_MANAGER', true],
    ['ACCOUNTANT', false],
    ['SALES', false],
    ['VIEWER', false],
  ];

  it('ครอบคลุม role ทั้งหมดที่ระบบมี (ไม่มีตัวไหนตกสำรวจ)', () => {
    expect(expected.map(([role]) => role).sort()).toEqual([...COMPANY_ACCESS_ROLES].sort());
  });

  it.each(expected)('%s → %s', (role, allowed) => {
    expect(canSelfApproveAccountingDoc(role)).toBe(allowed);
  });

  it('SELF_APPROVAL_ROLES ตรงกับรายชื่อที่เจ้าของเคาะ', () => {
    expect([...SELF_APPROVAL_ROLES].sort()).toEqual(
      ['BRANCH_MANAGER', 'FINANCE_MANAGER', 'OWNER'],
    );
  });

  // fail-closed: เดาไม่ได้ = ไม่ให้ ต่างจาก resolveCompanyAccess ที่ fail-open
  it.each([null, undefined, '', 'SUPER_ADMIN', 'owner'])('role ที่ไม่รู้จัก (%s) = ไม่ได้', (role) => {
    expect(canSelfApproveAccountingDoc(role as string | null | undefined)).toBe(false);
  });
});

describe('canApproveAccountingDoc', () => {
  it('เอกสารของคนอื่น = อนุมัติได้ทุก role (ด่านสิทธิ์ EXPENSE_APPROVE อยู่คนละชั้น)', () => {
    for (const role of COMPANY_ACCESS_ROLES) {
      expect(
        canApproveAccountingDoc({ role, actorUserId: 'u1', documentCreatedById: 'u2' }),
      ).toBe(true);
    }
  });

  it('เอกสารตัวเอง = เฉพาะผู้จัดการขึ้นไป', () => {
    expect(
      canApproveAccountingDoc({ role: 'FINANCE_MANAGER', actorUserId: 'u1', documentCreatedById: 'u1' }),
    ).toBe(true);
    expect(
      canApproveAccountingDoc({ role: 'ACCOUNTANT', actorUserId: 'u1', documentCreatedById: 'u1' }),
    ).toBe(false);
  });

  // ใบที่ผู้สร้างถูกลบ/ไม่มีค่า ต้องไม่กลายเป็น "เอกสารตัวเอง" เพราะ null === null
  it('ผู้สร้างหรือผู้ใช้เป็นค่าว่าง = ไม่นับว่าเป็นเอกสารตัวเอง', () => {
    expect(
      canApproveAccountingDoc({ role: 'ACCOUNTANT', actorUserId: null, documentCreatedById: null }),
    ).toBe(true);
    expect(
      canApproveAccountingDoc({ role: 'ACCOUNTANT', actorUserId: 'u1', documentCreatedById: null }),
    ).toBe(true);
  });
});
