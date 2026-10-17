import { readExportSnapshot } from '../../common/helpers/export-snapshot';
import { encryptPII } from '../../utils/crypto.util';
import { outstandingOf } from '../contracts/contract-outstanding';
import { PartyQueryPlan } from './access-party-query-plan';
import { PARTY_DERIVED_ROUTES } from './access-party-boundaries';
import { ACCESS_BOUNDARIES, ACCESS_POLICIES } from './access-policy.registry';
import { AccessProcurementSourceService } from './access-procurement-source.service';
import { AccessPartyBoundaries } from './access-party-boundaries';
import { AccessPartySourceService } from './access-party-source.service';
import { CustomerPurchaseSummaryService } from '../customers/services/customer-purchase-summary.service';
import { CustomerChatRoomsService } from '../customers/services/customer-chat-rooms.service';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { Test } from '@nestjs/testing';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { ExecutionContext, INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { PermissionKey } from '@installment/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AccessSnapshotService } from './access-snapshot.service';
import { AccessResourceService } from './access-resource.service';
import { AccessPolicyService } from './access-policy';
import { AccessPolicyInterceptor } from './access-policy.interceptor';
import { CustomersController } from '../customers/customers.controller';
import { CustomersService } from '../customers/customers.service';
import { CustomerWriteService } from '../customers/services/customer-write.service';
import { CustomerQueryService } from '../customers/services/customer-query.service';
import { CustomerAnalyticsService } from '../customers/services/customer-analytics.service';
import { CustomerTierService } from '../customers/customer-tier.service';
import { SkipTracingService } from '../customers/skip-tracing.service';
import { CustomerInsightsService } from '../overdue/customer-insights.service';
import { CustomerMergeService } from '../chat-prospects/customer-merge.service';
import { PiiAuditService } from '../pii/pii-audit.service';
import { CustomerPiiService } from '../customers/customer-pii.service';
import { ContactsController } from '../contacts/contacts.controller';
import { ContactsService } from '../contacts/contacts.service';
import { ContactResolverService } from '../contacts/contact-resolver.service';
import { AuditService } from '../audit/audit.service';
import { JourneyEntryWriter } from '../customer-journey/journey-entry-writer.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { BranchGuard } from '../auth/guards/branch.guard';
const url = process.env.EMPLOYEE_ACCESS_TEST_DATABASE_URL;
if (!url?.includes('/bc_access_task2?host=/tmp/bc-access-parties.'))
  throw new Error('Owned isolated database required');
const db = new PrismaClient({
  datasources: { db: { url } },
  log: [{ emit: 'event', level: 'query' }],
});
let capturedQueries: string[] | undefined;
db.$on('query', (event) => capturedQueries?.push(event.query));
const testRun = randomUUID();
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
    .expect('x-owned-derived-app', testRun)
    .on('response', (response) => {
      if (response.headers['x-owned-derived-app'] !== testRun)
        console.error(
          'OWNED_HTTP_MARKER_MISMATCH',
          JSON.stringify({
            status: response.status,
            marker: response.headers['x-owned-derived-app'] ?? null,
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
  branchA = (await db.branch.create({ data: { name: 'A', companyId: shop.id } })).id;
  branchB = (await db.branch.create({ data: { name: 'B', companyId: shop.id } })).id;
  actor = await user();
  denied = await user();
  await grant(actor, [
    'customers.read',
    'customers.create',
    'customers.update',
    'customers.delete',
    'contacts.read',
    'contacts.update',
    'suppliers.read',
    'suppliers.create',
  ]);
  const module = await Test.createTestingModule({
    controllers: [CustomersController, ContactsController],
    providers: [
      AccessPartyBoundaries,
      AccessPartySourceService,
      AccessProcurementSourceService,
      AccessResourceService,
      AccessPolicyService,
      { provide: PrismaService, useValue: db },
      { provide: AccessSnapshotService, useValue: snapshots },
      CustomersService,
      CustomerWriteService,
      CustomerPiiService,
      CustomerQueryService,
      CustomerTierService,
      CustomerAnalyticsService,
      CustomerInsightsService,
      CustomerPurchaseSummaryService,
      CustomerChatRoomsService,
      PiiAuditService,
      ContactsService,
      ContactResolverService,
      AuditService,
      JourneyEntryWriter,
      ...[SkipTracingService, CustomerMergeService].map((provide) => ({ provide, useValue: {} })),
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
      res.setHeader('x-owned-derived-app', testRun);
      next();
    },
  );
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
  // Bind IPv4 explicitly once. Supertest's auto-listen uses an unspecified host
  // but connects127.0.0.1; a response without our marker was reproduced locally.
  await app.listen(0, '127.0.0.1');
}, 60000);
afterAll(async () => {
  await app?.close();
  await db.$disconnect();
});

async function reader(
  permissions: PermissionKey[],
  company = 'SHOP',
  branches?: string[],
  assigned = false,
) {
  const id = await user();
  await grant(id, permissions, company, branches, assigned ? 'ASSIGNED' : undefined);
  return id;
}
async function customer(extra: object = {}) {
  return db.customer.create({
    data: {
      name: 'Scoped ' + randomUUID(),
      accessCompanyCode: 'SHOP',
      accessBranchId: branchA,
      ...extra,
    },
  });
}
async function contract(customerId: string, branchId = branchA, extra: object = {}) {
  const product = await db.product.create({
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
      customerId,
      productId: product.id,
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
      ...extra,
    },
  });
}

let queryCustomer: string;
beforeAll(async () => {
  queryCustomer = (await customer({ name: 'Derived Visible' })).id;
  await grant(actor, ['customers.export']);
});
const derivedRoutes = [
  ['exportRows', () => '/customers/export?view=prospects&search=Derived%20Visible'],
  ['getChatSummary', () => `/customers/${queryCustomer}/chat-summary`],
  ['getContracts', () => `/customers/${queryCustomer}/contracts`],
  ['getInsights', () => `/customers/${queryCustomer}/insights`],
  ['getReferrals', () => `/customers/${queryCustomer}/referrals`],
  ['getReferralStats', () => '/customers/referral-stats'],
  ['getRiskFlag', () => `/customers/${queryCustomer}/risk-flag`],
  ['getSummary', () => `/customers/${queryCustomer}/summary`],
  ['getTier', () => `/customers/${queryCustomer}/tier`],
  ['getUpsellCandidates', () => '/customers/upsell-candidates'],
  ['getWatchList', () => '/customers/watch-list'],
] as const;
it.each(derivedRoutes)(
  '%s allows an independently authorized current customer through actual HTTP',
  async (_name, path) => {
    await http('get', path()).expect(200);
  },
);
it.each(derivedRoutes)('%s denies no grants through actual HTTP', async (_name, path) => {
  expect((await snapshots.forUser(denied)).grants).toHaveLength(0);
  await http('get', path(), undefined, denied).expect(403);
});
async function payment(contractId: string, no: number, extra: object = {}) {
  return db.payment.create({
    data: {
      contractId,
      installmentNo: no,
      dueDate: new Date('2026-01-01'),
      amountDue: 1000,
      ...extra,
    },
  });
}
it('canonical arithmetic regression uses actual persisted installments and receipts', async () => {
  const c = await customer();
  const ct = await contract(c.id);
  await payment(ct.id, 1, { status: 'PAID', amountPaid: 1000, paidDate: new Date('2026-01-02') });
  await payment(ct.id, 2, { status: 'PENDING', dueDate: new Date('2026-02-01'), amountDue: 900 });
  await payment(ct.id, 3, { status: 'PENDING', dueDate: new Date('2026-03-01'), amountDue: 300 });
  const partial = await payment(ct.id, 4, {
    status: 'PARTIALLY_PAID',
    amountDue: 1000,
    amountPaid: 400,
    waivedAmount: 100,
  });
  const analytics = new CustomerAnalyticsService(
    db as PrismaService,
    { findOne: async () => c } as unknown as CustomerQueryService,
  );
  const watch = await analytics.getWatchList(branchA, 100);
  const row = watch.watchList.find((r) => r.contractId === ct.id)!;
  expect(row.latePaymentCount).toBe(1);
  expect(row.paidCount).toBe(1);
  expect(row.partialPaymentCount).toBe(1);
  expect(Number(row.nextAmountDue)).toBe(900);
  for (let i = 0; i < 31; i++)
    await db.receipt.create({
      data: {
        receiptNumber: randomUUID(),
        contractId: ct.id,
        paymentId: partial.id,
        payerName: 'Synthetic',
        receiverName: 'Synthetic',
        amount: 10,
        paidDate: new Date(2026, 0, 1, 0, i),
        issuedById: actor,
      },
    });
  const chat = await analytics.getChatSummary(c.id);
  expect(chat.recentPayments[0].partials).toHaveLength(31);
  expect(Number(chat.totalOutstanding)).toBe(1800);
  const summary = await app.get(CustomerQueryService).getSummary(c.id);
  expect(summary.totalOutstandingThb).toBe(1800);
  expect(
    outstandingOf([
      { amountDue: 900, amountPaid: 0 },
      { amountDue: 300, amountPaid: 0 },
      { amountDue: 1000, amountPaid: 400 },
    ]),
  ).toBe(1800);
});

it('keeps missing sources null and hidden contributions cannot alter availability or risk', async () => {
  const id = await reader(['customers.read'], 'SHOP', [branchA]);
  await grant(id, ['payments.read', 'collections.read', 'receipts.read'], 'FINANCE', [branchA]);
  const c = await customer();
  const paths = ['summary', 'risk-flag', 'tier', 'chat-summary', 'insights'];
  const before = await Promise.all(
    paths.map(
      async (path) =>
        (await http('get', `/customers/${c.id}/${path}`, undefined, id).expect(200)).body,
    ),
  );
  expect(before[0]).toMatchObject({
    activeContracts: null,
    overdueCount: null,
    totalOutstandingThb: null,
  });
  expect(before[1]).toMatchObject({ hasRisk: null, riskLevel: null });
  expect(before[2]).toMatchObject({ tier: null, history: null, availability: 'unavailable' });
  const hidden = await contract(c.id, branchB, { status: 'DEFAULT' });
  await payment(hidden.id, 1, { status: 'OVERDUE', amountDue: 99999 });
  for (let i = 0; i < paths.length; i++)
    expect(
      (await http('get', `/customers/${c.id}/${paths[i]}`, undefined, id).expect(200)).body,
    ).toEqual(before[i]);
});
it('scopes contracts, payment counts, balances, risk and current Product independently', async () => {
  const id = await reader(['customers.read'], 'SHOP', [branchA]);
  await grant(id, ['contracts.read'], 'FINANCE', [branchA]);
  await grant(id, ['payments.read', 'products.read'], 'FINANCE', [branchB]);
  const c = await customer();
  const visible = await contract(c.id);
  const hidden = await contract(c.id, branchB, { status: 'DEFAULT' });
  await payment(visible.id, 1, { status: 'PARTIALLY_PAID', amountPaid: 200 });
  await payment(hidden.id, 1, { status: 'OVERDUE', amountDue: 99999 });
  let rows = (await http('get', `/customers/${c.id}/contracts`, undefined, id).expect(200)).body
    .contracts;
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ id: visible.id, product: null, _count: { payments: null } });
  expect(rows[0]).not.toHaveProperty('costPrice');
  expect(rows[0]).not.toHaveProperty('inputVatAmount');
  const risk = (await http('get', `/customers/${c.id}/risk-flag`, undefined, id).expect(200)).body;
  expect(risk).toMatchObject({ hasRisk: false, riskLevel: 'NONE' });
  await grant(id, ['payments.read'], 'FINANCE', [branchA]);
  await grant(id, ['products.read'], 'SHOP', [branchA]);
  rows = (await http('get', `/customers/${c.id}/contracts`, undefined, id).expect(200)).body
    .contracts;
  expect(rows[0]).toMatchObject({ product: { id: visible.productId }, _count: { payments: 1 } });
  expect(
    (await http('get', `/customers/${c.id}/summary`, undefined, id).expect(200)).body
      .totalOutstandingThb,
  ).toBe(800);
  await db.product.update({ where: { id: visible.productId }, data: { deletedAt: new Date() } });
  expect(
    (await http('get', `/customers/${c.id}/contracts`, undefined, id).expect(200)).body.contracts[0]
      .product,
  ).toBeNull();
});
it('scopes both referral identities before counts and ranking and never follows Contact aliases', async () => {
  const id = await reader(['customers.read'], 'SHOP', [branchA]);
  const ref = await customer({ name: 'Referral visible' });
  const hidden = await customer({ name: 'Referral hidden', accessBranchId: branchB });
  await customer({ referredById: ref.id });
  for (let i = 0; i < 3; i++) await customer({ referredById: hidden.id, accessBranchId: branchB });
  await customer({ referredById: ref.id, accessBranchId: branchB });
  const stats = (await http('get', '/customers/referral-stats?limit=1', undefined, id).expect(200))
    .body;
  expect(stats.topReferrers).toEqual([
    { referrerId: ref.id, referrerName: 'Referral visible', referrerPhone: null, referralCount: 1 },
  ]);
  const referrals = (await http('get', `/customers/${ref.id}/referrals`, undefined, id).expect(200))
    .body;
  expect(referrals.total).toBe(1);
  expect(referrals.referrals[0]).toMatchObject({ contractCount: null, hasActiveContract: null });
  const alias = await db.contact.create({
    data: {
      contactCode: randomUUID(),
      name: 'Alias',
      roles: ['CUSTOMER'],
      accessCompanyCode: 'SHOP',
      accessBranchId: branchA,
    },
  });
  const inaccessible = await customer({ contactId: alias.id, accessBranchId: branchB });
  await grant(id, ['contacts.read'], 'SHOP', [branchA]);
  await http('get', `/customers/${inaccessible.id}/risk-flag`, undefined, id).expect(403);
});
it('scopes upsell and watch before rank/limit, preserves ratio and independently hides current products', async () => {
  const id = await reader(['customers.read'], 'SHOP', [branchA]);
  await grant(id, ['contracts.read', 'payments.read', 'collections.read'], 'FINANCE', [branchA]);
  const c = await customer();
  const con = await contract(c.id);
  for (let i = 1; i <= 7; i++)
    await payment(con.id, i, {
      status: 'PAID',
      amountPaid: 1000,
      paidDate: new Date('2026-01-03'),
    });
  const hidden = await contract(c.id, branchB, { status: 'COMPLETED' });
  for (let i = 1; i <= 10; i++)
    await payment(hidden.id, i, {
      status: 'PAID',
      amountPaid: 1000,
      paidDate: new Date('2026-01-03'),
    });
  const upsell = (
    await http('get', '/customers/upsell-candidates?limit=1', undefined, id).expect(200)
  ).body;
  expect(upsell.candidates[0]).toMatchObject({
    contractId: con.id,
    paidRatio: 0.7,
    paidCount: 7,
    productModel: null,
    hasExchangeHistory: false,
  });
  const watch = (await http('get', '/customers/watch-list?limit=1', undefined, id).expect(200))
    .body;
  expect(watch.watchList[0]).toMatchObject({
    contractId: con.id,
    latePaymentCount: 7,
    paidCount: 7,
  });
  const noPayments = await reader(['customers.read'], 'SHOP', [branchA]);
  await grant(noPayments, ['contracts.read', 'collections.read'], 'FINANCE', [branchA]);
  const unavailable = (
    await http('get', '/customers/upsell-candidates', undefined, noPayments).expect(200)
  ).body;
  expect(unavailable.candidates).toEqual([]);
  expect(unavailable.availability.payments).toBe('unavailable');
});
async function receipt(contractId: string, paymentId: string, paidDate = new Date()) {
  return db.receipt.create({
    data: {
      receiptNumber: randomUUID(),
      contractId,
      paymentId,
      payerName: 'Synthetic',
      receiverName: 'Synthetic',
      amount: 10,
      paidDate,
      issuedById: actor,
    },
  });
}
it('requires receipts independently and validates real backlinks before latest-five grouping', async () => {
  const id = await reader(['customers.read'], 'SHOP', [branchA]);
  await grant(id, ['contracts.read', 'payments.read'], 'FINANCE', [branchA]);
  const c = await customer();
  const con = await contract(c.id);
  const p = await payment(con.id, 1);
  for (let i = 0; i < 31; i++) await receipt(con.id, p.id, new Date(2026, 0, 1, 0, i));
  const other = await contract((await customer()).id);
  const wrong = await payment(other.id, 1);
  await receipt(con.id, wrong.id, new Date('2099-01-01'));
  const hidden = await contract(c.id, branchB);
  const hp = await payment(hidden.id, 1);
  await receipt(hidden.id, hp.id, new Date('2099-01-01'));
  const path = `/customers/${c.id}/chat-summary`;
  expect((await http('get', path, undefined, id).expect(200)).body.recentPayments).toEqual([]);
  await grant(id, ['receipts.read'], 'FINANCE', [branchA]);
  const result = (await http('get', path, undefined, id).expect(200)).body;
  expect(result.recentPayments).toHaveLength(1);
  expect(result.recentPayments[0]).toMatchObject({ id: p.id });
  expect(result.recentPayments[0].partials).toHaveLength(31);
  expect(result.activeContracts[0]).toMatchObject({ product: null, mdmLockedAt: null });
});
it('scopes call and room sources before limits and permits paired sensitive notes without role fallback', async () => {
  const id = await reader(['customers.read'], 'SHOP', [branchA]);
  await grant(id, ['contracts.read', 'collections.read'], 'FINANCE', [branchA]);
  await grant(id, ['chat.read'], 'FINANCE', undefined, 'ASSIGNED');
  const c = await customer();
  const con = await contract(c.id);
  const hidden = await contract(c.id, branchB);
  const call = await db.callLog.create({
    data: {
      contractId: con.id,
      calledAt: new Date('2026-01-01T03:00:00Z'),
      result: 'ANSWERED',
      callResult: 'ANSWERED',
      notes: '1112223334445 private',
    },
  });
  for (let i = 0; i < 6; i++)
    await db.callLog.create({
      data: {
        contractId: hidden.id,
        calledAt: new Date('2026-02-01T12:00:00Z'),
        result: 'ANSWERED',
        callResult: 'ANSWERED',
        notes: 'hidden',
      },
    });
  const room = await db.chatRoom.create({
    data: {
      customerId: c.id,
      channel: 'LINE_FINANCE',
      assignedToId: id,
      lastMessageAt: new Date('2026-01-01'),
    },
  });
  for (let i = 0; i < 11; i++)
    await db.chatRoom.create({
      data: { customerId: c.id, channel: 'LINE_FINANCE', lastMessageAt: new Date('2099-01-01') },
    });
  const path = `/customers/${c.id}/chat-summary`;
  let result = (await http('get', path, undefined, id).expect(200)).body;
  expect(result.callLogs).toHaveLength(1);
  expect(result.callLogs[0]).toMatchObject({ id: call.id, notes: null });
  expect(result.chatRooms.map((r: { id: string }) => r.id)).toEqual([room.id]);
  expect(
    (await http('get', `/customers/${c.id}/insights`, undefined, id).expect(200)).body,
  ).toMatchObject({ preferredContactTime: 'MORNING', lineOnlineAt: '2026-01-01T00:00:00.000Z' });
  await grant(id, ['documents.read', 'sensitive.customer-identity.read'], 'FINANCE', [branchB]);
  expect((await http('get', path, undefined, id).expect(200)).body.callLogs[0].notes).toBeNull();
  await grant(id, ['documents.read', 'sensitive.customer-identity.read'], 'FINANCE', [branchA]);
  result = (await http('get', path, undefined, id).expect(200)).body;
  expect(result.callLogs[0].notes).toBe('1112223334445 private');
});
it('returns complete tier only with fixed source authority and genuine validated contributors', async () => {
  const id = await reader(['customers.read'], 'SHOP', [branchA]);
  await grant(id, ['contracts.read', 'payments.read', 'repossessions.read'], 'FINANCE');
  const c = await customer();
  const con = await contract(c.id);
  for (let i = 1; i <= 3; i++) await payment(con.id, i, { status: 'PAID', amountPaid: 1000 });
  const result = (await http('get', `/customers/${c.id}/tier`, undefined, id).expect(200)).body;
  expect(result).toMatchObject({
    tier: 'GOOD',
    availability: 'complete',
    history: { onTimePayments: 3 },
  });
});
it('export-only authority works, pairs full ID/search/documents at the exact export source and audits', async () => {
  const id = await reader(['customers.export'], 'SHOP', [branchA]);
  const c = await customer({
    name: 'Export safe',
    nationalId: '1112223334445',
    documents: ['private.pdf'],
  });
  await grant(id, ['sensitive.customer-identity.read', 'documents.read'], 'SHOP', [branchB]);
  const path = '/customers/export?view=prospects&search=Export%20safe';
  let result = (await http('get', path, undefined, id).expect(200)).body;
  expect(result.data).toHaveLength(1);
  expect(result.data[0].nationalId).not.toBe(c.nationalId);
  expect(result.data[0]).not.toHaveProperty('documents');
  expect(
    (
      await http(
        'get',
        '/customers/export?view=prospects&search=1112223334445',
        undefined,
        id,
      ).expect(200)
    ).body.total,
  ).toBe(0);
  await http('get', '/customers', undefined, id).expect(403);
  await grant(id, ['sensitive.customer-identity.read', 'documents.read'], 'SHOP', [branchA]);
  result = (
    await http(
      'get',
      '/customers/export?view=prospects&search=1112223334445',
      undefined,
      id,
    ).expect(200)
  ).body;
  expect(result.data[0].nationalId).toBe(c.nationalId);
  expect(result.total).toBe(1);
  expect(result.asOf).toEqual(expect.any(String));
  expect(
    await db.auditLog.count({ where: { userId: id, entityId: c.id, action: 'PII_DECRYPT_FULL' } }),
  ).toBeGreaterThan(0);
});
it('captures actual owned child SQL and export joins the one snapshot without READ ONLY', async () => {
  const id = await reader(['customers.export'], 'SHOP', [branchA]);
  capturedQueries = [];
  try {
    await http('get', '/customers/export?view=prospects', undefined, id).expect(200);
    const sql = capturedQueries.join('\n');
    expect(sql).toContain('transaction_timestamp()');
    expect(sql).toContain('SERIALIZABLE');
    expect(sql).not.toContain('SET TRANSACTION READ ONLY');
    expect(capturedQueries.filter((q) => q === 'BEGIN')).toHaveLength(2); // guard snapshot + owned export
    expect(capturedQueries.filter((q) => q === 'COMMIT')).toHaveLength(2);
    expect(sql).toContain('audit_logs');
  } finally {
    capturedQueries = undefined;
  }
});
it('required export evidence failure rolls back the actual owned execution', async () => {
  const id = await reader(['customers.export'], 'SHOP', [branchA]);
  const audit = app.get(PiiAuditService);
  const original = audit.logDecryption.bind(audit);
  const spy = jest.spyOn(audit, 'logDecryption').mockImplementation(async (input) => {
    await original(input);
    throw new Error('required evidence fault');
  });
  const log = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  try {
    await http('get', '/customers/export?view=prospects', undefined, id).expect(500);
  } finally {
    spy.mockRestore();
    log.mockRestore();
  }
  expect(await db.auditLog.count({ where: { userId: id } })).toBe(0);
});

it('selects the bounded export timeout only for the exact export adapter and uses the exact current client', async () => {
  const resources = app.get(AccessResourceService);
  const execute = jest.spyOn(resources, 'execute');
  const create = PartyQueryPlan.create.bind(PartyQueryPlan);
  const clients: object[] = [];
  const planSpy = jest.spyOn(PartyQueryPlan, 'create').mockImplementation(async (...args) => {
    const plan = await create(...args);
    clients.push(plan.db);
    expect(plan.db).not.toBe(db);
    return plan;
  });
  try {
    await http('get', '/customers/export?view=prospects').expect(200);
    await http('get', `/customers/${queryCustomer}/summary`).expect(200);
    expect(execute.mock.calls[0][6]).toMatchObject({
      timeoutMs: 60000,
      isolationLevel: 'Serializable',
      maxAttempts: 3,
    });
    expect(execute.mock.calls[1][6]).not.toHaveProperty('timeoutMs');
    expect(clients).toHaveLength(2);
  } finally {
    execute.mockRestore();
    planSpy.mockRestore();
  }
});
it('refreshes current grants after a real authority-fence wait before any export', async () => {
  const id = await reader(['customers.export'], 'SHOP', [branchA]);
  let release!: () => void;
  let locked!: () => void;
  const gate = new Promise<void>((r) => {
    release = r;
  });
  const ready = new Promise<void>((r) => {
    locked = r;
  });
  const mutation = db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(718294630)`;
    locked();
    await gate;
    await tx.employeeAccessAssignment.updateMany({
      where: { userId: id },
      data: { deletedAt: new Date() },
    });
  });
  await ready;
  const pending = http('get', '/customers/export?view=prospects', undefined, id).then((r) => r);
  try {
    let waiting = false;
    for (let i = 0; i < 100 && !waiting; i++) {
      const waiters = await db.$queryRaw<
        Array<{ count: bigint }>
      >`SELECT count(*) FROM pg_stat_activity WHERE wait_event = 'advisory' AND query LIKE '%718294630%'`;
      waiting = Number(waiters[0].count) > 0;
      if (!waiting) await new Promise((r) => setTimeout(r, 5));
    }
    expect(waiting).toBe(true);
  } finally {
    release();
  }
  await mutation;
  expect((await pending).status).toBe(403);
  expect(await db.auditLog.count({ where: { userId: id } })).toBe(0);
});
it('keeps export count, cap and completeness on the exact owned snapshot', async () => {
  const id = await reader(['customers.export'], 'SHOP', [branchA]);
  const query = app.get(CustomerQueryService);
  // Exercise real SQL counts through the owned snapshot; use10,001 minimal origins.
  await db.customer.createMany({
    data: Array.from({ length: 10001 }, (_, i) => ({
      name: `Export cap ${i}`,
      accessCompanyCode: 'SHOP',
      accessBranchId: branchA,
    })),
  });
  await http('get', '/customers/export?view=prospects&search=Export%20cap', undefined, id).expect(
    400,
  );
  await customer({ name: 'Export completeness' });
  const original = query.findAll.bind(query);
  const spy = jest.spyOn(query, 'findAll').mockImplementation(async (...args) => {
    const result = await original(...args);
    return { ...result, data: result.data.slice(1) };
  });
  try {
    await http(
      'get',
      '/customers/export?view=prospects&search=Export%20completeness',
      undefined,
      id,
    ).expect(400);
  } finally {
    spy.mockRestore();
  }
});
it('registers exactly derived11 without consuming later Customer routes', () => {
  expect(PARTY_DERIVED_ROUTES).toHaveLength(11);
  expect(new Set(PARTY_DERIVED_ROUTES).size).toBe(11);
  expect(PARTY_DERIVED_ROUTES.map((r) => r.split('.')[1]).sort()).toEqual(
    derivedRoutes.map(([name]) => name).sort(),
  );
  for (const route of PARTY_DERIVED_ROUTES) {
    expect(ACCESS_BOUNDARIES.has(route)).toBe(true);
    expect(ACCESS_POLICIES[route].classification).toBe('staff');
  }
});
it('300 repeated no-grant summary reads remain denied with fresh zero-grant managed snapshots', async () => {
  for (let i = 0; i < 300; i++) {
    const snapshot = await snapshots.forUser(denied);
    expect(snapshot).toMatchObject({ userId: denied, managed: true, isOwner: false, grants: [] });
    await http('get', `/customers/${queryCustomer}/summary`, undefined, denied).expect(403);
  }
});
it('uses scoped actual dunning delivery counts before preferred channel and rate calculations', async () => {
  const id = await reader(['customers.read'], 'SHOP', [branchA]);
  await grant(id, ['contracts.read', 'collections.read'], 'FINANCE', [branchA]);
  const c = await customer();
  const visible = await contract(c.id);
  const hidden = await contract(c.id, branchB);
  const rule = await db.dunningRule.create({
    data: { name: 'Synthetic', triggerDay: 1, channel: 'SMS', messageTemplate: 'No sends' },
  });
  await db.dunningAction.createMany({
    data: [
      { contractId: visible.id, dunningRuleId: rule.id, channel: 'SMS', status: 'DELIVERED' },
      { contractId: visible.id, dunningRuleId: rule.id, channel: 'SMS', status: 'FAILED' },
      ...Array.from({ length: 3 }, () => ({
        contractId: hidden.id,
        dunningRuleId: rule.id,
        channel: 'LINE' as const,
        status: 'DELIVERED' as const,
      })),
    ],
  });
  const result = (await http('get', `/customers/${c.id}/insights`, undefined, id).expect(200)).body;
  expect(result).toMatchObject({ preferredChannel: 'SMS', channelResponseRates: { SMS: 50 } });
  expect(result.channelResponseRates).not.toHaveProperty('LINE');
});
it('every actual derived handler joins captured contributor calls to the owned current client', async () => {
  const spies = [
    db.customer,
    db.contract,
    db.payment,
    db.receipt,
    db.callLog,
    db.dunningAction,
    db.chatRoom,
    db.product,
  ].map((d) => jest.spyOn(d, 'findMany'));
  try {
    for (const [, path] of derivedRoutes) await http('get', path()).expect(200);
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  } finally {
    for (const spy of spies) spy.mockRestore();
  }
});
it('decrypts encrypted-only phones through the scoped batched identity contract with required evidence', async () => {
  const id = await reader(['customers.read'], 'SHOP', [branchA]);
  const c = await customer({
    name: 'Encrypted derived',
    phone: null,
    phoneEncrypted: encryptPII('0812345678', process.env.PII_ENCRYPTION_KEY!),
  });
  const hidden = await customer({
    name: 'Encrypted hidden',
    accessBranchId: branchB,
    phoneEncrypted: encryptPII('0899999999', process.env.PII_ENCRYPTION_KEY!),
  });
  await http('get', `/customers/${hidden.id}/summary`, undefined, id).expect(404);
  const referred = await customer({
    referredById: c.id,
    phone: null,
    phoneEncrypted: encryptPII('0888888888', process.env.PII_ENCRYPTION_KEY!),
  });
  expect(
    (await http('get', `/customers/${c.id}/summary`, undefined, id).expect(200)).body.phone,
  ).toBe('0812345678');
  expect(
    (
      await http('get', `/customers/${c.id}/referrals`, undefined, id).expect(200)
    ).body.referrals.find((r: { id: string }) => r.id === referred.id).phone,
  ).toBe('0888888888');
  const stats = (await http('get', '/customers/referral-stats', undefined, id).expect(200)).body;
  expect(
    stats.topReferrers.find((r: { referrerId: string }) => r.referrerId === c.id).referrerPhone,
  ).toBe('0812345678');
  expect(
    await db.auditLog.count({ where: { userId: id, entityId: c.id, action: 'PII_DECRYPT_FULL' } }),
  ).toBeGreaterThanOrEqual(2);
});
it('preserves standalone RepeatableRead READ ONLY export snapshot across concurrent updates', async () => {
  const c = await customer({ name: 'Standalone before' });
  const result = await readExportSnapshot(db as PrismaService, async (tx) => {
    const first = await tx.customer.findUniqueOrThrow({ where: { id: c.id } });
    await db.customer.update({ where: { id: c.id }, data: { name: 'Standalone after' } });
    const second = await tx.customer.findUniqueOrThrow({ where: { id: c.id } });
    expect(second.name).toBe(first.name);
    return { data: [second], total: 1 };
  });
  expect(result.data[0].name).toBe('Standalone before');
  await expect(
    readExportSnapshot(db as PrismaService, async (tx) => {
      await tx.customer.update({ where: { id: c.id }, data: { name: 'Forbidden write' } });
      return { data: [], total: 0 };
    }),
  ).rejects.toThrow();
  expect((await db.customer.findUniqueOrThrow({ where: { id: c.id } })).name).toBe(
    'Standalone after',
  );
});
