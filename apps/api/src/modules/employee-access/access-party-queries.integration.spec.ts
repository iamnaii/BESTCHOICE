import { encryptPII } from '../../utils/crypto.util';
import { hashPII } from '../../utils/pii.util';
import { PartyQueryPlan, scopePartyCustomerWhere } from './access-party-query-plan';
import { PARTY_QUERY_ROUTES, PARTY_WRITE_ROUTES } from './access-party-boundaries';
import { ACCESS_BOUNDARIES, ACCESS_POLICIES } from './access-policy.registry';
import { productScopeWhere } from './access-query-scope';
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
    .expect('x-owned-query-app', testRun)
    .on('response', (response) => {
      if (response.headers['x-owned-query-app'] !== testRun)
        console.error(
          'OWNED_HTTP_MARKER_MISMATCH',
          JSON.stringify({
            status: response.status,
            marker: response.headers['x-owned-query-app'] ?? null,
            server: response.headers.server ?? null,
            contentType: response.headers['content-type'] ?? null,
          }),
        );
    });
  return body ? call.send(body) : call;
}
let sequence = 10000;
async function knownCustomer(branchId = branchA) {
  const c = await db.customer.create({
    data: { name: 'Known', phone: '08000' + String(++sequence) },
  });
  await db.tradeIn.create({
    data: { customerId: c.id, branchId, deviceBrand: 'Apple', deviceModel: 'Evidence' },
  });
  return c;
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
      CustomerPurchaseSummaryService,
      CustomerChatRoomsService,
      PiiAuditService,
      ContactsService,
      ContactResolverService,
      AuditService,
      JourneyEntryWriter,
      ...[
        CustomerAnalyticsService,
        SkipTracingService,
        CustomerInsightsService,
        CustomerMergeService,
      ].map((provide) => ({ provide, useValue: {} })),
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
      res.setHeader('x-owned-query-app', testRun);
      next();
    },
  );
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
  await app.listen(0, '127.0.0.1');
}, 60000);
afterAll(async () => {
  await app?.close();
  await db.$disconnect();
});

let queryCustomer: string, queryContact: string;
beforeAll(async () => {
  const contact = await db.contact.create({
    data: {
      contactCode: 'QUERY-' + randomUUID(),
      name: 'Query Party',
      roles: ['CUSTOMER'],
      accessCompanyCode: 'SHOP',
      accessBranchId: branchA,
      nationalIdHash: 'never-project-this',
    },
  });
  queryContact = contact.id;
  queryCustomer = (
    await db.customer.create({
      data: {
        name: 'Query Party',
        phone: '0811111111',
        nationalId: '1234567890123',
        guardianNationalId: '9876543210987',
        accessCompanyCode: 'SHOP',
        accessBranchId: branchA,
        contactId: contact.id,
      },
    })
  ).id;
});
const routes = [
  ['CustomersController.findAll', () => '/customers'],
  ['CustomersController.findOne', () => '/customers/' + queryCustomer],
  ['CustomersController.findDetail', () => '/customers/' + queryCustomer + '/detail'],
  ['CustomersController.search', () => '/customers/search?q=Query'],
  ['ContactsController.list', () => '/contacts'],
  ['ContactsController.findOne', () => '/contacts/' + queryContact],
] as const;
it.each(routes)('%s allows a genuine fresh origin through actual HTTP', async (_name, path) => {
  const res = await http('get', path()).expect(200);
  expect(JSON.stringify(res.body)).not.toContain('never-project-this');
});
it.each(routes)('%s denies a managed principal without grants', async (_name, path) => {
  await http('get', path(), undefined, denied).expect(403);
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
it('masks both IDs without role fallback and never returns encrypted/hash fields', async () => {
  const res = await http('get', '/customers/' + queryCustomer).expect(200);
  expect(res.body.nationalId).not.toBe('1234567890123');
  expect(res.body.guardianNationalId).not.toBe('9876543210987');
  expect(Object.keys(res.body).some((k) => /Encrypted$|Hash$/.test(k))).toBe(false);
  const audit = await db.auditLog.findFirstOrThrow({
    where: { userId: actor, entityId: queryCustomer, action: 'PII_DECRYPT_MASKED' },
  });
  expect(JSON.stringify(audit.newValue)).not.toContain('1234567890123');
});
it('pairs full identity search and projection on the same actual source', async () => {
  const id = await reader(['customers.read'], 'SHOP', [branchA]);
  await grant(id, ['sensitive.customer-identity.read'], 'SHOP', [branchB]);
  const c = await customer({
    name: 'Pair',
    nationalId: '1112223334445',
    guardianNationalId: '5554443332221',
  });
  await db.tradeIn.create({
    data: { customerId: c.id, branchId: branchB, deviceBrand: 'Apple', deviceModel: 'History' },
  });
  expect(
    (await http('get', '/customers/search?q=1112223334445', undefined, id).expect(200)).body,
  ).toEqual([]);
  expect(
    (await http('get', '/customers/' + c.id, undefined, id).expect(200)).body.nationalId,
  ).not.toBe(c.nationalId);
  await grant(id, ['customers.read'], 'SHOP', [branchB]);
  expect(
    (await http('get', '/customers/search?q=1112223334445', undefined, id).expect(200)).body[0]
      .nationalId,
  ).toBe(c.nationalId);
  expect(
    (await http('get', '/customers/' + c.id, undefined, id).expect(200)).body.guardianNationalId,
  ).toBe(c.guardianNationalId);
});
it('scopes before the ten-row search limit and preserves original position tuples', async () => {
  const id = await reader(['customers.read'], 'SHOP', [branchA]);
  await grant(id, ['contacts.read'], 'SHOP', [branchB]);
  for (let i = 0; i < 12; i++)
    await customer({ name: 'Limit 0 hidden ' + i, accessBranchId: branchB });
  const visible = await customer({ name: 'Limit Z visible' });
  const res = await http('get', '/customers/search?q=Limit', undefined, id).expect(200);
  expect(res.body.map((r: { id: string }) => r.id)).toEqual([visible.id]);
  const list = await http('get', '/customers?search=Limit&limit=1', undefined, id).expect(200);
  expect(list.body.total).toBe(1);
  expect(list.body.data[0].id).toBe(visible.id);
});
it('uses historical same-party evidence but not a Contact sibling as customer authority', async () => {
  const id = await reader(['customers.read'], 'SHOP', [branchA]);
  const historic = await knownCustomer();
  await http('get', '/customers/' + historic.id, undefined, id).expect(200);
  const hidden = await customer({ accessBranchId: branchB, contactId: queryContact });
  await http('get', '/customers/' + hidden.id, undefined, id).expect(404);
});
it('assigned Contract grants only same-customer core and its independently allowed case history', async () => {
  const id = await reader(['customers.read', 'contracts.read'], 'FINANCE', undefined, true);
  const c = await customer();
  const assigned = await contract(c.id, branchA, { assignedToId: id });
  await contract(c.id, branchB);
  const res = await http(
    'get',
    '/customers/' + c.id + '/detail?company=FINANCE',
    undefined,
    id,
  ).expect(200);
  expect(res.body.contracts.map((r: { id: string }) => r.id)).toEqual([assigned.id]);
  expect(res.body.openContracts[0].outstanding).toBeNull();
  expect(res.body.openContracts[0].mdmLocked).toBeNull();
  expect(res.body._count.contracts).toBe(1);
  await db.contract.update({ where: { id: assigned.id }, data: { assignedToId: null } });
  await http('get', '/customers/' + c.id + '?company=FINANCE', undefined, id).expect(404);
});
it('assigned room proof requires both actual child/base reads and uses only readable room metadata', async () => {
  const id = await reader(['customers.read', 'chat.read'], 'FINANCE', undefined, true);
  const c = await customer({ acquisitionSource: 'CHAT_LINE_FINANCE' });
  const room = await db.chatRoom.create({
    data: {
      customerId: c.id,
      channel: 'LINE_FINANCE',
      assignedToId: id,
      lastMessageAt: new Date('2026-01-01'),
    },
  });
  await db.chatRoom.create({
    data: { customerId: c.id, channel: 'FACEBOOK', lastMessageAt: new Date('2026-10-17') },
  });
  const res = await http(
    'get',
    '/customers/' + c.id + '/detail?company=FINANCE',
    undefined,
    id,
  ).expect(200);
  expect(res.body.chatRooms.map((r: { roomId: string }) => r.roomId)).toEqual([room.id]);
  expect(res.body.assignedTo.id).toBe(id);
  await db.chatRoom.update({ where: { id: room.id }, data: { assignedToId: null } });
  await http('get', '/customers/' + c.id + '?company=FINANCE', undefined, id).expect(404);
});
it('does not grant case core from customers ASSIGNED alone or branch-only room guesses', async () => {
  const id = await reader(['customers.read'], 'FINANCE', undefined, true);
  const c = await customer();
  await contract(c.id, branchA, { assignedToId: id });
  await http('get', '/customers/' + c.id + '?company=FINANCE', undefined, id).expect(404);
  const branchReader = await reader(['customers.read', 'chat.read'], 'SHOP', [branchA]);
  const roomOnly = await customer({ accessCompanyCode: null, accessBranchId: null });
  await db.chatRoom.create({
    data: { customerId: roomOnly.id, channel: 'LINE_SHOP', assignedToId: branchReader },
  });
  await http('get', '/customers/' + roomOnly.id, undefined, branchReader).expect(404);
});
it('scopes nested counts, ranking and same-row branch/status filters', async () => {
  const id = await reader(['customers.read'], 'SHOP', [branchA]);
  await grant(id, ['contracts.read'], 'FINANCE', [branchA]);
  const first = await customer({ name: 'Rank first' });
  const second = await customer({ name: 'Rank second' });
  await contract(first.id);
  await contract(second.id);
  await contract(second.id);
  for (let i = 0; i < 3; i++) await contract(first.id, branchB, { status: 'OVERDUE' });
  const res = await http(
    'get',
    '/customers?search=Rank&sortBy=contractCount&sortOrder=desc&limit=1',
    undefined,
    id,
  ).expect(200);
  expect(res.body.total).toBe(2);
  expect(res.body.data[0].id).toBe(second.id);
  expect(res.body.data[0]._count.contracts).toBe(2);
  expect(res.body.viewCounts).toEqual({ customers: null, prospects: null });
  const filtered = await http(
    'get',
    '/customers?search=Rank&branchId=' + branchA + '&contractStatus=OVERDUE',
    undefined,
    id,
  ).expect(200);
  expect(filtered.body.total).toBe(0);
});
it('does not use hidden Product IMEI as a search match or nested device projection', async () => {
  const id = await reader(['customers.read'], 'SHOP', [branchA]);
  await grant(id, ['contracts.read'], 'FINANCE', [branchA]);
  const c = await customer();
  const con = await contract(c.id);
  await db.product.update({ where: { id: con.productId }, data: { imeiSerial: 'HIDDEN-DEVICE' } });
  expect(
    await db.product.count({
      where: {
        id: con.productId,
        OR: (['SHOP', 'FINANCE'] as const).map((company) =>
          productScopeWhere({ userId: id, permission: 'products.read', company, tuples: [] }),
        ),
      },
    }),
  ).toBe(0);
  expect(
    (await http('get', '/customers?search=HIDDEN-DEVICE', undefined, id).expect(200)).body.total,
  ).toBe(0);
  expect(
    (await http('get', '/customers/' + c.id, undefined, id).expect(200)).body.contracts[0].product,
  ).toBeNull();
});
it('keeps unlinked credit unavailable and never trusts denormalized hidden status', async () => {
  const id = await reader(['customers.read'], 'SHOP', [branchA]);
  await grant(id, ['credit-checks.read', 'contracts.read'], 'FINANCE');
  const c = await customer({ name: 'Unlinked credit', creditCheckStatus: 'FULL_CHECK_PASSED' });
  await db.creditCheck.create({ data: { customerId: c.id, status: 'APPROVED', aiScore: 99 } });
  const list = await http('get', '/customers?search=Unlinked', undefined, id).expect(200);
  expect(list.body.data[0].creditCheckStatus).toBeNull();
  expect(list.body.data[0].latestCreditScore).toBeNull();
  expect(list.body.data[0].availability.credit).toBe('unavailable');
  const filtered = await http(
    'get',
    '/customers?search=Unlinked&creditStatus=APPROVED',
    undefined,
    id,
  ).expect(200);
  expect(filtered.body.total).toBe(0);
});
it('does not turn missing child reads into zero balances, NEW tier or NONE credit', async () => {
  const res = await http('get', '/customers?search=Query').expect(200);
  const row = res.body.data[0];
  expect(row._count.contracts).toBeNull();
  expect(row.tier).toBeNull();
  expect(row.creditCheckStatus).toBeNull();
  expect(row.purchase.installmentTotal).toBeNull();
  expect(row.purchase.cashCount).toBeNull();
  expect(res.body.summary.installment).toBeNull();
  expect(res.body.viewCounts.prospects).toBeNull();
});
it('returns manual tag enums only with same-source tag read and suppresses persisted AUTO claims', async () => {
  const id = await reader(['customers.read', 'customer-tags.read'], 'SHOP', [branchA]);
  const c = await customer({ name: 'Tagged' });
  await db.customerTag.createMany({
    data: [
      { customerId: c.id, tag: 'BLACKLIST', source: 'MANUAL', reason: 'private annotation' },
      { customerId: c.id, tag: 'HIGH_RISK', source: 'AUTO' },
    ],
  });
  const res = await http('get', '/customers/' + c.id + '/detail', undefined, id).expect(200);
  expect(res.body.tags).toEqual([{ tag: 'BLACKLIST' }]);
  expect(res.body.availability.autoTags).toBe('unavailable');
  expect(JSON.stringify(res.body)).not.toContain('private annotation');
});
it('narrow global lender references work through either live company and reveal no settings', async () => {
  const id = await reader(['contacts.read', 'external-finance.read'], 'FINANCE');
  const contact = await db.contact.create({
    data: { contactCode: randomUUID(), name: 'Global lender', roles: ['CUSTOMER'] },
  });
  await db.externalFinanceCompany.create({
    data: {
      contactId: contact.id,
      name: randomUUID(),
      bankAccountInfo: { secret: 'bank' },
      creditTermDays: 99,
    },
  });
  const res = await http(
    'get',
    '/contacts/' + contact.id + '?company=FINANCE',
    undefined,
    id,
  ).expect(200);
  expect(Object.keys(res.body.externalFinanceCompany[0]).sort()).toEqual([
    'id',
    'isActive',
    'name',
  ]);
  expect(res.body.customers).toEqual([]);
  expect(res.body.suppliers).toEqual([]);
});
it('live source deactivation and access assignment retirement take effect on the next actual request', async () => {
  const id = await reader(['customers.read'], 'SHOP', [branchA]);
  await http('get', '/customers/' + queryCustomer, undefined, id).expect(200);
  await db.branch.update({ where: { id: branchA }, data: { isActive: false } });
  try {
    await http('get', '/customers/' + queryCustomer, undefined, id).expect(403);
  } finally {
    await db.branch.update({ where: { id: branchA }, data: { isActive: true } });
  }
  await db.employeeAccessAssignment.updateMany({
    where: { userId: id },
    data: { deletedAt: new Date() },
  });
  await http('get', '/customers/' + queryCustomer, undefined, id).expect(403);
});
it('keeps selected-work identity membership separate while honoring real cross-work children', async () => {
  const id = await reader(['customers.read'], 'SHOP');
  await grant(id, ['customers.read', 'contracts.read'], 'FINANCE');
  const shop = await customer({ name: 'Work membership SHOP' });
  const finance = await customer({
    name: 'Work membership FINANCE',
    accessCompanyCode: 'FINANCE',
    accessBranchId: null,
  });
  const con = await contract(shop.id);
  const res = await http('get', '/customers?search=Work%20membership', undefined, id).expect(200);
  expect(res.body.data.map((r: { id: string }) => r.id)).toEqual([shop.id]);
  expect(
    (await http('get', '/customers/' + shop.id, undefined, id).expect(200)).body.contracts[0].id,
  ).toBe(con.id);
  await http('get', '/customers/' + finance.id, undefined, id).expect(404);
  await http('get', '/customers/' + finance.id + '?company=FINANCE', undefined, id).expect(200);
});
it('retains assigned-room scoped prospects and hidden purchases cannot change membership or coverage', async () => {
  const id = await reader(['customers.read', 'chat.read'], 'FINANCE', undefined, true);
  const c = await customer({ name: 'Visible scope prospect' });
  await db.chatRoom.create({
    data: { customerId: c.id, channel: 'LINE_FINANCE', assignedToId: id },
  });
  const path = '/customers?company=FINANCE&view=prospects&search=Visible%20scope';
  const before = (await http('get', path, undefined, id).expect(200)).body;
  expect(before.data.map((r: { id: string }) => r.id)).toEqual([c.id]);
  expect(before.viewCoverage).toBe('unavailable');
  expect(before.viewCounts.prospects).toBeNull();
  const con = await contract(c.id, branchB);
  const after = (await http('get', path, undefined, id).expect(200)).body;
  expect(after.total).toBe(before.total);
  expect(after.viewCoverage).toBe(before.viewCoverage);
  expect(after.data[0].availability).toEqual(before.data[0].availability);
  await grant(id, ['contracts.read'], 'FINANCE', undefined, 'ASSIGNED');
  await db.contract.update({ where: { id: con.id }, data: { assignedToId: id } });
  expect((await http('get', path, undefined, id).expect(200)).body.total).toBe(0);
});
it('uses recognized historical CHAT labels only with actual room or company chat proof', async () => {
  const id = await reader(['customers.read'], 'SHOP', [branchA]);
  const c = await customer({ name: 'Historical label', acquisitionSource: 'CHAT_LINE_FINANCE' });
  let res = await http(
    'get',
    '/customers?search=Historical%20label&fromChat=true',
    undefined,
    id,
  ).expect(200);
  expect(res.body.total).toBe(0);
  await grant(id, ['chat.read'], 'FINANCE');
  res = await http(
    'get',
    '/customers?search=Historical%20label&fromChat=true',
    undefined,
    id,
  ).expect(200);
  expect(res.body.data[0].id).toBe(c.id);
  expect(res.body.data[0].source).toBe('LINE');
  expect(res.body.data[0].chatRooms).toEqual([]);
});
it('exposes linked credit only with same-source case and credit capabilities and preserves latest-score ranking', async () => {
  const id = await reader(['customers.read'], 'SHOP', [branchA]);
  await grant(id, ['contracts.read', 'credit-checks.read'], 'FINANCE', [branchA]);
  const first = await customer({ name: 'Score first' });
  const second = await customer({ name: 'Score second' });
  const one = await contract(first.id);
  const two = await contract(second.id);
  const hidden = await contract(first.id, branchB);
  await db.creditCheck.create({
    data: { customerId: first.id, contractId: one.id, aiScore: 20, status: 'APPROVED' },
  });
  await db.creditCheck.create({
    data: { customerId: second.id, contractId: two.id, aiScore: 70, status: 'APPROVED' },
  });
  await db.creditCheck.create({
    data: { customerId: first.id, contractId: hidden.id, aiScore: 99, status: 'APPROVED' },
  });
  const res = await http(
    'get',
    '/customers?search=Score&sortBy=creditScore&sortOrder=desc&limit=1',
    undefined,
    id,
  ).expect(200);
  expect(res.body.total).toBe(2);
  expect(res.body.data[0].id).toBe(second.id);
  expect(res.body.data[0].latestCreditScore).toBe(70);
  const filtered = (
    await http(
      'get',
      '/customers?search=Score&creditStatus=APPROVED&sortBy=creditScore&sortOrder=desc',
      undefined,
      id,
    ).expect(200)
  ).body;
  expect(filtered.data.map((row: { id: string }) => row.id)).toEqual([second.id, first.id]);
  expect(filtered.data[1].latestCreditScore).toBe(20);
});
it.each(['empty', 'assigned', 'foreign', 'branches', 'company'] as const)(
  'Product source %s composes safely in a nested OR with real PostgreSQL',
  async (mode) => {
    const c = await customer();
    const con = await contract(c.id);
    const tuples =
      mode === 'empty'
        ? []
        : [
            {
              userId: mode === 'foreign' ? 'another-user' : actor,
              scope:
                mode === 'assigned'
                  ? ('ASSIGNED' as const)
                  : mode === 'company' || mode === 'foreign'
                    ? ('COMPANY' as const)
                    : ('BRANCHES' as const),
              branchIds: mode === 'branches' ? [branchA] : [],
            },
          ];
    const predicate = productScopeWhere({
      userId: actor,
      permission: 'products.read',
      company: 'SHOP',
      tuples,
    });
    expect(
      await db.product.count({ where: { id: con.productId, OR: [predicate, { id: { in: [] } }] } }),
    ).toBe(mode === 'branches' || mode === 'company' ? 1 : 0);
  },
);
it('does not let an unauthorized Sale change scoped prospects or match a sale number', async () => {
  const id = await reader(['customers.read'], 'SHOP', [branchA]);
  const c = await customer({ name: 'No sale grant prospect' });
  const con = await contract(c.id);
  const before = (
    await http('get', '/customers?view=prospects&search=No%20sale%20grant', undefined, id).expect(
      200,
    )
  ).body;
  await db.sale.create({
    data: {
      saleNumber: 'HIDDEN-SALE-' + randomUUID(),
      saleType: 'CASH',
      customerId: c.id,
      productId: con.productId,
      branchId: branchA,
      salespersonId: actor,
      sellingPrice: 1000,
      netAmount: 1000,
      paymentMethod: 'CASH',
      amountReceived: 1000,
    },
  });
  const after = (
    await http('get', '/customers?view=prospects&search=No%20sale%20grant', undefined, id).expect(
      200,
    )
  ).body;
  expect(after.total).toBe(before.total);
  expect(after.data[0].id).toBe(c.id);
  expect(
    (await http('get', '/customers?search=HIDDEN-SALE-', undefined, id).expect(200)).body.total,
  ).toBe(0);
});
it('uses canonical payment totals only after independent same-contract payment permission', async () => {
  const id = await reader(['customers.read'], 'SHOP', [branchA]);
  await grant(id, ['contracts.read'], 'FINANCE', [branchA]);
  const c = await customer();
  const con = await contract(c.id);
  await db.payment.createMany({
    data: [
      {
        contractId: con.id,
        installmentNo: 1,
        dueDate: new Date('2020-01-01'),
        amountDue: 990,
        amountPaid: 90,
        status: 'PARTIALLY_PAID',
      },
      {
        contractId: con.id,
        installmentNo: 2,
        dueDate: new Date('2099-01-01'),
        amountDue: 990,
        amountPaid: 0,
        status: 'PENDING',
      },
    ],
  });
  const path = '/customers/' + c.id + '/detail';
  expect((await http('get', path, undefined, id).expect(200)).body.installmentBalance).toBeNull();
  await grant(id, ['payments.read'], 'FINANCE', [branchA]);
  const row = (await http('get', path, undefined, id).expect(200)).body;
  expect(row.installmentBalance.outstanding).toBe(1890);
  expect(row.openContracts[0].outstanding).toBe(1890);
  expect(row.openContracts[0].overdueAmount).toBe(900);
  expect(row.openContracts[0].nextAmountDue).toBe(990);
  expect(row.openContracts[0].totalInstallments).toBe(2);
});
it('recomputes AUTO labels read-only only after fixed global financial coverage', async () => {
  const id = await reader(['customers.read', 'customer-tags.read'], 'SHOP', [branchA]);
  const c = await customer();
  await contract(c.id);
  await db.customerTag.create({
    data: { customerId: c.id, tag: 'HIGH_RISK', source: 'AUTO', reason: 'stale' },
  });
  const path = '/customers/' + c.id + '/detail';
  expect((await http('get', path, undefined, id).expect(200)).body.tags).toEqual([]);
  await grant(
    id,
    ['contracts.read', 'collections.read', 'device-returns.read', 'repossessions.read'],
    'FINANCE',
  );
  const result = (await http('get', path, undefined, id).expect(200)).body;
  expect(result.tags).toEqual([{ tag: 'NEW' }]);
  expect(result.availability.autoTags).toBe('available');
  expect(
    await db.customerTag.count({ where: { customerId: c.id, tag: 'HIGH_RISK', deletedAt: null } }),
  ).toBe(1);
  expect(await db.customerTag.count({ where: { customerId: c.id, tag: 'NEW' } })).toBe(0);
});
it('filters permitted manual tags in partial prospect views without inferred finance authority', async () => {
  const id = await reader(['customers.read', 'customer-tags.read'], 'SHOP', [branchA]);
  const c = await customer({ name: 'Manual tag prospect' });
  await db.customerTag.create({ data: { customerId: c.id, tag: 'BLACKLIST', source: 'MANUAL' } });
  const result = (
    await http(
      'get',
      '/customers?view=prospects&search=Manual%20tag&tag=BLACKLIST',
      undefined,
      id,
    ).expect(200)
  ).body;
  expect(result.data[0].id).toBe(c.id);
  expect(result.viewCoverage).toBe('unavailable');
});
it('rejects a mismatched CreditCheck/customer backlink even with global financial grants', async () => {
  const id = await reader(['customers.read'], 'SHOP');
  await grant(id, ['contracts.read', 'credit-checks.read'], 'FINANCE');
  const c = await customer({ name: 'Wrong backlink' });
  const other = await customer();
  const con = await contract(other.id);
  await db.creditCheck.create({
    data: { customerId: c.id, contractId: con.id, aiScore: 100, status: 'APPROVED' },
  });
  const result = (
    await http('get', '/customers?search=Wrong%20backlink', undefined, id).expect(200)
  ).body;
  expect(result.data[0].latestCreditScore).toBeNull();
  expect(result.data[0].availability.credit).toBe('unavailable');
});
it('recognizes a genuine room-linked credit row without granting sibling room checks', async () => {
  const id = await reader(
    ['customers.read', 'chat.read', 'credit-checks.read'],
    'FINANCE',
    undefined,
    true,
  );
  const c = await customer({ name: 'Room linked credit' });
  const room = await db.chatRoom.create({
    data: { customerId: c.id, channel: 'LINE_FINANCE', assignedToId: id },
  });
  const check = await db.creditCheck.create({
    data: { customerId: c.id, aiScore: 45, status: 'APPROVED' },
  });
  await db.roomCreditAnalysis.create({
    data: { roomId: room.id, creditCheckId: check.id, fileIds: [], status: 'COMPLETED' },
  });
  const result = (
    await http('get', '/customers?company=FINANCE&search=Room%20linked', undefined, id).expect(200)
  ).body;
  expect(result.data[0].latestCreditScore).toBe(45);
});
it('honors over-one-year absence against authorized purchases, not an old-row existence shortcut', async () => {
  const id = await reader(['customers.read'], 'SHOP');
  await grant(id, ['contracts.read'], 'FINANCE', [branchA]);
  const c = await customer({ name: 'Old purchase scope' });
  await contract(c.id, branchA, { createdAt: new Date('2020-01-01') });
  await contract(c.id, branchB);
  const path = '/customers?search=Old%20purchase&purchasedWithin=over1y';
  expect((await http('get', path, undefined, id).expect(200)).body.total).toBe(1);
  await contract(c.id, branchA);
  expect((await http('get', path, undefined, id).expect(200)).body.total).toBe(0);
});

it('reconciles exactly eight reviewed writer and six actual query registrations without catalog credit', () => {
  expect(PARTY_QUERY_ROUTES).toHaveLength(6);
  expect(PARTY_WRITE_ROUTES).toHaveLength(8);
  const routes = [...PARTY_WRITE_ROUTES, ...PARTY_QUERY_ROUTES];
  expect(new Set(routes).size).toBe(14);
  for (const route of routes) {
    expect(ACCESS_BOUNDARIES.has(route)).toBe(true);
    expect(ACCESS_POLICIES[route].classification).toBe('staff');
  }
  expect(PARTY_QUERY_ROUTES).not.toContain('CustomersController.exportRows');
});
it('all captured query helpers join the real owned transaction rather than the injected root client', async () => {
  const spies = [
    db.customer,
    db.contract,
    db.payment,
    db.chatRoom,
    db.customerTag,
    db.systemConfig,
  ].map((delegate) => jest.spyOn(delegate, 'findMany'));
  try {
    await http('get', '/customers/' + queryCustomer + '/detail').expect(200);
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  } finally {
    for (const spy of spies) spy.mockRestore();
  }
});

it('preserves SHOP-only warranty purchases without FINANCE amounts or full-contract navigation', async () => {
  const id = await reader(['customers.read', 'contracts.read', 'products.read'], 'SHOP', [branchA]);
  const c = await customer({ name: 'SHOP warranty seam' });
  const con = await contract(c.id, branchA, {
    deviceReceivedAt: new Date('2020-01-01'),
    shopWarrantyEndDate: new Date('2099-01-01'),
  });
  await db.product.update({
    where: { id: con.productId },
    data: { imeiSerial: 'WARRANTY-VISIBLE', warrantyExpireDate: new Date('2100-01-01') },
  });
  const list = (
    await http(
      'get',
      '/customers?view=customers&search=SHOP%20warranty%20seam',
      undefined,
      id,
    ).expect(200)
  ).body;
  expect(list.total).toBe(1);
  expect(list.viewCoverage).toBe('partial');
  expect(list.data[0].latestPurchase).toMatchObject({
    kind: 'INSTALLMENT',
    number: con.contractNumber,
    imeiSerial: 'WARRANTY-VISIBLE',
  });
  expect(list.data[0].warranty).toMatchObject({
    status: 'IN_SHOP_WARRANTY',
    centerEndDate: '2100-01-01T00:00:00.000Z',
  });
  expect(list.data[0].purchase.installmentTotal).toBeNull();
  expect(list.data[0].tier).toBeNull();
  expect(list.summary.overdue).toBeNull();
  const detail = (await http('get', '/customers/' + c.id + '/detail', undefined, id).expect(200))
    .body;
  expect(detail.contracts).toEqual([]);
  expect(detail.openContracts).toEqual([]);
  expect(detail.installmentBalance).toBeNull();
  expect(detail.availability).toMatchObject({
    contracts: 'unavailable',
    warrantyContracts: 'scoped',
  });
  expect(detail.warrantyContracts).toEqual([
    expect.objectContaining({ id: con.id, contractNumber: con.contractNumber, status: 'ACTIVE' }),
  ]);
  expect(detail.warrantyContracts[0]).not.toHaveProperty('sellingPrice');
  expect(detail.warrantyContracts[0]).not.toHaveProperty('monthlyPayment');
  await db.product.update({ where: { id: con.productId }, data: { branchId: branchB } });
  const moved = (await http('get', '/customers/' + c.id + '/detail', undefined, id).expect(200))
    .body;
  expect(moved.latestPurchase.imeiSerial).toBeNull();
  expect(moved.latestPurchase.productLabel).toBeNull();
  expect(moved.warranty).toMatchObject({
    status: 'IN_SHOP_WARRANTY',
    centerEndDate: null,
    productAvailable: false,
  });
  await db.contract.update({
    where: { id: con.id },
    data: { shopWarrantyEndDate: new Date('2020-01-01') },
  });
  expect(
    (await http('get', '/customers/' + c.id + '/detail', undefined, id).expect(200)).body.warranty
      .status,
  ).toBeNull();
  const hidden = await contract(c.id, branchB, { contractNumber: 'HIDDEN-WARRANTY' });
  expect(
    (await http('get', '/customers?search=' + hidden.contractNumber, undefined, id).expect(200))
      .body.total,
  ).toBe(0);
  expect(
    (
      await http(
        'get',
        '/customers?view=prospects&search=SHOP%20warranty%20seam',
        undefined,
        id,
      ).expect(200)
    ).body.total,
  ).toBe(0);
});
it('requires all sensitive capabilities on the same document source for unclassified document URLs', async () => {
  const id = await reader(['customers.read', 'documents.read'], 'SHOP', [branchA]);
  const c = await customer({ documents: ['https://example.invalid/national-id.pdf'] });
  expect(
    (await http('get', '/customers/' + c.id, undefined, id).expect(200)).body.documents,
  ).toBeNull();
  await grant(
    id,
    [
      'sensitive.customer-identity.read',
      'sensitive.cost.read',
      'sensitive.profit.read',
      'sensitive.salary.read',
      'sensitive.seller-bank.read',
    ],
    'SHOP',
    [branchB],
  );
  expect(
    (await http('get', '/customers/' + c.id, undefined, id).expect(200)).body.documents,
  ).toBeNull();
  await grant(
    id,
    [
      'sensitive.customer-identity.read',
      'sensitive.cost.read',
      'sensitive.profit.read',
      'sensitive.salary.read',
      'sensitive.seller-bank.read',
    ],
    'SHOP',
    [branchA],
  );
  expect(
    (await http('get', '/customers/' + c.id, undefined, id).expect(200)).body.documents,
  ).toEqual(c.documents);
});

it('preserves correlated NOT/every over the authorized set and rejects unknown contributor nodes', async () => {
  const id = await reader(['customers.read'], 'SHOP', [branchA]);
  await grant(id, ['contracts.read'], 'FINANCE', [branchA]);
  const c = await customer();
  await contract(c.id, branchA, { status: 'ACTIVE' });
  await contract(c.id, branchB, { status: 'OVERDUE' });
  const create = PartyQueryPlan.create.bind(PartyQueryPlan);
  let checked = false;
  const spy = jest.spyOn(PartyQueryPlan, 'create').mockImplementation(async (...args) => {
    const plan = await create(...args);
    const where = await scopePartyCustomerWhere(plan, {
      AND: [
        { contracts: { every: { status: 'ACTIVE' } } },
        { NOT: { contracts: { some: { status: 'OVERDUE' } } } },
      ],
    });
    expect(await plan.db.customer.count({ where: { id: c.id, AND: [plan.customer, where] } })).toBe(
      1,
    );
    await expect(
      scopePartyCustomerWhere(plan, { contracts: { some: { payments: { some: {} } } } }),
    ).rejects.toThrow('ไม่รองรับตัวกรอง');
    await expect(scopePartyCustomerWhere(plan, { addressCurrent: 'unsupported' })).rejects.toThrow(
      'ไม่รองรับตัวกรอง',
    );
    checked = true;
    return plan;
  });
  try {
    await http('get', '/customers/' + c.id, undefined, id).expect(200);
  } finally {
    spy.mockRestore();
  }
  expect(checked).toBe(true);
});

it('does not infer global tier completeness from the absence of hidden branch purchases', async () => {
  const id = await reader(['customers.read'], 'SHOP', [branchA]);
  await grant(id, ['contracts.read', 'payments.read', 'repossessions.read'], 'FINANCE', [branchA]);
  const c = await customer({ name: 'Global tier coverage' });
  await contract(c.id);
  const path = '/customers?search=Global%20tier%20coverage';
  expect((await http('get', path, undefined, id).expect(200)).body.data[0].tier).toBeNull();
  await contract(c.id, branchB, { status: 'DEFAULT' });
  expect((await http('get', path, undefined, id).expect(200)).body.data[0].tier).toBeNull();
  await grant(id, ['contracts.read', 'payments.read', 'repossessions.read'], 'FINANCE');
  expect((await http('get', path, undefined, id).expect(200)).body.data[0].tier).toBe('BLACKLIST');
});
it('filters assigned-room owners and contact dates against visible rooms only', async () => {
  const id = await reader(['customers.read', 'chat.read'], 'FINANCE', undefined, true);
  const c = await customer({ name: 'Room owner filters' });
  await db.chatRoom.create({
    data: {
      customerId: c.id,
      channel: 'LINE_FINANCE',
      assignedToId: id,
      lastCustomerAt: new Date(),
    },
  });
  await db.chatRoom.create({
    data: {
      customerId: c.id,
      channel: 'FACEBOOK',
      assignedToId: actor,
      lastCustomerAt: new Date(),
    },
  });
  const path =
    '/customers?company=FINANCE&view=prospects&search=Room%20owner%20filters&contacted=7d&owner=';
  expect((await http('get', path + id, undefined, id).expect(200)).body.total).toBe(1);
  expect((await http('get', path + actor, undefined, id).expect(200)).body.total).toBe(0);
});

it('records only actually projected PII fields for a managed picker read', async () => {
  const id = await reader(['customers.read']);
  const c = await customer({ name: 'PII picker audit', nationalId: '1111111111111' });
  await http('get', '/customers/search?q=PII%20picker%20audit', undefined, id).expect(200);
  const audit = await db.auditLog.findFirstOrThrow({
    where: { userId: id, entityId: c.id, action: 'PII_DECRYPT_MASKED' },
  });
  expect(audit.newValue).toMatchObject({ fields: ['nationalId', 'phone'], role: 'ACCOUNTANT' });
});

it('never turns a hidden acquisition label into picker placeholder or detail WALK_IN', async () => {
  const id = await reader(['customers.read'], 'SHOP', [branchA]);
  const c = await customer({
    name: 'Hidden acquisition',
    acquisitionSource: 'AI_CHAT',
    phone: null,
    nationalId: null,
  });
  const picker = (
    await http('get', '/customers/search?q=Hidden%20acquisition', undefined, id).expect(200)
  ).body[0];
  expect(picker.chatPlaceholder).toBeNull();
  const detail = (await http('get', '/customers/' + c.id + '/detail', undefined, id).expect(200))
    .body;
  expect(detail.source).toBeNull();
  expect(detail.acquisitionSource).toBeNull();
  const referrer = await customer({ accessBranchId: branchB });
  const referral = await customer({ referredById: referrer.id });
  expect(
    (await http('get', '/customers/' + referral.id + '/detail', undefined, id).expect(200)).body
      .source,
  ).toBeNull();
});
it('searches encrypted-only full IDs through the same-source hash match without projecting storage fields', async () => {
  const id = await reader(['customers.read'], 'SHOP', [branchA]);
  const raw = '2223334445556';
  const c = await customer({
    name: 'Encrypted identity',
    nationalId: null,
    nationalIdEncrypted: encryptPII(raw, process.env.PII_ENCRYPTION_KEY!),
    nationalIdHash: hashPII(raw, process.env.PII_HASH_SALT!),
  });
  expect((await http('get', '/customers/search?q=' + raw, undefined, id).expect(200)).body).toEqual(
    [],
  );
  await grant(id, ['sensitive.customer-identity.read'], 'SHOP', [branchA]);
  const allowed = (await http('get', '/customers/search?q=' + raw, undefined, id).expect(200))
    .body[0];
  expect(allowed).toMatchObject({ id: c.id, nationalId: raw });
  expect(Object.keys(allowed).some((key) => /Hash$|Encrypted$/.test(key))).toBe(false);
});

it('keeps global credit status and KPIs stable until fixed company coverage authorizes every source domain', async () => {
  const id = await reader(['customers.read'], 'SHOP', [branchA]);
  await grant(id, ['contracts.read', 'credit-checks.read'], 'FINANCE', [branchA]);
  const c = await customer({
    name: 'Credit coverage control',
    creditCheckStatus: 'FULL_CHECK_PASSED',
  });
  const visible = await contract(c.id, branchA, { status: 'DRAFT' });
  await db.creditCheck.create({
    data: { customerId: c.id, contractId: visible.id, status: 'APPROVED', aiScore: 70 },
  });
  const path = '/customers?view=prospects&search=Credit%20coverage%20control';
  const before = (await http('get', path, undefined, id).expect(200)).body;
  expect(before.data[0]).toMatchObject({
    creditCheckStatus: null,
    latestCreditScore: 70,
    availability: { credit: 'partial' },
  });
  expect(before.summary).toMatchObject({ checkingCredit: null, prechecked: null });
  expect(
    (await http('get', path + '&creditCheckStatus=FULL_CHECK_PASSED', undefined, id).expect(200))
      .body.total,
  ).toBe(0);
  const hidden = await contract(c.id, branchB, { status: 'DRAFT' });
  await db.creditCheck.create({
    data: { customerId: c.id, contractId: hidden.id, status: 'REJECTED', aiScore: 99 },
  });
  await db.customer.update({ where: { id: c.id }, data: { creditCheckStatus: 'REJECTED' } });
  const after = (await http('get', path, undefined, id).expect(200)).body;
  expect(after.data[0]).toMatchObject({
    creditCheckStatus: null,
    latestCreditScore: 70,
    availability: before.data[0].availability,
  });
  expect(after.summary).toEqual(before.summary);
  expect(
    (await http('get', path + '&creditCheckStatus=REJECTED', undefined, id).expect(200)).body.total,
  ).toBe(0);
  await grant(id, ['contracts.read', 'credit-checks.read', 'chat.read'], 'FINANCE');
  await grant(id, ['credit-checks.read', 'chat.read'], 'SHOP');
  await db.customer.update({
    where: { id: c.id },
    data: { creditCheckStatus: 'FULL_CHECK_PASSED' },
  });
  const complete = (await http('get', path, undefined, id).expect(200)).body;
  expect(complete.data[0]).toMatchObject({
    creditCheckStatus: 'FULL_CHECK_PASSED',
    latestCreditScore: 99,
    availability: { credit: 'complete' },
  });
  expect(complete.summary).toMatchObject({ checkingCredit: 0, prechecked: 1 });
  expect(
    (await http('get', path + '&creditCheckStatus=FULL_CHECK_PASSED', undefined, id).expect(200))
      .body.total,
  ).toBe(1);
});
it('makes credit KPIs unavailable for unknown history outside the returned page', async () => {
  const id = await reader(['customers.read', 'credit-checks.read', 'chat.read'], 'SHOP', undefined);
  await grant(id, ['contracts.read', 'credit-checks.read', 'chat.read'], 'FINANCE');
  await customer({ name: 'Credit page A known', creditCheckStatus: 'NONE' });
  const unknown = await customer({
    name: 'Credit page Z unknown',
    creditCheckStatus: 'UNDER_REVIEW',
  });
  await db.creditCheck.create({ data: { customerId: unknown.id, status: 'PENDING' } });
  const result = (
    await http(
      'get',
      '/customers?view=prospects&search=Credit%20page&sortBy=name&sortOrder=asc&limit=1',
      undefined,
      id,
    ).expect(200)
  ).body;
  expect(result.total).toBe(2);
  expect(result.data[0].name).toBe('Credit page A known');
  expect(result.data[0].availability.credit).toBe('complete');
  expect(result.summary).toMatchObject({ checkingCredit: null, prechecked: null });
});

it('fix1 excludes archived current Product fields and IMEI while retaining historical purchase and SHOP warranty', async () => {
  const id = await reader(['customers.read', 'contracts.read', 'products.read'], 'SHOP', [branchA]);
  await grant(id, ['contracts.read'], 'FINANCE', [branchA]);
  const c = await customer({ name: 'Archive product control' });
  const con = await contract(c.id, branchA, {
    deviceReceivedAt: new Date('2020-01-01'),
    shopWarrantyEndDate: new Date('2099-01-01'),
  });
  await db.product.update({
    where: { id: con.productId },
    data: { imeiSerial: 'ARCHIVED-PRODUCT-IMEI', warrantyExpireDate: new Date('2100-01-01') },
  });
  expect(
    (await http('get', '/customers?search=ARCHIVED-PRODUCT-IMEI', undefined, id).expect(200)).body
      .total,
  ).toBe(1);
  await db.product.update({ where: { id: con.productId }, data: { deletedAt: new Date() } });
  expect(
    (await http('get', '/customers?search=ARCHIVED-PRODUCT-IMEI', undefined, id).expect(200)).body
      .total,
  ).toBe(0);
  const detail = (await http('get', '/customers/' + c.id + '/detail', undefined, id).expect(200))
    .body;
  expect(detail.contracts[0].product).toBeNull();
  expect(detail.latestPurchase).toMatchObject({
    number: con.contractNumber,
    kind: 'INSTALLMENT',
    productLabel: null,
    imeiSerial: null,
  });
  expect(detail.warranty).toMatchObject({
    status: 'IN_SHOP_WARRANTY',
    shopEndDate: '2099-01-01T00:00:00.000Z',
    centerEndDate: null,
    productAvailable: false,
  });
  expect(detail.openContracts[0]).toMatchObject({
    productLabel: null,
    imeiSerial: null,
    centerWarrantyEndDate: null,
    availability: { product: false },
  });
  expect(detail.warrantyContracts[0].id).toBe(con.id);
  await grant(id, ['sales.read'], 'SHOP', [branchA]);
  const sale = await db.sale.create({
    data: {
      saleNumber: 'ARCHIVE-SALE-' + randomUUID(),
      saleType: 'CASH',
      customerId: c.id,
      productId: con.productId,
      branchId: branchA,
      salespersonId: actor,
      sellingPrice: 1000,
      netAmount: 1000,
      paymentMethod: 'CASH',
      amountReceived: 1000,
      shopWarrantyEndDate: new Date('2099-01-01'),
    },
  });
  const saleDetail = (
    await http('get', '/customers/' + c.id + '/detail', undefined, id).expect(200)
  ).body;
  expect(saleDetail.sales[0].product).toBeNull();
  expect(saleDetail.latestPurchase).toMatchObject({
    kind: 'CASH',
    number: sale.saleNumber,
    productLabel: null,
    imeiSerial: null,
  });
  expect(saleDetail.warranty).toMatchObject({
    status: 'IN_SHOP_WARRANTY',
    productAvailable: false,
    centerEndDate: null,
  });

  expect(
    (
      await http(
        'get',
        '/customers?view=customers&search=Archive%20product%20control',
        undefined,
        id,
      ).expect(200)
    ).body.total,
  ).toBe(1);
});
async function creditQueryCount(path: string, id: string) {
  capturedQueries = [];
  try {
    const result = (await http('get', path, undefined, id).expect(200)).body;
    // Query events may include a just-finished fixture INSERT ... RETURNING.
    // Count actual reads only, not writes whose SQL names the status column.
    const reads = capturedQueries.filter((sql) => /^\s*SELECT\b/i.test(sql));
    const creditReads = reads.filter((sql) => sql.includes('credit_checks')).length;
    const statusReads = reads.filter(
      (sql) => sql.includes('credit_check_status') && !sql.includes('credit_checks'),
    ).length;
    return { result, creditReads, statusReads };
  } finally {
    capturedQueries = undefined;
  }
}
it('fix1 no-credit prospect search does not scan unrelated visible customer credit histories', async () => {
  const id = await reader(['customers.read']);
  const target = await customer({ name: 'No credit scan target' });
  const path = '/customers?view=prospects&search=No%20credit%20scan%20target&limit=1';
  const before = await creditQueryCount(path, id);
  for (let i = 0; i < 24; i++) await customer({ name: 'Unrelated no credit ' + i });
  const after = await creditQueryCount(path, id);
  expect(after.result.summary).toMatchObject({ checkingCredit: null, prechecked: null });
  expect(after.result.total).toBe(1);
  expect(after.creditReads).toBeLessThanOrEqual(1);
  expect(after.creditReads).toBe(before.creditReads);
  expect(after.statusReads).toBe(before.statusReads);
  await grant(id, ['contracts.read', 'credit-checks.read'], 'FINANCE', [branchA]);
  const con = await contract(target.id, branchA, { status: 'DRAFT' });
  await db.creditCheck.create({
    data: { customerId: target.id, contractId: con.id, status: 'APPROVED' },
  });
  const unavailableGlobal = await creditQueryCount(
    path + '&creditCheckStatus=FULL_CHECK_PASSED',
    id,
  );
  expect(unavailableGlobal.result.total).toBe(0);
  expect(unavailableGlobal.creditReads).toBe(0);
});
it('fix1 batches complete credit status for filtered candidates without per-customer or unrelated reads', async () => {
  const id = await reader(['customers.read', 'credit-checks.read', 'chat.read']);
  await grant(id, ['contracts.read', 'credit-checks.read', 'chat.read'], 'FINANCE');
  await db.customer.createMany({
    data: Array.from({ length: 212 }, (_, i) => ({
      name: 'Batched credit target ' + i,
      creditCheckStatus: 'NONE' as const,
      accessCompanyCode: 'SHOP',
      accessBranchId: branchA,
    })),
  });
  const path =
    '/customers?view=prospects&search=Batched%20credit%20target&limit=1&sortBy=name&sortOrder=asc';
  const before = await creditQueryCount(path, id);
  for (let i = 0; i < 24; i++) await customer({ name: 'Unrelated full credit ' + i });
  const after = await creditQueryCount(path, id);
  expect(after.result.total).toBe(212);
  expect(after.result.summary).toMatchObject({ checkingCredit: 0, prechecked: 0 });
  expect(after.creditReads).toBeLessThanOrEqual(6);
  expect(after.statusReads).toBeLessThanOrEqual(6);
  expect(after.creditReads).toBe(before.creditReads);
  expect(after.statusReads).toBe(before.statusReads);
  const unknown = await db.customer.findFirstOrThrow({
    where: { name: { startsWith: 'Batched credit target ' } },
    orderBy: { id: 'desc' },
  });
  await db.customer.update({
    where: { id: unknown.id },
    data: { name: 'Batched credit target ZZ unknown', creditCheckStatus: 'UNDER_REVIEW' },
  });
  await db.creditCheck.create({ data: { customerId: unknown.id, status: 'PENDING' } });
  const partial = await creditQueryCount(path, id);
  expect(partial.result.data[0].availability.credit).toBe('complete');
  expect(partial.result.summary).toMatchObject({ checkingCredit: null, prechecked: null });
  expect(partial.creditReads).toBeLessThanOrEqual(6);
});
