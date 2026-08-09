/**
 * ShopReservationAdminController — guard + @Roles metadata (Task 9 review Minor 2).
 *
 * Reviewer mutation พิสูจน์แล้วว่า widening `release` เป็น SALES ไม่ทำให้เทสต์ไหนแดง
 * — เคสเดียวกับ FacebookAdminController (B4 Task 9) จึงใช้ Reflector pattern เดียวกัน
 * pin ไว้: list = 5 roles, release = OWNER/BM เท่านั้น
 */
import 'reflect-metadata';
import { Reflector } from '@nestjs/core';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { ROLES_KEY } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { ShopReservationAdminController } from './shop-reservation.admin.controller';

describe('ShopReservationAdminController — guard + @Roles metadata', () => {
  const reflector = new Reflector();

  const methodRoles = (methodName: string): string[] | undefined => {
    const handler = (
      ShopReservationAdminController.prototype as unknown as Record<string, unknown>
    )[methodName];
    if (typeof handler !== 'function') return undefined;
    return reflector.get<string[]>(ROLES_KEY, handler as () => void);
  };

  it('class-level guards include JwtAuthGuard + RolesGuard', () => {
    const guards = Reflect.getMetadata(GUARDS_METADATA, ShopReservationAdminController) as
      | unknown[]
      | undefined;
    expect(guards).toBeDefined();
    expect(guards).toContain(JwtAuthGuard);
    expect(guards).toContain(RolesGuard);
  });

  it('class-level @Roles ครอบ list ครบ 5 บทบาท', () => {
    const classRoles = reflector.get<string[]>(ROLES_KEY, ShopReservationAdminController);
    expect(classRoles).toEqual([
      'OWNER',
      'BRANCH_MANAGER',
      'FINANCE_MANAGER',
      'ACCOUNTANT',
      'SALES',
    ]);
    // list() ไม่มี override ระดับเมธอด — ใช้ของ class
    expect(methodRoles('list')).toBeUndefined();
  });

  it("release() จำกัด OWNER/BM เท่านั้น (@Roles metadata equals exactly ['OWNER','BRANCH_MANAGER'])", () => {
    expect(methodRoles('release')).toEqual(['OWNER', 'BRANCH_MANAGER']);
  });
});
