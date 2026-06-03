/**
 * AssetController — reverse-permission metadata tests.
 *
 * Audit Finding A: reverse permission must be UNIFORM across the three
 * accounting modules (Other Income, Expense, Asset). Before this change the
 * Asset reverse endpoints used a hardcoded `@Roles('OWNER')` and ignored the
 * dynamic `reverse_permission` SystemConfig mode entirely — so a
 * FINANCE_MANAGER could reverse Other Income / Expense documents but NOT
 * Assets, and the Settings "สิทธิ์การยกเลิก/กลับรายการ" card had no effect on
 * the Asset module.
 *
 * The fix mirrors the Expense `void` endpoint: a coarse `@Roles` superset
 * (OWNER + FINANCE_MANAGER) so RolesGuard lets through anyone the dynamic
 * guard might allow, then `ReversePermissionGuard` narrows per request.
 *
 * These are Reflector metadata tests (no DB / HTTP needed) — the dynamic
 * narrowing logic itself is covered by the shared ReversePermissionGuard spec.
 */
import 'reflect-metadata';
import { Reflector } from '@nestjs/core';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { ROLES_KEY } from '../../auth/decorators/roles.decorator';
import { ReversePermissionGuard } from '../../auth/guards/reverse-permission.guard';
import { AssetController } from '../asset.controller';

describe('AssetController — reverse permission metadata (Audit Finding A)', () => {
  const reflector = new Reflector();

  const methodRoles = (methodName: string): string[] | undefined => {
    const handler = (AssetController.prototype as unknown as Record<string, unknown>)[methodName];
    if (typeof handler !== 'function') return undefined;
    return reflector.get<string[]>(ROLES_KEY, handler as () => void);
  };

  const methodGuards = (methodName: string): unknown[] | undefined => {
    const handler = (AssetController.prototype as unknown as Record<string, unknown>)[methodName];
    if (typeof handler !== 'function') return undefined;
    return Reflect.getMetadata(GUARDS_METADATA, handler as object) as unknown[] | undefined;
  };

  it.each(['reverse', 'reverseDispose'])(
    '%s() coarse @Roles allows OWNER + FINANCE_MANAGER + ACCOUNTANT (no longer OWNER-only; guard narrows)',
    (methodName) => {
      const roles = methodRoles(methodName);
      expect(roles).toBeDefined();
      expect(roles).toEqual(
        expect.arrayContaining(['OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT']),
      );
      expect(roles).not.toContain('SALES');
    },
  );

  it.each(['reverse', 'reverseDispose'])(
    '%s() is gated by ReversePermissionGuard (uniform dynamic mode)',
    (methodName) => {
      const guards = methodGuards(methodName);
      expect(guards).toBeDefined();
      expect(guards).toContain(ReversePermissionGuard);
    },
  );

  it('getVendorNames() is read-only — allows OWNER + BRANCH_MANAGER + FINANCE_MANAGER + ACCOUNTANT, not SALES', () => {
    const roles = methodRoles('getVendorNames');
    expect(roles).toBeDefined();
    expect(roles).toEqual(
      expect.arrayContaining([
        'OWNER',
        'BRANCH_MANAGER',
        'FINANCE_MANAGER',
        'ACCOUNTANT',
      ]),
    );
    expect(roles).not.toContain('SALES');
  });
});
