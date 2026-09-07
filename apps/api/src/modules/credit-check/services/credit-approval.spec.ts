import { PrismaService } from '../../../prisma/prisma.service';
import { CreditApprovalService, claimCreditApproval, assertApprovalAmounts, bindExchangeCreditCheck } from './credit-approval';
import { Prisma } from '@prisma/client';

const input = { verifiedMonthlyIncome: 15000, livingExpenses: 9000, externalMonthlyDebt: 0,
  salaryPayDay: 25, evidenceNotes: 'ยืนยันรายได้ ค่าใช้จ่าย หนี้ และวันรับเงินกับลูกค้าจากเอกสารแล้ว' };
const customer = { id: 'customer', salary: 15000, salaryPayDay: 25, occupation: 'พนักงาน', workplace: 'บริษัท', deletedAt: null };
const check = { id: 'check', customerId: customer.id, customer, checkType: 'FULL', status: 'MANUAL_REVIEW',
  contractId: null, deletedAt: null, updatedAt: new Date('2026-09-07'), aiAnalysis: { source: 'chat-statement', monthlyIncome: 15000 }, statementFiles: ['statement.pdf'] };

function setup() {
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([{ id: customer.id }]),
    customer: { findUnique: jest.fn().mockResolvedValue(customer) },
    creditCheck: { findUnique: jest.fn().mockResolvedValue(check), findFirst: jest.fn().mockResolvedValue(check), updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    contract: { findMany: jest.fn().mockResolvedValue([]), findUnique: jest.fn().mockResolvedValue(null) },
    creditApproval: { findMany: jest.fn().mockResolvedValue([]), findFirst: jest.fn().mockResolvedValue(null),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }), create: jest.fn().mockImplementation(({ data }) => ({ id: 'approval', ...data })) },
  };
  const prisma = { ...tx, $transaction: jest.fn((fn) => fn(tx)) };
  return { tx, service: new CreditApprovalService(prisma as unknown as PrismaService) };
}

describe('credit approval snapshots', () => {
  it('compares the actual two-decimal installment stored by PostgreSQL', () => {
    expect(() => assertApprovalAmounts({ approvedMonthlyPayment: new Prisma.Decimal('100.70'), salaryPayDay: 25 },
      { paymentDueDay: 25, monthlyAmounts: [100.70000000000002] })).not.toThrow();
    expect(() => assertApprovalAmounts({ approvedMonthlyPayment: new Prisma.Decimal('100.70'), salaryPayDay: 25 },
      { paymentDueDay: 25, monthlyAmounts: [100.71] })).toThrow();
  });
  it('previews real store debt separately and does not write an approval', async () => {
    const { tx, service } = setup();
    tx.contract.findMany.mockResolvedValue([{ id: 'old', contractNumber: 'OLD', status: 'ACTIVE', monthlyPayment: 3000,
      payments: [{ amountDue: 3000, status: 'PENDING' }] }] as never);
    const result = await service.preview(check.id, input);
    expect(result).toMatchObject({ internalMonthlyDebt: 3000, maximumMonthlyPayment: 1500, salaryPayDay: 25 });
    expect(tx.creditApproval.create).not.toHaveBeenCalled();
  });

  it('freezes the confirmed basis, policy and payday without overwriting OCR', async () => {
    const { tx, service } = setup();
    const preview = await service.preview(check.id, input);
    const approved = await service.approveInTransaction(tx as never, check as never,
      { ...input, confirmed: true, contextToken: preview.contextToken, approvedMonthlyPayment: 2500 }, 'manager');
    expect(approved).toMatchObject({ approvedMonthlyPayment: 2500, maximumMonthlyPayment: 3000,
      salaryPayDay: 25, approvedById: 'manager', policyVersion: 'BC-2026-09-v1' });
    expect(check.aiAnalysis).toEqual({ source: 'chat-statement', monthlyIncome: 15000 });
  });

  it('binds preview to values, independently of request property order', async () => {
    const { tx, service } = setup();
    const preview = await service.preview(check.id, { evidenceNotes: input.evidenceNotes,
      salaryPayDay: 25, externalMonthlyDebt: 0, livingExpenses: 9000, verifiedMonthlyIncome: 15000 });
    await expect(service.approveInTransaction(tx as never, check as never,
      { ...input, confirmed: true, contextToken: preview.contextToken, approvedMonthlyPayment: 2500 }, 'manager'))
      .resolves.toMatchObject({ approvedMonthlyPayment: 2500 });
  });

  it.each([0, 3000.01, 4000])('refuses approval amount %s outside the verified limit', async amount => {
    const { tx, service } = setup();
    const preview = await service.preview(check.id, input);
    await expect(service.approveInTransaction(tx as never, check as never,
      { ...input, confirmed: true, contextToken: preview.contextToken, approvedMonthlyPayment: amount }, 'manager')).rejects.toThrow();
    expect(tx.creditApproval.create).not.toHaveBeenCalled();
  });

  it('refuses stale numbers when another contract appears after preview', async () => {
    const { tx, service } = setup();
    const preview = await service.preview(check.id, input);
    tx.contract.findMany.mockResolvedValue([{ id: 'new-debt', monthlyPayment: 4000, payments: [] }] as never);
    await expect(service.approveInTransaction(tx as never, check as never,
      { ...input, confirmed: true, contextToken: preview.contextToken, approvedMonthlyPayment: 2500 }, 'manager')).rejects.toThrow(/เปลี่ยน/);
    expect(tx.creditApproval.create).not.toHaveBeenCalled();
  });

  it('does not use PRE or an older FULL to open a contract', async () => {
    const { tx } = setup();
    await expect(claimCreditApproval(tx as never, { customerId: customer.id, contractId: 'new',
      monthlyAmounts: [1000], paymentDueDay: 25 })).rejects.toThrow(/อนุมัติ/);
  });

  it('rejects a stale bound-contract preview after another manager revises its approval', async () => {
    const { tx, service } = setup();
    const bound = { ...check, status: 'APPROVED', contractId: 'draft' };
    tx.creditCheck.findUnique.mockResolvedValue(bound);
    tx.creditApproval.findMany.mockImplementation(async ({ where }) =>
      where.usedByContractId === null ? [] : [{ id: 'old-approval', approvedMonthlyPayment: 2500 }] as never);
    const preview = await service.preview(check.id, input);
    tx.creditApproval.findMany.mockImplementation(async ({ where }) =>
      where.usedByContractId === null ? [] : [{ id: 'revised-approval', approvedMonthlyPayment: 2000 }] as never);
    await expect(service.approveInTransaction(tx as never, bound as never,
      { ...input, confirmed: true, contextToken: preview.contextToken, approvedMonthlyPayment: 2500 }, 'manager')).rejects.toThrow(/เปลี่ยน/);
  });

  it.each([{ amountDue: 3500, day: 25 }, { amountDue: 2000, day: 30 }])('rejects a bound contract that exceeds the approved amount or payday: %s', async terms => {
    const { tx, service } = setup();
    const bound = { ...check, contractId: 'draft' };
    tx.creditCheck.findUnique.mockResolvedValue(bound);
    Object.assign(tx.contract, { findUnique: jest.fn().mockResolvedValue({ id: 'draft', customerId: customer.id,
      paymentDueDay: terms.day, monthlyPayment: terms.amountDue, deletedAt: null,
      payments: [{ amountDue: terms.amountDue, dueDate: new Date(2026, 9, terms.day) }] }) });
    const preview = await service.preview(check.id, input);
    await expect(service.approveInTransaction(tx as never, bound as never,
      { ...input, confirmed: true, contextToken: preview.contextToken, approvedMonthlyPayment: 2500 }, 'manager')).rejects.toThrow();
    expect(tx.creditApproval.updateMany).not.toHaveBeenCalled();
  });
});


it('requires a fresh accessible FULL for an exchange and binds it without copying private documents', async () => {
  const { tx } = setup();
  tx.creditCheck.findFirst.mockResolvedValue(null as never);
  await expect(bindExchangeCreditCheck(tx as never, 'customer', 'replacement', { id: 'manager', role: 'OWNER' })).rejects.toThrow(/รอบใหม่/);
  expect(tx.creditCheck.updateMany).not.toHaveBeenCalled();
  tx.creditCheck.findFirst.mockResolvedValue(check);
  await bindExchangeCreditCheck(tx as never, 'customer', 'replacement', { id: 'manager', role: 'OWNER' });
  expect(tx.creditCheck.updateMany).toHaveBeenCalledWith(expect.objectContaining({
    where: expect.objectContaining({ id: 'check', contractId: null }), data: { contractId: 'replacement' },
  }));
});


it('does not double-count the old loan in a verified replacement contract', async () => {
  const { tx, service } = setup();
  tx.creditCheck.findUnique.mockResolvedValue({ ...check, contractId: 'replacement' } as never);
  tx.contract.findUnique.mockResolvedValue({ exchangedFromContractId: 'old',
    exchangeRequestsAsNew: [{ oldContractId: 'old', oldContract: { customerId: 'customer' } }] } as never);
  tx.contract.findMany.mockImplementation(async ({ where }) => where.id?.notIn?.includes('old') ? [] : [
    { id: 'old', contractNumber: 'OLD', monthlyPayment: 3000, payments: [{ amountDue: 3000, status: 'PENDING' }] },
  ] as never);
  await expect(service.preview('check', input)).resolves.toMatchObject({ internalMonthlyDebt: 0, maximumMonthlyPayment: 3000 });
});


it('preserves a rejected decision when a branch manager binds an exchange review', async () => {
  const { tx } = setup();
  tx.creditCheck.findFirst.mockResolvedValue({ ...check, status: 'REJECTED' } as never);
  await bindExchangeCreditCheck(tx as never, 'customer', 'replacement', { id: 'manager', role: 'BRANCH_MANAGER' });
  expect(tx.creditCheck.updateMany.mock.calls[0][0].data).not.toHaveProperty('status');
});
