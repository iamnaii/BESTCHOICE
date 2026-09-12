import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { assertSaleProductEligible } from './sale-product-policy';

describe('sale product policy shared by POS and booking conversion', () => {
  const product = { status: 'IN_STOCK', deletedAt: null, branchId: 'a', wasPreviouslyDamaged: false };
  const sales = { role: 'SALES', branchId: 'a' };
  it('requires the product branch to match the document even for OWNER', () => {
    expect(() => assertSaleProductEligible({ ...product, branchId: 'b' }, 'a', { role: 'OWNER' })).toThrow(ForbiddenException);
  });
  it.each([undefined, 'b'])('fails closed when a branch-scoped actor has branch %s', branchId => {
    expect(() => assertSaleProductEligible(product, 'a', { role: 'SALES', branchId })).toThrow(ForbiddenException);
  });
  it.each(['SOLD_CASH', 'SOLD_INSTALLMENT', 'DAMAGED'])('rejects unavailable stock (%s)', status => {
    expect(() => assertSaleProductEligible({ ...product, status }, 'a', sales)).toThrow(BadRequestException);
  });
  it('rejects deleted stock', () => {
    expect(() => assertSaleProductEligible({ ...product, deletedAt: new Date() }, 'a', sales)).toThrow(BadRequestException);
  });
  it.each(['SALES', 'BRANCH_MANAGER'])('%s cannot bypass damage authorization by acknowledging', role => {
    expect(() => assertSaleProductEligible({ ...product, wasPreviouslyDamaged: true }, 'a', { role, branchId: 'a' }, true)).toThrow(ForbiddenException);
  });
  it.each(['OWNER', 'FINANCE_MANAGER'])('%s needs explicit acknowledgement of damage', role => {
    const damaged = { ...product, wasPreviouslyDamaged: true };
    expect(() => assertSaleProductEligible(damaged, 'a', { role })).toThrow(BadRequestException);
    expect(() => assertSaleProductEligible(damaged, 'a', { role }, true)).not.toThrow();
  });
  it('allows an ordinary sale at the assigned branch', () => {
    expect(() => assertSaleProductEligible(product, 'a', sales)).not.toThrow();
  });
});
