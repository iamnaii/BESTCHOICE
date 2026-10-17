import { PrismaClient } from '@prisma/client';
import { bookingScopeWhere } from './access-sales-scope';
const url = process.env.EMPLOYEE_ACCESS_TEST_DATABASE_URL;
if (!url?.includes('/bc_access_task2?host=/tmp/bc-access-sales-bookings.'))
  throw new Error('Owned isolated database required');
const db = new PrismaClient({ datasources: { db: { url } } });
afterAll(() => db.$disconnect());
it('does not turn booking creator into assignment', async () => {
  expect(
    await db.booking.count({
      where: bookingScopeWhere({
        userId: 'x',
        company: 'SHOP',
        permission: 'bookings.read',
        tuples: [{ userId: 'x', scope: 'ASSIGNED', branchIds: [] }],
      }),
    }),
  ).toBe(0);
});

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
import {
  AccessSalesBoundaries,
  SALES_BOUNDARY_ROUTES,
  BOOKINGS_BOUNDARY_ROUTES,
} from './access-sales-boundaries';
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
  denied: string,
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
  r.set('x-test-user', id);
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
async function newBooking(extra: object = {}, id = actor) {
  const p = await product();
  const res = await http(
    'post',
    '/bookings',
    {
      customerId,
      branchId: branchA,
      depositAmount: 1000,
      items: [{ productId: p.id, description: 'Phone', quantity: 1, unitPrice: 10000 }],
      ...extra,
    },
    id,
  ).expect(201);
  return { booking: res.body, product: p };
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
  denied = await user();
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
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
  await app.listen(0, '127.0.0.1');
});
afterAll(async () => {
  await app?.close();
});
it('executes all 18 routes through actual HTTP services and denies persisted no-grants identities', async () => {
  const p = await product();
  const sold = await http('post', '/sales', saleBody(p.id)).expect(201);
  for (const path of [
    '/sales',
    '/sales/export',
    '/sales/config',
    '/sales/salespersons',
    '/sales/top-products',
    '/sales/daily-summary',
    '/sales/' + sold.body.id,
  ])
    await http('get', path).expect(200);
  await http(
    'post',
    `/sales/${sold.body.id}/void`,
    { reason: 'Isolated test cancellation' },
    owner,
  ).expect(201);
  const { booking } = await newBooking();
  for (const path of ['/bookings', '/bookings/summary', '/bookings/' + booking.id])
    await http('get', path).expect(200);
  await http('patch', '/bookings/' + booking.id, { notes: 'Update test' }).expect(200);
  await http('post', `/bookings/${booking.id}/pay-deposit`, { depositMethod: 'CASH' }).expect(201);
  await http(
    'post',
    `/bookings/${booking.id}/cancel`,
    { cancelReason: 'Canceled by owner' },
    owner,
  ).expect(201);
  const convert = await newBooking();
  await http('post', `/bookings/${convert.booking.id}/pay-deposit`, {
    depositMethod: 'CASH',
  }).expect(201);
  await http('post', `/bookings/${convert.booking.id}/convert`, {
    collectBalance: true,
    paymentMethod: 'CASH',
  }).expect(201);
  const remove = await newBooking();
  await http('delete', '/bookings/' + remove.booking.id).expect(200);
  expect([...successes.keys()].sort()).toEqual(
    [...SALES_BOUNDARY_ROUTES, ...BOOKINGS_BOUNDARY_ROUTES].sort(),
  );
  for (const r of successes.values()) await http(r.method, r.path, r.body, denied).expect(403);
});

it('keeps historical sales, original assignment tuples, nested sources and counts independent', async () => {
  const staff = await user();
  await grant(staff, ['sales.read', 'sales.export', 'bookings.read'], [branchA]);
  await grant(
    staff,
    [
      'sales.create',
      'sensitive.cost.read',
      'sensitive.profit.read',
      'products.read',
      'customers.read',
    ],
    [branchB],
  );
  const pa = await product(),
    pb = await product(branchB);
  const ca = await knownCustomer(),
    cb = await knownCustomer(branchB);
  const a = await db.sale.create({
    data: {
      saleNumber: 'SL900000',
      saleType: 'CASH',
      customerId: ca,
      productId: pa.id,
      branchId: branchA,
      salespersonId: staff,
      sellingPrice: 10000,
      netAmount: 10000,
      costSnapshot: { create: { mainProductCost: 6000 } },
    },
  });
  const b = await db.sale.create({
    data: {
      saleNumber: 'SL900001',
      saleType: 'CASH',
      customerId: cb,
      productId: pb.id,
      branchId: branchB,
      salespersonId: actor,
      sellingPrice: 10000,
      netAmount: 10000,
    },
  });
  const read = await http('get', '/sales/' + a.id, undefined, staff).expect(200);
  expect(read.body.customer).toBeNull();
  expect(read.body.product).toBeNull();
  expect(read.body.costPriceSnapshot).toBeNull();
  await http('get', '/sales/' + b.id, undefined, staff).expect(403);
  for (const path of ['/sales', '/sales/export']) {
    const result = await http('get', path + '?search=' + b.saleNumber, undefined, staff).expect(
      200,
    );
    expect(result.body.total).toBe(0);
  }
  const customer = await db.customer.findUniqueOrThrow({ where: { id: ca } });
  expect(
    (await http('get', '/sales?search=' + customer.name, undefined, staff).expect(200)).body.total,
  ).toBe(0);
  const finance = await db.companyInfo.findUniqueOrThrow({ where: { companyCode: 'FINANCE' } });
  await db.product.update({
    where: { id: pa.id },
    data: { branchId: branchB, ownedByCompanyId: finance.id },
  });
  const historical = await http('get', '/sales/' + a.id, undefined, staff).expect(200);
  expect(historical.body.product).toBeNull();
  await grant(staff, ['sensitive.cost.read', 'sensitive.profit.read', 'customers.read'], [branchA]);
  const visible = await http('get', '/sales/' + a.id, undefined, staff).expect(200);
  expect(visible.body.costPriceSnapshot).toBe('6000');
  expect(visible.body.customer.id).toBe(ca);
  const assigned = await user();
  await grant(assigned, ['sales.read'], [branchB], true);
  await db.sale.update({ where: { id: b.id }, data: { salespersonId: assigned } });
  await http('get', '/sales/' + b.id, undefined, assigned).expect(200);
  await http('get', '/sales/' + a.id, undefined, assigned).expect(403);
  await grant(assigned, ['bookings.read'], undefined, true);
  await http('get', '/bookings', undefined, assigned).expect(403);
  await http('get', '/sales?company=FINANCE', undefined, staff).expect(403);
});

it('validates collection filters and every selected product, party and conversion source', async () => {
  for (const path of [
    '/sales?page=nan',
    '/sales?limit=300',
    '/sales?saleType=UNKNOWN',
    '/sales?includeVoided=maybe',
    '/sales?search[x]=abc',
    '/bookings?page=-1',
    '/bookings?open=maybe',
    '/bookings?sort=wrong',
    '/bookings?from=wrong',
    '/bookings?status=wrong',
  ])
    await http('get', path).expect(400);
  const staff = await user();
  await grant(
    staff,
    [
      'sales.create',
      'products.read',
      'customers.read',
      'bookings.create',
      'bookings.update',
      'bookings.read',
    ],
    [branchA],
  );
  const p = await product(),
    bundle = await product(branchB, 'ACCESSORY');
  await http('post', '/sales', saleBody(p.id, { bundleProductIds: [bundle.id] }), staff).expect(
    403,
  );
  await http(
    'post',
    '/sales',
    saleBody(p.id, { customerId: await knownCustomer(branchB) }),
    staff,
  ).expect(403);
  const unlinked = await db.customer.create({
    data: { name: 'Unproven', phone: '0800000000', nationalId: randomUUID() },
  });
  await http('post', '/sales', saleBody(p.id, { customerId: unlinked.id }), actor).expect(403);
  await http('post', '/sales', saleBody(p.id, { saleType: 'INSTALLMENT' }), staff).expect(400);
  const { booking } = await newBooking({}, staff);
  await http(
    'post',
    `/bookings/${booking.id}/pay-deposit`,
    { depositMethod: 'CASH' },
    staff,
  ).expect(201);
  await http(
    'post',
    `/bookings/${booking.id}/cancel`,
    { cancelReason: 'Not approved' },
    staff,
  ).expect(403);
  const limited = await user();
  await grant(limited, ['bookings.update', 'products.read', 'customers.read'], [branchA]);
  await http(
    'post',
    `/bookings/${booking.id}/convert`,
    { collectBalance: true, paymentMethod: 'CASH' },
    limited,
  ).expect(403);
  await grant(limited, ['sales.create'], [branchB]);
  await http(
    'post',
    `/bookings/${booking.id}/convert`,
    { collectBalance: true, paymentMethod: 'CASH' },
    limited,
  ).expect(403);
  await grant(limited, ['sales.create'], [branchA]);
  await http(
    'post',
    `/bookings/${booking.id}/convert`,
    { collectBalance: true, paymentMethod: 'CASH' },
    limited,
  ).expect(201);
});

it('rolls real sale, stock, journals and tenders back on a late loyalty SQL failure', async () => {
  const p = await product();
  const c = await knownCustomer();
  const before = {
    sale: await db.sale.count(),
    je: await db.journalEntry.count(),
    tender: await db.shopTender.count(),
    redemption: await db.loyaltyRedemption.count(),
  };
  notifier.notify.mockClear();
  await db.$executeRawUnsafe(
    `CREATE FUNCTION fail_test_loyalty() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.points = 123 THEN RAISE EXCEPTION 'injected late loyalty failure'; END IF; RETURN NEW; END $$`,
  );
  await db.$executeRawUnsafe(
    `CREATE TRIGGER test_loyalty_failure BEFORE INSERT ON loyalty_redemptions FOR EACH ROW EXECUTE FUNCTION fail_test_loyalty()`,
  );
  try {
    await http(
      'post',
      '/sales',
      saleBody(p.id, { customerId: c, loyaltyPointsRedeemed: 123, amountReceived: 9877 }),
    ).expect(500);
  } finally {
    await db.$executeRawUnsafe('DROP TRIGGER test_loyalty_failure ON loyalty_redemptions');
    await db.$executeRawUnsafe('DROP FUNCTION fail_test_loyalty()');
  }
  expect(await db.sale.count()).toBe(before.sale);
  expect(await db.journalEntry.count()).toBe(before.je);
  expect(await db.shopTender.count()).toBe(before.tender);
  expect(await db.loyaltyRedemption.count()).toBe(before.redemption);
  expect((await db.product.findUniqueOrThrow({ where: { id: p.id } })).status).toBe('IN_STOCK');
  expect((await db.customer.findUniqueOrThrow({ where: { id: c } })).loyaltyBalance).toBe(1000);
  expect(notifier.notify).not.toHaveBeenCalled();
});

it('retries the whole sale once, debits points once and notifies only after the outer commit', async () => {
  const p = await product(),
    c = await knownCustomer();
  notifier.notify.mockClear();
  const projection = app.get(AccessSalesProjectionService);
  const original = projection.project.bind(projection);
  let attempts = 0;
  const spy = jest.spyOn(projection, 'project').mockImplementation(async (...args) => {
    if (++attempts === 1)
      throw new Prisma.PrismaClientKnownRequestError('retry test', {
        code: 'P2034',
        clientVersion: 'test',
      });
    return original(...args);
  });
  try {
    await http(
      'post',
      '/sales',
      saleBody(p.id, { customerId: c, loyaltyPointsRedeemed: 25, amountReceived: 9975 }),
    ).expect(201);
  } finally {
    spy.mockRestore();
  }
  expect(attempts).toBe(2);
  expect((await db.customer.findUniqueOrThrow({ where: { id: c } })).loyaltyBalance).toBe(975);
  expect(await db.loyaltyRedemption.count({ where: { customerId: c } })).toBe(1);
  expect(await db.sale.count({ where: { productId: p.id } })).toBe(1);
  expect(notifier.notify).toHaveBeenCalledTimes(1);
  const concurrent = await product();
  const outcomes = await Promise.all(
    [1, 2].map(() =>
      http(
        'post',
        '/sales',
        saleBody(concurrent.id, { customerId: c, loyaltyPointsRedeemed: 25, amountReceived: 9975 }),
      ).then((r) => r.status),
    ),
  );
  expect(outcomes.sort()).toEqual([201, 400]);
  expect((await db.customer.findUniqueOrThrow({ where: { id: c } })).loyaltyBalance).toBe(950);
  expect(await db.loyaltyRedemption.count({ where: { customerId: c } })).toBe(2);
});

it('preserves booking product lock, canonical mixed refund and rollback/duplicate controls', async () => {
  const { booking, product: p } = await newBooking();
  const projection = app.get(AccessSalesProjectionService);
  const spy = jest
    .spyOn(projection, 'project')
    .mockRejectedValueOnce(new Error('late booking deposit failure'));
  await http('post', `/bookings/${booking.id}/pay-deposit`, { depositMethod: 'CASH' }).expect(500);
  spy.mockRestore();
  expect((await db.booking.findUniqueOrThrow({ where: { id: booking.id } })).status).toBe(
    'PENDING_DEPOSIT',
  );
  expect((await db.product.findUniqueOrThrow({ where: { id: p.id } })).status).toBe('IN_STOCK');
  expect(await db.shopTender.count({ where: { bookingId: booking.id } })).toBe(0);
  const deposit = {
    tenders: [
      { method: 'CASH', amount: 400 },
      { method: 'BANK_TRANSFER', amount: 600, reference: randomUUID() },
    ],
  };
  const outcomes = await Promise.all(
    [1, 2].map(() =>
      http('post', `/bookings/${booking.id}/pay-deposit`, deposit).then((r) => r.status),
    ),
  );
  expect(outcomes.sort()).toEqual([201, 400]);
  expect((await db.booking.findUniqueOrThrow({ where: { id: booking.id } })).lockedProductId).toBe(
    p.id,
  );
  const failure = jest
    .spyOn(projection, 'project')
    .mockRejectedValueOnce(new Error('late refund failure'));
  await http(
    'post',
    `/bookings/${booking.id}/cancel`,
    { cancelReason: 'Test refund' },
    owner,
  ).expect(500);
  failure.mockRestore();
  expect((await db.booking.findUniqueOrThrow({ where: { id: booking.id } })).status).toBe('PAID');
  expect(await db.shopTender.count({ where: { bookingId: booking.id, direction: 'OUT' } })).toBe(0);
  await http(
    'post',
    `/bookings/${booking.id}/cancel`,
    { cancelReason: 'Test refund' },
    owner,
  ).expect(201);
  await http(
    'post',
    `/bookings/${booking.id}/cancel`,
    { cancelReason: 'Duplicate refund' },
    owner,
  ).expect(400);
  const tenders = await db.shopTender.findMany({
    where: { bookingId: booking.id, direction: 'OUT' },
    orderBy: { seq: 'asc' },
  });
  expect(tenders.map((t) => [t.method, t.amount.toString()])).toEqual([
    ['CASH', '400'],
    ['BANK_TRANSFER', '600'],
  ]);
  expect((await db.product.findUniqueOrThrow({ where: { id: p.id } })).status).toBe('IN_STOCK');
});

import { Prisma } from '@prisma/client';
import { lockEmployeeAccess } from './access-snapshot.service';
it.each([false, true])(
  'rechecks current authority after an actual advisory-lock wait (owner=%s)',
  async (isOwner) => {
    const staff = await user(isOwner ? 'OWNER' : 'ACCOUNTANT');
    const position = await grant(
      staff,
      ['bookings.update', 'products.read', 'customers.read'],
      [branchA],
    );
    const { booking } = await newBooking();
    let release!: () => void, locked!: () => void;
    const held = new Promise<void>((r) => (locked = r)),
      unlock = new Promise<void>((r) => (release = r));
    const revoke = db.$transaction(async (tx) => {
      await lockEmployeeAccess(tx);
      await tx.accessPosition.update({ where: { id: position }, data: { permissions: [] } });
      await tx.user.update({
        where: { id: staff },
        data: { role: 'ACCOUNTANT', accessRevision: { increment: 1 } },
      });
      locked();
      await unlock;
    });
    await held;
    const pending = http(
      'post',
      `/bookings/${booking.id}/pay-deposit`,
      { depositMethod: 'CASH' },
      staff,
    ).then((r) => r);
    try {
      for (let i = 0; i < 100; i++) {
        const [{ waiting }] = await db.$queryRaw<
          Array<{ waiting: boolean }>
        >`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE wait_event='advisory' AND datname=current_database()) AS waiting`;
        if (waiting) break;
        if (i === 99) throw new Error('No access lock wait');
        await new Promise((r) => setTimeout(r, 10));
      }
    } finally {
      release();
    }
    await revoke;
    expect((await pending).status).toBe(403);
    expect((await db.booking.findUniqueOrThrow({ where: { id: booking.id } })).status).toBe(
      'PENDING_DEPOSIT',
    );
  },
);

it('requires current owner and reason for discretionary discount with atomic self-approval evidence', async () => {
  const manager = await user();
  await db.user.update({ where: { id: manager }, data: { role: 'BRANCH_MANAGER' } });
  await grant(manager, ['discounts.approve'], [branchA]);
  await grant(manager, ['sales.create', 'products.read', 'customers.read'], [branchB]);
  const pb = await product(branchB),
    cb = await knownCustomer(branchB);
  await http(
    'post',
    '/sales',
    saleBody(pb.id, {
      branchId: branchB,
      customerId: cb,
      discount: 100,
      amountReceived: 9900,
      secondApproverId: owner,
      discountReason: 'Legacy role must not approve',
    }),
    manager,
  ).expect(403);
  const p = await product();
  await http(
    'post',
    '/sales',
    saleBody(p.id, { discount: 100, amountReceived: 9900 }),
    owner,
  ).expect(400);
  const response = await http(
    'post',
    '/sales',
    saleBody(p.id, {
      discount: 100,
      amountReceived: 9900,
      discountReason: '  Owner clearing stock  ',
    }),
    owner,
  ).expect(201);
  const audit = await db.auditLog.findFirstOrThrow({
    where: { entityId: response.body.id, action: 'SALE_DISCOUNT_OWNER_APPROVED' },
  });
  expect(audit.newValue).toEqual({
    requesterId: owner,
    approverId: owner,
    saleId: response.body.id,
    reason: 'Owner clearing stock',
    sellingPrice: '10000',
    baseDiscount: '100',
    totalDiscount: '100',
    netAmount: '9900',
  });
  const next = await product();
  const projection = jest
    .spyOn(app.get(AccessSalesProjectionService), 'project')
    .mockRejectedValueOnce(new Error('late discount failure'));
  await http(
    'post',
    '/sales',
    saleBody(next.id, { discount: 100, amountReceived: 9900, discountReason: 'Rollback audit' }),
    owner,
  ).expect(500);
  projection.mockRestore();
  expect(await db.sale.count({ where: { productId: next.id } })).toBe(0);
  expect(
    await db.auditLog.count({
      where: {
        action: 'SALE_DISCOUNT_OWNER_APPROVED',
        newValue: { path: ['reason'], equals: 'Rollback audit' },
      },
    }),
  ).toBe(0);
});

import { TradeInCreditService } from '../trade-in/services/trade-in-credit.service';
import { tradeInSource } from './access-trade-in-scope';
it('consumes raw trade credit atomically, projects independently, restores only authorized Sale navigation and releases once', async () => {
  const c = await knownCustomer(),
    p = await product();
  const credit = await db.tradeIn.create({
    data: {
      customerId: c,
      branchId: branchA,
      deviceBrand: 'Apple',
      deviceModel: 'Credit',
      flow: 'EXCHANGE',
      status: 'ACCEPTED',
      agreedPrice: 1100,
      idCardVerifiedAt: new Date(),
      idCardVerifiedById: owner,
      sellerDeclarationSnapshot: { confirmed: true },
    },
  });
  await db.$transaction((tx) =>
    new TradeInCreditService(db as PrismaService).issue(
      tx,
      credit.id,
      new Prisma.Decimal(1000),
      new Prisma.Decimal(100),
    ),
  );
  const staff = await user();
  await grant(staff, ['sales.create', 'sales.read', 'products.read', 'customers.read'], [branchA]);
  const body = saleBody(p.id, { customerId: c, tradeInCreditId: credit.id, amountReceived: 8900 });
  await http('post', '/sales', body, staff).expect(403);
  await grant(staff, ['trade-in.read'], [branchB]);
  await http('post', '/sales', body, staff).expect(403);
  await grant(staff, ['trade-in.read'], [branchA]);
  const sold = await http('post', '/sales', body, staff).expect(201);
  expect(sold.body.netAmount).toBe('9900');
  expect(sold.body.tradeInCreditSnapshot.baseAmount).toBeNull();
  expect(sold.body.tradeInCreditSnapshot.cashDownAmount).toBeNull();
  const persisted = await db.sale.findUniqueOrThrow({ where: { id: sold.body.id } });
  expect(persisted.tradeInCreditSnapshot).toMatchObject({
    baseAmount: '1000.00',
    bonusAmount: '100.00',
    cashDownAmount: '8900.00',
  });
  expect(
    (await db.shopTender.findFirstOrThrow({ where: { saleId: sold.body.id } })).amount.toString(),
  ).toBe('8900');
  const redemption = await db.tradeInCreditRedemption.findUniqueOrThrow({
    where: { saleId: sold.body.id },
  });
  const je = await db.journalEntry.findUniqueOrThrow({
    where: { id: redemption.applicationJournalEntryId! },
    include: { lines: true },
  });
  expect(je.lines.map((l) => [l.debit.toString(), l.credit.toString()])).toEqual([
    ['1000', '0'],
    ['0', '1000'],
  ]);
  const viewer = await user();
  await grant(viewer, ['trade-in.read'], [branchA]);
  const project = async (id: string) =>
    (
      await app.get(AccessResourceService).execute(
        id,
        'trade-in.read',
        'SHOP',
        async (tx) => ({
          company: 'SHOP',
          resources: [await tradeInSource(tx, credit.id)],
          productIds: [],
        }),
        async () =>
          app.get(AccessTradeInProjectionService).project(
            await currentDomainAccess()!.client.tradeIn.findUniqueOrThrow({
              where: { id: credit.id },
            }),
          ),
        false,
      )
    ).result;
  expect((await project(viewer)).currentRedemptionId).toBeNull();
  await grant(viewer, ['sales.read'], [branchB]);
  expect((await project(viewer)).currentRedemptionId).toBeNull();
  await grant(viewer, ['sales.read'], [branchA]);
  expect(await project(viewer)).toMatchObject({
    currentRedemptionId: redemption.id,
    currentRedemptionSaleId: sold.body.id,
  });
  const other = await product();
  await http(
    'post',
    '/sales',
    saleBody(other.id, { customerId: c, tradeInCreditId: credit.id, amountReceived: 8900 }),
    staff,
  ).expect(400);
  await http(
    'post',
    `/sales/${sold.body.id}/void`,
    { reason: 'Credit release test' },
    owner,
  ).expect(201);
  expect(
    (await db.tradeIn.findUniqueOrThrow({ where: { id: credit.id } })).currentRedemptionId,
  ).toBeNull();
  await http(
    'post',
    `/sales/${sold.body.id}/void`,
    { reason: 'Duplicate credit release test' },
    owner,
  ).expect(400);
  await http('get', '/sales/' + sold.body.id, undefined, staff).expect(200);
  expect(
    (
      await http(
        'get',
        '/sales?includeVoided=true&search=' + persisted.saleNumber,
        undefined,
        staff,
      ).expect(200)
    ).body.total,
  ).toBe(1);
});

it('preserves external finance, same-source bundle money and rollback of booking conversion and sale void', async () => {
  const p = await product(),
    bundle = await product(branchA, 'ACCESSORY');
  const sold = await http(
    'post',
    '/sales',
    saleBody(p.id, { bundleProductIds: [bundle.id] }),
  ).expect(201);
  const entries = await db.journalEntry.findMany({
    where: { metadata: { path: ['saleId'], equals: sold.body.id } },
  });
  expect(entries.length).toBe(2);
  const projection = app.get(AccessSalesProjectionService);
  const failVoid = jest
    .spyOn(projection, 'project')
    .mockRejectedValueOnce(new Error('late void failure'));
  await http(
    'post',
    `/sales/${sold.body.id}/void`,
    { reason: 'Rollback complete void' },
    owner,
  ).expect(500);
  failVoid.mockRestore();
  expect((await db.sale.findUniqueOrThrow({ where: { id: sold.body.id } })).deletedAt).toBeNull();
  expect((await db.product.findUniqueOrThrow({ where: { id: p.id } })).status).toBe('SOLD_CASH');
  expect(await db.shopTender.count({ where: { saleId: sold.body.id, direction: 'OUT' } })).toBe(0);
  await http(
    'post',
    `/sales/${sold.body.id}/void`,
    { reason: 'Complete bundle void' },
    owner,
  ).expect(201);
  const ext = await product();
  const external = await http(
    'post',
    '/sales',
    saleBody(ext.id, {
      saleType: 'EXTERNAL_FINANCE',
      downPayment: 1000,
      financeAmount: 9000,
      financeCompany: 'Test finance',
      amountReceived: 1000,
    }),
  ).expect(201);
  expect(await db.financeReceivable.count({ where: { saleId: external.body.id } })).toBe(1);
  const { booking, product: booked } = await newBooking();
  await http('post', `/bookings/${booking.id}/pay-deposit`, { depositMethod: 'CASH' }).expect(201);
  const failConvert = jest
    .spyOn(projection, 'project')
    .mockRejectedValueOnce(new Error('late convert failure'));
  await http('post', `/bookings/${booking.id}/convert`, {
    collectBalance: true,
    paymentMethod: 'CASH',
  }).expect(500);
  failConvert.mockRestore();
  expect((await db.booking.findUniqueOrThrow({ where: { id: booking.id } })).status).toBe('PAID');
  expect((await db.product.findUniqueOrThrow({ where: { id: booked.id } })).status).toBe(
    'RESERVED',
  );
  expect(await db.sale.count({ where: { productId: booked.id } })).toBe(0);
  const outcomes = await Promise.all(
    [1, 2].map(() =>
      http('post', `/bookings/${booking.id}/convert`, {
        collectBalance: true,
        paymentMethod: 'CASH',
      }).then((r) => r.status),
    ),
  );
  expect(outcomes.sort()).toEqual([201, 400]);
  expect(await db.sale.count({ where: { productId: booked.id } })).toBe(1);
});

it('keeps independent search/filter and physical booking-lock constraints before disclosure', async () => {
  await http('get', '/sales?startDate=2026-02-31').expect(400);
  await http('get', '/sales?contractStatus=ACTIVE').expect(403);
  const staff = await user();
  await grant(staff, ['bookings.read'], [branchA]);
  await http('get', '/bookings?customerId=' + customerId, undefined, staff).expect(403);
  const customer = await db.customer.findUniqueOrThrow({ where: { id: customerId } });
  expect(
    (
      await http(
        'get',
        '/bookings?search=' + encodeURIComponent(customer.name),
        undefined,
        staff,
      ).expect(200)
    ).body.total,
  ).toBe(0);
  await grant(staff, ['sales.read'], [branchA]);
  expect(
    (
      await http(
        'get',
        '/sales?search=' + encodeURIComponent(customer.name),
        undefined,
        staff,
      ).expect(200)
    ).body.total,
  ).toBe(0);
  const p = await product();
  const body = {
    customerId,
    branchId: branchA,
    depositAmount: 1000,
    items: [
      { productId: p.id, description: 'Shared pending device', quantity: 1, unitPrice: 10000 },
    ],
  };
  const first = await http('post', '/bookings', body).expect(201);
  const second = await http('post', '/bookings', body).expect(201);
  const outcomes = await Promise.all(
    [first.body.id, second.body.id].map((id) =>
      http('post', `/bookings/${id}/pay-deposit`, { depositMethod: 'CASH' }).then((r) => r.status),
    ),
  );
  expect(outcomes.sort()).toEqual([201, 409]);
  expect(await db.booking.count({ where: { lockedProductId: p.id, deletedAt: null } })).toBe(1);
  const indexes = await db.$queryRaw<
    Array<{ indexdef: string }>
  >`SELECT indexdef FROM pg_indexes WHERE indexname = 'bookings_locked_product_active_unique'`;
  expect(indexes[0].indexdef).toContain('WHERE');
});
