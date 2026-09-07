import { BadRequestException } from '@nestjs/common';
import { CreditCheckCrudService } from './credit-check-crud.service';
import { CreditCheckRiskService } from './credit-check-risk.service';
import { PrismaService } from '../../../prisma/prisma.service';

it.each(['ai-fields', 'auto-score', 'dti', 'contract-create'])(
  'does not overwrite a chat OCR snapshot through %s',
  async (endpoint) => {
    const db = {
      creditCheck: {
        findUnique: jest
          .fn()
          .mockResolvedValue({
            id: 'c',
            aiAnalysis: { source: 'chat-statement' },
            deletedAt: null,
            customer: { id: 'customer', salary: 20000 },
            statementFiles: [],
          }),
        update: jest.fn(),
      },
      contract: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn().mockResolvedValue({ id: 'contract', customerId: 'customer' }),
      },
      customer: { findUnique: jest.fn().mockResolvedValue({ id: 'customer' }) },
    };
    const risk = new CreditCheckRiskService(db as unknown as PrismaService);
    const crud = new CreditCheckCrudService(db as unknown as PrismaService, risk);
    const action =
      endpoint === 'ai-fields'
        ? crud.updateWithAiFields('c', { statementAvgIncome: 9999 })
        : endpoint === 'auto-score'
          ? risk.getAutoScore('c')
          : endpoint === 'dti'
            ? risk.calculateDtiRiskScore('c', {})
            : crud.create('contract', { statementFiles: [] }, 'sales');
    await expect(action).rejects.toThrow(BadRequestException);
    expect(db.creditCheck.update).not.toHaveBeenCalled();
  },
);

it('does not treat imported chat history as a duplicate of a fresh statement submission', async () => {
  const db = {
    creditCheck: { findFirst: jest.fn().mockResolvedValue({ id: 'previous' }) },
    customer: { findUnique: jest.fn().mockResolvedValue({ id: 'customer' }) },
  };
  const crud = new CreditCheckCrudService(
    db as unknown as PrismaService,
    {} as CreditCheckRiskService,
  );
  await crud.createForCustomer(
    'customer',
    { bankName: 'BANK', statementFiles: [], statementMonths: 3 },
    'sales',
  );
  expect(db.creditCheck.findFirst).toHaveBeenCalledWith(
    expect.objectContaining({ where: expect.objectContaining({ roomAnalysis: { is: null } }) }),
  );
});


it.each(['customer', 'contract'])('locks the customer while inserting a new FULL check via %s', async endpoint => {
  const events: string[] = [];
  const tx = { $queryRaw: jest.fn(async () => { events.push('lock'); }),
    creditCheck: { create: jest.fn(async () => { events.push('create'); return { id: 'new' }; }) } };
  const db = { $transaction: jest.fn(async callback => { events.push('begin'); const result = await callback(tx); events.push('commit'); return result; }),
    creditCheck: { findFirst: jest.fn().mockResolvedValue(null), findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn(async () => { events.push('unlocked create'); return { id: 'new' }; }) },
    customer: { findUnique: jest.fn().mockResolvedValue({ id: 'customer' }) },
    contract: { findUnique: jest.fn().mockResolvedValue({ id: 'contract', customerId: 'customer' }) } };
  const risk = { calculateRiskScore: jest.fn().mockRejectedValue(new Error('synthetic disabled')) };
  const crud = new CreditCheckCrudService(db as unknown as PrismaService, risk as unknown as CreditCheckRiskService);
  if (endpoint === 'customer') await crud.createForCustomer('customer', { statementFiles: [] }, 'sales');
  else await crud.create('contract', { statementFiles: [] }, 'sales');
  expect(events).toEqual(['begin', 'lock', 'create', 'commit']);
});
