import { AccessAfterSalesExchangeActionService } from './access-after-sales-exchange-action';
import { RepairTicketDocNumberService } from '../repair-tickets/services/doc-number.service';
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
import { Prisma, PrismaClient } from '@prisma/client';
import { ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ContractExchangeService } from '../contract-exchange/contract-exchange.service';
const url = process.env.EMPLOYEE_ACCESS_TEST_DATABASE_URL;
if (
  !url?.includes('/bc_access_task2?host=/tmp/bc-access-aftersales-exchanges.') ||
  process.env.DATABASE_URL !== url ||
  process.env.DATABASE_URL_FINANCE !== url
)
  throw new Error('Owned isolated database required');
const db = new PrismaClient({ datasources: { db: { url } } });

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
  new RepairTicketDocNumberService(db as PrismaService),
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

import { Test } from '@nestjs/testing';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { ExecutionContext, INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AccessPolicyService } from './access-policy';
import { AccessPolicyInterceptor } from './access-policy.interceptor';
import { AccessAfterSalesActionBoundaries } from './access-after-sales-action-boundaries';
import { AfterSalesController } from '../after-sales/after-sales.controller';
import { AfterSalesService } from '../after-sales/after-sales.service';
import { AfterSalesExchangeService } from '../after-sales/services/after-sales-exchange.service';
import { AfterSalesQueryService } from '../after-sales/services/after-sales-query.service';
import { AfterSalesDocumentService } from '../after-sales/services/after-sales-document.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { BranchGuard } from '../auth/guards/branch.guard';
let app: INestApplication;
const successes = new Set<string>();
const line = { notifyMoment: jest.fn(async () => undefined) };
const facade = new AfterSalesExchangeService(
  db as PrismaService,
  new AfterSalesQueryService(db as PrismaService),
  defect,
  repair,
  audit,
  svc,
  cancel,
  {} as never,
  line as never,
  new AccessAfterSalesExchangeActionService(access, repairAccess),
);
beforeAll(async () => {
  const module = await Test.createTestingModule({
    controllers: [AfterSalesController],
    providers: [
      AccessAfterSalesActionBoundaries,
      AccessPolicyService,
      { provide: AccessResourceService, useValue: resources },
      { provide: AccessSnapshotService, useValue: snapshots },
      { provide: PrismaService, useValue: db },
      { provide: AfterSalesDocumentService, useValue: {} },
      {
        provide: AfterSalesService,
        useValue: new AfterSalesService({} as never, {} as never, {} as never, {} as never, facade),
      },
      { provide: APP_INTERCEPTOR, useClass: AccessPolicyInterceptor },
    ],
  })
    .overrideGuard(JwtAuthGuard)
    .useValue({
      canActivate: async (ctx: ExecutionContext) => {
        const req = ctx.switchToHttp().getRequest();
        const id = req.headers['x-test-user'];
        const response = ctx.switchToHttp().getResponse();
        response.on('finish', () => {
          if (response.statusCode < 300)
            successes.add(ctx.getClass().name + '.' + ctx.getHandler().name);
        });
        req.user = {
          ...(await db.user.findUniqueOrThrow({ where: { id } })),
          access: await snapshots.forUser(id),
        };
        return true;
      },
    })
    .overrideGuard(RolesGuard)
    .useValue({ canActivate: () => true })
    .overrideGuard(BranchGuard)
    .useValue({ canActivate: () => true })
    .compile();
  app = module.createNestApplication();
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
  await app.listen(0, '127.0.0.1');
});
afterAll(async () => {
  await app?.close();
  await db.$disconnect();
});
function http(id: string, path: string, body: object = {}) {
  return request(app.getHttpServer()).post(path).set('x-test-user', id).send(body);
}
async function caseFixture(tag: string) {
  const f = await seedSwapFixture(tag, { memo: true });
  const row = await db.afterSalesCase.create({
    data: {
      caseNumber: randomUUID(),
      branchId,
      customerId: f.customerId,
      contractId: f.oldContractId,
      productId: f.oldProductId,
      replacementProductId: f.newProductId,
      source: 'INSTALLMENT_CONTRACT',
      outcome: 'SAME_MODEL_EXCHANGE',
      stage: 'AWAITING_APPROVAL',
      symptom: 'Screen',
      warrantySnapshot: { status: 'IN_7DAY_DEFECT' },
      receivedById: adminId,
    },
  });
  return { ...f, row };
}
it('allows current action-only same-model rejection through actual HTTP, denies no-grants', async () => {
  const who = await actor();
  await grant(who.id, ['after-sales.update'], 'SHOP');
  const f = await caseFixture('reject');
  const no = await actor();
  expect(
    (await http(no.id, `/after-sales/${f.row.id}/exchange/reject`, { reason: 'No replacement' }))
      .status,
  ).toBe(403);
  const response = await http(who.id, `/after-sales/${f.row.id}/exchange/reject`, {
    reason: 'No replacement',
  });
  expect(response.status).toBe(201);
  expect(response.body).toEqual({ id: f.row.id, stage: 'CANCELLED' });
});

it('switches to a real canonical repair only with independent child capabilities', async () => {
  const who = await actor();
  const f = await caseFixture('switch');
  expect((await http((await actor()).id, `/after-sales/${f.row.id}/switch-to-repair`)).status).toBe(
    403,
  );
  await grant(who.id, ['after-sales.update'], 'SHOP');
  expect((await http(who.id, `/after-sales/${f.row.id}/switch-to-repair`)).status).toBe(403);
  await grant(
    who.id,
    ['repair-tickets.create', 'customers.read', 'products.read', 'contracts.read'],
    'SHOP',
  );
  await grant(who.id, ['products.read'], 'FINANCE');
  const response = await http(who.id, `/after-sales/${f.row.id}/switch-to-repair`);
  expect(response.status).toBe(201);
  expect(response.body).toEqual({ id: f.row.id, stage: 'RECEIVED' });
  const row = await db.afterSalesCase.findUniqueOrThrow({ where: { id: f.row.id } });
  const ticket = await db.repairTicket.findUniqueOrThrow({ where: { id: row.repairTicketId! } });
  expect(ticket.customerId).toBe(f.customerId);
  expect(ticket.contractId).toBe(f.oldContractId);
  expect(await db.repairStatusLog.count({ where: { ticketId: ticket.id } })).toBe(1);
});
it('rolls back a real repair child, status log, case and event on late required audit failure', async () => {
  const f = await caseFixture('switch-rollback');
  const before = await db.repairTicket.count(),
    logs = await db.repairStatusLog.count();
  await db.$executeRawUnsafe(
    `CREATE FUNCTION fail_exchange_case_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action = 'AFTER_SALES_OUTCOME_SWITCHED' THEN RAISE EXCEPTION 'late required exchange case audit'; END IF; RETURN NEW; END $$`,
  );
  await db.$executeRawUnsafe(
    `CREATE TRIGGER fail_exchange_case_audit BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION fail_exchange_case_audit()`,
  );
  try {
    const response = await http(adminId, `/after-sales/${f.row.id}/switch-to-repair`);
    expect({ status: response.status, body: response.body }).toEqual({
      status: 500,
      body: { statusCode: 500, message: 'Internal server error' },
    });
  } finally {
    await db.$executeRawUnsafe('DROP TRIGGER fail_exchange_case_audit ON audit_logs');
    await db.$executeRawUnsafe('DROP FUNCTION fail_exchange_case_audit()');
  }
  expect(await db.repairTicket.count()).toBe(before);
  expect(await db.repairStatusLog.count()).toBe(logs);
  const row = await db.afterSalesCase.findUniqueOrThrow({ where: { id: f.row.id } });
  expect(row.outcome).toBe('SAME_MODEL_EXCHANGE');
  expect(row.repairTicketId).toBeNull();
  expect(await db.afterSalesEvent.count({ where: { caseId: f.row.id } })).toBe(0);
});
it('commits concurrent same-model rejection once with one durable event and audit', async () => {
  const f = await caseFixture('reject-concurrent');
  const responses = await Promise.all([
    http(adminId, `/after-sales/${f.row.id}/exchange/reject`, { reason: 'Unavailable' }),
    http(adminId, `/after-sales/${f.row.id}/exchange/reject`, { reason: 'Unavailable' }),
  ]);
  expect(responses.map((r) => r.status).sort()).toEqual([201, 400]);
  expect(await db.afterSalesEvent.count({ where: { caseId: f.row.id } })).toBe(1);
  expect(
    await db.auditLog.count({
      where: { entityId: f.row.id, action: 'AFTER_SALES_EXCHANGE_REJECTED' },
    }),
  ).toBe(1);
});
async function exchangeWorker() {
  const who = await actor();
  const permissions = common.filter(
    (p) => !['contract-exchanges.read', 'defect-exchanges.read'].includes(p),
  );
  await grant(who.id, permissions, 'SHOP');
  await grant(who.id, permissions, 'FINANCE');
  await grant(who.id, ['after-sales.update', 'contracts.read', 'repair-tickets.create'], 'SHOP');
  return who;
}
async function defectCase(tag: string, fromRepair = false, outside = false) {
  const f = await caseFixture(tag);
  await db.product.updateMany({
    where: { id: { in: [f.oldProductId, f.newProductId] } },
    data: { category: 'PHONE_USED' },
  });
  await db.contract.update({
    where: { id: f.oldContractId },
    data: { deviceReceivedAt: new Date(Date.now() - (outside ? 10 : 1) * DAY) },
  });
  await act1a.execute(f.oldContractId);
  await seedStatementReview(db, f.customerId);
  if (fromRepair) {
    const ticket = await db.repairTicket.create({
      data: {
        ticketNumber: randomUUID(),
        customerId: f.customerId,
        productId: f.oldProductId,
        contractId: f.oldContractId,
        branchId,
        status: 'OPEN',
        payer: 'SHOP',
        warrantyStatus: 'IN_SHOP_WARRANTY',
        defectDescription: 'Broken',
        createdById: adminId,
      },
    });
    await db.afterSalesCase.update({
      where: { id: f.row.id },
      data: {
        outcome: 'REPAIR',
        stage: 'RECEIVED',
        repairTicketId: ticket.id,
        replacementProductId: null,
      },
    });
  }
  return f;
}
async function pendingCase(tag: string, memo = true) {
  const f = await seedSwapFixture(tag, { memo });
  const maker = await actor();
  await grant(maker.id, ['contract-exchanges.create', 'products.read', 'customers.read'], 'SHOP');
  await grant(
    maker.id,
    ['contract-exchanges.create', 'products.read', 'customers.read'],
    'FINANCE',
  );
  if (!memo) {
    await act1a.execute(f.oldContractId);
    await seedStatementReview(db, f.customerId);
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
  }
  const req = await run(maker.id, () =>
    svc.submit(
      {
        ...f,
        ...(!memo ? { buybackPrice: '11000', deviceCondition: 'A', newTotalMonths: 12 } : {}),
      },
      maker,
    ),
  );
  const row = await db.afterSalesCase.create({
    data: {
      caseNumber: randomUUID(),
      branchId,
      customerId: f.customerId,
      contractId: f.oldContractId,
      productId: f.oldProductId,
      replacementProductId: f.newProductId,
      exchangeRequestId: req.id,
      source: 'INSTALLMENT_CONTRACT',
      outcome: 'PRICED_EXCHANGE',
      stage: 'AWAITING_APPROVAL',
      symptom: 'Screen',
      warrantySnapshot: {},
      receivedById: maker.id,
    },
  });
  return { ...f, row, req };
}
it.each([false, true])(
  'confirms real defect exchange as custom non-manager, repair=%s, and denies no grants',
  async (fromRepair) => {
    const who = await exchangeWorker(),
      f = await defectCase(`confirm-${fromRepair}`, fromRepair, true),
      no = await actor();
    const path = `/after-sales/${f.row.id}/exchange/confirm`,
      body = fromRepair ? { replacementProductId: f.newProductId } : {};
    expect((await http(no.id, path, body)).status).toBe(403);
    const response = await http(who.id, path, body);
    expect(response.body).toEqual({ id: f.row.id, stage: 'READY_FOR_PICKUP' });
    expect(response.status).toBe(201);
    const row = await db.afterSalesCase.findUniqueOrThrow({ where: { id: f.row.id } });
    expect(row.replacementContractId).not.toBeNull();
    expect((await db.contract.findUniqueOrThrow({ where: { id: f.oldContractId } })).status).toBe(
      'DEFECT_EXCHANGED',
    );
    if (fromRepair)
      expect(
        (await db.repairTicket.findUniqueOrThrow({ where: { id: row.repairTicketId! } })).status,
      ).toBe('REPLACED');
  },
);
it('delivers with only narrow warranty/product/customer and case authority; hides draft number', async () => {
  const who = await exchangeWorker(),
    f = await defectCase('deliver');
  expect((await http(who.id, `/after-sales/${f.row.id}/exchange/confirm`)).status).toBe(201);
  const row = await db.afterSalesCase.findUniqueOrThrow({ where: { id: f.row.id } }),
    worker = await actor(),
    no = await actor();
  await grant(
    worker.id,
    ['after-sales.update', 'contracts.read', 'customers.read', 'products.read'],
    'SHOP',
  );
  await grant(worker.id, ['products.read'], 'FINANCE');
  const path = `/after-sales/${row.id}/exchange/deliver`;
  expect((await http(no.id, path)).status).toBe(403);
  const draft = await http(worker.id, path);
  expect(draft.status).toBe(400);
  expect(draft.body.message).toBe('ไม่สามารถดำเนินการตามสถานะหรือเงื่อนไขปัจจุบัน');
  // Fixture state only: actual financial activation adapter is separately owned Task4.2.
  await db.contract.update({
    where: { id: row.replacementContractId! },
    data: { status: 'ACTIVE' },
  });
  const response = await http(worker.id, path);
  expect(response.status).toBe(201);
  expect(response.body).toEqual({ id: row.id, stage: 'CLOSED' });
});
it('approves MEMO with actual priced capabilities and rejects pending as custom non-owner', async () => {
  const who = await exchangeWorker(),
    f = await pendingCase('approve-memo'),
    no = await actor();
  const path = `/after-sales/${f.row.id}/approve`,
    body = { memoAddendumSigned: true, memoMdmSwapped: true };
  expect((await http(no.id, path, body)).status).toBe(403);
  const response = await http(who.id, path, body);
  expect(response.body).toEqual({ id: f.row.id, stage: 'CLOSED' });
  expect(response.status).toBe(201);
  expect((await db.contract.findUniqueOrThrow({ where: { id: f.oldContractId } })).productId).toBe(
    f.newProductId,
  );
  const rejected = await pendingCase('reject-priced'),
    rejectPath = `/after-sales/${rejected.row.id}/reject`;
  expect((await http(no.id, rejectPath, { reason: 'Unavailable' })).status).toBe(403);
  const rejection = await http(who.id, rejectPath, { reason: 'Unavailable' });
  expect(rejection.body).toEqual({ id: rejected.row.id, stage: 'CANCELLED' });
  expect(rejection.status).toBe(201);
});
it('cancels applied MEMO only as current owner and true PRICED draft as authorized non-owner', async () => {
  const who = await exchangeWorker(),
    no = await actor(),
    f = await pendingCase('cancel-memo');
  expect(
    (
      await http(who.id, `/after-sales/${f.row.id}/approve`, {
        memoAddendumSigned: true,
        memoMdmSwapped: true,
      })
    ).status,
  ).toBe(201);
  const path = `/after-sales/${f.row.id}/cancel-swap`,
    body = { reason: 'Customer return requested' };
  expect((await http(no.id, path, body)).status).toBe(403);
  expect((await http(who.id, path, body)).status).toBe(403);
  const response = await http(adminId, path, body);
  expect(response.body).toEqual({ id: f.row.id, stage: 'CANCELLED' });
  expect(response.status).toBe(201);
  const draft = await pendingCase('cancel-draft', false);
  expect(draft.req.status).toBe('PENDING');
  const approval = await http(who.id, `/after-sales/${draft.row.id}/approve`);
  expect(approval.body).toEqual({ id: draft.row.id, stage: 'READY_FOR_PICKUP' });
  const result = await http(who.id, `/after-sales/${draft.row.id}/cancel-swap`, body);
  expect(result.body).toEqual({ id: draft.row.id, stage: 'CANCELLED' });
  expect(result.status).toBe(201);
});

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
async function failAudit(action: string, work: () => Promise<void>) {
  await db.$executeRawUnsafe(
    `CREATE FUNCTION fail_exchange_case_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action = '${action}' THEN RAISE EXCEPTION 'late required exchange case audit'; END IF; RETURN NEW; END $$`,
  );
  await db.$executeRawUnsafe(
    'CREATE TRIGGER fail_exchange_case_audit BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION fail_exchange_case_audit()',
  );
  try {
    await work();
  } finally {
    await db.$executeRawUnsafe('DROP TRIGGER fail_exchange_case_audit ON audit_logs');
    await db.$executeRawUnsafe('DROP FUNCTION fail_exchange_case_audit()');
  }
}
it('rolls back actual defect financial reversal, real repair child and case together, then concurrent confirm commits once', async () => {
  const who = await exchangeWorker(),
    f = await defectCase('defect-rollback', true, true);
  const journals = await db.journalEntry.count(),
    contracts = await db.contract.count(),
    audits = await db.auditLog.count(),
    logs = await db.repairStatusLog.count();
  const path = `/after-sales/${f.row.id}/exchange/confirm`,
    body = { replacementProductId: f.newProductId };
  line.notifyMoment.mockClear();
  await failAudit('AFTER_SALES_EXCHANGE_CONFIRMED', async () => {
    expect((await http(who.id, path, body)).status).toBe(500);
  });
  expect(await db.journalEntry.count()).toBe(journals);
  expect(await db.contract.count()).toBe(contracts);
  expect(await db.auditLog.count()).toBe(audits);
  expect(await db.repairStatusLog.count()).toBe(logs);
  expect((await db.contract.findUniqueOrThrow({ where: { id: f.oldContractId } })).status).toBe(
    'ACTIVE',
  );
  expect(
    (await db.afterSalesCase.findUniqueOrThrow({ where: { id: f.row.id } })).approvedAt,
  ).toBeNull();
  expect(line.notifyMoment).not.toHaveBeenCalled();
  const responses = await Promise.all([http(who.id, path, body), http(who.id, path, body)]);
  expect(responses.map((r) => r.status).sort()).toEqual([201, 409]);
  expect(await db.journalEntry.count()).toBe(journals + 1);
  expect(await db.contract.count()).toBe(contracts + 1);
  expect(await db.repairStatusLog.count()).toBe(logs + 1);
  expect(await db.afterSalesEvent.count({ where: { caseId: f.row.id, kind: 'APPROVED' } })).toBe(1);
  expect(line.notifyMoment).toHaveBeenCalledTimes(1);
});
it('rolls back real finalized PRICED reversal on late case audit, then reverses exactly once', async () => {
  const who = await exchangeWorker(),
    f = await pendingCase('finalized-cancel', false);
  expect((await http(who.id, `/after-sales/${f.row.id}/approve`)).status).toBe(201);
  const req = await db.contractExchangeRequest.findUniqueOrThrow({ where: { id: f.req.id } });
  await finalize(req.newContractId!, who);
  const journals = await db.journalEntry.count(),
    audits = await db.auditLog.count();
  const path = `/after-sales/${f.row.id}/cancel-swap`,
    body = { reason: 'Customer requests cancellation' };
  await failAudit('AFTER_SALES_EXCHANGE_CANCELLED', async () => {
    expect((await http(adminId, path, body)).status).toBe(500);
  });
  expect(await db.journalEntry.count()).toBe(journals);
  expect(await db.auditLog.count()).toBe(audits);
  expect(
    (await db.contractExchangeRequest.findUniqueOrThrow({ where: { id: req.id } })).status,
  ).toBe('APPROVED');
  expect((await db.contract.findUniqueOrThrow({ where: { id: req.newContractId! } })).status).toBe(
    'ACTIVE',
  );
  const responses = await Promise.all([http(adminId, path, body), http(adminId, path, body)]);
  expect(responses.filter((r) => r.status === 201)).toHaveLength(1);
  const count = await db.journalEntry.count();
  expect(count).toBe(journals + 6);
  expect(
    (await db.contractExchangeRequest.findUniqueOrThrow({ where: { id: req.id } })).reversalJeIds,
  ).toHaveLength(6);
  expect(await db.afterSalesEvent.count({ where: { caseId: f.row.id, kind: 'CANCELLED' } })).toBe(
    1,
  );
  expect(
    (await db.product.findUniqueOrThrow({ where: { id: f.oldProductId } })).costPrice.toString(),
  ).toBe('7500');
  expect((await http(adminId, path, body)).status).not.toBe(201);
  expect(await db.journalEntry.count()).toBe(count);
});
it('sends after actual commit outside transaction context and injected retry does not duplicate money or delivery', async () => {
  const who = await exchangeWorker(),
    f = await defectCase('retry-confirm');
  const execute = resources.execute.bind(resources);
  let attempts = 0;
  const spy = jest.spyOn(resources, 'execute').mockImplementation(async (...args) => {
    const handler = args[4]!;
    args[4] = async () => {
      const value = await handler();
      if (++attempts === 1)
        throw new Prisma.PrismaClientKnownRequestError('injected serialization retry', {
          code: 'P2034',
          clientVersion: 'test',
        });
      return value;
    };
    return execute(...args);
  });
  const journals = await db.journalEntry.count();
  line.notifyMoment.mockClear();
  line.notifyMoment.mockImplementationOnce(async () => {
    expect(currentDomainAccess()).toBeUndefined();
    const row = await db.afterSalesCase.findUniqueOrThrow({ where: { id: f.row.id } });
    expect(row.stage).toBe('READY_FOR_PICKUP');
    expect(await db.journalEntry.count()).toBe(journals + 1);
  });
  try {
    expect((await http(who.id, `/after-sales/${f.row.id}/exchange/confirm`)).status).toBe(201);
  } finally {
    spy.mockRestore();
  }
  expect(attempts).toBe(2);
  expect(line.notifyMoment).toHaveBeenCalledTimes(1);
  expect(await db.journalEntry.count()).toBe(journals + 1);
});
import { lockEmployeeAccess } from './access-snapshot.service';
it.each(['revocation', 'case-source', 'product-source', 'owner-demotion'] as const)(
  'rechecks %s after an observed real authority lock wait',
  async (mode) => {
    const who = await exchangeWorker(),
      f = await pendingCase(`wait-${mode}`);
    if (mode === 'owner-demotion') {
      await db.user.update({ where: { id: who.id }, data: { role: 'OWNER' } });
      expect(
        (
          await http(who.id, `/after-sales/${f.row.id}/approve`, {
            memoAddendumSigned: true,
            memoMdmSwapped: true,
          })
        ).status,
      ).toBe(201);
    }
    let release!: () => void, locked!: () => void;
    const held = new Promise<void>((r) => (locked = r)),
      unlock = new Promise<void>((r) => (release = r));
    const change = db.$transaction(
      async (tx) => {
        await lockEmployeeAccess(tx);
        if (mode === 'case-source')
          await tx.afterSalesCase.update({ where: { id: f.row.id }, data: { branchId: branchB } });
        else if (mode === 'product-source')
          await tx.product.update({ where: { id: f.newProductId }, data: { branchId: branchB } });
        else if (mode === 'owner-demotion')
          await tx.user.update({
            where: { id: who.id },
            data: { role: 'ACCOUNTANT', accessRevision: { increment: 1 } },
          });
        else {
          const assignments = await tx.employeeAccessAssignment.findMany({
            where: { userId: who.id, companyCode: 'FINANCE' },
          });
          await tx.accessPosition.updateMany({
            where: { id: { in: assignments.map((a) => a.positionId) } },
            data: { permissions: [] },
          });
        }
        locked();
        await unlock;
      },
      { timeout: 15000 },
    );
    await held;
    const path = `/after-sales/${f.row.id}/${mode === 'owner-demotion' ? 'cancel-swap' : 'approve'}`;
    const pending = http(
      who.id,
      path,
      mode === 'owner-demotion'
        ? { reason: 'Current owner required' }
        : { memoAddendumSigned: true, memoMdmSwapped: true },
    ).then((r) => r);
    try {
      for (let i = 0; i < 100; i++) {
        const [{ waiting }] = await db.$queryRaw<
          Array<{ waiting: boolean }>
        >`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE wait_event='advisory' AND datname=current_database()) AS waiting`;
        if (waiting) break;
        if (i === 99) throw new Error('No observed authority waiter');
        await new Promise((r) => setTimeout(r, 10));
      }
    } finally {
      release();
    }
    await change;
    expect((await pending).status).toBe(403);
    expect(
      (await db.contractExchangeRequest.findUniqueOrThrow({ where: { id: f.req.id } })).status,
    ).toBe(mode === 'owner-demotion' ? 'APPROVED' : 'PENDING');
  },
);
it('keeps original tuples and requires each actual FINANCE, product destination and genuine request source', async () => {
  const who = await actor(),
    f = await pendingCase('source-denials');
  await grant(
    who.id,
    ['after-sales.update', 'products.read', 'customers.read', 'contract-exchanges.approve'],
    'SHOP',
  );
  const path = `/after-sales/${f.row.id}/approve`,
    body = { memoAddendumSigned: true, memoMdmSwapped: true };
  expect((await http(who.id, path, body)).status).toBe(403);
  await grant(who.id, ['products.read', 'customers.read'], 'FINANCE');
  const wrongFinance = await grant(who.id, ['contract-exchanges.approve'], 'FINANCE', [branchB]);
  expect((await http(who.id, path, body)).status).toBe(403);
  await db.accessPosition.update({
    where: { id: wrongFinance.positionId },
    data: { permissions: [] },
  });
  await grant(who.id, ['contract-exchanges.approve'], 'FINANCE');
  await db.product.update({ where: { id: f.newProductId }, data: { branchId: branchB } });
  await grant(who.id, ['products.read', 'contract-exchanges.approve'], 'SHOP', [branchB]);
  await grant(who.id, ['products.read'], 'FINANCE', [branchB]);
  expect((await http(who.id, path, body)).status).toBe(403); // destination FINANCE B action remains absent
  await grant(who.id, ['contract-exchanges.approve'], 'FINANCE', [branchB]);
  const other = await pendingCase('substituted-request');
  await db.afterSalesCase.update({
    where: { id: other.row.id },
    data: { exchangeRequestId: null },
  });
  await db.afterSalesCase.update({
    where: { id: f.row.id },
    data: { exchangeRequestId: other.req.id },
  });
  expect((await http(who.id, path, body)).status).toBe(403);
  expect(
    (await db.contractExchangeRequest.findUniqueOrThrow({ where: { id: other.req.id } })).status,
  ).toBe('PENDING');
});
it('denies missing independent defect approval, mismatched repair and forged managed bypass origin', async () => {
  const who = await actor(),
    f = await defectCase('defect-denials', true, true);
  const permissions = common.filter((p) => p !== 'defect-exchanges.approve');
  await grant(who.id, [...permissions, 'after-sales.update', 'contracts.read'], 'SHOP');
  await grant(who.id, permissions, 'FINANCE');
  const path = `/after-sales/${f.row.id}/exchange/confirm`,
    body = { replacementProductId: f.newProductId };
  expect((await http(who.id, path, body)).status).toBe(403);
  await grant(who.id, ['defect-exchanges.approve'], 'SHOP');
  await grant(who.id, ['defect-exchanges.approve'], 'FINANCE');
  const row = await db.afterSalesCase.findUniqueOrThrow({ where: { id: f.row.id } });
  await db.repairTicket.update({ where: { id: row.repairTicketId! }, data: { branchId: branchB } });
  expect((await http(who.id, path, body)).status).toBe(403);
  await expect(
    run(who.id, () =>
      defect.execute(
        {
          oldContractId: f.oldContractId,
          newProductId: f.newProductId,
          defectReason: 'Invalid origin',
          bypassWindowCheck: true,
        },
        who,
      ),
    ),
  ).rejects.toThrow('origin');
  expect((await db.contract.findUniqueOrThrow({ where: { id: f.oldContractId } })).status).toBe(
    'ACTIVE',
  );
});
import { shopServiceOriginWhere } from './access-service-origin';
it('allows actual COMPANY and owner known-party origins, keeps empty/assigned/foreign tuples closed', async () => {
  const who = await actor(),
    f = await caseFixture('company-origin');
  const p = await db.accessPosition.create({
    data: {
      code: randomUUID(),
      name: 'Company',
      permissions: [
        'after-sales.update',
        'repair-tickets.create',
        'customers.read',
        'contracts.read',
        'products.read',
      ],
    },
  });
  for (const companyCode of ['SHOP', 'FINANCE'] as const)
    await db.employeeAccessAssignment.create({
      data: { userId: who.id, positionId: p.id, companyCode, scope: 'COMPANY' },
    });
  expect((await http(who.id, `/after-sales/${f.row.id}/switch-to-repair`)).status).toBe(201);
  const ownerCase = await caseFixture('owner-origin');
  expect((await http(adminId, `/after-sales/${ownerCase.row.id}/switch-to-repair`)).status).toBe(
    201,
  );
  const scope = {
    userId: who.id,
    company: 'SHOP' as const,
    permission: 'after-sales.update' as const,
    tuples: [],
  };
  for (const tuples of [
    [],
    [{ userId: who.id, scope: 'ASSIGNED' as const, branchIds: [] }],
    [{ userId: who.id, scope: 'BRANCHES' as const, branchIds: [] }],
    [{ userId: adminId, scope: 'COMPANY' as const, branchIds: [] }],
  ]) {
    expect(
      await db.afterSalesCase.count({ where: shopServiceOriginWhere({ ...scope, tuples }) }),
    ).toBe(0);
  }
  expect(
    await db.afterSalesCase.count({
      where: {
        AND: [
          { id: f.row.id },
          shopServiceOriginWhere({
            ...scope,
            tuples: [
              { userId: who.id, scope: 'BRANCHES', branchIds: [branchB] },
              { userId: who.id, scope: 'ASSIGNED', branchIds: [] },
            ],
          }),
        ],
      },
    }),
  ).toBe(0);
});
import { AFTER_SALES_EXCHANGE_ACTION_ROUTES } from './access-after-sales-action-boundaries';
it('covers exactly the seven exchange action HTTP routes', () => {
  expect([...successes].sort()).toEqual([...AFTER_SALES_EXCHANGE_ACTION_ROUTES].sort());
});
it('denies raw managed or wrong-client business loads, FINANCE case context and ASSIGNED-only', async () => {
  const who = await exchangeWorker(),
    f = await pendingCase('raw-boundary');
  await expect(facade.approvePriced(f.row.id, {}, who)).rejects.toBeInstanceOf(ForbiddenException);
  const loader = new AccessAfterSalesExchangeActionService(access, repairAccess);
  await expect(
    resources.execute(
      who.id,
      'after-sales.update',
      'SHOP',
      undefined,
      () => loader.load(db as PrismaService, f.row.id, who.id, 'approve'),
      false,
    ),
  ).rejects.toBeInstanceOf(ForbiddenException);
  expect(
    (await http(who.id, `/after-sales/${f.row.id}/approve`).set('x-company-scope', 'FINANCE'))
      .status,
  ).toBe(403);
  const assigned = await actor(),
    p = await db.accessPosition.create({
      data: { code: randomUUID(), name: 'Assigned', permissions: ['after-sales.update'] },
    });
  await db.employeeAccessAssignment.create({
    data: { userId: assigned.id, positionId: p.id, companyCode: 'SHOP', scope: 'ASSIGNED' },
  });
  expect((await http(assigned.id, `/after-sales/${f.row.id}/approve`)).status).toBe(403);
});
it('delivery rejects missing warranty source or substituted same-party parent before status load', async () => {
  const who = await exchangeWorker(),
    f = await defectCase('delivery-identity');
  expect((await http(who.id, `/after-sales/${f.row.id}/exchange/confirm`)).status).toBe(201);
  const row = await db.afterSalesCase.findUniqueOrThrow({ where: { id: f.row.id } }),
    staff = await actor();
  await grant(staff.id, ['after-sales.update', 'customers.read', 'products.read'], 'SHOP');
  await grant(staff.id, ['products.read'], 'FINANCE');
  const path = `/after-sales/${f.row.id}/exchange/deliver`;
  expect((await http(staff.id, path)).status).toBe(403);
  await grant(staff.id, ['contracts.read'], 'SHOP');
  await db.contract.update({
    where: { id: row.replacementContractId! },
    data: { status: 'ACTIVE', parentContractId: null },
  });
  expect((await http(staff.id, path)).status).toBe(403);
  expect(await db.afterSalesEvent.count({ where: { caseId: f.row.id, kind: 'DELIVERED' } })).toBe(
    0,
  );
});
