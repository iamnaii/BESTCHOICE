import { ForbiddenException } from '@nestjs/common';
import { projectSaleForActor, salesBranchWhere } from './sales-read-policy';

describe('projectSaleForActor — receipt token never leaves the read API', () => {
  const sale = {
    id: 's1', saleNumber: 'SL-1',
    receiptToken: 'secret-bearer-token', receiptTokenExpiresAt: new Date('2026-11-22T00:00:00Z'),
    costSnapshot: null, product: { id: 'p1', costPrice: '1' }, customer: { id: 'c1', nationalId: null },
  };
  it.each(['OWNER', 'SALES'])('%s payload carries neither receiptToken nor receiptTokenExpiresAt', role => {
    const projected = projectSaleForActor(sale, { id: 'u1', role, branchId: 'a' });
    expect(JSON.stringify(projected)).not.toContain('secret-bearer-token');
    expect(projected).not.toHaveProperty('receiptToken');
    expect(projected).not.toHaveProperty('receiptTokenExpiresAt');
    expect(projected.saleNumber).toBe('SL-1');
  });
});

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
