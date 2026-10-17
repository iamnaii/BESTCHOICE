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
import { AccessExchangeSourceService } from './access-exchange-source.service';
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
import { PrismaService } from '../../prisma/prisma.service';
import { ContractExchangeService } from '../contract-exchange/contract-exchange.service';
const url = process.env.EMPLOYEE_ACCESS_TEST_DATABASE_URL;
if (
  !url?.includes('/bc_access_task2?host=/tmp/bc-access-aftersales-intake.') ||
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
import { AfterSalesCaseService } from '../after-sales/services/after-sales-case.service';
import { AfterSalesLookupService } from '../after-sales/services/after-sales-lookup.service';
import { AfterSalesDocNumberService } from '../after-sales/services/after-sales-doc-number.service';
import { ProductPhotosService } from '../quality-control/product-photos.service';
const storage = {
  upload: jest.fn(async (_key: string, _buf: Buffer, _mime: string) => undefined),
  delete: jest.fn(async (_key: string) => undefined),
};
const lookup = new AfterSalesLookupService(
  db as PrismaService,
  repair,
  defect,
  new ProductPhotosService(db as PrismaService),
  undefined,
  access,
  resources,
);
import { ChatServiceCaseLinkService } from '../after-sales/services/chat-service-case-link.service';
import { ChatWorkAccessService } from '../staff-chat/services/chat-work-access.service';
const chatLinks = new ChatServiceCaseLinkService(
  db as PrismaService,
  new ChatWorkAccessService(db as PrismaService),
  resources,
  repairAccess,
  access,
);
const intake = new AfterSalesCaseService(
  db as PrismaService,
  storage as never,
  audit,
  repair,
  new AfterSalesDocNumberService(db as PrismaService),
  lookup,
  svc,
  defect,
  line as never,
  chatLinks,
  resources,
  repairAccess,
  access,
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
        useValue: new AfterSalesService(lookup, intake, {} as never, {} as never, facade),
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

const imageBytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]);
function create(id: string, body: Record<string, string>) {
  let r = request(app.getHttpServer()).post('/after-sales').set('x-test-user', id);
  for (const [key, value] of Object.entries(body)) r = r.field(key, value);
  return r.attach('photos', imageBytes, { filename: 'intake.jpg', contentType: 'image/jpeg' });
}
it('creates WALK_IN via actual HTTP with destination/child create and denies no grants before storage', async () => {
  const who = await actor(),
    denied = await actor();
  await grant(who.id, ['after-sales.create', 'repair-tickets.create', 'customers.read'], 'SHOP');
  const c = await db.customer.create({
    data: { name: 'Walk in', phone: '0800000000', nationalId: randomUUID() },
  });
  await db.tradeIn.create({
    data: { customerId: c.id, branchId, deviceBrand: 'Test', deviceModel: 'Test' },
  });
  const body = {
    imei: 'WALK-' + Date.now(),
    customerId: c.id,
    branchId,
    deviceBrand: 'Apple',
    deviceModel: 'Unknown',
    symptom: 'Broken screen',
    accessories: '{}',
    unlockConfirmed: 'true',
    outcome: 'REPAIR',
  };
  storage.upload.mockClear();
  expect((await create(denied.id, body)).status).toBe(403);
  expect(storage.upload).not.toHaveBeenCalled();
  const response = await create(who.id, body);
  expect(response.status).toBe(201);
  expect(response.body).toEqual({ id: expect.any(String), stage: 'RECEIVED' });
  expect(
    (await db.afterSalesCase.findUniqueOrThrow({ where: { id: response.body.id } })).repairTicketId,
  ).toBeTruthy();
});

async function walk() {
  const who = await actor();
  await grant(who.id, ['after-sales.create', 'repair-tickets.create', 'customers.read'], 'SHOP');
  const c = await db.customer.create({
    data: { name: 'Walk', phone: '0800000000', nationalId: randomUUID() },
  });
  await db.tradeIn.create({
    data: { customerId: c.id, branchId, deviceBrand: 'Apple', deviceModel: 'Test' },
  });
  return {
    who,
    body: {
      imei: randomUUID().slice(0, 28),
      customerId: c.id,
      branchId,
      deviceBrand: 'Apple',
      deviceModel: 'Unknown',
      symptom: 'Broken screen',
      accessories: '{}',
      unlockConfirmed: 'true',
      outcome: 'REPAIR',
    },
  };
}
async function historical(outcome = 'SAME_MODEL_EXCHANGE') {
  const f = await seedSwapFixture(randomUUID().slice(0, 7), { memo: true });
  await db.product.updateMany({
    where: { id: { in: [f.oldProductId, f.newProductId] } },
    data: { category: 'PHONE_USED' },
  });
  await db.contract.update({
    where: { id: f.oldContractId },
    data: {
      deviceReceivedAt: new Date(Date.now() - 20 * DAY),
      shopWarrantyEndDate: new Date(Date.now() + 40 * DAY),
    },
  });
  if (outcome === 'PRICED_EXCHANGE') {
    await db.product.update({
      where: { id: f.newProductId },
      data: { model: 'Different-' + f.newProductId, installmentPrice: 15000 },
    });
    await act1a.execute(f.oldContractId);
    await seedStatementReview(db, f.customerId);
    await db.tradeInValuation.upsert({
      where: {
        brand_model_storage_condition: {
          brand: 'ExchTestBrand',
          model: 'MemoModel',
          storage: '128GB',
          condition: 'A',
        },
      },
      create: {
        brand: 'ExchTestBrand',
        model: 'MemoModel',
        storage: '128GB',
        condition: 'A',
        basePrice: 11000,
      },
      update: { basePrice: 11000 },
    });
  }
  const sale = await db.sale.create({
    data: {
      saleNumber: randomUUID(),
      saleType: 'INSTALLMENT',
      customerId: f.customerId,
      productId: f.oldProductId,
      branchId,
      salespersonId: adminId,
      sellingPrice: 12000,
      netAmount: 12000,
      contractId: f.oldContractId,
    },
  });
  const who = await actor();
  await grant(
    who.id,
    [
      'after-sales.create',
      'repair-tickets.create',
      'customers.read',
      'products.read',
      'contracts.read',
      'sales.read',
      'defect-exchanges.create',
      'contract-exchanges.create',
    ],
    'SHOP',
  );
  await grant(
    who.id,
    ['products.read', 'customers.read', 'defect-exchanges.create', 'contract-exchanges.create'],
    'FINANCE',
  );
  return {
    ...f,
    sale,
    who,
    body: {
      imei: (await db.product.findUniqueOrThrow({ where: { id: f.oldProductId } })).imeiSerial!,
      branchId,
      symptom: 'Broken screen',
      accessories: '{}',
      unlockConfirmed: 'true',
      outcome,
      replacementProductId: f.newProductId,
      buybackPrice: '11000',
      deviceCondition: 'A',
      newTotalMonths: '12',
    },
  };
}
it('submits past-window SAME_MODEL with create only and real identity, without approval or public reads', async () => {
  const f = await historical();
  const r = await create(f.who.id, f.body);
  expect(r.status).toBe(201);
  expect(r.body).toEqual({ id: expect.any(String), stage: 'AWAITING_APPROVAL' });
  expect((await db.afterSalesCase.findUniqueOrThrow({ where: { id: r.body.id } })).contractId).toBe(
    f.oldContractId,
  );
  expect(await db.contract.count({ where: { parentContractId: f.oldContractId } })).toBe(0);
});
it('creates canonical PRICED request in the outer transaction and AUTO create-only remains pending', async () => {
  const f = await historical('PRICED_EXCHANGE');
  const r = await create(f.who.id, f.body);
  expect(r.status).toBe(201);
  const row = await db.afterSalesCase.findUniqueOrThrow({
    where: { id: r.body.id },
    include: { exchangeRequest: true },
  });
  expect(row.exchangeRequest?.approvalTier).toBe('AUTO');
  expect(row.exchangeRequest?.status).toBe('PENDING');
  expect(row.stage).toBe('AWAITING_APPROVAL');
});
it('permits destination B with history A reads and denies permission-redacted latest history before upload', async () => {
  const f = await historical('REPAIR');
  const who = await actor();
  await grant(who.id, ['after-sales.create', 'repair-tickets.create'], 'SHOP', [branchB]);
  await grant(who.id, ['sales.read', 'contracts.read', 'customers.read'], 'SHOP');
  await grant(who.id, ['products.read'], 'FINANCE');
  const body = { ...f.body, branchId: branchB };
  const r = await create(who.id, body);
  expect(r.status).toBe(201);
  const g = await historical('REPAIR');
  const no = await actor();
  await grant(
    no.id,
    ['after-sales.create', 'repair-tickets.create', 'customers.read', 'contracts.read'],
    'SHOP',
  );
  await grant(no.id, ['products.read'], 'FINANCE');
  storage.upload.mockClear();
  expect((await create(no.id, { ...g.body, customerId: g.customerId })).status).toBe(403);
  expect(storage.upload).not.toHaveBeenCalled();
});
it('holds global IMEI exclusion through insertion: concurrent intake creates one case and one repair', async () => {
  const { who, body } = await walk();
  line.notifyMoment.mockClear();
  const results = await Promise.all([create(who.id, body), create(who.id, body)]);
  expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
  expect(await db.afterSalesCase.count({ where: { deviceImei: body.imei } })).toBe(1);
  expect(await db.repairTicket.count({ where: { deviceImei: body.imei } })).toBe(1);
  expect(line.notifyMoment).toHaveBeenCalledTimes(1);
});
it('foreign open conflict is generic and terminal foreign candidate permits intake without foreign writes', async () => {
  const { who, body } = await walk();
  const foreign = await db.afterSalesCase.create({
    data: {
      caseNumber: 'FOREIGN-SECRET',
      warrantySnapshot: { status: 'WALK_IN' },
      branchId: branchB,
      customerId: body.customerId,
      deviceImei: body.imei,
      source: 'WALK_IN',
      outcome: 'SAME_MODEL_EXCHANGE',
      stage: 'RECEIVED',
      symptom: 'Broken screen',
      receivedById: adminId,
    },
  });
  const conflict = await create(who.id, body);
  expect(conflict.status).toBe(409);
  expect(JSON.stringify(conflict.body)).not.toContain('FOREIGN');
  await db.afterSalesCase.update({
    where: { id: foreign.id },
    data: { stage: 'CANCELLED', cancelledAt: new Date() },
  });
  const before = await db.afterSalesCase.findUniqueOrThrow({ where: { id: foreign.id } });
  expect((await create(who.id, body)).status).toBe(201);
  expect(await db.afterSalesCase.findUniqueOrThrow({ where: { id: foreign.id } })).toEqual(before);
  expect(await db.auditLog.count({ where: { entityId: foreign.id } })).toBe(0);
});
it('late durable audit failure rolls back canonical repair, case, logs and effects and cleans only owned keys', async () => {
  const { who, body } = await walk();
  await centralChat(who.id, 'COMPANY');
  const req = await requestFor(body.customerId);
  const statusLogs = await db.repairStatusLog.count();
  storage.upload.mockClear();
  storage.delete.mockClear();
  line.notifyMoment.mockClear();
  await db.$executeRawUnsafe(
    `CREATE FUNCTION fail_intake_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='AFTER_SALES_CASE_CREATED' THEN RAISE EXCEPTION 'deliberate intake audit failure'; END IF; RETURN NEW; END $$`,
  );
  await db.$executeRawUnsafe(
    `CREATE TRIGGER fail_intake_audit BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION fail_intake_audit()`,
  );
  try {
    expect((await create(who.id, { ...body, serviceRequestId: req.id })).status).toBe(500);
  } finally {
    await db.$executeRawUnsafe('DROP TRIGGER fail_intake_audit ON audit_logs');
    await db.$executeRawUnsafe('DROP FUNCTION fail_intake_audit()');
  }
  expect(await db.afterSalesCase.count({ where: { deviceImei: body.imei } })).toBe(0);
  expect(await db.repairTicket.count({ where: { deviceImei: body.imei } })).toBe(0);
  expect(line.notifyMoment).not.toHaveBeenCalled();
  expect(await db.repairStatusLog.count()).toBe(statusLogs);
  expect(
    (await db.chatServiceRequest.findUniqueOrThrow({ where: { id: req.id } })).afterSalesCaseId,
  ).toBeNull();
  expect(await db.chatServiceRequestEvent.count({ where: { requestId: req.id } })).toBe(0);
  expect(await db.auditLog.count({ where: { entityId: req.id } })).toBe(0);
  expect(storage.delete.mock.calls.map((c) => c[0])).toEqual(
    storage.upload.mock.calls.map((c) => c[0]),
  );
});
it('stages outside ALS and authority lock, then denies revoked create and cleans uploads', async () => {
  const { who, body } = await walk();
  storage.delete.mockClear();
  storage.upload.mockImplementationOnce(async () => {
    expect(currentDomainAccess()).toBeUndefined();
    await db.employeeAccessAssignment.updateMany({
      where: { userId: who.id },
      data: { deletedAt: new Date() },
    });
  });
  expect((await create(who.id, body)).status).toBe(403);
  expect(storage.delete).toHaveBeenCalledTimes(1);
  expect(await db.afterSalesCase.count({ where: { deviceImei: body.imei } })).toBe(0);
});
it('rejects changed authorized purchase-photo content before consuming staged intake', async () => {
  const f = await historical('REPAIR');
  const photo = 'data:image/jpeg;base64,' + imageBytes.toString('base64');
  await db.productPhoto.create({ data: { productId: f.oldProductId, front: photo } });
  storage.upload.mockClear();
  storage.delete.mockClear();
  storage.upload.mockImplementationOnce(async () => {
    await db.productPhoto.update({ where: { productId: f.oldProductId }, data: { front: null } });
  });
  expect((await create(f.who.id, f.body)).status).toBe(409);
  expect(storage.upload).toHaveBeenCalledTimes(2);
  expect(storage.delete).toHaveBeenCalledTimes(2);
  expect(await db.afterSalesCase.count({ where: { productId: f.oldProductId } })).toBe(0);
});
async function requestFor(customerId: string, assigneeId?: string) {
  await db.systemConfig.upsert({
    where: { key: 'chat_service_requests_enabled' },
    create: { key: 'chat_service_requests_enabled', value: 'true' },
    update: { value: 'true' },
  });
  const room = await db.chatRoom.create({ data: { channel: 'LINE_SHOP', customerId } });
  const todo = await db.todo.create({
    data: { title: 'Service', createdById: adminId, assigneeId, roomId: room.id },
  });
  return db.chatServiceRequest.create({
    data: {
      roomId: room.id,
      todoId: todo.id,
      customerId,
      createdById: adminId,
      requestKey: randomUUID(),
      requestFingerprint: randomUUID(),
      symptom: 'Broken screen',
    },
  });
}
async function centralChat(userId: string, scope: 'COMPANY' | 'ASSIGNED', branches: string[] = []) {
  const p = await db.accessPosition.create({
    data: { code: randomUUID(), name: 'Chat', permissions: ['chat.update'] },
  });
  return db.employeeAccessAssignment.create({
    data: {
      userId,
      positionId: p.id,
      companyCode: 'SHOP',
      scope,
      branches: { create: branches.map((branchId) => ({ branchId })) },
    },
  });
}
it.each(['COMPANY', 'ASSIGNED'] as const)(
  'links genuinely unanchored request via %s and idempotent reuse avoids duplicate files/children/effects',
  async (scope) => {
    const { who, body } = await walk();
    await centralChat(who.id, scope);
    const req = await requestFor(body.customerId, scope === 'ASSIGNED' ? who.id : undefined);
    const input = { ...body, serviceRequestId: req.id };
    const first = await create(who.id, input);
    expect(first.status).toBe(201);
    storage.upload.mockClear();
    line.notifyMoment.mockClear();
    const again = await create(who.id, input);
    expect(again.status).toBe(201);
    expect(again.body).toEqual(first.body);
    expect(storage.upload).not.toHaveBeenCalled();
    expect(line.notifyMoment).not.toHaveBeenCalled();
    expect(
      await db.chatServiceRequestEvent.count({ where: { requestId: req.id, kind: 'LINK_CASE' } }),
    ).toBe(1);
  },
);
it('denies branch-only and branch-restricted assignment for unanchored request; creator/room assignee confer nothing', async () => {
  const { who, body } = await walk();
  await grant(who.id, ['chat.update'], 'SHOP');
  const req = await requestFor(body.customerId, who.id);
  await db.chatRoom.update({ where: { id: req.roomId }, data: { assignedToId: who.id } });
  await db.chatServiceRequest.update({ where: { id: req.id }, data: { createdById: who.id } });
  storage.upload.mockClear();
  expect((await create(who.id, { ...body, serviceRequestId: req.id })).status).toBe(403);
  await centralChat(who.id, 'ASSIGNED', [branchId]);
  expect((await create(who.id, { ...body, serviceRequestId: req.id })).status).toBe(403);
  expect(storage.upload).not.toHaveBeenCalled();
});
import { lockEmployeeAccess } from './access-snapshot.service';
it.each(['revocation', 'product-source', 'request-assignee'] as const)(
  'rechecks %s after staging and observed real authority wait',
  async (mode) => {
    const f = await historical('REPAIR');
    const body: { [key: string]: string } = { ...f.body };
    let reqId: string | undefined;
    if (mode === 'request-assignee') {
      await centralChat(f.who.id, 'ASSIGNED');
      const req = await requestFor(f.customerId, f.who.id);
      reqId = req.id;
      body.serviceRequestId = req.id;
    }
    let release!: () => void, ready!: () => void;
    const held = new Promise<void>((r) => (ready = r)),
      unlock = new Promise<void>((r) => (release = r));
    let change: Promise<unknown> | undefined;
    storage.upload.mockImplementationOnce(async () => {
      change = db.$transaction(
        async (tx) => {
          await lockEmployeeAccess(tx);
          if (mode === 'revocation')
            await tx.employeeAccessAssignment.updateMany({
              where: { userId: f.who.id, companyCode: 'FINANCE' },
              data: { deletedAt: new Date() },
            });
          else if (mode === 'product-source')
            await tx.product.update({ where: { id: f.oldProductId }, data: { branchId: branchB } });
          else {
            const req = await tx.chatServiceRequest.findUniqueOrThrow({ where: { id: reqId } });
            await tx.todo.update({ where: { id: req.todoId }, data: { assigneeId: null } });
          }
          ready();
          await unlock;
        },
        { timeout: 15000 },
      );
      await held;
    });
    const pending = create(f.who.id, body).then((r) => r);
    await held;
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
    expect(await db.afterSalesCase.count({ where: { productId: f.oldProductId } })).toBe(0);
  },
);
it('retries actual rolled-back mutation without restaging and commits one child/audit/effect', async () => {
  const { who, body } = await walk();
  const execute = resources.execute.bind(resources);
  let writes = 0;
  const spy = jest.spyOn(resources, 'execute').mockImplementation(async (...args) => {
    const handler = args[4]!;
    args[4] = async () => {
      const value = await handler();
      if (
        await currentDomainAccess()!.client.afterSalesCase.count({
          where: { deviceImei: body.imei },
        })
      ) {
        if (++writes === 1)
          throw new Prisma.PrismaClientKnownRequestError('injected serialization retry', {
            code: 'P2034',
            clientVersion: 'test',
          });
      }
      return value;
    };
    return execute(...args);
  });
  storage.upload.mockClear();
  line.notifyMoment.mockClear();
  line.notifyMoment.mockImplementationOnce(async () => {
    expect(currentDomainAccess()).toBeUndefined();
    expect(await db.afterSalesCase.count({ where: { deviceImei: body.imei } })).toBe(1);
  });
  try {
    expect((await create(who.id, body)).status).toBe(201);
  } finally {
    spy.mockRestore();
  }
  expect(writes).toBe(2);
  expect(storage.upload).toHaveBeenCalledTimes(1);
  expect(line.notifyMoment).toHaveBeenCalledTimes(1);
  expect(await db.repairTicket.count({ where: { deviceImei: body.imei } })).toBe(1);
});
it('all-source canonical AUTO approval joins creation, and late audit rolls back its real financial and status writes', async () => {
  const f = await historical('PRICED_EXCHANGE');
  await grant(f.who.id, ['contract-exchanges.approve', 'contracts.update'], 'SHOP');
  await grant(f.who.id, ['contract-exchanges.approve', 'contracts.update'], 'FINANCE');
  const before = {
    contracts: await db.contract.count(),
    requests: await db.contractExchangeRequest.count(),
    journals: await db.journalEntry.count(),
  };
  line.notifyMoment.mockClear();
  await db.$executeRawUnsafe(
    `CREATE FUNCTION fail_intake_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='AFTER_SALES_CASE_CREATED' THEN RAISE EXCEPTION 'deliberate intake audit failure'; END IF; RETURN NEW; END $$`,
  );
  await db.$executeRawUnsafe(
    `CREATE TRIGGER fail_intake_audit BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION fail_intake_audit()`,
  );
  try {
    expect((await create(f.who.id, f.body)).status).toBe(500);
  } finally {
    await db.$executeRawUnsafe('DROP TRIGGER fail_intake_audit ON audit_logs');
    await db.$executeRawUnsafe('DROP FUNCTION fail_intake_audit()');
  }
  expect(await db.contract.count()).toBe(before.contracts);
  expect(await db.contractExchangeRequest.count()).toBe(before.requests);
  expect(await db.journalEntry.count()).toBe(before.journals);
  expect(await db.afterSalesCase.count({ where: { contractId: f.oldContractId } })).toBe(0);
  expect(line.notifyMoment).not.toHaveBeenCalled();
  const result = await create(f.who.id, f.body);
  expect(result.status).toBe(201);
  expect(result.body.stage).toBe('READY_FOR_PICKUP');
  expect(await db.contract.count()).toBe(before.contracts + 1);
  expect(line.notifyMoment).toHaveBeenCalledTimes(2);
});
it('all fourteen exact runtime mutation registrations exist', () => {
  expect([
    ...AFTER_SALES_ACTION_ROUTES,
    ...AFTER_SALES_EXCHANGE_ACTION_ROUTES,
    ...AFTER_SALES_INTAKE_ROUTES,
  ]).toHaveLength(14);
  for (const route of [
    ...AFTER_SALES_ACTION_ROUTES,
    ...AFTER_SALES_EXCHANGE_ACTION_ROUTES,
    ...AFTER_SALES_INTAKE_ROUTES,
  ])
    expect(ACCESS_BOUNDARIES.has(route)).toBe(true);
});
import {
  AFTER_SALES_ACTION_ROUTES,
  AFTER_SALES_EXCHANGE_ACTION_ROUTES,
  AFTER_SALES_INTAKE_ROUTES,
} from './access-after-sales-action-boundaries';
import { ACCESS_BOUNDARIES } from './access-policy.registry';
it('requires each actual request origin across room SHOP and current FINANCE Product, denies stale and substituted references', async () => {
  const f = await historical('REPAIR');
  await centralChat(f.who.id, 'COMPANY');
  const req = await requestFor(f.customerId);
  await db.chatServiceRequest.update({
    where: { id: req.id },
    data: { requestedProductId: f.oldProductId, contractId: f.oldContractId, saleId: f.sale.id },
  });
  const body = { ...f.body, serviceRequestId: req.id };
  storage.upload.mockClear();
  expect((await create(f.who.id, body)).status).toBe(403);
  expect(storage.upload).not.toHaveBeenCalled();
  await grant(f.who.id, ['chat.update'], 'FINANCE');
  await db.sale.update({ where: { id: f.sale.id }, data: { deletedAt: new Date() } });
  expect((await create(f.who.id, body)).status).toBe(403);
  await db.sale.update({ where: { id: f.sale.id }, data: { deletedAt: null } });
  await db.chatServiceRequest.update({
    where: { id: req.id },
    data: { requestedProductId: f.newProductId },
  });
  expect((await create(f.who.id, body)).status).toBe(400);
  await db.chatServiceRequest.update({
    where: { id: req.id },
    data: { requestedProductId: f.oldProductId },
  });
  expect((await create(f.who.id, body)).status).toBe(201);
});
it('preserves original grant tuples and independently requires repair child creation before storage', async () => {
  const { body } = await walk();
  const who = await actor();
  await grant(who.id, ['after-sales.create', 'customers.read'], 'SHOP');
  await grant(who.id, ['repair-tickets.create'], 'SHOP', [branchB]);
  storage.upload.mockClear();
  expect((await create(who.id, body)).status).toBe(403);
  expect(storage.upload).not.toHaveBeenCalled();
});
it('concurrent source-request reuse creates one child, keeps winner keys and cleans only newly unused keys', async () => {
  const { who, body } = await walk();
  await centralChat(who.id, 'COMPANY');
  const req = await requestFor(body.customerId);
  storage.upload.mockClear();
  storage.delete.mockClear();
  line.notifyMoment.mockClear();
  let release!: () => void, staged!: () => void;
  const waiting = new Promise<void>((r) => (staged = r)),
    unlock = new Promise<void>((r) => (release = r));
  storage.upload.mockImplementationOnce(async () => {
    staged();
    await unlock;
  });
  const first = create(who.id, { ...body, serviceRequestId: req.id }).then((r) => r);
  await waiting;
  const second = await create(who.id, { ...body, serviceRequestId: req.id });
  release();
  const result = await first;
  expect(second.status).toBe(201);
  expect(result.body).toEqual(second.body);
  expect(await db.repairTicket.count({ where: { deviceImei: body.imei } })).toBe(1);
  expect(storage.upload).toHaveBeenCalledTimes(2);
  expect(storage.delete).toHaveBeenCalledTimes(1);
  const row = await db.afterSalesCase.findUniqueOrThrow({ where: { id: second.body.id } });
  expect(storage.delete.mock.calls[0][0]).not.toBe(row.photoKeys[0]);
  expect(line.notifyMoment).toHaveBeenCalledTimes(1);
  await db.afterSalesCase.update({ where: { id: row.id }, data: { branchId: branchB } });
  storage.upload.mockClear();
  expect((await create(who.id, { ...body, serviceRequestId: req.id })).status).toBe(403);
  expect(storage.upload).not.toHaveBeenCalled();
});
it('validates copied bytes before storage, and deletes an operation-owned failed upload key', async () => {
  const f = await historical('REPAIR');
  await db.productPhoto.create({
    data: { productId: f.oldProductId, front: 'data:image/jpeg;base64,YmFk' },
  });
  storage.upload.mockClear();
  expect((await create(f.who.id, f.body)).status).toBe(400);
  expect(storage.upload).not.toHaveBeenCalled();
  const { who, body } = await walk();
  storage.delete.mockClear();
  storage.upload.mockRejectedValueOnce(new Error('simulated storage failure after put'));
  expect((await create(who.id, body)).status).toBe(500);
  expect(storage.delete.mock.calls.map((c) => c[0])).toEqual(
    storage.upload.mock.calls.map((c) => c[0]),
  );
  expect(await db.afterSalesCase.count({ where: { deviceImei: body.imei } })).toBe(0);
});
it('rejects raw managed calls and FINANCE intake context', async () => {
  const { who, body } = await walk();
  await expect(intake.createCase(body as never, [], who)).rejects.toThrow('ธุรกรรม');
  const response = await request(app.getHttpServer())
    .post('/after-sales?company=FINANCE')
    .set('x-test-user', who.id)
    .field('branchId', branchId);
  expect(response.status).toBe(403);
});
it('physical receipt records original purchase copies and sends only after actual committed case', async () => {
  const f = await historical('REPAIR');
  await db.productPhoto.create({
    data: {
      productId: f.oldProductId,
      front: 'data:image/jpeg;base64,' + imageBytes.toString('base64'),
    },
  });
  storage.upload.mockClear();
  storage.delete.mockClear();
  line.notifyMoment.mockImplementationOnce(async () => {
    expect(currentDomainAccess()).toBeUndefined();
    expect(await db.afterSalesCase.count({ where: { productId: f.oldProductId } })).toBe(1);
  });
  const response = await create(f.who.id, f.body);
  expect(response.status).toBe(201);
  const row = await db.afterSalesCase.findUniqueOrThrow({ where: { id: response.body.id } });
  expect(row.productId).toBe(f.oldProductId);
  expect(row.purchasePhotoKeys).toHaveLength(1);
  expect(row.photoKeys).toHaveLength(1);
  expect(storage.upload).toHaveBeenCalledTimes(2);
  expect(storage.delete).not.toHaveBeenCalled();
});
import { EmployeeAccessService } from './employee-access.service';
it('actual canonical replaceAssignments retirement while staged intake waits reauthorizes and denies', async () => {
  const { who, body } = await walk();
  let ready!: () => void, release!: () => void;
  const held = new Promise<void>((r) => (ready = r)),
    unlock = new Promise<void>((r) => (release = r));
  let replacement: Promise<unknown> | undefined;
  // Hold the canonical owner mutation immediately before its outer commit; no writer is mocked.
  const original = db.$transaction.bind(db);
  let intercepted = false;
  const proxy = new Proxy(db, {
    get(target, key) {
      if (key === '$transaction')
        return async (work: (tx: Prisma.TransactionClient) => Promise<unknown>) =>
          original(async (tx) => {
            const value = await work(tx);
            if (!intercepted) {
              intercepted = true;
              ready();
              await unlock;
            }
            return value;
          });
      const value = Reflect.get(target, key);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  const service = new EmployeeAccessService(proxy as PrismaService, snapshots);
  storage.upload.mockImplementationOnce(async () => {
    replacement = service.replaceAssignments(adminId, who.id, {
      expectedRevision: 0,
      assignments: [],
    });
    await held;
  });
  const pending = create(who.id, body).then((r) => r);
  await held;
  try {
    for (let i = 0; i < 100; i++) {
      const [{ waiting }] = await db.$queryRaw<
        Array<{ waiting: boolean }>
      >`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE wait_event='advisory' AND datname=current_database()) AS waiting`;
      if (waiting) break;
      if (i === 99) throw new Error('No observed canonical retirement waiter');
      await new Promise((r) => setTimeout(r, 10));
    }
  } finally {
    release();
  }
  await replacement;
  expect((await pending).status).toBe(403);
  expect((await db.user.findUniqueOrThrow({ where: { id: who.id } })).accessRevision).toBe(1);
  expect(await db.afterSalesCase.count({ where: { deviceImei: body.imei } })).toBe(0);
  expect(
    await db.auditLog.count({ where: { entityId: who.id, action: 'ACCESS_ASSIGNMENTS_REPLACED' } }),
  ).toBe(1);
});
it('reuses an applied MEMO request with current Contract device and original case/request provenance', async () => {
  const f = await historical();
  const body: Record<string, string> = { ...f.body };
  delete body.buybackPrice;
  delete body.deviceCondition;
  delete body.newTotalMonths;
  await centralChat(f.who.id, 'COMPANY');
  const req = await requestFor(f.customerId);
  await grant(
    f.who.id,
    ['after-sales.update', 'contract-exchanges.approve', 'contracts.update'],
    'SHOP',
  );
  await grant(f.who.id, ['contract-exchanges.approve', 'contracts.update'], 'FINANCE');
  const input = { ...body, outcome: 'PRICED_EXCHANGE', serviceRequestId: req.id };
  const first = await create(f.who.id, input);
  expect(first.status).toBe(201);
  expect(
    (
      await http(f.who.id, `/after-sales/${first.body.id}/approve`, {
        memoAddendumSigned: true,
        memoMdmSwapped: true,
      })
    ).status,
  ).toBe(201);
  storage.upload.mockClear();
  const reused = await create(f.who.id, input);
  expect(reused.status).toBe(201);
  expect(reused.body).toEqual({ id: first.body.id, stage: 'CLOSED' });
  expect(storage.upload).not.toHaveBeenCalled();
});
it.each(['category', 'model', 'credit', 'manufacturer'] as const)(
  'retains canonical non-window %s gate before any intake storage',
  async (mode) => {
    const f = await historical();
    if (mode === 'category')
      await db.product.update({ where: { id: f.oldProductId }, data: { category: 'PHONE_NEW' } });
    if (mode === 'model')
      await db.product.update({ where: { id: f.newProductId }, data: { model: 'Different' } });
    if (mode === 'credit')
      await db.contract.update({
        where: { id: f.oldContractId },
        data: { tradeInCreditSnapshot: { credit: 'present' } },
      });
    if (mode === 'manufacturer') {
      await db.contract.update({
        where: { id: f.oldContractId },
        data: { shopWarrantyEndDate: new Date(Date.now() - DAY) },
      });
      await db.product.update({
        where: { id: f.oldProductId },
        data: { warrantyExpireDate: new Date(Date.now() + 30 * DAY) },
      });
    }
    storage.upload.mockClear();
    expect((await create(f.who.id, f.body)).status).toBe(400);
    expect(storage.upload).not.toHaveBeenCalled();
  },
);
import { AccessAfterSalesProjectionService } from './access-after-sales-projection.service';
import { AccessAfterSalesSourceService } from './access-after-sales-source.service';
import { AccessRepairProjectionService } from './access-repair-projection.service';
it('public lookup hints use explicit submission capabilities at a usable destination without approval or defect read', async () => {
  const f = await historical();
  await db.employeeAccessAssignment.updateMany({
    where: { userId: f.who.id, companyCode: 'SHOP' },
    data: { deletedAt: new Date() },
  });
  await grant(
    f.who.id,
    [
      'after-sales.read',
      'repair-tickets.read',
      'contracts.read',
      'products.read',
      'customers.read',
      'sales.read',
    ],
    'SHOP',
  );
  await grant(f.who.id, ['after-sales.create', 'repair-tickets.create'], 'SHOP', [branchB]);
  const reader = new AfterSalesLookupService(
    db as PrismaService,
    repair,
    defect,
    new ProductPhotosService(db as PrismaService),
    new AccessAfterSalesProjectionService(
      new AccessAfterSalesSourceService(resources, repairAccess, access),
      new AccessRepairProjectionService(resources, repairAccess),
    ),
    access,
    resources,
  );
  const result = await resources.execute(
    f.who.id,
    'after-sales.read',
    'SHOP',
    undefined,
    () => reader.lookup({ imei: f.body.imei }, f.who),
    false,
    { isolationLevel: 'Serializable', maxAttempts: 3 },
  );
  expect(result.result.outcomes.find((o) => o.outcome === 'SAME_MODEL_EXCHANGE')?.enabled).toBe(
    true,
  );
  expect(result.result.outcomes.find((o) => o.outcome === 'PRICED_EXCHANGE')?.enabled).toBe(true);
});
