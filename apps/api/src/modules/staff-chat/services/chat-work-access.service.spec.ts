import { ForbiddenException } from '@nestjs/common';
import { roomWorkWhere } from './chat-work-access.service';

const actor = { id: 'staff-a', role: 'SALES', branchId: 'branch-a', accessibleCompanies: ['SHOP'] };
describe('work room policy', () => {
  it('fails closed for branchless sales before returning a query', () => {
    expect(() => roomWorkWhere({ ...actor, branchId: null }, { company: 'SHOP' })).toThrow(
      ForbiddenException,
    );
  });
  it('enforces explicit company grants even for an owner', () => {
    expect(() =>
      roomWorkWhere(
        { ...actor, role: 'OWNER', accessibleCompanies: ['FINANCE'] },
        { company: 'SHOP' },
      ),
    ).toThrow(ForbiddenException);
  });
  it('does not allow a branch filter to expand staff access', () => {
    expect(() => roomWorkWhere(actor, { company: 'SHOP', branchId: 'branch-b' })).toThrow(
      ForbiddenException,
    );
  });
  it('rejects a role that cannot read the original inbox', () => {
    expect(() => roomWorkWhere({ ...actor, role: 'VIEWER' }, { company: 'SHOP' })).toThrow(
      ForbiddenException,
    );
  });
});
