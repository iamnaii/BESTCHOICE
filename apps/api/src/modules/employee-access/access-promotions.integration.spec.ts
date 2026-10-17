import { PermissionKey } from '@installment/shared';
import { AccessSalesBoundaries } from './access-sales-boundaries';
import { AccessSalesProjectionService } from './access-sales-projection.service';
import { AccessTradeInProjectionService } from './access-trade-in-projection.service';
import { SalesController } from '../sales/sales.controller';
import { SalesService } from '../sales/sales.service';
import { SaleVoidService } from '../sales/services/sale-void.service';
import { SaleWarrantyNotifierService } from '../sales/services/sale-warranty-notifier.service';
import { InterCompanyService } from '../inter-company/inter-company.service';
import { ShopCashSaleTemplate } from '../journal/cpa-templates/shop-cash-sale.template';
import { ShopExternalFinanceSaleTemplate } from '../journal/cpa-templates/shop-external-finance-sale.template';
import { ExchangeCancelReversalTemplate } from '../journal/cpa-templates/exchange-cancel-reversal.template';
import { ShopAccountResolver } from '../journal/shop-account-resolver.service';
import { CompanyResolverService } from '../journal/company-resolver.service';
import { JournalAutoService } from '../journal/journal-auto.service';
import { BranchGuard } from '../auth/guards/branch.guard';
import { seedShopCoa } from '../../../prisma/seed-coa-shop';
import { AccessPromotionsBoundaries } from './access-promotions-boundaries';
import { randomUUID } from 'node:crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import { Test } from '@nestjs/testing';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { ExecutionContext, INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../../prisma/prisma.service';
import { AccessSnapshotService } from './access-snapshot.service';
import { AccessResourceService } from './access-resource.service';
import { AccessPolicyService } from './access-policy';
import { AccessPolicyInterceptor } from './access-policy.interceptor';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { PromotionsController } from '../promotions/promotions.controller';
import { PromotionsService } from '../promotions/promotions.service';

const url = process.env.EMPLOYEE_ACCESS_TEST_DATABASE_URL;
if (
  !url?.includes('/bc_access_task2?host=/tmp/bc-access-promotions.') ||
  process.env.DATABASE_URL !== url ||
  process.env.DATABASE_URL_FINANCE !== url
)
  throw new Error('Both database URLs must use owned isolated promotion PostgreSQL');
const db = new PrismaClient({ datasources: { db: { url } } });
const marker = randomUUID();
const snapshots = new AccessSnapshotService(db as PrismaService);
let app: INestApplication;
let reader: string, denied: string, owner: string, promotionId: string;
let seller: string, branchId: string, otherBranch: string, customerId: string, shopId: string;
let stale: Awaited<ReturnType<AccessSnapshotService['forUser']>> | undefined;
function definition() {
  return {
    name: 'Owned promotion ' + randomUUID(),
    type: 'FIXED_DISCOUNT',
    discountValue: 100,
    startDate: '2020-01-01T00:00:00Z',
    endDate: '2099-12-31T00:00:00Z',
    conditions: {},
    maxUsageCount: 10,
  };
}
function http(method: 'get' | 'post' | 'patch' | 'delete', path: string, actor = reader) {
  const agent = request(app.getHttpServer());
  return agent[method](path + '?company=SHOP')
    .set('x-test-user', actor)
    .expect('x-owned-promotion-app', marker);
}
async function grant(
  id: string,
  permissions: PermissionKey[],
  scope: 'COMPANY' | 'BRANCHES' | 'ASSIGNED' = 'COMPANY',
  branches: string[] = [],
) {
  const p = await db.accessPosition.create({
    data: { code: randomUUID(), name: 'Owned promotion position', permissions },
  });
  return db.employeeAccessAssignment.create({
    data: {
      userId: id,
      positionId: p.id,
      companyCode: 'SHOP',
      scope,
      branches: { create: branches.map((branchId) => ({ branchId })) },
    },
  });
}
async function product(extra: object = {}) {
  return db.product.create({
    data: {
      name: 'Owned phone',
      brand: 'Apple',
      model: 'Test',
      category: 'PHONE_NEW',
      costPrice: 6000,
      cashPrice: 10000,
      installmentPrice: 12000,
      branchId,
      ownedByCompanyId: shopId,
      ...extra,
    },
  });
}
function saleBody(productId: string, promotionId: string, extra: object = {}) {
  return {
    saleType: 'CASH',
    productId,
    customerId,
    branchId,
    sellingPrice: 10000,
    paymentMethod: 'CASH',
    promotionId,
    ...extra,
  };
}
async function promo(extra: object = {}) {
  return db.promotion.create({ data: { ...definition(), type: 'FIXED_DISCOUNT', ...extra } });
}
async function canonicalSale(
  extra: object = {},
  productExtra: object = {},
  promoExtra: object = {},
  actor?: string,
) {
  const p = await product(productExtra),
    promotion = await promo(promoExtra);
  const res = await http('post', '/sales', actor ?? seller)
    .send(saleBody(p.id, promotion.id, extra))
    .expect(201);
  return { sale: await db.sale.findUniqueOrThrow({ where: { id: res.body.id } }), p, promotion };
}
beforeAll(async () => {
  const shop = await db.companyInfo.findUniqueOrThrow({ where: { companyCode: 'SHOP' } });
  shopId = shop.id;
  branchId = (
    await db.branch.create({
      data: { name: 'Owned promotion A', companyId: shopId, shopCashAccountCode: 'S11-1101' },
    })
  ).id;
  otherBranch = (
    await db.branch.create({
      data: { name: 'Owned promotion B', companyId: shopId, shopCashAccountCode: 'S11-1101' },
    })
  ).id;
  seller = (
    await db.user.create({
      data: {
        name: 'Seller',
        email: randomUUID() + '@test.invalid',
        password: 'unused',
        role: 'SALES',
        accessManaged: true,
      },
    })
  ).id;
  await grant(seller, [
    'promotions.read',
    'promotions.apply',
    'sales.create',
    'sales.read',
    'products.read',
    'customers.read',
  ]);
  customerId = (
    await db.customer.create({
      data: { name: 'Owned buyer', phone: '0800000000', nationalId: randomUUID() },
    })
  ).id;
  await db.tradeIn.create({
    data: { customerId, branchId, deviceBrand: 'Apple', deviceModel: 'Evidence' },
  });
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
  const users = await Promise.all(
    ['ACCOUNTANT', 'ACCOUNTANT', 'OWNER'].map((role) =>
      db.user.create({
        data: {
          name: 'Owned promotion test',
          email: randomUUID() + '@test.invalid',
          password: 'unused',
          role: role as 'OWNER' | 'ACCOUNTANT',
          accessManaged: true,
        },
      }),
    ),
  );
  [reader, denied, owner] = users.map((u) => u.id);
  const position = await db.accessPosition.create({
    data: { code: randomUUID(), name: 'Owned promotion reader', permissions: ['promotions.read'] },
  });
  await db.employeeAccessAssignment.create({
    data: { userId: reader, positionId: position.id, companyCode: 'SHOP', scope: 'COMPANY' },
  });
  promotionId = (await db.promotion.create({ data: { ...definition(), type: 'FIXED_DISCOUNT' } }))
    .id;
  const module = await Test.createTestingModule({
    controllers: [PromotionsController, SalesController],
    providers: [
      AccessPromotionsBoundaries,
      AccessSalesBoundaries,
      AccessSalesProjectionService,
      AccessTradeInProjectionService,
      SalesService,
      SaleVoidService,
      ShopCashSaleTemplate,
      ShopExternalFinanceSaleTemplate,
      ExchangeCancelReversalTemplate,
      ShopAccountResolver,
      CompanyResolverService,
      JournalAutoService,
      {
        provide: SaleWarrantyNotifierService,
        useValue: { notify: jest.fn(async () => undefined) },
      },
      { provide: InterCompanyService, useValue: {} },
      PromotionsService,
      AccessResourceService,
      AccessPolicyService,
      { provide: PrismaService, useValue: db },
      { provide: AccessSnapshotService, useValue: snapshots },
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
          access: stale?.userId === id ? stale : await snapshots.forUser(id),
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
  app.use((_req: unknown, res: { setHeader: (k: string, v: string) => void }, next: () => void) => {
    res.setHeader('x-owned-promotion-app', marker);
    next();
  });
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
  await app.listen(0, '127.0.0.1');
}, 60000);
afterAll(async () => {
  await app?.close();
  await db.$disconnect();
});

describe('Owned promotion domain read RED', () => {
  it.each(['', '/active', '/one'])('admits useful authorized definitions at %s', async (suffix) => {
    const res = await http(
      'get',
      '/promotions' + (suffix === '/one' ? '/' + promotionId : suffix),
    ).expect(200);
    expect(JSON.stringify(res.body)).toContain(promotionId);
    expect(JSON.stringify(res.body)).not.toContain('currentUsageCount');
  });
  it.each(['', '/active', '/one'])('rejects missing original action at %s', async (suffix) => {
    await http(
      'get',
      '/promotions' + (suffix === '/one' ? '/' + promotionId : suffix),
      denied,
    ).expect(403);
  });
});
describe('Owned adjacent owner CRUD RED', () => {
  it('creates a useful owner definition with required durable audit', async () => {
    const body = definition();
    const res = await http('post', '/promotions', owner).send(body).expect(201);
    expect(await db.promotion.findUnique({ where: { id: res.body.id } })).toMatchObject({
      name: body.name,
    });
    expect(await db.auditLog.count({ where: { userId: owner, entityId: res.body.id } })).toBe(1);
  });
  it('updates a useful owner definition with required durable audit', async () => {
    const p = await db.promotion.create({ data: { ...definition(), type: 'FIXED_DISCOUNT' } });
    await http('patch', '/promotions/' + p.id, owner)
      .send({ discountValue: 150 })
      .expect(200);
    expect(
      (await db.promotion.findUniqueOrThrow({ where: { id: p.id } })).discountValue?.toString(),
    ).toBe('150');
    expect(await db.auditLog.count({ where: { userId: owner, entityId: p.id } })).toBe(1);
  });
  it('soft deletes a useful owner definition with required durable audit', async () => {
    const p = await db.promotion.create({ data: { ...definition(), type: 'FIXED_DISCOUNT' } });
    await http('delete', '/promotions/' + p.id, owner).expect(200);
    expect(
      (await db.promotion.findUniqueOrThrow({ where: { id: p.id } })).deletedAt,
    ).not.toBeNull();
    expect(await db.auditLog.count({ where: { userId: owner, entityId: p.id } })).toBe(1);
  });
  it.each(['post', 'patch', 'delete'] as const)('reserves %s for owner', async (method) => {
    await http(method, '/promotions' + (method === 'post' ? '' : '/' + promotionId))
      .send(definition())
      .expect(403);
  });
  it('does not silently accept prose conditions', async () => {
    await http('post', '/promotions', owner)
      .send({ ...definition(), conditions: 'only selected products' })
      .expect(400);
  });
});

describe('Canonical named promotion producer', () => {
  it('gives staff a real 20 percent benefit beyond discretionary caps and posts canonical journals', async () => {
    const { sale, p, promotion } = await canonicalSale(
      {},
      {},
      { type: 'PERCENTAGE_DISCOUNT', discountValue: 20 },
    );
    expect(sale.discount.toString()).toBe('2000');
    expect(sale.netAmount.toString()).toBe('8000');
    expect((await db.product.findUniqueOrThrow({ where: { id: p.id } })).status).toBe('SOLD_CASH');
    const benefit = await db.salePromotionBenefit.findUniqueOrThrow({ where: { saleId: sale.id } });
    expect(benefit.discountAmount.toString()).toBe('2000');
    expect(benefit.baselineSource).toBe('column:cashPrice');
    expect(await db.promotionUsage.count({ where: { benefitId: benefit.id } })).toBe(1);
    expect(
      (await db.promotion.findUniqueOrThrow({ where: { id: promotion.id } })).currentUsageCount,
    ).toBe(1);
    expect(
      await db.journalEntry.count({ where: { metadata: { path: ['saleId'], equals: sale.id } } }),
    ).toBeGreaterThan(0);
    expect(
      await db.auditLog.count({ where: { entityId: sale.id, action: 'SALE_PROMOTION_APPLIED' } }),
    ).toBe(1);
  });
  it('creates a real fixed benefit using the external-finance canonical price', async () => {
    const { sale } = await canonicalSale({
      saleType: 'EXTERNAL_FINANCE',
      sellingPrice: 12000,
      downPayment: 2000,
      financeCompany: 'Owned',
      financeRefNumber: 'owned-ref',
    });
    expect(sale.discount.toString()).toBe('100');
    expect(sale.netAmount.toString()).toBe('11900');
  });
  it('records actual free accessory stock, no invented cash benefit', async () => {
    const accessory = await product({ category: 'ACCESSORY', costPrice: 100, cashPrice: 200 });
    const { sale } = await canonicalSale(
      { bundleProductIds: [accessory.id] },
      {},
      {
        type: 'FREE_ACCESSORY',
        discountValue: null,
        conditions: { accessoryProductIds: [accessory.id] },
      },
    );
    expect(sale.discount.toString()).toBe('0');
    expect(sale.bundleProductIds).toEqual([accessory.id]);
    expect((await db.product.findUniqueOrThrow({ where: { id: accessory.id } })).status).toBe(
      'SOLD_CASH',
    );
    expect(
      (await db.salePromotionBenefit.findUniqueOrThrow({ where: { saleId: sale.id } }))
        .accessoryProductIds,
    ).toEqual([accessory.id]);
  });
  it('verifies the committed usage exactly once after edit, expiry, deactivation and exhaustion', async () => {
    const { sale, promotion } = await canonicalSale({}, {}, { maxUsageCount: 1 });
    await db.promotion.update({
      where: { id: promotion.id },
      data: { isActive: false, endDate: new Date('2020-01-01'), discountValue: 200 },
    });
    for (let i = 0; i < 2; i++)
      await http('post', '/promotions/' + promotion.id + '/apply', seller)
        .send({ saleId: sale.id, customerId, discountAmount: 100 })
        .expect(201);
    expect(await db.promotionUsage.count({ where: { saleId: sale.id } })).toBe(1);
    expect(
      (await db.promotion.findUniqueOrThrow({ where: { id: promotion.id } })).currentUsageCount,
    ).toBe(1);
    expect((await db.sale.findUniqueOrThrow({ where: { id: sale.id } })).netAmount.toString()).toBe(
      '9900',
    );
    await http('post', '/promotions/' + promotion.id + '/apply', seller)
      .send({ saleId: sale.id, customerId, discountAmount: 999 })
      .expect(400);
    await http('post', '/promotions/' + promotion.id + '/apply', denied)
      .send({ saleId: sale.id, customerId })
      .expect(403);
    await http('post', '/promotions/' + promotion.id + '/apply', seller)
      .send({ saleId: sale.id, customerId: randomUUID() })
      .expect(403);
  });
  it('rejects scalar Sale.discount without canonical evidence', async () => {
    const p = await product(),
      promotion = await promo();
    const res = await http('post', '/sales', owner)
      .send({
        ...saleBody(p.id, promotion.id),
        promotionId: undefined,
        discount: 100,
        discountReason: 'Owned manual discount',
      })
      .expect(201);
    await http('post', '/promotions/' + promotion.id + '/apply', seller)
      .send({ saleId: res.body.id, customerId, discountAmount: 100 })
      .expect(403);
  });
  it('rejects unapproved extra discount even with a standard promotion', async () => {
    const p = await product(),
      promotion = await promo();
    await http('post', '/sales', seller)
      .send(saleBody(p.id, promotion.id, { discount: 1 }))
      .expect(403);
    expect(await db.sale.count({ where: { productId: p.id } })).toBe(0);
  });
  it.each([
    { conditions: 'legacy prose' },
    { conditions: { unknown: true } },
    { conditions: { minPurchase: 10001 } },
    { conditions: { productIds: ['not-this-product'] } },
    { conditions: { categories: ['ACCESSORY'] } },
    { isActive: false },
    { endDate: new Date('2020-01-01') },
    { maxUsageCount: 1, currentUsageCount: 1 },
    { type: 'SPECIAL_RATE', discountValue: null, specialInterestRate: 0.01 },
  ])('rejects current ineligible definition %j without sale or usage', async (extra) => {
    const p = await product(),
      promotion = await promo(extra);
    await http('post', '/sales', seller).send(saleBody(p.id, promotion.id)).expect(400);
    expect(await db.sale.count({ where: { productId: p.id } })).toBe(0);
    expect(await db.promotionUsage.count({ where: { promotionId: promotion.id } })).toBe(0);
  });
  it('rejects forged scalar baseline and accepts an actual locked priceId', async () => {
    const p = await product(),
      promotion = await promo();
    await http('post', '/sales', seller)
      .send(saleBody(p.id, promotion.id, { sellingPrice: 1 }))
      .expect(400);
    const price = await db.productPrice.create({
      data: { productId: p.id, label: 'Actual custom price', amount: 9000 },
    });
    const res = await http('post', '/sales', seller)
      .send(saleBody(p.id, promotion.id, { sellingPrice: 9000, priceId: price.id }))
      .expect(201);
    expect(
      (await db.salePromotionBenefit.findUniqueOrThrow({ where: { saleId: res.body.id } }))
        .baselineSource,
    ).toBe('price:' + price.id);
  });
  it('denies ambiguous fallback and substituted priceId; accepts explicit actual fallback row', async () => {
    const p = await product({ cashPrice: null }),
      other = await product(),
      promotion = await promo();
    const prices = await Promise.all(
      [10000, 11000].map((amount) =>
        db.productPrice.create({ data: { productId: p.id, label: 'ราคาเงินสด', amount } }),
      ),
    );
    const foreign = await db.productPrice.create({
      data: { productId: other.id, label: 'ราคาเงินสด', amount: 10000 },
    });
    await http('post', '/sales', seller).send(saleBody(p.id, promotion.id)).expect(400);
    await http('post', '/sales', seller)
      .send(saleBody(p.id, promotion.id, { priceId: foreign.id }))
      .expect(400);
    await http('post', '/sales', seller)
      .send(saleBody(p.id, promotion.id, { priceId: prices[0].id }))
      .expect(201);
  });
  it('admits exactly one concurrent final-cap benefit including real money writes', async () => {
    const promotion = await promo({ maxUsageCount: 1 }),
      products = await Promise.all([product(), product()]);
    const results = await Promise.all(
      products.map((p) => http('post', '/sales', seller).send(saleBody(p.id, promotion.id))),
    );
    expect(results.map((r) => r.status).sort()).toEqual([201, 400]);
    expect(await db.salePromotionBenefit.count({ where: { promotionId: promotion.id } })).toBe(1);
    expect(
      (await db.promotion.findUniqueOrThrow({ where: { id: promotion.id } })).currentUsageCount,
    ).toBe(1);
  });
  it('rolls back stock, sale, journal, benefit and cap on late required audit failure', async () => {
    const p = await product(),
      promotion = await promo();
    await db.$executeRawUnsafe(
      `CREATE FUNCTION owned_fail_promotion_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action = 'SALE_PROMOTION_APPLIED' THEN RAISE EXCEPTION 'owned required audit failure'; END IF; RETURN NEW; END $$`,
    );
    await db.$executeRawUnsafe(
      `CREATE TRIGGER owned_fail_promotion_audit BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION owned_fail_promotion_audit()`,
    );
    try {
      await http('post', '/sales', seller).send(saleBody(p.id, promotion.id)).expect(500);
    } finally {
      await db.$executeRawUnsafe('DROP TRIGGER owned_fail_promotion_audit ON audit_logs');
      await db.$executeRawUnsafe('DROP FUNCTION owned_fail_promotion_audit()');
    }
    expect(await db.sale.count({ where: { productId: p.id } })).toBe(0);
    expect((await db.product.findUniqueOrThrow({ where: { id: p.id } })).status).toBe('IN_STOCK');
    expect(await db.salePromotionBenefit.count({ where: { promotionId: promotion.id } })).toBe(0);
    expect(
      (await db.promotion.findUniqueOrThrow({ where: { id: promotion.id } })).currentUsageCount,
    ).toBe(0);
  });
});

async function staff() {
  return (
    await db.user.create({
      data: {
        name: 'Owned scoped staff',
        email: randomUUID() + '@test.invalid',
        password: 'unused',
        role: 'ACCOUNTANT',
        accessManaged: true,
      },
    })
  ).id;
}
const saleKeys: PermissionKey[] = [
  'sales.create',
  'sales.read',
  'products.read',
  'customers.read',
  'promotions.apply',
  'promotions.read',
];
describe('Current source and original tuple controls', () => {
  it('requires a definition source and scopes counts to independently visible transactions', async () => {
    const { sale, promotion } = await canonicalSale();
    const scoped = await staff(),
      assigned = await staff();
    await grant(scoped, ['promotions.read'], 'BRANCHES', [otherBranch]);
    await grant(assigned, ['promotions.read'], 'ASSIGNED', [branchId]);
    const definitions = await http('get', '/promotions/' + promotion.id, scoped).expect(200);
    expect(definitions.body.visibleUsageCount).toBe(0);
    expect(definitions.body.usageCountScope).toBe('CURRENT_AUTHORIZED_COMPLETE_SOURCES');
    expect(definitions.body.currentUsageCount).toBeUndefined();
    expect(definitions.body._count).toBeUndefined();
    await http('get', '/promotions/' + promotion.id, assigned).expect(403);
    const visible = await http('get', '/promotions/' + promotion.id, seller).expect(200);
    expect(visible.body.visibleUsageCount).toBe(1);
    await db.product.update({ where: { id: sale.productId }, data: { deletedAt: new Date() } });
    expect(
      (await http('get', '/promotions/' + promotion.id, seller).expect(200)).body.visibleUsageCount,
    ).toBe(0);
    await http('post', '/promotions/' + promotion.id + '/apply', seller)
      .send({ saleId: sale.id, customerId })
      .expect(403);
  });
  it('does not flatten promotion action in A and sales action in B', async () => {
    const actor = await staff();
    await grant(actor, ['promotions.apply'], 'BRANCHES', [branchId]);
    await grant(
      actor,
      ['sales.create', 'sales.read', 'products.read', 'customers.read'],
      'BRANCHES',
      [otherBranch],
    );
    const p = await product({ branchId: otherBranch }),
      promotion = await promo();
    const customer = await db.customer.create({
      data: { name: 'Other buyer', phone: '0800000000', nationalId: randomUUID() },
    });
    await db.tradeIn.create({
      data: {
        customerId: customer.id,
        branchId: otherBranch,
        deviceBrand: 'Apple',
        deviceModel: 'Evidence',
      },
    });
    await http('post', '/sales', actor)
      .send(saleBody(p.id, promotion.id, { branchId: otherBranch, customerId: customer.id }))
      .expect(403);
    expect(await db.sale.count({ where: { productId: p.id } })).toBe(0);
  });
  it('allows ASSIGNED Sale action only with independently granted actual customer/product sources', async () => {
    const actor = await staff();
    await grant(actor, ['sales.create', 'sales.read', 'promotions.apply'], 'ASSIGNED', [branchId]);
    await grant(actor, ['products.read', 'customers.read'], 'BRANCHES', [branchId]);
    const { sale, promotion } = await canonicalSale({}, {}, {}, actor);
    await http('post', '/promotions/' + promotion.id + '/apply', actor)
      .send({ saleId: sale.id, customerId })
      .expect(201);
    const other = await staff();
    await grant(other, ['sales.read', 'promotions.apply'], 'ASSIGNED', [branchId]);
    await grant(other, ['products.read', 'customers.read'], 'BRANCHES', [branchId]);
    await http('post', '/promotions/' + promotion.id + '/apply', other)
      .send({ saleId: sale.id, customerId })
      .expect(403);
  });
  it('does not transfer Sale assignment to an unassigned customer or Product', async () => {
    const actor = await staff();
    await grant(actor, saleKeys, 'ASSIGNED', [branchId]);
    const p = await product(),
      promotion = await promo();
    await http('post', '/sales', actor).send(saleBody(p.id, promotion.id)).expect(403);
  });
  it('refreshes revoked authority despite a stale JWT snapshot', async () => {
    const actor = await staff(),
      assignment = await grant(actor, saleKeys);
    stale = await snapshots.forUser(actor);
    await db.employeeAccessAssignment.update({
      where: { id: assignment.id },
      data: { deletedAt: new Date() },
    });
    try {
      await http('get', '/promotions', actor).expect(403);
      const p = await product(),
        promotion = await promo();
      await http('post', '/sales', actor).send(saleBody(p.id, promotion.id)).expect(403);
    } finally {
      stale = undefined;
    }
  });
  it('requires actual current sale/customer/product correlation on verification', async () => {
    const { sale, promotion } = await canonicalSale();
    const unrelated = await db.customer.create({
      data: { name: 'Unrelated', phone: '0800000000', nationalId: randomUUID() },
    });
    await db.sale.update({ where: { id: sale.id }, data: { customerId: unrelated.id } });
    await http('post', '/promotions/' + promotion.id + '/apply', seller)
      .send({ saleId: sale.id, customerId })
      .expect(403);
    expect(
      (await http('get', '/promotions/' + promotion.id, seller).expect(200)).body.visibleUsageCount,
    ).toBe(0);
  });
  it('makes canonical benefit and its once-only usage immutable at the database', async () => {
    const { sale } = await canonicalSale();
    const b = await db.salePromotionBenefit.findUniqueOrThrow({ where: { saleId: sale.id } });
    await expect(
      db.salePromotionBenefit.update({ where: { id: b.id }, data: { discountAmount: 999 } }),
    ).rejects.toThrow('immutable');
    await expect(db.salePromotionBenefit.delete({ where: { id: b.id } })).rejects.toThrow(
      'immutable',
    );
    await expect(
      db.promotionUsage.updateMany({ where: { benefitId: b.id }, data: { discountApplied: 999 } }),
    ).rejects.toThrow('immutable');
  });
  it('rejects physical accessory substitution and extra freebies as named evidence', async () => {
    const p = await product(),
      accessory = await product({ category: 'ACCESSORY', costPrice: 100 }),
      other = await product({ category: 'ACCESSORY', costPrice: 100 });
    const promotion = await promo({
      type: 'FREE_ACCESSORY',
      discountValue: null,
      conditions: { accessoryProductIds: [accessory.id] },
    });
    for (const bundleProductIds of [[other.id], [accessory.id, other.id], []])
      await http('post', '/sales', seller)
        .send(saleBody(p.id, promotion.id, { bundleProductIds }))
        .expect(400);
  });
});

/** Wait for the real second DB connection to block, then commit a competing current edit. */
async function waitingRequest(
  lock: (tx: Prisma.TransactionClient) => Promise<unknown>,
  start: () => PromiseLike<request.Response>,
) {
  let release!: () => void, locked!: () => void;
  const held = new Promise<void>((r) => {
      locked = r;
    }),
    gate = new Promise<void>((r) => {
      release = r;
    });
  const holder = db.$transaction(
    async (tx) => {
      await lock(tx);
      locked();
      await gate;
    },
    { timeout: 15000 },
  );
  await held;
  const pending = Promise.resolve(start());
  try {
    let waiting = false;
    for (let i = 0; i < 100; i++) {
      const rows = await db.$queryRaw<
        { count: bigint }[]
      >`SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query NOT LIKE '%pg_stat_activity%'`;
      if (Number(rows[0].count) > 0) {
        waiting = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(waiting).toBe(true);
  } finally {
    release();
    await holder;
  }
  return pending;
}
describe('Current definition/source after a database lock wait', () => {
  it.each(['inactive', 'expiry', 'cap', 'conditions'])(
    'rejects current %s after concurrent configuration edit',
    async (change) => {
      const p = await product(),
        promotion = await promo();
      const res = await waitingRequest(
        async (tx) => {
          await tx.promotion.update({
            where: { id: promotion.id },
            data:
              change === 'inactive'
                ? { isActive: false }
                : change === 'expiry'
                  ? { endDate: new Date('2020-01-01') }
                  : change === 'cap'
                    ? { maxUsageCount: 1, currentUsageCount: 1 }
                    : { conditions: { minPurchase: 20000 } },
          });
        },
        () => http('post', '/sales', seller).send(saleBody(p.id, promotion.id)),
      );
      expect(res.status).toBe(400);
      expect(await db.sale.count({ where: { productId: p.id } })).toBe(0);
    },
  );
  it('rejects a customer deleted while the sale waits for its lock', async () => {
    const c = await db.customer.create({
      data: { name: 'Current source buyer', phone: '0800000000', nationalId: randomUUID() },
    });
    await db.tradeIn.create({
      data: { customerId: c.id, branchId, deviceBrand: 'Apple', deviceModel: 'Evidence' },
    });
    const p = await product(),
      promotion = await promo();
    const res = await waitingRequest(
      async (tx) => {
        await tx.customer.update({ where: { id: c.id }, data: { deletedAt: new Date() } });
      },
      () => http('post', '/sales', seller).send(saleBody(p.id, promotion.id, { customerId: c.id })),
    );
    expect(res.status).toBe(403);
    expect(await db.sale.count({ where: { productId: p.id } })).toBe(0);
  });
  it('rejects a product moved after the original selection', async () => {
    const p = await product(),
      promotion = await promo();
    const res = await waitingRequest(
      async (tx) => {
        await tx.product.update({ where: { id: p.id }, data: { branchId: otherBranch } });
      },
      () => http('post', '/sales', seller).send(saleBody(p.id, promotion.id)),
    );
    expect(res.status).toBe(403);
    expect(await db.sale.count({ where: { productId: p.id } })).toBe(0);
  });
});

import { TradeInCreditService } from '../trade-in/services/trade-in-credit.service';
describe('Canonical finite money and campaign contracts', () => {
  it.each(['CASH', 'EXTERNAL_FINANCE'])(
    'supports rounded percentage and exact accessory benefit for %s',
    async (saleType) => {
      const input =
        saleType === 'CASH'
          ? {}
          : { saleType, sellingPrice: 12000, downPayment: 2000, financeCompany: 'Owned' };
      const first = await canonicalSale(
        input,
        {},
        { type: 'PERCENTAGE_DISCOUNT', discountValue: 12.34 },
      );
      expect(first.sale.discount.toString()).toBe(saleType === 'CASH' ? '1234' : '1480.8');
      const accessory = await product({ category: 'ACCESSORY', costPrice: 100, cashPrice: 200 });
      const second = await canonicalSale(
        { ...input, bundleProductIds: [accessory.id] },
        {},
        {
          type: 'FREE_ACCESSORY',
          discountValue: null,
          conditions: { accessoryProductIds: [accessory.id] },
        },
      );
      expect(second.sale.discount.toString()).toBe('0');
      expect(
        (await db.salePromotionBenefit.findUniqueOrThrow({ where: { saleId: second.sale.id } }))
          .accessoryProductIds,
      ).toEqual([accessory.id]);
    },
  );
  it('rounds a percentage to satang and evaluates all conditions conjunctively', async () => {
    const p = await product({ cashPrice: 100.05, costPrice: 50 }),
      promotion = await promo({
        type: 'PERCENTAGE_DISCOUNT',
        discountValue: 12.5,
        conditions: { minPurchase: 100, productIds: [p.id], categories: ['PHONE_NEW'] },
      });
    const res = await http('post', '/sales', seller)
      .send(saleBody(p.id, promotion.id, { sellingPrice: 100.05 }))
      .expect(201);
    const sale = await db.sale.findUniqueOrThrow({ where: { id: res.body.id } });
    expect(sale.discount.toString()).toBe('12.51');
    expect(sale.netAmount.toString()).toBe('87.54');
  });
  it('keeps loyalty, trade-in quote/requote/claim, named amount and tenders consistent', async () => {
    const c = await db.customer.create({
      data: {
        name: 'Credit buyer',
        phone: '0800000000',
        nationalId: randomUUID(),
        loyaltyBalance: 100,
      },
    });
    const credit = await db.tradeIn.create({
      data: {
        customerId: c.id,
        branchId,
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
    await grant(seller, ['trade-in.read']);
    const { sale } = await canonicalSale({
      customerId: c.id,
      tradeInCreditId: credit.id,
      loyaltyPointsRedeemed: 50,
      amountReceived: 8750,
    });
    expect(sale.discount.toString()).toBe('250');
    expect(sale.netAmount.toString()).toBe('9750');
    expect(sale.tradeInCreditSnapshot).toMatchObject({
      baseAmount: '1000.00',
      bonusAmount: '100.00',
      cashDownAmount: '8750.00',
      totalDownAmount: '9750.00',
    });
    expect((await db.customer.findUniqueOrThrow({ where: { id: c.id } })).loyaltyBalance).toBe(50);
    expect(
      (
        await db.salePromotionBenefit.findUniqueOrThrow({ where: { saleId: sale.id } })
      ).discountAmount.toString(),
    ).toBe('100');
  });
  it('keeps historical unsupported conditions visible with explicit support state', async () => {
    const legacy = await promo({ conditions: 'old prose' }),
      rate = await promo({
        type: 'SPECIAL_RATE',
        discountValue: null,
        specialInterestRate: 0.0123,
      });
    expect((await http('get', '/promotions/' + legacy.id).expect(200)).body.status).toBe(
      'UNSUPPORTED_CONDITIONS',
    );
    expect((await http('get', '/promotions/' + rate.id).expect(200)).body.status).toBe(
      'CONTRACT_FLOW_REQUIRED',
    );
  });
  it.each([
    { discountValue: -1 },
    { type: 'PERCENTAGE_DISCOUNT', discountValue: 101 },
    { maxUsageCount: 0 },
    { maxUsageCount: -1 },
    { endDate: '2019-01-01T00:00:00Z' },
    { conditions: [] },
    { conditions: { categories: ['unknown'] } },
    { conditions: { productIds: [] } },
    { type: 'SPECIAL_RATE', discountValue: 100, specialInterestRate: 0.01 },
  ])('rejects invalid owner configuration %j', async (extra) => {
    await http('post', '/promotions', owner)
      .send({ ...definition(), ...extra })
      .expect(400);
  });
  it('rejects invalid merged edit and keeps its original owner definition', async () => {
    const p = await promo();
    await http('patch', '/promotions/' + p.id, owner)
      .send({ type: 'PERCENTAGE_DISCOUNT', discountValue: 101 })
      .expect(400);
    expect((await db.promotion.findUniqueOrThrow({ where: { id: p.id } })).type).toBe(
      'FIXED_DISCOUNT',
    );
  });
  it('rejects fixed discount exceeding current baseline without clamping', async () => {
    const p = await product(),
      promotion = await promo({ discountValue: 10001 });
    await http('post', '/sales', seller).send(saleBody(p.id, promotion.id)).expect(400);
    expect(await db.sale.count({ where: { productId: p.id } })).toBe(0);
  });
});

it('accepts explicit null conditions/cap and finite SPECIAL_RATE owner config without cash execution credit', async () => {
  const res = await http('post', '/promotions', owner)
    .send({
      ...definition(),
      conditions: null,
      maxUsageCount: null,
      type: 'SPECIAL_RATE',
      discountValue: null,
      specialInterestRate: 0,
    })
    .expect(201);
  expect(res.body.status).toBe('CONTRACT_FLOW_REQUIRED');
  expect(
    (await db.promotion.findUniqueOrThrow({ where: { id: res.body.id } })).conditions,
  ).toBeNull();
  await http('patch', '/promotions/' + res.body.id, owner)
    .send({
      type: 'FIXED_DISCOUNT',
      discountValue: 100,
      specialInterestRate: null,
      conditions: null,
    })
    .expect(200);
});

it.each(['CASH', 'EXTERNAL_FINANCE'])(
  'uses unambiguous current canonical label fallback for %s',
  async (saleType) => {
    const p = await product({ cashPrice: null, installmentPrice: null }),
      promotion = await promo();
    const row = await db.productPrice.create({
      data: {
        productId: p.id,
        label: saleType === 'CASH' ? 'ราคาเงินสด' : 'ราคาผ่อน รุ่นเดิม',
        amount: 9000,
      },
    });
    if (saleType === 'CASH')
      await db.productPrice.create({
        data: { productId: p.id, label: 'ราคาเงินสด เดิม', amount: 8000 },
      });
    const extra =
      saleType === 'CASH' ? {} : { saleType, downPayment: 1000, financeCompany: 'Owned' };
    const res = await http('post', '/sales', seller)
      .send(saleBody(p.id, promotion.id, { sellingPrice: 9000, ...extra }))
      .expect(201);
    expect(
      (await db.salePromotionBenefit.findUniqueOrThrow({ where: { saleId: res.body.id } }))
        .baselineSource,
    ).toBe('price:' + row.id);
  },
);
it('uses cash fallback when external finance has no positive installment price', async () => {
  const { sale } = await canonicalSale(
    { saleType: 'EXTERNAL_FINANCE', downPayment: 1000, financeCompany: 'Owned' },
    { installmentPrice: null },
  );
  expect(
    (await db.salePromotionBenefit.findUniqueOrThrow({ where: { saleId: sale.id } }))
      .baselineSource,
  ).toBe('column:cashPrice');
});

it('retains separate public active/quota-safe projection', async () => {
  const active = await promo(),
    exhausted = await promo({ maxUsageCount: 1, currentUsageCount: 1 });
  const publicRows = await app.get(PromotionsService).findActivePublic();
  expect(publicRows.some((p) => p.id === active.id)).toBe(true);
  expect(publicRows.some((p) => p.id === exhausted.id)).toBe(false);
  const row = publicRows.find((p) => p.id === active.id)!;
  expect(row).not.toHaveProperty('currentUsageCount');
  expect(row).not.toHaveProperty('visibleUsageCount');
  expect(row).not.toHaveProperty('maxUsageCount');
});
it('reserves live SHOP configuration and does not infer owner from a forged owner-only grant', async () => {
  const actor = await staff();
  await grant(actor, ['promotions.manage']);
  await http('post', '/promotions', actor).send(definition()).expect(403);
  await request(app.getHttpServer())
    .get('/promotions?company=FINANCE')
    .set('x-test-user', seller)
    .expect('x-owned-promotion-app', marker)
    .expect(403);
  await db.companyInfo.update({ where: { id: shopId }, data: { isActive: false } });
  try {
    await http('get', '/promotions', owner).expect(403);
    await http('post', '/promotions', owner).send(definition()).expect(403);
  } finally {
    await db.companyInfo.update({ where: { id: shopId }, data: { isActive: true } });
  }
});
it('rolls owner configuration back if its required audit fails', async () => {
  const p = await promo();
  await db.$executeRawUnsafe(
    `CREATE FUNCTION owned_fail_config_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action = 'PROMOTION_UPDATED' THEN RAISE EXCEPTION 'owned config audit failure'; END IF; RETURN NEW; END $$`,
  );
  await db.$executeRawUnsafe(
    `CREATE TRIGGER owned_fail_config_audit BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION owned_fail_config_audit()`,
  );
  try {
    await http('patch', '/promotions/' + p.id, owner)
      .send({ discountValue: 999 })
      .expect(500);
  } finally {
    await db.$executeRawUnsafe('DROP TRIGGER owned_fail_config_audit ON audit_logs');
    await db.$executeRawUnsafe('DROP FUNCTION owned_fail_config_audit()');
  }
  expect(
    (await db.promotion.findUniqueOrThrow({ where: { id: p.id } })).discountValue?.toString(),
  ).toBe('100');
});

it('does not count the main sold accessory as its own free physical gift', async () => {
  const p = await product({ category: 'ACCESSORY' }),
    promotion = await promo({
      type: 'FREE_ACCESSORY',
      discountValue: null,
      conditions: { accessoryProductIds: [p.id] },
    });
  await http('post', '/sales', seller)
    .send(saleBody(p.id, promotion.id, { bundleProductIds: [p.id] }))
    .expect(400);
  expect(await db.sale.count({ where: { productId: p.id } })).toBe(0);
});
