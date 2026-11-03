import { BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import type { PrismaService } from '../../../prisma/prisma.service';
import { TEST_NAME_PREFIX } from '../../../utils/test-data-markers';
import { isRetryablePrismaWriteError } from '../../../utils/transaction-retry.util';
import { assertNoPendingBankRefund } from '../pending-bank-refund';
import { RefundsService } from '../refunds.service';

/**
 * Owner decision #24 on real PostgreSQL with two connections (Task 36 fix round 1 · review m-a): approving a refund vs
 * closing the same contract (early payoff JP4 = Serializable · device-return confirm JP5 = Read Committed).
 *
 * Approve side = the real `RefundsService.approveRefund` (row lock `FOR SHARE` → contract status → CAS → audit) with only
 * the actor/amount checks stubbed (they read permissions/receipts — unrelated to the race). The amount check is the pause
 * point: it runs after the `FOR SHARE` lock, so the approval holds the lock while the other side starts.
 * Close side = the exact sequence earlyPayoff / createInTx run: `SELECT … FROM contracts … FOR UPDATE` → the real
 * `assertNoPendingBankRefund` → write the contract.
 *
 * Pinned outcomes (every order is safe — neither a closed contract with an approved refund nor a lost decision):
 *   1. close first → the waiting approval fails 40001 on its raw lock (P2010) → **409** (review I-2) · retry → 400 closed
 *   2. approve first, JP4 (Serializable): the close gets the lock but reads with its old snapshot (no refund yet) — SSI
 *      aborts it (retryable error) · retry → 400 #24
 *   3. approve first, JP5 (Read Committed): the close waits, then sees the APPROVED refund → 400 #24
 *
 * Run: DATABASE_URL=<a *_test database> npx jest <this file> --runInBand · no DATABASE_URL = skipped
 */
const describeDb = process.env.DATABASE_URL ? describe : describe.skip;

describeDb('#24 approve refund vs close contract — two real connections', () => {
  const approver = new PrismaClient();
  const closer = new PrismaClient();
  const observer = new PrismaClient();
  const stamp = Date.now().toString(36).toUpperCase();
  const ids = {
    users: [] as string[],
    branch: '',
    contacts: [] as string[],
    customers: [] as string[],
  };
  const products: string[] = [];
  const contracts: string[] = [];
  let requesterId = '';
  let ownerId = '';

  beforeAll(async () => {
    const finance = await observer.companyInfo.findFirst({
      where: { companyCode: 'FINANCE', deletedAt: null },
      select: { id: true },
    });
    ids.branch = (
      await observer.branch.create({
        data: { name: `${TEST_NAME_PREFIX} T36 race ${stamp}`, companyId: finance?.id ?? null },
      })
    ).id;
    for (const role of ['SALES', 'OWNER'] as const) {
      const user = await observer.user.create({
        data: {
          email: `t36-race-${role.toLowerCase()}-${stamp.toLowerCase()}@bestchoice-test.internal`,
          password: 'hashed_placeholder',
          name: `${TEST_NAME_PREFIX} T36 ${role}`,
          role,
        },
      });
      ids.users.push(user.id);
      if (role === 'SALES') requesterId = user.id;
      else ownerId = user.id;
    }
  });

  afterAll(async () => {
    await observer.refund.deleteMany({ where: { contractId: { in: contracts } } });
    await observer.payment.deleteMany({ where: { contractId: { in: contracts } } });
    await observer.contract.deleteMany({ where: { id: { in: contracts } } });
    await observer.product.deleteMany({ where: { id: { in: products } } });
    await observer.customer.deleteMany({ where: { id: { in: ids.customers } } });
    await observer.contact.deleteMany({ where: { id: { in: ids.contacts } } });
    await observer.branch.deleteMany({ where: { id: ids.branch } });
    // audit_logs is immutable (DELETE trigger) and references the users → soft-delete the users instead
    await observer.user.updateMany({
      where: { id: { in: ids.users } },
      data: { deletedAt: new Date(), isActive: false },
    });
    await Promise.all([approver.$disconnect(), closer.$disconnect(), observer.$disconnect()]);
  });

  /** contract ACTIVE + installment 1 PAID + refund REQUESTED by someone else */
  async function fixture(key: string) {
    const contact = await observer.contact.create({
      data: { contactCode: `T36R-${stamp}-${key}`, name: `${TEST_NAME_PREFIX} T36 ${key}` },
    });
    ids.contacts.push(contact.id);
    const customer = await observer.customer.create({
      data: { name: `${TEST_NAME_PREFIX} T36 ${key}`, contactId: contact.id },
    });
    ids.customers.push(customer.id);
    const product = await observer.product.create({
      data: {
        name: `${TEST_NAME_PREFIX} T36 ${key}`,
        brand: 'TestBrand',
        model: 'TestModel',
        imeiSerial: `TEST-T36R-${stamp}-${key}`,
        category: 'PHONE_NEW',
        costPrice: new Prisma.Decimal('8000.00'),
        branchId: ids.branch,
      },
    });
    products.push(product.id);
    const contract = await observer.contract.create({
      data: {
        contractNumber: `TEST-T36R-${stamp}-${key}`,
        customerId: customer.id,
        productId: product.id,
        branchId: ids.branch,
        salespersonId: requesterId,
        planType: 'STORE_WITH_INTEREST',
        sellingPrice: new Prisma.Decimal('12000.00'),
        downPayment: new Prisma.Decimal('2000.00'),
        financedAmount: new Prisma.Decimal('10000.00'),
        interestRate: new Prisma.Decimal('0.6000'),
        totalMonths: 12,
        interestTotal: new Prisma.Decimal('6000.00'),
        monthlyPayment: new Prisma.Decimal('1515.84'),
        status: 'ACTIVE',
      },
    });
    contracts.push(contract.id);
    const payment = await observer.payment.create({
      data: {
        contractId: contract.id,
        installmentNo: 1,
        dueDate: new Date('2026-10-01T00:00:00+07:00'),
        amountDue: new Prisma.Decimal('1515.84'),
        amountPaid: new Prisma.Decimal('1515.84'),
        status: 'PAID',
      },
    });
    const refund = await observer.refund.create({
      data: {
        paymentId: payment.id,
        contractId: contract.id,
        amount: new Prisma.Decimal('1515.84'),
        reason: `${TEST_NAME_PREFIX} T36 race`,
        status: 'REQUESTED',
        requestedById: requesterId,
      },
    });
    return { contractId: contract.id, refundId: refund.id };
  }

  /** the approval service on its own connection; `pause` holds it right after its FOR SHARE lock (`reached` fires then) */
  function approvalService(pause?: Promise<void>, reached?: () => void) {
    const service = new RefundsService(
      approver as unknown as PrismaService,
      { log: jest.fn() } as never,
      {} as never,
    );
    const internals = service as unknown as Record<string, unknown>;
    internals.refundActor = jest.fn(async () => ({ id: ownerId, role: 'OWNER', branchId: null }));
    internals.assertCurrentRefundAmount = jest.fn(async () => {
      reached?.();
      if (pause) await pause;
    });
    return service;
  }

  /** the close side: lock the contract row, run the #24 guard, write the contract — earlyPayoff / createInTx order */
  async function close(
    contractId: string,
    isolationLevel: Prisma.TransactionIsolationLevel,
    hooks: { started?: () => void } = {},
  ) {
    return closer.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT 1`; // the transaction's first statement (snapshot under Serializable)
        hooks.started?.();
        await tx.$queryRaw`SELECT id FROM contracts WHERE id=${contractId} FOR UPDATE`;
        await assertNoPendingBankRefund(tx, contractId, 'EARLY_PAYOFF');
        await tx.contract.update({ where: { id: contractId }, data: { status: 'EARLY_PAYOFF' } });
      },
      { isolationLevel, timeout: 20_000 },
    );
  }

  /** wait until some backend is blocked on a row lock while running `fragment` */
  async function blockedOn(fragment: string) {
    for (let i = 0; i < 200; i++) {
      const rows = await observer.$queryRaw<{ pid: number }[]>`
        SELECT pid FROM pg_stat_activity
        WHERE wait_event_type = 'Lock' AND query ILIKE ${`%${fragment}%`}`;
      if (rows.length > 0) return;
      await new Promise((r) => setTimeout(r, 25));
    }
    throw new Error(`no backend blocked on: ${fragment}`);
  }

  const statusOf = async (contractId: string, refundId: string) => ({
    contract: (await observer.contract.findUniqueOrThrow({ where: { id: contractId } })).status,
    refund: (await observer.refund.findUniqueOrThrow({ where: { id: refundId } })).status,
  });

  it('1. close first → the waiting approval gets 409 (P2010/40001 mapped) · retry → 400 closed contract', async () => {
    const { contractId, refundId } = await fixture('A');
    let release!: () => void;
    const hold = new Promise<void>((r) => (release = r));
    let locked!: () => void;
    const holdsLock = new Promise<void>((r) => (locked = r));
    const closing = closer.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM contracts WHERE id=${contractId} FOR UPDATE`;
        await assertNoPendingBankRefund(tx, contractId, 'EARLY_PAYOFF');
        await tx.contract.update({ where: { id: contractId }, data: { status: 'EARLY_PAYOFF' } });
        locked(); // the close holds FOR UPDATE and has written the row — only now may the approval start (review m2-1)
        await hold;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 20_000 },
    );
    await holdsLock;
    const approving = approvalService().approveRefund(refundId, ownerId, 'OWNER', 'race');
    const approveResult = approving.then(
      () => null,
      (e: unknown) => e,
    );
    await blockedOn('FOR SHARE');
    release();
    await closing;
    const error = await approveResult;
    expect(error).toBeInstanceOf(ConflictException);
    expect((error as Error).message).toBe('ข้อมูลคืนเงินเปลี่ยนระหว่างทำรายการ — กรุณาโหลดใหม่');
    expect(await statusOf(contractId, refundId)).toEqual({
      contract: 'EARLY_PAYOFF',
      refund: 'REQUESTED',
    });
    await expect(
      approvalService().approveRefund(refundId, ownerId, 'OWNER', 'retry'),
    ).rejects.toThrow(/สัญญานี้ปิดแล้ว \(สถานะ EARLY_PAYOFF\)/);
  }, 30_000);

  it('2. approve first, early payoff (Serializable) → the close is aborted by SSI (retryable) · retry → 400 #24', async () => {
    const { contractId, refundId } = await fixture('B');
    let release!: () => void;
    const pause = new Promise<void>((r) => (release = r));
    let locked!: () => void;
    const holdsLock = new Promise<void>((r) => (locked = r));
    const approving = approvalService(pause, locked).approveRefund(
      refundId,
      ownerId,
      'OWNER',
      'race',
    );
    await holdsLock; // the approval holds FOR SHARE on the contract row
    let started!: () => void;
    const closeStarted = new Promise<void>((r) => (started = r));
    const closing = close(contractId, Prisma.TransactionIsolationLevel.Serializable, {
      started,
    }).then(
      () => null,
      (e: unknown) => e,
    );
    await closeStarted; // the close has its snapshot before the approval commits
    await blockedOn('FOR UPDATE');
    release();
    await approving;
    const error = await closing;
    expect(error).not.toBeNull();
    expect(isRetryablePrismaWriteError(error)).toBe(true);
    expect(await statusOf(contractId, refundId)).toEqual({
      contract: 'ACTIVE',
      refund: 'APPROVED',
    });
    await expect(close(contractId, Prisma.TransactionIsolationLevel.Serializable)).rejects.toThrow(
      /คำขอคืนเงินที่อนุมัติแล้วแต่ยังไม่ได้บันทึกผลจากธนาคาร \(งวดที่ 1 1515\.84 บาท\)/,
    );
  }, 30_000);

  it('3. approve first, device-return confirm (Read Committed) → the close waits, then sees the approved refund → 400 #24', async () => {
    const { contractId, refundId } = await fixture('C');
    let release!: () => void;
    const pause = new Promise<void>((r) => (release = r));
    let locked!: () => void;
    const holdsLock = new Promise<void>((r) => (locked = r));
    const approving = approvalService(pause, locked).approveRefund(
      refundId,
      ownerId,
      'OWNER',
      'race',
    );
    await holdsLock;
    const closing = close(contractId, Prisma.TransactionIsolationLevel.ReadCommitted).then(
      () => null,
      (e: unknown) => e,
    );
    await blockedOn('FOR UPDATE');
    release();
    await approving;
    const error = await closing;
    expect(error).toBeInstanceOf(BadRequestException);
    expect((error as Error).message).toContain(
      'คำขอคืนเงินที่อนุมัติแล้วแต่ยังไม่ได้บันทึกผลจากธนาคาร',
    );
    expect(await statusOf(contractId, refundId)).toEqual({
      contract: 'ACTIVE',
      refund: 'APPROVED',
    });
  }, 30_000);
});
