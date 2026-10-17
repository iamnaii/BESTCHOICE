import { AccessStickerPricingBoundaries } from './access-sticker-pricing-boundaries';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { Test } from '@nestjs/testing';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { ExecutionContext, INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { PermissionKey, DEFAULT_ACCESS_POSITIONS } from '@installment/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AccessSnapshotService } from './access-snapshot.service';
import { AccessResourceService } from './access-resource.service';
import { AccessPolicyService } from './access-policy';
import { AccessPolicyInterceptor } from './access-policy.interceptor';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { StickersController } from '../stickers/stickers.controller';
import { StickersService } from '../stickers/stickers.service';
import { PricingTemplatesController } from '../pricing-templates/pricing-templates.controller';
import { PricingTemplatesService } from '../pricing-templates/pricing-templates.service';
import { AuditInterceptor } from '../audit/audit.interceptor';
import { AuditService } from '../audit/audit.service';

const url = process.env.EMPLOYEE_ACCESS_TEST_DATABASE_URL;
if (
  !url?.includes('/bc_access_task2?host=/tmp/bc-access-sticker.') ||
  process.env.DATABASE_URL !== url ||
  process.env.DATABASE_URL_FINANCE !== url
)
  throw new Error('Both database URLs must use owned isolated sticker PostgreSQL');
const db = new PrismaClient({ datasources: { db: { url } } });
const marker = randomUUID();
const snapshots = new AccessSnapshotService(db as PrismaService);
let app: INestApplication,
  reader: string,
  denied: string,
  foreign: string,
  branchOnly: string,
  owner: string;
let branchId: string,
  otherBranch: string,
  productId: string,
  otherProduct: string,
  layoutId: string,
  pricingId: string;
let stale: Awaited<ReturnType<AccessSnapshotService['forUser']>> | undefined;
const promises = new Set<Promise<unknown>>();
const permissions = [
  'stickers.read',
  'stickers.create',
  'products.read',
  'pricing.read',
  'sticker-templates.create',
  'sticker-templates.update',
  'sticker-templates.delete',
  'pricing-templates.update',
] as PermissionKey[];
const pricing = () => ({
  brand: 'Owned',
  model: randomUUID(),
  category: 'PHONE_NEW',
  cashPrice: 123.45,
  installmentBestchoicePrice: 234.56,
  installmentFinancePrice: 345.67,
});
const layout = () => ({
  name: 'Owned layout',
  sizeWidthMm: 40,
  sizeHeightMm: 50,
  layoutConfig: { secret: 'MUST_NOT_AUDIT' },
});
async function user(role: 'ACCOUNTANT' | 'OWNER' = 'ACCOUNTANT') {
  return (
    await db.user.create({
      data: {
        name: 'Owned sticker test',
        email: randomUUID() + '@test.invalid',
        password: 'unused',
        role,
        accessManaged: true,
      },
    })
  ).id;
}
async function grant(id: string, keys = permissions, companyCode = 'SHOP', branches?: string[]) {
  const position = await db.accessPosition.create({
    data: { code: randomUUID(), name: 'Owned sticker position', permissions: keys },
  });
  return db.employeeAccessAssignment.create({
    data: {
      userId: id,
      positionId: position.id,
      companyCode,
      scope: branches ? 'BRANCHES' : 'COMPANY',
      ...(branches ? { branches: { create: branches.map((branchId) => ({ branchId })) } } : {}),
    },
  });
}
function http(method: 'get' | 'post' | 'patch' | 'put' | 'delete', path: string, actor = reader) {
  const agent = request(app.getHttpServer());
  return agent[method](path).set('x-test-user', actor).expect('x-owned-sticker-app', marker);
}
beforeAll(async () => {
  const shop = await db.companyInfo.findUniqueOrThrow({ where: { companyCode: 'SHOP' } });
  branchId = (
    await db.branch.create({ data: { name: 'Owned sticker branch', companyId: shop.id } })
  ).id;
  otherBranch = (
    await db.branch.create({ data: { name: 'Other sticker branch', companyId: shop.id } })
  ).id;
  [reader, denied, foreign, branchOnly, owner] = await Promise.all([
    user(),
    user(),
    user(),
    user(),
    user('OWNER'),
  ]);
  await grant(reader);
  await grant(reader, permissions, 'FINANCE');
  await grant(foreign, permissions, 'FINANCE');
  await grant(branchOnly, permissions, 'SHOP', [branchId]);
  for (const [branch, idName] of [
    [branchId, 'one'],
    [otherBranch, 'two'],
  ]) {
    const p = await db.product.create({
      data: {
        name: 'Owned phone',
        brand: 'Apple',
        model: 'Owned',
        category: 'PHONE_NEW',
        status: 'IN_STOCK',
        branchId: branch,
        imeiSerial: `${marker}-${idName}`,
        cashPrice: 987.65,
        installmentPrice: 1111.11,
        costPrice: 444.44,
        prices: { create: { label: 'Actual', amount: 987.65, isDefault: true } },
      },
    });
    if (idName === 'one') productId = p.id;
    else otherProduct = p.id;
  }
  layoutId = (await db.stickerTemplate.create({ data: layout() })).id;
  pricingId = (await db.pricingTemplate.create({ data: { ...pricing(), category: 'PHONE_NEW' } }))
    .id;
  const module = await Test.createTestingModule({
    controllers: [StickersController, PricingTemplatesController],
    providers: [
      AccessStickerPricingBoundaries,
      StickersService,
      PricingTemplatesService,
      AccessResourceService,
      AccessPolicyService,
      AuditService,
      { provide: PrismaService, useValue: db },
      { provide: AccessSnapshotService, useValue: snapshots },
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
          access: stale?.userId === id ? stale : await snapshots.forUser(id),
        };
        return true;
      },
    })
    .overrideGuard(RolesGuard)
    .useValue({ canActivate: () => true })
    .compile();
  app = module.createNestApplication();
  app.use((_req: unknown, res: { setHeader: (k: string, v: string) => void }, next: () => void) => {
    res.setHeader('x-owned-sticker-app', marker);
    next();
  });
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
  await app.listen(0, '127.0.0.1');
  const audit = app.get(AuditService),
    log = audit.log.bind(audit);
  audit.log = (...args: Parameters<AuditService['log']>) => {
    const promise = log(...args);
    promises.add(promise);
    void promise.finally(() => promises.delete(promise)).catch(() => undefined);
    return promise;
  };
}, 60000);
afterAll(async () => {
  await app?.close();
  await Promise.allSettled([...promises]);
  await db.$disconnect();
});
const cases = [
  ['get', '/sticker-templates', undefined, 200],
  ['get', () => `/sticker-templates/${layoutId}`, undefined, 200],
  ['post', '/sticker-templates', layout, 201],
  ['patch', () => `/sticker-templates/${layoutId}`, () => ({ sizeWidthMm: 45 }), 200],
  ['delete', () => `/sticker-templates/${layoutId}`, undefined, 200],
  ['get', () => `/sticker-templates/product/${productId}/data`, undefined, 200],
  ['get', () => `/sticker-templates/products/data?ids=${productId}`, undefined, 200],
  ['get', '/pricing-templates', undefined, 200],
  ['get', '/pricing-templates/lookup?brand=Owned&model=Absent', undefined, 200],
  ['get', () => `/pricing-templates/${pricingId}`, undefined, 200],
  ['post', '/pricing-templates', pricing, 201],
  ['put', () => `/pricing-templates/${pricingId}`, () => ({ cashPrice: 456.78 }), 200],
  ['delete', () => `/pricing-templates/${pricingId}`, undefined, 200],
  ['post', '/pricing-templates/import', () => ({ items: [pricing()] }), 201],
] as const;
describe('Owned exact Sticker7 plus Pricing7 HTTP', () => {
  it.each(cases)('%s %s admits useful configured authority', async (method, path, body, status) => {
    const route = typeof path === 'function' ? path() : path;
    const res = await http(method, route + (route.includes('?') ? '&' : '?') + 'company=SHOP')
      .send(body?.())
      .expect(status);
    if (method !== 'get' && !route.endsWith('/import')) {
      expect(Object.keys(res.body)).toEqual(['id']);
      if (route.startsWith('/sticker-templates')) {
        const row = await db.stickerTemplate.findUniqueOrThrow({ where: { id: res.body.id } });
        if (method === 'post') expect(row.name).toBe('Owned layout');
        if (method === 'patch') expect(Number(row.sizeWidthMm)).toBe(45);
        if (method === 'delete') expect(row.isActive).toBe(false);
      } else {
        const row = await db.pricingTemplate.findUniqueOrThrow({ where: { id: res.body.id } });
        if (method === 'post') expect(row.cashPrice.toString()).toBe('123.45');
        if (method === 'put') expect(row.cashPrice.toString()).toBe('456.78');
        if (method === 'delete') expect(row.isActive).toBe(false);
      }
    }
    if (route.endsWith('/import')) expect(res.body).toEqual({ success: 1, skipped: 0, errors: [] });
    if (method === 'get' && route.includes('/product/'))
      expect(res.body).toMatchObject({
        productId,
        cashPrice: '987.65',
        installmentPrice: '1111.11',
      });
  });
  it.each(cases)('%s %s rejects missing/foreign entry', async (method, path, body) => {
    const route = typeof path === 'function' ? path() : path;
    for (const actor of [denied, foreign])
      await http(method, route + (route.includes('?') ? '&' : '?') + 'company=SHOP', actor)
        .send(body?.())
        .expect(403);
  });
});

describe('Shared definition and actual Product contracts', () => {
  it('global reads accept either live company/branch context but writes require both COMPANY grants and return only IDs', async () => {
    await http('post', '/sticker-templates?company=FINANCE', owner).send(layout()).expect(201);
    await http('get', '/sticker-templates?company=FINANCE', foreign).expect(200);
    await http('get', '/pricing-templates?company=SHOP', branchOnly).expect(200);
    for (const actor of [branchOnly, foreign])
      await http('post', '/sticker-templates?company=SHOP', actor).send(layout()).expect(403);
    const only = await user();
    await grant(only, ['sticker-templates.create']);
    await http('post', '/sticker-templates?company=SHOP', only).send(layout()).expect(403);
    await grant(only, ['sticker-templates.create'], 'FINANCE');
    const res = await http('post', '/sticker-templates?company=FINANCE', only)
      .send(layout())
      .expect(201);
    expect(Object.keys(res.body)).toEqual(['id']);
    await http('get', `/sticker-templates/${res.body.id}?company=FINANCE`, only).expect(403);
    const assigned = await user();
    const a = await grant(assigned);
    await db.employeeAccessAssignment.update({ where: { id: a.id }, data: { scope: 'ASSIGNED' } });
    await http('get', '/pricing-templates?company=SHOP', assigned).expect(403);
  });
  it('does not turn legacy chat/device price rights into global administration', async () => {
    const actor = await user();
    await grant(actor, [
      'chat-library.read',
      'chat-library.create',
      'chat-library.update',
      'chat-library.delete',
      'pricing.update',
    ]);
    await grant(actor, ['pricing.update'], 'FINANCE');
    await http('get', '/sticker-templates?company=SHOP', actor).expect(403);
    await http('post', '/pricing-templates?company=SHOP', actor).send(pricing()).expect(403);
    await http('get', `/sticker-templates/product/${productId}/data?company=SHOP`, actor).expect(
      403,
    );
  });
  it('intersects original tuples before output and preserves ID/IMEI order, safe fields, missing and empty semantics', async () => {
    const res = await http(
      'get',
      `/sticker-templates/products/data?company=SHOP&ids=${otherProduct},%20${productId}%20,${marker}-one,missing`,
      branchOnly,
    ).expect(200);
    expect(res.body.map((v: { productId: string }) => v.productId)).toEqual([productId]);
    expect(res.body[0].prices).toEqual([{ label: 'Actual', amount: '987.65', isDefault: true }]);
    expect(res.body[0]).not.toHaveProperty('costPrice');
    await http(
      'get',
      `/sticker-templates/product/${otherProduct}/data?company=SHOP`,
      branchOnly,
    ).expect(404);
    await http('get', '/sticker-templates/product/missing/data?company=SHOP', branchOnly).expect(
      404,
    );
    expect(
      (await http('get', '/sticker-templates/products/data?company=SHOP', branchOnly).expect(200))
        .body,
    ).toEqual([]);
    const crossed = await user();
    await grant(crossed, ['stickers.create'], 'SHOP', [branchId]);
    await grant(crossed, ['products.read'], 'SHOP', [otherBranch]);
    expect(
      (
        await http(
          'get',
          `/sticker-templates/products/data?company=SHOP&ids=${productId},${otherProduct}`,
          crossed,
        ).expect(200)
      ).body,
    ).toEqual([]);
    const noRead = await user();
    await grant(noRead, ['stickers.create']);
    await http('get', '/sticker-templates/products/data?company=SHOP', noRead).expect(403);
    await http(
      'get',
      `/sticker-templates/products/data?company=SHOP&ids=${Array(100).fill(productId).join(',')}`,
      reader,
    ).expect(200);
    await http(
      'get',
      `/sticker-templates/products/data?company=SHOP&ids=${Array(101).fill(productId).join(',')}`,
      reader,
    ).expect(400);
  });
  it('authorized exact ID has priority over IMEI; hidden matching ID cannot affect visible IMEI', async () => {
    const collision = await db.product.create({
      data: {
        name: 'Collision',
        costPrice: 0,
        brand: 'Apple',
        model: 'Owned',
        category: 'PHONE_NEW',
        status: 'IN_STOCK',
        branchId,
        imeiSerial: otherProduct,
      },
    });
    const full = await http(
      'get',
      `/sticker-templates/products/data?company=SHOP&ids=${otherProduct},${collision.id}`,
      reader,
    ).expect(200);
    expect(full.body.map((p: { productId: string }) => p.productId)).toEqual([
      otherProduct,
      collision.id,
    ]);
    const limited = await http(
      'get',
      `/sticker-templates/products/data?company=SHOP&ids=${otherProduct}`,
      branchOnly,
    ).expect(200);
    expect(limited.body.map((p: { productId: string }) => p.productId)).toEqual([collision.id]);
    await db.product.update({ where: { id: collision.id }, data: { deletedAt: new Date() } });
  });
  it('uses actual FINANCE ownership, preserves stock-in/warranty and never central price fallback', async () => {
    const finance = await db.companyInfo.findUniqueOrThrow({ where: { companyCode: 'FINANCE' } });
    const p = await db.product.create({
      data: {
        name: 'Finance phone',
        costPrice: 0,
        brand: 'Apple',
        model: 'Owned',
        category: 'PHONE_USED',
        status: 'SOLD_INSTALLMENT',
        branchId,
        ownedByCompanyId: finance.id,
        stockInDate: new Date('2026-01-01'),
        warrantyExpireDate: new Date('2099-01-01'),
        cashPrice: null,
      },
    });
    expect(
      (await http('get', `/sticker-templates/products/data?company=SHOP&ids=${p.id}`).expect(200))
        .body,
    ).toEqual([]);
    const result = await http(
      'get',
      `/sticker-templates/product/${p.id}/data?company=FINANCE`,
    ).expect(200);
    expect(result.body).toMatchObject({
      cashPrice: null,
      prices: [],
      warrantyExpireDate: '2099-01-01',
      stockInDate: '2026-01-01T00:00:00.000Z',
      status: 'SOLD_INSTALLMENT',
    });
  });
  it('excludes deleted definitions and preserves lookup category/origin/warranty/storage fallback', async () => {
    const data = {
      ...pricing(),
      category: 'PHONE_USED' as const,
      deviceOrigin: 'IMPORTED' as const,
      hasWarranty: true,
      storage: '',
      rate1DownPayment: 10,
      rate1TermMonths: 1,
    };
    const p = await db.pricingTemplate.create({ data });
    const route = `/pricing-templates/lookup?company=SHOP&brand=${data.brand}&model=${data.model}&category=PHONE_USED&deviceOrigin=IMPORTED&hasWarranty=true&storage=256GB`;
    expect((await http('get', route).expect(200)).body.id).toBe(p.id);
    expect((await http('get', route.replace('IMPORTED', 'THAI')).expect(200)).text).toBe('');
    await db.pricingTemplate.update({ where: { id: p.id }, data: { deletedAt: new Date() } });
    await http('get', `/pricing-templates/${p.id}?company=SHOP`).expect(404);
    await http('put', `/pricing-templates/${p.id}?company=SHOP`).send({ cashPrice: 1 }).expect(404);
    const s = await db.stickerTemplate.create({ data: { ...layout(), deletedAt: new Date() } });
    await http('get', `/sticker-templates/${s.id}?company=SHOP`).expect(404);
    await http('patch', `/sticker-templates/${s.id}?company=SHOP`).send({ name: 'No' }).expect(404);
  });
});

describe('Atomic bounded import and durable evidence', () => {
  it('validates all rows safely before mutation, bounds envelope and preserves canonical numeric rules', async () => {
    const first = pricing();
    const result = await http('post', '/pricing-templates/import?company=SHOP')
      .send({ items: [first, { ...pricing(), model: 'CALLER_SECRET', rate1TermMonths: 0 }] })
      .expect(201);
    expect(result.body).toEqual({ success: 0, skipped: 2, errors: ['ROW_2:INVALID_ROW'] });
    expect(await db.pricingTemplate.count({ where: { model: first.model } })).toBe(0);
    await http('post', '/pricing-templates/import?company=SHOP')
      .send({ items: Array(101).fill(first) })
      .expect(400);
    await http('post', '/pricing-templates/import?company=SHOP').send({ items: 'bad' }).expect(400);
    expect(
      (await http('post', '/pricing-templates/import?company=SHOP').send({ items: [] }).expect(201))
        .body,
    ).toEqual({ success: 0, skipped: 0, errors: [] });
    await http('post', '/pricing-templates?company=SHOP')
      .send({ ...pricing(), cashPrice: -1, rate1DownPayment: -2, rate1TermMonths: 1 })
      .expect(201);
  });
  it('processes duplicate keys in order and preserves existing down/term while new imports keep defaults', async () => {
    const data = pricing();
    const p = await db.pricingTemplate.create({
      data: {
        ...data,
        category: 'PHONE_NEW',
        rate1DownPayment: 20,
        rate1TermMonths: 6,
        isActive: false,
      },
    });
    const res = await http('post', '/pricing-templates/import?company=SHOP')
      .send({
        items: [
          { ...data, cashPrice: 10, rate1DownPayment: 99, rate1TermMonths: 3 },
          { ...data, cashPrice: 30 },
        ],
      })
      .expect(201);
    expect(res.body).toEqual({ success: 2, skipped: 0, errors: [] });
    expect(await db.pricingTemplate.findUnique({ where: { id: p.id } })).toMatchObject({
      cashPrice: expect.objectContaining({}),
      rate1TermMonths: 6,
      isActive: true,
    });
    const row = await db.pricingTemplate.findUniqueOrThrow({ where: { id: p.id } });
    expect(row.cashPrice.toString()).toBe('30');
    expect(row.rate1DownPayment?.toString()).toBe('20');
    const fresh = pricing();
    await http('post', '/pricing-templates/import?company=SHOP')
      .send({ items: [{ ...fresh, rate1DownPayment: 99, rate1TermMonths: 3 }] })
      .expect(201);
    expect(await db.pricingTemplate.findFirst({ where: { model: fresh.model } })).toMatchObject({
      rate1DownPayment: null,
      rate1TermMonths: null,
    });
  });
  it('deleted-key collision and SQL failure roll back previous rows, with safe errors and no resurrection', async () => {
    const dead = { ...pricing(), category: 'PHONE_NEW' as const };
    const p = await db.pricingTemplate.create({ data: { ...dead, deletedAt: new Date() } });
    await http('post', '/pricing-templates?company=SHOP').send(dead).expect(409);
    await expect(app.get(PricingTemplatesService).create(dead as never)).rejects.toThrow(
      'ข้อมูลอ้างอิงซ้ำกัน',
    );
    const first = pricing();
    await http('post', '/pricing-templates/import?company=SHOP')
      .send({ items: [first, dead] })
      .expect(409);
    expect(await db.pricingTemplate.count({ where: { model: first.model } })).toBe(0);
    expect(
      (await db.pricingTemplate.findUniqueOrThrow({ where: { id: p.id } })).deletedAt,
    ).not.toBeNull();
    const another = pricing();
    const failed = await http('post', '/pricing-templates/import?company=SHOP')
      .send({ items: [another, { ...pricing(), cashPrice: 1e20 }] })
      .expect(500);
    expect(failed.text).not.toMatch(/Prisma|numeric field|INSERT|1e20/);
    expect(await db.pricingTemplate.count({ where: { model: another.model } })).toBe(0);
  });
  it('legacy import uses the same atomic validation/result/SQL rollback contract', async () => {
    const service = app.get(PricingTemplatesService),
      first = pricing();
    expect(await service.bulkImport([first, { ...pricing(), cashPrice: 'bad' }] as never)).toEqual({
      success: 0,
      skipped: 2,
      errors: ['ROW_2:INVALID_ROW'],
    });
    await expect(
      service.bulkImport([first, { ...pricing(), cashPrice: 1e20 }] as never),
    ).rejects.toThrow('บันทึกข้อมูลอ้างอิงไม่สำเร็จ');
    expect(await db.pricingTemplate.count({ where: { model: first.model } })).toBe(0);
    expect(
      await service.bulkImport([
        { ...first, cashPrice: 1 },
        { ...first, cashPrice: 2 },
      ] as never),
    ).toEqual({ success: 2, skipped: 0, errors: [] });
    expect(
      (
        await db.pricingTemplate.findFirstOrThrow({ where: { model: first.model } })
      ).cashPrice.toString(),
    ).toBe('2');
  });
  it('required audit failure rolls back global mutations and output; outer audit contains only finite metadata', async () => {
    await db.$executeRawUnsafe(
      `CREATE FUNCTION owned_sticker_audit_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action IN ('SHARED_REFERENCE_CHANGED','STICKER_DATA_GENERATED','SHARED_REFERENCE_IMPORT_COMPLETED') THEN RAISE EXCEPTION 'owned late audit failure'; END IF; RETURN NEW; END $$`,
    );
    await db.$executeRawUnsafe(
      'CREATE TRIGGER owned_sticker_audit_fail BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION owned_sticker_audit_fail()',
    );
    const data = pricing(),
      before = await db.auditLog.count({ where: { action: 'SHARED_REFERENCE_CHANGED' } });
    try {
      await http('post', '/pricing-templates?company=SHOP').send(data).expect(500);
      await http('post', '/pricing-templates/import?company=SHOP')
        .send({ items: [data] })
        .expect(500);
      await http('get', `/sticker-templates/product/${productId}/data?company=SHOP`).expect(500);
      expect(await db.pricingTemplate.count({ where: { model: data.model } })).toBe(0);
      expect(await db.auditLog.count({ where: { action: 'SHARED_REFERENCE_CHANGED' } })).toBe(
        before,
      );
    } finally {
      await db.$executeRawUnsafe('DROP TRIGGER owned_sticker_audit_fail ON audit_logs');
      await db.$executeRawUnsafe('DROP FUNCTION owned_sticker_audit_fail()');
    }
    await Promise.allSettled([...promises]);
    const rows = await db.auditLog.findMany({ where: { userId: reader } });
    expect(
      JSON.stringify(rows, (_key, value) => (typeof value === 'bigint' ? value.toString() : value)),
    ).not.toMatch(/MUST_NOT_AUDIT|CALLER_SECRET|owned late audit failure/);
    const generated = rows.find((r) => r.action === 'STICKER_DATA_GENERATED');
    expect(generated?.newValue).toMatchObject({
      generation: 'GENERATED',
      delivery: 'NOT_OBSERVED',
      paperPrinted: false,
    });
  });
  it('rereads revoked authority instead of trusting cached snapshots', async () => {
    const actor = await user();
    const assignment = await grant(actor);
    await grant(actor, permissions, 'FINANCE');
    stale = await snapshots.forUser(actor);
    await db.employeeAccessAssignment.update({
      where: { id: assignment.id },
      data: { deletedAt: new Date() },
    });
    try {
      await http('get', '/pricing-templates?company=SHOP', actor).expect(403);
      await http('post', '/sticker-templates?company=SHOP', actor).send(layout()).expect(403);
    } finally {
      stale = undefined;
    }
  });
});

async function waitForBlocked(count = 1) {
  for (let i = 0; i < 200; i++) {
    const rows = await db.$queryRaw<
      Array<{ count: bigint }>
    >`SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND state='active'`;
    if (Number(rows[0].count) >= count) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Owned request did not wait on the expected database lock');
}
describe('Current authority and mixed-mode source locks', () => {
  it('reauthorizes after waiting for a committed position permission revocation', async () => {
    await Promise.allSettled([...promises]);
    const actor = await user(),
      assignment = await grant(actor);
    stale = await snapshots.forUser(actor);
    let release!: () => void, ready!: () => void;
    const gate = new Promise<void>((r) => {
        release = r;
      }),
      locked = new Promise<void>((r) => {
        ready = r;
      });
    const holder = db.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(718294630)`;
        await tx.accessPosition.update({
          where: { id: assignment.positionId },
          data: { permissions: [] },
        });
        ready();
        await gate;
      },
      { timeout: 10000 },
    );
    await locked;
    const pending = http('get', '/pricing-templates?company=SHOP', actor).then((res) => res);
    try {
      await waitForBlocked();
    } finally {
      release();
    }
    await holder;
    try {
      expect((await pending).status).toBe(403);
    } finally {
      stale = undefined;
    }
  });
  it('mixed managed/legacy global writers serialize and retry whole attempts without losing independent fields', async () => {
    await Promise.allSettled([...promises]);
    const row = await db.pricingTemplate.create({ data: { ...pricing(), category: 'PHONE_NEW' } });
    let release!: () => void, ready!: () => void;
    const gate = new Promise<void>((r) => {
        release = r;
      }),
      locked = new Promise<void>((r) => {
        ready = r;
      });
    const holder = db.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('shared-sticker-pricing-config'))`;
        await tx.pricingTemplate.update({ where: { id: row.id }, data: { cashPrice: 100 } });
        ready();
        await gate;
      },
      { timeout: 10000 },
    );
    await locked;
    const managed = http('put', `/pricing-templates/${row.id}?company=SHOP`)
      .send({ cashPrice: 300 })
      .then((r) => r);
    const legacy = app.get(PricingTemplatesService).update(row.id, { rate1TermMonths: 12 });
    try {
      await waitForBlocked(2);
    } finally {
      release();
    }
    await holder;
    expect((await managed).status).toBe(200);
    await legacy;
    const result = await db.pricingTemplate.findUniqueOrThrow({ where: { id: row.id } });
    expect(result.cashPrice.toString()).toBe('300');
    expect(result.rate1TermMonths).toBe(12);
  });
  it('Product source move while output waits cannot emit formerly authorized data', async () => {
    await Promise.allSettled([...promises]);
    const row = await db.product.create({
      data: {
        name: 'Moving',
        brand: 'Apple',
        model: 'Move',
        costPrice: 1,
        category: 'PHONE_NEW',
        status: 'IN_STOCK',
        branchId,
      },
    });
    let release!: () => void, ready!: () => void;
    const gate = new Promise<void>((r) => {
        release = r;
      }),
      locked = new Promise<void>((r) => {
        ready = r;
      });
    const holder = db.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM products WHERE id=${row.id} FOR UPDATE`;
        await tx.product.update({ where: { id: row.id }, data: { branchId: otherBranch } });
        ready();
        await gate;
      },
      { timeout: 10000 },
    );
    await locked;
    const pending = http(
      'get',
      `/sticker-templates/product/${row.id}/data?company=SHOP`,
      branchOnly,
    ).then((r) => r);
    try {
      await waitForBlocked();
    } finally {
      release();
    }
    await holder;
    expect((await pending).status).toBe(404);
  });
});

describe('All fourteen current authority controls', () => {
  it('rejects every exact route when the selected-company assignment is retired after snapshot creation', async () => {
    const actor = await user(),
      a = await grant(actor);
    await grant(actor, permissions, 'FINANCE');
    stale = await snapshots.forUser(actor);
    await db.employeeAccessAssignment.update({
      where: { id: a.id },
      data: { deletedAt: new Date() },
    });
    try {
      for (const [method, path, body] of cases) {
        const route = typeof path === 'function' ? path() : path;
        await http(method, route + (route.includes('?') ? '&' : '?') + 'company=SHOP', actor)
          .send(body?.())
          .expect(403);
      }
    } finally {
      stale = undefined;
    }
  });
  it('requires independent current Product read even with cached generation authority', async () => {
    const actor = await user();
    await grant(actor, ['stickers.create']);
    const a = await grant(actor, ['products.read']);
    stale = await snapshots.forUser(actor);
    await db.accessPosition.update({ where: { id: a.positionId }, data: { permissions: [] } });
    try {
      await http('get', `/sticker-templates/product/${productId}/data?company=SHOP`, actor).expect(
        403,
      );
      await http('get', '/sticker-templates/products/data?company=SHOP', actor).expect(403);
    } finally {
      stale = undefined;
    }
  });
});

it('future defaults keep STOCK device generation separate from global template administration', () => {
  const stock = DEFAULT_ACCESS_POSITIONS.find((position) => position.code === 'STOCK')!;
  expect(stock.permissions).toEqual(expect.arrayContaining(['stickers.read', 'stickers.create']));
  for (const position of DEFAULT_ACCESS_POSITIONS.filter((position) => position.code !== 'OWNER'))
    expect(
      position.permissions.some(
        (key) => key.startsWith('sticker-templates.') || key === 'pricing-templates.update',
      ),
    ).toBe(false);
});

it('even owners need a live selected company for reference reads and empty output', async () => {
  const finance = await db.companyInfo.findUniqueOrThrow({ where: { companyCode: 'FINANCE' } });
  await db.companyInfo.update({ where: { id: finance.id }, data: { isActive: false } });
  try {
    await http('get', '/pricing-templates?company=FINANCE', owner).expect(403);
    await http('get', '/sticker-templates?company=FINANCE', owner).expect(403);
    await http('get', '/sticker-templates/products/data?company=FINANCE', owner).expect(403);
    await http('post', '/sticker-templates?company=SHOP', owner).send(layout()).expect(403);
  } finally {
    await db.companyInfo.update({ where: { id: finance.id }, data: { isActive: true } });
  }
});

it('single comma-containing serial locks its actual Product before a concurrent source move', async () => {
  const serial = `${randomUUID()},ONE`;
  const row = await db.product.create({
    data: {
      name: 'Comma serial phone',
      brand: 'Apple',
      model: 'Move',
      costPrice: 1,
      cashPrice: 91.23,
      category: 'PHONE_NEW',
      status: 'IN_STOCK',
      branchId,
      imeiSerial: serial,
    },
  });
  const path = `/sticker-templates/product/${encodeURIComponent(`  ${serial}  `)}/data?company=SHOP`;
  const positive = await http('get', path, branchOnly).expect(200);
  expect(positive.body).toMatchObject({ productId: row.id, imei: serial, cashPrice: '91.23' });
  await Promise.allSettled([...promises]);
  const evidenceWhere = { userId: branchOnly, action: 'STICKER_DATA_GENERATED' };
  const before = await db.auditLog.count({ where: evidenceWhere });
  let release!: () => void, ready!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const locked = new Promise<void>((resolve) => {
    ready = resolve;
  });
  const holder = db.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT id FROM products WHERE id=${row.id} FOR UPDATE`;
      await tx.product.update({ where: { id: row.id }, data: { branchId: otherBranch } });
      ready();
      await gate;
    },
    { timeout: 10000 },
  );
  await locked;
  const pending = http('get', path, branchOnly).then((response) => response);
  let blocked = false;
  try {
    await waitForBlocked();
    blocked = true;
  } catch {
    // Keep the denied-output and evidence assertions observable on the RED path.
  } finally {
    release();
  }
  await holder;
  const response = await pending;
  const generatedDelta = (await db.auditLog.count({ where: evidenceWhere })) - before;
  expect({
    status: response.status,
    blocked,
    productId: response.body.productId,
    generatedDelta,
  }).toEqual({ status: 404, blocked: true, productId: undefined, generatedDelta: 0 });
  expect(response.text).not.toContain(serial);
  expect(response.text).not.toContain('Comma serial phone');
});
