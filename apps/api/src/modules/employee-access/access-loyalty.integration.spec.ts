import { AccessLoyaltyBoundaries, LOYALTY_BOUNDARY_ROUTES } from './access-loyalty-boundaries';
import { ACCESS_BOUNDARIES, ACCESS_POLICIES } from './access-policy.registry';
import { AccessSalesBoundaries } from './access-sales-boundaries';
import { AccessSalesProjectionService } from './access-sales-projection.service';
import { AccessTradeInProjectionService } from './access-trade-in-projection.service';
import { SalesController } from '../sales/sales.controller';
import { SalesService } from '../sales/sales.service';
import { SaleVoidService } from '../sales/services/sale-void.service';
import { SaleWarrantyNotifierService } from '../sales/services/sale-warranty-notifier.service';
import { InterCompanyService } from '../inter-company/inter-company.service';
import { BookingsController } from '../bookings/bookings.controller';
import { BookingsService } from '../bookings/bookings.service';
import { ShopCashSaleTemplate } from '../journal/cpa-templates/shop-cash-sale.template';
import { ShopExternalFinanceSaleTemplate } from '../journal/cpa-templates/shop-external-finance-sale.template';
import { ShopBookingDepositTemplate } from '../journal/cpa-templates/shop-booking-deposit.template';
import { ShopBookingForfeitTemplate } from '../journal/cpa-templates/shop-booking-forfeit.template';
import { ShopBookingDepositAppliedTemplate } from '../journal/cpa-templates/shop-booking-deposit-applied.template';
import { ShopBookingRefundTemplate } from '../journal/cpa-templates/shop-booking-refund.template';
import { ExchangeCancelReversalTemplate } from '../journal/cpa-templates/exchange-cancel-reversal.template';
import { ShopAccountResolver } from '../journal/shop-account-resolver.service';
import { CompanyResolverService } from '../journal/company-resolver.service';
import { JournalAutoService } from '../journal/journal-auto.service';
import { seedShopCoa } from '../../../prisma/seed-coa-shop';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { Test } from '@nestjs/testing';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { ExecutionContext, INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { PERMISSION_CATALOG, PermissionKey } from '@installment/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AccessSnapshotService, lockEmployeeAccess } from './access-snapshot.service';
import { AccessResourceService } from './access-resource.service';
import { AccessPolicyService } from './access-policy';
import { AccessPolicyInterceptor } from './access-policy.interceptor';
import { AccessPartyBoundaries } from './access-party-boundaries';
import { AccessPartySourceService } from './access-party-source.service';
import { AccessProcurementSourceService } from './access-procurement-source.service';
import { AuditInterceptor } from '../audit/audit.interceptor';
import { AuditService } from '../audit/audit.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { BranchGuard } from '../auth/guards/branch.guard';
import { LoyaltyController } from '../loyalty/loyalty.controller';
import { LoyaltyService } from '../loyalty/loyalty.service';
const url = process.env.EMPLOYEE_ACCESS_TEST_DATABASE_URL;
if (!url?.includes('/bc_access_task2?host=/tmp/bc-access-loyalty.'))
  throw new Error('Owned isolated database required');
const db = new PrismaClient({ datasources: { db: { url } } });
const testRun = randomUUID();
const pendingAudits = new Set<Promise<unknown>>();
const snapshots = new AccessSnapshotService(db as PrismaService);
let app: INestApplication, actor: string, denied: string, branchA: string, branchB: string;
async function user() {
  return (
    await db.user.create({
      data: {
        name: 'Test',
        email: randomUUID() + '@test.invalid',
        password: 'unused',
        role: 'ACCOUNTANT',
        accessManaged: true,
      },
    })
  ).id;
}
async function grant(
  id: string,
  permissions: PermissionKey[],
  companyCode = 'SHOP',
  branchIds?: string[],
  scope?: 'ASSIGNED',
) {
  const position = await db.accessPosition.create({
    data: { code: randomUUID(), name: 'Test', permissions },
  });
  return db.employeeAccessAssignment.create({
    data: {
      userId: id,
      positionId: position.id,
      companyCode,
      scope: scope ?? (branchIds ? 'BRANCHES' : 'COMPANY'),
      ...(branchIds ? { branches: { create: branchIds.map((branchId) => ({ branchId })) } } : {}),
    },
  });
}
function http(
  method: 'get' | 'post' | 'patch' | 'delete',
  path: string,
  body?: object,
  id = actor,
) {
  const client = request(app.getHttpServer());
  const call = client[method](path)
    .set('x-test-user', id)
    .expect('x-owned-loyalty-app', testRun)
    .on('response', (response) => {
      if (response.headers['x-owned-loyalty-app'] !== testRun)
        console.error(
          'OWNED_HTTP_MARKER_MISMATCH',
          JSON.stringify({
            status: response.status,
            marker: response.headers['x-owned-loyalty-app'] ?? null,
            server: response.headers.server ?? null,
            contentType: response.headers['content-type'] ?? null,
          }),
        );
    });
  return body ? call.send(body) : call;
}
beforeAll(async () => {
  process.env.PII_ENCRYPTION_KEY = 'a'.repeat(64);
  process.env.PII_HASH_SALT = 'owned-party-test-salt'.repeat(2);
  const shop = await db.companyInfo.findUniqueOrThrow({ where: { companyCode: 'SHOP' } });
  branchA = (
    await db.branch.create({
      data: { name: 'A', companyId: shop.id, shopCashAccountCode: 'S11-1101' },
    })
  ).id;
  branchB = (await db.branch.create({ data: { name: 'B', companyId: shop.id } })).id;
  await seedShopCoa(db);
  await db.user.create({
    data: {
      name: 'Journal',
      email: 'admin@bestchoice.com',
      password: 'unused',
      role: 'OWNER',
      isSystemUser: true,
    },
  });
  actor = await user();
  denied = await user();
  await grant(actor, ['customers.read', 'loyalty.read', 'loyalty.update']);
  const module = await Test.createTestingModule({
    controllers: [LoyaltyController, SalesController, BookingsController],
    providers: [
      AccessLoyaltyBoundaries,
      AccessSalesBoundaries,
      AccessSalesProjectionService,
      AccessTradeInProjectionService,
      SalesService,
      SaleVoidService,
      BookingsService,
      ShopCashSaleTemplate,
      ShopExternalFinanceSaleTemplate,
      ShopBookingDepositTemplate,
      ShopBookingForfeitTemplate,
      ShopBookingDepositAppliedTemplate,
      ShopBookingRefundTemplate,
      ExchangeCancelReversalTemplate,
      ShopAccountResolver,
      CompanyResolverService,
      JournalAutoService,
      { provide: SaleWarrantyNotifierService, useValue: { notify: jest.fn() } },
      { provide: InterCompanyService, useValue: {} },
      AccessPartyBoundaries,
      AccessPartySourceService,
      AccessResourceService,
      AccessProcurementSourceService,
      AccessPolicyService,
      { provide: PrismaService, useValue: db },
      { provide: AccessSnapshotService, useValue: snapshots },
      LoyaltyService,
      AuditService,
      { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
      { provide: APP_INTERCEPTOR, useClass: AccessPolicyInterceptor },
    ],
  })
    .overrideGuard(JwtAuthGuard)
    .useValue({
      canActivate: async (ctx: ExecutionContext) => {
        const req = ctx.switchToHttp().getRequest();
        const id = req.headers['x-test-user'];
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
  app.use(
    (
      _req: unknown,
      res: { setHeader: (name: string, value: string) => void },
      next: () => void,
    ) => {
      res.setHeader('x-owned-loyalty-app', testRun);
      next();
    },
  );
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
  // Bind IPv4 explicitly once. Supertest's auto-listen uses an unspecified host
  // but connects127.0.0.1; a response without our marker was reproduced locally.
  await app.listen(0, '127.0.0.1');
  const audit = app.get(AuditService),
    log = audit.log.bind(audit);
  audit.log = (...args: Parameters<AuditService['log']>) => {
    const promise = log(...args);
    pendingAudits.add(promise);
    void promise.finally(() => pendingAudits.delete(promise)).catch(() => undefined);
    return promise;
  };
}, 60000);
afterAll(async () => {
  await app?.close();
  await Promise.allSettled([...pendingAudits]);
  await db.$disconnect();
});

async function customer() {
  return db.customer.create({
    data: {
      name: 'Owned journey',
      phone: '0800000000',
      nationalId: randomUUID(),
      accessCompanyCode: 'SHOP',
      accessBranchId: branchA,
    },
  });
}
it.each(['points', 'history'])(
  'authorized actual HTTP %s succeeds; no-grants denies',
  async (suffix) => {
    const c = await customer();
    await http('get', `/loyalty/${c.id}/${suffix}?company=SHOP`).expect(200);
    await http('get', `/loyalty/${c.id}/${suffix}?company=SHOP`, undefined, denied).expect(403);
  },
);
it('authorized referral HTTP succeeds; no-grants denies', async () => {
  const c = await customer();
  await http('get', `/loyalty/referral-stats/${c.id}?company=SHOP`).expect(200);
  await http('get', `/loyalty/referral-stats/${c.id}?company=SHOP`, undefined, denied).expect(403);
});
it('managed owner HTTP cannot debit with arbitrary POS text', async () => {
  const c = await customer();
  await db.customer.update({ where: { id: c.id }, data: { loyaltyBalance: 1000 } });
  const owner = await user();
  await db.user.update({ where: { id: owner }, data: { role: 'OWNER' } });
  const response = await http(
    'post',
    `/loyalty/${c.id}/redeem?company=SHOP`,
    { amount: 500, description: 'test', posTransactionId: 'not-a-sale' },
    owner,
  );
  expect(response.status).toBe(403);
  expect((await db.customer.findUniqueOrThrow({ where: { id: c.id } })).loyaltyBalance).toBe(1000);
  expect(await db.loyaltyRedemption.count({ where: { customerId: c.id } })).toBe(0);
});
it.each(['points', 'history', 'referral', 'redeem'])(
  'no-grants actual HTTP %s denies',
  async (route) => {
    const c = await customer();
    const path =
      route === 'referral' ? `/loyalty/referral-stats/${c.id}` : `/loyalty/${c.id}/${route}`;
    const body =
      route === 'redeem'
        ? { amount: 500, description: 'test', posTransactionId: 'not-a-sale' }
        : undefined;
    await http(route === 'redeem' ? 'post' : 'get', path + '?company=SHOP', body, denied).expect(
      403,
    );
  },
);

async function seller() {
  const id = await user();
  await grant(
    id,
    PERMISSION_CATALOG.filter((p) => !p.ownerOnly).map((p) => p.key),
  );
  return id;
}
async function genuineSale(c: string, branchId = branchA) {
  const id = await seller();
  const shop = await db.companyInfo.findUniqueOrThrow({ where: { companyCode: 'SHOP' } });
  const p = await db.product.create({
    data: {
      name: 'Device',
      brand: 'Apple',
      model: 'Fixture',
      category: 'PHONE_NEW',
      costPrice: 100,
      cashPrice: 10000,
      branchId,
      ownedByCompanyId: shop.id,
      status: 'IN_STOCK',
    },
  });
  await db.customer.update({ where: { id: c }, data: { loyaltyBalance: 1000 } });
  const res = await http(
    'post',
    '/sales?company=SHOP',
    {
      saleType: 'CASH',
      productId: p.id,
      customerId: c,
      branchId,
      sellingPrice: 10000,
      amountReceived: 9975,
      paymentMethod: 'CASH',
      loyaltyPointsRedeemed: 25,
    },
    id,
  ).expect(201);
  return db.loyaltyRedemption.findUniqueOrThrow({ where: { saleId: res.body.id } });
}
async function contract(c: string, branchId = branchA) {
  const p = await db.product.create({
    data: {
      name: 'Device',
      brand: 'Apple',
      model: 'Fixture',
      category: 'PHONE_NEW',
      costPrice: 100,
      branchId,
    },
  });
  return db.contract.create({
    data: {
      contractNumber: randomUUID(),
      customerId: c,
      productId: p.id,
      branchId,
      salespersonId: actor,
      planType: 'STORE_DIRECT',
      sellingPrice: 10000,
      downPayment: 1000,
      interestRate: 0.01,
      totalMonths: 10,
      interestTotal: 900,
      financedAmount: 9000,
      monthlyPayment: 990,
      status: 'ACTIVE',
    },
  });
}
async function earning(c: string, branch = branchA, points = 20) {
  const k = await contract(c, branch);
  const pay = await db.payment.create({
    data: {
      contractId: k.id,
      installmentNo: 1,
      dueDate: new Date(),
      amountDue: 990,
      amountPaid: 990,
      status: 'PAID',
    },
  });
  return db.loyaltyPoint.create({
    data: {
      customerId: c,
      contractId: k.id,
      paymentId: pay.id,
      points,
      reason: 'PRIVATE_FREE_TEXT',
    },
  });
}
it('scoped account projection keeps canonical balance unavailable until explicit global read', async () => {
  const c = await customer();
  await db.customer.update({ where: { id: c.id }, data: { loyaltyBalance: 4321 } });
  const r = await http('get', `/loyalty/${c.id}/points?company=SHOP`).expect(200);
  expect(r.body).toMatchObject({
    balance: null,
    balanceAvailability: 'unavailable',
    lifetimeEarned: null,
    lifetimeRedeemed: null,
    visibleEarned: 0,
    visibleRedeemed: 0,
  });
  const id = await user();
  await grant(id, ['customers.read', 'loyalty.read'], 'SHOP', [branchA]);
  await grant(id, ['loyalty.account.read'], 'SHOP', [branchA]);
  expect(
    (await http('get', `/loyalty/${c.id}/points?company=SHOP`, undefined, id).expect(200)).body
      .balance,
  ).toBeNull();
  await grant(id, ['loyalty.account.read']);
  expect(
    (await http('get', `/loyalty/${c.id}/points?company=SHOP`, undefined, id).expect(200)).body
      .balance,
  ).toBe(4321);
});
it('earning history requires independent matching Payment and FINANCE Contract before count and limit', async () => {
  const c = await customer();
  const visible = await earning(c.id);
  await earning(c.id, branchB, 999);
  const mismatch = await earning(c.id);
  const other = await contract(c.id);
  await db.loyaltyPoint.update({ where: { id: mismatch.id }, data: { contractId: other.id } });
  const id = await user();
  await grant(id, ['customers.read', 'loyalty.read'], 'SHOP', [branchA]);
  await grant(id, ['contracts.read', 'payments.read'], 'FINANCE', [branchA]);
  const r = await http(
    'get',
    `/loyalty/${c.id}/history?company=SHOP&limit=1`,
    undefined,
    id,
  ).expect(200);
  expect(r.body.total).toBe(1);
  expect(r.body.data.map((x: { id: string }) => x.id)).toEqual([visible.id]);
  expect(JSON.stringify(r.body)).not.toContain('PRIVATE_FREE_TEXT');
  const metrics = await http('get', `/loyalty/${c.id}/points?company=SHOP`, undefined, id).expect(
    200,
  );
  expect(metrics.body.visibleEarned).toBe(20);
});
it('referral identities are scoped and Contract absence stays unknown without complete coverage', async () => {
  const c = await customer();
  const a = await customer();
  await db.customer.update({ where: { id: a.id }, data: { referredById: c.id } });
  await db.customer.create({
    data: {
      name: 'HIDDEN_REFERRAL',
      referredById: c.id,
      accessCompanyCode: 'SHOP',
      accessBranchId: branchB,
    },
  });
  const id = await user();
  await grant(id, ['customers.read', 'loyalty.read'], 'SHOP', [branchA]);
  const r = await http('get', `/loyalty/referral-stats/${c.id}?company=SHOP`, undefined, id).expect(
    200,
  );
  expect(r.body.referrals).toEqual([expect.objectContaining({ id: a.id, hasContract: null })]);
  expect(r.body.totalPointsFromReferrals).toBeNull();
  expect(JSON.stringify(r.body)).not.toContain('HIDDEN_REFERRAL');
  await grant(id, ['contracts.read'], 'FINANCE');
  const complete = await http(
    'get',
    `/loyalty/referral-stats/${c.id}?company=SHOP`,
    undefined,
    id,
  ).expect(200);
  expect(complete.body.referrals[0].hasContract).toBe(false);
});
it('exact existing typed Sale verification is useful without global redeem and duplicates have zero monetary effects', async () => {
  const c = await customer(),
    proof = await genuineSale(c.id),
    id = await user();
  await grant(id, ['customers.read', 'loyalty.update', 'sales.read'], 'SHOP', [branchA]);
  const body = { amount: 25, description: 'IGNORED', posTransactionId: proof.saleId };
  for (let n = 0; n < 2; n++) {
    const r = await http('post', `/loyalty/${c.id}/redeem?company=SHOP`, body, id).expect(201);
    expect(r.body).toMatchObject({
      status: 'VERIFIED',
      alreadyRedeemed: true,
      saleId: proof.saleId,
      redeemedPoints: 25,
      newBalance: null,
    });
  }
  expect((await db.customer.findUniqueOrThrow({ where: { id: c.id } })).loyaltyBalance).toBe(975);
  expect(await db.loyaltyRedemption.count({ where: { customerId: c.id } })).toBe(1);
  await http('post', `/loyalty/${c.id}/redeem?company=SHOP`, body, denied).expect(403);
});
it('typed redemption history needs real Sale source and hides unproven legacy rows', async () => {
  const c = await customer(),
    proof = await genuineSale(c.id),
    id = await user();
  await db.loyaltyRedemption.create({
    data: { customerId: c.id, points: 9, discountAmount: 9, reason: `Sale ${proof.saleId}` },
  });
  await grant(id, ['customers.read', 'loyalty.read'], 'SHOP', [branchA]);
  expect(
    (await http('get', `/loyalty/${c.id}/history?company=SHOP`, undefined, id).expect(200)).body
      .total,
  ).toBe(0);
  await grant(id, ['sales.read'], 'SHOP', [branchA]);
  const r = await http('get', `/loyalty/${c.id}/history?company=SHOP`, undefined, id).expect(200);
  expect(r.body.total).toBe(1);
  expect(r.body.data[0]).toMatchObject({
    id: proof.id,
    saleId: proof.saleId,
    type: 'REDEEM',
    points: 25,
  });
  expect(r.body.coverage).toBe('visible-only');
});

it('referral Contract coverage never claims absence for an unreadable inactive origin', async () => {
  const c = await customer(),
    referred = await customer();
  await db.customer.update({ where: { id: referred.id }, data: { referredById: c.id } });
  const shop = await db.companyInfo.findUniqueOrThrow({ where: { companyCode: 'SHOP' } });
  const inactive = await db.branch.create({
    data: { name: 'Inactive source', companyId: shop.id, isActive: false },
  });
  await contract(referred.id, inactive.id);
  const id = await user();
  await grant(id, ['customers.read', 'loyalty.read']);
  await grant(id, ['contracts.read'], 'FINANCE');
  const r = await http('get', `/loyalty/referral-stats/${c.id}?company=SHOP`, undefined, id).expect(
    200,
  );
  expect(r.body.referrals[0].hasContract).toBeNull();
});
it('significant managed reads have safe request evidence', async () => {
  const c = await customer();
  await http('get', `/loyalty/${c.id}/history?company=SHOP`).expect(200);
  await Promise.allSettled([...pendingAudits]);
  const rows = await db.auditLog.findMany({
    where: { entity: 'loyalty', entityId: c.id, userId: actor },
  });
  expect(rows).toHaveLength(1);
  expect(rows[0].newValue).toMatchObject({
    route: 'LoyaltyController.getHistory',
    outcome: 'SUCCESS',
  });
});
it('verification request audit excludes supplied text and denied amount probes', async () => {
  const c = await customer(),
    proof = await genuineSale(c.id);
  const id = await user();
  await grant(id, ['customers.read', 'loyalty.update', 'sales.read']);
  await http(
    'post',
    `/loyalty/${c.id}/redeem?company=SHOP`,
    { amount: 25, description: 'PRIVATE_AUDIT_TEXT', posTransactionId: proof.saleId },
    id,
  ).expect(201);
  await http(
    'post',
    `/loyalty/${c.id}/redeem?company=SHOP`,
    { amount: 9123, description: 'PRIVATE_DENIED_TEXT', posTransactionId: proof.saleId },
    id,
  ).expect(403);
  await Promise.allSettled([...pendingAudits]);
  const rows = await db.auditLog.findMany({
    where: { entity: 'loyalty', entityId: c.id, userId: id },
  });
  expect(rows).toHaveLength(2);
  expect(JSON.stringify(rows.map((r) => r.newValue))).not.toMatch(
    /PRIVATE_AUDIT_TEXT|PRIVATE_DENIED_TEXT|9123/,
  );
  expect(rows.map((r) => (r.newValue as { outcome: string }).outcome).sort()).toEqual([
    'ERROR',
    'SUCCESS',
  ]);
});

it.each(['customers.read', 'loyalty.update', 'sales.read'] as const)(
  'verification requires independent %s on current source',
  async (missing) => {
    const c = await customer(),
      proof = await genuineSale(c.id),
      id = await user();
    await grant(
      id,
      (['customers.read', 'loyalty.update', 'sales.read'] as PermissionKey[]).filter(
        (p) => p !== missing,
      ),
      'SHOP',
      [branchA],
    );
    await http(
      'post',
      `/loyalty/${c.id}/redeem?company=SHOP`,
      { amount: 25, description: 'test', posTransactionId: proof.saleId },
      id,
    ).expect(403);
    expect((await db.customer.findUniqueOrThrow({ where: { id: c.id } })).loyaltyBalance).toBe(975);
  },
);
it.each([
  'amount',
  'customer',
  'contract',
  'conflict',
  'approver',
  'arbitrary',
  'unredeemed',
] as const)('verification rejects mismatched %s without debit or attaching proof', async (mode) => {
  const c = await customer(),
    proof = await genuineSale(c.id),
    id = await seller();
  let target = c.id;
  const body: Record<string, unknown> = {
    amount: 25,
    description: 'test',
    posTransactionId: proof.saleId,
  };
  if (mode === 'amount') body.amount = 26;
  if (mode === 'customer') target = (await customer()).id;
  if (mode === 'contract') body.contractId = randomUUID();
  if (mode === 'conflict') body.saleId = randomUUID();
  if (mode === 'approver') body.approverId = id;
  if (mode === 'arbitrary') body.posTransactionId = 'Sale ' + proof.saleId;
  if (mode === 'unredeemed') {
    const shop = await db.companyInfo.findUniqueOrThrow({ where: { companyCode: 'SHOP' } });
    const product = await db.product.create({
      data: {
        name: 'Ordinary sale',
        brand: 'Apple',
        model: 'Fixture',
        category: 'PHONE_NEW',
        costPrice: 100,
        cashPrice: 10000,
        branchId: branchA,
        ownedByCompanyId: shop.id,
        status: 'IN_STOCK',
      },
    });
    const other = await http(
      'post',
      '/sales?company=SHOP',
      {
        saleType: 'CASH',
        productId: product.id,
        customerId: c.id,
        branchId: branchA,
        sellingPrice: 10000,
        amountReceived: 10000,
        paymentMethod: 'CASH',
      },
      id,
    ).expect(201);
    body.posTransactionId = other.body.id;
  }
  await http('post', `/loyalty/${target}/redeem?company=SHOP`, body, id).expect(403);
  expect((await db.customer.findUniqueOrThrow({ where: { id: c.id } })).loyaltyBalance).toBe(975);
  expect(await db.loyaltyRedemption.count({ where: { customerId: c.id } })).toBe(1);
});
it('exact saleId alias returns current balance only with explicit account read; repeated concurrent verification stays read-only', async () => {
  const c = await customer(),
    proof = await genuineSale(c.id),
    id = await user();
  await grant(id, ['customers.read', 'loyalty.update', 'sales.read'], 'SHOP', [branchA]);
  await grant(id, ['loyalty.account.read']);
  const body = { saleId: proof.saleId, amount: 25, description: 'test' };
  const before = {
    sales: await db.sale.count(),
    redemptions: await db.loyaltyRedemption.count(),
    journals: await db.journalEntry.count(),
    tenders: await db.shopTender.count(),
  };
  const results = await Promise.all([
    http('post', `/loyalty/${c.id}/redeem?company=SHOP`, body, id),
    http('post', `/loyalty/${c.id}/redeem?company=SHOP`, body, id),
  ]);
  expect(results.map((r) => r.status)).toEqual([201, 201]);
  expect(results.map((r) => r.body.newBalance)).toEqual([975, 975]);
  expect({
    sales: await db.sale.count(),
    redemptions: await db.loyaltyRedemption.count(),
    journals: await db.journalEntry.count(),
    tenders: await db.shopTender.count(),
  }).toEqual(before);
});
it('original Customer/action and Sale tuples cannot cross branches or use salesperson as Customer assignment', async () => {
  const c = await customer(),
    proof = await genuineSale(c.id),
    id = await user();
  await grant(id, ['customers.read', 'loyalty.read', 'sales.read'], 'SHOP', [branchA]);
  await grant(id, ['loyalty.update'], 'SHOP', [branchB]);
  await http(
    'post',
    `/loyalty/${c.id}/redeem?company=SHOP`,
    { amount: 25, description: 'test', saleId: proof.saleId },
    id,
  ).expect(403);
  const assigned = await user();
  await grant(assigned, ['customers.read', 'loyalty.read'], 'SHOP', undefined, 'ASSIGNED');
  await http('get', `/loyalty/${c.id}/points?company=SHOP`, undefined, assigned).expect(403);
  await db.customer.update({ where: { id: c.id }, data: { assignedToId: assigned } });
  await http('get', `/loyalty/${c.id}/points?company=SHOP`, undefined, assigned).expect(200);
  await db.customer.update({ where: { id: c.id }, data: { assignedToId: null } });
  await http('get', `/loyalty/${c.id}/points?company=SHOP`, undefined, assigned).expect(403);
});
it('current Sale terms and independent sales.read revocation hide proof from verification and history', async () => {
  const c = await customer(),
    proof = await genuineSale(c.id),
    id = await user();
  await grant(id, ['customers.read', 'loyalty.read', 'loyalty.update']);
  const assignment = await grant(id, ['sales.read']);
  const body = { amount: 25, description: 'test', saleId: proof.saleId };
  await http('post', `/loyalty/${c.id}/redeem?company=SHOP`, body, id).expect(201);
  await db.accessPosition.update({
    where: { id: assignment.positionId },
    data: { permissions: [] },
  });
  await http('post', `/loyalty/${c.id}/redeem?company=SHOP`, body, id).expect(403);
  expect(
    (await http('get', `/loyalty/${c.id}/history?company=SHOP`, undefined, id).expect(200)).body
      .total,
  ).toBe(0);
  await grant(id, ['sales.read']);
  await db.sale.update({ where: { id: proof.saleId! }, data: { netAmount: 9974 } });
  await http('post', `/loyalty/${c.id}/redeem?company=SHOP`, body, id).expect(403);
  expect(
    (await http('get', `/loyalty/${c.id}/history?company=SHOP`, undefined, id).expect(200)).body
      .total,
  ).toBe(0);
});
it.each(['contracts.read', 'payments.read'] as const)(
  'earning requires current independent %s without FINANCE/SHOP tuple crossover',
  async (missing) => {
    const c = await customer();
    await earning(c.id);
    const id = await user();
    await grant(id, ['customers.read', 'loyalty.read']);
    await grant(id, [missing], 'SHOP');
    await grant(
      id,
      [missing === 'contracts.read' ? 'payments.read' : 'contracts.read'],
      'FINANCE',
      [branchA],
    );
    expect(
      (await http('get', `/loyalty/${c.id}/history?company=SHOP`, undefined, id).expect(200)).body
        .total,
    ).toBe(0);
    const a = await grant(id, [missing], 'FINANCE', [branchA]);
    expect(
      (await http('get', `/loyalty/${c.id}/history?company=SHOP`, undefined, id).expect(200)).body
        .total,
    ).toBe(1);
    await db.employeeAccessAssignment.update({
      where: { id: a.id },
      data: { deletedAt: new Date() },
    });
    expect(
      (await http('get', `/loyalty/${c.id}/history?company=SHOP`, undefined, id).expect(200)).body
        .total,
    ).toBe(0);
  },
);
it('FINANCE context can read genuine Customer and earning with separately explicit SHOP global account', async () => {
  const c = await customer();
  await earning(c.id);
  await db.customer.update({ where: { id: c.id }, data: { loyaltyBalance: 1234 } });
  const id = await user();
  await grant(
    id,
    ['customers.read', 'loyalty.read', 'contracts.read', 'payments.read'],
    'FINANCE',
    [branchA],
  );
  await grant(id, ['loyalty.account.read']);
  const r = await http('get', `/loyalty/${c.id}/points?company=FINANCE`, undefined, id).expect(200);
  expect(r.body).toMatchObject({ balance: 1234, visibleEarned: 20 });
});
it.each(['page=0', 'page=1.5', 'limit=0', 'limit=101', 'limit=NaN'])(
  'history validates finite pagination %s',
  async (query) => {
    const c = await customer();
    await http('get', `/loyalty/${c.id}/history?company=SHOP&${query}`).expect(400);
  },
);
it('referral authorized genuine Contract is true while scoped unknown remains null', async () => {
  const c = await customer(),
    a = await customer(),
    b = await customer();
  await db.customer.updateMany({
    where: { id: { in: [a.id, b.id] } },
    data: { referredById: c.id },
  });
  await contract(a.id);
  await contract(b.id, branchB);
  const id = await user();
  await grant(id, ['customers.read', 'loyalty.read']);
  await grant(id, ['contracts.read'], 'FINANCE', [branchA]);
  const r = await http('get', `/loyalty/referral-stats/${c.id}?company=SHOP`, undefined, id).expect(
    200,
  );
  expect(r.body.referrals.find((x: { id: string }) => x.id === a.id).hasContract).toBe(true);
  expect(r.body.referrals.find((x: { id: string }) => x.id === b.id).hasContract).toBeNull();
  expect(r.body.referralsWithContract).toBeNull();
  expect(r.body.visibleReferralsWithContract).toBe(1);
});

it.each(['points', 'history', 'referral', 'redeem'])(
  'current %s authority is reloaded after actual access-lock revocation',
  async (route) => {
    const c = await customer(),
      id = await user();
    const proof = route === 'redeem' ? await genuineSale(c.id) : undefined;
    const a = await grant(id, ['customers.read', 'loyalty.read', 'loyalty.update', 'sales.read']);
    let release!: () => void, locked!: () => void;
    const held = new Promise<void>((r) => {
        locked = r;
      }),
      unlock = new Promise<void>((r) => {
        release = r;
      });
    const revoke = db.$transaction(async (tx) => {
      await lockEmployeeAccess(tx);
      await tx.accessPosition.update({ where: { id: a.positionId }, data: { permissions: [] } });
      locked();
      await unlock;
    });
    await held;
    const path =
      route === 'referral' ? `/loyalty/referral-stats/${c.id}` : `/loyalty/${c.id}/${route}`;
    const pending = http(
      route === 'redeem' ? 'post' : 'get',
      path + '?company=SHOP',
      proof ? { saleId: proof.saleId, amount: 25, description: 'test' } : undefined,
      id,
    ).then((r) => r.status);
    try {
      for (let i = 0; i < 100; i++) {
        const [{ waiting }] = await db.$queryRaw<
          Array<{ waiting: boolean }>
        >`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE wait_event='advisory' AND datname=current_database()) AS waiting`;
        if (waiting) break;
        if (i === 99) throw new Error('No actual access lock wait');
        await new Promise((r) => setTimeout(r, 10));
      }
    } finally {
      release();
    }
    await revoke;
    expect(await pending).toBe(403);
  },
);
it.each(['points', 'history', 'referral'])(
  'foreign Customer and disjoint action tuple deny %s',
  async (route) => {
    const c = await customer(),
      id = await user();
    await grant(id, ['customers.read'], 'SHOP', [branchA]);
    await grant(id, ['loyalty.read'], 'SHOP', [branchB]);
    const path =
      route === 'referral' ? `/loyalty/referral-stats/${c.id}` : `/loyalty/${c.id}/${route}`;
    await http('get', path + '?company=SHOP', undefined, id).expect(403);
    await grant(id, ['loyalty.read'], 'SHOP', [branchA]);
    await http('get', path + '?company=SHOP', undefined, id).expect(200);
    const foreign = await db.customer.create({
      data: { name: 'Foreign', accessCompanyCode: 'SHOP', accessBranchId: branchB },
    });
    await http('get', path.replace(c.id, foreign.id) + '?company=SHOP', undefined, id).expect(403);
  },
);
it('exactly four Loyalty registrations retain reviewed current action and resolution contracts', () => {
  const expected = {
    getPoints: ['loyalty.read', 'record'],
    getHistory: ['loyalty.read', 'collection'],
    getReferralStats: ['loyalty.read', 'record'],
    redeemPoints: ['loyalty.update', 'record'],
  };
  expect([...LOYALTY_BOUNDARY_ROUTES].sort()).toEqual(
    Object.keys(expected)
      .map((k) => 'LoyaltyController.' + k)
      .sort(),
  );
  expect(
    [...ACCESS_BOUNDARIES.keys()].filter((k) => k.startsWith('LoyaltyController.')).sort(),
  ).toEqual([...LOYALTY_BOUNDARY_ROUTES].sort());
  for (const [method, [permission, resolution]] of Object.entries(expected))
    expect(ACCESS_POLICIES['LoyaltyController.' + method]).toMatchObject({
      permission,
      resolution,
      classification: 'staff',
      company: 'resolved-source',
    });
});
it.each(['ASSIGNED', 'FINANCE'] as const)(
  'global account read ignores %s grants and never implies earning authority',
  async (mode) => {
    const c = await customer(),
      id = await user();
    await earning(c.id);
    await db.customer.update({
      where: { id: c.id },
      data: { loyaltyBalance: 8123, assignedToId: id },
    });
    await grant(id, ['customers.read', 'loyalty.read']);
    await grant(
      id,
      ['loyalty.account.read'],
      mode === 'FINANCE' ? 'FINANCE' : 'SHOP',
      undefined,
      mode === 'ASSIGNED' ? 'ASSIGNED' : undefined,
    );
    const r = await http('get', `/loyalty/${c.id}/points?company=SHOP`, undefined, id).expect(200);
    expect(r.body).toMatchObject({ balance: null, visibleEarned: 0 });
    await grant(id, ['loyalty.account.read']);
    const global = await http('get', `/loyalty/${c.id}/points?company=SHOP`, undefined, id).expect(
      200,
    );
    expect(global.body).toMatchObject({
      balance: 8123,
      visibleEarned: 0,
      historyAvailability: { earning: 'unavailable' },
    });
  },
);
it('legacy unmigrated controller compatibility retains its original read response', async () => {
  const c = await customer(),
    id = await user();
  await db.user.update({ where: { id }, data: { accessManaged: false } });
  const r = await http('get', `/loyalty/${c.id}/points?company=SHOP`, undefined, id).expect(200);
  expect(r.body).toMatchObject({
    customerId: c.id,
    balance: 0,
    lifetimeEarned: 0,
    lifetimeRedeemed: 0,
  });
  expect(r.body.balanceAvailability).toBeUndefined();
});
it('managed verification validates amount and requires a target without entering legacy debit', async () => {
  const c = await customer();
  const id = await seller();
  await http(
    'post',
    `/loyalty/${c.id}/redeem?company=SHOP`,
    { amount: -1, description: 'test', saleId: randomUUID() },
    id,
  ).expect(400);
  await http(
    'post',
    `/loyalty/${c.id}/redeem?company=SHOP`,
    { amount: 25, description: 'test' },
    id,
  ).expect(400);
  expect(await db.loyaltyRedemption.count({ where: { customerId: c.id } })).toBe(0);
});
