import { AccessProcurementSourceService } from './access-procurement-source.service';
import { AccessPartyBoundaries } from './access-party-boundaries';
import { AccessPartySourceService } from './access-party-source.service';
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
import { CustomerBlacklistService } from '../customers/customer-blacklist.service';
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
const db = new PrismaClient({ datasources: { db: { url } } });
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
function http(method: 'post' | 'patch' | 'delete', path: string, body?: object, id = actor) {
  const client = request(app.getHttpServer());
  const call = client[method](path)
    .set('x-test-user', id)
    .expect('x-owned-basic-app', testRun)
    .on('response', (response) => {
      if (response.headers['x-owned-basic-app'] !== testRun)
        console.error(
          'OWNED_HTTP_MARKER_MISMATCH',
          JSON.stringify({
            status: response.status,
            marker: response.headers['x-owned-basic-app'] ?? null,
            server: response.headers.server ?? null,
            contentType: response.headers['content-type'] ?? null,
          }),
        );
    });
  call.on('response', (res: request.Response) => {
    if (res.status === 404) console.error('Unexpected fixture 404', method, path, res.body);
  });
  return body ? call.send(body) : call;
}
let sequence = 10000;
function body(extra: object = {}) {
  return {
    name: 'Test customer',
    phone: '08000' + String(++sequence),
    branchId: branchA,
    ...extra,
  };
}
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
      ContactsService,
      ContactResolverService,
      AuditService,
      JourneyEntryWriter,
      ...[
        CustomerQueryService,
        CustomerAnalyticsService,
        CustomerTierService,
        SkipTracingService,
        CustomerInsightsService,
        CustomerMergeService,
        PiiAuditService,
        CustomerBlacklistService,
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
      res.setHeader('x-owned-basic-app', testRun);
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
it('creates a usable explicit origin and returns a narrow acknowledgement', async () => {
  const res = await http('post', '/customers', body()).expect(201);
  expect(Object.keys(res.body)).toEqual(['id']);
});
it('updates and removes an existing proven customer through actual canonical writers', async () => {
  const c = await knownCustomer();
  await http('patch', '/customers/' + c.id, { name: 'Changed' }).expect(200, { id: c.id });
  expect((await db.customer.findUniqueOrThrow({ where: { id: c.id } })).name).toBe('Changed');
  await http('delete', '/customers/' + c.id).expect(200, { id: c.id });
  expect((await db.customer.findUniqueOrThrow({ where: { id: c.id } })).deletedAt).not.toBeNull();
});
it('ensures an actual customer child independently at an authorized destination', async () => {
  const c = await db.contact.create({
    data: { contactCode: 'P-90000', name: 'Seller', roles: ['TRADE_IN_SELLER'] },
  });
  await db.tradeIn.create({
    data: {
      sellerContactId: c.id,
      branchId: branchA,
      deviceBrand: 'Apple',
      deviceModel: 'Evidence',
    },
  });
  const res = await http('post', '/contacts/' + c.id + '/ensure-role', {
    role: 'CUSTOMER',
    branchId: branchA,
  }).expect(201);
  expect(res.body.customerId).toEqual(expect.any(String));
  expect(res.body).not.toHaveProperty('nationalIdHash');
});
it('Task 27: managed unlink of the FINANCE LINE closes the OTP row via the canonical writer and acknowledges narrowly', async () => {
  const c = await knownCustomer();
  await db.customerLineLink.create({
    data: { customerId: c.id, lineUserId: 'U-' + randomUUID(), channel: 'FINANCE' },
  });
  await http('post', '/customers/' + c.id + '/finance-line/unlink', undefined, denied).expect(403);
  expect(await db.customerLineLink.count({ where: { customerId: c.id, unlinkedAt: null } })).toBe(
    1,
  );
  await http('post', '/customers/' + c.id + '/finance-line/unlink').expect(201, { id: c.id });
  expect(await db.customerLineLink.count({ where: { customerId: c.id, unlinkedAt: null } })).toBe(
    0,
  );
  expect(
    await db.auditLog.count({
      where: { entityId: c.id, action: 'CUSTOMER_FINANCE_LINE_UNLINKED', userId: actor },
    }),
  ).toBe(1);
});
it('denies all four routes with no grants', async () => {
  const c = await knownCustomer();
  await http('post', '/customers', body(), denied).expect(403);
  await http('patch', '/customers/' + c.id, { name: 'Denied' }, denied).expect(403);
  await http('delete', '/customers/' + c.id, undefined, denied).expect(403);
  await http(
    'post',
    '/contacts/' + randomUUID() + '/ensure-role',
    { role: 'CUSTOMER', branchId: branchA },
    denied,
  ).expect(403);
});

import { hashPII } from '../../utils/pii.util';
import {
  customerPartyWhere,
  contactPartyWhere,
  partyRoomReadWhere,
  financeContractReadWhere,
} from './access-party-scope';
import { AccessTradeInProjectionService } from './access-trade-in-projection.service';
import { partyIdentityView } from './access-party-source.service';
import { lockEmployeeAccess } from './access-snapshot.service';
const capabilities: PermissionKey[] = [
  'customers.read',
  'customers.create',
  'customers.update',
  'customers.delete',
  'contacts.read',
  'contacts.update',
  'suppliers.read',
  'suppliers.create',
];
async function scoped(
  branches?: string[],
  company = 'SHOP',
  permissions = capabilities,
  assigned = false,
) {
  const id = await user();
  await grant(id, permissions, company, branches, assigned ? 'ASSIGNED' : undefined);
  return id;
}
async function createCustomer(extra: object = {}, id = actor, path = '/customers') {
  return (await http('post', path, body(extra), id).expect(201)).body.id as string;
}
async function contact(extra: object = {}) {
  return db.contact.create({
    data: {
      contactCode: 'P-' + String(++sequence),
      name: 'Contact',
      roles: [],
      accessCompanyCode: 'SHOP',
      accessBranchId: branchA,
      ...extra,
    },
  });
}
function scope(
  userId: string,
  company: 'SHOP' | 'FINANCE' = 'SHOP',
  branchIds?: string[],
  assigned = false,
) {
  return {
    userId,
    company,
    permission: 'customers.read' as const,
    tuples: [
      {
        userId,
        scope: assigned
          ? ('ASSIGNED' as const)
          : branchIds
            ? ('BRANCHES' as const)
            : ('COMPANY' as const),
        branchIds: branchIds ?? [],
      },
    ],
  };
}
it('stamps only new origins, has no autoassignment, and makes the lead selectable in prior party seams', async () => {
  const id = await createCustomer();
  const row = await db.customer.findUniqueOrThrow({ where: { id } });
  expect(row).toMatchObject({
    accessCompanyCode: 'SHOP',
    accessBranchId: branchA,
    assignedToId: null,
  });
  expect(await db.contact.findUnique({ where: { id: row.contactId! } })).toMatchObject({
    accessCompanyCode: 'SHOP',
    accessBranchId: branchA,
    assignedToId: null,
  });
  expect(
    await db.customer.count({
      where: { id, AND: customerPartyWhere(scope(actor, 'SHOP', [branchA])) },
    }),
  ).toBe(1);
  expect(
    await db.customer.count({
      where: { id, AND: customerPartyWhere(scope(actor, 'SHOP', [branchB])) },
    }),
  ).toBe(0);
  const projection = new AccessTradeInProjectionService(
    new AccessResourceService(db as PrismaService, snapshots),
  );
  expect(
    await projection.partyAllows(
      db,
      await snapshots.forUser(actor),
      id,
      'customerId',
      'customers.read',
    ),
  ).toBe(true);
  expect(
    await db.customer.count({ where: customerPartyWhere({ ...scope(actor), tuples: [] }) }),
  ).toBe(0);
  expect(
    await db.contact.count({ where: contactPartyWhere({ ...scope(actor), tuples: [] }) }),
  ).toBe(0);
});
it('preserves each original position tuple and does not infer a destination branch', async () => {
  const id = await scoped([branchA], 'SHOP', ['customers.create']);
  await grant(id, ['customers.read', 'customers.update'], 'SHOP', [branchB]);
  await http('post', '/customers', body({ branchId: branchB }), id).expect(403);
  await http('post', '/customers', body({ branchId: undefined }), id).expect(403);
  await http('post', '/customers', body({ branchId: branchA }), id).expect(201);
});
it('accepts true FINANCE central or explicit live SHOP origin and keeps company separate', async () => {
  const id = await scoped(undefined, 'FINANCE');
  const central = await createCustomer({ branchId: null }, id, '/customers?company=FINANCE');
  expect(await db.customer.findUnique({ where: { id: central } })).toMatchObject({
    accessCompanyCode: 'FINANCE',
    accessBranchId: null,
  });
  const sourced = await createCustomer({ branchId: branchA }, id, '/customers?company=FINANCE');
  expect(await db.customer.findUnique({ where: { id: sourced } })).toMatchObject({
    accessCompanyCode: 'FINANCE',
    accessBranchId: branchA,
  });
  await http('patch', '/customers/' + sourced, { name: 'Denied SHOP' }, actor).expect(403);
  const finance = await db.companyInfo.findUniqueOrThrow({ where: { companyCode: 'FINANCE' } });
  const invalid = await db.branch.create({
    data: { name: 'Not a SHOP origin', companyId: finance.id },
  });
  await http('post', '/customers?company=FINANCE', body({ branchId: invalid.id }), id).expect(403);
});
it('requires update/read at all actual sources, even when explicit origin is in scope', async () => {
  const id = await createCustomer();
  await db.tradeIn.create({
    data: { customerId: id, branchId: branchB, deviceBrand: 'Apple', deviceModel: 'Evidence' },
  });
  const a = await scoped([branchA]);
  await http('patch', '/customers/' + id, { name: 'Cross source' }, a).expect(403);
  await http('delete', '/customers/' + id, undefined, a).expect(403);
  await http('patch', '/customers/' + id, { name: 'All source' }, actor).expect(200);
});
it('explicit assignment needs independent non-ASSIGNED authority, is audited, and never grants positions', async () => {
  const assignee = await scoped(undefined, 'SHOP', capabilities, true);
  await http('post', '/customers', body({ assignedToId: assignee }), assignee).expect(403);
  const id = await createCustomer({ assignedToId: assignee });
  await http('patch', '/customers/' + id, { name: 'Assigned edit' }, assignee).expect(200);
  await http('patch', '/customers/' + id, { assignedToId: actor }, assignee).expect(403);
  await http('patch', '/customers/' + id, { assignedToId: actor }, actor).expect(200);
  await http('patch', '/customers/' + id, { name: 'Old assignee' }, assignee).expect(403);
  const audit = await db.auditLog.findFirst({
    where: { entityId: id, action: 'CUSTOMER_UPDATED' },
    orderBy: { createdAt: 'desc' },
  });
  expect(audit?.oldValue).toMatchObject({ assignedToId: assignee });
  expect(audit?.newValue).toMatchObject({ assignedToId: actor });
  const inactive = await user();
  await db.user.update({ where: { id: inactive }, data: { isActive: false } });
  await http('patch', '/customers/' + id, { assignedToId: inactive }).expect(403);
});
it('Contact assignment and new child assignment are independent and retry idempotent', async () => {
  const c = await contact();
  const target = await user();
  const payload = {
    role: 'CUSTOMER',
    branchId: branchA,
    assignedToId: actor,
    customerAssignedToId: target,
  };
  const first = await http('post', '/contacts/' + c.id + '/ensure-role', payload).expect(201);
  expect(await db.contact.findUnique({ where: { id: c.id } })).toMatchObject({
    assignedToId: actor,
  });
  expect(await db.customer.findUnique({ where: { id: first.body.customerId } })).toMatchObject({
    assignedToId: target,
  });
  await http('post', '/contacts/' + c.id + '/ensure-role', payload).expect(201, {
    ...first.body,
    provisioned: false,
  });
  await http('post', '/contacts/' + c.id + '/ensure-role', {
    ...payload,
    customerAssignedToId: actor,
  }).expect(400);
  const audit = await db.auditLog.findFirst({
    where: { entityId: c.id, action: 'CONTACT_ROLE_ADDED' },
  });
  expect(audit?.oldValue).toMatchObject({ assignedToId: null });
  expect(audit?.newValue).toMatchObject({ assignedToId: actor, customerAssignedToId: target });
});
it('child create is independent from contacts.update and pure reuse needs actual child read', async () => {
  const c = await contact();
  const parentOnly = await scoped([branchA], 'SHOP', ['contacts.read', 'contacts.update']);
  await http(
    'post',
    '/contacts/' + c.id + '/ensure-role',
    { role: 'CUSTOMER', branchId: branchA },
    parentOnly,
  ).expect(403);
  const first = await http('post', '/contacts/' + c.id + '/ensure-role', {
    role: 'CUSTOMER',
    branchId: branchA,
  }).expect(201);
  await http('post', '/contacts/' + c.id + '/ensure-role', { role: 'CUSTOMER' }, parentOnly).expect(
    403,
  );
  await grant(parentOnly, ['customers.read'], 'SHOP', [branchA]);
  await http('post', '/contacts/' + c.id + '/ensure-role', { role: 'CUSTOMER' }, parentOnly).expect(
    201,
    { ...first.body, provisioned: false },
  );
  const supplier = await http('post', '/contacts/' + c.id + '/ensure-role', {
    role: 'SUPPLIER',
    branchId: branchA,
  }).expect(201);
  expect(await db.supplier.findUnique({ where: { id: supplier.body.supplierId } })).toMatchObject({
    accessCompanyCode: 'SHOP',
    accessBranchId: branchA,
  });
});
it('does not mutate a hidden Contact through natural-key role append or leak duplicate history', async () => {
  const nid = '1234567890123',
    nationalIdHash = hashPII(nid, process.env.PII_HASH_SALT!);
  const c = await contact({ nationalIdHash, accessBranchId: branchB, roles: ['SUPPLIER'] });
  const a = await scoped([branchA]);
  await http('post', '/customers', body({ nationalId: nid, isForeigner: true }), a).expect(409);
  expect((await db.contact.findUniqueOrThrow({ where: { id: c.id } })).roles).toEqual(['SUPPLIER']);
  const payload = body({ nationalId: '1234567890124', isForeigner: true, branchId: branchB });
  await http('post', '/customers', payload).expect(201);
  const conflict = await http('post', '/customers', { ...payload, branchId: branchA }, a).expect(
    409,
  );
  expect(Object.keys(conflict.body).sort()).toEqual(['error', 'message', 'statusCode']);
  expect(conflict.body).not.toHaveProperty('existingCustomer');
});
it('revives ghosts and enriches stubs without changing their immutable origins', async () => {
  const nid = '1234567890125';
  const payload = body({ nationalId: nid, isForeigner: true });
  const first = await http('post', '/customers', payload).expect(201);
  await http('delete', '/customers/' + first.body.id).expect(200);
  const revived = await http('post', '/customers', { ...payload, branchId: branchB }).expect(201);
  expect(revived.body.id).toBe(first.body.id);
  expect(await db.customer.findUnique({ where: { id: first.body.id } })).toMatchObject({
    accessBranchId: branchA,
    deletedAt: null,
  });
  const c = await contact({ nationalIdHash: hashPII('1234567890126', process.env.PII_HASH_SALT!) });
  const stub = await http('post', '/contacts/' + c.id + '/ensure-role', {
    role: 'CUSTOMER',
    branchId: branchA,
  }).expect(201);
  const upgraded = await http(
    'post',
    '/customers',
    body({ nationalId: '1234567890126', isForeigner: true, branchId: branchB }),
  ).expect(201);
  expect(upgraded.body.id).toBe(stub.body.customerId);
  expect(await db.customer.findUnique({ where: { id: upgraded.body.id } })).toMatchObject({
    accessBranchId: branchA,
  });
  await expect(
    db.customer.update({ where: { id: upgraded.body.id }, data: { accessBranchId: branchB } }),
  ).rejects.toThrow();
});
it('linked global lenders require both companies COMPANY authority for Contact mutation', async () => {
  const c = await contact();
  await db.externalFinanceCompany.create({ data: { name: randomUUID(), contactId: c.id } });
  await http('post', '/contacts/' + c.id + '/ensure-role', { role: 'TRADE_IN_SELLER' }).expect(403);
  const both = await scoped();
  await grant(both, ['contacts.read', 'contacts.update'], 'FINANCE');
  await http(
    'post',
    '/contacts/' + c.id + '/ensure-role',
    { role: 'TRADE_IN_SELLER' },
    both,
  ).expect(201);
});
it('late required audit failure rolls back Customer, Contact, assignment and evidence', async () => {
  const audit = app.get(AuditService);
  const original = audit.log.bind(audit);
  const spy = jest.spyOn(audit, 'log').mockImplementation(async (entry, tx) => {
    await original(entry, tx);
    throw new Error('injected late audit failure');
  });
  const before = {
    customer: await db.customer.count(),
    contact: await db.contact.count(),
    audit: await db.auditLog.count(),
  };
  await http('post', '/customers', body({ assignedToId: actor })).expect(500);
  expect(await db.customer.count()).toBe(before.customer);
  expect(await db.contact.count()).toBe(before.contact);
  expect(await db.auditLog.count()).toBe(before.audit);
  spy.mockRestore();
});
it('real concurrent canonical create preserves unique national ID, phone/email and contact numbering', async () => {
  const payload = body({
    nationalId: '1234567890127',
    isForeigner: true,
    email: 'same@test.invalid',
  });
  const responses = await Promise.all([
    http('post', '/customers', payload),
    http('post', '/customers', payload),
  ]);
  expect(responses.map((r) => r.status).sort()).toEqual([201, 409]);
  expect(
    await db.customer.count({
      where: { nationalIdHash: hashPII('1234567890127', process.env.PII_HASH_SALT!) },
    }),
  ).toBe(1);
  const contacts = await db.contact.findMany({ select: { contactCode: true } });
  expect(new Set(contacts.map((c) => c.contactCode)).size).toBe(contacts.length);
});
it('waited authority is reloaded after revocation in the owning transaction', async () => {
  const id = await user();
  const assignment = await grant(id, capabilities, 'SHOP', [branchA]);
  let release!: () => void, locked!: () => void;
  const ready = new Promise<void>((r) => (locked = r)),
    gate = new Promise<void>((r) => (release = r));
  const blocker = db.$transaction(
    async (tx) => {
      await lockEmployeeAccess(tx);
      locked();
      await gate;
      await tx.employeeAccessAssignment.update({
        where: { id: assignment.id },
        data: { deletedAt: new Date() },
      });
    },
    { timeout: 10000 },
  );
  await ready;
  const pending = http('post', '/customers', body(), id).then((r) => r);
  await new Promise((r) => setTimeout(r, 100));
  release();
  await blocker;
  expect((await pending).status).toBe(403);
});
it('independent full-ID permission neither grants base access nor combines different sources', async () => {
  const id = await scoped([branchA], 'SHOP', ['customers.read']);
  await grant(id, ['sensitive.customer-identity.read'], 'SHOP', [branchB]);
  const snapshot = await snapshots.forUser(id),
    input = { nationalId: '1234567890123', guardianNationalId: '1234567890124' };
  expect(
    partyIdentityView(input, snapshot, [{ company: 'SHOP', branchId: branchA }]).nationalId,
  ).not.toBe(input.nationalId);
  await grant(id, ['sensitive.customer-identity.read'], 'SHOP', [branchA]);
  expect(
    partyIdentityView(input, await snapshots.forUser(id), [{ company: 'SHOP', branchId: branchA }]),
  ).toEqual(input);
  const only = await scoped(undefined, 'SHOP', ['sensitive.customer-identity.read']);
  expect(
    partyIdentityView(input, await snapshots.forUser(only), [
      { company: 'SHOP', branchId: branchA },
    ]).nationalId,
  ).not.toBe(input.nationalId);
  expect(partyRoomReadWhere(scope(id, 'SHOP', [branchA], true))).toEqual({ id: { in: [] } });
  expect(financeContractReadWhere(scope(id, 'SHOP'))).toEqual({ id: { in: [] } });
});

async function waitedChange<T>(
  change: (
    tx: import('@prisma/client').Prisma.TransactionClient,
    locked: () => void,
    gate: Promise<void>,
  ) => Promise<void>,
  action: () => Promise<T>,
) {
  let release!: () => void, locked!: () => void;
  const ready = new Promise<void>((r) => (locked = r)),
    gate = new Promise<void>((r) => (release = r));
  const blocker = db.$transaction((tx) => change(tx, locked, gate), { timeout: 15000 });
  await ready;
  const pending = action();
  let waiting = false;
  for (let attempt = 0; attempt < 80; attempt++) {
    const rows = await db.$queryRaw<
      Array<{ waiting: boolean }>
    >`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND pid<>pg_backend_pid()) AS waiting`;
    if (rows[0].waiting) {
      waiting = true;
      break;
    }
    await new Promise((r) => setTimeout(r, 20));
  }
  release();
  await blocker;
  expect(waiting).toBe(true);
  return pending;
}
it('rechecks current Customer assignment after a real row-lock wait', async () => {
  const assigned = await scoped(undefined, 'SHOP', capabilities, true),
    other = await user();
  const id = await createCustomer({ assignedToId: assigned });
  const response = await waitedChange(
    async (tx, locked, gate) => {
      await tx.$queryRaw`SELECT id FROM customers WHERE id=${id} FOR UPDATE`;
      locked();
      await gate;
      await tx.customer.update({ where: { id }, data: { assignedToId: other } });
    },
    () => http('patch', '/customers/' + id, { name: 'Stale assignment' }, assigned).then((r) => r),
  );
  expect(response.status).toBe(403);
  expect((await db.customer.findUniqueOrThrow({ where: { id } })).name).toBe('Test customer');
});
it('rechecks live source after a real source-row wait', async () => {
  const shop = await db.companyInfo.findUniqueOrThrow({ where: { companyCode: 'SHOP' } });
  const branch = await db.branch.create({ data: { name: 'To retire', companyId: shop.id } });
  const id = await createCustomer({ branchId: branch.id });
  const response = await waitedChange(
    async (tx, locked, gate) => {
      await tx.$queryRaw`SELECT id FROM branches WHERE id=${branch.id} FOR UPDATE`;
      locked();
      await gate;
      await tx.branch.update({ where: { id: branch.id }, data: { isActive: false } });
    },
    () => http('patch', '/customers/' + id, { name: 'Stale source' }).then((r) => r),
  );
  expect(response.status).toBe(403);
});
it('late child audit failure rolls back actual child, shared role and Contact assignment', async () => {
  const c = await contact();
  const audit = app.get(AuditService),
    original = audit.log.bind(audit);
  const spy = jest.spyOn(audit, 'log').mockImplementation(async (entry, tx) => {
    await original(entry, tx);
    throw new Error('injected child audit failure');
  });
  await http('post', '/contacts/' + c.id + '/ensure-role', {
    role: 'CUSTOMER',
    branchId: branchA,
    assignedToId: actor,
    customerAssignedToId: actor,
  }).expect(500);
  expect(await db.customer.count({ where: { contactId: c.id } })).toBe(0);
  expect(await db.contact.findUnique({ where: { id: c.id } })).toMatchObject({
    roles: [],
    assignedToId: null,
  });
  expect(await db.auditLog.count({ where: { entityId: c.id } })).toBe(0);
  spy.mockRestore();
});
it('late required journey failure rolls back updated PII and audit', async () => {
  const c = await db.customer.create({
    data: { name: 'Blank', phone: null, accessCompanyCode: 'SHOP', accessBranchId: branchA },
  });
  const writer = app.get(JourneyEntryWriter),
    original = writer.recordInTx.bind(writer);
  const spy = jest.spyOn(writer, 'recordInTx').mockImplementation(async (tx, entry) => {
    await original(tx, entry);
    throw new Error('injected journey failure');
  });
  await http('patch', '/customers/' + c.id, { phone: '0899999998' }).expect(500);
  expect(await db.customer.findUnique({ where: { id: c.id } })).toMatchObject({
    phone: null,
    phoneHash: null,
    phoneEncrypted: null,
  });
  expect(await db.customerJourneyEntry.count({ where: { customerId: c.id } })).toBe(0);
  spy.mockRestore();
});
it('strict PII business loads remain inside the owned transaction', async () => {
  const c = await knownCustomer();
  await db.systemConfig.upsert({
    where: { key: 'PDPA_STRICT_MODE' },
    create: { key: 'PDPA_STRICT_MODE', value: 'true' },
    update: { value: 'true' },
  });
  await http('patch', '/customers/' + c.id, { name: 'Cannot bypass strict' }).expect(400);
  await db.systemConfig.update({ where: { key: 'PDPA_STRICT_MODE' }, data: { value: 'false' } });
});
it('concurrent email identity checks with distinct phones remain atomic', async () => {
  const email = 'concurrent-email@test.invalid';
  const responses = await Promise.all([
    http('post', '/customers', body({ email })),
    http('post', '/customers', body({ email })),
  ]);
  expect(responses.map((r) => r.status).sort()).toEqual([201, 409]);
  expect(await db.customer.count({ where: { email } })).toBe(1);
});
it('read-only idempotent reuse can use a live source without treating an invalid sibling as mutation authority', async () => {
  const c = await contact();
  const first = await http('post', '/contacts/' + c.id + '/ensure-role', {
    role: 'CUSTOMER',
    branchId: branchA,
  }).expect(201);
  await db.tradeIn.create({
    data: {
      sellerContactId: c.id,
      branchId: null,
      submissionSource: 'OFFLINE',
      deviceBrand: 'Apple',
      deviceModel: 'Unknown source',
    },
  });
  await http('post', '/contacts/' + c.id + '/ensure-role', { role: 'CUSTOMER' }).expect(201, {
    ...first.body,
    provisioned: false,
  });
  await http('post', '/contacts/' + c.id + '/ensure-role', {
    role: 'SUPPLIER',
    branchId: branchA,
  }).expect(403);
});

import { canAccess } from '@installment/shared';
it('ordinary FINANCE and room sources retain actual current assignments without granting global identity mutation', async () => {
  const id = await createCustomer();
  const worker = await scoped(
    undefined,
    'FINANCE',
    ['contracts.read', 'customers.read', 'customers.update'],
    true,
  );
  await grant(worker, ['customers.read', 'customers.update'], 'SHOP', undefined, 'ASSIGNED');
  const product = await db.product.create({
    data: {
      name: 'Source',
      brand: 'Apple',
      model: 'Test',
      category: 'PHONE_NEW',
      costPrice: 100,
      branchId: branchA,
    },
  });
  const contract = await db.contract.create({
    data: {
      contractNumber: randomUUID(),
      customerId: id,
      productId: product.id,
      branchId: branchA,
      salespersonId: actor,
      assignedToId: worker,
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
  const sources = app.get(AccessPartySourceService);
  const source = await sources.financeContract(db, contract.id);
  expect(source).toEqual({ company: 'FINANCE', branchId: branchA, assignedUserIds: [worker] });
  expect(canAccess(await snapshots.forUser(worker), 'contracts.read', source)).toBe(true);
  await http(
    'patch',
    '/customers/' + id + '?company=FINANCE',
    { name: 'Case assignment is not identity assignment' },
    worker,
  ).expect(403);
  const room = await db.chatRoom.create({
    data: { customerId: id, channel: 'LINE_FINANCE', assignedToId: worker },
  });
  expect(await sources.room(db, room.id)).toEqual({
    company: 'FINANCE',
    assignedUserIds: [worker],
  });
  expect(
    await db.chatRoom.count({
      where: { id: room.id, AND: partyRoomReadWhere(scope(worker, 'FINANCE', [branchA], true)) },
    }),
  ).toBe(0);
  expect(
    await db.chatRoom.count({
      where: { id: room.id, AND: partyRoomReadWhere(scope(worker, 'FINANCE', undefined, true)) },
    }),
  ).toBe(1);
  const finance = await db.companyInfo.findUniqueOrThrow({ where: { companyCode: 'FINANCE' } });
  await db.companyInfo.update({ where: { id: finance.id }, data: { isActive: false } });
  await expect(sources.financeContract(db, contract.id)).rejects.toThrow();
  await expect(sources.room(db, room.id)).rejects.toThrow();
  await db.companyInfo.update({ where: { id: finance.id }, data: { isActive: true } });
});
it('migration leaves unknown origins null and rejects branch-only or changed provenance', async () => {
  const old = await knownCustomer();
  expect(old).toMatchObject({ accessCompanyCode: null, accessBranchId: null, assignedToId: null });
  await expect(
    db.customer.create({ data: { name: 'Invalid origin', accessBranchId: branchA } }),
  ).rejects.toThrow();
  await expect(
    db.customer.update({
      where: { id: old.id },
      data: { accessCompanyCode: 'SHOP', accessBranchId: branchA },
    }),
  ).rejects.toThrow();
});
it('Supplier evidence is canonical and adds every real linked origin to a Contact mutation', async () => {
  const c = await contact();
  await db.supplier.create({
    data: {
      name: 'Shared supplier',
      phone: '',
      contactId: c.id,
      accessCompanyCode: 'SHOP',
      accessBranchId: branchB,
    },
  });
  const branchOnly = await scoped([branchA]);
  await http(
    'post',
    '/contacts/' + c.id + '/ensure-role',
    { role: 'TRADE_IN_SELLER' },
    branchOnly,
  ).expect(403);
  await http('post', '/contacts/' + c.id + '/ensure-role', { role: 'TRADE_IN_SELLER' }).expect(201);
});
it('Contact reassignment clearing records the actual null after-value', async () => {
  const c = await contact({ roles: ['TRADE_IN_SELLER'], assignedToId: actor });
  await http('post', '/contacts/' + c.id + '/ensure-role', {
    role: 'TRADE_IN_SELLER',
    assignedToId: null,
  }).expect(201);
  const audit = await db.auditLog.findFirst({
    where: { entityId: c.id, action: 'CONTACT_ROLE_ADDED' },
  });
  expect(audit?.oldValue).toMatchObject({ assignedToId: actor });
  expect(audit?.newValue).toMatchObject({ assignedToId: null });
});
it('repeated independent ghost create/delete/revive cycles retain the same identity and source', async () => {
  for (let attempt = 0; attempt < 5; attempt++) {
    const payload = body({ nationalId: String(9000000001000 + attempt), isForeigner: true });
    const first = await http('post', '/customers', payload).expect(201);
    await http('delete', '/customers/' + first.body.id).expect(200);
    const revived = await http('post', '/customers', { ...payload, branchId: branchB }).expect(201);
    expect(revived.body).toEqual(first.body);
    expect(await db.customer.findUnique({ where: { id: first.body.id } })).toMatchObject({
      accessBranchId: branchA,
      deletedAt: null,
    });
  }
});
it('archived Contact ghost revival preserves the actual linked identity and original source', async () => {
  const payload = body({ nationalId: '9000000002001', isForeigner: true });
  const first = await http('post', '/customers', payload).expect(201);
  const customer = await db.customer.findUniqueOrThrow({ where: { id: first.body.id } });
  const original = await db.contact.findUniqueOrThrow({ where: { id: customer.contactId! } });
  await http('delete', '/customers/' + customer.id).expect(200);
  await db.contact.update({
    where: { id: original.id },
    data: { deletedAt: new Date(), assignedToId: actor },
  });
  const revived = await http('post', '/customers', {
    ...payload,
    name: 'New customer name',
    branchId: branchB,
  }).expect(201);
  expect(revived.body.id).toBe(customer.id);
  expect(await db.customer.findUniqueOrThrow({ where: { id: customer.id } })).toMatchObject({
    contactId: original.id,
  });
  expect(await db.contact.findUniqueOrThrow({ where: { id: original.id } })).toMatchObject({
    deletedAt: null,
    contactCode: original.contactCode,
    name: original.name,
    accessBranchId: branchA,
    assignedToId: actor,
  });
  expect(
    await db.auditLog.count({ where: { entityId: original.id, action: 'CONTACT_REVIVED' } }),
  ).toBe(1);
});
it('archived Contact standalone reuse requires original source and rejects inactive or ambiguous identities', async () => {
  for (const scenario of ['allowed', 'hidden', 'inactive', 'ambiguous', 'unknown'] as const) {
    const nationalId = String(9000000002100 + sequence++);
    const hash = hashPII(nationalId, process.env.PII_HASH_SALT!);
    const original = await contact({
      nationalIdHash: hash,
      deletedAt: new Date(),
      isActive: scenario !== 'inactive',
      ...(scenario === 'unknown' ? { accessCompanyCode: null, accessBranchId: null } : {}),
    });
    if (scenario === 'ambiguous') await contact({ nationalIdHash: hash, deletedAt: new Date() });
    const caller = scenario === 'hidden' ? await scoped([branchB]) : actor;
    const result = await http(
      'post',
      '/customers',
      body({ nationalId, isForeigner: true, branchId: branchB }),
      caller,
    ).expect(scenario === 'allowed' ? 201 : 409);
    expect(await db.contact.count({ where: { nationalIdHash: hash } })).toBe(
      scenario === 'ambiguous' ? 2 : 1,
    );
    const after = await db.contact.findUniqueOrThrow({ where: { id: original.id } });
    if (scenario === 'allowed') {
      expect(after.deletedAt).toBeNull();
      expect(after.accessBranchId).toBe(branchA);
      expect(await db.customer.findUniqueOrThrow({ where: { id: result.body.id } })).toMatchObject({
        contactId: original.id,
      });
    } else expect(after.deletedAt).not.toBeNull();
  }
});
it('archived Contact ghost link conflicts with a different live match and revival rolls back on audit failure', async () => {
  const payload = body({ nationalId: '9000000002003', isForeigner: true });
  const first = await http('post', '/customers', payload).expect(201);
  const customer = await db.customer.findUniqueOrThrow({ where: { id: first.body.id } });
  const original = await db.contact.findUniqueOrThrow({ where: { id: customer.contactId! } });
  await http('delete', '/customers/' + customer.id).expect(200);
  await db.contact.update({ where: { id: original.id }, data: { deletedAt: new Date() } });
  const other = await contact({ nationalIdHash: original.nationalIdHash });
  await http('post', '/customers', payload).expect(409);
  await db.contact.delete({ where: { id: other.id } });
  const audit = app.get(AuditService);
  const spy = jest
    .spyOn(audit, 'log')
    .mockRejectedValueOnce(new Error('archived revival audit fault'));
  try {
    await http('post', '/customers', payload).expect(500);
  } finally {
    spy.mockRestore();
  }
  expect(
    (await db.contact.findUniqueOrThrow({ where: { id: original.id } })).deletedAt,
  ).not.toBeNull();
  expect(
    (await db.customer.findUniqueOrThrow({ where: { id: customer.id } })).deletedAt,
  ).not.toBeNull();
});
it('archived Contact revival can use only its exact ghost link as historical source proof', async () => {
  const nationalId = '9000000002004';
  const hash = hashPII(nationalId, process.env.PII_HASH_SALT!);
  const original = await contact({
    nationalIdHash: hash,
    accessCompanyCode: null,
    accessBranchId: null,
    deletedAt: new Date(),
  });
  const ghost = await knownCustomer();
  await db.customer.update({
    where: { id: ghost.id },
    data: { deletedAt: new Date(), nationalIdHash: hash, contactId: original.id },
  });
  const result = await http(
    'post',
    '/customers',
    body({ nationalId, isForeigner: true, branchId: branchB }),
  ).expect(201);
  expect(result.body.id).toBe(ghost.id);
  expect(await db.contact.findUniqueOrThrow({ where: { id: original.id } })).toMatchObject({
    deletedAt: null,
    accessCompanyCode: null,
    accessBranchId: null,
  });
  expect(
    (
      await db.auditLog.findFirstOrThrow({
        where: { entityId: ghost.id, action: 'CUSTOMER_REVIVED' },
      })
    ).newValue,
  ).toMatchObject({ contactId: original.id });
});
it('rechecks linked lender activity after an actual source-row wait', async () => {
  const c = await contact();
  const lender = await db.externalFinanceCompany.create({
    data: { name: randomUUID(), contactId: c.id, isActive: false },
  });
  const response = await waitedChange(
    async (tx, locked, gate) => {
      await tx.$queryRaw`SELECT id FROM external_finance_companies WHERE id=${lender.id} FOR UPDATE`;
      locked();
      await gate;
      await tx.externalFinanceCompany.update({
        where: { id: lender.id },
        data: { isActive: true },
      });
    },
    () =>
      http('post', '/contacts/' + c.id + '/ensure-role', { role: 'TRADE_IN_SELLER' }).then(
        (r) => r,
      ),
  );
  expect(response.status).toBe(403);
  expect((await db.contact.findUniqueOrThrow({ where: { id: c.id } })).roles).not.toContain(
    'TRADE_IN_SELLER',
  );
});
it.each(['create', 'update'] as const)(
  'read-only referrer selection allows %s through a live source despite an invalid sibling',
  async (operation) => {
    const referrer = await db.customer.create({
      data: { name: 'Readable referrer', accessCompanyCode: 'SHOP', accessBranchId: branchA },
    });
    await db.tradeIn.create({
      data: {
        customerId: referrer.id,
        branchId: null,
        submissionSource: 'OFFLINE',
        deviceBrand: 'Apple',
        deviceModel: 'Unknown origin',
      },
    });
    const caller = await scoped([branchA]);
    const targetId = operation === 'update' ? await createCustomer() : undefined;
    const result =
      operation === 'create'
        ? await http(
            'post',
            '/customers',
            body({ referredById: referrer.id, assignedToId: caller }),
            caller,
          ).expect(201)
        : await http(
            'patch',
            '/customers/' + targetId,
            { referredById: referrer.id, assignedToId: caller },
            caller,
          ).expect(200);
    expect(await db.customer.findUniqueOrThrow({ where: { id: result.body.id } })).toMatchObject({
      referredById: referrer.id,
      assignedToId: caller,
    });
    expect(await db.customer.findUniqueOrThrow({ where: { id: referrer.id } })).toEqual(referrer);
    if (operation === 'update') {
      await http('patch', '/customers/' + result.body.id, { referredById: null }, caller).expect(
        200,
      );
      expect(
        (await db.customer.findUniqueOrThrow({ where: { id: result.body.id } })).referredById,
      ).toBeNull();
    }
  },
);
it.each([
  ['create', 'unknown'],
  ['update', 'unknown'],
  ['create', 'hidden'],
  ['update', 'hidden'],
] as const)(
  'read-only referrer selection denies %s when its only source is %s',
  async (operation, source) => {
    const referrer = await db.customer.create({
      data: {
        name: 'Unavailable referrer',
        ...(source === 'hidden' ? { accessCompanyCode: 'SHOP', accessBranchId: branchB } : {}),
      },
    });
    await db.tradeIn.create({
      data: {
        customerId: referrer.id,
        branchId: null,
        submissionSource: 'OFFLINE',
        deviceBrand: 'Apple',
        deviceModel: 'Unknown origin',
      },
    });
    const caller = await scoped([branchA]);
    const targetId = operation === 'update' ? await createCustomer() : undefined;
    const customerCount = await db.customer.count();
    const contactCount = await db.contact.count();
    const response =
      operation === 'create'
        ? await http('post', '/customers', body({ referredById: referrer.id }), caller).expect(403)
        : await http(
            'patch',
            '/customers/' + targetId,
            { referredById: referrer.id },
            caller,
          ).expect(403);
    expect(Object.keys(response.body).sort()).toEqual(['error', 'message', 'statusCode']);
    expect(await db.customer.count()).toBe(customerCount);
    expect(await db.contact.count()).toBe(contactCount);
    if (targetId)
      expect(
        (await db.customer.findUniqueOrThrow({ where: { id: targetId } })).referredById,
      ).toBeNull();
  },
);
