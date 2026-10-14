import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { makeExpenseDocumentsService } from './support/make-expense-documents-service';

describe('issued voucher number lookup', () => {
  const findFirst = jest.fn();
  const { service } = makeExpenseDocumentsService({ prisma: { expenseDocument: { findFirst } } });
  beforeEach(() => findFirst.mockReset());

  it('looks up the exact number without the list default that hides voided documents', async () => {
    findFirst.mockResolvedValue({ id: 'doc', number: 'PV-202610-00001' });
    await expect(service.resolveNumber('pv-202610-00001', { role: 'OWNER' })).resolves.toEqual({ id: 'doc', number: 'PV-202610-00001' });
    expect(findFirst).toHaveBeenCalledWith({
      where: { number: { equals: 'pv-202610-00001', mode: 'insensitive' }, deletedAt: null },
      select: { id: true, number: true },
    });
  });
  it('pins a manager to their branch and returns no match without disclosing another branch', async () => {
    findFirst.mockResolvedValue(null);
    await expect(service.resolveNumber('EX-2610-001', { role: 'BRANCH_MANAGER', branchId: 'branch-a' })).rejects.toBeInstanceOf(NotFoundException);
    expect(findFirst.mock.calls[0][0].where.branchId).toBe('branch-a');
  });
  it('rejects an unassigned manager before querying the database', async () => {
    await expect(service.resolveNumber('EX-2610-001', { role: 'BRANCH_MANAGER' })).rejects.toBeInstanceOf(ForbiddenException);
    expect(findFirst).not.toHaveBeenCalled();
  });
});
