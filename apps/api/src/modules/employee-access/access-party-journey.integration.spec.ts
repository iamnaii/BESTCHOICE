import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { Test } from '@nestjs/testing';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { ExecutionContext, INestApplication, ValidationPipe, Logger } from '@nestjs/common';
import request from 'supertest';
import { PERMISSION_CATALOG, JOURNEY_EVENT_GROUPS, PermissionKey } from '@installment/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AccessSnapshotService } from './access-snapshot.service';
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
import { CustomerJourneyController } from '../customer-journey/customer-journey.controller';
import { CustomerJourneyService } from '../customer-journey/customer-journey.service';
import { JourneyManualEntryService } from '../customer-journey/journey-manual-entry.service';
import { JourneySummaryService } from '../customer-journey/journey-summary.service';
import { JourneyStateService } from '../customer-journey/journey-state.service';
const url = process.env.EMPLOYEE_ACCESS_TEST_DATABASE_URL;
if (!url?.includes('/bc_access_task2?host=/tmp/bc-access-parties.'))
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
    .expect('x-owned-journey-app', testRun)
    .on('response', (response) => {
      if (response.headers['x-owned-journey-app'] !== testRun)
        console.error(
          'OWNED_HTTP_MARKER_MISMATCH',
          JSON.stringify({
            status: response.status,
            marker: response.headers['x-owned-journey-app'] ?? null,
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
  await grant(actor, ['customers.read', 'customers.update', 'customer-journey.read', 'chat.read']);
  const module = await Test.createTestingModule({
    controllers: [CustomerJourneyController],
    providers: [
      AccessPartyBoundaries,
      AccessPartySourceService,
      AccessResourceService,
      AccessProcurementSourceService,
      AccessPolicyService,
      { provide: PrismaService, useValue: db },
      { provide: AccessSnapshotService, useValue: snapshots },
      CustomerJourneyService,
      JourneyManualEntryService,
      JourneySummaryService,
      JourneyStateService,
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
      res.setHeader('x-owned-journey-app', testRun);
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
    data: { name: 'Owned journey', accessCompanyCode: 'SHOP', accessBranchId: branchA },
  });
}
async function entry(customerId: string) {
  return db.customerJourneyEntry.create({
    data: {
      customerId,
      originCustomerId: customerId,
      origin: 'MANUAL',
      kind: 'TOUCHPOINT',
      occurredAt: new Date(),
      actorType: 'STAFF',
      actorUserId: actor,
      channel: 'PHONE',
      outcome: 'THINKING',
    },
  });
}
it('list admits current authorized source through actual HTTP', async () => {
  const c = await customer();
  const e = await entry(c.id);
  const response = await http('get', `/customers/${c.id}/journey?company=SHOP&groups=chat`).expect(
    200,
  );
  expect(response.body.events.some((row: { entryId?: string }) => row.entryId === e.id)).toBe(true);
});
it('summary admits authorized source with explicit availability', async () => {
  const c = await customer();
  const response = await http('get', `/customers/${c.id}/journey/summary?company=SHOP`).expect(200);
  expect(response.body.availability).toBeDefined();
});
it('create commits actual manual row with real actor', async () => {
  const c = await customer();
  const response = await http('post', `/customers/${c.id}/journey/entries?company=SHOP`, {
    kind: 'TOUCHPOINT',
    channel: 'PHONE',
    outcome: 'THINKING',
    clientRequestId: randomUUID(),
  }).expect(201);
  const e = await db.customerJourneyEntry.findUniqueOrThrow({
    where: { id: response.body.entryId },
  });
  expect(e.actorUserId).toBe(actor);
  expect(e.originCustomerId).toBe(c.id);
});
it('remove soft-deletes own manual row through actual HTTP', async () => {
  const c = await customer();
  const e = await entry(c.id);
  await http('delete', `/customers/${c.id}/journey/entries/${e.id}?company=SHOP`).expect(200);
  expect(
    (await db.customerJourneyEntry.findUniqueOrThrow({ where: { id: e.id } })).deletedById,
  ).toBe(actor);
});
it('all four deny no grants without writing', async () => {
  const c = await customer();
  const e = await entry(c.id);
  await http('get', `/customers/${c.id}/journey?company=SHOP`, undefined, denied).expect(403);
  await http('get', `/customers/${c.id}/journey/summary?company=SHOP`, undefined, denied).expect(
    403,
  );
  await http(
    'post',
    `/customers/${c.id}/journey/entries?company=SHOP`,
    { kind: 'HEARD_FROM', heardFrom: 'OTHER' },
    denied,
  ).expect(403);
  await http(
    'delete',
    `/customers/${c.id}/journey/entries/${e.id}?company=SHOP`,
    undefined,
    denied,
  ).expect(403);
  expect(await db.customerJourneyEntry.count({ where: { customerId: c.id } })).toBe(1);
  expect(
    (await db.customerJourneyEntry.findUniqueOrThrow({ where: { id: e.id } })).deletedAt,
  ).toBeNull();
});

async function sale(customerId: string, branchId: string, createdAt: Date) {
  const p = await db.product.create({
    data: {
      name: 'Scoped product',
      brand: 'Apple',
      model: 'Fixture',
      category: 'PHONE_NEW',
      costPrice: 100,
      branchId,
    },
  });
  return db.sale.create({
    data: {
      customerId,
      branchId,
      productId: p.id,
      saleNumber: randomUUID(),
      saleType: 'CASH',
      salespersonId: actor,
      sellingPrice: 1000,
      netAmount: 1000,
      createdAt,
    },
  });
}
it('filters independently sourced sales before page cursor/count boundaries', async () => {
  const c = await customer();
  const id = await user();
  await grant(id, ['customers.read', 'customer-journey.read', 'sales.read'], 'SHOP', [branchA]);
  const old = await sale(c.id, branchA, new Date('2026-01-01'));
  const newer = await sale(c.id, branchA, new Date('2026-01-02'));
  for (let i = 0; i < 35; i++)
    await sale(c.id, branchB, new Date(`2026-02-${String((i % 28) + 1).padStart(2, '0')}`));
  const page = await http(
    'get',
    `/customers/${c.id}/journey?company=SHOP&groups=sale&limit=1&include=counts`,
    undefined,
    id,
  ).expect(200);
  expect(page.body.events.map((e: { id: string }) => e.id)).toEqual([`sale-${newer.id}`]);
  expect(page.body.counts.sale).toBe(2);
  expect(page.body.nextCursor).toEqual(expect.any(String));
  const next = await http(
    'get',
    `/customers/${c.id}/journey?company=SHOP&groups=sale&limit=1&cursor=${encodeURIComponent(page.body.nextCursor)}`,
    undefined,
    id,
  ).expect(200);
  expect(next.body.events.map((e: { id: string }) => e.id)).toEqual([`sale-${old.id}`]);
  expect(next.body.nextCursor).toBeNull();
  expect(next.body.counts).toBeUndefined();
});
it('a genuine archived alias does not grant foreign origin manual history or redirect', async () => {
  const c = await customer();
  const id = await user();
  await grant(id, ['customers.read', 'customer-journey.read', 'chat.read'], 'SHOP', [branchA]);
  const alias = await db.customer.create({
    data: {
      name: 'Foreign origin alias',
      accessCompanyCode: 'SHOP',
      accessBranchId: branchB,
      deletedAt: new Date(),
      mergedIntoId: c.id,
    },
  });
  const e = await db.customerJourneyEntry.create({
    data: {
      customerId: c.id,
      originCustomerId: alias.id,
      kind: 'TOUCHPOINT',
      origin: 'MANUAL',
      occurredAt: new Date(),
      actorType: 'STAFF',
      actorUserId: actor,
      channel: 'PHONE',
      outcome: 'THINKING',
    },
  });
  const response = await http(
    'get',
    `/customers/${c.id}/journey?company=SHOP&groups=chat`,
    undefined,
    id,
  ).expect(200);
  expect(response.body.events.some((row: { entryId?: string }) => row.entryId === e.id)).toBe(
    false,
  );
  expect(response.body.mergedCustomerIds).not.toContain(alias.id);
  await http('get', `/customers/${alias.id}/journey?company=SHOP`, undefined, id).expect(403);
});
it('current revocation defeats every four-route request and leaves mutation state unchanged', async () => {
  const c = await customer();
  const e = await entry(c.id);
  const id = await user();
  const assignment = await grant(
    id,
    ['customers.read', 'customer-journey.read', 'customers.update'],
    'SHOP',
    [branchA],
  );
  await snapshots.forUser(id);
  await db.employeeAccessAssignment.update({
    where: { id: assignment.id },
    data: { deletedAt: new Date() },
  });
  await http('get', `/customers/${c.id}/journey?company=SHOP`, undefined, id).expect(403);
  await http('get', `/customers/${c.id}/journey/summary?company=SHOP`, undefined, id).expect(403);
  await http(
    'post',
    `/customers/${c.id}/journey/entries?company=SHOP`,
    { kind: 'HEARD_FROM', heardFrom: 'OTHER' },
    id,
  ).expect(403);
  await http(
    'delete',
    `/customers/${c.id}/journey/entries/${e.id}?company=SHOP`,
    undefined,
    id,
  ).expect(403);
  expect(
    (await db.customerJourneyEntry.findUniqueOrThrow({ where: { id: e.id } })).deletedAt,
  ).toBeNull();
});

async function broadUser() {
  const id = await user();
  const permissions = PERMISSION_CATALOG.filter((p) => !p.ownerOnly).map((p) => p.key);
  await grant(id, permissions, 'SHOP');
  await grant(id, permissions, 'FINANCE');
  return id;
}
async function contract(customerId: string, branchId = branchA) {
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
    },
  });
}
it('all eight families project independent authorized source events with no private fields', async () => {
  const c = await customer(),
    id = await broadUser(),
    k = await contract(c.id);
  const room = await db.chatRoom.create({ data: { customerId: c.id, channel: 'LINE_SHOP' } });
  await db.chatMessage.create({
    data: { roomId: room.id, role: 'CUSTOMER', type: 'TEXT', text: 'PRIVATE_CHAT_001' },
  });
  const cc = await db.creditCheck.create({
    data: { customerId: c.id, contractId: k.id, aiSummary: 'PRIVATE_AI_001' },
  });
  await sale(c.id, branchA, new Date());
  const pay = await db.payment.create({
    data: {
      contractId: k.id,
      installmentNo: 1,
      dueDate: new Date(),
      amountDue: 990,
      amountPaid: 990,
      status: 'PAID',
      notes: 'PRIVATE_PAYMENT_001',
    },
  });
  const call = await db.callLog.create({
    data: { contractId: k.id, calledAt: new Date(), result: 'ANSWERED', notes: 'PRIVATE_CALL_001' },
  });
  const repair = await db.repairTicket.create({
    data: {
      customerId: c.id,
      branchId: branchA,
      ticketNumber: randomUUID(),
      defectDescription: 'PRIVATE_REPAIR_001',
      createdById: actor,
    },
  });
  const points = await db.loyaltyPoint.create({
    data: { customerId: c.id, contractId: k.id, paymentId: pay.id, points: 10 },
  });
  const tag = await db.customerTag.create({
    data: { customerId: c.id, tag: 'VIP', source: 'MANUAL' },
  });
  const response = await http(
    'get',
    `/customers/${c.id}/journey?company=SHOP&groups=${JOURNEY_EVENT_GROUPS.join(',')}&limit=100&include=counts,summary`,
    undefined,
    id,
  ).expect(200);
  for (const group of JOURNEY_EVENT_GROUPS)
    expect(response.body.events.some((e: { group: string }) => e.group === group)).toBe(true);
  for (const event of [
    `credit-${cc.id}`,
    `payment-${pay.id}`,
    `call-${call.id}`,
    `repair-${repair.id}`,
    `points-${points.id}`,
    `tag-${tag.id}`,
  ])
    expect(response.body.events.some((e: { id: string }) => e.id === event)).toBe(true);
  expect(JSON.stringify(response.body)).not.toContain('PRIVATE_');
  expect(response.body.summary.facts.stage).toBe('PURCHASED');
});
it('create without Journey read returns narrow ack and durable evidence', async () => {
  const c = await customer(),
    id = await user();
  await grant(id, ['customers.read', 'customers.update'], 'SHOP', [branchA]);
  const response = await http(
    'post',
    `/customers/${c.id}/journey/entries?company=SHOP`,
    { kind: 'HEARD_FROM', heardFrom: 'FRIEND' },
    id,
  ).expect(201);
  expect(response.body).toEqual({
    entryId: expect.any(String),
    event: null,
    summary: null,
    availability: 'unavailable',
  });
  expect(
    await db.auditLog.count({
      where: {
        action: 'CUSTOMER_JOURNEY_ENTRY_CREATED',
        entityId: response.body.entryId,
        userId: id,
      },
    }),
  ).toBe(1);
});
it('own-window undo and configurable moderation do not use legacy manager role', async () => {
  const c = await customer(),
    e = await entry(c.id),
    other = await user();
  await grant(other, ['customers.read', 'customers.update', 'customer-journey.read'], 'SHOP', [
    branchA,
  ]);
  await db.user.update({ where: { id: other }, data: { role: 'BRANCH_MANAGER' } });
  await http(
    'delete',
    `/customers/${c.id}/journey/entries/${e.id}?company=SHOP`,
    undefined,
    other,
  ).expect(403);
  await grant(other, ['customer-journey.moderate'], 'SHOP', [branchA]);
  await http(
    'delete',
    `/customers/${c.id}/journey/entries/${e.id}?company=SHOP`,
    undefined,
    other,
  ).expect(200);
  expect(
    (await db.customerJourneyEntry.findUniqueOrThrow({ where: { id: e.id } })).deletedById,
  ).toBe(other);
});
it('expired own entry advertises no undo and mutation agrees', async () => {
  const c = await customer(),
    e = await entry(c.id);
  await db.customerJourneyEntry.update({
    where: { id: e.id },
    data: { createdAt: new Date(Date.now() - 86401000) },
  });
  const response = await http('get', `/customers/${c.id}/journey?company=SHOP&groups=chat`).expect(
    200,
  );
  expect(response.body.events.find((v: { entryId?: string }) => v.entryId === e.id)).toMatchObject({
    canDelete: false,
    undoableUntil: null,
  });
  await http('delete', `/customers/${c.id}/journey/entries/${e.id}?company=SHOP`).expect(403);
});
it('loss gate denies scoped create and undo identically before hidden global business decisions', async () => {
  const c = await customer();
  const e = await db.customerJourneyEntry.create({
    data: {
      customerId: c.id,
      originCustomerId: c.id,
      kind: 'MARKED_LOST',
      origin: 'MANUAL',
      occurredAt: new Date(),
      actorType: 'STAFF',
      actorUserId: actor,
      lostReason: 'OTHER',
    },
  });
  const before = await http('post', `/customers/${c.id}/journey/entries?company=SHOP`, {
    kind: 'MARKED_LOST',
    lostReason: 'OTHER',
  }).expect(403);
  await sale(c.id, branchB, new Date());
  const after = await http('post', `/customers/${c.id}/journey/entries?company=SHOP`, {
    kind: 'MARKED_LOST',
    lostReason: 'OTHER',
  }).expect(403);
  expect(after.body).toEqual(before.body);
  await http('delete', `/customers/${c.id}/journey/entries/${e.id}?company=SHOP`).expect(403);
});
it('complete loss authority preserves bought conflict and reopen no-op without cache write on GET', async () => {
  const c = await customer(),
    id = await broadUser();
  const read = await http(
    'get',
    `/customers/${c.id}/journey/summary?company=SHOP`,
    undefined,
    id,
  ).expect(200);
  expect(read.body.facts.stage).toBeDefined();
  expect(await db.customerJourneyState.count({ where: { customerId: c.id } })).toBe(0);
  const noOp = await http(
    'post',
    `/customers/${c.id}/journey/entries?company=SHOP`,
    { kind: 'REOPENED' },
    id,
  ).expect(201);
  expect(noOp.body.entryId).toBeNull();
  expect(await db.customerJourneyEntry.count({ where: { customerId: c.id } })).toBe(0);
  await sale(c.id, branchA, new Date());
  await http(
    'post',
    `/customers/${c.id}/journey/entries?company=SHOP`,
    { kind: 'MARKED_LOST', lostReason: 'OTHER' },
    id,
  ).expect(409);
});
it('complete loss authority creates and undoes real marks and reopens canonically', async () => {
  const c = await customer(),
    id = await broadUser();
  const lost = await http(
    'post',
    `/customers/${c.id}/journey/entries?company=SHOP`,
    { kind: 'MARKED_LOST', lostReason: 'OTHER' },
    id,
  ).expect(201);
  expect(lost.body.summary.facts.lost).toMatchObject({ reason: 'OTHER' });
  const opened = await http(
    'post',
    `/customers/${c.id}/journey/entries?company=SHOP`,
    { kind: 'REOPENED' },
    id,
  ).expect(201);
  expect(opened.body.entryId).not.toBeNull();
  expect(opened.body.summary.facts.lost).toBeNull();
  await http(
    'delete',
    `/customers/${c.id}/journey/entries/${opened.body.entryId}?company=SHOP`,
    undefined,
    id,
  ).expect(200);
  const summary = await http(
    'get',
    `/customers/${c.id}/journey/summary?company=SHOP`,
    undefined,
    id,
  ).expect(200);
  expect(summary.body.facts.lost).toMatchObject({ reason: 'OTHER' });
});
it('unproven legacy saving plan blocks loss authority without Product or PaymentLink fallback', async () => {
  const c = await customer(),
    id = await broadUser();
  await db.savingPlan.create({
    data: {
      customerId: c.id,
      planNumber: randomUUID(),
      targetAmount: 1000,
      monthlyAmount: 100,
      durationMonths: 10,
      startedAt: new Date(),
    },
  });
  await http(
    'post',
    `/customers/${c.id}/journey/entries?company=SHOP`,
    { kind: 'MARKED_LOST', lostReason: 'OTHER' },
    id,
  ).expect(403);
  const list = await http(
    'get',
    `/customers/${c.id}/journey?company=SHOP&groups=sale`,
    undefined,
    id,
  ).expect(200);
  expect(list.body.events.some((e: { type: string }) => e.type === 'SAVING_PLAN_OPENED')).toBe(
    false,
  );
});
it('originless alias needs its own genuine readable child, never the canonical target proof', async () => {
  const c = await customer(),
    id = await user();
  await grant(id, ['customers.read', 'customer-journey.read'], 'SHOP', [branchA]);
  const alias = await db.customer.create({
    data: { name: 'Original alias', deletedAt: new Date(), mergedIntoId: c.id },
  });
  await sale(alias.id, branchA, new Date());
  const e = await db.customerJourneyEntry.create({
    data: {
      customerId: c.id,
      originCustomerId: alias.id,
      origin: 'MANUAL',
      kind: 'HEARD_FROM',
      heardFrom: 'FRIEND',
      occurredAt: new Date(),
      actorType: 'STAFF',
      actorUserId: actor,
    },
  });
  const before = await http(
    'get',
    `/customers/${c.id}/journey?company=SHOP&groups=chat`,
    undefined,
    id,
  ).expect(200);
  expect(before.body.events.some((v: { entryId?: string }) => v.entryId === e.id)).toBe(false);
  await grant(id, ['sales.read'], 'SHOP', [branchA]);
  const after = await http(
    'get',
    `/customers/${c.id}/journey?company=SHOP&groups=chat`,
    undefined,
    id,
  ).expect(200);
  expect(after.body.events.some((v: { entryId?: string }) => v.entryId === e.id)).toBe(true);
});
it('immutable original rejects restamping but permits canonical move/undo and existing erasure', async () => {
  const a = await customer(),
    b = await customer(),
    e = await entry(a.id);
  await expect(
    db.customerJourneyEntry.update({ where: { id: e.id }, data: { originCustomerId: b.id } }),
  ).rejects.toThrow('immutable');
  await db.customerJourneyEntry.update({
    where: { id: e.id },
    data: { customerId: b.id, deletedAt: new Date(), deletedById: actor },
  });
  expect(
    (await db.customerJourneyEntry.findUniqueOrThrow({ where: { id: e.id } })).originCustomerId,
  ).toBe(a.id);
  const removableActor = await user();
  await db.customerJourneyEntry.update({
    where: { id: e.id },
    data: { actorUserId: removableActor },
  });
  await db.user.delete({ where: { id: removableActor } });
  expect(
    (await db.customerJourneyEntry.findUniqueOrThrow({ where: { id: e.id } })).actorUserId,
  ).toBeNull();
  await db.customerJourneyEntry.delete({ where: { id: e.id } });
});
it('same request retries once and rejects reuse by a different actor or payload', async () => {
  const c = await customer(),
    clientRequestId = randomUUID(),
    body = { kind: 'TOUCHPOINT', channel: 'PHONE', outcome: 'THINKING', clientRequestId };
  const [a, b] = await Promise.all([
    http('post', `/customers/${c.id}/journey/entries?company=SHOP`, body).expect(201),
    http('post', `/customers/${c.id}/journey/entries?company=SHOP`, body).expect(201),
  ]);
  expect(a.body.entryId).toBe(b.body.entryId);
  expect(
    await db.auditLog.count({
      where: { action: 'CUSTOMER_JOURNEY_ENTRY_CREATED', entityId: a.body.entryId },
    }),
  ).toBe(1);
  await http('post', `/customers/${c.id}/journey/entries?company=SHOP`, {
    ...body,
    outcome: 'VISITED',
  }).expect(409);
  const otherActor = await broadUser();
  await http('post', `/customers/${c.id}/journey/entries?company=SHOP`, body, otherActor).expect(
    409,
  );
});
it('required audit failure rolls back entry and never recomputes', async () => {
  const c = await customer(),
    audit = app.get(AuditService),
    state = app.get(JourneyStateService);
  const original = audit.log.bind(audit),
    recompute = jest.spyOn(state, 'recompute');
  const quiet = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  const spy = jest
    .spyOn(audit, 'log')
    .mockImplementation((e, tx) =>
      e.action === 'CUSTOMER_JOURNEY_ENTRY_CREATED'
        ? Promise.reject(new Error('PRIVATE_REQUIRED_AUDIT_FAILURE'))
        : original(e, tx),
    );
  await http('post', `/customers/${c.id}/journey/entries?company=SHOP`, {
    kind: 'HEARD_FROM',
    heardFrom: 'OTHER',
  }).expect(500);
  expect(await db.customerJourneyEntry.count({ where: { customerId: c.id } })).toBe(0);
  expect(recompute).not.toHaveBeenCalled();
  await Promise.allSettled([...pendingAudits]);
  const requests = await db.auditLog.findMany({ where: { entityId: c.id, action: 'POST_ERROR' } });
  expect(requests.length).toBeGreaterThan(0);
  expect(JSON.stringify(requests.map((row) => row.newValue))).not.toContain(
    'PRIVATE_REQUIRED_AUDIT_FAILURE',
  );
  expect(requests[0].newValue).toMatchObject({
    outcome: 'ERROR',
    statusCode: 500,
    presentFields: ['kind', 'heardFrom'],
  });
  spy.mockRestore();
  recompute.mockRestore();
  quiet.mockRestore();
});
it('successful mutation recomputes exactly once after commit; replay and repeated undo do not', async () => {
  const c = await customer(),
    state = app.get(JourneyStateService),
    original = state.recompute.bind(state);
  let observations = 0;
  const spy = jest.spyOn(state, 'recompute').mockImplementation(async (ids) => {
    observations++;
    expect(await db.customerJourneyEntry.count({ where: { customerId: c.id } })).toBe(1);
    await original(ids);
  });
  const body = { kind: 'HEARD_FROM', heardFrom: 'OTHER', clientRequestId: randomUUID() };
  const result = await http('post', `/customers/${c.id}/journey/entries?company=SHOP`, body).expect(
    201,
  );
  await http('post', `/customers/${c.id}/journey/entries?company=SHOP`, body).expect(201);
  expect(observations).toBe(1);
  await http(
    'delete',
    `/customers/${c.id}/journey/entries/${result.body.entryId}?company=SHOP`,
  ).expect(200);
  await http(
    'delete',
    `/customers/${c.id}/journey/entries/${result.body.entryId}?company=SHOP`,
  ).expect(200);
  expect(observations).toBe(2);
  spy.mockRestore();
});

it('linked online order/application/reservation/saving remain useful; unlinked interests do not inherit current Product', async () => {
  const c = await customer(),
    id = await broadUser(),
    k = await contract(c.id);
  const sold = await sale(c.id, branchA, new Date());
  await db.sale.update({ where: { id: sold.id }, data: { saleSource: 'ONLINE' } });
  const hold = await db.productReservation.create({
    data: {
      customerId: c.id,
      productId: sold.productId,
      sessionId: randomUUID(),
      reservedAt: new Date(),
      expiresAt: new Date(Date.now() + 3600000),
    },
  });
  const order = await db.onlineOrder.create({
    data: {
      customerId: c.id,
      saleId: sold.id,
      productId: sold.productId,
      reservationId: hold.id,
      orderNumber: randomUUID(),
      productPrice: 1000,
      totalAmount: 1000,
      shippingMethod: 'BRANCH_PICKUP',
      paymentChannel: 'PROMPTPAY_QR',
    },
  });
  const application = await db.onlineInstallmentApplication.create({
    data: {
      customerId: c.id,
      contractId: k.id,
      productId: k.productId,
      applicationNumber: randomUUID(),
      fullName: 'PRIVATE_APPLICANT',
      phone: '0811111111',
      nationalId: '1234567890123',
      proposedDownPayment: 1000,
      proposedTotalMonths: 10,
      proposedMonthlyPayment: 990,
    },
  });
  const saving = await db.savingPlan.create({
    data: {
      customerId: c.id,
      appliedToContractId: k.id,
      planNumber: randomUUID(),
      targetAmount: 1000,
      monthlyAmount: 100,
      durationMonths: 10,
      startedAt: new Date(),
    },
  });
  const unsupported = await db.savingPlan.create({
    data: {
      customerId: c.id,
      targetProductId: k.productId,
      planNumber: randomUUID(),
      targetAmount: 1000,
      monthlyAmount: 100,
      durationMonths: 10,
      startedAt: new Date(),
    },
  });
  const response = await http(
    'get',
    `/customers/${c.id}/journey?company=SHOP&groups=sale&limit=100&include=counts`,
    undefined,
    id,
  ).expect(200);
  const ids = response.body.events.map((e: { id: string }) => e.id);
  for (const expected of [
    `onlineorder-${order.id}`,
    `onlineapp-${application.id}`,
    `webhold-${hold.id}`,
    `savingplan-${saving.id}`,
  ])
    expect(ids).toContain(expected);
  expect(ids).not.toContain(`savingplan-${unsupported.id}`);
  expect(response.body.availability.sale).toBe('partial');
  expect(JSON.stringify(response.body)).not.toContain('PRIVATE_APPLICANT');
});
it('actual attributed room requires independent analytics; no raw audit JSON or hidden ad leaks', async () => {
  const c = await customer();
  await db.customer.update({ where: { id: c.id }, data: { createdAt: new Date('2026-02-01') } });
  const campaign = await db.adsCampaign.create({
    data: {
      platform: 'FACEBOOK_ADS',
      campaignId: randomUUID(),
      campaignName: 'Authorized campaign',
    },
  });
  const attribution = await db.adsAttribution.create({
    data: {
      customerId: c.id,
      campaignId: campaign.id,
      referrerUrl: 'ADS',
      firstTouch: new Date('2026-01-01'),
    },
  });
  const room = await db.chatRoom.create({
    data: {
      customerId: c.id,
      channel: 'LINE_SHOP',
      attributionId: attribution.id,
      createdAt: new Date('2026-01-01'),
    },
  });
  await db.auditLog.create({
    data: {
      entity: 'customer',
      entityId: c.id,
      action: 'AI_LEAD_CAPTURED',
      userId: actor,
      newValue: {
        roomId: room.id,
        packageChoice: 'PRIVATE_PACKAGE',
        productId: 'PRIVATE_PRODUCT',
        phone: 'PRIVATE_PHONE',
      },
    },
  });
  const before = await http(
    'get',
    `/customers/${c.id}/journey?company=SHOP&groups=chat&include=summary`,
  ).expect(200);
  expect(before.body.summary.facts.firstAd).toBeNull();
  expect(JSON.stringify(before.body)).not.toContain('Authorized campaign');
  const id = await broadUser();
  const after = await http(
    'get',
    `/customers/${c.id}/journey?company=SHOP&groups=chat&include=summary`,
    undefined,
    id,
  ).expect(200);
  expect(after.body.summary.facts.firstAd).toEqual({
    id: campaign.id,
    name: 'Authorized campaign',
  });
  expect(after.body.events.some((e: { type: string }) => e.type === 'AI_LEAD_CAPTURED')).toBe(true);
  expect(JSON.stringify(after.body)).not.toContain('PRIVATE_');
});
it('national-ID and chat-file milestones require same-source independent capabilities', async () => {
  const c = await customer();
  await db.customer.update({ where: { id: c.id }, data: { nationalId: '1234567890123' } });
  const room = await db.chatRoom.create({ data: { customerId: c.id, channel: 'LINE_SHOP' } });
  await db.chatMessage.create({
    data: {
      roomId: room.id,
      role: 'CUSTOMER',
      type: 'FILE',
      mediaUrl: 'https://private.invalid/statement.pdf',
    },
  });
  const before = await http(
    'get',
    `/customers/${c.id}/journey?company=SHOP&groups=chat&include=summary`,
  ).expect(200);
  expect(before.body.events.some((e: { type: string }) => e.type === 'CHAT_CUSTOMER_FILE')).toBe(
    false,
  );
  expect(
    before.body.summary.facts.steps.find((s: { stage: string }) => s.stage === 'IDENTIFIED').state,
  ).toBe('unknown');
  const id = await user();
  await grant(
    id,
    ['customers.read', 'customer-journey.read', 'chat.read', 'documents.read'],
    'SHOP',
  );
  await grant(id, ['sensitive.customer-identity.read'], 'SHOP', [branchB]);
  const partial = await http(
    'get',
    `/customers/${c.id}/journey?company=SHOP&groups=chat&include=summary`,
    undefined,
    id,
  ).expect(200);
  expect(partial.body.events.some((e: { type: string }) => e.type === 'CHAT_CUSTOMER_FILE')).toBe(
    true,
  );
  expect(
    partial.body.summary.facts.steps.find((s: { stage: string }) => s.stage === 'IDENTIFIED').state,
  ).toBe('unknown');
  await grant(id, ['sensitive.customer-identity.read'], 'SHOP');
  const after = await http(
    'get',
    `/customers/${c.id}/journey/summary?company=SHOP`,
    undefined,
    id,
  ).expect(200);
  expect(
    after.body.facts.steps.find((s: { stage: string }) => s.stage === 'IDENTIFIED').at,
  ).not.toBeNull();
  expect(JSON.stringify(after.body)).not.toContain('1234567890123');
  expect(JSON.stringify(partial.body)).not.toContain('private.invalid');
});
it('current source row lock waits for a concurrent Sale move and retries before history disclosure', async () => {
  const c = await customer(),
    sold = await sale(c.id, branchA, new Date()),
    id = await user();
  await grant(id, ['customers.read', 'customer-journey.read', 'sales.read'], 'SHOP', [branchA]);
  let response: Promise<request.Response> | undefined;
  await db.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT id FROM sales WHERE id=${sold.id} FOR UPDATE`;
      response = http('get', `/customers/${c.id}/journey?company=SHOP&groups=sale`, undefined, id)
        .expect(200)
        .then((r) => r);
      let waiting = false;
      for (let i = 0; i < 200; i++) {
        const rows = await tx.$queryRaw<
          { waiting: boolean }[]
        >`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND pid<>pg_backend_pid()) AS waiting`;
        if (rows[0].waiting) {
          waiting = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      expect(waiting).toBe(true);
      await tx.sale.update({ where: { id: sold.id }, data: { branchId: branchB } });
    },
    { timeout: 10000 },
  );
  expect(
    (await response!).body.events.some((e: { id: string }) => e.id === `sale-${sold.id}`),
  ).toBe(false);
});
it('group availability is stable when an inaccessible foreign record is added', async () => {
  const c = await customer(),
    id = await user();
  await grant(id, ['customers.read', 'customer-journey.read', 'sales.read'], 'SHOP', [branchA]);
  const before = await http(
    'get',
    `/customers/${c.id}/journey?company=SHOP&groups=sale&include=counts`,
    undefined,
    id,
  ).expect(200);
  await sale(c.id, branchB, new Date());
  const after = await http(
    'get',
    `/customers/${c.id}/journey?company=SHOP&groups=sale&include=counts`,
    undefined,
    id,
  ).expect(200);
  expect(after.body.availability).toEqual(before.body.availability);
  expect(after.body.counts).toEqual(before.body.counts);
});
it('unknown acquisition never becomes WALK_IN merely because authorized attribution is absent', async () => {
  const c = await customer();
  await db.customer.update({ where: { id: c.id }, data: { acquisitionSource: 'CHAT_FACEBOOK' } });
  const hidden = await http('get', `/customers/${c.id}/journey/summary?company=SHOP`).expect(200);
  expect(hidden.body.facts.firstChannel).toBeNull();
  expect(hidden.body.facts.firstSource).toBeNull();
  await db.customer.update({ where: { id: c.id }, data: { acquisitionSource: 'WALK_IN' } });
  const known = await http('get', `/customers/${c.id}/journey/summary?company=SHOP`).expect(200);
  expect(known.body.facts.firstChannel).toBe('WALK_IN');
  expect(known.body.facts.firstSource).toBe('WALK_IN');
});
it('loyalty payment backlink cannot cross to a different Contract', async () => {
  const c = await customer(),
    other = await customer(),
    id = await broadUser(),
    k = await contract(c.id),
    foreign = await contract(other.id);
  const pay = await db.payment.create({
    data: { contractId: foreign.id, installmentNo: 1, dueDate: new Date(), amountDue: 990 },
  });
  const point = await db.loyaltyPoint.create({
    data: { customerId: c.id, contractId: k.id, paymentId: pay.id, points: 10 },
  });
  const response = await http(
    'get',
    `/customers/${c.id}/journey?company=SHOP&groups=points`,
    undefined,
    id,
  ).expect(200);
  expect(response.body.events.some((e: { id: string }) => e.id === `points-${point.id}`)).toBe(
    false,
  );
});
it('dedupe replay requires original alias authority even when current target is writable', async () => {
  const c = await customer(),
    alias = await customer(),
    id = await user(),
    clientRequestId = randomUUID();
  await grant(id, ['customers.read', 'customers.update'], 'SHOP', [branchA]);
  const body = { kind: 'TOUCHPOINT', channel: 'PHONE', outcome: 'THINKING', clientRequestId };
  const made = await http(
    'post',
    `/customers/${alias.id}/journey/entries?company=SHOP`,
    body,
    id,
  ).expect(201);
  await db.customer.update({
    where: { id: alias.id },
    data: { deletedAt: new Date(), mergedIntoId: c.id },
  });
  await db.customerJourneyEntry.update({
    where: { id: made.body.entryId },
    data: { customerId: c.id },
  });
  await sale(alias.id, branchB, new Date());
  await http('post', `/customers/${c.id}/journey/entries?company=SHOP`, body, id).expect(403);
  expect(
    await db.auditLog.count({
      where: { action: 'CUSTOMER_JOURNEY_ENTRY_CREATED', entityId: made.body.entryId },
    }),
  ).toBe(1);
});
it('finite outer evidence records exact read/write denials without request values or raw errors', async () => {
  const c = await customer();
  await http('get', `/customers/${c.id}/journey?company=SHOP&search=PRIVATE_QUERY`).expect(200);
  await http(
    'post',
    `/customers/${c.id}/journey/entries?company=SHOP`,
    { kind: 'HEARD_FROM', heardFrom: 'OTHER', note: 'PRIVATE_NOTE' },
    denied,
  ).expect(403);
  await Promise.allSettled([...pendingAudits]);
  const rows = await db.auditLog.findMany({
    where: { entityId: c.id, action: { in: ['GET', 'POST_ERROR'] } },
  });
  expect(rows).toHaveLength(2);
  for (const row of rows) {
    expect(Object.keys(row.newValue as object).sort()).toEqual([
      'duration',
      'outcome',
      'presentFields',
      'statusCode',
    ]);
    expect(JSON.stringify(row.newValue)).not.toContain('PRIVATE_');
  }
});
it('complete business authority does not turn unreadable file or identity milestones into negative facts', async () => {
  const c = await customer(),
    id = await user();
  const hidden = [
    'sensitive.customer-identity.read',
    'documents.read',
    'chat-ai.read',
    'chat-analytics.read',
  ];
  const permissions = PERMISSION_CATALOG.filter((p) => !p.ownerOnly && !hidden.includes(p.key)).map(
    (p) => p.key,
  );
  await grant(id, permissions, 'SHOP');
  await grant(id, permissions, 'FINANCE');
  const room = await db.chatRoom.create({ data: { customerId: c.id, channel: 'LINE_SHOP' } });
  await db.chatMessage.create({
    data: {
      roomId: room.id,
      role: 'CUSTOMER',
      type: 'FILE',
      mediaUrl: 'https://private.invalid/proof.pdf',
    },
  });
  const response = await http(
    'get',
    `/customers/${c.id}/journey/summary?company=SHOP`,
    undefined,
    id,
  ).expect(200);
  expect(response.body.availability).toBe('partial');
  expect(response.body.facts.creditFilePending).toBeNull();
  expect(response.body.facts.steps.find((s: { stage: string }) => s.stage === 'CREDIT').state).toBe(
    'unknown',
  );
});
