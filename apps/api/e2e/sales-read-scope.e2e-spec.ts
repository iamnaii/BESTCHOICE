import { ShopDownPaymentTemplate } from '../src/modules/journal/cpa-templates/shop-down-payment.template';
import { randomUUID } from 'node:crypto';
import { ExecutionContext, INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { SalesController } from '../src/modules/sales/sales.controller';
import { SalesService } from '../src/modules/sales/sales.service';
import { SaleVoidService } from '../src/modules/sales/services/sale-void.service';
import { InterCompanyService } from '../src/modules/inter-company/inter-company.service';
import { ShopCashSaleTemplate } from '../src/modules/journal/cpa-templates/shop-cash-sale.template';
import { ShopAccountResolver } from '../src/modules/journal/shop-account-resolver.service';
import { ShopExternalFinanceSaleTemplate } from '../src/modules/journal/cpa-templates/shop-external-finance-sale.template';
import { SaleWarrantyNotifierService } from '../src/modules/sales/services/sale-warranty-notifier.service';
import { JwtAuthGuard } from '../src/modules/auth/guards/jwt-auth.guard';
import { RolesGuard } from '../src/modules/auth/guards/roles.guard';
import { BranchGuard } from '../src/modules/auth/guards/branch.guard';
import { EntityScopeInterceptor } from '../src/interceptors/entity-scope.interceptor';
import { maskNationalId } from '../src/utils/pii.util';

if (!process.env.DATABASE_URL?.includes('/bc_chat_credit_test?host=/tmp/bc-chat-credit.')) {
  throw new Error('Run tools/test-chat-credit.sh with its disposable database');
}

describe('Sales read authorization on isolated PostgreSQL', () => {
  const db = new PrismaService();
  const prefix = `ISOLATED-SALES-SCOPE-${randomUUID()}`;
  const nationalId = '7900000000001'; // Synthetic fixture, never a real customer.
  const date = '2026-01-15';
  let app: INestApplication;
  let branchA: string, branchB: string, userA: string, userB: string;
  let saleA: string, saleB: string, voidedA: string, productA: string;
  let actor: { id: string; role: string; branchId: string | null; accessibleCompanies: string[]; primaryCompany: string };
  const read = (path = '', query: Record<string, string | number> = {}) =>
    request(app.getHttpServer()).get(`/sales${path}`).query({ company: 'shop', ...query });

  beforeAll(async () => {
    await db.$connect();
    branchA = (await db.branch.create({ data: { name: `${prefix}-A` } })).id;
    branchB = (await db.branch.create({ data: { name: `${prefix}-B` } })).id;
    const user = (branchId: string, suffix: string) => db.user.create({ data: {
      name: `${prefix}-${suffix}`, email: `${prefix}-${suffix}@example.invalid`, password: 'unused',
      role: 'SALES', branchId, accessibleCompanies: ['SHOP'], primaryCompany: 'SHOP',
    } });
    userA = (await user(branchA, 'A')).id;
    userB = (await user(branchB, 'B')).id;
    const customer = await db.customer.create({ data: { name: prefix, phone: '0800000000', nationalId } });
    const product = (branchId: string, suffix: string) => db.product.create({ data: {
      name: `${prefix}-${suffix}`, brand: 'TEST', model: 'TEST', category: 'PHONE_NEW',
      costPrice: '6000', cashPrice: '10000', branchId, imeiSerial: `${prefix}-${suffix}`,
    } });
    productA = (await product(branchA, 'A')).id;
    const productB = (await product(branchB, 'B')).id;
    const contract = await db.contract.create({ data: {
      contractNumber: `${prefix}-CONTRACT`, customerId: customer.id, productId: productA,
      branchId: branchA, salespersonId: userA, planType: 'STORE_DIRECT', status: 'ACTIVE',
      sellingPrice: '10000', downPayment: '2000', interestRate: '0.01', totalMonths: 6,
      interestTotal: '480', financedAmount: '8000', monthlyPayment: '1413.33',
      customerSnapshot: { nationalId, salary: '30000', address: 'SYNTHETIC PRIVATE SNAPSHOT' },
    } });
    const base = { customerId: customer.id, sellingPrice: '10000', netAmount: '10000',
      paymentMethod: 'CASH' as const, amountReceived: '10000', createdAt: new Date(`${date}T05:00:00Z`) };
    saleA = (await db.sale.create({ data: { ...base, saleNumber: `${prefix}-A`, saleType: 'INSTALLMENT',
      productId: productA, branchId: branchA, salespersonId: userA, contractId: contract.id } })).id;
    saleB = (await db.sale.create({ data: { ...base, saleNumber: `${prefix}-B`, saleType: 'CASH',
      productId: productB, branchId: branchB, salespersonId: userB } })).id;
    voidedA = (await db.sale.create({ data: { ...base, saleNumber: `${prefix}-VOID`, saleType: 'CASH',
      productId: productA, branchId: branchA, salespersonId: userA, deletedAt: new Date(),
      voidReason: 'SYNTHETIC VOID', voidedById: userA } })).id;

    const module = await Test.createTestingModule({
      controllers: [SalesController],
      providers: [SalesService, RolesGuard, BranchGuard, { provide: PrismaService, useValue: db },
        ...[SaleVoidService, InterCompanyService, ShopCashSaleTemplate, ShopAccountResolver,
          ShopExternalFinanceSaleTemplate, ShopDownPaymentTemplate, SaleWarrantyNotifierService].map(provide => ({ provide, useValue: {} })),
      ],
    }).overrideGuard(JwtAuthGuard).useValue({ canActivate: (context: ExecutionContext) => {
      context.switchToHttp().getRequest().user = actor;
      return true;
    } }).compile();
    app = module.createNestApplication({ logger: false });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.useGlobalInterceptors(new EntityScopeInterceptor());
    // Bind the same IPv4 destination Supertest uses; Darwin permits a different IPv6 server on the same port.
    await app.listen(0, '127.0.0.1');
  });
  beforeEach(() => { actor = { id: userA, role: 'SALES', branchId: branchA,
    accessibleCompanies: ['SHOP'], primaryCompany: 'SHOP' }; });
  afterAll(async () => {
    // These deliberately named read fixtures must not enter another suite's
    // production sale-number sequence (the harness shares one disposable DB).
    await db.sale.deleteMany({ where: { saleNumber: { startsWith: prefix } } });
    await app?.close();
    await db.$disconnect();
  });

  it.each(['SALES', 'BRANCH_MANAGER'])('%s scopes list, counts and totals when branchId is omitted', async role => {
    actor.role = role;
    const response = await read('', { search: prefix }).expect(200);
    expect(response.body.data.map((row: { id: string }) => row.id)).toEqual([saleA]);
    expect(response.body.total).toBe(1);
    expect(response.body.summary.totalAmount).toBe(10000);
    expect(response.body.summary.cashCount).toBe(0);
  });
  it('keeps a foreign sale inaccessible even through its ID or includeVoided', async () => {
    await read(`/${saleB}`).expect(404);
    await read('', { search: prefix, branchId: branchB }).expect(403);
    const response = await read('', { search: prefix, includeVoided: 'true' }).expect(200);
    expect(response.body.data.map((row: { id: string }) => row.id).sort()).toEqual([saleA, voidedA].sort());
  });
  it.each(['SALES', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT'])('%s cannot read product cost from detail or list', async role => {
    actor.role = role;
    const detail = await read(`/${saleA}`).expect(200);
    const list = await read('', { search: prefix }).expect(200);
    expect(detail.body.product).not.toHaveProperty('costPrice');
    for (const row of list.body.data) expect(row.product).not.toHaveProperty('costPrice');
    expect(list.body.summary.totalProfit).toBe(0);
    expect(detail.body.contract).not.toHaveProperty('customerSnapshot');
  });
  it('masks the national ID for SALES and keeps the necessary contract link', async () => {
    const response = await read(`/${saleA}`).expect(200);
    expect(response.body.customer.nationalId).toBe(maskNationalId(nationalId));
    expect(response.body.contract).toMatchObject({ contractNumber: `${prefix}-CONTRACT`, totalMonths: 6 });
    expect(JSON.stringify(response.body)).not.toContain('SYNTHETIC PRIVATE SNAPSHOT');
  });
  it('OWNER retains cost access and can explicitly compare branches', async () => {
    actor.role = 'OWNER'; actor.branchId = null;
    const detail = await read(`/${saleA}`).expect(200);
    expect(detail.body.product.costPrice).toBe('6000');
    expect(detail.body.customer.nationalId).toBe(nationalId);
    const list = await read('', { search: prefix, branchId: branchB }).expect(200);
    expect(list.body.data.map((row: { id: string }) => row.id)).toEqual([saleB]);
  });
  it.each(['OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT'])('%s retains cross-branch reads', async role => {
    actor.role = role; actor.branchId = null;
    const list = await read('', { search: prefix }).expect(200);
    expect(list.body.data.map((row: { id: string }) => row.id).sort()).toEqual([saleA, saleB].sort());
    await read(`/${saleB}`).expect(200);
  });
  it('branchless branch-scoped actors receive no rows, summaries or suggestions', async () => {
    actor.role = 'BRANCH_MANAGER'; actor.branchId = null;
    const list = await read('', { search: prefix }).expect(200);
    expect(list.body.data).toEqual([]); expect(list.body.total).toBe(0);
    expect(list.body.summary.totalAmount).toBe(0);
    await read(`/${saleA}`).expect(404);
    expect((await read('/top-products').expect(200)).body).toEqual([]);
    expect((await read('/salespersons').expect(200)).body).toEqual([]);
    const daily = await read('/daily-summary', { date }).expect(200);
    expect(daily.body.totalSales).toBe(0); expect(daily.body.totalRevenue).toBe(0);
  });
  it('daily summaries, top products and salesperson suggestions stay in branch', async () => {
    actor.role = 'BRANCH_MANAGER';
    const daily = await read('/daily-summary', { date }).expect(200);
    expect(daily.body.sales.map((row: { id: string }) => row.id)).toEqual([saleA]);
    expect(daily.body.totalRevenue).toBe(10000);
    expect((await read('/top-products').expect(200)).body).toEqual([
      expect.objectContaining({ id: productA, count: 1 }),
    ]);
    const people = await read('/salespersons').expect(200);
    expect(people.body.map((row: { id: string }) => row.id)).toEqual([userA]);
  });
  it('keeps voided detail visible with its original cancellation metadata', async () => {
    const response = await read(`/${voidedA}`).expect(200);
    expect(response.body.deletedAt).toBeTruthy();
    expect(response.body.voidReason).toBe('SYNTHETIC VOID');
    expect(response.body.voidedBy.id).toBe(userA);
  });
  it('preserves company grants and endpoint roles', async () => {
    await read('', { company: 'finance' }).expect(403);
    await read('/daily-summary', { date }).expect(403);
    await read('/salespersons').expect(403);
  });
});
