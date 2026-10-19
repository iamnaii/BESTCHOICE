import { AccessInterestReferenceBoundaries } from './access-interest-reference-boundaries';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { Test } from '@nestjs/testing';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { ExecutionContext, INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { PermissionKey, DEFAULT_ACCESS_POSITIONS } from '@installment/shared';
import { AuditInterceptor } from '../audit/audit.interceptor';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AccessSnapshotService } from './access-snapshot.service';
import { AccessResourceService } from './access-resource.service';
import { AccessPolicyService } from './access-policy';
import { AccessPolicyInterceptor } from './access-policy.interceptor';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { InterestConfigController } from '../interest-config/interest-config.controller';
import { InterestConfigService } from '../interest-config/interest-config.service';
import { ProductQuoteService } from '../staff-chat/services/product-quote.service';

const url = process.env.EMPLOYEE_ACCESS_TEST_DATABASE_URL;
if (
  !url?.includes('/bc_access_task2?host=/tmp/bc-access-interest.') ||
  process.env.DATABASE_URL !== url ||
  process.env.DATABASE_URL_FINANCE !== url
)
  throw new Error('Both database URLs must use owned isolated interest PostgreSQL');
const db = new PrismaClient({ datasources: { db: { url } } });
const marker = randomUUID();
const auditPromises = new Set<Promise<unknown>>();
const snapshots = new AccessSnapshotService(db as PrismaService);
const readKey = 'interest-configs.read' as PermissionKey;
let app: INestApplication,
  reader: string,
  denied: string,
  foreign: string,
  branchOnly: string,
  owner: string,
  branchId: string,
  otherBranch: string;
let stale: Awaited<ReturnType<AccessSnapshotService['forUser']>> | undefined;
const payload = () => ({
  name: 'Owned interest',
  productCategories: [randomUUID()],
  interestRate: 0.02,
  minDownPaymentPct: 0.15,
  storeCommissionPct: 0.1,
  vatPct: 0.07,
  minInstallmentMonths: 6,
  maxInstallmentMonths: 12,
});
async function config() {
  return db.interestConfig.create({ data: payload() });
}
async function user(role: 'ACCOUNTANT' | 'OWNER' = 'ACCOUNTANT') {
  return (
    await db.user.create({
      data: {
        name: 'Owned interest test',
        email: randomUUID() + '@test.invalid',
        password: 'unused',
        role,
        accessManaged: true,
      },
    })
  ).id;
}
async function grant(
  id: string,
  keys: PermissionKey[] = [readKey],
  companyCode = 'SHOP',
  branches?: string[],
) {
  const p = await db.accessPosition.create({
    data: { code: randomUUID(), name: 'Owned interest position', permissions: keys },
  });
  return db.employeeAccessAssignment.create({
    data: {
      userId: id,
      positionId: p.id,
      companyCode,
      scope: branches ? 'BRANCHES' : 'COMPANY',
      ...(branches ? { branches: { create: branches.map((branchId) => ({ branchId })) } } : {}),
    },
  });
}
function http(method: 'get' | 'post' | 'put' | 'delete', path: string, actor = reader) {
  const agent = request(app.getHttpServer());
  return agent[method](path).set('x-test-user', actor).expect('x-owned-interest-app', marker);
}
const routes = [
  ['get', 'all'],
  ['get', 'category'],
  ['get', 'resolved'],
  ['get', 'one'],
  ['post', 'create'],
  ['put', 'update'],
  ['delete', 'remove'],
] as const;
async function routeCase(kind: string) {
  const row = await config();
  const path =
    kind === 'all' || kind === 'create'
      ? '/interest-configs'
      : kind === 'category'
        ? `/interest-configs/by-category/${row.productCategories[0]}`
        : kind === 'resolved'
          ? `/interest-configs/resolved?category=${row.productCategories[0]}`
          : `/interest-configs/${row.id}`;
  return {
    row,
    path: path + (path.includes('?') ? '&' : '?') + 'company=SHOP',
    body: kind === 'create' ? payload() : kind === 'update' ? { interestRate: 0.03 } : undefined,
  };
}
beforeAll(async () => {
  const shop = await db.companyInfo.findUniqueOrThrow({ where: { companyCode: 'SHOP' } });
  branchId = (
    await db.branch.create({ data: { name: 'Owned interest branch', companyId: shop.id } })
  ).id;
  otherBranch = (
    await db.branch.create({ data: { name: 'Other interest branch', companyId: shop.id } })
  ).id;
  [reader, denied, foreign, branchOnly, owner] = await Promise.all([
    user(),
    user(),
    user(),
    user(),
    user('OWNER'),
  ]);
  await grant(reader);
  await grant(foreign, [readKey], 'FINANCE');
  await grant(branchOnly, [readKey], 'SHOP', [branchId]);
  const module = await Test.createTestingModule({
    controllers: [InterestConfigController],
    providers: [
      AccessInterestReferenceBoundaries,
      InterestConfigService,
      ProductQuoteService,
      AccessResourceService,
      AccessPolicyService,
      AuditService,
      { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
      { provide: PrismaService, useValue: db },
      { provide: AccessSnapshotService, useValue: snapshots },
      { provide: APP_INTERCEPTOR, useClass: AccessPolicyInterceptor },
    ],
  })
    .overrideGuard(JwtAuthGuard)
    .useValue({
      canActivate: async (ctx: ExecutionContext) => {
        const req = ctx.switchToHttp().getRequest(),
          id = req.headers['x-test-user'];
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
    res.setHeader('x-owned-interest-app', marker);
    next();
  });
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
  await app.listen(0, '127.0.0.1');
  const audit = app.get(AuditService),
    log = audit.log.bind(audit);
  audit.log = (...args: Parameters<AuditService['log']>) => {
    const p = log(...args);
    auditPromises.add(p);
    void p.finally(() => auditPromises.delete(p)).catch(() => undefined);
    return p;
  };
  console.log(
    'OWNED_INTEREST_HTTP',
    marker,
    app.getHttpServer().address(),
    'fixture-only PostgreSQL; both DB URLs isolated',
  );
}, 60000);
afterAll(async () => {
  await app?.close();
  await Promise.allSettled([...auditPromises]);
  await db.$disconnect();
});

describe('Exact seven current shared-interest routes', () => {
  it.each(routes)('%s %s useful authorized success', async (method, kind) => {
    const { row, path, body } = await routeCase(kind);
    const res = await http(method, path, method === 'get' ? reader : owner)
      .send(body)
      .expect(method === 'post' ? 201 : 200);
    if (method !== 'get') {
      expect(res.body).toEqual({ id: method === 'post' ? expect.any(String) : row.id });
      const stored = await db.interestConfig.findUniqueOrThrow({ where: { id: res.body.id } });
      if (kind === 'create') expect(stored.name).toBe('Owned interest');
      if (kind === 'update') expect(Number(stored.interestRate)).toBe(0.03);
      if (kind === 'remove') expect(stored.deletedAt).not.toBeNull();
      expect(
        await db.auditLog.count({
          where: {
            userId: owner,
            action: 'SHARED_REFERENCE_CHANGED',
            entity: 'interest_config',
            entityId: stored.id,
          },
        }),
      ).toBe(1);
    } else if (kind === 'resolved')
      expect(res.body).toMatchObject({ minDownPct: 0.15, commissionPct: 0.1, vatPct: 0.07 });
    else if (kind === 'all') expect(res.body.map((v: { id: string }) => v.id)).toContain(row.id);
    else expect(res.body.id).toBe(row.id);
  });
  it.each(routes)(
    '%s %s denies missing/foreign/configured nonowner write authority',
    async (method, kind) => {
      const { path, body } = await routeCase(kind);
      for (const actor of [denied, foreign, ...(method === 'get' ? [] : [reader])])
        await http(method, path, actor).send(body).expect(403);
    },
  );
  it.each(routes)('%s %s rechecks stale authority', async (method, kind) => {
    const actor = await user(method === 'get' ? 'ACCOUNTANT' : 'OWNER');
    const a = await grant(actor);
    stale = await snapshots.forUser(actor);
    if (method === 'get')
      await db.employeeAccessAssignment.update({
        where: { id: a.id },
        data: { deletedAt: new Date() },
      });
    else await db.user.update({ where: { id: actor }, data: { role: 'ACCOUNTANT' } });
    try {
      const { path, body } = await routeCase(kind);
      await http(method, path, actor).send(body).expect(403);
    } finally {
      stale = undefined;
    }
  });
});
it('permits live branch reference in either company, rejects ASSIGNED and asymmetric unrelated tuples', async () => {
  const row = await config();
  for (const actor of [branchOnly, foreign])
    await http(
      'get',
      `/interest-configs/${row.id}?company=${actor === foreign ? 'FINANCE' : 'SHOP'}`,
      actor,
    ).expect(200);
  const actor = await user(),
    a = await grant(actor);
  await db.employeeAccessAssignment.update({ where: { id: a.id }, data: { scope: 'ASSIGNED' } });
  await grant(actor, ['products.read'], 'SHOP', [branchId]);
  await http('get', `/interest-configs/${row.id}?company=SHOP`, actor).expect(403);
  await grant(actor, [readKey], 'FINANCE', [otherBranch]);
  await http('get', `/interest-configs/${row.id}?company=SHOP`, actor).expect(403);
  await http('get', `/interest-configs/${row.id}?company=FINANCE`, actor).expect(200);
});
it('checks branch/company liveness against a cached snapshot, including owner selected context', async () => {
  const actor = await user();
  await grant(actor, [readKey], 'SHOP', [branchId]);
  stale = await snapshots.forUser(actor);
  await db.branch.update({ where: { id: branchId }, data: { isActive: false } });
  try {
    await http('get', '/interest-configs?company=SHOP', actor).expect(403);
  } finally {
    stale = undefined;
    await db.branch.update({ where: { id: branchId }, data: { isActive: true } });
  }
  const finance = await db.companyInfo.findUniqueOrThrow({ where: { companyCode: 'FINANCE' } });
  await db.companyInfo.update({ where: { id: finance.id }, data: { isActive: false } });
  try {
    await http('get', '/interest-configs?company=FINANCE', owner).expect(403);
    await http('post', '/interest-configs?company=FINANCE', owner).send(payload()).expect(403);
  } finally {
    await db.companyInfo.update({ where: { id: finance.id }, data: { isActive: true } });
  }
});
it('preserves inactive/deleted/fallback semantics', async () => {
  const row = await config();
  await db.interestConfig.update({ where: { id: row.id }, data: { isActive: false } });
  await http('get', `/interest-configs/${row.id}?company=SHOP`).expect(200);
  expect(
    (
      await http(
        'get',
        `/interest-configs/by-category/${row.productCategories[0]}?company=SHOP`,
      ).expect(200)
    ).text,
  ).toBe('');
  expect(
    (
      await http(
        'get',
        `/interest-configs/resolved?company=SHOP&category=${row.productCategories[0]}`,
      ).expect(200)
    ).body,
  ).toEqual({
    minDownPct: 0.15,
    commissionPct: 0.1,
    vatPct: 0.07,
    ratePctByMonths: {},
    allowedMonths: [],
  });
  await db.interestConfig.update({ where: { id: row.id }, data: { deletedAt: new Date() } });
  for (const method of ['get', 'put', 'delete'] as const)
    await http(method, `/interest-configs/${row.id}?company=SHOP`, owner)
      .send(method === 'put' ? { name: 'no' } : undefined)
      .expect(404);
});
it('rejects inverted merged bounds and keeps valid numeric validation without arbitrary rate caps', async () => {
  const row = await config();
  for (const dto of [{ minInstallmentMonths: 13 }, { maxInstallmentMonths: 5 }])
    await http('put', `/interest-configs/${row.id}?company=SHOP`, owner).send(dto).expect(400);
  await http('post', '/interest-configs?company=SHOP', owner)
    .send({ ...payload(), minInstallmentMonths: 13 })
    .expect(400);
  await http('put', `/interest-configs/${row.id}?company=SHOP`, owner)
    .send({ interestRate: 1.01 })
    .expect(400);
  await http('put', `/interest-configs/${row.id}?company=SHOP`, owner)
    .send({ interestRate: 1, minInstallmentMonths: 1, maxInstallmentMonths: 1000 })
    .expect(200);
});
it.each(['create', 'update', 'remove'])(
  'required audit failure rolls back %s in actual transaction',
  async (kind) => {
    const { row, path, body } = await routeCase(kind);
    const name = 'interest_audit_' + randomUUID().replaceAll('-', '');
    await db.$executeRawUnsafe(
      `CREATE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='SHARED_REFERENCE_CHANGED' AND NEW.entity='interest_config' THEN RAISE EXCEPTION 'owned required audit failure'; END IF; RETURN NEW; END $$`,
    );
    await db.$executeRawUnsafe(
      `CREATE TRIGGER ${name} BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION ${name}()`,
    );
    const count = await db.interestConfig.count();
    try {
      await http(kind === 'create' ? 'post' : kind === 'update' ? 'put' : 'delete', path, owner)
        .send(body)
        .expect(500);
      expect(await db.interestConfig.count()).toBe(count);
      expect(await db.interestConfig.findUniqueOrThrow({ where: { id: row.id } })).toMatchObject({
        interestRate: row.interestRate,
        deletedAt: null,
      });
    } finally {
      await db.$executeRawUnsafe(`DROP TRIGGER ${name} ON audit_logs`);
      await db.$executeRawUnsafe(`DROP FUNCTION ${name}()`);
    }
  },
);
async function waitBlocked() {
  const start = Date.now();
  while (Date.now() - start < 3000) {
    const rows = await db.$queryRaw<
      Array<{ count: bigint }>
    >`SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock'`;
    if (Number(rows[0].count) > 0) return;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error('owned HTTP did not wait on PostgreSQL lock');
}
it.each(['create', 'update', 'remove'])(
  'owner revoked while waiting cannot %s or append success audit',
  async (kind) => {
    const actor = await user('OWNER'),
      row = await config();
    let release!: () => void, ready!: () => void;
    const gate = new Promise<void>((r) => (release = r)),
      locked = new Promise<void>((r) => (ready = r));
    const holder = db.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(718294630)`;
        await tx.user.update({ where: { id: actor }, data: { role: 'ACCOUNTANT' } });
        ready();
        await gate;
      },
      { timeout: 10000 },
    );
    await locked;
    const pending = http(
      kind === 'create' ? 'post' : kind === 'update' ? 'put' : 'delete',
      kind === 'create'
        ? '/interest-configs?company=SHOP'
        : `/interest-configs/${row.id}?company=SHOP`,
      actor,
    )
      .send(kind === 'create' ? payload() : kind === 'update' ? { interestRate: 0.99 } : undefined)
      .then((r) => r);
    let blocked = false;
    try {
      await waitBlocked();
      blocked = true;
    } catch {
      // Preserve the explicit blocked assertion if an unprotected implementation returns early.
    } finally {
      release();
    }
    await holder;
    const res = await pending;
    expect({ status: res.status, blocked }).toEqual({ status: 403, blocked: true });
    expect(
      Number((await db.interestConfig.findUniqueOrThrow({ where: { id: row.id } })).interestRate),
    ).toBe(0.02);
    expect(
      await db.auditLog.count({ where: { userId: actor, action: 'SHARED_REFERENCE_CHANGED' } }),
    ).toBe(0);
  },
);
it('adds only specified future position defaults', () => {
  expect(
    DEFAULT_ACCESS_POSITIONS.filter((p) => p.permissions.some((key) => key === (readKey as string)))
      .map((p) => p.code)
      .sort(),
  ).toEqual(['ACCOUNTANT', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'SALES', 'STOCK']);
});
it('equal-createdAt category/resolver/Product quote select canonical lower ID and retain exact money', async () => {
  const category = randomUUID(),
    date = new Date('2000-01-01');
  const high = await db.interestConfig.create({
    data: {
      ...payload(),
      id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
      productCategories: [category],
      createdAt: date,
      minInstallmentMonths: 6,
      maxInstallmentMonths: 6,
      interestRate: 0.09,
      minDownPaymentPct: 0.5,
    },
  });
  const low = await db.interestConfig.create({
    data: {
      ...payload(),
      id: '00000000-0000-4000-8000-000000000001',
      productCategories: [category],
      createdAt: date,
      minInstallmentMonths: 6,
      maxInstallmentMonths: 6,
      interestRate: 0.02,
      minDownPaymentPct: 0.15,
    },
  });
  expect((await app.get(InterestConfigService).findByCategory(category))?.id).toBe(low.id);
  const resolved = await app.get(InterestConfigService).resolveConfig(category);
  const quote = await app
    .get(ProductQuoteService)
    .getQuote({ category, cashPrice: 10000, installmentPrice: 10000 });
  expect({ resolved, quote }).toMatchObject({
    resolved: { minDownPct: 0.15, ratePctByMonths: { 6: 0.12 }, allowedMonths: [6] },
    quote: { months: 6, downAmount: 1500, monthlyPayment: 1849.31 },
  });
  await db.interestConfig.updateMany({
    where: { id: { in: [high.id, low.id] } },
    data: { deletedAt: new Date() },
  });
});
it('merged bounds use the committed configuration after a shared-writer wait', async () => {
  const row = await config();
  let release!: () => void, ready!: () => void;
  const gate = new Promise<void>((r) => (release = r)),
    locked = new Promise<void>((r) => (ready = r));
  const holder = db.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('shared-sticker-pricing-config'))`;
      await tx.interestConfig.update({ where: { id: row.id }, data: { maxInstallmentMonths: 8 } });
      ready();
      await gate;
    },
    { timeout: 10000 },
  );
  await locked;
  const pending = http('put', `/interest-configs/${row.id}?company=SHOP`, owner)
    .send({ minInstallmentMonths: 10 })
    .then((r) => r);
  try {
    await waitBlocked();
  } finally {
    release();
  }
  await holder;
  expect((await pending).status).toBe(400);
  expect(await db.interestConfig.findUniqueOrThrow({ where: { id: row.id } })).toMatchObject({
    minInstallmentMonths: 6,
    maxInstallmentMonths: 8,
  });
  expect(
    await db.auditLog.count({ where: { action: 'SHARED_REFERENCE_CHANGED', entityId: row.id } }),
  ).toBe(0);
});
it('legacy service uses the same writer and retains full configuration response', async () => {
  const service = app.get(InterestConfigService),
    row = await service.create(payload());
  expect(row).toHaveProperty('interestRate');
  expect(await service.update(row.id, { maxInstallmentMonths: 20 })).toMatchObject({
    id: row.id,
    maxInstallmentMonths: 20,
  });
  await expect(service.update(row.id, { minInstallmentMonths: 21 })).rejects.toThrow(
    'จำนวนงวดขั้นต่ำ',
  );
  expect(await service.remove(row.id)).toMatchObject({
    id: row.id,
    isActive: false,
    deletedAt: expect.any(Date),
  });
});
it('safe request metadata never captures caller definition text, values, URL or query', async () => {
  const data = {
    ...payload(),
    name: 'CALLER_INTEREST_SECRET',
    productCategories: ['PRIVATE_CATEGORY_SECRET'],
  };
  const res = await http('post', '/interest-configs?company=SHOP', owner).send(data).expect(201);
  await Promise.allSettled([...auditPromises]);
  const required = await db.auditLog.findFirstOrThrow({
    where: { action: 'SHARED_REFERENCE_CHANGED', entityId: res.body.id },
  });
  expect(required.newValue).toEqual({
    route: 'InterestConfigController.create',
    operation: 'create',
    company: 'SHOP',
    affectedCompanies: ['SHOP', 'FINANCE'],
  });
  const outer = await db.auditLog.findFirstOrThrow({
    where: { action: 'POST', entityId: res.body.id },
  });
  expect(outer.newValue).toMatchObject({
    route: 'InterestConfigController.create',
    outcome: 'SUCCESS',
    statusCode: 201,
  });
  const logs = JSON.stringify([required, outer], (_key, value) =>
    typeof value === 'bigint' ? value.toString() : value,
  );
  expect(logs).not.toMatch(
    /CALLER_INTEREST_SECRET|PRIVATE_CATEGORY_SECRET|interestRate|password|productCategories|company=SHOP/,
  );
  expect(outer.ipAddress).toBeNull();
  expect(outer.userAgent).toBeNull();
});
it('all four reads accept live branch tuples and reject ASSIGNED without borrowing unrelated company/permission scopes', async () => {
  const actor = await user(),
    a = await grant(actor, [readKey], 'SHOP', [otherBranch]);
  const assigned = await user(),
    b = await grant(assigned);
  await db.employeeAccessAssignment.update({ where: { id: b.id }, data: { scope: 'ASSIGNED' } });
  await grant(assigned, ['products.read'], 'SHOP', [otherBranch]);
  await grant(assigned, [readKey], 'FINANCE', [branchId]);
  for (const [method, kind] of routes.filter(([method]) => method === 'get')) {
    const { path } = await routeCase(kind);
    await http(method, path, actor).expect(200);
    await http(method, path, assigned).expect(403);
  }
  stale = await snapshots.forUser(actor);
  await db.accessPosition.update({ where: { id: a.positionId }, data: { permissions: [] } });
  try {
    for (const [method, kind] of routes.filter(([method]) => method === 'get')) {
      const { path } = await routeCase(kind);
      await http(method, path, actor).expect(403);
    }
  } finally {
    stale = undefined;
  }
});
it('direct resolved lookup retains stored live per-month rates rather than scalar synthesis', async () => {
  const row = await config();
  await db.interestConfigRate.createMany({
    data: [
      { configId: row.id, months: 12, ratePct: 0.37 },
      { configId: row.id, months: 6, ratePct: 0.18 },
      { configId: row.id, months: 9, ratePct: 0.25, deletedAt: new Date() },
    ],
  });
  const res = await http(
    'get',
    `/interest-configs/resolved?company=SHOP&category=${row.productCategories[0]}`,
  ).expect(200);
  expect(res.body).toMatchObject({
    allowedMonths: [6, 12],
    ratePctByMonths: { 6: 0.18, 12: 0.37 },
  });
  await http('get', '/interest-configs/resolved?company=SHOP').expect(400);
  await http('get', '/interest-configs?company=SHOP&unknown=SECRET').expect(400);
  await http('get', '/interest-configs/resolved?company=SHOP&category[]=SECRET').expect(400);
});
it('a forged saved owner-only grant never makes an ordinary employee a configuration owner', async () => {
  const actor = await user();
  await grant(actor, ['settings.finance.manage']);
  for (const [method, kind] of routes.filter(([method]) => method !== 'get')) {
    const { path, body } = await routeCase(kind);
    await http(method, path, actor).send(body).expect(403);
  }
});
