import { AccessContractFilesBoundaries } from './access-contract-files-boundaries';
import { AccessResourceService } from './access-resource.service';
import { AccessPartySourceService } from './access-party-source.service';
import { AccessProcurementSourceService } from './access-procurement-source.service';
import { AuditInterceptor } from '../audit/audit.interceptor';
import { AuditService } from '../audit/audit.service';
import { randomUUID, createHash } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { get as nodeGet } from 'node:http';
import { Request, Response } from 'express';
import { ExecutionContext, INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { APP_INTERCEPTOR, Reflector } from '@nestjs/core';
import { ExecutionContextHost } from '@nestjs/core/helpers/execution-context-host';
import request from 'supertest';
import { AccessSnapshot, PermissionKey } from '@installment/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AccessSnapshotService } from './access-snapshot.service';
import { AccessPolicyService } from './access-policy';
import { AccessPolicyInterceptor } from './access-policy.interceptor';
import { ContractDocumentsController } from '../contracts/contract-documents.controller';
import { ContractDocumentsService } from '../contracts/contract-documents.service';
import { ContractFileAccessGuard } from '../contracts/contract-file-access.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { StorageService } from '../storage/storage.service';

const url = process.env.EMPLOYEE_ACCESS_TEST_DATABASE_URL;
if (
  !url?.includes('/bc_access_contract_files?host=/tmp/bc-access-contract-files.') ||
  process.env.DATABASE_URL !== url ||
  process.env.DATABASE_URL_FINANCE !== url
)
  throw new Error('Both database URLs must identify owned contract-files cluster');
const db = new PrismaClient({ datasources: { db: { url } } });
const snapshots = new AccessSnapshotService(db as PrismaService);
const marker = randomUUID();
const stale = new Map<string, AccessSnapshot>();
const staleClaims = new Map<string, { role: string; branchId: string | null }>();
const auditPromises = new Set<Promise<unknown>>();
const disconnectedResponses = new Map<
  string,
  { response: Response; setHeader: jest.SpyInstance; end: jest.SpyInstance }
>();
const storage = {
  configured: true,
  getStream: jest.fn(async () => {
    throw new Error('PRIVATE_PROVIDER_KEY');
  }),
};
const pdf = Buffer.from('%PDF-1.4\n% Owned private document\n%%EOF');
const payload = {
  documentType: 'DEVICE_PHOTO',
  fileName: 'PRIVATE_FILENAME.pdf',
  fileUrl: `data:application/pdf;base64,${pdf.toString('base64')}`,
  notes: 'PRIVATE_NOTES',
};
const permissions: PermissionKey[] = [
  'contracts.read',
  'contracts.update',
  'customers.read',
  'contract-documents.read',
  'contract-documents.create',
  'contract-documents.update',
  'contract-documents.export',
  'sensitive.customer-identity.read',
  'sensitive.cost.read',
  'sensitive.profit.read',
  'sensitive.salary.read',
  'sensitive.seller-bank.read',
];
const routes = [
  'findByContract',
  'getDocumentChecklist',
  'getDocumentAuditTrail',
  'upload',
  'recordView',
  'content',
  'recordDownload',
  'remove',
] as const;
type Operation = (typeof routes)[number];
let app: INestApplication, owner: string, maker: string, denied: string, branch: string;
const realGuard = ContractFileAccessGuard.prototype.canActivate;
const guard = jest.spyOn(ContractFileAccessGuard.prototype, 'canActivate');
async function user(role: 'OWNER' | 'SALES' = 'SALES') {
  return (
    await db.user.create({
      data: {
        name: 'Owned contract files',
        email: randomUUID() + '@test.invalid',
        password: 'unused',
        role,
        accessManaged: true,
      },
    })
  ).id;
}
async function grant(id: string, allowed = permissions, companyCode = 'SHOP') {
  const position = await db.accessPosition.create({
    data: { code: randomUUID(), name: 'Owned files', permissions: allowed },
  });
  return db.employeeAccessAssignment.create({
    data: {
      userId: id,
      positionId: position.id,
      companyCode,
      scope: 'BRANCHES',
      branches: { create: { branchId: branch } },
    },
  });
}
async function fixture(actor = maker) {
  const customer = await db.customer.create({
    data: {
      name: 'PRIVATE_CUSTOMER',
      phone: '0800000000',
      nationalId: randomUUID(),
      accessCompanyCode: 'SHOP',
      accessBranchId: branch,
      birthDate: new Date('1990-01-01'),
    },
  });
  const product = await db.product.create({
    data: {
      name: 'PRIVATE_PRODUCT',
      brand: 'Test',
      model: 'Test',
      category: 'PHONE_NEW',
      costPrice: 6000,
      branchId: branch,
    },
  });
  const contract = await db.contract.create({
    data: {
      contractNumber: 'FILES-' + randomUUID(),
      customerId: customer.id,
      productId: product.id,
      branchId: branch,
      salespersonId: actor,
      planType: 'STORE_DIRECT',
      sellingPrice: 10000,
      downPayment: 2000,
      financedAmount: 8000,
      interestRate: 0,
      totalMonths: 8,
      interestTotal: 0,
      monthlyPayment: 1000,
      status: 'DRAFT',
    },
  });
  const document = await db.contractDocument.create({
    data: {
      contractId: contract.id,
      ...payload,
      documentType: 'DEVICE_PHOTO',
      uploadedById: actor,
      mimeType: 'application/pdf',
      fileSize: pdf.length,
      fileHash: createHash('sha256').update(pdf).digest('hex'),
    },
  });
  return { contract, document, customer };
}
function http(
  op: Operation,
  contract: string,
  doc: string,
  actor = maker,
  company = 'SHOP',
  body = payload,
) {
  const suffix = {
    findByContract: '',
    getDocumentChecklist: '/checklist',
    getDocumentAuditTrail: '/audit-trail',
    upload: '',
    recordView: `/${doc}/view`,
    content: `/${doc}/content`,
    recordDownload: `/${doc}/download`,
    remove: `/${doc}`,
  }[op];
  const method =
    op === 'remove'
      ? 'delete'
      : ['upload', 'recordView', 'recordDownload'].includes(op)
        ? 'post'
        : 'get';
  const agent = request(app.getHttpServer());
  return agent[method](`/contracts/${contract}/documents${suffix}?company=${company}`)
    .set('x-test-user', actor)
    .expect('x-owned-contract-files-app', marker)
    .send(op === 'upload' ? body : undefined);
}
beforeAll(async () => {
  const shop = await db.companyInfo.findUniqueOrThrow({ where: { companyCode: 'SHOP' } });
  branch = (await db.branch.create({ data: { name: 'Owned files SHOP', companyId: shop.id } })).id;
  [owner, maker, denied] = await Promise.all([user('OWNER'), user(), user()]);
  await grant(maker);
  const module = await Test.createTestingModule({
    controllers: [ContractDocumentsController],
    providers: [
      ContractDocumentsService,
      ContractFileAccessGuard,
      RolesGuard,
      AccessPolicyService,
      AccessContractFilesBoundaries,
      AccessResourceService,
      AccessPartySourceService,
      AccessProcurementSourceService,
      AuditService,
      { provide: AccessSnapshotService, useValue: snapshots },
      { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
      { provide: PrismaService, useValue: db },
      { provide: StorageService, useValue: storage },
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
          ...staleClaims.get(id),
          access: stale.get(id) ?? (await snapshots.forUser(id)),
        };
        await policies.authorize(context);
        return true;
      },
    })
    .compile();
  const policies = module.get(AccessPolicyService);
  app = module.createNestApplication({ logger: false });
  app.use((_req: Request, res: Response, next: () => void) => {
    res.setHeader('x-owned-contract-files-app', marker);
    const probe = _req.headers['x-owned-disconnect-probe'];
    if (typeof probe === 'string')
      disconnectedResponses.set(probe, {
        response: res,
        setHeader: jest.spyOn(res, 'setHeader'),
        end: jest.spyOn(res, 'end'),
      });
    next();
  });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.listen(0, '127.0.0.1');
  const audit = app.get(AuditService),
    log = audit.log.bind(audit);
  audit.log = (...args: Parameters<AuditService['log']>) => {
    const promise = log(...args);
    auditPromises.add(promise);
    void promise.finally(() => auditPromises.delete(promise)).catch(() => undefined);
    return promise;
  };
  await db.$executeRawUnsafe(
    'CREATE TABLE owned_file_audit_failures (contract_id text PRIMARY KEY)',
  );
  await db.$executeRawUnsafe(`CREATE FUNCTION owned_file_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF EXISTS (SELECT 1 FROM owned_file_audit_failures WHERE contract_id=NEW.contract_id) THEN
      RAISE EXCEPTION 'PRIVATE_AUDIT_FAILURE'; END IF;
      IF NEW.action='CONTENT_RELEASE_AUTHORIZED' THEN PERFORM pg_advisory_xact_lock(839251); END IF;
      RETURN NEW; END; $$`);
  await db.$executeRawUnsafe(`CREATE TRIGGER owned_file_audit_failure BEFORE INSERT ON document_audit_logs
    FOR EACH ROW EXECUTE FUNCTION owned_file_audit_failure()`);
  await db.$executeRawUnsafe(
    'CREATE TABLE owned_file_required_failures (entity_id text PRIMARY KEY)',
  );
  await db.$executeRawUnsafe(`CREATE FUNCTION owned_file_required_failure() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW.entity='contract_document' AND EXISTS (SELECT 1 FROM owned_file_required_failures WHERE entity_id=NEW.entity_id) THEN
      RAISE EXCEPTION 'PRIVATE_REQUIRED_AUDIT_FAILURE'; END IF; RETURN NEW; END; $$`);
  await db.$executeRawUnsafe(`CREATE TRIGGER owned_file_required_failure BEFORE INSERT ON audit_logs
    FOR EACH ROW EXECUTE FUNCTION owned_file_required_failure()`);
  console.log(
    'OWNED_CONTRACT_FILES_HTTP',
    marker,
    app.getHttpServer().address(),
    'production controller, RolesGuard, ContractFileAccessGuard, policy/interceptor; synthetic JWT identity; no provider',
  );
}, 60000);
afterAll(async () => {
  await app?.close();
  await Promise.allSettled([...auditPromises]);
  await db.$disconnect();
  guard.mockRestore();
});
describe('exact eight uploaded ContractDocument methods, real guard and owned PostgreSQL', () => {
  it.each([true, false])(
    'exact uploaded handler fails closed when its current boundary provider is absent (managed=%s)',
    async (managed) => {
      const { contract } = await fixture(owner);
      const fileGuard = new ContractFileAccessGuard(
        app.get(ContractDocumentsService),
        new Reflector(),
      );
      const context = new ExecutionContextHost(
        [
          {
            params: { contractId: contract.id },
            user: { id: owner, role: 'OWNER', access: { managed } },
          },
        ],
        ContractDocumentsController,
        ContractDocumentsController.prototype.findByContract,
      );
      await expect(fileGuard.canActivate(context)).rejects.toMatchObject({ status: 403 });
    },
  );
  it.each(routes)('%s useful authorized SHOP preparation', async (op) => {
    const { contract, document } = await fixture();
    const documentId =
      op === 'content'
        ? ((await http('upload', contract.id, document.id).expect(201)).body.id as string)
        : document.id;
    const before = guard.mock.calls.length;
    const response = await http(op, contract.id, documentId).expect(
      ['upload', 'recordView', 'recordDownload'].includes(op) ? 201 : 200,
    );
    expect(guard.mock.calls.length).toBeGreaterThan(before);
    if (op === 'content') expect(response.body).toEqual(pdf);
    if (op === 'upload') expect(response.body).toEqual({ id: expect.any(String), version: 2 });
    if (op === 'remove') expect(response.body).toEqual({ id: document.id, deleted: true });
  });
  it.each(routes)('%s no-grants is denied before effects', async (op) => {
    const { contract, document } = await fixture();
    const before = await db.documentAuditLog.count({ where: { contractId: contract.id } });
    await http(op, contract.id, document.id, denied).expect(403);
    expect(await db.documentAuditLog.count({ where: { contractId: contract.id } })).toBe(before);
    expect(
      (await db.contractDocument.findUniqueOrThrow({ where: { id: document.id } })).deletedAt,
    ).toBeNull();
  });
  it('structural metadata cannot return arbitrary private row fields', async () => {
    const { contract, document } = await fixture(owner);
    const response = await http('findByContract', contract.id, document.id, owner).expect(200);
    expect(response.body.data[0]).not.toHaveProperty('fileUrl');
    expect(JSON.stringify(response.body)).not.toContain('PRIVATE_');
  });
  it('genuine pre-interceptor guard rejects document-to-parent substitution', async () => {
    const a = await fixture(owner),
      b = await fixture(owner);
    const before = guard.mock.calls.length;
    await http('content', b.contract.id, a.document.id, owner).expect(404);
    expect(guard.mock.calls.length).toBeGreaterThan(before);
    expect(await db.documentAuditLog.count({ where: { contractId: b.contract.id } })).toBe(0);
  });
  it('historical arbitrary bytes cannot claim trusted immutable provenance', async () => {
    const { contract, document } = await fixture(owner);
    const response = await http('content', contract.id, document.id, owner).expect(403);
    expect(response.headers['content-disposition']).toBeUndefined();
    expect(response.body).not.toEqual(pdf);
  });
});

async function blockedBy(pid: number) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const [row] = await db.$queryRaw<Array<{ blocked: boolean }>>`SELECT EXISTS(
      SELECT 1 FROM pg_stat_activity WHERE ${pid}=ANY(pg_blocking_pids(pid))) AS blocked`;
    if (row.blocked) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Owned HTTP did not reach actual PostgreSQL lock');
}
describe('current waits and actual response commit boundary', () => {
  it('locks the actual prior latest row and observes its current immutable veto after waiting', async () => {
    const { contract, document } = await fixture();
    let release!: () => void, ready!: (pid: number) => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const admitted = new Promise<number>((resolve) => {
      ready = resolve;
    });
    const mutation = db.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM contract_documents WHERE id=${document.id} FOR UPDATE`;
        const [pid] = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`;
        ready(pid.pid);
        await gate;
        await tx.contractDocument.update({
          where: { id: document.id },
          data: { isImmutable: true },
        });
      },
      { timeout: 15000 },
    );
    const pid = await admitted;
    const response = http('upload', contract.id, document.id).then((value) => value);
    try {
      await blockedBy(pid);
      const waiting = await db.$queryRaw<
        Array<{ query: string }>
      >`SELECT query FROM pg_stat_activity WHERE ${pid}=ANY(pg_blocking_pids(pid))`;
      expect(
        waiting.some(
          (row) =>
            /^SELECT/i.test(row.query) &&
            /contract_documents/.test(row.query) &&
            /FOR UPDATE/.test(row.query),
        ),
      ).toBe(true);
    } finally {
      release();
    }
    await mutation;
    expect((await response).status).toBe(400);
    expect(await db.contractDocument.count({ where: { contractId: contract.id } })).toBe(1);
    expect(
      (await db.contractDocument.findUniqueOrThrow({ where: { id: document.id } })).isLatest,
    ).toBe(true);
    expect(await db.documentAuditLog.count({ where: { contractId: contract.id } })).toBe(0);
  }, 20000);
  it.each(routes)(
    '%s rechecks parent after a real source lock wait',
    async (op) => {
      const actor = await user();
      await grant(actor);
      const { contract, document } = await fixture(actor);
      const documentId =
        op === 'content'
          ? ((await http('upload', contract.id, document.id, actor).expect(201)).body.id as string)
          : document.id;
      const before = await db.documentAuditLog.count({ where: { contractId: contract.id } });
      const shop = await db.companyInfo.findUniqueOrThrow({ where: { companyCode: 'SHOP' } });
      const foreign = await db.branch.create({
        data: { name: 'Foreign source', companyId: shop.id },
      });
      let release!: () => void, ready!: (pid: number) => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const admitted = new Promise<number>((resolve) => {
        ready = resolve;
      });
      const mutation = db.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT id FROM contracts WHERE id=${contract.id} FOR UPDATE`;
          const [pid] = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`;
          ready(pid.pid);
          await gate;
          await tx.contract.update({ where: { id: contract.id }, data: { branchId: foreign.id } });
        },
        { timeout: 15000 },
      );
      const pid = await admitted;
      const response = http(op, contract.id, documentId, actor).then((value) => value);
      try {
        await blockedBy(pid);
      } finally {
        release();
      }
      await mutation;
      expect((await response).status).toBe(403);
      expect(await db.documentAuditLog.count({ where: { contractId: contract.id } })).toBe(before);
    },
    20000,
  );
  it.each(['actor', 'position'] as const)(
    'rechecks current %s after its real lock wait',
    async (kind) => {
      const actor = await user(),
        assignment = await grant(actor);
      const { contract, document } = await fixture(actor);
      let release!: () => void, ready!: (pid: number) => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const admitted = new Promise<number>((resolve) => {
        ready = resolve;
      });
      const mutation = db.$transaction(
        async (tx) => {
          if (kind === 'actor')
            await tx.$queryRaw`SELECT id FROM users WHERE id=${actor} FOR UPDATE`;
          else
            await tx.$queryRaw`SELECT id FROM access_positions WHERE id=${assignment.positionId} FOR UPDATE`;
          const [pid] = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`;
          ready(pid.pid);
          await gate;
          if (kind === 'actor')
            await tx.user.update({ where: { id: actor }, data: { isActive: false } });
          else
            await tx.accessPosition.update({
              where: { id: assignment.positionId },
              data: { permissions: [] },
            });
        },
        { timeout: 15000 },
      );
      const pid = await admitted;
      const response = http('findByContract', contract.id, document.id, actor).then(
        (value) => value,
      );
      try {
        await blockedBy(pid);
      } finally {
        release();
      }
      await mutation;
      expect((await response).status).toBe(403);
    },
    20000,
  );
  it('successful real guard preflight does not authorize a later source substitution', async () => {
    const { contract, document } = await fixture();
    guard.mockImplementationOnce(async function (context) {
      const result = await realGuard.call(this, context);
      await db.contract.update({ where: { id: contract.id }, data: { salespersonId: denied } });
      return result;
    });
    await http('upload', contract.id, document.id).expect(403);
    expect(await db.contractDocument.count({ where: { contractId: contract.id } })).toBe(1);
  });
  it('actual @Res sends no file header or byte before required evidence commits', async () => {
    const { contract, document } = await fixture();
    const upload = await http('upload', contract.id, document.id).expect(201);
    let release!: () => void, ready!: (pid: number) => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const admitted = new Promise<number>((resolve) => {
      ready = resolve;
    });
    const blocker = db.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(839251)`;
        const [pid] = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`;
        ready(pid.pid);
        await gate;
      },
      { timeout: 15000 },
    );
    const pid = await admitted;
    let headersReceived = false,
      byteCount = 0;
    const address = app.getHttpServer().address();
    const result = new Promise<{ status: number; bytes: Buffer }>((resolve, reject) => {
      const req = nodeGet(
        {
          hostname: '127.0.0.1',
          port: address.port,
          path: `/contracts/${contract.id}/documents/${upload.body.id}/content?company=SHOP`,
          headers: { 'x-test-user': maker },
        },
        (res) => {
          headersReceived = true;
          const parts: Buffer[] = [];
          res.on('data', (data) => {
            byteCount += data.length;
            parts.push(data);
          });
          res.on('end', () => resolve({ status: res.statusCode!, bytes: Buffer.concat(parts) }));
        },
      );
      req.on('error', reject);
    });
    try {
      await blockedBy(pid);
      expect(headersReceived).toBe(false);
      expect(byteCount).toBe(0);
      expect(
        await db.documentAuditLog.count({
          where: { documentId: upload.body.id, action: 'CONTENT_RELEASE_AUTHORIZED' },
        }),
      ).toBe(0);
    } finally {
      release();
    }
    await blocker;
    const response = await result;
    expect(response.status).toBe(200);
    expect(response.bytes).toEqual(pdf);
    expect(
      await db.documentAuditLog.count({
        where: { documentId: upload.body.id, action: 'CONTENT_RELEASE_AUTHORIZED' },
      }),
    ).toBe(1);
  }, 20000);
});

describe('disconnected actual HTTP release', () => {
  it('does not write a late file response after the client disconnects at the commit barrier', async () => {
    const { contract, document } = await fixture();
    const upload = await http('upload', contract.id, document.id).expect(201);
    let release!: () => void, ready!: (pid: number) => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const admitted = new Promise<number>((resolve) => {
      ready = resolve;
    });
    const blocker = db.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(839251)`;
        const [pid] = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`;
        ready(pid.pid);
        await gate;
      },
      { timeout: 15000 },
    );
    const pid = await admitted,
      probe = randomUUID();
    const req = nodeGet({
      hostname: '127.0.0.1',
      port: app.getHttpServer().address().port,
      path: `/contracts/${contract.id}/documents/${upload.body.id}/content?company=SHOP`,
      headers: { 'x-test-user': maker, 'x-owned-disconnect-probe': probe },
    });
    req.on('error', () => undefined);
    try {
      await blockedBy(pid);
      const captured = disconnectedResponses.get(probe)!;
      const closed = new Promise<void>((resolve) => captured.response.once('close', resolve));
      req.destroy();
      await closed;
      expect(captured.response.destroyed).toBe(true);
    } finally {
      release();
    }
    await blocker;
    const deadline = Date.now() + 5000;
    let completed = false;
    while (Date.now() < deadline) {
      completed = !!(await db.auditLog.count({
        where: { entityId: upload.body.id, action: 'GET' },
      }));
      if (completed) break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(completed).toBe(true);
    const captured = disconnectedResponses.get(probe)!;
    expect(
      captured.setHeader.mock.calls.some(
        ([key]) => String(key).toLowerCase() === 'content-disposition',
      ),
    ).toBe(false);
    expect(captured.end).not.toHaveBeenCalled();
    captured.setHeader.mockRestore();
    captured.end.mockRestore();
    disconnectedResponses.delete(probe);
  }, 20000);
});

describe('current source, independent permissions and honest availability', () => {
  it.each(routes)('%s useful current FINANCE source', async (op) => {
    const actor = await user();
    await grant(actor, permissions, 'FINANCE');
    const { contract, document } = await fixture(actor);
    const documentId =
      op === 'content'
        ? ((await http('upload', contract.id, document.id, actor, 'FINANCE').expect(201)).body
            .id as string)
        : document.id;
    const response = await http(op, contract.id, documentId, actor, 'FINANCE').expect(
      ['upload', 'recordView', 'recordDownload'].includes(op) ? 201 : 200,
    );
    if (op === 'content') expect(response.body).toEqual(pdf);
    if (op === 'recordView') expect(response.body).toEqual({ recorded: 'VIEW_INTENT' });
    if (op === 'recordDownload') expect(response.body).toEqual({ recorded: 'DOWNLOAD_INTENT' });
  });
  it.each(['demoted-owner', 'changed-branch', 'now-managed'] as const)(
    'legacy %s does not retain stale JWT authority',
    async (kind) => {
      const actor = await user('OWNER');
      await db.user.update({
        where: { id: actor },
        data: { accessManaged: false, branchId: branch },
      });
      stale.set(actor, await snapshots.forUser(actor));
      staleClaims.set(actor, { role: 'OWNER', branchId: branch });
      const { contract, document } = await fixture(actor);
      if (kind === 'demoted-owner') {
        await db.user.update({ where: { id: actor }, data: { role: 'SALES' } });
        await http('remove', contract.id, document.id, actor).expect(403);
      } else if (kind === 'changed-branch') {
        const shop = await db.companyInfo.findUniqueOrThrow({ where: { companyCode: 'SHOP' } });
        const other = await db.branch.create({
          data: { name: 'Legacy current branch', companyId: shop.id },
        });
        await db.user.update({ where: { id: actor }, data: { role: 'SALES', branchId: other.id } });
        await http('findByContract', contract.id, document.id, actor).expect(403);
      } else {
        await db.user.update({
          where: { id: actor },
          data: { role: 'SALES', accessManaged: true },
        });
        await http('upload', contract.id, document.id, actor).expect(403);
      }
      expect(
        (await db.contractDocument.findUniqueOrThrow({ where: { id: document.id } })).deletedAt,
      ).toBeNull();
    },
  );
  it('real outer audit is finite for legacy uploads and malformed private inputs', async () => {
    const actor = await user();
    await db.user.update({
      where: { id: actor },
      data: { accessManaged: false, branchId: branch },
    });
    const { contract, document } = await fixture(actor);
    await http('upload', contract.id, document.id, actor).expect(201);
    await http('upload', contract.id, document.id, actor, 'SHOP', {
      ...payload,
      fileName: 'PRIVATE/INVALID',
    }).expect(400);
    await Promise.allSettled([...auditPromises]);
    const audit = await db.auditLog.findMany({ where: { userId: actor } });
    expect(audit.length).toBeGreaterThanOrEqual(2);
    expect(JSON.stringify(audit.map((row) => row.newValue))).not.toMatch(
      /PRIVATE|base64|fileUrl|notes|fileName/,
    );
    expect(
      await db.uploadedContractDocumentIdentity.count({ where: { contractId: contract.id } }),
    ).toBe(1);
  });
  it.each(['page=0', 'limit=101', 'page=1000001', 'unknown=PRIVATE', 'limit=1&limit=2'])(
    'managed query %s is rejected',
    async (query) => {
      const { contract } = await fixture();
      await request(app.getHttpServer())
        .get(`/contracts/${contract.id}/documents?company=SHOP&${query}`)
        .set('x-test-user', maker)
        .expect(400);
    },
  );
  it.each(permissions.filter((key) => key.startsWith('sensitive.')))(
    'missing %s hides references/count/history and denies bytes/remove',
    async (missing) => {
      const actor = await user();
      await grant(
        actor,
        permissions.filter((key) => key !== missing),
      );
      const { contract, document } = await fixture(actor);
      const list = await http('findByContract', contract.id, document.id, actor).expect(200);
      expect(list.body).toMatchObject({ availability: 'unavailable', total: null, data: [] });
      const history = await http('getDocumentAuditTrail', contract.id, document.id, actor).expect(
        200,
      );
      expect(history.body).toEqual({ availability: 'unavailable', total: null, data: [] });
      const checklist = await http('getDocumentChecklist', contract.id, document.id, actor).expect(
        200,
      );
      expect(checklist.body.complete).toBeNull();
      expect(
        checklist.body.checklist.every((item: { present: unknown }) => item.present === null),
      ).toBe(true);
      expect(checklist.body.requiresGuardian).toBe(
        missing === 'sensitive.customer-identity.read' ? null : false,
      );
      for (const op of ['content', 'recordView', 'recordDownload', 'remove'] as const)
        await http(op, contract.id, document.id, actor).expect(403);
    },
  );
  it('blind create is useful without read/sensitive grants, and cannot read/remove prior evidence', async () => {
    const actor = await user();
    await grant(actor, [
      'contracts.read',
      'contracts.update',
      'customers.read',
      'contract-documents.create',
    ]);
    const { contract, document } = await fixture(actor);
    const response = await http('upload', contract.id, document.id, actor).expect(201);
    expect(response.body).toEqual({ id: expect.any(String), version: 2 });
    expect(
      await db.uploadedContractDocumentIdentity.count({ where: { documentId: response.body.id } }),
    ).toBe(1);
    for (const op of ['findByContract', 'content', 'remove'] as const)
      await http(op, contract.id, document.id, actor).expect(403);
  });
  it.each([
    ['contracts.read', 'findByContract'],
    ['contracts.update', 'upload'],
    ['customers.read', 'upload'],
    ['contract-documents.read', 'recordView'],
    ['contract-documents.create', 'upload'],
    ['contract-documents.update', 'remove'],
    ['contract-documents.export', 'content'],
    ['contract-documents.read', 'content'],
    ['contract-documents.export', 'recordDownload'],
  ] as const)('requires independent %s for %s', async (missing, op) => {
    const actor = await user();
    await grant(
      actor,
      permissions.filter((key) => key !== missing),
    );
    const { contract, document } = await fixture(actor);
    await http(op, contract.id, document.id, actor).expect(403);
  });
  it('SHOP maker-only and selected work never borrow a FINANCE grant', async () => {
    const actor = await user();
    await grant(actor);
    const { contract, document } = await fixture(maker);
    await http('findByContract', contract.id, document.id, actor).expect(403);
    await http('findByContract', contract.id, document.id, maker, 'FINANCE').expect(403);
    await db.contract.update({ where: { id: contract.id }, data: { status: 'ACTIVE' } });
    await http('findByContract', contract.id, document.id).expect(403);
  });
  it('same-case handoff and actual FINANCE assigned Customer proof preserve legitimate uploaded bytes', async () => {
    const { contract, document } = await fixture();
    const uploaded = await http('upload', contract.id, document.id).expect(201);
    const actor = await user();
    const position = await db.accessPosition.create({
      data: { code: randomUUID(), name: 'Assigned FINANCE', permissions },
    });
    await db.employeeAccessAssignment.create({
      data: {
        userId: actor,
        positionId: position.id,
        companyCode: 'FINANCE',
        scope: 'ASSIGNED',
        branches: { create: { branchId: branch } },
      },
    });
    await db.contract.update({
      where: { id: contract.id },
      data: { status: 'ACTIVE', assignedToId: actor },
    });
    const response = await http('content', contract.id, uploaded.body.id, actor, 'FINANCE').expect(
      200,
    );
    expect(response.body).toEqual(pdf);
    expect(response.headers).toMatchObject({
      'cache-control': 'private, no-store',
      'x-content-type-options': 'nosniff',
      'content-length': String(pdf.length),
    });
    expect(response.headers['content-disposition']).toBe('attachment; filename="document-2.pdf"');
    await http('content', contract.id, uploaded.body.id, maker).expect(403);
    await db.contract.update({ where: { id: contract.id }, data: { assignedToId: maker } });
    await http('content', contract.id, uploaded.body.id, actor, 'FINANCE').expect(403);
  });
  it('does not pair Customer read at source A with Customer sensitive grants at source B', async () => {
    const actor = await user();
    await grant(
      actor,
      permissions.filter((key) => key !== 'customers.read'),
    );
    await grant(actor, ['customers.read'], 'FINANCE');
    const { contract, document } = await fixture(actor);
    const response = await http('findByContract', contract.id, document.id, actor).expect(200);
    expect(response.body).toMatchObject({ availability: 'unavailable', total: null, data: [] });
    await http('upload', contract.id, document.id, actor).expect(201);
  });
  it('independent Customer identity fact supports guardian requirements without all5 or file inference', async () => {
    const actor = await user();
    await grant(actor, [
      'contracts.read',
      'customers.read',
      'contract-documents.read',
      'sensitive.customer-identity.read',
    ]);
    const { contract, document, customer } = await fixture(actor);
    const now = new Date();
    now.setFullYear(now.getFullYear() - 18);
    await db.customer.update({ where: { id: customer.id }, data: { birthDate: now } });
    const response = await http('getDocumentChecklist', contract.id, document.id, actor).expect(
      200,
    );
    expect(response.body).toMatchObject({
      requiresGuardian: true,
      complete: null,
      availability: 'unavailable',
    });
    expect(response.body.checklist.at(-1)).toMatchObject({ type: 'GUARDIAN_DOC', present: null });
  });
  it.each(routes)(
    '%s rejects a stale owner whose current role/position no longer authorizes',
    async (op) => {
      const actor = await user('OWNER');
      stale.set(actor, await snapshots.forUser(actor));
      await db.user.update({ where: { id: actor }, data: { role: 'SALES' } });
      const { contract, document } = await fixture(actor);
      await http(op, contract.id, document.id, actor).expect(403);
    },
  );
});

describe('retained identity, exact content and canonical atomic evidence', () => {
  it('legacy producer identity remains useful after genuine managed authorization without a guessed company', async () => {
    const actor = await user();
    await db.user.update({
      where: { id: actor },
      data: { accessManaged: false, branchId: branch },
    });
    const { contract, document } = await fixture(actor);
    const upload = await http('upload', contract.id, document.id, actor).expect(201);
    const identity = await db.uploadedContractDocumentIdentity.findUniqueOrThrow({
      where: { documentId: upload.body.id },
    });
    expect(identity).toMatchObject({
      producerKind: 'LEGACY_CURRENT_ROLE',
      creationCompany: null,
      contractId: contract.id,
      customerId: contract.customerId,
      branchId: branch,
    });
    await db.user.update({ where: { id: actor }, data: { accessManaged: true } });
    await http('content', contract.id, upload.body.id, actor).expect(403);
    await grant(actor);
    const response = await http('content', contract.id, upload.body.id, actor).expect(200);
    expect(response.body).toEqual(pdf);
    await db.user.update({ where: { id: actor }, data: { isActive: false } });
    await http('content', contract.id, upload.body.id, actor).expect(403);
  });
  it.each([
    ['MANAGED_SOURCE', null],
    ['LEGACY_CURRENT_ROLE', 'SHOP'],
    ['UNKNOWN', null],
    ['MANAGED_SOURCE', 'UNKNOWN'],
  ] as const)('legacy producer constraint rejects %s/%s', async (producerKind, creationCompany) => {
    const { contract, document } = await fixture();
    await expect(
      db.uploadedContractDocumentIdentity.create({
        data: {
          documentId: document.id,
          contractId: contract.id,
          customerId: contract.customerId,
          branchId: branch,
          producerKind,
          creationCompany,
          mimeType: 'application/pdf',
          fileSize: pdf.length,
          fileHash: createHash('sha256').update(pdf).digest('hex'),
          inlineValueHash: createHash('sha256').update(payload.fileUrl).digest('hex'),
        },
      }),
    ).rejects.toThrow();
  });
  it('legacy producer identity cannot be claimed by context-free canonical service arguments', async () => {
    const { contract } = await fixture();
    const service = new ContractDocumentsService(
      db as PrismaService,
      storage as unknown as StorageService,
    );
    const uploaded = await service.upload(contract.id, payload, maker);
    expect(
      await db.uploadedContractDocumentIdentity.count({ where: { documentId: uploaded.id } }),
    ).toBe(0);
    await http('content', contract.id, uploaded.id).expect(403);
  });
  it('legacy producer identity and new canonical version roll back with required upload audit', async () => {
    const actor = await user();
    await db.user.update({
      where: { id: actor },
      data: { accessManaged: false, branchId: branch },
    });
    const { contract, document } = await fixture(actor);
    await db.$executeRaw`INSERT INTO owned_file_audit_failures(contract_id) VALUES (${contract.id})`;
    try {
      await http('upload', contract.id, document.id, actor).expect(500);
      expect(
        await db.uploadedContractDocumentIdentity.count({ where: { contractId: contract.id } }),
      ).toBe(0);
      expect(await db.contractDocument.count({ where: { contractId: contract.id } })).toBe(1);
      expect(
        (await db.contractDocument.findUniqueOrThrow({ where: { id: document.id } })).isLatest,
      ).toBe(true);
    } finally {
      await db.$executeRaw`DELETE FROM owned_file_audit_failures WHERE contract_id=${contract.id}`;
    }
  });
  it.each(['upload', 'remove', 'content'] as const)(
    '%s failure of final required evidence rolls back earlier canonical changes',
    async (op) => {
      const { contract, document } = await fixture();
      const upload = await http('upload', contract.id, document.id).expect(201);
      const before = await db.documentAuditLog.count({ where: { contractId: contract.id } });
      const entityId = op === 'upload' ? contract.id : (upload.body.id as string);
      await db.$executeRaw`INSERT INTO owned_file_required_failures(entity_id) VALUES (${entityId})`;
      try {
        const response = await http(op, contract.id, upload.body.id).expect(500);
        expect(response.headers['content-disposition']).toBeUndefined();
        expect(JSON.stringify(response.body)).not.toContain('PRIVATE');
        expect(await db.contractDocument.count({ where: { contractId: contract.id } })).toBe(2);
        expect(
          await db.uploadedContractDocumentIdentity.count({ where: { contractId: contract.id } }),
        ).toBe(1);
        expect(
          (await db.contractDocument.findUniqueOrThrow({ where: { id: upload.body.id } }))
            .deletedAt,
        ).toBeNull();
        expect(
          (await db.contractDocument.findUniqueOrThrow({ where: { id: upload.body.id } })).isLatest,
        ).toBe(true);
        expect(await db.documentAuditLog.count({ where: { contractId: contract.id } })).toBe(
          before,
        );
      } finally {
        await db.$executeRaw`DELETE FROM owned_file_required_failures WHERE entity_id=${entityId}`;
      }
    },
  );
  it('retains useful nonlatest bytes and vetoes deleted evidence without changing identity', async () => {
    const { contract, document } = await fixture();
    const first = await http('upload', contract.id, document.id).expect(201);
    const second = await http('upload', contract.id, document.id).expect(201);
    await http('content', contract.id, first.body.id).expect(200);
    expect(
      (await db.contractDocument.findUniqueOrThrow({ where: { id: first.body.id } })).isLatest,
    ).toBe(false);
    await db.contractDocument.update({
      where: { id: first.body.id },
      data: { deletedAt: new Date() },
    });
    await http('content', contract.id, first.body.id).expect(404);
    await http('content', contract.id, second.body.id).expect(200);
    const identity = await db.uploadedContractDocumentIdentity.findUniqueOrThrow({
      where: { documentId: first.body.id },
    });
    await expect(
      db.uploadedContractDocumentIdentity.update({
        where: { id: identity.id },
        data: { creationCompany: 'FINANCE' },
      }),
    ).rejects.toThrow();
    await expect(
      db.uploadedContractDocumentIdentity.delete({ where: { id: identity.id } }),
    ).rejects.toThrow();
  });
  it.each([
    'fileUrl',
    'fileHash',
    'fileSize',
    'mimeType',
    'contractId',
    'customerId',
    'branchId',
  ] as const)('vetoes %s substitution without file headers/bytes', async (field) => {
    const { contract, document } = await fixture(owner);
    const uploaded = await http('upload', contract.id, document.id, owner).expect(201);
    if (field === 'contractId') {
      const other = await fixture(owner);
      await db.contractDocument.update({
        where: { id: uploaded.body.id },
        data: { contractId: other.contract.id },
      });
      await http('content', other.contract.id, uploaded.body.id, owner).expect(403);
      return;
    }
    if (field === 'customerId') {
      const other = await fixture(owner);
      await db.contract.update({
        where: { id: contract.id },
        data: { customerId: other.customer.id },
      });
    } else if (field === 'branchId') {
      const shop = await db.companyInfo.findUniqueOrThrow({ where: { companyCode: 'SHOP' } });
      const other = await db.branch.create({ data: { name: 'Owned moved', companyId: shop.id } });
      await db.contract.update({ where: { id: contract.id }, data: { branchId: other.id } });
    } else {
      const data =
        field === 'fileUrl'
          ? { fileUrl: 'private/untrusted.pdf' }
          : field === 'fileHash'
            ? { fileHash: '0'.repeat(64) }
            : field === 'fileSize'
              ? { fileSize: 1 }
              : { mimeType: 'image/png' };
      await db.contractDocument.update({ where: { id: uploaded.body.id }, data });
    }
    const response = await http('content', contract.id, uploaded.body.id, owner).expect(403);
    expect(response.headers['content-disposition']).toBeUndefined();
    expect(response.body).not.toEqual(pdf);
    expect(storage.getStream).not.toHaveBeenCalled();
  });
  it('preserves canonical GIF support and server-derived MIME/decoded size/hash', async () => {
    const { contract, document } = await fixture();
    const gif = Buffer.from('GIF89aOWNED');
    const response = await http('upload', contract.id, document.id, maker, 'SHOP', {
      ...payload,
      fileUrl: `data:image/gif;base64,${gif.toString('base64')}`,
    }).expect(201);
    const identity = await db.uploadedContractDocumentIdentity.findUniqueOrThrow({
      where: { documentId: response.body.id },
    });
    expect(identity).toMatchObject({
      mimeType: 'image/gif',
      fileSize: gif.length,
      fileHash: createHash('sha256').update(gif).digest('hex'),
    });
    const content = await http('content', contract.id, response.body.id).expect(200);
    expect(content.body).toEqual(gif);
  });
  it.each([
    'data:application/pdf;base64,SEVMT E8=',
    'data:application/pdf;base64,SEVMTE8=',
    'https://private.invalid/file.pdf',
  ])('rejects malicious/disguised upload %s atomically', async (fileUrl) => {
    const { contract, document } = await fixture();
    await http('upload', contract.id, document.id, maker, 'SHOP', { ...payload, fileUrl }).expect(
      400,
    );
    expect(await db.contractDocument.count({ where: { contractId: contract.id } })).toBe(1);
    expect(await db.documentAuditLog.count({ where: { contractId: contract.id } })).toBe(0);
  });
  it.each(['upload', 'remove', 'content'] as const)(
    '%s late required audit failure rolls back all state and releases no file bytes',
    async (op) => {
      const { contract, document } = await fixture();
      const upload = await http('upload', contract.id, document.id).expect(201);
      const before = await db.documentAuditLog.count({ where: { contractId: contract.id } });
      await db.$executeRaw`INSERT INTO owned_file_audit_failures(contract_id) VALUES (${contract.id})`;
      try {
        const response = await http(op, contract.id, upload.body.id).expect(500);
        expect(response.headers['content-disposition']).toBeUndefined();
        expect(JSON.stringify(response.body)).not.toContain('PRIVATE');
        expect(await db.contractDocument.count({ where: { contractId: contract.id } })).toBe(2);
        expect(
          (await db.contractDocument.findUniqueOrThrow({ where: { id: upload.body.id } }))
            .deletedAt,
        ).toBeNull();
        expect(await db.documentAuditLog.count({ where: { contractId: contract.id } })).toBe(
          before,
        );
      } finally {
        await db.$executeRaw`DELETE FROM owned_file_audit_failures WHERE contract_id=${contract.id}`;
      }
    },
  );
  it('history proves retained parent association, finite intent and actor before limit', async () => {
    const a = await fixture(),
      b = await fixture();
    await db.documentAuditLog.createMany({
      data: [
        {
          contractId: a.contract.id,
          documentId: a.document.id,
          action: 'VIEW',
          userId: maker,
          details: { secret: 'PRIVATE_HISTORY' },
        },
        { contractId: a.contract.id, documentId: b.document.id, action: 'UPLOAD', userId: maker },
        {
          contractId: a.contract.id,
          documentId: a.document.id,
          action: 'PRIVATE_ACTION',
          userId: maker,
        },
        {
          contractId: a.contract.id,
          documentId: a.document.id,
          action: 'DOWNLOAD',
          userId: randomUUID(),
        },
      ],
    });
    await db.contractDocument.update({
      where: { id: a.document.id },
      data: { deletedAt: new Date() },
    });
    const response = await http('getDocumentAuditTrail', a.contract.id, a.document.id).expect(200);
    expect(response.body.total).toBe(2);
    expect(response.body.data.map((item: { action: string }) => item.action).sort()).toEqual([
      'DOWNLOAD_INTENT',
      'VIEW_INTENT',
    ]);
    expect(response.body.data.map((item: { actorId: string | null }) => item.actorId)).toContain(
      null,
    );
    expect(JSON.stringify(response.body)).not.toContain('PRIVATE');
  });
});
