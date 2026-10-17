import {
  CUSTOMER_ATTACHMENT_SENSITIVE_KEYS,
  CustomerAttachmentSourceKind,
} from '@installment/shared';
import { PDFDocument } from 'pdf-lib';
import { CustomerDocumentsService } from '../customers/services/customer-documents.service';
import { ConfigService } from '@nestjs/config';
import { StorageService } from '../storage/storage.service';
import { promises as fs } from 'node:fs';
import { lockEmployeeAccess } from './access-snapshot.service';
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
    .expect('x-owned-documents-app', testRun)
    .on('response', (response) => {
      if (response.headers['x-owned-documents-app'] !== testRun)
        console.error(
          'OWNED_HTTP_MARKER_MISMATCH',
          JSON.stringify({
            status: response.status,
            marker: response.headers['x-owned-documents-app'] ?? null,
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
    'documents.read',
    'sales.read',
    'contracts.read',
    'trade-in.read',
    'repair-tickets.read',
    'bookings.read',
    'chat.read',
    'documents.create',
    'documents.update',
    'sensitive.customer-identity.read',
    'sensitive.cost.read',
    'sensitive.profit.read',
    'sensitive.salary.read',
    'sensitive.seller-bank.read',
    'contacts.read',
    'contacts.update',
    'suppliers.read',
    'suppliers.create',
  ]);
  const module = await Test.createTestingModule({
    controllers: [CustomersController, ContactsController],
    providers: [
      AccessPartyBoundaries,
      StorageService,
      CustomerDocumentsService,
      {
        provide: ConfigService,
        useValue: new ConfigService({
          STORAGE_LOCAL_DIR: process.env.STORAGE_LOCAL_DIR,
          NODE_ENV: 'test',
        }),
      },
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
      res.setHeader('x-owned-documents-app', testRun);
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

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEUlEQVQImWMQVDIWVDJmgFAACq4BmbwhqwsAAAAASUVORK5CYII=',
  'base64',
);
function upload(id: string, userId = actor) {
  return http('post', `/customers/${id}/documents?company=SHOP`, undefined, userId)
    .field('sourceKind', 'CUSTOMER_ORIGIN')
    .field('sourceId', id)
    .attach('file', png, { filename: 'proof.png', contentType: 'image/png' });
}
it('uploads actual permitted bytes without customers.create, then lists, reads and soft removes without customers.delete', async () => {
  const c = await customer();
  const response = await upload(c.id).expect(201);
  expect(response.body).toEqual({ id: c.id, attachmentId: expect.any(String) });
  const attachmentId = response.body.attachmentId;
  const listed = await http('get', `/customers/${c.id}/documents?company=SHOP`).expect(200);
  expect(listed.body.items).toEqual([
    expect.objectContaining({
      id: attachmentId,
      kind: 'verified',
      mimeType: 'image/png',
      fileSize: png.length,
    }),
  ]);
  const read = await http(
    'get',
    `/customers/${c.id}/documents/${attachmentId}/content?company=SHOP`,
  ).expect(200);
  expect(read.body).toEqual(png);
  expect(read.headers['cache-control']).toBe('private, no-store');
  await http('delete', `/customers/${c.id}/documents?company=SHOP`, { attachmentId }).expect(200);
  await http('get', `/customers/${c.id}/documents/${attachmentId}/content?company=SHOP`).expect(
    403,
  );
});
it('rejects no-grant actual upload before staging private bytes', async () => {
  const c = await customer();
  const before = await fs.readdir(process.env.STORAGE_LOCAL_DIR!, { recursive: true });
  await upload(c.id, denied).expect(403);
  expect(await fs.readdir(process.env.STORAGE_LOCAL_DIR!, { recursive: true })).toEqual(before);
});
it('rejects caller HTTPS URLs and storage keys as new attachment ownership', async () => {
  const c = await customer();
  await http('post', `/customers/${c.id}/documents?company=SHOP`, {
    fileName: 'private.pdf',
    fileUrl: 'https://example.invalid/private.pdf',
    storageKey: 'someone-else/file.pdf',
    mimeType: 'application/pdf',
    fileSize: 123,
  }).expect(400);
  expect((await db.customer.findUniqueOrThrow({ where: { id: c.id } })).documents).toEqual([]);
});

it('blind upload allows selector and submission but forbids metadata, content and removal', async () => {
  const c = await customer();
  const id = await reader(['customers.read', 'documents.create'], 'SHOP', [branchA]);
  const selector = await http(
    'get',
    `/customers/${c.id}/documents?company=SHOP`,
    undefined,
    id,
  ).expect(200);
  expect(selector.body).toMatchObject({
    availability: 'unavailable',
    items: null,
    uploadSources: [{ kind: 'CUSTOMER_ORIGIN', id: c.id, company: 'SHOP', branchId: branchA }],
  });
  const uploaded = await upload(c.id, id).expect(201);
  expect(Object.keys(uploaded.body).sort()).toEqual(['attachmentId', 'id']);
  await http(
    'get',
    `/customers/${c.id}/documents/${uploaded.body.attachmentId}/content?company=SHOP`,
    undefined,
    id,
  ).expect(403);
  await http(
    'delete',
    `/customers/${c.id}/documents?company=SHOP`,
    { attachmentId: uploaded.body.attachmentId },
    id,
  ).expect(403);
});
it('denies wrong-parent reads and forged attachment IDs without reading private objects', async () => {
  const c = await customer(),
    other = await customer();
  const uploaded = await upload(c.id).expect(201);
  const storage = app.get(StorageService);
  const reads = jest.spyOn(storage, 'getStream');
  try {
    await http(
      'get',
      `/customers/${other.id}/documents/${uploaded.body.attachmentId}/content?company=SHOP`,
    ).expect(403);
    await http('get', `/customers/${c.id}/documents/${randomUUID()}/content?company=SHOP`).expect(
      403,
    );
    expect(reads).not.toHaveBeenCalled();
  } finally {
    reads.mockRestore();
  }
});
it('requires configured storage instead of acknowledging nonexistent bytes', async () => {
  const c = await customer();
  const service = app.get(CustomerDocumentsService),
    configured = app.get(StorageService);
  Reflect.set(
    service,
    'storage',
    new StorageService(
      new ConfigService({
        NODE_ENV: 'test',
        STORAGE_LOCAL_DIR: '',
        GCS_BUCKET: '',
        S3_ENDPOINT: '',
        S3_ACCESS_KEY: '',
        S3_SECRET_KEY: '',
      }),
    ),
  );
  try {
    await upload(c.id).expect(503);
  } finally {
    Reflect.set(service, 'storage', configured);
  }
});
it('rejects HEIC and mislabeled arbitrary bytes without storage writes', async () => {
  const c = await customer();
  const writes = jest.spyOn(app.get(StorageService), 'uploadOwned');
  try {
    for (const [filename, contentType, data] of [
      ['portrait.heic', 'image/heic', Buffer.from('ftypheic')],
      ['portrait.png', 'image/png', Buffer.from('not an image')],
    ] as const) {
      await http('post', `/customers/${c.id}/documents?company=SHOP`)
        .field('sourceKind', 'CUSTOMER_ORIGIN')
        .field('sourceId', c.id)
        .attach('file', data, { filename, contentType })
        .expect(400);
    }
    expect(writes).not.toHaveBeenCalled();
  } finally {
    writes.mockRestore();
  }
});

const visible: PermissionKey[] = [
  'customers.read',
  'documents.read',
  ...CUSTOMER_ATTACHMENT_SENSITIVE_KEYS,
];
async function source(c: string, kind: CustomerAttachmentSourceKind, extra: object = {}) {
  if (kind === 'CUSTOMER_ORIGIN') return { id: c };
  if (kind === 'CHAT_ROOM')
    return db.chatRoom.create({ data: { customerId: c, channel: 'LINE_SHOP', ...extra } });
  if (kind === 'TRADE_IN')
    return db.tradeIn.create({
      data: {
        customerId: c,
        branchId: branchA,
        deviceBrand: 'Apple',
        deviceModel: 'Fixture',
        ...extra,
      },
    });
  if (kind === 'REPAIR_TICKET')
    return db.repairTicket.create({
      data: {
        customerId: c,
        branchId: branchA,
        ticketNumber: randomUUID(),
        defectDescription: 'Fixture',
        createdById: actor,
        ...extra,
      },
    });
  if (kind === 'BOOKING')
    return db.booking.create({
      data: {
        customerId: c,
        branchId: branchA,
        bookingNumber: randomUUID(),
        depositAmount: 100,
        totalAmount: 1000,
        expireDate: new Date('2030-01-01'),
        createdById: actor,
        ...extra,
      },
    });
  const p = await db.product.create({
    data: {
      name: 'Fixture',
      brand: 'Apple',
      model: 'Fixture',
      category: 'PHONE_NEW',
      costPrice: 100,
      branchId: branchA,
    },
  });
  if (kind === 'SALE')
    return db.sale.create({
      data: {
        customerId: c,
        branchId: branchA,
        saleNumber: randomUUID(),
        saleType: 'CASH',
        productId: p.id,
        salespersonId: actor,
        sellingPrice: 1000,
        netAmount: 1000,
        ...extra,
      },
    });
  return db.contract.create({
    data: {
      customerId: c,
      branchId: branchA,
      contractNumber: randomUUID(),
      productId: p.id,
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
function sourceUpload(
  c: string,
  kind: CustomerAttachmentSourceKind,
  sourceId: string,
  userId = actor,
  company = 'SHOP',
  bytes = png,
  mimeType = 'image/png',
) {
  return http('post', `/customers/${c}/documents?company=${company}`, undefined, userId)
    .field('sourceKind', kind)
    .field('sourceId', sourceId)
    .attach('file', bytes, { filename: 'proof', contentType: mimeType });
}
it.each([
  'CUSTOMER_ORIGIN',
  'SALE',
  'CONTRACT',
  'TRADE_IN',
  'REPAIR_TICKET',
  'BOOKING',
  'CHAT_ROOM',
] as const)('uses genuine %s source and persists immutable owned metadata', async (kind) => {
  const c = await customer(),
    row = await source(c.id, kind);
  const response = await sourceUpload(c.id, kind, row.id).expect(201);
  const stored = await db.customerAttachment.findUniqueOrThrow({
    where: { id: response.body.attachmentId },
  });
  expect(stored).toMatchObject({
    originCustomerId: c.id,
    sourceKind: kind,
    sourceId: row.id,
    accessCompanyCode: 'SHOP',
    fileSize: png.length,
    createdById: actor,
  });
  await expect(
    db.customerAttachment.update({ where: { id: stored.id }, data: { sourceId: randomUUID() } }),
  ).rejects.toThrow();
  const opened = await http(
    'get',
    `/customers/${c.id}/documents/${stored.id}/content?company=SHOP`,
  ).expect(200);
  expect(opened.body).toEqual(png);
});
it.each(CUSTOMER_ATTACHMENT_SENSITIVE_KEYS)(
  'requires %s for identifiable metadata/content but not upload',
  async (missing) => {
    const c = await customer();
    const id = await reader(
      [...visible.filter((k) => k !== missing), 'documents.create', 'documents.update'],
      'SHOP',
      [branchA],
    );
    const up = await upload(c.id, id).expect(201);
    const listed = await http(
      'get',
      `/customers/${c.id}/documents?company=SHOP`,
      undefined,
      id,
    ).expect(200);
    expect(listed.body).toMatchObject({ availability: 'unavailable', items: null });
    await http(
      'get',
      `/customers/${c.id}/documents/${up.body.attachmentId}/content?company=SHOP`,
      undefined,
      id,
    ).expect(403);
    await http(
      'delete',
      `/customers/${c.id}/documents?company=SHOP`,
      { attachmentId: up.body.attachmentId },
      id,
    ).expect(403);
    await grant(id, [missing], 'SHOP', [branchB]);
    await http(
      'get',
      `/customers/${c.id}/documents/${up.body.attachmentId}/content?company=SHOP`,
      undefined,
      id,
    ).expect(403);
    await grant(id, [missing], 'SHOP', [branchA]);
    await http(
      'get',
      `/customers/${c.id}/documents/${up.body.attachmentId}/content?company=SHOP`,
      undefined,
      id,
    ).expect(200);
  },
);
it('requires independent typed child read and rejects unrelated source correlation', async () => {
  const c = await customer(),
    other = await customer(),
    booking = await source(c.id, 'BOOKING');
  const id = await reader(['customers.read', 'documents.create']);
  await sourceUpload(c.id, 'BOOKING', booking.id, id).expect(403);
  await grant(id, ['bookings.read']);
  await sourceUpload(other.id, 'BOOKING', booking.id, id).expect(403);
  await sourceUpload(c.id, 'BOOKING', booking.id, id).expect(201);
});
it('requires original and current branch after source moves and never restamps original provenance', async () => {
  const c = await customer(),
    b = await source(c.id, 'BOOKING');
  const up = await sourceUpload(c.id, 'BOOKING', b.id).expect(201);
  await db.booking.update({ where: { id: b.id }, data: { branchId: branchB } });
  const id = await reader([...visible, 'bookings.read'], 'SHOP', [branchB]);
  await http(
    'get',
    `/customers/${c.id}/documents/${up.body.attachmentId}/content?company=SHOP`,
    undefined,
    id,
  ).expect(403);
  await grant(id, [...visible, 'bookings.read'], 'SHOP', [branchA]);
  await http(
    'get',
    `/customers/${c.id}/documents/${up.body.attachmentId}/content?company=SHOP`,
    undefined,
    id,
  ).expect(200);
  expect(
    (await db.customerAttachment.findUniqueOrThrow({ where: { id: up.body.attachmentId } }))
      .accessBranchId,
  ).toBe(branchA);
});
it('preserves alias provenance and legacy metadata without copying target permissions or reparenting', async () => {
  const c = await customer({ documents: ['https://private.invalid/old.pdf'] }),
    target = await customer({ accessBranchId: branchB });
  const up = await upload(c.id).expect(201);
  await db.customer.update({
    where: { id: c.id },
    data: { deletedAt: new Date(), mergedIntoId: target.id },
  });
  const id = await reader(visible, 'SHOP', [branchB]);
  let result = await http(
    'get',
    `/customers/${target.id}/documents?company=SHOP`,
    undefined,
    id,
  ).expect(200);
  expect(JSON.stringify(result.body)).not.toContain('old.pdf');
  expect(JSON.stringify(result.body)).not.toContain(up.body.attachmentId);
  await grant(id, visible, 'SHOP', [branchA]);
  result = await http(
    'get',
    `/customers/${target.id}/documents?company=SHOP`,
    undefined,
    id,
  ).expect(200);
  expect(result.body.items).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        kind: 'legacy',
        reference: 'https://private.invalid/old.pdf',
        availability: 'unsupported',
      }),
      expect.objectContaining({ id: up.body.attachmentId, originCustomerId: c.id }),
    ]),
  );
  expect(
    (await db.customerAttachment.findUniqueOrThrow({ where: { id: up.body.attachmentId } }))
      .originCustomerId,
  ).toBe(c.id);
  await http('get', `/customers/${c.id}/documents?company=SHOP`).expect(403);
});
it('revokes authorization after staging and removes exactly the owned bytes', async () => {
  const c = await customer(),
    b = await source(c.id, 'BOOKING');
  const id = await reader(['customers.read', 'documents.create', 'bookings.read'], 'SHOP', [
    branchA,
  ]);
  const storage = app.get(StorageService),
    original = storage.uploadOwned.bind(storage);
  const paths = await fs.readdir(process.env.STORAGE_LOCAL_DIR!, { recursive: true });
  const spy = jest.spyOn(storage, 'uploadOwned').mockImplementationOnce(async (...args) => {
    await original(...args);
    await db.booking.update({ where: { id: b.id }, data: { branchId: branchB } });
  });
  try {
    await sourceUpload(c.id, 'BOOKING', b.id, id).expect(403);
  } finally {
    spy.mockRestore();
  }
  expect(await db.customerAttachment.count({ where: { originCustomerId: c.id } })).toBe(0);
  const after = await fs.readdir(process.env.STORAGE_LOCAL_DIR!, { recursive: true });
  const newEntries = after.filter((value) => !paths.includes(value));
  for (const entry of newEntries)
    expect((await fs.stat(process.env.STORAGE_LOCAL_DIR! + '/' + entry)).isDirectory()).toBe(true);
});
it('rolls back late required evidence failure and cleans only new owned objects', async () => {
  const c = await customer(),
    keep = 'preexisting/shared';
  const storage = app.get(StorageService);
  await storage.upload(keep, png, 'image/png');
  const audit = app.get(AuditService),
    real = audit.log.bind(audit);
  const spy = jest.spyOn(audit, 'log').mockImplementation(async (...args) => {
    if (args[0].action === 'CUSTOMER_DOCUMENT_CREATED')
      throw new Error('secret filename/key must not escape audit');
    return real(...args);
  });
  try {
    await upload(c.id).expect(500);
  } finally {
    spy.mockRestore();
  }
  expect(await db.customerAttachment.count({ where: { originCustomerId: c.id } })).toBe(0);
  expect(await fs.readFile(process.env.STORAGE_LOCAL_DIR! + '/' + keep)).toEqual(png);
  const auditRows = await db.auditLog.findMany({ where: { entityId: c.id } });
  expect(JSON.stringify(auditRows.map((row) => row.newValue))).not.toContain('secret filename');
});
it('rejects storage collisions and mismatched ownership cleanup without deleting preexisting bytes', async () => {
  const storage = app.get(StorageService),
    key = 'collision/object',
    token = randomUUID();
  await storage.uploadOwned(key, png, 'image/png', token);
  await expect(
    storage.uploadOwned(key, Buffer.from('overwrite'), 'image/png', randomUUID()),
  ).rejects.toThrow();
  await storage.deleteOwned(key, randomUUID());
  expect(await fs.readFile(process.env.STORAGE_LOCAL_DIR! + '/' + key)).toEqual(png);
  await storage.deleteOwned(key, token);
  await expect(fs.readFile(process.env.STORAGE_LOCAL_DIR! + '/' + key)).rejects.toThrow();
});
it('validates actual PDF structure and bounds malformed PDF bytes', async () => {
  const c = await customer(),
    pdf = await PDFDocument.create();
  pdf.addPage([100, 100]);
  const bytes = Buffer.from(await pdf.save({ useObjectStreams: false }));
  await sourceUpload(c.id, 'CUSTOMER_ORIGIN', c.id, actor, 'SHOP', bytes, 'application/pdf').expect(
    201,
  );
  await sourceUpload(
    c.id,
    'CUSTOMER_ORIGIN',
    c.id,
    actor,
    'SHOP',
    Buffer.from('%PDF-1.7\n obj garbage xref\n%%EOF'),
    'application/pdf',
  ).expect(400);
});
it('holds source locks and rechecks a concurrent Booking branch change before releasing any bytes', async () => {
  const c = await customer(),
    b = await source(c.id, 'BOOKING');
  const up = await sourceUpload(c.id, 'BOOKING', b.id).expect(201);
  const id = await reader([...visible, 'bookings.read'], 'SHOP', [branchA]);
  let release!: () => void, locked!: () => void;
  const lockReady = new Promise<void>((resolve) => {
    locked = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let blocker = 0;
  const writer = db.$transaction(
    async (tx) => {
      blocker = Number(
        (await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`)[0].pid,
      );
      await tx.$queryRaw`SELECT id FROM bookings WHERE id=${b.id} FOR UPDATE`;
      await tx.booking.update({ where: { id: b.id }, data: { branchId: branchB } });
      locked();
      await gate;
    },
    { timeout: 15000 },
  );
  await lockReady;
  const response = http(
    'get',
    `/customers/${c.id}/documents/${up.body.attachmentId}/content?company=SHOP`,
    undefined,
    id,
  ).then((r) => r);
  let waited = false;
  try {
    for (let attempt = 0; attempt < 100; attempt++) {
      const rows = await db.$queryRaw<
        Array<{ query: string }>
      >`SELECT query FROM pg_stat_activity WHERE ${blocker} = ANY(pg_blocking_pids(pid))`;
      if (rows.some((r) => /bookings/.test(r.query) && /FOR SHARE|FOR UPDATE/.test(r.query))) {
        waited = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  } finally {
    release();
  }
  await writer;
  const result = await response;
  expect(waited).toBe(true);
  expect(result.status).toBe(403);
  expect(result.headers['content-type']).toContain('application/json');
  expect(
    await db.auditLog.count({
      where: { entityId: c.id, action: 'CUSTOMER_DOCUMENT_READ_AUTHORIZED' },
    }),
  ).toBe(0);
});
it.each([
  'CUSTOMER_DOCUMENT_CREATED',
  'CUSTOMER_DOCUMENT_READ_AUTHORIZED',
  'CUSTOMER_DOCUMENT_REMOVED',
])('does not release success when deferred commit evidence fails for %s', async (action) => {
  const c = await customer();
  const up = action === 'CUSTOMER_DOCUMENT_CREATED' ? null : await upload(c.id).expect(201);
  await db.$executeRawUnsafe(
    `CREATE FUNCTION fail_document_commit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.entity_id = '${c.id}' AND NEW.action = '${action}' THEN RAISE EXCEPTION 'owned deferred failure'; END IF; RETURN NEW; END $$`,
  );
  await db.$executeRawUnsafe(
    'CREATE CONSTRAINT TRIGGER owned_document_commit_failure AFTER INSERT ON audit_logs DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION fail_document_commit()',
  );
  try {
    if (action === 'CUSTOMER_DOCUMENT_CREATED') await upload(c.id).expect(500);
    else if (action === 'CUSTOMER_DOCUMENT_REMOVED')
      await http('delete', `/customers/${c.id}/documents?company=SHOP`, {
        attachmentId: up!.body.attachmentId,
      }).expect(500);
    else {
      const result = await http(
        'get',
        `/customers/${c.id}/documents/${up!.body.attachmentId}/content?company=SHOP`,
      ).expect(500);
      expect(result.headers['content-type']).toContain('application/json');
      expect(result.body).not.toEqual(png);
    }
    expect(await db.auditLog.count({ where: { entityId: c.id, action } })).toBe(0);
    if (up)
      expect(
        (await db.customerAttachment.findUniqueOrThrow({ where: { id: up.body.attachmentId } }))
          .deletedAt,
      ).toBeNull();
    else expect(await db.customerAttachment.count({ where: { originCustomerId: c.id } })).toBe(0);
  } finally {
    await db.$executeRawUnsafe('DROP TRIGGER owned_document_commit_failure ON audit_logs');
    await db.$executeRawUnsafe('DROP FUNCTION fail_document_commit()');
  }
});
it('checks integrity of private bytes before authorized release', async () => {
  const c = await customer(),
    up = await upload(c.id).expect(201);
  const row = await db.customerAttachment.findUniqueOrThrow({
    where: { id: up.body.attachmentId },
  });
  await fs.writeFile(process.env.STORAGE_LOCAL_DIR! + '/' + row.storageKey, Buffer.from('corrupt'));
  await http('get', `/customers/${c.id}/documents/${row.id}/content?company=SHOP`).expect(503);
  expect(
    await db.auditLog.count({
      where: { entityId: c.id, action: 'CUSTOMER_DOCUMENT_READ_AUTHORIZED' },
    }),
  ).toBe(0);
});
it('uses exact current FINANCE case assignment without global identity assignment', async () => {
  const c = await customer({ accessCompanyCode: null, accessBranchId: null });
  const id = await reader(
    [...visible, 'documents.create', 'contracts.read'],
    'FINANCE',
    undefined,
    true,
  );
  const con = await source(c.id, 'CONTRACT', { assignedToId: id });
  const up = await sourceUpload(c.id, 'CONTRACT', con.id, id, 'FINANCE').expect(201);
  await http('get', `/customers/${c.id}/documents?company=FINANCE`, undefined, id).expect(200);
  await http(
    'get',
    `/customers/${c.id}/documents/${up.body.attachmentId}/content?company=FINANCE`,
    undefined,
    id,
  ).expect(200);
  await db.contract.update({ where: { id: con.id }, data: { assignedToId: denied } });
  await http(
    'get',
    `/customers/${c.id}/documents/${up.body.attachmentId}/content?company=FINANCE`,
    undefined,
    id,
  ).expect(403);
});
it.each(['BOOKING', 'REPAIR_TICKET'] as const)(
  '%s creator does not manufacture ASSIGNED child-read authority',
  async (kind) => {
    const c = await customer(),
      id = await reader(['customers.read', 'documents.create']);
    await grant(
      id,
      [kind === 'BOOKING' ? 'bookings.read' : 'repair-tickets.read'],
      'SHOP',
      undefined,
      'ASSIGNED',
    );
    const row = await source(c.id, kind, { createdById: id });
    await sourceUpload(c.id, kind, row.id, id).expect(403);
  },
);
it('retains a single owned staged object through a real Serializable retry', async () => {
  const c = await customer(),
    storage = app.get(StorageService),
    audit = app.get(AuditService),
    real = audit.log.bind(audit);
  let calls = 0;
  const uploaded = jest.spyOn(storage, 'uploadOwned'),
    deleted = jest.spyOn(storage, 'deleteOwned');
  const spy = jest.spyOn(audit, 'log').mockImplementation(async (...args) => {
    if (args[0].action === 'CUSTOMER_DOCUMENT_CREATED' && ++calls === 1) {
      await args[1]!.$executeRawUnsafe(
        "DO $$ BEGIN RAISE EXCEPTION 'retry owned attempt' USING ERRCODE = '40001'; END $$",
      );
    }
    return real(...args);
  });
  try {
    await upload(c.id).expect(201);
    expect(calls).toBe(2);
    expect(uploaded).toHaveBeenCalledTimes(1);
    expect(deleted).not.toHaveBeenCalled();
    expect(await db.customerAttachment.count({ where: { originCustomerId: c.id } })).toBe(1);
  } finally {
    spy.mockRestore();
    uploaded.mockRestore();
    deleted.mockRestore();
  }
});
it('requires original SHOP and current FINANCE scope after an assigned room channel moves', async () => {
  const c = await customer(),
    room = await source(c.id, 'CHAT_ROOM');
  const up = await sourceUpload(c.id, 'CHAT_ROOM', room.id).expect(201);
  const id = await reader([...visible, 'chat.read'], 'FINANCE');
  await db.chatRoom.update({
    where: { id: room.id },
    data: { channel: 'LINE_FINANCE', assignedToId: id },
  });
  await http(
    'get',
    `/customers/${c.id}/documents/${up.body.attachmentId}/content?company=FINANCE`,
    undefined,
    id,
  ).expect(403);
  await grant(id, [...visible, 'chat.read'], 'SHOP');
  await http(
    'get',
    `/customers/${c.id}/documents/${up.body.attachmentId}/content?company=FINANCE`,
    undefined,
    id,
  ).expect(200);
});
it('source reassociation to an unrelated Customer revokes existing file read', async () => {
  const c = await customer(),
    other = await customer(),
    booking = await source(c.id, 'BOOKING');
  const up = await sourceUpload(c.id, 'BOOKING', booking.id).expect(201);
  await db.booking.update({ where: { id: booking.id }, data: { customerId: other.id } });
  await http(
    'get',
    `/customers/${c.id}/documents/${up.body.attachmentId}/content?company=SHOP`,
  ).expect(403);
});
it('rejects selected-work-context substitution and cross-position branch flattening', async () => {
  const c = await customer(),
    id = await reader(['customers.read'], 'SHOP', [branchA]);
  await grant(id, ['documents.create'], 'SHOP', [branchB]);
  await upload(c.id, id).expect(403);
  await sourceUpload(c.id, 'CUSTOMER_ORIGIN', c.id, actor, 'FINANCE').expect(403);
});
it('soft removal retains private bytes and cannot remove arbitrary URL/key or another parent file', async () => {
  const c = await customer(),
    other = await customer(),
    up = await upload(c.id).expect(201);
  const row = await db.customerAttachment.findUniqueOrThrow({
    where: { id: up.body.attachmentId },
  });
  await http('delete', `/customers/${other.id}/documents?company=SHOP`, {
    attachmentId: row.id,
  }).expect(403);
  await http('delete', `/customers/${c.id}/documents?company=SHOP`, {
    fileUrl: 'https://example.invalid/preexisting.pdf',
    key: row.storageKey,
  }).expect(403);
  await http('delete', `/customers/${c.id}/documents?company=SHOP`, {
    attachmentId: row.id,
  }).expect(200);
  expect(await fs.readFile(process.env.STORAGE_LOCAL_DIR! + '/' + row.storageKey)).toEqual(png);
  expect(
    (await db.customerAttachment.findUniqueOrThrow({ where: { id: row.id } })).deletedAt,
  ).toBeTruthy();
});
it('retains unmanaged historical HTTPS metadata without upgrading it into verified objects', async () => {
  const id = await user();
  await db.user.update({ where: { id }, data: { accessManaged: false } });
  const c = await customer();
  await http(
    'post',
    `/customers/${c.id}/documents`,
    {
      fileName: 'old.pdf',
      fileUrl: 'https://example.invalid/old.pdf',
      mimeType: 'application/pdf',
      fileSize: 123,
    },
    id,
  ).expect(201);
  expect((await db.customer.findUniqueOrThrow({ where: { id: c.id } })).documents).toEqual([
    'https://example.invalid/old.pdf',
  ]);
  expect(await db.customerAttachment.count({ where: { originCustomerId: c.id } })).toBe(0);
});
it('safe actual outer request evidence contains no multipart metadata on success and denial', async () => {
  const c = await customer(),
    audit = app.get(AuditService),
    real = audit.log.bind(audit),
    captured: Array<Parameters<AuditService['log']>[0]> = [];
  const spy = jest.spyOn(audit, 'log').mockImplementation(async (...args) => {
    if (args[0].entityId === c.id) captured.push(args[0]);
    return real(...args);
  });
  try {
    await http('post', `/customers/${c.id}/documents?company=SHOP`)
      .field('sourceKind', 'CUSTOMER_ORIGIN')
      .field('sourceId', c.id)
      .field('storageKey', 'secret-storage-key')
      .attach('file', png, { filename: 'secret-financial-name.png', contentType: 'image/png' })
      .expect(201);
    await http(
      'post',
      `/customers/${c.id}/documents?company=SHOP`,
      {
        fileUrl: 'https://secret.invalid/id',
        fileName: 'secret-financial-name.png',
        mimeType: 'image/png',
        fileSize: 100,
      },
      denied,
    ).expect(403);
    expect(captured.some((entry) => entry.action === 'POST')).toBe(true);
    expect(captured.some((entry) => entry.action === 'POST_ERROR')).toBe(true);
    expect(JSON.stringify(captured)).not.toMatch(
      /secret-storage-key|secret-financial-name|secret.invalid|fileUrl/,
    );
  } finally {
    spy.mockRestore();
  }
});
it('does not combine sensitive keys split across genuine A/B sources in list, content or legacy projection', async () => {
  const c = await customer({ documents: ['https://private.invalid/mixed-financial.pdf'] });
  await source(c.id, 'BOOKING', { branchId: branchB });
  const up = await upload(c.id).expect(201);
  const id = await reader(
    ['customers.read', 'documents.read', 'sensitive.customer-identity.read', 'sensitive.cost.read'],
    'SHOP',
    [branchA],
  );
  await grant(
    id,
    [
      'customers.read',
      'documents.read',
      'sensitive.profit.read',
      'sensitive.salary.read',
      'sensitive.seller-bank.read',
    ],
    'SHOP',
    [branchB],
  );
  const list = await http('get', `/customers/${c.id}/documents?company=SHOP`, undefined, id).expect(
    200,
  );
  expect(list.body).toMatchObject({ items: null, availability: 'unavailable' });
  await http(
    'get',
    `/customers/${c.id}/documents/${up.body.attachmentId}/content?company=SHOP`,
    undefined,
    id,
  ).expect(403);
  const query = await http('get', `/customers/${c.id}?company=SHOP`, undefined, id).expect(200);
  expect(query.body.documents).toBeNull();
  expect(query.body.availability.documents).toBe('unavailable');
  await grant(
    id,
    ['sensitive.profit.read', 'sensitive.salary.read', 'sensitive.seller-bank.read'],
    'SHOP',
    [branchA],
  );
  await http(
    'get',
    `/customers/${c.id}/documents/${up.body.attachmentId}/content?company=SHOP`,
    undefined,
    id,
  ).expect(200);
  expect(
    (await http('get', `/customers/${c.id}?company=SHOP`, undefined, id).expect(200)).body
      .documents,
  ).toEqual(c.documents);
});
it('reloads current authority after an actual revocation fence wait before storage read', async () => {
  const c = await customer(),
    up = await upload(c.id).expect(201),
    id = await reader(visible);
  let ready!: () => void,
    release!: () => void,
    blocker = 0;
  const waiting = new Promise<void>((resolve) => {
      ready = resolve;
    }),
    gate = new Promise<void>((resolve) => {
      release = resolve;
    });
  const writer = db.$transaction(
    async (tx) => {
      await lockEmployeeAccess(tx);
      blocker = Number(
        (await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`)[0].pid,
      );
      await tx.employeeAccessAssignment.updateMany({
        where: { userId: id },
        data: { deletedAt: new Date() },
      });
      ready();
      await gate;
    },
    { timeout: 15000 },
  );
  await waiting;
  const reads = jest.spyOn(app.get(StorageService), 'getStream');
  const response = http(
    'get',
    `/customers/${c.id}/documents/${up.body.attachmentId}/content?company=SHOP`,
    undefined,
    id,
  ).then((r) => r);
  let waited = false;
  try {
    for (let attempt = 0; attempt < 100; attempt++) {
      const rows = await db.$queryRaw<
        Array<{ query: string }>
      >`SELECT query FROM pg_stat_activity WHERE ${blocker} = ANY(pg_blocking_pids(pid))`;
      if (rows.some((row) => row.query.includes('pg_advisory_xact_lock'))) {
        waited = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    release();
    await writer;
    expect((await response).status).toBe(403);
    expect(waited).toBe(true);
    expect(reads).not.toHaveBeenCalled();
  } finally {
    release();
    reads.mockRestore();
  }
});
it('cleans owned bytes after an ambiguous upload failure without touching existing objects', async () => {
  const c = await customer(),
    storage = app.get(StorageService),
    real = storage.uploadOwned.bind(storage);
  let stagedKey = '';
  const spy = jest.spyOn(storage, 'uploadOwned').mockImplementationOnce(async (...args) => {
    stagedKey = args[0];
    await real(...args);
    throw new Error('owned transport failure after write');
  });
  try {
    await upload(c.id).expect(500);
  } finally {
    spy.mockRestore();
  }
  expect(stagedKey).toBeTruthy();
  await expect(fs.stat(process.env.STORAGE_LOCAL_DIR! + '/' + stagedKey)).rejects.toThrow();
  expect(await db.customerAttachment.count({ where: { originCustomerId: c.id } })).toBe(0);
});
it('accepts JPEG/WebP bytes and rejects empty, GIF and actual oversize multipart payloads', async () => {
  const sharp = (await import('sharp')).default,
    c = await customer();
  for (const [format, mime] of [
    ['jpeg', 'image/jpeg'],
    ['webp', 'image/webp'],
  ] as const) {
    const bytes = await sharp(png).toFormat(format).toBuffer();
    await sourceUpload(c.id, 'CUSTOMER_ORIGIN', c.id, actor, 'SHOP', bytes, mime).expect(201);
  }
  await sourceUpload(c.id, 'CUSTOMER_ORIGIN', c.id, actor, 'SHOP', Buffer.alloc(0)).expect(400);
  await sourceUpload(
    c.id,
    'CUSTOMER_ORIGIN',
    c.id,
    actor,
    'SHOP',
    Buffer.from('GIF89a'),
    'image/gif',
  ).expect(400);
  await sourceUpload(
    c.id,
    'CUSTOMER_ORIGIN',
    c.id,
    actor,
    'SHOP',
    Buffer.alloc(10 * 1024 * 1024 + 1),
  ).expect(413);
});
