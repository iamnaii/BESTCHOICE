import { RepairTicketsService } from '../repair-tickets/repair-tickets.service';
import { AccessRepairSourceService } from './access-repair-source.service';
import { AccessProcurementSourceService } from './access-procurement-source.service';
import { Decimal } from '@prisma/client/runtime/library';
import { PermissionKey } from '@installment/shared';
import { AccessSnapshotService } from './access-snapshot.service';
import { AccessResourceService } from './access-resource.service';
import { AccessTradeInProjectionService } from './access-trade-in-projection.service';
import {
  AccessExchangeSourceService,
  exchangeContractSource,
} from './access-exchange-source.service';
import { currentDomainAccess } from './access-execution-context';
import { DefectExchangeService } from '../defect-exchange/defect-exchange.service';
import { DefectExchangeReversalTemplate } from '../journal/cpa-templates/defect-exchange-reversal.template';
import { ShopAccountResolver } from '../journal/shop-account-resolver.service';
import { ShopInventoryTransferTemplate } from '../journal/cpa-templates/shop-inventory-transfer.template';
import { ExchangeCancelReversalTemplate } from '../journal/cpa-templates/exchange-cancel-reversal.template';
import { ExchangeEclReversalTemplate } from '../journal/cpa-templates/exchange-ecl-reversal.template';
import { ShopExchangeReturnTemplate } from '../journal/cpa-templates/shop-exchange-return.template';
import { ExchangeBuybackReceivable11_2107Template } from '../journal/cpa-templates/exchange-buyback-receivable-11-2107.template';
import { ExchangeCloseOld21_1106Template } from '../journal/cpa-templates/exchange-close-old-21-1106.template';
import { ExchangeNewContract1ATemplate } from '../journal/cpa-templates/exchange-new-contract-1a.template';
import { ContractActivation1ATemplate } from '../journal/cpa-templates/contract-activation-1a.template';
import { JournalAutoService } from '../journal/journal-auto.service';
import { InstallmentInputVatTemplate } from '../journal/cpa-templates/installment-input-vat.template';
import { CompanyResolverService } from '../journal/company-resolver.service';
import { AuditService } from '../audit/audit.service';
import { ExchangeCancelService } from '../contract-exchange/contract-exchange-cancel.service';
import { seedStatementReview } from '../contracts/__tests__/credit-approval.fixture';
import { seedShopCoa } from '../../../prisma/seed-coa-shop';
import { seedFinanceCoa } from '../../../prisma/seed-coa-finance';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ContractExchangeService } from '../contract-exchange/contract-exchange.service';
const url = process.env.EMPLOYEE_ACCESS_TEST_DATABASE_URL;
if (!url?.includes('/bc_access_task2?host=/tmp/bc-access-exchanges.'))
  throw new Error('Owned isolated database required');
const db = new PrismaClient({ datasources: { db: { url } } });
afterAll(async () => db.$disconnect());
it('rejects a raw managed submit before reading or changing a financial source', async () => {
  const user = await db.user.create({
    data: {
      name: 'Exchange actor',
      email: randomUUID() + '@test.invalid',
      password: 'unused',
      role: 'OWNER',
      accessManaged: true,
    },
  });
  const service = new ContractExchangeService(
    db as PrismaService,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  await expect(
    service.submit(
      {
        oldContractId: randomUUID(),
        oldProductId: randomUUID(),
        newProductId: randomUUID(),
        conditionNote: 'test',
      },
      user,
    ),
  ).rejects.toBeInstanceOf(ForbiddenException);
});

const prisma = db;
const snapshots = new AccessSnapshotService(db as PrismaService);
const resources = new AccessResourceService(db as PrismaService, snapshots);
const access = new AccessExchangeSourceService(
  resources,
  new AccessTradeInProjectionService(resources),
);
const journal = new JournalAutoService(db as PrismaService);
const companyResolver = new CompanyResolverService(db as PrismaService);
const audit = new AuditService(db as PrismaService);
const act1a = new ContractActivation1ATemplate(journal, db as PrismaService);
const svc = new ContractExchangeService(
  db as PrismaService,
  audit,
  new ExchangeNewContract1ATemplate(journal, db as PrismaService),
  new ExchangeCloseOld21_1106Template(journal, db as PrismaService),
  new ExchangeBuybackReceivable11_2107Template(journal, db as PrismaService),
  new ShopExchangeReturnTemplate(journal, db as PrismaService, companyResolver),
  new ExchangeEclReversalTemplate(journal, db as PrismaService),
  companyResolver,
  new ShopInventoryTransferTemplate(journal, db as PrismaService, companyResolver),
  new ShopAccountResolver(db as PrismaService),
  new InstallmentInputVatTemplate(journal, db as PrismaService, companyResolver),
  access,
);
const cancel = new ExchangeCancelService(
  db as PrismaService,
  audit,
  companyResolver,
  new ExchangeCancelReversalTemplate(journal, db as PrismaService),
  access,
);
const repairAccess = new AccessRepairSourceService(
  resources,
  new AccessTradeInProjectionService(resources),
  new AccessProcurementSourceService(resources),
);
const repair = new RepairTicketsService(
  db as PrismaService,
  audit,
  {} as never,
  {} as never,
  {} as never,
  {} as never,
  repairAccess,
);
const defect = new DefectExchangeService(
  db as PrismaService,
  journal,
  new DefectExchangeReversalTemplate(journal, db as PrismaService),
  repair,
  access,
);
let branchId: string,
  branchB: string,
  adminId: string,
  shopCompanyId: string,
  financeCompanyId: string;
const createdContractIds: string[] = [],
  createdProductIds: string[] = [],
  createdCustomerIds: string[] = [];
const DAY = 86400000;
async function actor() {
  return db.user.create({
    data: {
      name: 'Test exchange',
      email: randomUUID() + '@test.invalid',
      password: 'unused',
      role: 'ACCOUNTANT',
      accessManaged: true,
    },
  });
}
async function grant(
  userId: string,
  permissions: PermissionKey[],
  companyCode: 'SHOP' | 'FINANCE',
  branchIds = [branchId],
) {
  const position = await db.accessPosition.create({
    data: { code: randomUUID(), name: 'Exchange test', permissions },
  });
  return db.employeeAccessAssignment.create({
    data: {
      userId,
      positionId: position.id,
      companyCode,
      scope: 'BRANCHES',
      branches: { create: branchIds.map((branchId) => ({ branchId })) },
    },
  });
}
const common: PermissionKey[] = [
  'contract-exchanges.create',
  'contract-exchanges.read',
  'contract-exchanges.approve',
  'contract-exchanges.update',
  'defect-exchanges.read',
  'defect-exchanges.create',
  'defect-exchanges.approve',
  'contracts.update',
  'products.read',
  'customers.read',
];
async function authorized() {
  const who = await actor();
  await grant(who.id, common, 'SHOP');
  await grant(who.id, common, 'FINANCE');
  return who;
}
async function run<T>(id: string, work: () => Promise<T>) {
  return (
    await resources.execute(id, 'contract-exchanges.create', 'SHOP', undefined, work, false, {
      isolationLevel: 'Serializable',
      maxAttempts: 3,
    })
  ).result;
}
beforeAll(async () => {
  await seedFinanceCoa(db);
  await seedShopCoa(db);
  shopCompanyId = (await db.companyInfo.findUniqueOrThrow({ where: { companyCode: 'SHOP' } })).id;
  financeCompanyId = (await db.companyInfo.findUniqueOrThrow({ where: { companyCode: 'FINANCE' } }))
    .id;
  adminId = (
    await db.user.create({
      data: {
        email: 'admin@bestchoice.com',
        password: 'unused',
        name: 'Test journal owner',
        role: 'OWNER',
        accessManaged: true,
      },
    })
  ).id;
  branchId = (await db.branch.create({ data: { name: 'Exchange A', companyId: shopCompanyId } }))
    .id;
  branchB = (await db.branch.create({ data: { name: 'Exchange B', companyId: shopCompanyId } })).id;
}, 120000);
interface SwapFixture {
  customerId: string;
  oldProductId: string;
  newProductId: string;
  oldContractId: string;
}

/**
 * Old contract = the standard 17K/12M loan math the CPA goldens use:
 *   financed 10,000 + commission 1,000 + interest 6,000 (0.05/mo × 12)
 *   grossExclVat 17,000, VAT 1,190, installmentTotal 1,515.83
 */
async function seedSwapFixture(
  tag: string,
  opts: { schedule?: 'PAST4_FUTURE8' | 'FUTURE12' | 'NONE'; memo?: boolean } = {},
): Promise<SwapFixture> {
  const customer = await prisma.customer.create({
    data: {
      name: `__EXCH_TEST_${tag}__`,
      phone: `0899${tag.padStart(6, '0')}`,
      nationalId: `EXCHTEST-${tag}`,
    },
  });
  createdCustomerIds.push(customer.id);

  const model = opts.memo ? 'MemoModel' : `PricedModel-${tag}`;
  const oldProduct = await prisma.product.create({
    data: {
      name: `Exch Test Old ${tag}`,
      brand: 'ExchTestBrand',
      model,
      storage: '128GB',
      imeiSerial: `EXCHTEST-${tag}-OLD`,
      category: 'PHONE_NEW',
      // 7,500 ≠ buyback 8,000 โดยตั้งใจ (Task 5) — ให้ assertion "cancel restore
      // costPrice" แยกแยะได้จริงระหว่างค่าเดิมกับค่าที่ A.4 เขียนทับ (ถ้าเท่ากัน
      // การ restore ที่พังก็ยัง pass แบบบังเอิญ). ไม่มี golden อื่นอ้างค่านี้:
      // สัญญาเก่า seed ตรงผ่าน prisma (ไม่ผ่าน activation → ไม่มี COGS/S50 JE)
      // และ A.4 รูปใหม่ book ที่ราคารับซื้อ ไม่ใช่ costPrice.
      costPrice: new Decimal('7500.00'),
      installmentPrice: new Decimal('12000.00'),
      branchId,
      status: 'SOLD_INSTALLMENT',
      ownedByCompanyId: financeCompanyId,
    },
  });
  createdProductIds.push(oldProduct.id);

  // MEMO mode requires same model AND newPrice === old contract sellingPrice
  const newProduct = await prisma.product.create({
    data: {
      name: `Exch Test New ${tag}`,
      brand: 'ExchTestBrand',
      model: opts.memo ? 'MemoModel' : `PricedModel-${tag}-NEW`,
      storage: '128GB',
      imeiSerial: `EXCHTEST-${tag}-NEW`,
      category: 'PHONE_NEW',
      costPrice: new Decimal(opts.memo ? '8000.00' : '9000.00'),
      installmentPrice: new Decimal(opts.memo ? '12000.00' : '15000.00'),
      branchId,
      status: 'IN_STOCK',
      ownedByCompanyId: shopCompanyId,
    },
  });
  createdProductIds.push(newProduct.id);

  const contract = await prisma.contract.create({
    data: {
      contractNumber: `EXCHTEST-${tag}-${Date.now()}`,
      customerId: customer.id,
      productId: oldProduct.id,
      branchId,
      salespersonId: adminId,
      planType: 'STORE_WITH_INTEREST',
      sellingPrice: new Decimal('12000.00'),
      downPayment: new Decimal('2000.00'),
      financedAmount: new Decimal('10000.00'),
      interestRate: new Decimal('0.0500'),
      totalMonths: 12,
      interestTotal: new Decimal('6000.00'),
      storeCommission: new Decimal('1000.00'),
      vatAmount: new Decimal('1190.00'),
      vatPct: new Decimal('0.0700'),
      monthlyPayment: new Decimal('1515.83'),
      status: 'ACTIVE',
    },
  });
  createdContractIds.push(contract.id);

  if (opts.schedule && opts.schedule !== 'NONE') {
    const now = Date.now();
    for (let i = 1; i <= 12; i++) {
      const dueDate =
        opts.schedule === 'PAST4_FUTURE8' && i <= 4
          ? new Date(now - (5 - i) * 30 * DAY) // -120d, -90d, -60d, -30d
          : new Date(now + i * 30 * DAY);
      await prisma.installmentSchedule.create({
        data: {
          contractId: contract.id,
          installmentNo: i,
          dueDate,
          principal: new Decimal('833.33'),
          interest: new Decimal('500.00'),
          amountDue: new Decimal('1515.83'),
        },
      });
    }
  }

  return {
    customerId: customer.id,
    oldProductId: oldProduct.id,
    newProductId: newProduct.id,
    oldContractId: contract.id,
  };
}

it('permits canonical managed MEMO and rejects SHOP-only and independently foreign products', async () => {
  const f = await seedSwapFixture('memo-access', { memo: true });
  const who = await authorized();
  const shopOnly = await actor();
  await grant(shopOnly.id, common, 'SHOP');
  await expect(run(shopOnly.id, () => svc.submit(f, shopOnly))).rejects.toBeInstanceOf(
    ForbiddenException,
  );
  await db.product.update({ where: { id: f.newProductId }, data: { branchId: branchB } });
  await grant(who.id, ['products.read'], 'SHOP', [branchB]);
  await grant(who.id, ['products.read'], 'FINANCE', [branchB]);
  await expect(run(who.id, () => svc.submit(f, who))).rejects.toBeInstanceOf(ForbiddenException);
  await grant(who.id, common, 'SHOP', [branchB]);
  const req = await run(who.id, () => svc.submit(f, who));
  const count = await db.journalEntry.count();
  await expect(
    run(who.id, () => svc.approve(req.id, who, { memoAddendumSigned: true, memoMdmSwapped: true })),
  ).rejects.toBeInstanceOf(ForbiddenException);
  await grant(who.id, common, 'FINANCE', [branchB]);
  await run(who.id, () =>
    svc.approve(
      req.id,
      { ...who, role: 'VIEWER', branchId: branchB },
      { memoAddendumSigned: true, memoMdmSwapped: true },
    ),
  );
  expect((await db.contract.findUniqueOrThrow({ where: { id: f.oldContractId } })).productId).toBe(
    f.newProductId,
  );
  expect(
    (await db.product.findUniqueOrThrow({ where: { id: f.oldProductId } })).ownedByCompanyId,
  ).toBe(shopCompanyId);
  expect(
    (await db.product.findUniqueOrThrow({ where: { id: f.newProductId } })).ownedByCompanyId,
  ).toBe(financeCompanyId);
  expect(await db.journalEntry.count()).toBe(count);
  await expect(
    run(who.id, () => cancel.cancel(req.id, 'Owner reversal required', { ...who, role: 'OWNER' })),
  ).rejects.toBeInstanceOf(ForbiddenException);
  await run(adminId, () => cancel.cancel(req.id, 'Actual current owner reversal', { id: adminId }));
  expect((await db.contract.findUniqueOrThrow({ where: { id: f.oldContractId } })).productId).toBe(
    f.oldProductId,
  );
});
it('rolls back canonical MEMO ownership, request and exact joined audit on late failure', async () => {
  const who = await authorized(),
    f = await seedSwapFixture('memo-rollback', { memo: true });
  const req = await run(who.id, () => svc.submit(f, who));
  const logs = await db.auditLog.count();
  await expect(
    run(who.id, async () => {
      await svc.approve(req.id, who, { memoAddendumSigned: true, memoMdmSwapped: true });
      expect(await currentDomainAccess()!.client.auditLog.count()).toBe(logs + 1);
      throw new Error('late projection');
    }),
  ).rejects.toThrow('late projection');
  expect(
    (await db.contractExchangeRequest.findUniqueOrThrow({ where: { id: req.id } })).status,
  ).toBe('PENDING');
  expect((await db.contract.findUniqueOrThrow({ where: { id: f.oldContractId } })).productId).toBe(
    f.oldProductId,
  );
  expect((await db.product.findUniqueOrThrow({ where: { id: f.newProductId } })).status).toBe(
    'IN_STOCK',
  );
  expect(await db.auditLog.count()).toBe(logs);
  const outcomes = await Promise.allSettled([
    run(who.id, () => svc.approve(req.id, who, { memoAddendumSigned: true, memoMdmSwapped: true })),
    run(who.id, () => svc.approve(req.id, who, { memoAddendumSigned: true, memoMdmSwapped: true })),
  ]);
  expect(outcomes.filter((o) => o.status === 'fulfilled')).toHaveLength(1);
  expect(await db.auditLog.count()).toBe(logs + 1);
});
async function priced(tag: string) {
  const f = await seedSwapFixture(tag);
  await act1a.execute(f.oldContractId);
  const old = await db.product.findUniqueOrThrow({ where: { id: f.oldProductId } });
  await db.tradeInValuation.create({
    data: {
      brand: old.brand,
      model: old.model,
      storage: old.storage!,
      condition: 'A',
      basePrice: 11000,
    },
  });
  await seedStatementReview(db, f.customerId);
  return { ...f, buybackPrice: '11000', deviceCondition: 'A', newTotalMonths: 12 };
}
async function finalize(id: string, who: { id: string }, fail = false, wrong = false) {
  return run(who.id, async () => {
    const tx = currentDomainAccess()!.client;
    const c = await tx.contract.findUniqueOrThrow({ where: { id }, include: { product: true } });
    // Integration of full activation is Task4.2. This harness models its exact
    // caller-owned state transition after pre-mutation source authorization.
    const sources = await access.sources(
      {
        oldContractId: c.exchangedFromContractId!,
        newContractId: id,
        oldProductId: (
          await tx.contract.findUniqueOrThrow({ where: { id: c.exchangedFromContractId! } })
        ).productId,
        newProductId: c.productId,
      },
      'finalize',
    );
    access.assert('contracts.update', [
      await exchangeContractSource(tx, c.exchangedFromContractId!),
      await exchangeContractSource(tx, id),
    ]);
    access.assert('contract-exchanges.update', sources);
    await tx.contract.update({ where: { id }, data: { status: 'ACTIVE' } });
    await tx.product.update({
      where: { id: c.productId },
      data: { status: 'SOLD_INSTALLMENT', ownedByCompanyId: financeCompanyId },
    });
    const result = await svc.finalizeAfterActivation(
      {
        ...c,
        exchangedFromContractId: c.exchangedFromContractId!,
        productCategory: c.product.category,
        productCostPrice: c.product.costPrice,
      },
      wrong ? db : tx,
      who,
    );
    if (fail) throw new Error('late activation projection');
    return result;
  });
}
it('keeps managed create-only AUTO pending, independently approves later, and preserves draft cancellation', async () => {
  const who = await actor();
  const createOnly = common.filter((p) => p !== 'contract-exchanges.approve');
  await grant(who.id, createOnly, 'SHOP');
  await grant(who.id, createOnly, 'FINANCE');
  const f = await priced('auto-pending');
  const count = await db.journalEntry.count();
  const req = await run(who.id, () => svc.submit(f, who));
  expect(req.status).toBe('PENDING');
  expect(req.ncvSnapshot?.toString()).toBe('11000');
  expect(
    (await db.contractExchangeRequest.findUniqueOrThrow({ where: { id: req.id } })).approvalTier,
  ).toBe('AUTO');
  expect(await db.contract.count({ where: { exchangedFromContractId: f.oldContractId } })).toBe(0);
  expect(await db.journalEntry.count()).toBe(count);
  const approver = await authorized();
  const approved = await run(approver.id, () => svc.approve(req.id, approver, {}));
  expect(approved.newContractId).toBeTruthy();
  const draft = await db.contract.findUniqueOrThrow({ where: { id: approved.newContractId! } });
  expect(draft.financedAmount.toFixed(2)).toBe('15000.00');
  expect(draft.monthlyPayment.toFixed(2)).toBe('2273.75');
  expect(draft.interestTotal.toFixed(2)).toBe('9000.00');
  expect(draft.vatAmount!.toFixed(2)).toBe('1785.00');
  expect(await db.journalEntry.count()).toBe(count);
  await run(who.id, () => cancel.cancel(req.id, 'Cancel before any finalization', who));
  expect(
    (await db.contract.findUniqueOrThrow({ where: { id: draft.id } })).deletedAt,
  ).not.toBeNull();
  expect((await db.product.findUniqueOrThrow({ where: { id: f.newProductId } })).status).toBe(
    'IN_STOCK',
  );
  expect(await db.journalEntry.count()).toBe(count);
});
it('runs fully authorized AUTO, exact-client finalization and actual JE/link/audit rollback then owner cancellation', async () => {
  const who = await authorized(),
    f = await priced('priced-final');
  const req = await run(who.id, () => svc.submit(f, who));
  expect(req.status).toBe('APPROVED');
  const approved = await db.contractExchangeRequest.findUniqueOrThrow({ where: { id: req.id } });
  const count = await db.journalEntry.count(),
    logs = await db.auditLog.count();
  await expect(finalize(approved.newContractId!, who, false, true)).rejects.toBeInstanceOf(
    ForbiddenException,
  );
  await expect(finalize(approved.newContractId!, who, true)).rejects.toThrow(
    'late activation projection',
  );
  expect(await db.journalEntry.count()).toBe(count);
  expect(await db.auditLog.count()).toBe(logs);
  expect(
    (await db.contractExchangeRequest.findUniqueOrThrow({ where: { id: req.id } })).je1aId,
  ).toBeNull();
  expect((await db.contract.findUniqueOrThrow({ where: { id: f.oldContractId } })).status).toBe(
    'ACTIVE',
  );
  expect(
    (await db.contract.findUniqueOrThrow({ where: { id: approved.newContractId! } })).status,
  ).toBe('DRAFT');
  expect((await db.product.findUniqueOrThrow({ where: { id: f.newProductId } })).status).toBe(
    'RESERVED',
  );
  const attempts = await Promise.allSettled([
    finalize(approved.newContractId!, who),
    finalize(approved.newContractId!, who),
  ]);
  expect(attempts.filter((a) => a.status === 'fulfilled')).toHaveLength(1);
  const success = attempts.find((a) => a.status === 'fulfilled');
  if (!success || success.status !== 'fulfilled') throw new Error('No committed finalization');
  const posted = success.value;
  const lines = await db.journalLine.findMany({ where: { journalEntryId: posted.je3Id } });
  expect(lines.map((l) => [l.accountCode, l.debit.toFixed(2), l.credit.toFixed(2)])).toEqual(
    expect.arrayContaining([
      ['11-2107', '11000.00', '0.00'],
      ['21-1106', '0.00', '11000.00'],
    ]),
  );
  expect(lines).toHaveLength(2);
  expect(await db.journalEntry.count()).toBe(count + 6);
  expect(await db.auditLog.count()).toBe(logs + 2);
  await expect(finalize(approved.newContractId!, who)).rejects.toMatchObject({ code: 'P2002' });
  expect(await db.journalEntry.count()).toBe(count + 6);
  await expect(
    run(who.id, () =>
      cancel.cancel(req.id, 'Supplied owner is not current owner', { ...who, role: 'OWNER' }),
    ),
  ).rejects.toBeInstanceOf(ForbiddenException);
  const beforeCancelJournals = await db.journalEntry.count(),
    beforeCancelAudits = await db.auditLog.count();
  await expect(
    run(adminId, async () => {
      await cancel.cancel(req.id, 'Owner reversal rollback control', { id: adminId });
      throw new Error('late cancellation');
    }),
  ).rejects.toThrow('late cancellation');
  expect(await db.journalEntry.count()).toBe(beforeCancelJournals);
  expect(await db.auditLog.count()).toBe(beforeCancelAudits);
  expect(
    (await db.contractExchangeRequest.findUniqueOrThrow({ where: { id: req.id } })).status,
  ).toBe('APPROVED');
  expect((await db.contract.findUniqueOrThrow({ where: { id: f.oldContractId } })).status).toBe(
    'EXCHANGED',
  );
  await run(adminId, () =>
    cancel.cancel(req.id, 'Current owner canonical reversal', { id: adminId }),
  );
  expect((await db.contract.findUniqueOrThrow({ where: { id: f.oldContractId } })).status).toBe(
    'ACTIVE',
  );
  expect(
    (await db.product.findUniqueOrThrow({ where: { id: f.oldProductId } })).costPrice.toFixed(2),
  ).toBe('7500.00');
});
it('executes actual defect reversal atomically and rejects duplicate replacement', async () => {
  const who = await authorized(),
    f = await seedSwapFixture('defect');
  const old = await db.product.findUniqueOrThrow({ where: { id: f.oldProductId } });
  await db.product.update({ where: { id: f.oldProductId }, data: { category: 'PHONE_USED' } });
  await db.product.update({
    where: { id: f.newProductId },
    data: { category: 'PHONE_USED', model: old.model },
  });
  await act1a.execute(f.oldContractId);
  await seedStatementReview(db, f.customerId);
  const dto = {
    oldContractId: f.oldContractId,
    newProductId: f.newProductId,
    defectReason: 'Screen fails persistently',
  };
  const count = await db.journalEntry.count(),
    logs = await db.auditLog.count();
  await expect(
    run(who.id, async () => {
      await defect.execute(dto, who);
      throw new Error('late defect');
    }),
  ).rejects.toThrow('late defect');
  expect(await db.journalEntry.count()).toBe(count);
  expect(await db.auditLog.count()).toBe(logs);
  expect((await db.contract.findUniqueOrThrow({ where: { id: f.oldContractId } })).status).toBe(
    'ACTIVE',
  );
  expect(await db.contract.count({ where: { parentContractId: f.oldContractId } })).toBe(0);
  const parallel = await Promise.allSettled([
    run(who.id, () => defect.execute(dto, who)),
    run(who.id, () => defect.execute(dto, who)),
  ]);
  expect(parallel.filter((p) => p.status === 'fulfilled')).toHaveLength(1);
  const committed = parallel.find((p) => p.status === 'fulfilled');
  if (!committed || committed.status !== 'fulfilled') throw new Error('No defect committed');
  const result = committed.value;
  expect((await db.contract.findUniqueOrThrow({ where: { id: f.oldContractId } })).status).toBe(
    'DEFECT_EXCHANGED',
  );
  expect(
    (
      await db.contract.findUniqueOrThrow({ where: { id: result.newContract.id } })
    ).financedAmount.toFixed(2),
  ).toBe('10000.00');
  expect(await db.journalEntry.count()).toBe(count + 1);
  await expect(run(who.id, () => defect.execute(dto, who))).rejects.toThrow();
  expect(await db.contract.count({ where: { parentContractId: f.oldContractId } })).toBe(1);
});
it.each(['grant', 'source', 'owner'] as const)(
  'rechecks %s after an observed real advisory wait',
  async (mode) => {
    const who = await authorized(),
      f = await seedSwapFixture('wait-' + mode, { memo: true });
    const req = await run(who.id, () => svc.submit(f, who));
    if (mode === 'owner') {
      await run(who.id, () =>
        svc.approve(req.id, who, { memoAddendumSigned: true, memoMdmSwapped: true }),
      );
      await db.user.update({ where: { id: who.id }, data: { role: 'OWNER' } });
    }
    let release!: () => void, locked!: () => void;
    const held = new Promise<void>((r) => (locked = r)),
      unlock = new Promise<void>((r) => (release = r));
    const change = db.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(718294630)`;
        if (mode === 'source')
          await tx.contract.update({ where: { id: f.oldContractId }, data: { branchId: branchB } });
        if (mode === 'grant') {
          const grants = await tx.employeeAccessAssignment.findMany({
            where: { userId: who.id, companyCode: 'FINANCE' },
          });
          await tx.accessPosition.updateMany({
            where: { id: { in: grants.map((g) => g.positionId) } },
            data: { permissions: [] },
          });
        }
        if (mode === 'owner')
          await tx.user.update({
            where: { id: who.id },
            data: { role: 'ACCOUNTANT', accessRevision: { increment: 1 } },
          });
        locked();
        await unlock;
      },
      { timeout: 15000 },
    );
    await held;
    const pending = run<unknown>(who.id, () =>
      mode === 'owner'
        ? cancel.cancel(req.id, 'Observed owner demotion', who)
        : svc.approve(req.id, who, { memoAddendumSigned: true, memoMdmSwapped: true }),
    ).then(
      (value) => ({ value, error: null }),
      (error) => ({ value: null, error }),
    );
    try {
      for (let i = 0; i < 100; i++) {
        const [{ waiting }] = await db.$queryRaw<
          Array<{ waiting: boolean }>
        >`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE wait_event='advisory' AND datname=current_database()) AS waiting`;
        if (waiting) break;
        if (i === 99) throw new Error('No observed database waiter');
        await new Promise((r) => setTimeout(r, 10));
      }
    } finally {
      release();
    }
    await change;
    expect((await pending).error).toBeInstanceOf(ForbiddenException);
    expect(
      (await db.contractExchangeRequest.findUniqueOrThrow({ where: { id: req.id } })).status,
    ).toBe(mode === 'owner' ? 'APPROVED' : 'PENDING');
  },
);

it('joins the actual repair replacement child and its status/audit to defect reversal', async () => {
  const who = await authorized(),
    f = await seedSwapFixture('defect-repair');
  await db.user.update({ where: { id: who.id }, data: { role: 'BRANCH_MANAGER' } });
  await grant(who.id, ['contracts.read'], 'SHOP');
  await act1a.execute(f.oldContractId);
  await seedStatementReview(db, f.customerId);
  const ticket = await db.repairTicket.create({
    data: {
      ticketNumber: 'RS-exchange-test',
      branchId,
      customerId: f.customerId,
      contractId: f.oldContractId,
      productId: f.oldProductId,
      defectDescription: 'Broken screen',
      payer: 'SHOP',
      warrantyStatus: 'IN_SHOP_WARRANTY',
      createdById: who.id,
    },
  });
  const dto = {
    oldContractId: f.oldContractId,
    newProductId: f.newProductId,
    defectReason: 'Repair replacement',
    bypassWindowCheck: true,
    originRepairTicketId: ticket.id,
  };
  const journals = await db.journalEntry.count(),
    audits = await db.auditLog.count(),
    statuses = await db.repairStatusLog.count();
  await expect(
    run(who.id, async () => {
      await defect.execute(dto, who);
      throw new Error('late joined repair');
    }),
  ).rejects.toThrow('late joined repair');
  expect(await db.journalEntry.count()).toBe(journals);
  expect(await db.auditLog.count()).toBe(audits);
  expect(await db.repairStatusLog.count()).toBe(statuses);
  expect((await db.repairTicket.findUniqueOrThrow({ where: { id: ticket.id } })).status).toBe(
    'OPEN',
  );
  const result = await run(who.id, () => defect.execute(dto, who));
  const saved = await db.repairTicket.findUniqueOrThrow({ where: { id: ticket.id } });
  expect(saved.status).toBe('REPLACED');
  expect(saved.replacementContractId).toBe(result.newContract.id);
  expect(await db.repairStatusLog.count()).toBe(statuses + 1);
});
it('requires child capabilities and current actor, and independently projects financial snapshots', async () => {
  const f = await priced('read-source'),
    who = await authorized(),
    other = await authorized();
  const repairOnly = await actor();
  await grant(
    repairOnly.id,
    [
      'after-sales.create',
      'repair-tickets.read',
      'repair-tickets.update',
      'products.read',
      'customers.read',
      'contracts.read',
    ],
    'SHOP',
  );
  await grant(repairOnly.id, ['products.read', 'customers.read'], 'FINANCE');
  await expect(
    resources.execute(
      repairOnly.id,
      'after-sales.create',
      'SHOP',
      undefined,
      () => svc.submit(f, repairOnly),
      false,
      { isolationLevel: 'Serializable', maxAttempts: 3 },
    ),
  ).rejects.toBeInstanceOf(ForbiddenException);
  await expect(run(who.id, () => svc.submit(f, other))).rejects.toBeInstanceOf(ForbiddenException);
  await expect(svc.buildPreview(f, who)).rejects.toBeInstanceOf(ForbiddenException);
  await expect(
    defect.checkEligibility(f.oldContractId, f.newProductId, who),
  ).rejects.toBeInstanceOf(ForbiddenException);
  const hidden = await run(who.id, () => svc.buildPreview(f, who));
  expect(hidden.ncv).toBe('11000.00');
  expect(hidden.expectedPl).toBeNull();
  expect(hidden.basePrice).toBeNull();
  await grant(who.id, ['sensitive.cost.read', 'sensitive.profit.read'], 'SHOP');
  await grant(who.id, ['sensitive.cost.read', 'sensitive.profit.read'], 'FINANCE');
  const full = await run(who.id, () => svc.buildPreview(f, who));
  expect(full.ncv).toBe('11000.00');
  expect(full.basePrice).toBe('11000.00');
  expect(full.expectedPl).not.toBeNull();
  const req = await run(who.id, () => svc.submit({ ...f, buybackPrice: '10000' }, who));
  expect(req.status).toBe('PENDING');
  expect((await run(who.id, () => svc.listPending(who))).some((r) => r.id === req.id)).toBe(true);
  const updated = await run(who.id, () =>
    svc.reject(req.id, 'Separate rejection capability', who.id),
  );
  expect(updated.status).toBe('REJECTED');
  await expect(run(who.id, () => svc.approve(req.id, who, {}))).rejects.toThrow();
});

it('rolls back AUTO on a real credit failure rather than downgrading approval errors to pending', async () => {
  const who = await authorized(),
    f = await priced('auto-credit-failure');
  await db.creditCheck.updateMany({
    where: { customerId: f.customerId },
    data: { contractId: f.oldContractId },
  });
  await expect(run(who.id, () => svc.submit(f, who))).rejects.toThrow(
    'กรุณาวิเคราะห์สเตทเม้นรอบใหม่',
  );
  expect(
    await db.contractExchangeRequest.count({ where: { oldContractId: f.oldContractId } }),
  ).toBe(0);
  expect(await db.contract.count({ where: { exchangedFromContractId: f.oldContractId } })).toBe(0);
  expect((await db.product.findUniqueOrThrow({ where: { id: f.newProductId } })).status).toBe(
    'IN_STOCK',
  );
});
it('rejects a pending request whose original device is no longer the current Contract device', async () => {
  const who = await authorized(),
    f = await seedSwapFixture('stale-device', { memo: true });
  const req = await run(who.id, () => svc.submit(f, who));
  const changed = await db.product.create({
    data: {
      name: 'Current replacement',
      brand: 'Example',
      model: 'Changed',
      category: 'PHONE_NEW',
      costPrice: 1,
      branchId,
      status: 'SOLD_INSTALLMENT',
      ownedByCompanyId: financeCompanyId,
    },
  });
  await db.contract.update({ where: { id: f.oldContractId }, data: { productId: changed.id } });
  await expect(
    run(who.id, () => svc.approve(req.id, who, { memoAddendumSigned: true, memoMdmSwapped: true })),
  ).rejects.toBeInstanceOf(ForbiddenException);
  expect((await db.contract.findUniqueOrThrow({ where: { id: f.oldContractId } })).productId).toBe(
    changed.id,
  );
  expect(
    (await db.contractExchangeRequest.findUniqueOrThrow({ where: { id: req.id } })).status,
  ).toBe('PENDING');
});

it('does not turn a collections assignment into exchange authority and requires defect approval independently', async () => {
  const who = await actor(),
    f = await seedSwapFixture('assigned', { memo: true });
  await grant(who.id, common, 'SHOP');
  await grant(who.id, ['products.read', 'customers.read'], 'FINANCE');
  const p = await db.accessPosition.create({
    data: { code: randomUUID(), name: 'Collections is not exchange', permissions: common },
  });
  await db.employeeAccessAssignment.create({
    data: { userId: who.id, positionId: p.id, companyCode: 'FINANCE', scope: 'ASSIGNED' },
  });
  await db.contract.update({ where: { id: f.oldContractId }, data: { assignedToId: who.id } });
  await expect(run(who.id, () => svc.submit(f, who))).rejects.toBeInstanceOf(ForbiddenException);
  await grant(
    who.id,
    ['contract-exchanges.create', 'defect-exchanges.create', 'defect-exchanges.read'],
    'FINANCE',
  );
  await expect(
    run(who.id, () =>
      defect.execute(
        {
          oldContractId: f.oldContractId,
          newProductId: f.newProductId,
          defectReason: 'Independent approval required',
        },
        who,
      ),
    ),
  ).rejects.toBeInstanceOf(ForbiddenException);
});
it('uses genuine FINANCE customer identity without unrelated SHOP customer or warranty grants', async () => {
  const who = await actor(),
    f = await seedSwapFixture('finance-party', { memo: true });
  await grant(who.id, ['contract-exchanges.create', 'products.read'], 'SHOP');
  await grant(who.id, ['contract-exchanges.create', 'products.read', 'customers.read'], 'FINANCE');
  expect((await run(who.id, () => svc.submit(f, who))).status).toBe('PENDING');
  const foreign = await actor();
  await grant(foreign.id, ['contract-exchanges.create', 'products.read'], 'SHOP');
  await grant(foreign.id, ['contract-exchanges.create', 'products.read'], 'FINANCE');
  await grant(foreign.id, ['customers.read'], 'FINANCE', [branchB]);
  await expect(run(foreign.id, () => svc.submit(f, foreign))).rejects.toBeInstanceOf(
    ForbiddenException,
  );
});

it('fills recent history from authorized sources beyond newer foreign requests with a deterministic limit', async () => {
  const who = await authorized();
  const own = await seedSwapFixture('recent-own');
  const foreign = await seedSwapFixture('recent-foreign');
  await db.contract.update({ where: { id: foreign.oldContractId }, data: { branchId: branchB } });
  const older = new Date(Date.now() - DAY);
  const ownIds: string[] = Array.from({ length: 101 }, () => randomUUID()).sort().reverse();
  await db.contractExchangeRequest.createMany({ data: [
    ...ownIds.map((id) => ({ id, oldContractId: own.oldContractId, oldProductId: own.oldProductId,
      newProductId: own.newProductId, requestedById: who.id, status: 'APPROVED' as const, updatedAt: older })),
    ...Array.from({ length: 101 }, () => ({ oldContractId: foreign.oldContractId,
      oldProductId: foreign.oldProductId, newProductId: foreign.newProductId,
      requestedById: who.id, status: 'APPROVED' as const, updatedAt: new Date() })),
  ] });
  const rows = await run(who.id, () => svc.listRecent(who));
  // Other fixtures may have newer authorized history; this fixture must still
  // fill the limit and the tied older rows must retain deterministic id order.
  expect(rows).toHaveLength(100);
  const visibleOwn = rows.filter((row) => ownIds.includes(row.id)).map((row) => row.id);
  expect(visibleOwn.length).toBeGreaterThan(0);
  expect(visibleOwn).toEqual(ownIds.slice(0, visibleOwn.length));
  expect(rows.every((row) => row.oldContractId !== foreign.oldContractId)).toBe(true);
  expect((await run(who.id, () => svc.listRecent(who))).map((row) => row.id)).toEqual(rows.map((row) => row.id));
});

it('fills defect history beyond newer foreign audits and applies explicit branch filtering before the final limit', async () => {
  const who = await authorized();
  const own = await seedSwapFixture('history-own');
  const replacement = await seedSwapFixture('history-replacement');
  await db.contract.update({ where: { id: replacement.oldContractId }, data: { parentContractId: own.oldContractId } });
  const foreign = await seedSwapFixture('history-foreign');
  const foreignReplacement = await seedSwapFixture('history-foreign-replacement');
  await db.contract.update({ where: { id: foreign.oldContractId }, data: { branchId: branchB } });
  await db.contract.update({ where: { id: foreignReplacement.oldContractId }, data: { branchId: branchB, parentContractId: foreign.oldContractId } });
  const older = new Date(Date.now() - DAY);
  const ownIds: string[] = Array.from({ length: 201 }, () => randomUUID()).sort().reverse();
  await db.auditLog.createMany({ data: [
    ...ownIds.map((id) => ({ id, userId: who.id, action: 'DEFECT_EXCHANGE', entity: 'contract', entityId: replacement.oldContractId, createdAt: older })),
    ...Array.from({ length: 201 }, () => ({ userId: who.id, action: 'DEFECT_EXCHANGE', entity: 'contract', entityId: foreignReplacement.oldContractId, createdAt: new Date() })),
  ] });
  const rows = await run(who.id, () => defect.list({}, who));
  expect(rows).toHaveLength(200);
  const visibleOwn = rows.filter((row) => ownIds.includes(row.id)).map((row) => row.id);
  expect(visibleOwn.length).toBeGreaterThan(0);
  expect(visibleOwn).toEqual(ownIds.slice(0, visibleOwn.length));
  expect(rows.every((row) => row.entityId !== foreignReplacement.oldContractId)).toBe(true);
  // Both branches are now authorized: branch filtering must independently
  // continue scanning beyond the newer B rows rather than consume the limit.
  await grant(who.id, common, 'FINANCE', [branchB]);
  await grant(who.id, common, 'SHOP', [branchB]);
  const filtered = await run(who.id, () => defect.list({ branchId }, who));
  expect(filtered.map((row) => row.id)).toEqual(rows.map((row) => row.id));
});
