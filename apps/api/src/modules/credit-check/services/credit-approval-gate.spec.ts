import { CreditCheckOverrideService } from './credit-check-override.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { CreditCheckCrudService } from './credit-check-crud.service';

describe('FULL credit approval requires verified amounts', () => {
  it('includes the latest approval snapshot when reading credit for contract creation', async () => {
    const findFirst = jest.fn(async ({ include }) => ({ id: 'check', status: 'APPROVED',
      ...(include.approvals ? { approvals: [{ id: 'approved-amount' }] } : {}) }));
    const service = new CreditCheckCrudService({ creditCheck: { findFirst } } as unknown as PrismaService, {} as never);
    await expect(service.findLatestByCustomer('customer')).resolves.toMatchObject({ approvals: [{ id: 'approved-amount' }] });
  });
  it('rejects the old status-only approval without changing credit/customer or audit', async () => {
    const tx = { $queryRaw: jest.fn(), creditCheck: {
      findUnique: jest.fn().mockResolvedValue({ id: 'check', customerId: 'customer', checkType: 'FULL', status: 'MANUAL_REVIEW' }),
      update: jest.fn().mockResolvedValue({}), findFirst: jest.fn(),
    }, customer: { update: jest.fn() }, auditLog: { create: jest.fn() } };
    const service = new CreditCheckOverrideService({ ...tx, $transaction: jest.fn(fn => fn(tx)) } as unknown as PrismaService);
    await expect(service.overrideById('check', { status: 'APPROVED', overrideReason: 'ตรวจหลักฐานและต้องมีเพดานเป็นบาทก่อนอนุมัติ' }, 'manager', 'OWNER'))
      .rejects.toThrow(/ยอดผ่อน/);
    expect(tx.creditCheck.update).not.toHaveBeenCalled();
    expect(tx.customer.update).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
    expect(tx.$queryRaw.mock.calls.map(([sql]) => sql.join(''))).toEqual(
      expect.arrayContaining([expect.stringContaining('credit_checks')]),
    );
  });
});
