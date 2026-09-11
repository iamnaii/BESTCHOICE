import { ForbiddenException } from '@nestjs/common';
import { salesBranchWhere } from './sales-read-policy';

describe('salesBranchWhere for internal service callers', () => {
  it.each(['SALES', 'BRANCH_MANAGER'])('%s is scoped even without a client branch filter', role => {
    expect(salesBranchWhere({ id: 'u1', role, branchId: 'a' })).toEqual({ branchId: 'a' });
    expect(() => salesBranchWhere({ id: 'u1', role, branchId: 'a' }, 'b')).toThrow(ForbiddenException);
  });
  it.each([undefined, null])('fails closed with a missing branch (%s)', branchId => {
    expect(salesBranchWhere({ id: 'u1', role: 'SALES', branchId })).toEqual({ id: { in: [] } });
    expect(salesBranchWhere({ id: 'u1', role: 'SALES', branchId }, 'b')).toEqual({ id: { in: [] } });
  });
  it.each(['OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT'])('%s can choose cross-branch report scope', role => {
    expect(salesBranchWhere({ id: 'u1', role })).toEqual({});
    expect(salesBranchWhere({ id: 'u1', role }, 'b')).toEqual({ branchId: 'b' });
  });
});
