import { ROLES_KEY } from '../../auth/decorators/roles.decorator';
import { EmployeesController } from '../employees.controller';

const rolesOf = (fn: any) => Reflect.getMetadata(ROLES_KEY, fn) as string[];

describe('EmployeesController roles', () => {
  const p = EmployeesController.prototype;
  it('management endpoints are OWNER-only', () => {
    for (const m of [p.list, p.findOne, p.provision, p.update, p.remove, p.provisionable]) {
      expect(rolesOf(m)).toEqual(['OWNER']);
    }
  });
  it('pickable stays broad for dropdown consumers', () => {
    expect(rolesOf(p.pickable)).toEqual(['OWNER', 'ACCOUNTANT', 'FINANCE_MANAGER']);
  });
});
