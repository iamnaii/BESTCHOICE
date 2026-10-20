import { domainAccessExecution } from './access-execution-context';
import { json } from 'express';
import { AccessDocumentTemplateBoundaries } from './access-document-template-boundaries';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { Test } from '@nestjs/testing';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { ExecutionContext, INestApplication, ValidationPipe, Logger } from '@nestjs/common';
import request from 'supertest';
import { PermissionKey } from '@installment/shared';
import { AuditInterceptor } from '../audit/audit.interceptor';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AccessSnapshotService } from './access-snapshot.service';
import { AccessResourceService } from './access-resource.service';
import { AccessPolicyService } from './access-policy';
import { AccessPolicyInterceptor } from './access-policy.interceptor';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { DocumentsController } from '../contracts/documents.controller';
import { ContractDocumentsService } from '../contracts/contract-documents.service';
import { DocumentsService } from '../contracts/documents.service';
import { ContractTemplateService } from '../contracts/services/contract-template.service';
import { StorageService } from '../storage/storage.service';
import { NotificationsService } from '../notifications/notifications.service';
import { SettingsService } from '../settings/settings.service';
import { OcrService } from '../ocr/ocr.service';
import { IntegrationConfigService } from '../integrations/integration-config.service';
import { AiUsageService } from '../ai-usage/ai-usage.service';
import { AiClient, AiProviderService } from '../ai-usage/ai-provider.service';

const url = process.env.EMPLOYEE_ACCESS_TEST_DATABASE_URL;
if (
  !url?.includes('/bc_access_task2?host=/tmp/bc-access-templates.') ||
  process.env.DATABASE_URL !== url ||
  process.env.DATABASE_URL_FINANCE !== url
)
  throw new Error('Both database URLs must use owned isolated templates PostgreSQL');
const db = new PrismaClient({ datasources: { db: { url } } });
const marker = randomUUID();
const snapshots = new AccessSnapshotService(db as PrismaService);
const auditPromises = new Set<Promise<unknown>>();
const loggerErrors = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
const transport = jest.fn(async () => ({
  content: [{ type: 'text', text: '<p>PRIVATE_DRAFT {customer_name}</p>' }],
  usage: { input_tokens: 12, output_tokens: 8 },
}));
const telemetry = { record: jest.fn(async () => undefined) };
const provider = new AiProviderService(telemetry as unknown as AiUsageService);
jest
  .spyOn(provider, 'clientFor')
  .mockImplementation(() => ({ messages: { create: transport } }) as unknown as AiClient);
const complete = jest.spyOn(provider, 'complete');
const config = { getValue: jest.fn(async () => 'controlled-no-credential') };

let app: INestApplication, owner: string, reader: string, denied: string;
let stale: Awaited<ReturnType<AccessSnapshotService['forUser']>> | undefined;
const payload = () => ({
  name: 'PRIVATE_NAME',
  contentHtml: '<p>PRIVATE_HTML {customer_name}</p>',
  type: 'STORE_DIRECT',
  blocks: [{ id: 'editor-block', type: 'text', content: 'PRIVATE_BLOCK' }],
  settings: { pageSize: 'A4', header: 'PRIVATE_SETTING' },
});
async function user(role: 'OWNER' | 'ACCOUNTANT' = 'ACCOUNTANT') {
  return (
    await db.user.create({
      data: {
        name: 'Owned templates test',
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
  permissions: PermissionKey[] = ['contract-templates.read'],
  companyCode = 'SHOP',
  branches?: string[],
) {
  const position = await db.accessPosition.create({
    data: {
      code: randomUUID(),
      name: 'Owned template position',
      permissions,
    },
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
function http(method: 'get' | 'post' | 'patch' | 'delete', path: string, actor = owner) {
  const agent = request(app.getHttpServer());
  return agent[method](path).set('x-test-user', actor).expect('x-owned-template-app', marker);
}
const routes = [
  ['get', 'all'],
  ['get', 'one'],
  ['post', 'create'],
  ['patch', 'update'],
  ['delete', 'delete'],
  ['post', 'ocr'],
] as const;
async function routeCase(kind: string) {
  const row = await db.contractTemplate.create({ data: payload() });
  return {
    row,
    path:
      (kind === 'all' || kind === 'create'
        ? '/contract-templates'
        : kind === 'ocr'
          ? '/contract-templates/generate-from-file'
          : `/contract-templates/${row.id}`) + '?company=SHOP',
    body:
      kind === 'create'
        ? payload()
        : kind === 'update'
          ? { name: 'UPDATED_PRIVATE' }
          : kind === 'ocr'
            ? { fileBase64: 'data:image/png;base64,iVBORw0KGgo=' }
            : undefined,
  };
}
beforeAll(async () => {
  [owner, reader, denied] = await Promise.all([user('OWNER'), user(), user()]);
  await grant(reader);
  const module = await Test.createTestingModule({
    controllers: [DocumentsController],
    providers: [
      AccessDocumentTemplateBoundaries,
      DocumentsService,
      OcrService,
      AccessResourceService,
      AccessPolicyService,
      AuditService,
      { provide: ContractDocumentsService, useValue: {} },
      { provide: PrismaService, useValue: db },
      { provide: AccessSnapshotService, useValue: snapshots },
      { provide: StorageService, useValue: {} },
      { provide: NotificationsService, useValue: {} },
      { provide: SettingsService, useValue: {} },
      { provide: IntegrationConfigService, useValue: config },
      { provide: AiProviderService, useValue: provider },
      { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
      { provide: APP_INTERCEPTOR, useClass: AccessPolicyInterceptor },
    ],
  })
    .overrideGuard(JwtAuthGuard)
    .useValue({
      canActivate: async (context: ExecutionContext) => {
        const req = context.switchToHttp().getRequest(),
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
  app = module.createNestApplication({ bodyParser: false });
  app.use(json({ limit: '20mb' }));
  app.use((_req: unknown, res: { setHeader: (k: string, v: string) => void }, next: () => void) => {
    res.setHeader('x-owned-template-app', marker);
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
    'OWNED_TEMPLATE_HTTP',
    marker,
    app.getHttpServer().address(),
    'production controller/interceptors/resource/snapshot; synthetic identity; controlled provider',
  );
}, 60000);
afterAll(async () => {
  await app?.close();
  await Promise.allSettled([...auditPromises]);
  await db.$disconnect();
});
describe('exact six global template HTTP methods', () => {
  it.each(routes)('%s %s usable current allowed output', async (method, kind) => {
    const { row, path, body } = await routeCase(kind);
    const res = await http(method, path, method === 'get' ? reader : owner)
      .send(body)
      .expect(method === 'post' ? 201 : 200);
    if (kind === 'all' || kind === 'one') {
      const value =
        kind === 'all' ? res.body.data.find((v: { id: string }) => v.id === row.id) : res.body;
      expect(value).toEqual({ id: row.id, type: 'STORE_DIRECT', isActive: true });
    } else if (kind === 'ocr') {
      expect(res.body).toEqual({
        contentHtml: '<p>PRIVATE_DRAFT {customer_name}</p>',
        placeholders: ['{customer_name}'],
      });
    } else {
      expect(res.body).toMatchObject({
        id: kind === 'create' ? expect.any(String) : row.id,
        contentHtml: payload().contentHtml,
        blocks: payload().blocks,
        settings: payload().settings,
      });
      expect(
        await db.auditLog.count({
          where: {
            userId: owner,
            entityId: res.body.id,
            action: 'CONTRACT_TEMPLATE_CHANGED',
          },
        }),
      ).toBe(1);
    }
  });
  it.each(routes)('%s %s no-grants denies before effects', async (method, kind) => {
    const { path, body } = await routeCase(kind);
    const before = complete.mock.calls.length;
    await http(method, path, denied).send(body).expect(403);
    expect(complete.mock.calls.length).toBe(before);
  });
  it.each(routes)('%s %s stale owner is not current authority', async (method, kind) => {
    const actor = await user('OWNER');
    stale = await snapshots.forUser(actor);
    await db.user.update({ where: { id: actor }, data: { role: 'ACCOUNTANT' } });
    try {
      const { path, body } = await routeCase(kind);
      await http(method, path, actor).send(body).expect(403);
    } finally {
      stale = undefined;
    }
  });
});

it.each(['all', 'one'])(
  'current owner %s retains a full useful private editor response',
  async (kind) => {
    const { row, path } = await routeCase(kind);
    const res = await http('get', path).expect(200);
    const value =
      kind === 'all' ? res.body.data.find((v: { id: string }) => v.id === row.id) : res.body;
    expect(value).toMatchObject({ ...payload(), id: row.id });
  },
);

async function waitBlocked() {
  const start = Date.now();
  while (Date.now() - start < 3000) {
    const rows = await db.$queryRaw<Array<{ count: bigint }>>`
      SELECT count(*) FROM pg_stat_activity
      WHERE datname=current_database() AND wait_event_type='Lock'`;
    if (Number(rows[0].count) > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('owned HTTP did not wait on PostgreSQL lock');
}

it.each(routes)('%s %s owner revoked while actual authority row is held', async (method, kind) => {
  const actor = await user('OWNER'),
    { path, body } = await routeCase(kind);
  stale = await snapshots.forUser(actor);
  let release!: () => void, ready!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const locked = new Promise<void>((resolve) => (ready = resolve));
  const holder = db.$transaction(
    async (tx) => {
      await tx.user.update({ where: { id: actor }, data: { role: 'ACCOUNTANT' } });
      ready();
      await gate;
    },
    { timeout: 10000 },
  );
  await locked;
  const before = complete.mock.calls.length;
  const pending = http(method, path, actor)
    .send(body)
    .then((response) => response);
  let blocked = false;
  try {
    await waitBlocked();
    blocked = true;
  } catch {
    // Retain a behavioral assertion when a missing boundary returns early.
  } finally {
    release();
  }
  try {
    await holder;
    expect({ status: (await pending).status, blocked }).toEqual({ status: 403, blocked: true });
    expect(complete.mock.calls.length).toBe(before);
  } finally {
    stale = undefined;
  }
});

it.each(routes)('%s %s requires live selected company and valid filters', async (method, kind) => {
  const { path, body } = await routeCase(kind);
  await http(method, path + '&unknown=PRIVATE_QUERY')
    .send(body)
    .expect(400);
  await http(method, path.replace('SHOP', 'invalid')).send(body).expect(403);
  const shop = await db.companyInfo.findUniqueOrThrow({ where: { companyCode: 'SHOP' } });
  await db.companyInfo.update({ where: { id: shop.id }, data: { isActive: false } });
  try {
    await http(method, path).send(body).expect(403);
  } finally {
    await db.companyInfo.update({ where: { id: shop.id }, data: { isActive: true } });
  }
});

it.each(['all', 'one'])(
  '%s uses original live company/branch tuple and current position',
  async (kind) => {
    const { path } = await routeCase(kind);
    const shop = await db.companyInfo.findUniqueOrThrow({ where: { companyCode: 'SHOP' } });
    const branch = await db.branch.create({
      data: { name: 'Owned template branch', companyId: shop.id },
    });
    const actor = await user(),
      assignment = await grant(actor, ['contract-templates.read'], 'SHOP', [branch.id]);
    await http('get', path, actor).expect(200);
    await http('get', path.replace('SHOP', 'FINANCE'), actor).expect(403);
    stale = await snapshots.forUser(actor);
    await db.branch.update({ where: { id: branch.id }, data: { isActive: false } });
    try {
      await http('get', path, actor).expect(403);
    } finally {
      stale = undefined;
    }
    await db.branch.update({ where: { id: branch.id }, data: { isActive: true } });
    stale = await snapshots.forUser(actor);
    await db.accessPosition.update({
      where: { id: assignment.positionId },
      data: { permissions: [] },
    });
    try {
      await http('get', path, actor).expect(403);
    } finally {
      stale = undefined;
    }
    const asymmetric = await user(),
      a = await grant(asymmetric);
    await db.employeeAccessAssignment.update({ where: { id: a.id }, data: { scope: 'ASSIGNED' } });
    await grant(asymmetric, ['products.read'], 'SHOP', [branch.id]);
    await grant(asymmetric, ['contract-templates.read'], 'FINANCE', [branch.id]);
    await http('get', path, asymmetric).expect(403);
    await http('get', path.replace('SHOP', 'FINANCE'), asymmetric).expect(200);
  },
);

it.each(routes.filter(([method]) => method !== 'get'))(
  '%s %s reserved mutation rejects every grant forgery',
  async (method, kind) => {
    const actor = await user();
    await grant(actor, [
      'contract-templates.create',
      'contract-templates.update',
      'contract-templates.delete',
      'settings.documents.manage',
    ]);
    const { path, body } = await routeCase(kind);
    const before = complete.mock.calls.length;
    await http(method, path, actor).send(body).expect(403);
    expect(complete.mock.calls.length).toBe(before);
  },
);

async function failAudit(action: string, work: () => Promise<void>) {
  const name = 'template_audit_' + randomUUID().replaceAll('-', '');
  await db.$executeRawUnsafe(
    `CREATE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='${action}' THEN RAISE EXCEPTION 'PRIVATE_REQUIRED_AUDIT'; END IF; RETURN NEW; END $$`,
  );
  await db.$executeRawUnsafe(
    `CREATE TRIGGER ${name} BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION ${name}()`,
  );
  try {
    await work();
  } finally {
    await db.$executeRawUnsafe(`DROP TRIGGER ${name} ON audit_logs`);
    await db.$executeRawUnsafe(`DROP FUNCTION ${name}()`);
  }
}

it.each(routes)(
  '%s %s required evidence failure suppresses output and rolls back mutations',
  async (method, kind) => {
    const { row, path, body } = await routeCase(kind);
    const count = await db.contractTemplate.count(),
      before = complete.mock.calls.length;
    await failAudit(
      kind === 'ocr'
        ? 'CONTRACT_TEMPLATE_OCR_ADMITTED'
        : method === 'get'
          ? 'CONTRACT_TEMPLATE_READ'
          : 'CONTRACT_TEMPLATE_CHANGED',
      async () => {
        const res = await http(method, path).send(body).expect(500);
        expect(res.text).not.toMatch(/PRIVATE|contentHtml|blocks|settings/);
        expect(await db.contractTemplate.count()).toBe(count);
        expect(
          await db.contractTemplate.findUniqueOrThrow({ where: { id: row.id } }),
        ).toMatchObject({
          name: row.name,
          isActive: true,
        });
        expect(complete.mock.calls.length).toBe(before);
      },
    );
  },
);

it('OCR completion evidence failure suppresses draft without pretending submission rolled back', async () => {
  const { path, body } = await routeCase('ocr'),
    before = complete.mock.calls.length;
  const admitted = await db.auditLog.count({ where: { action: 'CONTRACT_TEMPLATE_OCR_ADMITTED' } });
  await failAudit('CONTRACT_TEMPLATE_OCR_COMPLETED', async () => {
    const res = await http('post', path).send(body).expect(500);
    expect(res.text).not.toContain('PRIVATE_DRAFT');
  });
  expect(complete.mock.calls.length).toBe(before + 1);
  expect(await db.auditLog.count({ where: { action: 'CONTRACT_TEMPLATE_OCR_ADMITTED' } })).toBe(
    admitted + 1,
  );
});

it('deactivation hides ordinary lookup, owner detail reopens, deleted rows cannot be edited', async () => {
  const { row, path } = await routeCase('one');
  await http('delete', path).expect(200);
  await http('get', path, reader).expect(404);
  expect((await http('get', path).expect(200)).body.isActive).toBe(false);
  await http('patch', path).send({ isActive: true }).expect(200);
  await http('get', path, reader).expect(200);
  await db.contractTemplate.update({ where: { id: row.id }, data: { deletedAt: new Date() } });
  for (const method of ['get', 'patch', 'delete'] as const)
    await http(method, path)
      .send(method === 'patch' ? { name: 'no' } : undefined)
      .expect(404);
});

it('ordinary output and filtering cannot reveal arbitrary historical types or private names', async () => {
  const row = await db.contractTemplate.create({ data: { ...payload(), type: 'PRIVATE_TYPE' } });
  expect(
    (await http('get', `/contract-templates/${row.id}?company=SHOP`, reader).expect(200)).body,
  ).toEqual({ id: row.id, type: null, isActive: true });
  await http('get', '/contract-templates?company=SHOP&type=PRIVATE_TYPE', reader).expect(400);
  await http('get', '/contract-templates?company=SHOP&type=PRIVATE_TYPE').expect(200);
});

it('invalid template input is rejected safely while complex owner editor JSON remains lossless', async () => {
  const { row, path } = await routeCase('one');
  for (const body of [
    { name: '' },
    { name: 'x'.repeat(257) },
    { contentHtml: 'x'.repeat(1048577) },
    { placeholders: [4] },
    { blocks: {} },
    { settings: [] },
    { blocks: Array.from({ length: 2001 }, () => ({})) },
  ])
    await http('patch', path).send(body).expect(400);
  const editor = {
    blocks: [{ id: 'block-1', nested: [{ text: 'ภาษาไทย', custom: true }] }],
    settings: { margin: { top: 20 }, fonts: ['Sarabun'], custom: null },
  };
  expect((await http('patch', path).send(editor).expect(200)).body).toMatchObject(editor);
  expect(await db.contractTemplate.findUniqueOrThrow({ where: { id: row.id } })).toMatchObject(
    editor,
  );
  for (const query of ['page=-1', 'page=2x', 'limit=101', 'type[]=bad'])
    await http('get', '/contract-templates?company=SHOP&' + query).expect(400);
  await http('get', '/contract-templates/not-uuid?company=SHOP').expect(400);
});

it('historical aggregate size is probed before owner payload materialization', async () => {
  const row = await db.contractTemplate.create({
    data: { ...payload(), type: 'HUGE_PRIVATE', contentHtml: 'x'.repeat(16 * 1024 * 1024) },
  });
  try {
    await http('get', `/contract-templates/${row.id}?company=SHOP`).expect(400);
    await http('get', '/contract-templates?company=SHOP&type=HUGE_PRIVATE').expect(400);
    expect(
      (await http('get', `/contract-templates/${row.id}?company=SHOP`, reader).expect(200)).body,
    ).toEqual({ id: row.id, type: null, isActive: true });
  } finally {
    await db.contractTemplate.update({ where: { id: row.id }, data: { deletedAt: new Date() } });
  }
});

it('legacy reader is finite, current legacy owner is full, and newly managed never falls back', async () => {
  const actor = await user();
  await db.user.update({ where: { id: actor }, data: { accessManaged: false } });
  const { row, path } = await routeCase('one');
  expect((await http('get', path, actor).expect(200)).body).toEqual({
    id: row.id,
    type: 'STORE_DIRECT',
    isActive: true,
  });
  await db.user.update({ where: { id: actor }, data: { role: 'OWNER' } });
  expect((await http('get', path, actor).expect(200)).body).toMatchObject(payload());
  stale = await snapshots.forUser(actor);
  await db.user.update({ where: { id: actor }, data: { accessManaged: true, role: 'ACCOUNTANT' } });
  try {
    await http('get', path, actor).expect(403);
  } finally {
    stale = undefined;
  }
});

it('actual OCR provider receives exact input/current actor and zero SDK retries, persists no template', async () => {
  const { path, body } = await routeCase('ocr'),
    count = await db.contractTemplate.count();
  const before = transport.mock.calls.length;
  await http('post', path).send(body).expect(201);
  expect(transport.mock.calls.length).toBe(before + 1);
  const [input, options] = transport.mock.calls.at(-1)! as unknown as [
    Record<string, unknown>,
    Record<string, unknown>,
  ];
  expect(input).toMatchObject({
    max_tokens: 8192,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: 'image/png', data: 'iVBORw0KGgo=' },
          },
          expect.objectContaining({ type: 'text' }),
        ],
      },
    ],
  });
  expect(options).toMatchObject({ maxRetries: 0, timeout: 20000, signal: expect.any(AbortSignal) });
  expect(telemetry.record).toHaveBeenLastCalledWith(
    expect.objectContaining({ userId: owner, status: 'success', method: 'generateTemplateHtml' }),
  );
  expect(await db.contractTemplate.count()).toBe(count);
});

it.each([
  'bad',
  'data:application/pdf;base64,' + Buffer.from('%PDF- /Encrypt').toString('base64'),
  'data:image/png;base64,' + Buffer.alloc(10 * 1024 * 1024 + 1).toString('base64'),
])('invalid OCR rejects before acquisition or submission', async (fileBase64) => {
  const before = config.getValue.mock.calls.length,
    submitted = transport.mock.calls.length;
  await http('post', '/contract-templates/generate-from-file?company=SHOP')
    .send({ fileBase64 })
    .expect(400);
  expect(config.getValue.mock.calls.length).toBe(before);
  expect(transport.mock.calls.length).toBe(submitted);
});

it.each([
  'PRIVATE_PROVIDER',
  'timeout PRIVATE_PROVIDER',
  '401 PRIVATE_PROVIDER',
  '429 PRIVATE_PROVIDER',
])('provider failure %s is safe and not retried', async (message) => {
  transport.mockRejectedValueOnce(new Error(message));
  const before = transport.mock.calls.length,
    { path, body } = await routeCase('ocr');
  const res = await http('post', path).send(body).expect(500);
  expect(res.text).not.toContain('PRIVATE_PROVIDER');
  expect(transport.mock.calls.length).toBe(before + 1);
});

it.each(['', 'x'.repeat(1048577)])('invalid provider output is rejected', async (text) => {
  transport.mockResolvedValueOnce({
    content: [{ type: 'text', text }],
    usage: { input_tokens: 1, output_tokens: 1 },
  });
  const { path, body } = await routeCase('ocr');
  await http('post', path).send(body).expect(500);
});

it('owner revoked during acquisition cannot submit and revoked during provider cannot receive draft', async () => {
  for (const phase of ['acquisition', 'provider']) {
    const actor = await user('OWNER'),
      { path, body } = await routeCase('ocr');
    if (phase === 'acquisition')
      config.getValue.mockImplementationOnce(async () => {
        await db.user.update({ where: { id: actor }, data: { role: 'ACCOUNTANT' } });
        return 'controlled';
      });
    else
      transport.mockImplementationOnce(async () => {
        await db.user.update({ where: { id: actor }, data: { role: 'ACCOUNTANT' } });
        return {
          content: [{ type: 'text', text: 'PRIVATE_DRAFT' }],
          usage: { input_tokens: 1, output_tokens: 1 },
        };
      });
    const before = transport.mock.calls.length;
    const res = await http('post', path, actor).send(body).expect(403);
    expect(res.text).not.toContain('PRIVATE_DRAFT');
    expect(transport.mock.calls.length).toBe(before + (phase === 'provider' ? 1 : 0));
  }
});

it('acquisition deadline prevents a late client resolution from ever submitting', async () => {
  let resolve!: (value: string) => void;
  config.getValue.mockImplementationOnce(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  const before = transport.mock.calls.length,
    { path, body } = await routeCase('ocr');
  await http('post', path).send(body).expect(500);
  resolve('late-controlled');
  await new Promise((r) => setTimeout(r, 50));
  expect(transport.mock.calls.length).toBe(before);
}, 10000);

it('telemetry timeout is bounded and cannot duplicate successful generation', async () => {
  telemetry.record.mockImplementationOnce(() => new Promise(() => undefined));
  const before = transport.mock.calls.length,
    { path, body } = await routeCase('ocr');
  await http('post', path).send(body).expect(201);
  expect(transport.mock.calls.length).toBe(before + 1);
});

it('all outer and required audit metadata exclude arbitrary private payloads and diagnostics', async () => {
  await Promise.allSettled([...auditPromises]);
  const logs = await db.auditLog.findMany();
  const serialized = JSON.stringify(logs, (_key, value) =>
    typeof value === 'bigint' ? value.toString() : value,
  );
  expect(JSON.stringify(loggerErrors.mock.calls)).not.toMatch(/PRIVATE_|iVBORw0KGgo/);
  expect(serialized).not.toMatch(
    /PRIVATE_|controlled-no-credential|iVBORw0KGgo|contentHtml|fileBase64|PRIVATE_QUERY/,
  );
});

it.each(['one', 'update', 'delete'])('held template row is reloaded before %s', async (kind) => {
  const { row, path, body } = await routeCase(kind);
  let release!: () => void, ready!: () => void;
  const gate = new Promise<void>((r) => {
      release = r;
    }),
    locked = new Promise<void>((r) => {
      ready = r;
    });
  const holder = db.$transaction(
    async (tx) => {
      await tx.contractTemplate.update({ where: { id: row.id }, data: { deletedAt: new Date() } });
      ready();
      await gate;
    },
    { timeout: 10000 },
  );
  await locked;
  const pending = http(kind === 'one' ? 'get' : kind === 'update' ? 'patch' : 'delete', path)
    .send(body)
    .then((r) => r);
  try {
    await waitBlocked();
  } finally {
    release();
  }
  await holder;
  expect((await pending).status).toBe(404);
  expect(
    await db.auditLog.count({ where: { entityId: row.id, action: 'CONTRACT_TEMPLATE_CHANGED' } }),
  ).toBe(0);
});

it('list waiting on an actual template row does not return a now-deactivated row', async () => {
  const row = await db.contractTemplate.create({ data: { ...payload(), type: 'WAIT_PRIVATE' } });
  let release!: () => void, ready!: () => void;
  const gate = new Promise<void>((r) => {
      release = r;
    }),
    locked = new Promise<void>((r) => {
      ready = r;
    });
  const holder = db.$transaction(
    async (tx) => {
      await tx.contractTemplate.update({ where: { id: row.id }, data: { isActive: false } });
      ready();
      await gate;
    },
    { timeout: 10000 },
  );
  await locked;
  const pending = http('get', '/contract-templates?company=SHOP&type=WAIT_PRIVATE').then((r) => r);
  try {
    await waitBlocked();
  } finally {
    release();
  }
  await holder;
  const res = await pending;
  expect(res.status).toBe(200);
  expect(res.body).toMatchObject({ data: [], total: 0 });
});

it.each(routes)(
  '%s %s rejects current inactive actor despite cached owner',
  async (method, kind) => {
    const actor = await user('OWNER'),
      { path, body } = await routeCase(kind);
    stale = await snapshots.forUser(actor);
    await db.user.update({ where: { id: actor }, data: { isActive: false } });
    try {
      await http(method, path, actor).send(body).expect(403);
    } finally {
      stale = undefined;
    }
  },
);

it('provider deadline aborts transport and cannot return a late draft or trigger another submission', async () => {
  let resolve!: (value: {
    content: { type: string; text: string }[];
    usage: { input_tokens: number; output_tokens: number };
  }) => void;
  transport.mockImplementationOnce(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  const { path, body } = await routeCase('ocr'),
    before = transport.mock.calls.length;
  await http('post', path).send(body).expect(500);
  const options = (
    transport.mock.calls.at(-1)! as unknown as [unknown, { signal: AbortSignal }]
  )[1];
  expect(options.signal.aborted).toBe(true);
  resolve({
    content: [{ type: 'text', text: 'PRIVATE_LATE_DRAFT' }],
    usage: { input_tokens: 1, output_tokens: 1 },
  });
  await new Promise((r) => setTimeout(r, 20));
  expect(transport.mock.calls.length).toBe(before + 1);
}, 25000);

it('shared generation rejects an actorless or unadmitted direct caller before provider access', async () => {
  const before = transport.mock.calls.length;
  await expect(
    app.get(OcrService).generateTemplateHtml('data:image/png;base64,iVBORw0KGgo='),
  ).rejects.toThrow('ไม่มีสิทธิ์');
  await expect(
    app.get(OcrService).generateTemplateHtml('data:image/png;base64,iVBORw0KGgo=', owner),
  ).rejects.toThrow('ไม่มีสิทธิ์');
  expect(transport.mock.calls.length).toBe(before);
});

it('internal rendering preserves full explicit selection and updatedAt resolution without invented tie priority', async () => {
  const service = new ContractTemplateService(db as PrismaService),
    type = randomUUID();
  const first = await db.contractTemplate.create({
    data: { ...payload(), type, updatedAt: new Date('2000-01-01') },
  });
  const second = await db.contractTemplate.create({
    data: { ...payload(), type, contentHtml: '<p>latest</p>', updatedAt: new Date('2001-01-01') },
  });
  expect(await service.resolveTemplate(type, 'RECEIPT')).toEqual({
    html: '<p>latest</p>',
    settings: second.settings,
  });
  await db.contractTemplate.update({ where: { id: second.id }, data: { isActive: false } });
  expect((await service.findOneTemplate(second.id)).contentHtml).toBe('<p>latest</p>');
  expect(await service.resolveTemplate(type, 'RECEIPT')).toEqual({
    html: first.contentHtml,
    settings: first.settings,
  });
  await db.contractTemplate.update({ where: { id: first.id }, data: { deletedAt: new Date() } });
  expect(await service.resolveTemplate(type, 'RECEIPT')).toEqual({
    html: '<div>{contract_number}</div>',
    settings: null,
  });
});

it('a serializable authority retry cannot duplicate OCR admission or provider submission', async () => {
  const actor = await user('OWNER'),
    { path, body } = await routeCase('ocr');
  let release!: () => void, ready!: () => void;
  const gate = new Promise<void>((r) => {
      release = r;
    }),
    locked = new Promise<void>((r) => {
      ready = r;
    });
  const holder = db.$transaction(
    async (tx) => {
      await tx.user.update({ where: { id: actor }, data: { name: 'Changed owned actor' } });
      ready();
      await gate;
    },
    { timeout: 10000 },
  );
  await locked;
  const before = transport.mock.calls.length;
  const pending = http('post', path, actor)
    .send(body)
    .then((r) => r);
  try {
    await waitBlocked();
  } finally {
    release();
  }
  await holder;
  expect((await pending).status).toBe(201);
  expect(transport.mock.calls.length).toBe(before + 1);
  expect(
    await db.auditLog.count({ where: { userId: actor, action: 'CONTRACT_TEMPLATE_OCR_ADMITTED' } }),
  ).toBe(1);
  expect(
    await db.auditLog.count({
      where: { userId: actor, action: 'CONTRACT_TEMPLATE_OCR_COMPLETED' },
    }),
  ).toBe(1);
});

it('total deadline while admission waits on authority cannot later submit', async () => {
  const actor = await user('OWNER'),
    { path, body } = await routeCase('ocr');
  let release!: () => void, ready!: () => void;
  const gate = new Promise<void>((r) => {
      release = r;
    }),
    locked = new Promise<void>((r) => {
      ready = r;
    });
  let holder: Promise<unknown> | undefined;
  config.getValue.mockImplementationOnce(async () => {
    holder = db.$transaction(
      async (tx) => {
        await tx.user.update({ where: { id: actor }, data: { name: 'Delayed owned actor' } });
        ready();
        await gate;
      },
      { timeout: 40000 },
    );
    await locked;
    return 'controlled';
  });
  const before = transport.mock.calls.length;
  try {
    await http('post', path, actor).send(body).expect(500);
  } finally {
    release();
  }
  await holder;
  await new Promise((r) => setTimeout(r, 100));
  expect(transport.mock.calls.length).toBe(before);
  expect(
    await db.auditLog.count({ where: { userId: actor, action: 'CONTRACT_TEMPLATE_OCR_ADMITTED' } }),
  ).toBe(0);
}, 35000);

it('unrelated managed renderer context preserves the original injected-client visibility', async () => {
  const service = new ContractTemplateService(db as PrismaService),
    type = randomUUID();
  const snapshot = await snapshots.forUser(owner);
  await db.$transaction(async (tx) => {
    await tx.contractTemplate.create({ data: { ...payload(), type } });
    const result = await domainAccessExecution.run(
      {
        client: tx,
        snapshot,
        scopeReads: false,
        scope: { userId: owner, company: 'SHOP', permission: 'contracts.read', tuples: [] },
      },
      () => service.resolveTemplate(type, 'RECEIPT'),
    );
    expect(result).toEqual({ html: '<div>{contract_number}</div>', settings: null });
  });
});
