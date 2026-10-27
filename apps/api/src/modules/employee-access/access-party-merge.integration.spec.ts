import { lockEmployeeAccess } from './access-snapshot.service';
import { AccessProcurementSourceService } from './access-procurement-source.service';
import { AccessPartyBoundaries } from './access-party-boundaries';
import { AccessPartySourceService } from './access-party-source.service';
import { CustomerPurchaseSummaryService } from '../customers/services/customer-purchase-summary.service';
import { CustomerChatRoomsService } from '../customers/services/customer-chat-rooms.service';
import { randomUUID } from 'node:crypto';
import { Prisma, PrismaClient } from '@prisma/client';
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
import { JourneyStateService } from '../customer-journey/journey-state.service';
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
    .expect('x-owned-merge-app', testRun)
    .on('response', (response) => {
      if (response.headers['x-owned-merge-app'] !== testRun)
        console.error(
          'OWNED_HTTP_MARKER_MISMATCH',
          JSON.stringify({
            status: response.status,
            marker: response.headers['x-owned-merge-app'] ?? null,
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
      CustomerMergeService,
      {
        provide: JourneyStateService,
        useValue: { recompute: jest.fn().mockResolvedValue(undefined) },
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
      res.setHeader('x-owned-merge-app', testRun);
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

async function contact(extra: object = {}) {
  return db.contact.create({
    data: {
      contactCode: randomUUID(),
      name: 'Contact',
      roles: ['CUSTOMER'],
      accessCompanyCode: 'SHOP',
      accessBranchId: branchA,
      ...extra,
    },
  });
}
async function pair() {
  const source = await customer({ acquisitionSource: 'CHAT_FACEBOOK' });
  const target = await customer({ phone: '0891234567' });
  return { source, target };
}
it('permits legitimate customer absorption with a narrow acknowledgement', async () => {
  const { source, target } = await pair();
  const response = await http(
    'post',
    `/customers/${source.id}/absorb-into/${target.id}?company=SHOP`,
  ).expect(201);
  expect(response.body).toEqual({ placeholderId: source.id, targetId: target.id });
  expect(await db.customer.findUniqueOrThrow({ where: { id: source.id } })).toMatchObject({
    mergedIntoId: target.id,
  });
});
it('denies customer absorption without grants and leaves both identities unchanged', async () => {
  const { source, target } = await pair();
  await http(
    'post',
    `/customers/${source.id}/absorb-into/${target.id}?company=SHOP`,
    undefined,
    denied,
  ).expect(403);
  expect(await db.customer.findUniqueOrThrow({ where: { id: source.id } })).toMatchObject({
    mergedIntoId: null,
    deletedAt: null,
  });
});
it('permits legitimate contact merge with a narrow acknowledgement', async () => {
  const primary = await contact(),
    duplicate = await contact({ taxId: randomUUID() });
  const response = await http('post', '/contacts/merge?company=SHOP', {
    primaryId: primary.id,
    duplicateId: duplicate.id,
  }).expect(201);
  expect(response.body).toEqual({ primaryId: primary.id, duplicateId: duplicate.id });
  expect(await db.contact.findUniqueOrThrow({ where: { id: primary.id } })).toMatchObject({
    taxId: duplicate.taxId,
  });
});
it('denies contact merge without grants and leaves both identities unchanged', async () => {
  const primary = await contact(),
    duplicate = await contact();
  await http(
    'post',
    '/contacts/merge?company=SHOP',
    { primaryId: primary.id, duplicateId: duplicate.id },
    denied,
  ).expect(403);
  expect(await db.contact.findUniqueOrThrow({ where: { id: duplicate.id } })).toMatchObject({
    deletedAt: null,
  });
});

it.each(['source', 'target'] as const)(
  'requires current authority for the %s customer',
  async (side) => {
    const source = await customer({
      acquisitionSource: 'CHAT_FACEBOOK',
      accessBranchId: side === 'source' ? branchB : branchA,
    });
    const target = await customer({
      phone: '0891234567',
      accessBranchId: side === 'target' ? branchB : branchA,
    });
    const staff = await reader(['customers.read', 'customers.update'], 'SHOP', [branchA]);
    await http(
      'post',
      `/customers/${source.id}/absorb-into/${target.id}?company=SHOP`,
      undefined,
      staff,
    ).expect(403);
    expect(
      (await db.customer.findUniqueOrThrow({ where: { id: source.id } })).deletedAt,
    ).toBeNull();
  },
);
it.each(['primary', 'duplicate'] as const)(
  'requires current authority for the %s contact',
  async (side) => {
    const primary = await contact({ accessBranchId: side === 'primary' ? branchB : branchA }),
      duplicate = await contact({ accessBranchId: side === 'duplicate' ? branchB : branchA });
    const staff = await reader(['contacts.read', 'contacts.update'], 'SHOP', [branchA]);
    await http(
      'post',
      '/contacts/merge?company=SHOP',
      { primaryId: primary.id, duplicateId: duplicate.id },
      staff,
    ).expect(403);
    expect(
      (await db.contact.findUniqueOrThrow({ where: { id: duplicate.id } })).deletedAt,
    ).toBeNull();
  },
);
it('does not cross-product position actions and branches', async () => {
  const primary = await contact({ accessBranchId: branchB }),
    duplicate = await contact({ accessBranchId: branchB });
  const staff = await reader(['contacts.read', 'contacts.update'], 'SHOP', [branchA]);
  await grant(staff, ['contacts.read'], 'SHOP', [branchB]);
  await http(
    'post',
    '/contacts/merge?company=SHOP',
    { primaryId: primary.id, duplicateId: duplicate.id },
    staff,
  ).expect(403);
});
it('keeps partial unique ordering, original identity provenance and assignment', async () => {
  const primary = await contact({ assignedToId: actor }),
    duplicate = await contact({
      taxId: randomUUID(),
      nationalIdHash: randomUUID(),
      accessBranchId: branchB,
      assignedToId: denied,
    });
  await http('post', '/contacts/merge?company=SHOP', {
    primaryId: primary.id,
    duplicateId: duplicate.id,
  }).expect(201);
  expect(await db.contact.findUniqueOrThrow({ where: { id: primary.id } })).toMatchObject({
    accessBranchId: branchA,
    assignedToId: actor,
    taxId: duplicate.taxId,
    nationalIdHash: duplicate.nationalIdHash,
  });
  expect(await db.contact.findUniqueOrThrow({ where: { id: duplicate.id } })).toMatchObject({
    accessBranchId: branchB,
    assignedToId: denied,
  });
});
it('uses a generic hidden blocker conflict and preserves archived blocking relations', async () => {
  const { source, target } = await pair();
  await contract(source.id, branchA, { deletedAt: new Date() });
  await grant(actor, ['customers.read', 'customers.update'], 'FINANCE');
  const response = await http(
    'post',
    `/customers/${source.id}/absorb-into/${target.id}?company=SHOP`,
  ).expect(409);
  expect(response.body.message).toBe('ข้อมูลซ้ำหรือเปลี่ยนแปลง กรุณาตรวจสอบแล้วลองใหม่');
  expect(
    (await db.customer.findUniqueOrThrow({ where: { id: source.id } })).mergedIntoId,
  ).toBeNull();
});

const customerPermissions: PermissionKey[] = ['customers.read', 'customers.update'];
async function room(customerId: string, extra: object = {}) {
  return db.chatRoom.create({
    data: { customerId, channel: 'FACEBOOK', externalUserId: randomUUID(), ...extra },
  });
}
async function entry(customerId: string, extra: object = {}) {
  return db.customerJourneyEntry.create({
    data: {
      customerId,
      originCustomerId: customerId,
      origin: 'MANUAL',
      kind: 'TOUCHPOINT',
      actorType: 'STAFF',
      occurredAt: new Date(),
      ...extra,
    },
  });
}
function absorb(sourceId: string, targetId: string, id = actor) {
  return http('post', `/customers/${sourceId}/absorb-into/${targetId}?company=SHOP`, undefined, id);
}
function merge(primaryId: string, duplicateId: string, id = actor) {
  return http('post', '/contacts/merge?company=SHOP', { primaryId, duplicateId }, id);
}

it('requires room actions independently and includes archived rooms without changing assignment', async () => {
  const { source, target } = await pair();
  const archived = await room(source.id, { assignedToId: denied, deletedAt: new Date() });
  const staff = await reader(customerPermissions);
  await absorb(source.id, target.id, staff).expect(403);
  await grant(staff, ['chat.read', 'chat.update']);
  await absorb(source.id, target.id, staff).expect(201);
  expect(await db.chatRoom.findUniqueOrThrow({ where: { id: archived.id } })).toMatchObject({
    customerId: target.id,
    assignedToId: denied,
    deletedAt: archived.deletedAt,
  });
});
it('does not use identity ASSIGNED authority as room ASSIGNED authority', async () => {
  const staff = await reader(customerPermissions, 'SHOP', undefined, true);
  await grant(staff, ['chat.read', 'chat.update'], 'SHOP', undefined, 'ASSIGNED');
  const { source, target } = await pair();
  await db.customer.updateMany({
    where: { id: { in: [source.id, target.id] } },
    data: { assignedToId: staff },
  });
  const r = await room(source.id, { assignedToId: denied });
  await absorb(source.id, target.id, staff).expect(403);
  await db.chatRoom.update({ where: { id: r.id }, data: { assignedToId: staff } });
  await absorb(source.id, target.id, staff).expect(201);
});
it('requires FINANCE room authority without flattening SHOP grants', async () => {
  const { source, target } = await pair();
  await room(source.id, { channel: 'LINE_FINANCE', deletedAt: new Date() });
  const staff = await reader([...customerPermissions, 'chat.read', 'chat.update']);
  await absorb(source.id, target.id, staff).expect(403);
  await grant(staff, [...customerPermissions, 'chat.read', 'chat.update'], 'FINANCE');
  await absorb(source.id, target.id, staff).expect(201);
});
it.each([false, true])(
  'checks correlated credit and its secondary actions (archived=%s)',
  async (archived) => {
    const { source, target } = await pair();
    const r = await room(source.id);
    const credit = await db.creditCheck.create({
      data: { customerId: source.id, ...(archived ? { deletedAt: new Date() } : {}) },
    });
    await db.roomCreditAnalysis.create({
      data: {
        roomId: r.id,
        creditCheckId: credit.id,
        fileIds: [],
        ...(archived ? { deletedAt: new Date() } : {}),
      },
    });
    const staff = await reader([...customerPermissions, 'chat.read', 'chat.update']);
    await absorb(source.id, target.id, staff).expect(403);
    await grant(staff, ['credit-checks.read', 'credit-checks.update']);
    await absorb(source.id, target.id, staff).expect(201);
    expect(await db.creditCheck.findUniqueOrThrow({ where: { id: credit.id } })).toMatchObject({
      customerId: target.id,
      deletedAt: credit.deletedAt,
    });
  },
);
it.each(['unlinked', 'unrelated'] as const)(
  'denies %s credit rather than inferring company from customer',
  async (kind) => {
    const { source, target } = await pair();
    const credit = await db.creditCheck.create({ data: { customerId: source.id } });
    if (kind === 'unrelated') {
      const other = await customer(),
        r = await room(other.id);
      await db.roomCreditAnalysis.create({
        data: { roomId: r.id, creditCheckId: credit.id, fileIds: [] },
      });
    }
    const staff = await reader([
      ...customerPermissions,
      'chat.read',
      'chat.update',
      'credit-checks.read',
      'credit-checks.update',
    ]);
    await absorb(source.id, target.id, staff).expect(403);
    expect((await db.creditCheck.findUniqueOrThrow({ where: { id: credit.id } })).customerId).toBe(
      source.id,
    );
  },
);
it.each(['MANUAL', 'AUTO'] as const)(
  'uses update/delete and preserves canonical %s tag dedup',
  async (sourceKind) => {
    const { source, target } = await pair();
    const moved = await db.customerTag.create({
      data: { customerId: source.id, source: sourceKind, tag: 'NEW' },
    });
    const duplicate = await db.customerTag.create({
      data: { customerId: source.id, source: sourceKind, tag: 'VIP' },
    });
    await db.customerTag.create({
      data: { customerId: target.id, source: sourceKind, tag: 'VIP' },
    });
    const staff = await reader([
      ...customerPermissions,
      'customer-tags.read',
      'customer-tags.update',
    ]);
    await absorb(source.id, target.id, staff).expect(403);
    await grant(staff, ['customer-tags.delete']);
    await absorb(source.id, target.id, staff).expect(201);
    expect(await db.customerTag.findUniqueOrThrow({ where: { id: moved.id } })).toMatchObject({
      customerId: target.id,
      source: sourceKind,
      deletedAt: null,
    });
    expect(
      (await db.customerTag.findUniqueOrThrow({ where: { id: duplicate.id } })).deletedAt,
    ).not.toBeNull();
  },
);
it('checks archived CRM independent branch and retains stage, assignee and history', async () => {
  const { source, target } = await pair();
  const lead = await db.crmLead.create({
    data: {
      customerId: source.id,
      source: 'WALK_IN',
      branchId: branchB,
      assignedToId: denied,
      stage: 'LOST',
      deletedAt: new Date(),
    },
  });
  const staff = await reader(customerPermissions, 'SHOP', [branchA]);
  await absorb(source.id, target.id, staff).expect(403);
  await grant(staff, customerPermissions, 'SHOP', [branchB]);
  await absorb(source.id, target.id, staff).expect(201);
  expect(await db.crmLead.findUniqueOrThrow({ where: { id: lead.id } })).toMatchObject({
    customerId: target.id,
    branchId: branchB,
    assignedToId: denied,
    stage: 'LOST',
    deletedAt: lead.deletedAt,
  });
});
async function attribution(customerId: string) {
  const campaign = await db.adsCampaign.create({
    data: { platform: 'FACEBOOK_ADS', campaignId: randomUUID(), campaignName: 'Fixture' },
  });
  return db.adsAttribution.create({
    data: { campaignId: campaign.id, customerId, firstTouch: new Date(), revenue: 123 },
  });
}
it('allows unanchored Ads lineage but rejects a present unrelated room anchor', async () => {
  const { source, target } = await pair();
  const ad = await attribution(source.id);
  const other = await customer(),
    r = await room(other.id, { attributionId: ad.id });
  await absorb(source.id, target.id).expect(403);
  await db.chatRoom.update({ where: { id: r.id }, data: { attributionId: null } });
  await absorb(source.id, target.id).expect(201);
  expect(await db.adsAttribution.findUniqueOrThrow({ where: { id: ad.id } })).toMatchObject({
    customerId: target.id,
    firstTouch: ad.firstTouch,
    revenue: ad.revenue,
  });
});
it('checks external application room/branch and actions while retaining sent private snapshots', async () => {
  const { source, target } = await pair();
  const r = await room(source.id),
    lender = await db.externalFinanceCompany.create({ data: { name: randomUUID() } });
  const application = await db.externalFinanceApplication.create({
    data: {
      number: randomUUID(),
      roomId: r.id,
      financeCompanyId: lender.id,
      customerId: source.id,
      branchId: branchB,
      createdById: actor,
      deletedAt: new Date(),
      messageText: 'PRIVATE',
      summary: { private: true },
    },
  });
  const staff = await reader([...customerPermissions, 'chat.read', 'chat.update']);
  await grant(staff, ['external-finance.read', 'external-finance.update'], 'SHOP', [branchA]);
  await absorb(source.id, target.id, staff).expect(403);
  await grant(staff, ['external-finance.read', 'external-finance.update'], 'SHOP', [branchB]);
  await absorb(source.id, target.id, staff).expect(201);
  expect(
    await db.externalFinanceApplication.findUniqueOrThrow({ where: { id: application.id } }),
  ).toMatchObject({
    customerId: target.id,
    branchId: branchB,
    financeCompanyId: lender.id,
    roomId: r.id,
    messageText: 'PRIVATE',
    summary: { private: true },
    deletedAt: application.deletedAt,
  });
});
it('checks actual aliases, preserves immutable journey origin, and deduplicates only canonical triggers', async () => {
  const { source, target } = await pair();
  const alias = await customer({
    mergedIntoId: source.id,
    deletedAt: new Date(),
    accessBranchId: branchB,
    assignedToId: denied,
  });
  const historic = await entry(source.id, {
    originCustomerId: alias.id,
    deletedAt: new Date(),
    note: 'history',
  });
  const payload = { private: true },
    trigger = { triggerType: 'RECEIPT_DELIVERY' as const, scheduledFor: new Date(), payload };
  const moved = await db.chatAutoTrigger.create({
    data: { ...trigger, customerId: source.id, referenceKey: randomUUID() },
  });
  const duplicate = await db.chatAutoTrigger.create({
    data: { ...trigger, customerId: source.id, referenceKey: 'same-' + source.id },
  });
  await db.chatAutoTrigger.create({
    data: { ...trigger, customerId: target.id, referenceKey: duplicate.referenceKey },
  });
  const staff = await reader(customerPermissions, 'SHOP', [branchA]);
  await absorb(source.id, target.id, staff).expect(403);
  await grant(staff, customerPermissions, 'SHOP', [branchB]);
  await absorb(source.id, target.id, staff).expect(201);
  expect(await db.customer.findUniqueOrThrow({ where: { id: alias.id } })).toMatchObject({
    mergedIntoId: target.id,
    accessBranchId: branchB,
    assignedToId: denied,
    deletedAt: alias.deletedAt,
  });
  expect(
    await db.customerJourneyEntry.findUniqueOrThrow({ where: { id: historic.id } }),
  ).toMatchObject({
    customerId: target.id,
    originCustomerId: alias.id,
    deletedAt: historic.deletedAt,
    note: 'history',
  });
  expect(await db.chatAutoTrigger.findUniqueOrThrow({ where: { id: moved.id } })).toMatchObject({
    customerId: target.id,
    payload,
  });
  expect(await db.chatAutoTrigger.findUnique({ where: { id: duplicate.id } })).toBeNull();
});
it('permits verified originless aliases only for mechanical lineage maintenance', async () => {
  const { source, target } = await pair();
  const alias = await customer({
    mergedIntoId: source.id,
    deletedAt: new Date(),
    accessCompanyCode: null,
    accessBranchId: null,
  });
  await entry(source.id, { originCustomerId: alias.id });
  await absorb(source.id, target.id).expect(201);
  expect(await db.customer.findUniqueOrThrow({ where: { id: alias.id } })).toMatchObject({
    mergedIntoId: target.id,
    accessCompanyCode: null,
    accessBranchId: null,
  });
});
it.each(['unknown-origin', 'unknown-ref', 'cycle', 'depth'] as const)(
  'rejects invalid family/history: %s',
  async (kind) => {
    const { source, target } = await pair();
    if (kind === 'unknown-origin') await entry(source.id, { originCustomerId: randomUUID() });
    if (kind === 'unknown-ref') await entry(source.id, { refType: 'unknown', refId: randomUUID() });
    if (kind === 'cycle')
      await db.customer.update({ where: { id: target.id }, data: { mergedIntoId: source.id } });
    if (kind === 'depth') {
      let parent = source.id;
      for (let i = 0; i < 21; i++)
        parent = (await customer({ mergedIntoId: parent, deletedAt: new Date() })).id;
    }
    const response = await absorb(source.id, target.id);
    expect([403, 409]).toContain(response.status);
    expect(
      (await db.customer.findUniqueOrThrow({ where: { id: source.id } })).deletedAt,
    ).toBeNull();
  },
);

it.each(['customer', 'supplier', 'trade-in', 'lender'] as const)(
  'checks archived Contact %s child independently and preserves history',
  async (kind) => {
    const primary = await contact(),
      duplicate = await contact();
    const staff = await reader(['contacts.read', 'contacts.update']);
    const archivedAt = new Date();
    let childId: string;
    if (kind === 'customer')
      childId = (
        await customer({
          contactId: duplicate.id,
          deletedAt: archivedAt,
          accessBranchId: branchB,
          assignedToId: denied,
        })
      ).id;
    else if (kind === 'supplier')
      childId = (
        await db.supplier.create({
          data: {
            name: 'Supplier',
            phone: '',
            contactId: duplicate.id,
            deletedAt: archivedAt,
            accessCompanyCode: 'SHOP',
            accessBranchId: branchB,
          },
        })
      ).id;
    else if (kind === 'trade-in')
      childId = (
        await db.tradeIn.create({
          data: {
            deviceBrand: 'Apple',
            deviceModel: 'Fixture',
            sellerContactId: duplicate.id,
            branchId: branchB,
            deletedAt: archivedAt,
            agreedPrice: 123,
          },
        })
      ).id;
    else
      childId = (
        await db.externalFinanceCompany.create({
          data: {
            name: randomUUID(),
            contactId: duplicate.id,
            isActive: false,
            deletedAt: archivedAt,
          },
        })
      ).id;
    await merge(primary.id, duplicate.id, staff).expect(403);
    if (kind === 'customer') await grant(staff, customerPermissions);
    else if (kind === 'supplier') await grant(staff, ['suppliers.read', 'suppliers.update']);
    else if (kind === 'trade-in') await grant(staff, ['trade-in.read', 'trade-in.update']);
    else {
      await grant(staff, ['external-finance.read', 'external-finance.update']);
      await merge(primary.id, duplicate.id, staff).expect(403);
      await grant(
        staff,
        ['contacts.read', 'contacts.update', 'external-finance.read', 'external-finance.update'],
        'FINANCE',
      );
    }
    await merge(primary.id, duplicate.id, staff).expect(201);
    if (kind === 'customer')
      expect(await db.customer.findUniqueOrThrow({ where: { id: childId } })).toMatchObject({
        contactId: primary.id,
        deletedAt: archivedAt,
        accessBranchId: branchB,
        assignedToId: denied,
      });
    else if (kind === 'supplier')
      expect(await db.supplier.findUniqueOrThrow({ where: { id: childId } })).toMatchObject({
        contactId: primary.id,
        deletedAt: archivedAt,
        accessBranchId: branchB,
      });
    else if (kind === 'trade-in')
      expect(await db.tradeIn.findUniqueOrThrow({ where: { id: childId } })).toMatchObject({
        sellerContactId: primary.id,
        deletedAt: archivedAt,
        branchId: branchB,
      });
    else
      expect(
        await db.externalFinanceCompany.findUniqueOrThrow({ where: { id: childId } }),
      ).toMatchObject({ contactId: primary.id, deletedAt: archivedAt, isActive: false });
  },
);
it('requires paired COMPANY scopes for global lender maintenance', async () => {
  const primary = await contact(),
    duplicate = await contact();
  await db.externalFinanceCompany.create({ data: { name: randomUUID(), contactId: duplicate.id } });
  const staff = await reader(['contacts.read', 'contacts.update']);
  await grant(staff, ['contacts.read', 'contacts.update'], 'FINANCE');
  await grant(staff, ['external-finance.read', 'external-finance.update'], 'SHOP', [branchA]);
  await grant(staff, ['external-finance.read', 'external-finance.update'], 'FINANCE', [branchA]);
  await merge(primary.id, duplicate.id, staff).expect(403);
});
it('does not require child business write permission for unchanged primary Contact children', async () => {
  const primary = await contact(),
    duplicate = await contact();
  await customer({ contactId: primary.id });
  const staff = await reader(['contacts.read', 'contacts.update']);
  await merge(primary.id, duplicate.id, staff).expect(201);
});
it('supports only correlated canonical product-click journey entries with independent products.read', async () => {
  const { source, target } = await pair(),
    r = await room(source.id);
  const product = await db.product.create({
    data: {
      name: 'Device',
      brand: 'Apple',
      model: 'Fixture',
      category: 'PHONE_NEW',
      costPrice: 100,
      branchId: branchB,
      deletedAt: new Date(),
    },
  });
  const historic = await entry(source.id, {
    kind: 'PRODUCT_LINK_CLICK',
    origin: 'SYSTEM',
    roomId: r.id,
    refType: 'product',
    refId: product.id,
  });
  const staff = await reader([...customerPermissions, 'chat.read', 'chat.update']);
  await absorb(source.id, target.id, staff).expect(403);
  await grant(staff, ['products.read'], 'SHOP', [branchB]);
  await absorb(source.id, target.id, staff).expect(201);
  expect(
    await db.customerJourneyEntry.findUniqueOrThrow({ where: { id: historic.id } }),
  ).toMatchObject({
    customerId: target.id,
    originCustomerId: source.id,
    roomId: r.id,
    refId: product.id,
  });
  expect((await db.product.findUniqueOrThrow({ where: { id: product.id } })).deletedAt).toEqual(
    product.deletedAt,
  );
});
it.each([true, false])(
  'validates actual typed audit references without changing audit content: correlated=%s',
  async (correlated) => {
    const { source, target } = await pair(),
      other = await customer();
    const audit = await db.auditLog.create({
      data: {
        userId: actor,
        action: 'FIXTURE',
        entity: 'customer',
        entityId: correlated ? source.id : other.id,
        newValue: { private: true },
      },
    });
    await entry(source.id, { refType: 'audit_log', refId: audit.id });
    await absorb(source.id, target.id).expect(correlated ? 201 : 403);
    expect(await db.auditLog.findUniqueOrThrow({ where: { id: audit.id } })).toEqual(audit);
  },
);
it.each(['customer', 'contact'] as const)(
  'rolls back all %s links on late required audit failure',
  async (kind) => {
    const audit = app.get(AuditService),
      original = audit.log.bind(audit);
    const expectedAction = kind === 'customer' ? 'CUSTOMER_PLACEHOLDER_MERGED' : 'CONTACTS_MERGED';
    const spy = jest.spyOn(audit, 'log').mockImplementation(async (record, tx) => {
      await original(record, tx);
      if (record.action === expectedAction) throw new Error('INJECTED_PRIVATE_LATE_AUDIT');
    });
    try {
      if (kind === 'customer') {
        const { source, target } = await pair();
        const historic = await entry(source.id);
        const recompute = jest.spyOn(app.get(JourneyStateService), 'recompute');
        recompute.mockClear();
        await absorb(source.id, target.id).expect(500);
        expect(
          (await db.customer.findUniqueOrThrow({ where: { id: source.id } })).deletedAt,
        ).toBeNull();
        expect(
          (await db.customerJourneyEntry.findUniqueOrThrow({ where: { id: historic.id } }))
            .customerId,
        ).toBe(source.id);
        expect(await db.customerJourneyEntry.count({ where: { customerId: target.id } })).toBe(0);
        expect(
          await db.auditLog.count({ where: { action: expectedAction, entityId: target.id } }),
        ).toBe(0);
        expect(recompute).not.toHaveBeenCalled();
      } else {
        const primary = await contact(),
          duplicate = await contact({ taxId: randomUUID() });
        const child = await customer({ contactId: duplicate.id });
        await merge(primary.id, duplicate.id).expect(500);
        expect(
          (await db.contact.findUniqueOrThrow({ where: { id: duplicate.id } })).deletedAt,
        ).toBeNull();
        expect(
          (await db.contact.findUniqueOrThrow({ where: { id: primary.id } })).taxId,
        ).toBeNull();
        expect((await db.customer.findUniqueOrThrow({ where: { id: child.id } })).contactId).toBe(
          duplicate.id,
        );
        expect(
          await db.auditLog.count({ where: { action: expectedAction, entityId: primary.id } }),
        ).toBe(0);
      }
    } finally {
      spy.mockRestore();
    }
  },
);
it('rolls back absorption and defers cache work on late required journey failure', async () => {
  const { source, target } = await pair(),
    historic = await entry(source.id);
  const writer = app.get(JourneyEntryWriter),
    original = writer.recordInTx.bind(writer);
  const spy = jest.spyOn(writer, 'recordInTx').mockImplementation(async (tx, record) => {
    await original(tx, record);
    throw new Error('INJECTED_PRIVATE_LATE_JOURNEY');
  });
  const recompute = jest.spyOn(app.get(JourneyStateService), 'recompute');
  recompute.mockClear();
  try {
    await absorb(source.id, target.id).expect(500);
  } finally {
    spy.mockRestore();
  }
  expect((await db.customer.findUniqueOrThrow({ where: { id: source.id } })).deletedAt).toBeNull();
  expect(
    (await db.customerJourneyEntry.findUniqueOrThrow({ where: { id: historic.id } })).customerId,
  ).toBe(source.id);
  expect(recompute).not.toHaveBeenCalled();
});
it('runs cache recomputation only after actual commit and once after a retry', async () => {
  const { source, target } = await pair();
  const service = app.get(CustomerMergeService),
    original = service.absorbPlaceholder.bind(service);
  let attempts = 0;
  const spy = jest.spyOn(service, 'absorbPlaceholder').mockImplementation(async (...args) => {
    const result = await original(...args);
    // The canonical service has already queued its success effect. Discard that
    // failed attempt's queue rather than leaking a pre-commit recomputation.
    if (++attempts === 1)
      throw new Prisma.PrismaClientKnownRequestError('synthetic serialization retry', {
        code: 'P2034',
        clientVersion: 'test',
      });
    return result;
  });
  const recompute = jest
    .spyOn(app.get(JourneyStateService), 'recompute')
    .mockImplementation(async () => {
      expect((await db.customer.findUniqueOrThrow({ where: { id: source.id } })).mergedIntoId).toBe(
        target.id,
      );
      return undefined as never;
    });
  recompute.mockClear();
  try {
    await absorb(source.id, target.id).expect(201);
    expect(recompute).toHaveBeenCalledTimes(1);
  } finally {
    spy.mockRestore();
    recompute.mockReset().mockResolvedValue(undefined as never);
  }
  expect(attempts).toBe(2);
  expect(
    await db.customerJourneyEntry.count({
      where: { customerId: target.id, kind: 'PLACEHOLDER_MERGED' },
    }),
  ).toBe(1);
});
it.each(['customer', 'contact'] as const)(
  'serializes opposite %s merges and repeated requests without duplicate evidence',
  async (kind) => {
    if (kind === 'customer') {
      const a = await customer({ acquisitionSource: 'CHAT_FACEBOOK' }),
        b = await customer({ acquisitionSource: 'CHAT_FACEBOOK' });
      const results = await Promise.all([absorb(a.id, b.id), absorb(b.id, a.id)]);
      expect(results.filter((r) => r.status === 201)).toHaveLength(1);
      expect(results.every((r) => [201, 403, 409].includes(r.status))).toBe(true);
      const winner = results.find((r) => r.status === 201)!.body;
      await absorb(winner.placeholderId, winner.targetId).expect(403);
      expect(
        await db.customerJourneyEntry.count({
          where: { customerId: { in: [a.id, b.id] }, kind: 'PLACEHOLDER_MERGED' },
        }),
      ).toBe(1);
    } else {
      const a = await contact(),
        b = await contact();
      const results = await Promise.all([merge(a.id, b.id), merge(b.id, a.id)]);
      expect(results.filter((r) => r.status === 201)).toHaveLength(1);
      expect(results.every((r) => [201, 403, 409].includes(r.status))).toBe(true);
      expect(
        await db.auditLog.count({
          where: { entityId: { in: [a.id, b.id] }, action: 'CONTACTS_MERGED' },
        }),
      ).toBe(1);
    }
  },
);

async function waitedChange<T>(
  change: (tx: Prisma.TransactionClient, locked: () => void, gate: Promise<void>) => Promise<void>,
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
it.each(['customer', 'contact'] as const)(
  'rechecks current %s assignment after actual row-lock waits',
  async (kind) => {
    const permission: PermissionKey[] =
      kind === 'customer' ? customerPermissions : ['contacts.read', 'contacts.update'];
    const staff = await reader(permission, 'SHOP', undefined, true);
    if (kind === 'customer') {
      const { source, target } = await pair();
      await db.customer.updateMany({
        where: { id: { in: [source.id, target.id] } },
        data: { assignedToId: staff },
      });
      const response = await waitedChange(
        async (tx, locked, gate) => {
          await tx.$queryRaw`SELECT id FROM customers WHERE id=${source.id} FOR UPDATE`;
          locked();
          await gate;
          await tx.customer.update({ where: { id: source.id }, data: { assignedToId: denied } });
        },
        () => absorb(source.id, target.id, staff).then((r) => r),
      );
      expect(response.status).toBe(403);
      expect(
        (await db.customer.findUniqueOrThrow({ where: { id: source.id } })).deletedAt,
      ).toBeNull();
    } else {
      const primary = await contact({ assignedToId: staff }),
        duplicate = await contact({ assignedToId: staff });
      const response = await waitedChange(
        async (tx, locked, gate) => {
          await tx.$queryRaw`SELECT id FROM contacts WHERE id=${duplicate.id} FOR UPDATE`;
          locked();
          await gate;
          await tx.contact.update({ where: { id: duplicate.id }, data: { assignedToId: denied } });
        },
        () => merge(primary.id, duplicate.id, staff).then((r) => r),
      );
      expect(response.status).toBe(403);
      expect(
        (await db.contact.findUniqueOrThrow({ where: { id: duplicate.id } })).deletedAt,
      ).toBeNull();
    }
  },
);
it.each(['customer', 'contact'] as const)(
  'reloads revoked %s authority after access-fence wait',
  async (kind) => {
    const staff = await user(),
      permission: PermissionKey[] =
        kind === 'customer' ? customerPermissions : ['contacts.read', 'contacts.update'];
    const assignment = await grant(staff, permission),
      { source, target } = await pair(),
      primary = await contact(),
      duplicate = await contact();
    const response = await waitedChange(
      async (tx, locked, gate) => {
        await lockEmployeeAccess(tx);
        locked();
        await gate;
        await tx.employeeAccessAssignment.update({
          where: { id: assignment.id },
          data: { deletedAt: new Date() },
        });
      },
      () =>
        (kind === 'customer'
          ? absorb(source.id, target.id, staff)
          : merge(primary.id, duplicate.id, staff)
        ).then((r) => r),
    );
    expect(response.status).toBe(403);
  },
);
it('rechecks retired source branches after a real wait rather than retaining stale provenance', async () => {
  const shop = await db.companyInfo.findUniqueOrThrow({ where: { companyCode: 'SHOP' } });
  const branch = await db.branch.create({ data: { name: 'Retiring', companyId: shop.id } });
  const source = await customer({ acquisitionSource: 'CHAT_FACEBOOK', accessBranchId: branch.id }),
    target = await customer({ phone: '0891234567' });
  const response = await waitedChange(
    async (tx, locked, gate) => {
      await tx.$queryRaw`SELECT id FROM branches WHERE id=${branch.id} FOR UPDATE`;
      locked();
      await gate;
      await tx.branch.update({ where: { id: branch.id }, data: { isActive: false } });
    },
    () => absorb(source.id, target.id).then((r) => r),
  );
  expect(response.status).toBe(403);
});
it('keeps canonical managed queries/writes and required evidence on the owned transaction client', async () => {
  const { source, target } = await pair(),
    primary = await contact(),
    duplicate = await contact();
  const spies = [
    jest.spyOn(db.customer, 'findMany'),
    jest.spyOn(db.customer, 'update'),
    jest.spyOn(db.customer, 'updateMany'),
    jest.spyOn(db.contact, 'findMany'),
    jest.spyOn(db.contact, 'update'),
    jest.spyOn(db.customerJourneyEntry, 'createMany'),
  ];
  try {
    await absorb(source.id, target.id).expect(201);
    await merge(primary.id, duplicate.id).expect(201);
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  } finally {
    spies.forEach((spy) => spy.mockRestore());
  }
});
it.each(['customer', 'contact'] as const)(
  'outer %s request audits exclude raw values and exceptions across success, denied, and late failure',
  async (kind) => {
    for (const outcome of ['success', 'denied', 'failure'] as const) {
      const { source, target } = await pair(),
        primary = await contact(),
        duplicate = await contact({
          phone: 'PRIVATE_CONTACT_SENTINEL',
          nationalIdHash: 'PRIVATE_HASH_SENTINEL' + randomUUID(),
        });
      const audit = app.get(AuditService),
        original = audit.log.bind(audit),
        staff = await user();
      if (outcome !== 'denied')
        await grant(staff, [...customerPermissions, 'contacts.read', 'contacts.update']);
      let spy: jest.SpyInstance | undefined;
      if (outcome === 'failure')
        spy = jest.spyOn(audit, 'log').mockImplementation(async (record, tx) => {
          await original(record, tx);
          if (
            record.action ===
            (kind === 'customer' ? 'CUSTOMER_PLACEHOLDER_MERGED' : 'CONTACTS_MERGED')
          )
            throw new Error('PRIVATE_ERROR_SENTINEL');
        });
      try {
        const status = outcome === 'success' ? 201 : outcome === 'denied' ? 403 : 500;
        const path =
          kind === 'customer'
            ? `/customers/${source.id}/absorb-into/${target.id}?company=SHOP`
            : '/contacts/merge?company=SHOP';
        await http(
          'post',
          path,
          {
            primaryId: primary.id,
            duplicateId: duplicate.id,
            unknownSecret: 'PRIVATE_BODY_SENTINEL',
          },
          staff,
        ).expect(status);
        let observed: Awaited<ReturnType<typeof db.auditLog.findMany>> = [];
        for (let i = 0; i < 80; i++) {
          observed = await db.auditLog.findMany({ where: { userId: staff } });
          if (
            observed.some((row) => row.action === (outcome === 'success' ? 'POST' : 'POST_ERROR'))
          )
            break;
          await new Promise((r) => setTimeout(r, 10));
        }
        expect(
          observed.some((row) => row.action === (outcome === 'success' ? 'POST' : 'POST_ERROR')),
        ).toBe(true);
        expect(
          observed.find((row) => row.action === (outcome === 'success' ? 'POST' : 'POST_ERROR'))!
            .newValue,
        ).toMatchObject({
          statusCode: status,
          outcome: outcome === 'success' ? 'SUCCESS' : 'ERROR',
        });
        const payloads = JSON.stringify(observed.map((row) => [row.oldValue, row.newValue]));
        for (const secret of [
          'PRIVATE_BODY_SENTINEL',
          'PRIVATE_CONTACT_SENTINEL',
          'PRIVATE_HASH_SENTINEL',
          'PRIVATE_ERROR_SENTINEL',
          'roomCount',
          'movedRooms',
          'movedCreditChecks',
        ])
          expect(payloads).not.toContain(secret);
      } finally {
        spy?.mockRestore();
      }
    }
  },
);

it('preserves canonical cache origin and invalidates only the source score', async () => {
  const { source, target } = await pair();
  const start = new Date('2020-01-01'),
    later = new Date('2021-01-01');
  for (const [id, at] of [
    [source.id, start],
    [target.id, later],
  ] as const)
    await db.customerJourneyState.create({
      data: {
        customerId: id,
        stage: 'CONTACTED',
        stageEnteredAt: at,
        path: 'UNKNOWN',
        contactedAt: at,
        firstChannel: 'CHAT_FACEBOOK',
        firstSource: 'CHAT_FACEBOOK',
        computedAt: at,
      },
    });
  await db.customerScore.create({ data: { customerId: source.id } });
  const targetScore = await db.customerScore.create({ data: { customerId: target.id } });
  await absorb(source.id, target.id).expect(201);
  expect(await db.customerJourneyState.findUnique({ where: { customerId: source.id } })).toBeNull();
  expect(
    await db.customerJourneyState.findUniqueOrThrow({ where: { customerId: target.id } }),
  ).toMatchObject({ contactedAt: start, firstChannel: 'CHAT_FACEBOOK' });
  expect(await db.customerScore.findUnique({ where: { customerId: source.id } })).toBeNull();
  expect(await db.customerScore.findUniqueOrThrow({ where: { customerId: target.id } })).toEqual(
    targetScore,
  );
});
it('rejects unknown provenance even for persisted owner and preserves an unknown CRM anchor', async () => {
  const owner = await user();
  await db.user.update({ where: { id: owner }, data: { role: 'OWNER' } });
  const { source, target } = await pair();
  await db.crmLead.create({
    data: { customerId: source.id, source: 'CHAT', channel: 'UNKNOWN_CHANNEL' },
  });
  await absorb(source.id, target.id, owner).expect(403);
});
it('maintains a journey-only credit reference without granting credit business mutation', async () => {
  const { source, target } = await pair();
  const alias = await customer({ mergedIntoId: source.id, deletedAt: new Date() });
  const r = await room(alias.id, { deletedAt: new Date() });
  const credit = await db.creditCheck.create({
    data: { customerId: alias.id, deletedAt: new Date() },
  });
  await db.roomCreditAnalysis.create({
    data: { roomId: r.id, creditCheckId: credit.id, fileIds: [], deletedAt: new Date() },
  });
  const historic = await entry(source.id, {
    originCustomerId: alias.id,
    refType: 'credit_check',
    refId: credit.id,
  });
  const staff = await reader(customerPermissions);
  await absorb(source.id, target.id, staff).expect(201);
  expect((await db.creditCheck.findUniqueOrThrow({ where: { id: credit.id } })).customerId).toBe(
    alias.id,
  );
  expect(
    (await db.customerJourneyEntry.findUniqueOrThrow({ where: { id: historic.id } })).customerId,
  ).toBe(target.id);
});
it('does not bypass actual Credit Contract provenance with an unrelated contract reference', async () => {
  const { source, target } = await pair(),
    other = await customer();
  const c = await contract(other.id);
  await db.creditCheck.create({ data: { customerId: source.id, contractId: c.id } });
  const staff = await reader([
    ...customerPermissions,
    'contracts.read',
    'credit-checks.read',
    'credit-checks.update',
  ]);
  await grant(
    staff,
    [...customerPermissions, 'contracts.read', 'credit-checks.read', 'credit-checks.update'],
    'FINANCE',
  );
  await absorb(source.id, target.id, staff).expect(403);
});
it('checks unchanged archival supplier procurement sources independently during Contact reparent', async () => {
  const primary = await contact(),
    duplicate = await contact();
  const supplier = await db.supplier.create({
    data: {
      name: 'Supplier',
      phone: '',
      contactId: duplicate.id,
      deletedAt: new Date(),
      accessCompanyCode: 'SHOP',
      accessBranchId: branchA,
    },
  });
  const finance = await db.companyInfo.findUniqueOrThrow({ where: { companyCode: 'FINANCE' } });
  const product = await db.product.create({
    data: {
      name: 'Device',
      brand: 'Apple',
      model: 'Fixture',
      category: 'PHONE_NEW',
      costPrice: 100,
      branchId: branchB,
      ownedByCompanyId: finance.id,
      supplierId: supplier.id,
      deletedAt: new Date(),
    },
  });
  const staff = await reader([
    'contacts.read',
    'contacts.update',
    'suppliers.read',
    'suppliers.update',
  ]);
  await grant(staff, ['contacts.read', 'contacts.update'], 'FINANCE');
  await merge(primary.id, duplicate.id, staff).expect(403);
  await grant(staff, ['suppliers.read', 'suppliers.update'], 'FINANCE');
  await merge(primary.id, duplicate.id, staff).expect(201);
  expect(await db.product.findUniqueOrThrow({ where: { id: product.id } })).toEqual(product);
});

it('does not borrow canonical assignment for an originless alias', async () => {
  const staff = await reader(customerPermissions, 'SHOP', undefined, true);
  const source = await customer({ acquisitionSource: 'CHAT_FACEBOOK', assignedToId: staff }),
    target = await customer({ phone: '0891234567', assignedToId: staff });
  const alias = await customer({
    mergedIntoId: source.id,
    deletedAt: new Date(),
    accessCompanyCode: null,
    accessBranchId: null,
    assignedToId: denied,
  });
  await absorb(source.id, target.id, staff).expect(403);
  await db.customer.update({ where: { id: alias.id }, data: { assignedToId: staff } });
  await absorb(source.id, target.id, staff).expect(201);
});

it.each([
  ['MANUAL', false],
  ['AUTO', false],
  ['MANUAL', true],
  ['AUTO', true],
] as const)(
  'requires destination tag authority for %s cross-company maintenance, duplicate=%s',
  async (sourceKind, duplicate) => {
    const source = await customer({ acquisitionSource: 'CHAT_FACEBOOK' });
    const target = await customer({
      phone: '0891234567',
      accessCompanyCode: 'FINANCE',
      accessBranchId: null,
    });
    const tag = await db.customerTag.create({
      data: { customerId: source.id, tag: 'NEW', source: sourceKind },
    });
    if (duplicate)
      await db.customerTag.create({
        data: { customerId: target.id, tag: 'NEW', source: sourceKind },
      });
    const staff = await reader([
      ...customerPermissions,
      'customer-tags.read',
      'customer-tags.update',
      'customer-tags.delete',
    ]);
    await grant(staff, customerPermissions, 'FINANCE');
    await absorb(source.id, target.id, staff).expect(403);
    await grant(staff, ['customer-tags.read'], 'FINANCE');
    if (!duplicate) {
      await absorb(source.id, target.id, staff).expect(403);
      await grant(staff, ['customer-tags.update'], 'FINANCE');
    }
    await absorb(source.id, target.id, staff).expect(201);
    const changed = await db.customerTag.findUniqueOrThrow({ where: { id: tag.id } });
    if (duplicate) {
      expect(changed.customerId).toBe(source.id);
      expect(changed.deletedAt).not.toBeNull();
    } else expect(changed).toMatchObject({ customerId: target.id, deletedAt: null });
  },
);

// Fix1: maintenance-only sources must wait on the evidence row itself. Locking
// its old branch, or Serializable without that row lock, is not a current read.
type MergeEvidenceKind = 'sale' | 'repair' | 'booking';
const mergeEvidenceTables = {
  sale: 'sales',
  repair: 'repair_tickets',
  booking: 'bookings',
} as const;
async function mergeEvidence(kind: MergeEvidenceKind, customerId: string) {
  const common = { customerId, branchId: branchA, deletedAt: new Date() };
  if (kind === 'sale') {
    const product = await db.product.create({
      data: {
        name: 'Lock evidence',
        brand: 'Apple',
        model: 'Fixture',
        category: 'PHONE_NEW',
        costPrice: 100,
        branchId: branchA,
      },
    });
    return db.sale.create({
      data: {
        ...common,
        saleNumber: randomUUID(),
        saleType: 'CASH',
        productId: product.id,
        salespersonId: actor,
        sellingPrice: 1000,
        netAmount: 1000,
      },
    });
  }
  if (kind === 'repair')
    return db.repairTicket.create({
      data: {
        ...common,
        ticketNumber: randomUUID(),
        defectDescription: 'Fixture',
        createdById: actor,
      },
    });
  return db.booking.create({
    data: {
      ...common,
      bookingNumber: randomUUID(),
      depositAmount: 100,
      totalAmount: 1000,
      expireDate: new Date('2030-01-01'),
      createdById: actor,
    },
  });
}
async function withLockedMergeEvidence(
  kind: MergeEvidenceKind,
  id: string,
  change: { branchId?: string; customerId?: string },
  action: () => Promise<request.Response>,
) {
  let release!: () => void, ready!: () => void;
  const gate = new Promise<void>((r) => (release = r)),
    locked = new Promise<void>((r) => (ready = r));
  let blockerPid = 0,
    completed = false,
    waitingQuery: string | undefined;
  const blocker = db.$transaction(
    async (tx) => {
      blockerPid = (await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`)[0]
        .pid;
      await tx.$queryRaw(
        Prisma.sql`SELECT id FROM ${Prisma.raw(mergeEvidenceTables[kind])} WHERE id=${id} FOR UPDATE`,
      );
      // Commit the source/link change only AFTER observing this exact blocker (or
      // the unpatched request incorrectly completing against the prior MVCC row).
      if (kind === 'sale')
        await tx.sale.update({
          where: { id },
          data: { notes: 'Concurrent source writer', ...change },
        });
      else if (kind === 'repair')
        await tx.repairTicket.update({
          where: { id },
          data: { notes: 'Concurrent source writer', ...change },
        });
      else
        await tx.booking.update({
          where: { id },
          data: { notes: 'Concurrent source writer', ...change },
        });
      ready();
      await gate;
    },
    { timeout: 15000 },
  );
  await locked;
  const pending = action().then((response) => {
    completed = true;
    return response;
  });
  try {
    for (let attempt = 0; attempt < 100 && !completed; attempt++) {
      const rows = await db.$queryRaw<
        Array<{ query: string }>
      >`SELECT query FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND ${blockerPid} = ANY(pg_blocking_pids(pid))`;
      if (rows.length) {
        waitingQuery = rows[0].query;
        break;
      }
      await new Promise((r) => setTimeout(r, 20));
    }
  } finally {
    release();
    await blocker;
  }
  return { response: await pending, waitingQuery };
}
it.each(['sale', 'repair', 'booking'] as const)(
  'Fix1 rechecks archived Contact child %s provenance after its evidence-row wait',
  async (kind) => {
    const primary = await contact(),
      duplicate = await contact();
    const child = await customer({ contactId: duplicate.id, deletedAt: new Date() });
    const evidence = await mergeEvidence(kind, child.id);
    const staff = await reader(['contacts.read', 'contacts.update']);
    await grant(staff, customerPermissions, 'SHOP', [branchA]);
    const { response, waitingQuery } = await withLockedMergeEvidence(
      kind,
      evidence.id,
      { branchId: branchB },
      () => merge(primary.id, duplicate.id, staff).then((r) => r),
    );
    expect(response.status).toBe(403);
    expect(waitingQuery).toContain(mergeEvidenceTables[kind]);
    expect(waitingQuery).toMatch(/FOR (SHARE|UPDATE)/i);
    expect(await db.contact.findUniqueOrThrow({ where: { id: primary.id } })).toEqual(primary);
    expect(await db.contact.findUniqueOrThrow({ where: { id: duplicate.id } })).toEqual(duplicate);
    expect(
      await db.$queryRaw(
        Prisma.sql`SELECT branch_id FROM ${Prisma.raw(mergeEvidenceTables[kind])} WHERE id=${evidence.id}`,
      ),
    ).toEqual([{ branch_id: branchB }]);
    expect(await db.customer.findUniqueOrThrow({ where: { id: child.id } })).toEqual(child);
    expect(
      await db.auditLog.count({ where: { entityId: primary.id, action: 'CONTACTS_MERGED' } }),
    ).toBe(0);
  },
);
it.each(['sale', 'booking'] as const)(
  'Fix1 rechecks typed Journey %s correlation across an archived alias after its evidence-row wait',
  async (kind) => {
    const { source, target } = await pair();
    const alias = await customer({ mergedIntoId: source.id, deletedAt: new Date() }),
      unrelated = await customer();
    const evidence = await mergeEvidence(kind, alias.id);
    const historic = await entry(source.id, {
      originCustomerId: alias.id,
      refType: kind,
      refId: evidence.id,
    });
    const { response, waitingQuery } = await withLockedMergeEvidence(
      kind,
      evidence.id,
      { customerId: unrelated.id },
      () => absorb(source.id, target.id).then((r) => r),
    );
    expect(response.status).toBe(403);
    expect(waitingQuery).toContain(mergeEvidenceTables[kind]);
    expect(waitingQuery).toMatch(/FOR (SHARE|UPDATE)/i);
    expect(await db.customer.findUniqueOrThrow({ where: { id: source.id } })).toEqual(source);
    expect(await db.customer.findUniqueOrThrow({ where: { id: target.id } })).toEqual(target);
    expect(
      await db.$queryRaw(
        Prisma.sql`SELECT customer_id FROM ${Prisma.raw(mergeEvidenceTables[kind])} WHERE id=${evidence.id}`,
      ),
    ).toEqual([{ customer_id: unrelated.id }]);
    expect(await db.customer.findUniqueOrThrow({ where: { id: alias.id } })).toEqual(alias);
    expect(await db.customerJourneyEntry.findUniqueOrThrow({ where: { id: historic.id } })).toEqual(
      historic,
    );
    expect(
      await db.auditLog.count({
        where: { entityId: target.id, action: 'CUSTOMER_PLACEHOLDER_MERGED' },
      }),
    ).toBe(0);
    expect(await db.customerJourneyEntry.count({ where: { customerId: target.id } })).toBe(0);
  },
);
it.each(['contact', 'journey'] as const)(
  'Fix1 allows still-authorized %s maintenance after a real Booking evidence-row wait',
  async (kind) => {
    const primary = await contact(),
      duplicate = await contact(),
      { source, target } = await pair();
    const child =
      kind === 'contact'
        ? await customer({ contactId: duplicate.id, deletedAt: new Date() })
        : await customer({ mergedIntoId: source.id, deletedAt: new Date() });
    const evidence = await mergeEvidence('booking', child.id);
    if (kind === 'journey')
      await entry(source.id, {
        originCustomerId: child.id,
        refType: 'booking',
        refId: evidence.id,
      });
    const { response, waitingQuery } = await withLockedMergeEvidence(
      'booking',
      evidence.id,
      {},
      () =>
        (kind === 'contact' ? merge(primary.id, duplicate.id) : absorb(source.id, target.id)).then(
          (r) => r,
        ),
    );
    expect(response.status).toBe(201);
    expect(waitingQuery).toContain('bookings');
    expect(waitingQuery).toMatch(/FOR (SHARE|UPDATE)/i);
    expect(await db.booking.findUniqueOrThrow({ where: { id: evidence.id } })).toMatchObject({
      branchId: branchA,
      customerId: child.id,
      deletedAt: evidence.deletedAt,
      notes: 'Concurrent source writer',
    });
  },
);
