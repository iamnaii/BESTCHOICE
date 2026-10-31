import { decryptPII } from '../../utils/crypto.util';
import { lockEmployeeAccess } from './access-snapshot.service';
import { customerPhoneLockKey } from '../customers/customer-phone-lock';
import { PARTY_WRITE_ROUTES } from './access-party-boundaries';
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
import { CustomerBlacklistService } from '../customers/customer-blacklist.service';
import { SkipTracingService } from '../customers/skip-tracing.service';
import { CustomerInsightsService } from '../overdue/customer-insights.service';
import { CustomerMergeService } from '../chat-prospects/customer-merge.service';
import { PiiAuditService } from '../pii/pii-audit.service';
import { CustomerPiiService } from '../customers/customer-pii.service';
import { ContactsController } from '../contacts/contacts.controller';
import { ContactsService } from '../contacts/contacts.service';
import { ContactResolverService } from '../contacts/contact-resolver.service';
import { AuditService } from '../audit/audit.service';
import { AuditInterceptor } from '../audit/audit.interceptor';
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
function http(
  method: 'get' | 'post' | 'patch' | 'delete',
  path: string,
  body?: object,
  id = actor,
) {
  const client = request(app.getHttpServer());
  const call = client[method](path)
    .set('x-test-user', id)
    .expect('x-owned-enrichment-app', testRun)
    .on('response', (response) => {
      if (response.headers['x-owned-enrichment-app'] !== testRun)
        console.error(
          'OWNED_HTTP_MARKER_MISMATCH',
          JSON.stringify({
            status: response.status,
            marker: response.headers['x-owned-enrichment-app'] ?? null,
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
      SkipTracingService,
      // CustomersController injects it since ก้อน 5 C3 (blacklist reads) — no route here touches it; without the
      // provider the module never compiles and every case fails before running (pre-existing, found in Task 22 fix round 1)
      { provide: CustomerBlacklistService, useValue: {} },
      {
        provide: CustomerMergeService,
        useValue: {
          assertActorMayAbsorb: jest
            .fn()
            .mockRejectedValue(new Error('Legacy SALES helper must not authorize managed writes')),
        },
      },
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
      res.setHeader('x-owned-enrichment-app', testRun);
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

const permissions: PermissionKey[] = ['customers.read', 'customers.update'];
let phoneSequence = 1000000;
function phone() {
  return `089${++phoneSequence}`;
}
function fill(extra: object = {}) {
  return { phone: phone(), ...extra };
}
function trace(extra: object = {}) {
  return { newPhone: phone(), reason: 'verified private lead', ...extra };
}
const operations = [
  { route: 'fill-contact', body: fill, action: 'CUSTOMER_PLACEHOLDER_CONTACT_FILLED' },
  { route: 'update-contact', body: trace, action: 'SKIP_TRACING_UPDATE' },
] as const;
async function placeholder(extra: object = {}) {
  return customer({ acquisitionSource: 'CHAT_FACEBOOK', ...extra });
}
function path(id: string, route: string, company = 'SHOP') {
  return `/customers/${id}/${route}?company=${company}`;
}

it.each(operations)(
  'executes legitimate $route through the owned writer and records safe current-actor evidence',
  async ({ route, body, action }) => {
    const c = await placeholder();
    const payload = body();
    const response = await http('post', path(c.id, route), payload).expect(201);
    expect(response.body).toEqual(
      route === 'fill-contact'
        ? { id: c.id, changedFields: ['phone'] }
        : { id: c.id, changedFields: ['phone'], phoneStoredAs: 'PRIMARY' },
    );
    const row = await db.customer.findUniqueOrThrow({ where: { id: c.id } });
    expect(row.phone).toBe('phone' in payload ? payload.phone : payload.newPhone);
    expect(row.phoneHash).toBe(app.get(CustomerPiiService).hash(row.phone));
    expect(decryptPII(row.phoneEncrypted!, process.env.PII_ENCRYPTION_KEY!)).toBe(row.phone);
    expect(row).toMatchObject({
      acquisitionSource: 'CHAT_FACEBOOK',
      accessBranchId: branchA,
      assignedToId: null,
    });
    const audit = await db.auditLog.findFirstOrThrow({ where: { action, entityId: c.id } });
    expect(audit.userId).toBe(actor);
    expect(audit.newValue).toMatchObject({ changedFields: ['phone'] });
    expect(JSON.stringify([audit.oldValue, audit.newValue])).not.toContain(row.phone);
    const journey = await db.customerJourneyEntry.findFirstOrThrow({
      where: { customerId: c.id, kind: 'CONTACT_ADDED' },
    });
    expect(journey.actorUserId).toBe(actor);
    expect(journey.data).toEqual({
      fields: ['phone'],
      via: route === 'fill-contact' ? 'FILL_CONTACT' : 'UPDATE',
    });
  },
);
it.each(operations)(
  'denies $route without grants and preserves the customer',
  async ({ route, body }) => {
    const c = await placeholder();
    await http('post', path(c.id, route), body(), denied).expect(403);
    expect(await db.customer.findUniqueOrThrow({ where: { id: c.id } })).toEqual(c);
  },
);
it.each(operations)(
  'requires both read and update on every genuine source for $route',
  async ({ route, body }) => {
    const c = await placeholder();
    await contract(c.id, branchB);
    const branchOnly = await reader(permissions, 'SHOP', [branchA]);
    await http('post', path(c.id, route), body(), branchOnly).expect(403);
    const shopOnly = await reader(permissions);
    await http('post', path(c.id, route), body(), shopOnly).expect(403);
    const both = await reader(permissions);
    await grant(both, ['customers.update'], 'FINANCE');
    await http('post', path(c.id, route), body(), both).expect(403);
    await grant(both, ['customers.read'], 'FINANCE');
    await http('post', path(c.id, route), body(), both).expect(201);
  },
);
it.each(operations)(
  'does not combine position branches or substitute room/case assignment for identity in $route',
  async ({ route, body }) => {
    const scoped = await reader(['customers.read'], 'SHOP', [branchA]);
    await grant(scoped, ['customers.update'], 'SHOP', [branchB]);
    const c = await placeholder();
    await http('post', path(c.id, route), body(), scoped).expect(403);
    const assigned = await reader(permissions, 'SHOP', undefined, true);
    await grant(assigned, permissions, 'FINANCE', undefined, 'ASSIGNED');
    await db.chatRoom.create({
      data: {
        customerId: c.id,
        channel: 'FACEBOOK',
        externalUserId: randomUUID(),
        assignedToId: assigned,
      },
    });
    await contract(c.id, branchA, { assignedToId: assigned });
    await http('post', path(c.id, route), body(), assigned).expect(403);
    await db.customer.update({ where: { id: c.id }, data: { assignedToId: assigned } });
    await http('post', path(c.id, route), body(), assigned).expect(201);
  },
);
it.each(operations)(
  'supports actual FINANCE central provenance and denies unknown provenance in $route',
  async ({ route, body }) => {
    const finance = await reader(permissions, 'FINANCE');
    const c = await placeholder({ accessCompanyCode: 'FINANCE', accessBranchId: null });
    await http('post', path(c.id, route, 'FINANCE'), body(), actor).expect(403);
    await http('post', path(c.id, route, 'FINANCE'), body(), finance).expect(201);
    const unknown = await placeholder({ accessCompanyCode: null, accessBranchId: null });
    const owner = await user();
    await db.user.update({ where: { id: owner }, data: { role: 'OWNER' } });
    await http('post', path(unknown.id, route), body(), owner).expect(403);
  },
);
it('fills optional identity and profile fields without changing provenance or imposing a new national-ID checksum', async () => {
  const c = await placeholder();
  const nationalId = '1234567890123'; // existing fill path intentionally omits checksum
  const response = await http(
    'post',
    path(c.id, 'fill-contact'),
    fill({
      nationalId,
      name: ' New name ',
      nickname: 'New',
      prefix: 'Mr',
      facebookName: 'Profile',
    }),
  ).expect(201);
  expect(response.body).toEqual({
    id: c.id,
    changedFields: ['phone', 'nationalId', 'name', 'prefix', 'nickname', 'facebookName'],
  });
  const row = await db.customer.findUniqueOrThrow({ where: { id: c.id } });
  expect(row).toMatchObject({
    name: 'New name',
    nationalId,
    nickname: 'New',
    prefix: 'Mr',
    facebookName: 'Profile',
  });
  expect(row.nationalIdHash).toBe(app.get(CustomerPiiService).hash(nationalId));
  await http('post', path(c.id, 'fill-contact'), fill()).expect(409);
});
it('keeps canonical hidden-owner secondary fallback and acknowledges actual LINE/status changes without disclosing owner or reason', async () => {
  const pii = app.get(CustomerPiiService);
  const hiddenPhone = phone(),
    primary = phone();
  const hidden = await customer({
    name: 'Hidden identity',
    accessBranchId: branchB,
    phone: hiddenPhone,
    ...pii.encryptCustomerFields({ phone: hiddenPhone }),
  });
  // Task 22 I3 + fix round 1 M-1 — skip-tracing ไม่แตะ LINE การเงินอีก (ค่าใหม่ = 400 · ค่าว่าง = ไม่แตะ — ยกเลิกผูกที่ PATCH ของ OWNER/BM)
  const c = await customer({
    phone: primary,
    lineIdFinance: 'private-line',
    ...pii.encryptCustomerFields({ phone: primary }),
  });
  const scoped = await reader(permissions, 'SHOP', [branchA]);
  const response = await http(
    'post',
    path(c.id, 'update-contact'),
    trace({ newPhone: hiddenPhone, newLineId: '', markAsLost: true }),
    scoped,
  ).expect(201);
  expect(response.body).toEqual({
    id: c.id,
    changedFields: ['phoneSecondary', 'status'],
    phoneStoredAs: 'SECONDARY',
  });
  const row = await db.customer.findUniqueOrThrow({ where: { id: c.id } });
  expect(row).toMatchObject({
    phone: primary,
    phoneSecondary: hiddenPhone,
    lineIdFinance: 'private-line',
    status: 'LOST',
  });
  expect(decryptPII(row.phoneSecondaryEncrypted!, process.env.PII_ENCRYPTION_KEY!)).toBe(
    hiddenPhone,
  );
  const audit = await db.auditLog.findFirstOrThrow({
    where: { entityId: c.id, action: 'SKIP_TRACING_UPDATE' },
  });
  const evidence = JSON.stringify([response.body, audit.oldValue, audit.newValue]);
  for (const secret of [
    hidden.id,
    hidden.name,
    hiddenPhone,
    'private-line',
    'verified private lead',
  ])
    expect(evidence).not.toContain(secret);
  expect(await db.customerJourneyEntry.count({ where: { customerId: c.id } })).toBe(0);
});
it('repairs stale same-primary hash/ciphertext without pretending the field was untouched', async () => {
  const value = phone();
  const c = await customer({ phone: value, phoneHash: null, phoneEncrypted: null });
  await http('post', path(c.id, 'update-contact'), trace({ newPhone: value })).expect(201, {
    id: c.id,
    changedFields: ['phone'],
    phoneStoredAs: null,
  });
  const row = await db.customer.findUniqueOrThrow({ where: { id: c.id } });
  expect(row.phoneHash).toBe(app.get(CustomerPiiService).hash(value));
  expect(decryptPII(row.phoneEncrypted!, process.env.PII_ENCRYPTION_KEY!)).toBe(value);
  expect(await db.customerJourneyEntry.count({ where: { customerId: c.id } })).toBe(0);
});
it('returns generic duplicate conflicts without hidden identity, hashes or ciphertext', async () => {
  const value = phone();
  const hidden = await customer({
    name: 'Hidden duplicate',
    accessBranchId: branchB,
    phone: value,
    ...app.get(CustomerPiiService).encryptCustomerFields({ phone: value }),
  });
  const c = await placeholder();
  const scoped = await reader(permissions, 'SHOP', [branchA]);
  const response = await http(
    'post',
    path(c.id, 'fill-contact'),
    fill({ phone: value }),
    scoped,
  ).expect(409);
  expect(Object.keys(response.body).sort()).toEqual(['error', 'message', 'statusCode']);
  for (const secret of [hidden.id, hidden.name, value, hidden.phoneHash!, hidden.phoneEncrypted!])
    expect(JSON.stringify(response.body)).not.toContain(secret);
  expect((await db.customer.findUniqueOrThrow({ where: { id: c.id } })).phone).toBeNull();
});
it.each(operations)(
  'rolls back $route and journey on a late required audit failure',
  async ({ route, body, action }) => {
    const c = await placeholder();
    const audit = app.get(AuditService),
      original = audit.log.bind(audit);
    const spy = jest.spyOn(audit, 'log').mockImplementation(async (entry, tx) => {
      await original(entry, tx);
      if (tx) throw new Error('injected late audit failure');
    });
    try {
      await http('post', path(c.id, route), body()).expect(500);
    } finally {
      spy.mockRestore();
    }
    expect(await db.customer.findUniqueOrThrow({ where: { id: c.id } })).toEqual(c);
    expect(await db.auditLog.count({ where: { entityId: c.id, action } })).toBe(0);
    expect(await db.customerJourneyEntry.count({ where: { customerId: c.id } })).toBe(0);
  },
);
it.each(operations)(
  'rolls back $route and audit on a late required journey failure',
  async ({ route, body }) => {
    const c = await placeholder();
    const journey = app.get(JourneyEntryWriter),
      original = journey.recordInTx.bind(journey);
    const spy = jest.spyOn(journey, 'recordInTx').mockImplementation(async (tx, entry) => {
      await original(tx, entry);
      throw new Error('injected late journey failure');
    });
    try {
      await http('post', path(c.id, route), body()).expect(500);
    } finally {
      spy.mockRestore();
    }
    expect(await db.customer.findUniqueOrThrow({ where: { id: c.id } })).toEqual(c);
    expect(
      await db.auditLog.count({
        where: {
          entityId: c.id,
          action: { in: ['SKIP_TRACING_UPDATE', 'CUSTOMER_PLACEHOLDER_CONTACT_FILLED'] },
        },
      }),
    ).toBe(0);
    expect(await db.customerJourneyEntry.count({ where: { customerId: c.id } })).toBe(0);
  },
);
it('concurrent fill and skip-tracing share the canonical phone lock and preserve one primary owner', async () => {
  const a = await placeholder(),
    b = await placeholder(),
    value = phone();
  const results = await Promise.all([
    http('post', path(a.id, 'fill-contact'), fill({ phone: value })),
    http('post', path(b.id, 'update-contact'), trace({ newPhone: value })),
  ]);
  expect(results[1].status).toBe(201);
  expect([201, 409]).toContain(results[0].status);
  expect(
    await db.customer.count({
      where: { phoneHash: app.get(CustomerPiiService).hash(value), deletedAt: null },
    }),
  ).toBe(1);
  const bRow = await db.customer.findUniqueOrThrow({ where: { id: b.id } });
  expect(bRow.phone === value || bRow.phoneSecondary === value).toBe(true);
});
it('concurrent placeholder fills cannot both claim one canonical phone', async () => {
  const a = await placeholder(),
    b = await placeholder(),
    value = phone();
  const results = await Promise.all([
    http('post', path(a.id, 'fill-contact'), fill({ phone: value })),
    http('post', path(b.id, 'fill-contact'), fill({ phone: value })),
  ]);
  expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
  expect(
    await db.customer.count({ where: { phoneHash: app.get(CustomerPiiService).hash(value) } }),
  ).toBe(1);
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

it.each(operations)(
  'rechecks current identity assignment after a real lock wait for $route',
  async ({ route, body }) => {
    const assigned = await reader(permissions, 'SHOP', undefined, true);
    const c = await placeholder({ assignedToId: assigned });
    const result = await waitedChange(
      async (tx, locked, gate) => {
        await tx.$queryRaw`SELECT id FROM customers WHERE id=${c.id} FOR UPDATE`;
        locked();
        await gate;
        await tx.customer.update({ where: { id: c.id }, data: { assignedToId: actor } });
      },
      () => http('post', path(c.id, route), body(), assigned).then((r) => r),
    );
    expect(result.status).toBe(403);
    expect((await db.customer.findUniqueOrThrow({ where: { id: c.id } })).phone).toBeNull();
  },
);
it.each(operations)(
  'reloads revoked authority after a real access-lock wait for $route',
  async ({ route, body }) => {
    const id = await user();
    const assignment = await grant(id, permissions);
    const c = await placeholder();
    const result = await waitedChange(
      async (tx, locked, gate) => {
        await lockEmployeeAccess(tx);
        locked();
        await gate;
        await tx.employeeAccessAssignment.update({
          where: { id: assignment.id },
          data: { deletedAt: new Date() },
        });
      },
      () => http('post', path(c.id, route), body(), id).then((r) => r),
    );
    expect(result.status).toBe(403);
    expect((await db.customer.findUniqueOrThrow({ where: { id: c.id } })).phone).toBeNull();
  },
);
it.each(operations)(
  'locks the canonical phone before the target Customer row for $route',
  async ({ route, body }) => {
    const c = await placeholder(),
      value = phone();
    const lockKey = customerPhoneLockKey(app.get(CustomerPiiService), value)!;
    const result = await waitedChange(
      async (tx, locked, gate) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;
        locked();
        await gate;
        // Would deadlock/time out if the waiting handler had already locked Customer.
        await tx.customer.update({ where: { id: c.id }, data: { name: 'Concurrent name' } });
      },
      () =>
        http(
          'post',
          path(c.id, route),
          body(route === 'fill-contact' ? { phone: value } : { newPhone: value }),
        ).then((r) => r),
    );
    expect(result.status).toBe(201);
    expect((await db.customer.findUniqueOrThrow({ where: { id: c.id } })).name).toBe(
      'Concurrent name',
    );
  },
);
it('encrypted-only existing primary contact does not create false CONTACT_ADDED evidence', async () => {
  const pii = app.get(CustomerPiiService),
    originalPhone = phone();
  const c = await customer({ phone: null, ...pii.encryptCustomerFields({ phone: originalPhone }) });
  await http('post', path(c.id, 'update-contact'), trace()).expect(201);
  expect(await db.customerJourneyEntry.count({ where: { customerId: c.id } })).toBe(0);
});
it('canonical encrypted-only identity is not a fillable chat placeholder', async () => {
  const c = await placeholder({
    ...app.get(CustomerPiiService).encryptCustomerFields({ phone: phone() }),
  });
  await http('post', path(c.id, 'fill-contact'), fill()).expect(409);
});
it('keeps reviewed enrichment and merge registrations alongside document boundaries', () => {
  for (const route of ['CustomersController.fillContact', 'CustomersController.updateContact']) {
    expect(PARTY_WRITE_ROUTES).toContain(route);
    expect(ACCESS_BOUNDARIES.has(route)).toBe(true);
    expect(ACCESS_POLICIES[route]).toMatchObject({
      permission: 'customers.update',
      resolution: 'record',
    });
  }
  for (const route of ['CustomersController.absorbInto', 'ContactsController.merge']) {
    expect(PARTY_WRITE_ROUTES).toContain(route);
    expect(ACCESS_BOUNDARIES.has(route)).toBe(true);
  }
  for (const route of [
    'CustomersController.uploadDocument',
    'CustomersController.deleteDocument',
  ])
    expect(ACCESS_BOUNDARIES.has(route)).toBe(true);
});
it('keeps legacy HTTP fill response and room helper outside managed execution', async () => {
  const legacy = await user();
  await db.user.update({ where: { id: legacy }, data: { accessManaged: false, role: 'SALES' } });
  const merge = app.get(CustomerMergeService);
  const helper = jest.mocked(merge.assertActorMayAbsorb);
  helper.mockResolvedValueOnce(undefined);
  const c = await placeholder(),
    value = phone();
  await http('post', path(c.id, 'fill-contact'), fill({ phone: value }), legacy).expect(201, {
    id: c.id,
    name: c.name,
    phone: value,
  });
  expect(helper).toHaveBeenCalledWith(c.id, { id: legacy, role: 'SALES' });
});
it.each([{ newLineId: 'secret-line' }, { markAsLost: true }])(
  'requires identity authority even without a phone change: %j',
  async (change) => {
    const c = await placeholder({ accessCompanyCode: 'FINANCE', accessBranchId: null });
    await http('post', path(c.id, 'update-contact'), { reason: 'verified lead', ...change }).expect(
      403,
    );
    expect(await db.customer.findUniqueOrThrow({ where: { id: c.id } })).toEqual(c);
  },
);
it.each(operations)(
  'rechecks a retired current source after an actual branch-row wait for $route',
  async ({ route, body }) => {
    const shop = await db.companyInfo.findUniqueOrThrow({ where: { companyCode: 'SHOP' } });
    const branch = await db.branch.create({
      data: { name: 'Retire while waiting', companyId: shop.id },
    });
    const c = await placeholder({ accessBranchId: branch.id });
    const result = await waitedChange(
      async (tx, locked, gate) => {
        await tx.$queryRaw`SELECT id FROM branches WHERE id=${branch.id} FOR UPDATE`;
        locked();
        await gate;
        await tx.branch.update({ where: { id: branch.id }, data: { isActive: false } });
      },
      () => http('post', path(c.id, route), body()).then((r) => r),
    );
    expect(result.status).toBe(403);
    expect((await db.customer.findUniqueOrThrow({ where: { id: c.id } })).phone).toBeNull();
  },
);
it('does not expose hidden national-ID conflicts and retries a real canonical unique race safely', async () => {
  const nationalId = '9876543210123';
  const hidden = await customer({
    name: 'Hidden national identity',
    accessBranchId: branchB,
    nationalId,
    ...app.get(CustomerPiiService).encryptCustomerFields({ nationalId }),
  });
  const c = await placeholder(),
    scoped = await reader(permissions, 'SHOP', [branchA]);
  const response = await http(
    'post',
    path(c.id, 'fill-contact'),
    fill({ nationalId }),
    scoped,
  ).expect(409);
  for (const secret of [
    hidden.id,
    hidden.name,
    nationalId,
    hidden.nationalIdHash!,
    hidden.nationalIdEncrypted!,
  ])
    expect(JSON.stringify(response.body)).not.toContain(secret);
  const a = await placeholder(),
    b = await placeholder(),
    raceNationalId = '9876543210987';
  const results = await Promise.all([
    http('post', path(a.id, 'fill-contact'), fill({ nationalId: raceNationalId })),
    http('post', path(b.id, 'fill-contact'), fill({ nationalId: raceNationalId })),
  ]);
  expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
  expect(
    await db.customer.count({
      where: { nationalIdHash: app.get(CustomerPiiService).hash(raceNationalId) },
    }),
  ).toBe(1);
});
it('reports an unchanged same-primary request precisely without adding journey evidence', async () => {
  const value = phone(),
    pii = app.get(CustomerPiiService);
  const c = await customer({ phone: value, ...pii.encryptCustomerFields({ phone: value }) });
  await http('post', path(c.id, 'update-contact'), trace({ newPhone: value })).expect(201, {
    id: c.id,
    changedFields: [],
    phoneStoredAs: null,
  });
  expect(await db.customerJourneyEntry.count({ where: { customerId: c.id } })).toBe(0);
});
it.each(operations)(
  'keeps $route reads, writes and required evidence on the owned transaction client',
  async ({ route, body }) => {
    const c = await placeholder();
    const spies = [
      jest.spyOn(db.customer, 'findUnique'),
      jest.spyOn(db.customer, 'findFirst'),
      jest.spyOn(db.customer, 'findMany'),
      jest.spyOn(db.customer, 'update'),

      jest.spyOn(db.customerJourneyEntry, 'createMany'),
      jest.spyOn(db.systemConfig, 'findFirst'),
    ];
    try {
      await http('post', path(c.id, route), body()).expect(201);
      for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
  },
);
async function requestAudit(customerId: string, action: string) {
  for (let attempt = 0; attempt < 80; attempt++) {
    const row = await db.auditLog.findFirst({
      where: { entityId: customerId, action },
      orderBy: { createdAt: 'desc' },
    });
    if (row) return row;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error('Required observed request audit missing');
}
it.each(['success', 'denied', 'late-failure'] as const)(
  'outer request audit keeps enrichment values private for %s',
  async (outcome) => {
    const c = await placeholder();
    const sentinel = 'RAW_PRIVATE_SENTINEL';
    let spy: jest.SpyInstance | undefined;
    if (outcome === 'late-failure') {
      const journey = app.get(JourneyEntryWriter),
        original = journey.recordInTx.bind(journey);
      spy = jest.spyOn(journey, 'recordInTx').mockImplementation(async (tx, entry) => {
        await original(tx, entry);
        throw new Error(sentinel);
      });
    }
    try {
      const status = outcome === 'success' ? 201 : outcome === 'denied' ? 403 : 500;
      await http(
        'post',
        path(c.id, 'fill-contact'),
        fill({ name: sentinel, nickname: sentinel, facebookName: sentinel }),
        outcome === 'denied' ? denied : actor,
      ).expect(status);
      const request = await requestAudit(c.id, outcome === 'success' ? 'POST' : 'POST_ERROR');
      expect(request.newValue).toMatchObject({
        outcome: outcome === 'success' ? 'SUCCESS' : 'ERROR',
        presentFields: ['phone', 'name', 'nickname', 'facebookName'],
        statusCode: status,
      });
      const audits = await db.auditLog.findMany({ where: { entityId: c.id } });
      expect(JSON.stringify(audits.map((row) => [row.oldValue, row.newValue]))).not.toContain(
        sentinel,
      );
      expect(
        audits.filter((row) => row.action === 'CUSTOMER_PLACEHOLDER_CONTACT_FILLED'),
      ).toHaveLength(outcome === 'success' ? 1 : 0);
    } finally {
      spy?.mockRestore();
    }
  },
);
it('outer skip-tracing request audit retains safe request outcome but never raw reason', async () => {
  const c = await placeholder(),
    sentinel = 'RAW_PRIVATE_REASON';
  await http('post', path(c.id, 'update-contact'), trace({ reason: sentinel })).expect(201);
  const request = await requestAudit(c.id, 'POST');
  expect(request.newValue).toMatchObject({
    outcome: 'SUCCESS',
    presentFields: ['newPhone'],
    reasonProvided: true,
    statusCode: 201,
  });
  const audits = await db.auditLog.findMany({ where: { entityId: c.id } });
  expect(JSON.stringify(audits.map((row) => [row.oldValue, row.newValue]))).not.toContain(sentinel);
});
