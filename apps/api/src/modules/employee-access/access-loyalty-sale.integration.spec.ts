import { PrismaClient } from '@prisma/client';
const url = process.env.EMPLOYEE_ACCESS_TEST_DATABASE_URL;
if (!url?.includes('/bc_access_task2?host=/tmp/bc-access-loyalty-sale.'))
  throw new Error('Owned isolated database required');
const db = new PrismaClient({ datasources: { db: { url } } });
afterAll(() => db.$disconnect());
import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { ExecutionContext, INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { PERMISSION_CATALOG, PermissionKey } from '@installment/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AccessSnapshotService } from './access-snapshot.service';
import { AccessResourceService } from './access-resource.service';
import { AccessPolicyService } from './access-policy';
import { AccessPolicyInterceptor } from './access-policy.interceptor';
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
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { BranchGuard } from '../auth/guards/branch.guard';
import { seedShopCoa } from '../../../prisma/seed-coa-shop';
import { currentDomainAccess } from './access-execution-context';
const snapshots = new AccessSnapshotService(db as PrismaService);
let app: INestApplication,
  actor: string,
  owner: string,
  branchA: string,
  branchB: string,
  shopId: string,
  customerId: string;
const successes = new Map<string, { method: string; path: string; body: unknown; user: string }>();
const notifier = {
  notify: jest.fn(async (id: string) => {
    expect(currentDomainAccess()).toBeUndefined();
    expect(await db.sale.findUnique({ where: { id } })).not.toBeNull();
  }),
};
async function user(role: 'OWNER' | 'ACCOUNTANT' = 'ACCOUNTANT') {
  return (
    await db.user.create({
      data: {
        name: 'Test',
        email: randomUUID() + '@test.invalid',
        password: 'unused',
        role,
        accessManaged: true,
      },
    })
  ).id;
}
async function grant(
  id: string,
  permissions: PermissionKey[],
  branches?: string[],
  assigned = false,
) {
  const p = await db.accessPosition.create({
    data: { code: randomUUID(), name: 'Test', permissions },
  });
  await db.employeeAccessAssignment.create({
    data: {
      userId: id,
      positionId: p.id,
      companyCode: 'SHOP',
      scope: assigned ? 'ASSIGNED' : branches ? 'BRANCHES' : 'COMPANY',
      ...(branches ? { branches: { create: branches.map((branchId) => ({ branchId })) } } : {}),
    },
  });
  return p.id;
}
function http(method: string, path: string, body?: unknown, id = actor) {
  const a = request(app.getHttpServer());
  const r =
    method === 'get'
      ? a.get(path)
      : method === 'patch'
        ? a.patch(path)
        : method === 'delete'
          ? a.delete(path)
          : a.post(path);
  r.set('x-test-user', id).expect('x-owned-loyalty-sale', 'typed-redemption');
  if (body) r.send(body as object);
  r.on('response', (res: request.Response) => {
    if (res.status >= 500) console.error(method, path, res.status, res.body);
  });
  return r;
}
async function product(branchId = branchA, category: 'PHONE_NEW' | 'ACCESSORY' = 'PHONE_NEW') {
  return db.product.create({
    data: {
      name: randomUUID(),
      brand: 'Apple',
      model: 'Test',
      category,
      costPrice: 6000,
      cashPrice: 10000,
      branchId,
      ownedByCompanyId: shopId,
      status: 'IN_STOCK',
    },
  });
}
async function knownCustomer(branchId = branchA) {
  const c = await db.customer.create({
    data: {
      name: randomUUID(),
      phone: '0800000000',
      nationalId: randomUUID(),
      loyaltyBalance: 1000,
    },
  });
  await db.tradeIn.create({
    data: { customerId: c.id, branchId, deviceBrand: 'Apple', deviceModel: 'Evidence' },
  });
  return c.id;
}
function saleBody(productId: string, extra: object = {}) {
  return {
    saleType: 'CASH',
    productId,
    customerId,
    branchId: branchA,
    sellingPrice: 10000,
    amountReceived: 10000,
    paymentMethod: 'CASH',
    ...extra,
  };
}
beforeAll(async () => {
  const shop = await db.companyInfo.findUniqueOrThrow({ where: { companyCode: 'SHOP' } });
  shopId = shop.id;
  branchA = (
    await db.branch.create({
      data: { name: 'A', companyId: shop.id, shopCashAccountCode: 'S11-1101' },
    })
  ).id;
  branchB = (
    await db.branch.create({
      data: { name: 'B', companyId: shop.id, shopCashAccountCode: 'S11-1101' },
    })
  ).id;
  actor = await user();
  owner = await user('OWNER');
  await grant(
    actor,
    PERMISSION_CATALOG.filter((p) => !p.ownerOnly).map((p) => p.key),
  );
  await db.user.create({
    data: {
      name: 'Journal',
      email: 'admin@bestchoice.com',
      password: 'unused',
      role: 'OWNER',
      isSystemUser: true,
    },
  });
  await seedShopCoa(db);
  customerId = await knownCustomer();
  const module = await Test.createTestingModule({
    controllers: [SalesController, BookingsController],
    providers: [
      AccessSalesBoundaries,
      AccessSalesProjectionService,
      AccessTradeInProjectionService,
      AccessResourceService,
      AccessPolicyService,
      { provide: PrismaService, useValue: db },
      { provide: AccessSnapshotService, useValue: snapshots },
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
      { provide: SaleWarrantyNotifierService, useValue: notifier },
      { provide: InterCompanyService, useValue: {} },
      { provide: APP_INTERCEPTOR, useClass: AccessPolicyInterceptor },
    ],
  })
    .overrideGuard(JwtAuthGuard)
    .useValue({
      canActivate: async (ctx: ExecutionContext) => {
        const req = ctx.switchToHttp().getRequest(),
          res = ctx.switchToHttp().getResponse(),
          id = req.headers['x-test-user'];
        req.user = {
          ...(await db.user.findUniqueOrThrow({ where: { id } })),
          access: await snapshots.forUser(id),
        };
        const route = ctx.getClass().name + '.' + ctx.getHandler().name;
        res.on('finish', () => {
          if (res.statusCode < 300)
            successes.set(route, {
              method: req.method.toLowerCase(),
              path: req.originalUrl,
              body: structuredClone(req.body),
              user: id,
            });
        });
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
    (_req: unknown, res: { setHeader: (key: string, value: string) => void }, next: () => void) => {
      res.setHeader('x-owned-loyalty-sale', 'typed-redemption');
      next();
    },
  );
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
  await app.listen(0, '127.0.0.1');
});
afterAll(async () => {
  await app?.close();
});
it('loyalty producer denies missing global account authority before balance probes', async () => {
  const staff = await user();
  await grant(staff, ['sales.create', 'products.read', 'customers.read'], [branchA]);
  const c = await knownCustomer();
  const p = await product();
  const response = await http(
    'post',
    '/sales',
    saleBody(p.id, { customerId: c, loyaltyPointsRedeemed: 25, amountReceived: 9975 }),
    staff,
  );
  expect(response.status).toBe(403);
  expect((await db.customer.findUniqueOrThrow({ where: { id: c } })).loyaltyBalance).toBe(1000);
});
it('loyalty producer applies cumulative hard5000 cap to actual canonical Sale', async () => {
  const c = await knownCustomer();
  await db.customer.update({ where: { id: c }, data: { loyaltyBalance: 10000 } });
  await db.loyaltyRedemption.create({
    data: {
      customerId: c,
      points: 4990,
      reason: 'unknown historical origin',
      discountAmount: 4990,
    },
  });
  const p = await product();
  const response = await http(
    'post',
    '/sales',
    saleBody(p.id, { customerId: c, loyaltyPointsRedeemed: 25, amountReceived: 9975 }),
    owner,
  );
  expect(response.status).toBe(400);
  expect((await db.customer.findUniqueOrThrow({ where: { id: c } })).loyaltyBalance).toBe(10000);
});
it('loyalty producer records genuine typed once-only Sale proof', async () => {
  const c = await knownCustomer();
  const p = await product();
  const response = await http(
    'post',
    '/sales',
    saleBody(p.id, { customerId: c, loyaltyPointsRedeemed: 25, amountReceived: 9975 }),
    owner,
  ).expect(201);
  const rows = await db.$queryRaw<
    Array<{ proof: Record<string, unknown> }>
  >`SELECT to_jsonb(r) AS proof FROM loyalty_redemptions r WHERE customer_id=${c}`;
  expect(rows).toHaveLength(1);
  expect(rows[0].proof.sale_id).toBe(response.body.id);
  expect(rows[0].proof.fingerprint).toEqual(expect.any(String));
});

import { loyaltyDayRange, verifiedLoyaltySale } from '../loyalty/loyalty-sale-proof';
import { lockEmployeeAccess } from './access-snapshot.service';
import { DEFAULT_ACCESS_POSITIONS } from '@installment/shared';
it('global account rights have no ordinary default expansion and Bangkok boundary is explicit', () => {
  for (const position of DEFAULT_ACCESS_POSITIONS)
    expect(position.permissions.filter((p) => p.startsWith('loyalty.account.'))).toEqual([]);
  expect(loyaltyDayRange(new Date('2026-10-18T17:00:00Z'))).toEqual({
    gte: new Date('2026-10-18T17:00:00Z'),
    lt: new Date('2026-10-19T17:00:00Z'),
  });
  expect(loyaltyDayRange(new Date('2026-10-18T16:59:59Z')).lt).toEqual(
    new Date('2026-10-18T17:00:00Z'),
  );
});
it.each(['read', 'redeem', 'branch', 'assigned', 'finance'] as const)(
  'global account rejects incomplete scope %s without a balance probe',
  async (mode) => {
    const staff = await user();
    await grant(staff, ['sales.create', 'customers.read', 'products.read'], [branchA]);
    const rights: PermissionKey[] =
      mode === 'read'
        ? ['loyalty.account.read']
        : mode === 'redeem'
          ? ['loyalty.account.redeem']
          : ['loyalty.account.read', 'loyalty.account.redeem'];
    const position = await grant(
      staff,
      rights,
      mode === 'branch' ? [branchA] : undefined,
      mode === 'assigned',
    );
    if (mode === 'finance')
      await db.employeeAccessAssignment.updateMany({
        where: { positionId: position },
        data: { companyCode: 'FINANCE' },
      });
    for (const balance of [0, 1000]) {
      const c = await knownCustomer();
      await db.customer.update({ where: { id: c }, data: { loyaltyBalance: balance } });
      const p = await product();
      const response = await http(
        'post',
        '/sales',
        saleBody(p.id, { customerId: c, loyaltyPointsRedeemed: 25, amountReceived: 9975 }),
        staff,
      );
      expect(response.status).toBe(403);
      expect(JSON.stringify(response.body)).not.toContain('แต้มไม่เพียงพอ');
      expect(await db.sale.count({ where: { productId: p.id } })).toBe(0);
    }
  },
);
it('explicit global rights permit branch sales without manufacturing other source grants', async () => {
  const staff = await user();
  await grant(staff, ['sales.create', 'customers.read', 'products.read'], [branchA]);
  await grant(staff, ['loyalty.account.read', 'loyalty.account.redeem']);
  const c = await knownCustomer(),
    p = await product();
  const response = await http(
    'post',
    '/sales',
    saleBody(p.id, { customerId: c, loyaltyPointsRedeemed: 25, amountReceived: 9975 }),
    staff,
  ).expect(201);
  const proof = await db.loyaltyRedemption.findUniqueOrThrow({
    where: { saleId: response.body.id },
  });
  expect((await verifiedLoyaltySale(db, proof))?.id).toBe(response.body.id);
  expect((await db.customer.findUniqueOrThrow({ where: { id: c } })).loyaltyBalance).toBe(975);
  const foreign = await product(branchB);
  await http(
    'post',
    '/sales',
    saleBody(foreign.id, {
      branchId: branchB,
      customerId: c,
      loyaltyPointsRedeemed: 25,
      amountReceived: 9975,
    }),
    staff,
  ).expect(403);
  const hiddenCustomer = await knownCustomer(branchB),
    local = await product();
  await http(
    'post',
    '/sales',
    saleBody(local.id, {
      customerId: hiddenCustomer,
      loyaltyPointsRedeemed: 25,
      amountReceived: 9975,
    }),
    staff,
  ).expect(403);
});
it.each([1.5, -1, 10001])(
  'invalid point value %s cannot create any money or proof',
  async (points) => {
    const c = await knownCustomer(),
      p = await product();
    await db.customer.update({ where: { id: c }, data: { loyaltyBalance: 20000 } });
    await http(
      'post',
      '/sales',
      saleBody(p.id, {
        customerId: c,
        loyaltyPointsRedeemed: points,
        amountReceived: 10000 - points,
      }),
      owner,
    ).expect(400);
    expect(await db.sale.count({ where: { productId: p.id } })).toBe(0);
    expect(await db.loyaltyRedemption.count({ where: { customerId: c } })).toBe(0);
  },
);
it('global cap includes unknown history, excludes previous Bangkok day and soft-deleted legacy rows', async () => {
  const c = await knownCustomer(),
    p = await product();
  await db.customer.update({ where: { id: c }, data: { loyaltyBalance: 6000 } });
  await db.loyaltyRedemption.createMany({
    data: [
      {
        customerId: c,
        points: 4999,
        reason: 'legacy',
        discountAmount: 4999,
        createdAt: new Date(loyaltyDayRange().gte.getTime() - 1),
      },
      {
        customerId: c,
        points: 4999,
        reason: 'deleted legacy',
        discountAmount: 4999,
        deletedAt: new Date(),
      },
    ],
  });
  await http(
    'post',
    '/sales',
    saleBody(p.id, { customerId: c, loyaltyPointsRedeemed: 5000, amountReceived: 5000 }),
    owner,
  ).expect(201);
  const next = await product();
  await http(
    'post',
    '/sales',
    saleBody(next.id, { customerId: c, loyaltyPointsRedeemed: 1, amountReceived: 9999 }),
    owner,
  ).expect(400);
  expect((await db.customer.findUniqueOrThrow({ where: { id: c } })).loyaltyBalance).toBe(1000);
});
it.each(['cap', 'balance'] as const)(
  'concurrent distinct Sales serialize the global %s',
  async (mode) => {
    const c = await knownCustomer(),
      p1 = await product(),
      p2 = await product();
    await db.customer.update({
      where: { id: c },
      data: { loyaltyBalance: mode === 'cap' ? 10000 : 1000 },
    });
    const points = mode === 'cap' ? 3000 : 700;
    const responses = await Promise.all(
      [p1, p2].map((p) =>
        http(
          'post',
          '/sales',
          saleBody(p.id, {
            customerId: c,
            loyaltyPointsRedeemed: points,
            amountReceived: 10000 - points,
          }),
          owner,
        ).then((r) => r.status),
      ),
    );
    expect(responses.sort()).toEqual([201, 400]);
    expect(await db.loyaltyRedemption.count({ where: { customerId: c } })).toBe(1);
    expect((await db.customer.findUniqueOrThrow({ where: { id: c } })).loyaltyBalance).toBe(
      (mode === 'cap' ? 10000 : 1000) - points,
    );
  },
);
it('concurrent duplicate Sale and repeated proof verification never debit twice', async () => {
  const c = await knownCustomer(),
    p = await product();
  const responses = await Promise.all(
    [1, 2].map(() =>
      http(
        'post',
        '/sales',
        saleBody(p.id, { customerId: c, loyaltyPointsRedeemed: 25, amountReceived: 9975 }),
        owner,
      ).then((r) => r.status),
    ),
  );
  expect(responses.sort()).toEqual([201, 400]);
  const proof = await db.loyaltyRedemption.findFirstOrThrow({ where: { customerId: c } });
  for (let i = 0; i < 2; i++) expect((await verifiedLoyaltySale(db, proof))?.id).toBe(proof.saleId);
  expect((await db.customer.findUniqueOrThrow({ where: { id: c } })).loyaltyBalance).toBe(975);
  expect(await db.loyaltyRedemption.count({ where: { customerId: c } })).toBe(1);
});
it('required late loyalty audit failure rolls back Sale, journals, tenders, proof, balance and notification', async () => {
  const c = await knownCustomer(),
    p = await product();
  const before = {
    journal: await db.journalEntry.count(),
    tender: await db.shopTender.count(),
    audit: await db.auditLog.count(),
  };
  notifier.notify.mockClear();
  await db.$executeRawUnsafe(
    "CREATE FUNCTION fail_loyalty_evidence_test() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action = 'LOYALTY_SALE_REDEEMED' THEN RAISE EXCEPTION 'injected required loyalty evidence failure'; END IF; RETURN NEW; END $$",
  );
  await db.$executeRawUnsafe(
    'CREATE TRIGGER fail_loyalty_evidence_test BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION fail_loyalty_evidence_test()',
  );
  try {
    await http(
      'post',
      '/sales',
      saleBody(p.id, { customerId: c, loyaltyPointsRedeemed: 25, amountReceived: 9975 }),
      owner,
    ).expect(500);
  } finally {
    await db.$executeRawUnsafe('DROP TRIGGER fail_loyalty_evidence_test ON audit_logs');
    await db.$executeRawUnsafe('DROP FUNCTION fail_loyalty_evidence_test()');
  }
  expect(await db.sale.count({ where: { productId: p.id } })).toBe(0);
  expect(await db.loyaltyRedemption.count({ where: { customerId: c } })).toBe(0);
  expect((await db.customer.findUniqueOrThrow({ where: { id: c } })).loyaltyBalance).toBe(1000);
  expect((await db.product.findUniqueOrThrow({ where: { id: p.id } })).status).toBe('IN_STOCK');
  expect({
    journal: await db.journalEntry.count(),
    tender: await db.shopTender.count(),
    audit: await db.auditLog.count(),
  }).toEqual(before);
  expect(notifier.notify).not.toHaveBeenCalled();
});
it('typed proof is immutable and cannot be attached retrospectively', async () => {
  const c = await knownCustomer(),
    p = await product();
  const response = await http(
    'post',
    '/sales',
    saleBody(p.id, { customerId: c, loyaltyPointsRedeemed: 25, amountReceived: 9975 }),
    owner,
  ).expect(201);
  const proof = await db.loyaltyRedemption.findUniqueOrThrow({
    where: { saleId: response.body.id },
  });
  await expect(
    db.loyaltyRedemption.update({ where: { id: proof.id }, data: { points: 1 } }),
  ).rejects.toThrow('immutable');
  await expect(db.loyaltyRedemption.delete({ where: { id: proof.id } })).rejects.toThrow(
    'immutable',
  );
  const legacy = await db.loyaltyRedemption.create({
    data: { customerId: c, points: 1, discountAmount: 1, reason: 'Sale ' + response.body.id },
  });
  await expect(
    db.loyaltyRedemption.update({
      where: { id: legacy.id },
      data: { saleId: response.body.id, evidence: proof.evidence!, fingerprint: proof.fingerprint },
    }),
  ).rejects.toThrow('immutable');
  expect(await verifiedLoyaltySale(db, legacy)).toBeNull();
  await db.sale.update({ where: { id: response.body.id }, data: { netAmount: 9974 } });
  expect(await verifiedLoyaltySale(db, proof)).toBeNull();
});
it('current account grant revocation is rechecked after a real access-lock wait', async () => {
  const staff = await user();
  await grant(staff, ['sales.create', 'customers.read', 'products.read'], [branchA]);
  const position = await grant(staff, ['loyalty.account.read', 'loyalty.account.redeem']);
  const c = await knownCustomer(),
    p = await product();
  let release!: () => void, locked!: () => void;
  const held = new Promise<void>((r) => (locked = r)),
    unlock = new Promise<void>((r) => (release = r));
  const revoke = db.$transaction(async (tx) => {
    await lockEmployeeAccess(tx);
    await tx.accessPosition.update({ where: { id: position }, data: { permissions: [] } });
    locked();
    await unlock;
  });
  await held;
  const pending = http(
    'post',
    '/sales',
    saleBody(p.id, { customerId: c, loyaltyPointsRedeemed: 25, amountReceived: 9975 }),
    staff,
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
  expect((await db.customer.findUniqueOrThrow({ where: { id: c } })).loyaltyBalance).toBe(1000);
});
it('raw managed Sale caller cannot bypass the owned account transaction', async () => {
  const c = await knownCustomer(),
    p = await product();
  await expect(
    app
      .get(SalesService)
      .create(
        saleBody(p.id, { customerId: c, loyaltyPointsRedeemed: 25, amountReceived: 9975 }) as never,
        owner,
        'OWNER',
      ),
  ).rejects.toThrow('สิทธิ์');
  expect(await db.sale.count({ where: { productId: p.id } })).toBe(0);
});
import { AccessPartySourceService } from './access-party-source.service';
import { AccessProcurementSourceService } from './access-procurement-source.service';
import { PartyQueryPlan } from './access-party-query-plan';
import { PartyJourneyPlan } from './access-party-journey-plan';
async function pointPlan(staff: string, c: string) {
  const resources = app.get(AccessResourceService);
  const sources = new AccessPartySourceService(
    resources,
    new AccessProcurementSourceService(resources),
  );
  return (
    await resources.execute(
      staff,
      'customer-journey.read',
      'SHOP',
      undefined,
      async () => {
        const tx = currentDomainAccess()!.client;
        const party = await PartyQueryPlan.create(tx, sources);
        const plan = await PartyJourneyPlan.create(party, sources, c);
        return {
          ids: [...plan.ids.loyaltyRedemption],
          unproven: plan.unproven.has('loyaltyRedemption'),
        };
      },
      false,
      { domain: 'parties', isolationLevel: 'Serializable', maxAttempts: 3 },
    )
  ).result;
}
it('Journey consumes only genuine typed Sale proof with independent current Sale authority', async () => {
  const c = await knownCustomer(),
    p = await product();
  const response = await http(
    'post',
    '/sales',
    saleBody(p.id, { customerId: c, loyaltyPointsRedeemed: 25, amountReceived: 9975 }),
    owner,
  ).expect(201);
  const proof = await db.loyaltyRedemption.findUniqueOrThrow({
    where: { saleId: response.body.id },
  });
  expect(response.body.loyaltyRedemption).toEqual({
    saleId: response.body.id,
    points: 25,
    fingerprint: proof.fingerprint,
  });
  const legacy = await db.loyaltyRedemption.create({
    data: { customerId: c, points: 1, discountAmount: 1, reason: 'Sale ' + response.body.id },
  });
  const staff = await user();
  await grant(staff, ['customers.read', 'customer-journey.read', 'loyalty.read'], [branchA]);
  expect((await pointPlan(staff, c)).ids).not.toContain(proof.id);
  const position = await grant(staff, ['sales.read'], [branchA]);
  const plan = await pointPlan(staff, c);
  expect(plan.ids).toContain(proof.id);
  expect(plan.ids).not.toContain(legacy.id);
  expect(plan.unproven).toBe(true);
  await db.accessPosition.update({ where: { id: position }, data: { permissions: [] } });
  expect((await pointPlan(staff, c)).ids).not.toContain(proof.id);
});
it('canonical external-finance Sale uses same typed debit, and cancellation retains committed points', async () => {
  const c = await knownCustomer(),
    p = await product();
  const response = await http(
    'post',
    '/sales',
    saleBody(p.id, {
      customerId: c,
      saleType: 'EXTERNAL_FINANCE',
      loyaltyPointsRedeemed: 25,
      downPayment: 1000,
      financeAmount: 8975,
      financeCompany: 'Test finance',
      amountReceived: 1000,
    }),
    owner,
  ).expect(201);
  const proof = await db.loyaltyRedemption.findUniqueOrThrow({
    where: { saleId: response.body.id },
  });
  expect((await verifiedLoyaltySale(db, proof))?.saleType).toBe('EXTERNAL_FINANCE');
  expect(await db.financeReceivable.count({ where: { saleId: response.body.id } })).toBe(1);
  const cash = await product();
  const sold = await http(
    'post',
    '/sales',
    saleBody(cash.id, { customerId: c, loyaltyPointsRedeemed: 25, amountReceived: 9975 }),
    owner,
  ).expect(201);
  await http(
    'post',
    `/sales/${sold.body.id}/void`,
    { reason: 'Owned test cancellation' },
    owner,
  ).expect(201);
  const retained = await db.loyaltyRedemption.findUniqueOrThrow({
    where: { saleId: sold.body.id },
  });
  expect((await verifiedLoyaltySale(db, retained))?.id).toBe(sold.body.id);
  expect((await db.customer.findUniqueOrThrow({ where: { id: c } })).loyaltyBalance).toBe(950);
});
import { recordLoyaltySale } from '../loyalty/loyalty-sale-proof';
import { Prisma } from '@prisma/client';
it('canonical recorder refuses a committed Sale with matching aggregate discount', async () => {
  const c = await knownCustomer(),
    p = await product();
  const sold = await http(
    'post',
    '/sales',
    saleBody(p.id, {
      customerId: c,
      discount: 25,
      discountReason: 'Explicit owner discount',
      amountReceived: 9975,
    }),
    owner,
  ).expect(201);
  await expect(
    app.get(AccessResourceService).execute(
      owner,
      'sales.create',
      'SHOP',
      undefined,
      () =>
        recordLoyaltySale(
          saleBody(p.id, {
            customerId: c,
            loyaltyPointsRedeemed: 25,
            amountReceived: 9975,
          }) as never,
          sold.body.id,
          { baseDiscount: 0, promotionDiscount: new Prisma.Decimal(0), tradeBonus: 0 },
        ),
      false,
      { isolationLevel: 'Serializable', maxAttempts: 3 },
    ),
  ).rejects.toThrow('ใบขาย');
  expect(await db.loyaltyRedemption.count({ where: { customerId: c } })).toBe(0);
});
it('positive integral points still cannot exceed the actual permitted net ceiling', async () => {
  const c = await knownCustomer(),
    p = await product();
  await http(
    'post',
    '/sales',
    saleBody(p.id, {
      customerId: c,
      sellingPrice: 100,
      loyaltyPointsRedeemed: 101,
      amountReceived: 0,
    }),
    owner,
  ).expect(400);
  expect(await db.loyaltyRedemption.count({ where: { customerId: c } })).toBe(0);
});
it('explicit unmigrated raw Sale retains original best-effort compatibility without invented typed proof', async () => {
  const legacy = await user('OWNER');
  await db.user.update({ where: { id: legacy }, data: { accessManaged: false } });
  const c = await knownCustomer(),
    p = await product();
  const result = await app
    .get(SalesService)
    .create(
      saleBody(p.id, { customerId: c, loyaltyPointsRedeemed: 25, amountReceived: 9975 }) as never,
      legacy,
      'OWNER',
    );
  expect(result.id).toBeTruthy();
  const proof = await db.loyaltyRedemption.findFirstOrThrow({ where: { customerId: c } });
  expect(proof.saleId).toBeNull();
  expect(await verifiedLoyaltySale(db, proof)).toBeNull();
  expect((await db.customer.findUniqueOrThrow({ where: { id: c } })).loyaltyBalance).toBe(975);
});
