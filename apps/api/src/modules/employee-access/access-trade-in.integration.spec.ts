import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { tradeInScopeWhere } from './access-trade-in-scope';
const url = process.env.EMPLOYEE_ACCESS_TEST_DATABASE_URL;
if (!url?.includes('/bc_access_task2?host=/tmp/bc-access-trade-in.'))
  throw new Error('Owned isolated database required');
const db = new PrismaClient({ datasources: { db: { url } } });

it('scopes real branch and central online provenance before count; actions never assign a case', async () => {
  const company = await db.companyInfo.findUniqueOrThrow({ where: { companyCode: 'SHOP' } });
  const a = await db.branch.create({ data: { name: 'A', companyId: company.id } });
  const b = await db.branch.create({ data: { name: 'B', companyId: company.id } });
  await db.tradeIn.createMany({
    data: [
      { branchId: a.id, deviceBrand: 'Apple', deviceModel: 'A' },
      { branchId: b.id, deviceBrand: 'Apple', deviceModel: 'B' },
      { submissionSource: 'ONLINE', deviceBrand: 'Apple', deviceModel: 'Central' },
      { deviceBrand: 'Apple', deviceModel: 'Unknown' },
    ],
  });
  const userId = randomUUID();
  const scope = {
    userId,
    company: 'SHOP' as const,
    permission: 'trade-in.read' as const,
    tuples: [{ userId, scope: 'BRANCHES' as const, branchIds: [a.id] }],
  };
  expect(await db.tradeIn.count({ where: tradeInScopeWhere(scope) })).toBe(1);
  expect(
    await db.tradeIn.count({
      where: {
        AND: [
          tradeInScopeWhere({ ...scope, tuples: [{ userId, scope: 'COMPANY', branchIds: [] }] }),
          { deviceModel: { in: ['A', 'B', 'Central', 'Unknown'] } },
        ],
      },
    }),
  ).toBe(3);
  expect(
    await db.tradeIn.count({
      where: tradeInScopeWhere({
        ...scope,
        tuples: [{ userId, scope: 'ASSIGNED', branchIds: [a.id] }],
      }),
    }),
  ).toBe(0);
  expect(
    await db.tradeIn.count({ where: tradeInScopeWhere({ ...scope, company: 'FINANCE' }) }),
  ).toBe(0);
});

import { Test } from '@nestjs/testing';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { ExecutionContext, INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import {
  PERMISSION_CATALOG,
  PermissionKey,
  TRADE_IN_DECLARATION_VERSION,
} from '@installment/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AccessSnapshotService } from './access-snapshot.service';
import { AccessResourceService } from './access-resource.service';
import { AccessPolicyService } from './access-policy';
import { AccessPolicyInterceptor } from './access-policy.interceptor';
import { AccessTradeInBoundaries, TRADE_IN_BOUNDARY_ROUTES } from './access-trade-in-boundaries';
import { AccessTradeInProjectionService } from './access-trade-in-projection.service';
import { TradeInController } from '../trade-in/trade-in.controller';
import { TradeInService } from '../trade-in/trade-in.service';
import { TradeInVoucherService } from '../trade-in/services/voucher.service';
import { VoucherPdfRenderer } from '../trade-in/services/voucher/voucher-pdf.renderer';
import { BuybackQuestionAdminService } from '../trade-in/services/buyback-question-admin.service';
import { OnlineAppraisalService } from '../trade-in/services/online-appraisal.service';
import { ShopBuybackService } from '../shop-buyback/shop-buyback.service';
import { BuybackPricingService } from '../shop-buyback/buyback-pricing.service';
import { LineOaService } from '../line-oa/line-oa.service';
import { ContactResolverService } from '../contacts/contact-resolver.service';
import { CustomerPiiService } from '../customers/customer-pii.service';
import { PiiAuditService } from '../pii/pii-audit.service';
import { StorageService } from '../storage/storage.service';
import { ShopTradeInTemplate } from '../journal/cpa-templates/shop-trade-in.template';
import { ShopAccountResolver } from '../journal/shop-account-resolver.service';
import { CompanyResolverService } from '../journal/company-resolver.service';
import { JournalAutoService } from '../journal/journal-auto.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { BranchGuard } from '../auth/guards/branch.guard';
import { ExportEnabledGuard } from '../settings/guards/export-enabled.guard';
import { seedShopCoa } from '../../../prisma/seed-coa-shop';
const snapshots = new AccessSnapshotService(db as PrismaService);
let app: INestApplication, actor: string, denied: string, branchA: string, branchB: string;
const successes = new Map<string, { method: string; path: string; body: unknown }>();
const storage = { upload: jest.fn(), delete: jest.fn() };
async function user() {
  return (
    await db.user.create({
      data: {
        name: 'Test',
        email: randomUUID() + '@test.invalid',
        password: 'unused',
        role: 'SALES',
        accessManaged: true,
      },
    })
  ).id;
}
async function grant(id: string, permissions: PermissionKey[], branches?: string[]) {
  const p = await db.accessPosition.create({
    data: { code: randomUUID(), name: 'Test', permissions },
  });
  await db.employeeAccessAssignment.create({
    data: {
      userId: id,
      positionId: p.id,
      companyCode: 'SHOP',
      scope: branches ? 'BRANCHES' : 'COMPANY',
      ...(branches ? { branches: { create: branches.map((branchId) => ({ branchId })) } } : {}),
    },
  });
  return p.id;
}
function http(method: string, path: string, body?: unknown, id = actor) {
  const agent = request(app.getHttpServer());
  const r =
    method === 'get'
      ? agent.get(path)
      : method === 'patch'
        ? agent.patch(path)
        : method === 'put'
          ? agent.put(path)
          : method === 'delete'
            ? agent.delete(path)
            : agent.post(path);
  r.set('x-test-user', id);
  if (body) r.send(body as object);
  r.on('response', (res: request.Response) => {
    if (res.status >= 400 && id === actor) console.error(method, path, res.status, res.body);
  });
  return r;
}
const photo =
  'data:image/png;base64,' +
  Buffer.concat([
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',
      'base64',
    ),
    Buffer.alloc(100),
  ]).toString('base64');
const evidence = {
  sellerName: 'Test Seller',
  sellerPhone: '0800000000',
  sellerAddress: 'Test address',
  sellerIdCardNumber: '0000000000001',
  serialNumber: 'TEST-SERIAL',
  imeiMissingReason: 'No radio',
  idCardVerified: true,
  sellerConsentSigned: true,
  declarationVersion: TRADE_IN_DECLARATION_VERSION,
  sellerSignatureBase64: photo,
  paymentMethod: 'TRANSFER',
  transferBankName: 'Test Bank',
  transferAccountNumber: '1234567890',
  transferAccountName: 'Test Seller',
  deviceOrigin: 'IMPORTED',
};
beforeAll(async () => {
  process.env.PII_ENCRYPTION_KEY = 'c'.repeat(64);
  process.env.PII_HASH_SALT = 'isolated-trade-in-test-1234567890';
  const shop = await db.companyInfo.upsert({
    where: { companyCode: 'SHOP' },
    update: {},
    create: {
      companyCode: 'SHOP',
      nameTh: 'Test',
      taxId: 'TEST',
      address: 'TEST',
      directorName: 'TEST',
    },
  });
  branchA = (await db.branch.create({ data: { name: 'A', companyId: shop.id } })).id;
  branchB = (await db.branch.create({ data: { name: 'B', companyId: shop.id } })).id;
  actor = await user();
  await db.user.update({ where: { id: actor }, data: { role: 'ACCOUNTANT' } });
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
  jest
    .spyOn(VoucherPdfRenderer.prototype, 'htmlToPdf')
    .mockImplementation(async (html) => Buffer.from(html));
  const module = await Test.createTestingModule({
    controllers: [TradeInController],
    providers: [
      AccessTradeInBoundaries,
      AccessTradeInProjectionService,
      AccessResourceService,
      AccessPolicyService,
      { provide: PrismaService, useValue: db },
      { provide: AccessSnapshotService, useValue: snapshots },
      TradeInService,
      TradeInVoucherService,
      BuybackQuestionAdminService,
      OnlineAppraisalService,
      ShopBuybackService,
      BuybackPricingService,
      ContactResolverService,
      CustomerPiiService,
      PiiAuditService,
      ShopTradeInTemplate,
      ShopAccountResolver,
      CompanyResolverService,
      JournalAutoService,
      { provide: StorageService, useValue: storage },
      {
        provide: LineOaService,
        useValue: {
          sendFlexMessage: jest.fn(() => {
            throw new Error('No network');
          }),
        },
      },
      { provide: APP_INTERCEPTOR, useClass: AccessPolicyInterceptor },
    ],
  })
    .overrideGuard(JwtAuthGuard)
    .useValue({
      canActivate: async (ctx: ExecutionContext) => {
        const req = ctx.switchToHttp().getRequest(),
          res = ctx.switchToHttp().getResponse();
        const id = req.headers['x-test-user'];
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
            });
        });
        return true;
      },
    })
    .overrideGuard(RolesGuard)
    .useValue({ canActivate: () => true })
    .overrideGuard(BranchGuard)
    .useValue({ canActivate: () => true })
    .overrideGuard(ExportEnabledGuard)
    .useValue({ canActivate: () => true })
    .compile();
  app = module.createNestApplication();
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
  await app.listen(0, '127.0.0.1');
});
afterAll(async () => {
  await app?.close();
  await db.$disconnect();
  jest.restoreAllMocks();
});
it('executes the 38 real HTTP routes, including credit journals and payout, then denies persisted no-grants identity', async () => {
  const root = '/trade-ins';
  const val = {
    brand: 'Apple',
    model: 'iPhone 15',
    storage: '128GB',
    condition: 'A',
    basePrice: 1000,
  };
  const v = (await http('post', root + '/valuations', val).expect(201)).body;
  const q = (
    await http('post', root + '/buyback-questions', {
      key: 'screen',
      title: 'Screen',
      selectType: 'SINGLE',
    }).expect(201)
  ).body;
  const ch = (
    await http('post', root + '/buyback-questions/' + q.id + '/choices', {
      label: 'Good',
      deductType: 'FIXED',
      deductValue: 0,
    }).expect(201)
  ).body;
  await http('patch', root + '/buyback-questions/' + q.id, { title: 'Screen condition' }).expect(
    200,
  );
  await http('patch', root + '/buyback-choices/' + ch.id, { label: 'Good screen' }).expect(200);
  await http('put', root + '/sell-config', { exchangeBonusPct: 10 }).expect(200);
  for (const path of [
    '',
    '/valuation?brand=Apple&model=iPhone%2015&storage=128GB&condition=A',
    '/valuations',
    '/valuation-brands',
    '/valuation-models?brand=Apple',
    '/buyback-questions',
    '/sell-config',
    '/quick-buy/catalog',
    '/quick-buy/questions?model=iPhone%2015&storage=128GB',
    '/appraisal-questions',
  ])
    await http('get', root + path).expect(200);
  const device = { deviceBrand: 'Apple', deviceModel: 'iPhone 15', deviceStorage: '128GB' };
  const preview = { ...device, answers: [{ questionKey: 'screen', choiceIds: [ch.id] }] };
  await http('post', root + '/quick-buy/preview', preview).expect(201);
  const t = (await http('post', root, { ...device, branchId: branchA, ...evidence }).expect(201))
    .body;
  await http('get', root + '/' + t.id).expect(200);
  await http('patch', root + '/' + t.id, { notes: 'Inspection' }).expect(200);
  await http('post', root + '/' + t.id + '/id-card-photo', {
    photoBase64: photo,
    source: 'upload',
  }).expect(201);
  const p = (
    await http('post', root + '/' + t.id + '/appraisal-preview', {
      answers: preview.answers,
    }).expect(201)
  ).body;
  await http('get', root + '/appraisal-questions?tradeInId=' + t.id).expect(200);
  await http('patch', root + '/' + t.id + '/appraise-online', {
    mode: 'REVISED',
    answers: preview.answers,
    previewToken: p.previewToken,
  }).expect(200);
  await http('post', root + '/' + t.id + '/accept', evidence).expect(201);
  const accepted = await db.tradeIn.findUniqueOrThrow({ where: { id: t.id } });
  expect(accepted.creditIssueJournalId).toBeTruthy();
  await http(
    'get',
    root + '/credits?customerId=' + accepted.customerId + '&branchId=' + branchA,
  ).expect(200);
  const voucher = (await http('post', root + '/' + t.id + '/voucher', {}).expect(201)).body;
  await http('get', root + '/verify/' + voucher.voucherNumber).expect(200);
  await http('get', root + '/' + t.id + '/voucher.pdf').expect(200);
  await http('post', root + '/' + t.id + '/complete', {}).expect(201);
  await http('get', root + '/seller-history/0000000000001').expect(200);
  await http('get', root + '/check-imei/123456789012345').expect(200);
  const t2 = (
    await http('post', root, { ...device, branchId: branchA, sellerName: 'Other' }).expect(201)
  ).body;
  await http('patch', root + '/' + t2.id + '/appraise', {
    offeredPrice: 1000,
    deviceCondition: 'A',
  }).expect(200);
  await http('post', root + '/' + t2.id + '/reject', {}).expect(201);
  const requestId = randomUUID();
  await http('post', root + '/quick-buy', {
    ...device,
    ...evidence,
    branchId: branchA,
    requestId,
    agreedPrice: 1000,
    deviceCondition: 'A',
  }).expect(201);
  await http('get', root + '/quick-buy/requests/' + requestId).expect(200);
  await http('delete', root + '/buyback-choices/' + ch.id).expect(200);
  await http('delete', root + '/buyback-questions/' + q.id).expect(200);
  await http('delete', root + '/valuations/' + v.id).expect(200);
  expect([...successes.keys()].sort()).toEqual([...TRADE_IN_BOUNDARY_ROUTES].sort());
  for (const action of successes.values())
    await http(action.method, action.path, action.body, denied).expect(403);
});

it('isolates record/list/count, monetary, document and bank grants by source and rejects filter/substitution', async () => {
  const reader = await user();
  await grant(reader, ['trade-in.read', 'trade-in.create'], [branchA]);
  const a = await db.tradeIn.create({
    data: {
      branchId: branchA,
      deviceBrand: 'Apple',
      deviceModel: 'Scoped',
      agreedPrice: 1234,
      transferAccountNumber: '1234567890',
      idCardPhotoUrl: 'private-key',
    },
  });
  const b = await db.tradeIn.create({
    data: { branchId: branchB, deviceBrand: 'Apple', deviceModel: 'Scoped', agreedPrice: 5555 },
  });
  const central = await db.tradeIn.create({
    data: { submissionSource: 'ONLINE', deviceBrand: 'Apple', deviceModel: 'Central read' },
  });
  const hidden = (await http('get', '/trade-ins/' + a.id, undefined, reader).expect(200)).body;
  expect(hidden.agreedPrice).toBeNull();
  expect(hidden.idCardPhotoUrl).toBeNull();
  expect(hidden.transferAccountNumber).not.toBe('1234567890');
  await http('get', '/trade-ins/' + b.id, undefined, reader).expect(403);
  await http('get', '/trade-ins/' + central.id, undefined, reader).expect(403);
  const list = (
    await http('get', '/trade-ins?search=Scoped&limit=1', undefined, reader).expect(200)
  ).body;
  expect(list.total).toBe(1);
  expect(list.data[0].id).toBe(a.id);
  await grant(
    reader,
    ['sensitive.cost.read', 'sensitive.seller-bank.read', 'documents.read'],
    [branchB],
  );
  expect(
    (await http('get', '/trade-ins/' + a.id, undefined, reader).expect(200)).body.agreedPrice,
  ).toBeNull();
  await grant(
    reader,
    ['sensitive.cost.read', 'sensitive.seller-bank.read', 'documents.read'],
    [branchA],
  );
  const visible = (await http('get', '/trade-ins/' + a.id, undefined, reader).expect(200)).body;
  expect(visible.agreedPrice).toBe('1234');
  expect(visible.transferAccountNumber).toBe('1234567890');
  expect(visible.idCardPhotoUrl).toBe('private-key');
  await http(
    'post',
    '/trade-ins',
    { branchId: branchB, deviceBrand: 'Apple', deviceModel: 'Substitute', sellerName: 'Test' },
    reader,
  ).expect(403);
  await http(
    'post',
    '/trade-ins',
    { deviceBrand: 'Apple', deviceModel: 'Unresolved', sellerName: 'Test' },
    reader,
  ).expect(400);
  for (const q of ['limit=NaN', 'page=9999999999999', 'status=WRONG', 'search[x]=x', 'surprise=x'])
    await http('get', '/trade-ins?' + q, undefined, reader).expect(400);
});
import { Prisma } from '@prisma/client';
import { currentDomainAccess } from './access-execution-context';
import { lockEmployeeAccess } from './access-snapshot.service';
it('joins financial writes, retries whole attempts, owns staged files and preserves exact duplicate request identity', async () => {
  const body = {
    deviceBrand: 'Apple',
    deviceModel: 'Retry model',
    ...evidence,
    branchId: branchA,
    requestId: randomUUID(),
    agreedPrice: 1000,
    deviceCondition: 'A',
    idCardPhotoBase64: photo,
  };
  storage.upload.mockClear();
  storage.delete.mockClear();
  storage.upload.mockImplementation(async () => {
    expect(currentDomainAccess()).toBeUndefined();
  });
  const projection = app.get(AccessTradeInProjectionService),
    original = projection.project.bind(projection);
  let attempts = 0;
  const retry = jest.spyOn(projection, 'project').mockImplementation(async (value, ...args) => {
    const result = await original(value, ...args);
    if (++attempts === 1)
      throw new Prisma.PrismaClientKnownRequestError('retry', {
        code: 'P2034',
        clientVersion: 'test',
      });
    return result;
  });
  const response = await http('post', '/trade-ins/quick-buy', body).expect(201);
  retry.mockRestore();
  expect(attempts).toBe(2);
  expect(storage.upload).toHaveBeenCalledTimes(1);
  expect(storage.delete).not.toHaveBeenCalled();
  const row = await db.tradeIn.findUniqueOrThrow({ where: { id: response.body.id } });
  const journal = await db.journalEntry.findFirstOrThrow({
    where: { metadata: { path: ['tradeInId'], equals: row.id } },
    include: { lines: true },
  });
  expect(journal.lines.map((l) => [l.debit.toFixed(2), l.credit.toFixed(2)]).sort()).toEqual([
    ['0.00', '1000.00'],
    ['1000.00', '0.00'],
  ]);
  expect(
    await db.journalEntry.count({ where: { metadata: { path: ['tradeInId'], equals: row.id } } }),
  ).toBe(1);
  expect(await db.shopTender.count({ where: { tradeInId: row.id } })).toBe(1);
  const again = await Promise.all([
    http('post', '/trade-ins/quick-buy', body).expect(201),
    http('post', '/trade-ins/quick-buy', body).expect(201),
  ]);
  expect(again.map((r) => r.body.id)).toEqual([row.id, row.id]);
  await http('post', '/trade-ins/quick-buy', { ...body, agreedPrice: 999 }).expect(409);
  const failedId = randomUUID();
  const fail = jest
    .spyOn(projection, 'project')
    .mockRejectedValue(new Error('injected outer failure'));
  await http('post', '/trade-ins/quick-buy', {
    ...body,
    requestId: failedId,
    serialNumber: 'ROLLBACK-SERIAL',
  }).expect(500);
  fail.mockRestore();
  expect(await db.tradeIn.count({ where: { quickBuyRequestId: failedId } })).toBe(0);
  expect(await db.product.count({ where: { serialNumber: 'ROLLBACK-SERIAL' } })).toBe(0);
  expect(storage.delete).toHaveBeenCalled();
});
it('reloads revoked current authority after waiting for the exclusive access lock', async () => {
  const staff = await user();
  const position = await grant(staff, ['trade-in.update'], [branchA]);
  const row = await db.tradeIn.create({
    data: {
      branchId: branchA,
      deviceBrand: 'Apple',
      deviceModel: 'Authority',
      status: 'APPRAISED',
    },
  });
  let release!: () => void, locked!: () => void;
  const held = new Promise<void>((r) => (locked = r)),
    unlock = new Promise<void>((r) => (release = r));
  const revoke = db.$transaction(async (tx) => {
    await lockEmployeeAccess(tx);
    await tx.accessPosition.update({ where: { id: position }, data: { permissions: [] } });
    await tx.user.update({ where: { id: staff }, data: { accessRevision: { increment: 1 } } });
    locked();
    await unlock;
  });
  await held;
  const pending = http('post', '/trade-ins/' + row.id + '/reject', {}, staff).then((r) => r);
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
  expect((await db.tradeIn.findUniqueOrThrow({ where: { id: row.id } })).status).toBe('APPRAISED');
});

it('protects global reference authority, owner overrides, voucher bytes and PII audit metadata independently', async () => {
  const staff = await user();
  await grant(
    staff,
    [
      'trade-in.read',
      'trade-in.update',
      'trade-in.export',
      'documents.read',
      'sensitive.cost.read',
      'pricing.update',
    ],
    [branchA],
  );
  await http(
    'post',
    '/trade-ins/valuations',
    { brand: 'Apple', model: 'Forbidden', storage: '128GB', condition: 'A', basePrice: 1 },
    staff,
  ).expect(403);
  const source = await db.tradeIn.create({
    data: {
      branchId: branchA,
      deviceBrand: 'Apple',
      deviceModel: 'Document',
      offeredPrice: 1000,
      status: 'ACCEPTED',
      transferAccountNumber: '1234567890',
      paymentMethod: 'TRANSFER',
      voucherNumber: 'EXP-TEST-' + randomUUID(),
      voucherDate: new Date(),
      appraisalLocked: true,
    },
  });
  await http('get', '/trade-ins/' + source.id, undefined, staff).expect(200);
  expect(
    await db.auditLog.count({
      where: { userId: staff, entityId: source.id, action: 'PII_DECRYPT_MASKED' },
    }),
  ).toBe(1);
  await http('get', '/trade-ins/' + source.id + '/voucher.pdf', undefined, staff).expect(200);
  expect(jest.mocked(VoucherPdfRenderer.prototype.htmlToPdf).mock.calls.at(-1)![0]).not.toContain(
    '1234567890',
  );
  await grant(staff, ['sensitive.seller-bank.read'], [branchB]);
  await http('get', '/trade-ins/' + source.id + '/voucher.pdf', undefined, staff).expect(200);
  expect(jest.mocked(VoucherPdfRenderer.prototype.htmlToPdf).mock.calls.at(-1)![0]).not.toContain(
    '1234567890',
  );
  await grant(staff, ['sensitive.seller-bank.read'], [branchA]);
  await http('get', '/trade-ins/' + source.id + '/voucher.pdf', undefined, staff).expect(200);
  expect(jest.mocked(VoucherPdfRenderer.prototype.htmlToPdf).mock.calls.at(-1)![0]).toContain(
    '1234567890',
  );
  await http('get', '/trade-ins/' + source.id, undefined, staff).expect(200);
  expect(
    await db.auditLog.count({
      where: { userId: staff, entityId: source.id, action: 'PII_DECRYPT_FULL' },
    }),
  ).toBe(1);
  const appraised = await db.tradeIn.create({
    data: {
      branchId: branchA,
      deviceBrand: 'Apple',
      deviceModel: 'Owner',
      offeredPrice: 1000,
      status: 'APPRAISED',
      appraisalLocked: true,
    },
  });
  await http(
    'patch',
    '/trade-ins/' + appraised.id + '/appraise',
    { offeredPrice: 1100, deviceCondition: 'A', force: true, forceReason: 'Reviewed change' },
    staff,
  ).expect(403);
  await db.user.update({ where: { id: staff }, data: { role: 'OWNER' } });
  await http(
    'patch',
    '/trade-ins/' + appraised.id + '/appraise',
    { offeredPrice: 1100, deviceCondition: 'A', force: true, forceReason: 'Reviewed change' },
    staff,
  ).expect(200);
  expect(await db.auditLog.count({ where: { entityId: appraised.id } })).toBeGreaterThan(0);
});
it('rejects malformed image input before upload and does not stage unauthorized source files', async () => {
  storage.upload.mockClear();
  const row = await db.tradeIn.create({
    data: { branchId: branchA, deviceBrand: 'Apple', deviceModel: 'Files' },
  });
  await http('post', '/trade-ins/' + row.id + '/id-card-photo', {
    photoBase64: [],
    source: 'wrong',
  }).expect(400);
  await http(
    'post',
    '/trade-ins/' + row.id + '/id-card-photo',
    { photoBase64: photo, source: 'upload' },
    denied,
  ).expect(403);
  expect(storage.upload).not.toHaveBeenCalled();
});

it('rechecks source after staging and cleans only the operation file on substitution', async () => {
  const staff = await user();
  await grant(staff, ['trade-in.create', 'documents.read'], [branchA]);
  const row = await db.tradeIn.create({
    data: {
      branchId: branchA,
      deviceBrand: 'Apple',
      deviceModel: 'Staged',
      idCardPhotoUrl: 'existing-file',
    },
  });
  storage.upload.mockClear();
  storage.delete.mockClear();
  storage.upload.mockImplementationOnce(async () => {
    expect(currentDomainAccess()).toBeUndefined();
    await db.tradeIn.update({ where: { id: row.id }, data: { branchId: branchB } });
  });
  await http(
    'post',
    '/trade-ins/' + row.id + '/id-card-photo',
    { photoBase64: photo, source: 'upload' },
    staff,
  ).expect(403);
  expect(storage.upload).toHaveBeenCalledTimes(1);
  expect(storage.delete).toHaveBeenCalledTimes(1);
  expect(storage.delete).not.toHaveBeenCalledWith('existing-file');
  expect((await db.tradeIn.findUniqueOrThrow({ where: { id: row.id } })).idCardPhotoUrl).toBe(
    'existing-file',
  );
});

it('uses persisted owner after a lock wait for immutable appraisal override', async () => {
  const staff = await user();
  await db.user.update({ where: { id: staff }, data: { role: 'OWNER' } });
  await grant(staff, ['trade-in.update'], [branchA]);
  const row = await db.tradeIn.create({
    data: {
      branchId: branchA,
      deviceBrand: 'Apple',
      deviceModel: 'Demotion',
      offeredPrice: 1000,
      status: 'APPRAISED',
      appraisalLocked: true,
    },
  });
  let release!: () => void, locked!: () => void;
  const held = new Promise<void>((r) => (locked = r)),
    unlock = new Promise<void>((r) => (release = r));
  const demote = db.$transaction(async (tx) => {
    await lockEmployeeAccess(tx);
    await tx.user.update({
      where: { id: staff },
      data: { role: 'SALES', accessRevision: { increment: 1 } },
    });
    locked();
    await unlock;
  });
  await held;
  const pending = http(
    'patch',
    '/trade-ins/' + row.id + '/appraise',
    { offeredPrice: 1100, deviceCondition: 'A', force: true, forceReason: 'Override' },
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
  await demote;
  expect((await pending).status).toBe(403);
  expect(
    (await db.tradeIn.findUniqueOrThrow({ where: { id: row.id } })).offeredPrice?.toFixed(2),
  ).toBe('1000.00');
});
it('does not disclose previous or reference prices through appraisal errors', async () => {
  const staff = await user();
  await grant(staff, ['trade-in.update'], [branchA]);
  const row = await db.tradeIn.create({
    data: {
      branchId: branchA,
      deviceBrand: 'Apple',
      deviceModel: 'Hidden previous',
      offeredPrice: 12456,
      status: 'APPRAISED',
      appraisalLocked: true,
    },
  });
  const response = await http(
    'patch',
    '/trade-ins/' + row.id + '/appraise',
    { offeredPrice: 1100, deviceCondition: 'A' },
    staff,
  ).expect(403);
  expect(JSON.stringify(response.body)).not.toMatch(/12,?456/);
});

it('serializes simultaneous first quick-buy attempts into one financial operation', async () => {
  const body = {
    deviceBrand: 'Apple',
    deviceModel: 'Concurrent',
    ...evidence,
    branchId: branchA,
    requestId: randomUUID(),
    agreedPrice: 1000,
    deviceCondition: 'A',
    serialNumber: 'CONCURRENT-SERIAL',
  };
  const results = await Promise.all([
    http('post', '/trade-ins/quick-buy', body).expect(201),
    http('post', '/trade-ins/quick-buy', body).expect(201),
  ]);
  expect(results[0].body.id).toBe(results[1].body.id);
  expect(await db.tradeIn.count({ where: { quickBuyRequestId: body.requestId } })).toBe(1);
  expect(await db.shopTender.count({ where: { tradeInId: results[0].body.id } })).toBe(1);
  expect(
    await db.journalEntry.count({
      where: { metadata: { path: ['tradeInId'], equals: results[0].body.id } },
    }),
  ).toBe(1);
});
it('cleans a partial staged upload before any database mutation', async () => {
  storage.upload.mockClear();
  storage.delete.mockClear();
  storage.upload.mockRejectedValueOnce(new Error('partial upload'));
  await http('post', '/trade-ins', {
    branchId: branchA,
    deviceBrand: 'Apple',
    deviceModel: 'Partial file',
    sellerName: 'Test',
    idCardPhotoBase64: photo,
  }).expect(500);
  expect(storage.delete).toHaveBeenCalledTimes(1);
  expect(await db.tradeIn.count({ where: { deviceModel: 'Partial file' } })).toBe(0);
});

it('fix1 preserves global IMEI uniqueness without disclosing foreign product names on accept or quick-buy', async () => {
  const staff = await user();
  await grant(staff, ['trade-in.create', 'trade-in.update'], [branchA]);
  const finance = await db.companyInfo.upsert({
    where: { companyCode: 'FINANCE' },
    update: {},
    create: {
      companyCode: 'FINANCE',
      nameTh: 'Fixture',
      taxId: 'TEST',
      address: 'TEST',
      directorName: 'TEST',
    },
  });
  for (const [index, companyId] of [null, finance.id].entries()) {
    const imei = `98765432100000${index}`;
    const product = await db.product.create({
      data: {
        name: `CONFIDENTIAL-FOREIGN-DEVICE-${index}`,
        brand: 'Apple',
        model: 'Hidden',
        category: 'PHONE_USED',
        costPrice: 9999,
        branchId: branchB,
        ownedByCompanyId: companyId,
        imeiSerial: imei,
      },
    });
    const row = await db.tradeIn.create({
      data: {
        branchId: branchA,
        deviceBrand: 'Apple',
        deviceModel: 'Duplicate',
        status: 'APPRAISED',
        offeredPrice: 1000,
        flow: 'BUYBACK',
      },
    });
    const accept = await http(
      'post',
      `/trade-ins/${row.id}/accept`,
      { ...evidence, imei },
      staff,
    ).expect(400);
    expect(accept.body.message).toBe('IMEI นี้มีอยู่ในระบบแล้ว');
    expect(JSON.stringify(accept.body)).not.toContain(product.name);
    expect((await db.tradeIn.findUniqueOrThrow({ where: { id: row.id } })).status).toBe(
      'APPRAISED',
    );
    const requestId = randomUUID();
    const quick = await http(
      'post',
      '/trade-ins/quick-buy',
      {
        ...evidence,
        branchId: branchA,
        deviceBrand: 'Apple',
        deviceModel: 'Duplicate quick',
        agreedPrice: 1000,
        deviceCondition: 'A',
        requestId,
        imei,
      },
      staff,
    ).expect(400);
    expect(quick.body.message).toBe('IMEI นี้มีอยู่ในระบบแล้ว');
    expect(JSON.stringify(quick.body)).not.toContain(product.name);
    expect(await db.tradeIn.count({ where: { quickBuyRequestId: requestId } })).toBe(0);
    expect(await db.product.count({ where: { imeiSerial: imei, deletedAt: null } })).toBe(1);
    expect(await db.shopTender.count({ where: { tradeInId: row.id } })).toBe(0);
  }
});

it('fix1 resolves credit journal current company and canonical issue source before detail/list navigation', async () => {
  const createCredit = async () => {
    const created = (
      await http('post', '/trade-ins', {
        branchId: branchA,
        deviceBrand: 'Apple',
        deviceModel: 'Journal proof',
        sellerName: 'Test',
      }).expect(201)
    ).body;
    await http('patch', `/trade-ins/${created.id}/appraise`, {
      offeredPrice: 1000,
      deviceCondition: 'A',
    }).expect(200);
    await http('post', `/trade-ins/${created.id}/accept`, evidence).expect(201);
    return db.tradeIn.findUniqueOrThrow({ where: { id: created.id } });
  };
  const row = await createCredit(),
    other = await createCredit();
  const journalId = row.creditIssueJournalId!;
  const journal = await db.journalEntry.findUniqueOrThrow({ where: { id: journalId } });
  const staff = await user();
  await grant(staff, ['trade-in.read', 'journal.read'], [branchA]);
  const assertNavigation = async (expected: string | null) => {
    const detail = (await http('get', `/trade-ins/${row.id}`, undefined, staff).expect(200)).body;
    expect(detail.creditIssueJournalId).toBe(expected);
    expect(detail.agreedPrice).toBeNull();
    const list = (
      await http('get', '/trade-ins?search=Journal%20proof', undefined, staff).expect(200)
    ).body;
    expect(list.data.find((item: { id: string }) => item.id === row.id).creditIssueJournalId).toBe(
      expected,
    );
  };
  // Journal has no branch stamp: a case branch grant cannot prove central journal access.
  await assertNavigation(null);
  await grant(staff, ['journal.read']);
  await assertNavigation(journalId);
  const finance = await db.companyInfo.upsert({
    where: { companyCode: 'FINANCE' },
    update: {},
    create: {
      companyCode: 'FINANCE',
      nameTh: 'Fixture',
      taxId: 'TEST',
      address: 'TEST',
      directorName: 'TEST',
    },
  });
  await db.journalEntry.update({ where: { id: journalId }, data: { companyId: finance.id } });
  await assertNavigation(null);
  await db.journalEntry.update({
    where: { id: journalId },
    data: { companyId: journal.companyId, deletedAt: new Date() },
  });
  await assertNavigation(null);
  await db.journalEntry.update({
    where: { id: journalId },
    data: { deletedAt: null, status: 'DRAFT' },
  });
  await assertNavigation(null);
  await db.journalEntry.update({
    where: { id: journalId },
    data: { status: 'POSTED', referenceId: 'different-source' },
  });
  await assertNavigation(null);
  await db.journalEntry.update({
    where: { id: journalId },
    data: { referenceId: journal.referenceId },
  });
  // Writable metadata cannot substitute for the canonical AUTO reference.
  await db.journalEntry.update({
    where: { id: other.creditIssueJournalId! },
    data: {
      metadata: { flow: 'shop-trade-in-credit-issued', tradeInId: row.id, branchId: branchA },
    },
  });
  await db.tradeIn.update({
    where: { id: row.id },
    data: { creditIssueJournalId: other.creditIssueJournalId },
  });
  await assertNavigation(null);
  await db.tradeIn.update({ where: { id: row.id }, data: { creditIssueJournalId: randomUUID() } });
  await assertNavigation(null);
  await db.tradeIn.update({
    where: { id: row.id },
    data: { creditIssueJournalId: journalId, creditIssuedAt: null },
  });
  await assertNavigation(null);
  await db.tradeIn.update({ where: { id: row.id }, data: { creditIssuedAt: row.creditIssuedAt } });
  await assertNavigation(journalId);
});

it('consumer fix denies known party selection and expansion when independent party tuples are empty', async () => {
  const staff = await user();
  await grant(staff, ['trade-in.read', 'trade-in.create'], [branchA]);
  const customer = await db.customer.create({ data: { name: 'Party privacy ' + randomUUID(), phone: '0800000000', nationalId: randomUUID() } });
  const row = await db.tradeIn.create({ data: { customerId: customer.id, branchId: branchA, deviceBrand: 'Apple', deviceModel: 'Known party' } });
  expect(await app.get(AccessTradeInProjectionService).partyAllows(db, await snapshots.forUser(staff), customer.id, 'customerId', 'customers.read')).toBe(false);
  const hidden = await http('get', '/trade-ins/' + row.id, undefined, staff).expect(200);
  expect(hidden.body.customerId).toBeNull(); expect(hidden.body.customer).toBeNull();
  await http('post', '/trade-ins', { customerId: customer.id, branchId: branchA, deviceBrand: 'Apple', deviceModel: 'Selected' }, staff).expect(403);
  await grant(staff, ['customers.read'], [branchB]);
  expect((await http('get', '/trade-ins/' + row.id, undefined, staff).expect(200)).body.customer).toBeNull();
  await grant(staff, ['customers.read'], [branchA]);
  expect((await http('get', '/trade-ins/' + row.id, undefined, staff).expect(200)).body.customer.id).toBe(customer.id);
  await http('post', '/trade-ins', { customerId: customer.id, branchId: branchA, deviceBrand: 'Apple', deviceModel: 'Selected' }, staff).expect(201);
});
