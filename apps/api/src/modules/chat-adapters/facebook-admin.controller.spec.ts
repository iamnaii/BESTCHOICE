/**
 * FacebookAdminController — guard + @Roles metadata (Task 9, Fix round 1).
 *
 * This controller had no spec file at all before this task, so a mutation
 * that weakened `setup-messenger-profile` from `@Roles('OWNER')` to
 * `@Roles('SALES')` (or dropped the class-level guards) would silently pass
 * the full jest run. These are pure Reflector metadata assertions (no DB /
 * HTTP needed) — same pattern as `dashboard.controller.spec.ts` and
 * `asset/__tests__/asset.controller.spec.ts`.
 */
import 'reflect-metadata';
import { Reflector } from '@nestjs/core';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { ROLES_KEY } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { FacebookAdminController } from './facebook-admin.controller';

describe('FacebookAdminController — guard + @Roles metadata', () => {
  const reflector = new Reflector();

  const methodRoles = (methodName: string): string[] | undefined => {
    const handler = (FacebookAdminController.prototype as unknown as Record<string, unknown>)[
      methodName
    ];
    if (typeof handler !== 'function') return undefined;
    return reflector.get<string[]>(ROLES_KEY, handler as () => void);
  };

  it('class-level guards include JwtAuthGuard + RolesGuard', () => {
    const guards = Reflect.getMetadata(GUARDS_METADATA, FacebookAdminController) as
      | unknown[]
      | undefined;
    expect(guards).toBeDefined();
    expect(guards).toContain(JwtAuthGuard);
    expect(guards).toContain(RolesGuard);
  });

  it.each(['backfillProfiles', 'setupMessengerProfile'])(
    "%s() is OWNER-only (@Roles metadata equals exactly ['OWNER'])",
    (methodName) => {
      const roles = methodRoles(methodName);
      expect(roles).toEqual(['OWNER']);
    },
  );
});
