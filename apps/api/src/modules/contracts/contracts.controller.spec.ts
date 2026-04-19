import { Reflector } from '@nestjs/core';
import { ContractsController } from './contracts.controller';
import { ROLES_KEY } from '../auth/decorators/roles.decorator';

/**
 * Covers the T1-C5 fix: contract approval/reject must NOT be reachable by
 * BRANCH_MANAGER. Letting BMs approve contracts enables BM↔BM peer approval
 * inside the same branch, bypassing central finance review. These tests pin
 * the @Roles metadata so a future edit cannot silently re-widen the set.
 */
describe('ContractsController — approve/reject role metadata', () => {
  const reflector = new Reflector();

  const rolesOn = (methodName: string): string[] | undefined => {
    const handler = (ContractsController.prototype as unknown as Record<string, unknown>)[
      methodName
    ];
    if (typeof handler !== 'function') return undefined;
    return reflector.get<string[]>(ROLES_KEY, handler);
  };

  it('POST /contracts/:id/approve is restricted to OWNER + FINANCE_MANAGER', () => {
    const roles = rolesOn('approve');
    expect(roles).toBeDefined();
    expect(roles).toEqual(expect.arrayContaining(['OWNER', 'FINANCE_MANAGER']));
    expect(roles).not.toContain('BRANCH_MANAGER');
    expect(roles).not.toContain('SALES');
    expect(roles).not.toContain('ACCOUNTANT');
  });

  it('POST /contracts/:id/reject mirrors approve (OWNER + FINANCE_MANAGER only)', () => {
    const roles = rolesOn('reject');
    expect(roles).toBeDefined();
    expect(roles).toEqual(expect.arrayContaining(['OWNER', 'FINANCE_MANAGER']));
    expect(roles).not.toContain('BRANCH_MANAGER');
  });
});
