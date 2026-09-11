import { ExecutionContext, ForbiddenException, NotFoundException } from '@nestjs/common';
import { ReceiptAccessGuard } from './receipt-access.guard';
import { PrismaService } from '../../prisma/prisma.service';

describe('ReceiptAccessGuard', () => {
  const branchA = 'branch-a';
  const branchB = 'branch-b';
  const prisma = {
    contract: { findUnique: jest.fn() },
    receipt: { findFirst: jest.fn() },
  };
  const guard = new ReceiptAccessGuard(prisma as unknown as PrismaService);
  const context = (user: { role: string; branchId: string | null } | undefined, params: Record<string, string>) =>
    ({ switchToHttp: () => ({ getRequest: () => ({ user, params }) }) }) as unknown as ExecutionContext;

  beforeEach(() => {
    prisma.contract.findUnique.mockReset();
    prisma.receipt.findFirst.mockReset();
  });

  it.each(['OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT'])('lets %s through without a lookup', async (role) => {
    await expect(guard.canActivate(context({ role, branchId: null }, { id: 'r1' }))).resolves.toBe(true);
    expect(prisma.receipt.findFirst).not.toHaveBeenCalled();
  });

  it('rejects requests without an authenticated user', async () => {
    await expect(guard.canActivate(context(undefined, { id: 'r1' }))).rejects.toBeInstanceOf(ForbiddenException);
  });

  it.each(['SALES', 'BRANCH_MANAGER'])('%s may read a receipt of their own branch only', async (role) => {
    prisma.receipt.findFirst.mockResolvedValueOnce({ contract: { branchId: branchA } });
    await expect(guard.canActivate(context({ role, branchId: branchA }, { id: 'r1' }))).resolves.toBe(true);
    prisma.receipt.findFirst.mockResolvedValueOnce({ contract: { branchId: branchB } });
    await expect(guard.canActivate(context({ role, branchId: branchA }, { id: 'r2' }))).rejects.toThrow('สาขาอื่น');
  });

  it('scopes by receipt number and by contract id as well', async () => {
    prisma.receipt.findFirst.mockResolvedValueOnce({ contract: { branchId: branchB } });
    await expect(guard.canActivate(context({ role: 'SALES', branchId: branchA }, { receiptNumber: 'RT-1' }))).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.receipt.findFirst).toHaveBeenLastCalledWith(expect.objectContaining({ where: { receiptNumber: 'RT-1', deletedAt: null } }));
    prisma.contract.findUnique.mockResolvedValueOnce({ branchId: branchA, deletedAt: null });
    await expect(guard.canActivate(context({ role: 'SALES', branchId: branchA }, { contractId: 'c1' }))).resolves.toBe(true);
  });

  it('answers 404 for unknown or deleted targets before leaking branch information', async () => {
    prisma.receipt.findFirst.mockResolvedValueOnce(null);
    await expect(guard.canActivate(context({ role: 'SALES', branchId: branchA }, { id: 'missing' }))).rejects.toBeInstanceOf(NotFoundException);
    prisma.contract.findUnique.mockResolvedValueOnce({ branchId: branchA, deletedAt: new Date() });
    await expect(guard.canActivate(context({ role: 'SALES', branchId: branchA }, { contractId: 'gone' }))).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects branch-bound users that have no branch, and passes routes that address nothing', async () => {
    prisma.receipt.findFirst.mockResolvedValueOnce({ contract: { branchId: branchA } });
    await expect(guard.canActivate(context({ role: 'SALES', branchId: null }, { id: 'r1' }))).rejects.toThrow('ยังไม่มีสาขา');
    await expect(guard.canActivate(context({ role: 'SALES', branchId: null }, {}))).resolves.toBe(true);
  });
});
