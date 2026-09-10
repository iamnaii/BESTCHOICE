import { Reflector } from '@nestjs/core';
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { EntityScopeGuard } from './entity-scope.guard';

describe('EntityScopeGuard', () => {
  let guard: EntityScopeGuard;
  let reflector: Reflector;

  beforeEach(() => {
    reflector = new Reflector();
    guard = new EntityScopeGuard(reflector);
  });

  function mkCtx(opts: { userCompanies?: string[]; role?: string; noUser?: boolean }): ExecutionContext {
    return {
      switchToHttp: () => ({
        getRequest: () =>
          opts.noUser
            ? {}
            : {
                user: {
                  role: opts.role ?? 'OWNER',
                  accessibleCompanies: opts.userCompanies ?? ['SHOP', 'FINANCE'],
                },
              },
      }),
      getHandler: () => 'handler',
      getClass: () => 'class',
    } as any;
  }

  it('allows when no @Entity decoration', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);
    expect(guard.canActivate(mkCtx({ userCompanies: ['SHOP'] }))).toBe(true);
  });

  it('allows @Entity(SHOP) when user has SHOP', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue('SHOP');
    expect(guard.canActivate(mkCtx({ userCompanies: ['SHOP'] }))).toBe(true);
  });

  it('rejects @Entity(FINANCE) when user only has SHOP', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue('FINANCE');
    expect(() => guard.canActivate(mkCtx({ userCompanies: ['SHOP'] }))).toThrow(ForbiddenException);
  });

  // เทสต์ตัวนี้เดิมชื่อ 'rejects when user has empty accessibleCompanies' และ pin พฤติกรรมที่เป็น
  // ต้นเหตุของบั๊ก (403 ใส่ทุกคนที่ยังไม่ backfill) — กลับด้านโดยตั้งใจ ไม่ใช่ลบทิ้ง
  it('ไม่ล็อกผู้ใช้ที่ยังไม่ backfill — array ว่าง = ใช้ค่า default ของ role', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue('SHOP');
    expect(guard.canActivate(mkCtx({ userCompanies: [], role: 'SALES' }))).toBe(true);
  });

  it('array ว่างไม่ได้แปลว่าเปิดหมด — SALES ยังเข้า FINANCE ไม่ได้', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue('FINANCE');
    expect(() => guard.canActivate(mkCtx({ userCompanies: [], role: 'SALES' }))).toThrow(
      ForbiddenException,
    );
  });

  it('array ไม่ว่างบังคับเป๊ะ — OWNER ที่ถูกจำกัดเป็น FINANCE เข้า SHOP ไม่ได้', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue('SHOP');
    expect(() => guard.canActivate(mkCtx({ userCompanies: ['FINANCE'], role: 'OWNER' }))).toThrow(
      ForbiddenException,
    );
  });

  it('rejects when request has no user at all', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue('SHOP');
    expect(() => guard.canActivate(mkCtx({ noUser: true }))).toThrow(ForbiddenException);
  });

  it('allows OWNER (both) on FINANCE handler', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue('FINANCE');
    expect(guard.canActivate(mkCtx({ userCompanies: ['SHOP', 'FINANCE'] }))).toBe(true);
  });
});
