import { Reflector } from '@nestjs/core';
import { DashboardController } from './dashboard.controller';
import { ROLES_KEY } from '../auth/decorators/roles.decorator';

describe('DashboardController — @Roles metadata', () => {
  const reflector = new Reflector();

  it('excludes SALES from the class-level Roles list', () => {
    const classRoles = reflector.get<string[]>(ROLES_KEY, DashboardController);
    expect(classRoles).toBeDefined();
    expect(classRoles).not.toContain('SALES');
    expect(classRoles).toEqual(
      expect.arrayContaining(['OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT']),
    );
  });

  it('never allows SALES on any dashboard handler (direct or inherited)', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const proto = DashboardController.prototype as any;
    const handlerNames = Object.getOwnPropertyNames(proto).filter(
      (name) => name !== 'constructor',
    );

    for (const name of handlerNames) {
      const handler = proto[name];
      if (typeof handler !== 'function') continue;

      const methodRoles = reflector.get<string[]>(ROLES_KEY, handler);
      const classRoles = reflector.get<string[]>(ROLES_KEY, DashboardController);
      const effectiveRoles = methodRoles ?? classRoles ?? [];

      expect(effectiveRoles).not.toContain('SALES');
    }
  });
});
