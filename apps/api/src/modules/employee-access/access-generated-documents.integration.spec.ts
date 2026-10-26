import { AccessSignaturesBoundaries } from './access-signatures-boundaries';
import { ContractSignaturesAccessService } from '../contracts/services/contract-signatures-access.service';
import { ContractDocumentsController } from '../contracts/contract-documents.controller';
import { get as nodeGet } from 'node:http';
import { GeneratedDocumentsService } from '../contracts/services/generated-documents.service';
import { AccessGeneratedDocumentsBoundaries } from './access-generated-documents-boundaries';
import { randomUUID, createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { ExecutionContext, INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { PermissionKey } from '@installment/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AccessSnapshotService } from './access-snapshot.service';
import { AccessPolicyService } from './access-policy';
import { AccessPolicyInterceptor } from './access-policy.interceptor';
import { AccessResourceService } from './access-resource.service';
import { AccessPartySourceService } from './access-party-source.service';
import { AccessProcurementSourceService } from './access-procurement-source.service';
import { AccessDocumentTemplateBoundaries } from './access-document-template-boundaries';
import { AccessContractFilesBoundaries } from './access-contract-files-boundaries';
import { DocumentsController } from '../contracts/documents.controller';
import { DocumentsService } from '../contracts/documents.service';
import { ContractDocumentsService } from '../contracts/contract-documents.service';
import { ContractFileAccessGuard } from '../contracts/contract-file-access.guard';
import { DocumentRenderingService } from '../contracts/services/document-rendering.service';
import { RolesGuard } from '../auth/guards/roles.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AuditInterceptor } from '../audit/audit.interceptor';
import { AuditService } from '../audit/audit.service';
import { StorageService } from '../storage/storage.service';
import { SettingsService } from '../settings/settings.service';
import { SettingsFlagsService } from '../settings/services/settings-flags.service';
import { SettingsWriteService } from '../settings/services/settings-write.service';
import { DocNumberPreviewService } from '../settings/services/doc-number-preview.service';
import { NotificationsService } from '../notifications/notifications.service';
import { OcrService } from '../ocr/ocr.service';

const url = process.env.EMPLOYEE_ACCESS_TEST_DATABASE_URL;
if (
  !url?.includes('/bc_access_generated_documents?host=/tmp/bc-access-generated-documents.') ||
  process.env.DATABASE_URL !== url ||
  process.env.DATABASE_URL_FINANCE !== url
)
  throw new Error('Both URLs must be the owned generated-documents cluster');
const db = new PrismaClient({ datasources: { db: { url } } });
const snapshots = new AccessSnapshotService(db as PrismaService);
const marker = randomUUID();
const pdf = Buffer.from('%PDF-1.4\n% OWNED_GENERATED_DOCUMENT\n%%EOF');
const files = new Map<string, Buffer>();
const auditPromises = new Set<Promise<unknown>>();
const disconnected = new Map<
  string,
  { res: Response; headers: jest.SpyInstance; end: jest.SpyInstance }
>();
const storage = {
  configured: true,
  upload: jest.fn(async (key: string, bytes: Buffer) => {
    files.set(key, Buffer.from(bytes));
    return key;
  }),
  uploadOwned: jest.fn(async (key: string, bytes: Buffer) => {
    files.set(key, Buffer.from(bytes));
  }),
  deleteOwned: jest.fn(async (key: string) => {
    files.delete(key);
    return { status: 'deleted' };
  }),
  getStream: jest.fn(async (key: string) => {
    const bytes = files.get(key);
    if (!bytes) throw new Error('PRIVATE_PROVIDER_ERROR');
    return Readable.from([bytes]);
  }),
  getSignedDownloadUrl: jest.fn(async () => 'https://private-provider.invalid/BEARER_SECRET'),
};
const render = jest.spyOn(DocumentRenderingService.prototype, 'htmlToPdf');
const permissions: PermissionKey[] = [
  'contracts.read',
  'contracts.update',
  'customers.read',
  'products.read',
  'payments.read',
  'documents.create',
  'documents.read',
  'documents.export',
  'pdpa.read',
  'employees.read',
  'contract-documents.read',
  'contract-documents.create',
  'contract-documents.export',
  'sensitive.customer-identity.read',
  'sensitive.cost.read',
  'sensitive.profit.read',
  'sensitive.salary.read',
  'sensitive.seller-bank.read',
];
const operations = [
  'generateDocument',
  'generatePdpaDocument',
  'generateSignedDocuments',
  'previewContract',
  'downloadPdf',
  'regenerateSignedContractPdfs',
  'getDocument',
  'getDocuments',
  'downloadDocument',
  'getSignedUrl',
] as const;
type Operation = (typeof operations)[number];
let app: INestApplication, owner: string, maker: string, denied: string, branch: string;
async function user(role: 'OWNER' | 'SALES' = 'SALES') {
  return (
    await db.user.create({
      data: {
        name: 'Owned generated',
        email: `${randomUUID()}@test.invalid`,
        password: 'unused',
        role,
        accessManaged: true,
        branchId: branch,
      },
    })
  ).id;
}
async function fixture(actor = maker) {
  const customer = await db.customer.create({
    data: {
      name: 'PRIVATE_CUSTOMER',
      phone: '0800000000',
      nationalId: randomUUID(),
      salary: 25000,
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
  const consent = await db.pDPAConsent.create({
    data: {
      customerId: customer.id,
      consentVersion: 'owned',
      privacyNoticeText: 'PRIVATE_CONSENT',
      status: 'GRANTED',
      grantedAt: new Date(),
    },
  });
  const contract = await db.contract.create({
    data: {
      contractNumber: `PRIVATE-GEN-${randomUUID()}`,
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
      pdpaConsentId: consent.id,
      signatures: {
        create: (['CUSTOMER', 'COMPANY', 'WITNESS_1', 'WITNESS_2'] as const).map((signerType) => ({
          signerType,
          signatureImage:
            'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZ1kAAAAASUVORK5CYII=',
        })),
      },
    },
  });
  const key = `owned/${randomUUID()}.pdf`;
  files.set(key, pdf);
  const document = await db.eDocument.create({
    data: {
      contractId: contract.id,
      documentType: 'CONTRACT',
      fileUrl: key,
      fileHash: createHash('sha256').update(pdf).digest('hex'),
      createdById: actor,
    },
  });
  return { contract, document, customer };
}
function http(
  operation: Operation,
  contractId: string,
  documentId: string,
  actor = maker,
  company: 'SHOP' | 'FINANCE' = 'SHOP',
) {
  const path = {
    generateDocument: `/contracts/${contractId}/generate-document`,
    generatePdpaDocument: `/contracts/${contractId}/generate-pdpa-document`,
    generateSignedDocuments: `/contracts/${contractId}/generate-signed-documents`,
    previewContract: `/contracts/${contractId}/preview`,
    downloadPdf: `/contracts/${contractId}/download-pdf`,
    regenerateSignedContractPdfs: '/contracts/admin/regenerate-signed-pdfs',
    getDocument: `/documents/${documentId}`,
    getDocuments: `/contracts/${contractId}/e-documents`,
    downloadDocument: `/documents/${documentId}/download`,
    getSignedUrl: `/documents/${documentId}/signed-url`,
  }[operation];
  const method =
    operation.startsWith('generate') || operation === 'regenerateSignedContractPdfs'
      ? 'post'
      : 'get';
  const client = request(app.getHttpServer());
  return client[method](path)
    .query({
      company,
      ...(['previewContract', 'downloadPdf'].includes(operation)
        ? { templateSource: 'BUILTIN' }
        : {}),
    })
    .set('x-test-user', actor)
    .expect('x-owned-generated-documents-app', marker)
    .send(
      method === 'post'
        ? {
            templateSource: 'BUILTIN',
            ...(operation === 'generateDocument' ? { documentType: 'CONTRACT' } : {}),
          }
        : undefined,
    );
}
beforeAll(async () => {
  const shop = await db.companyInfo.findUniqueOrThrow({ where: { companyCode: 'SHOP' } });
  branch = (await db.branch.create({ data: { name: 'Owned generated SHOP', companyId: shop.id } }))
    .id;
  [owner, maker, denied] = await Promise.all([user('OWNER'), user(), user()]);
  const position = await db.accessPosition.create({
    data: { code: randomUUID(), name: 'Owned generator', permissions },
  });
  for (const companyCode of ['SHOP', 'FINANCE'])
    await db.employeeAccessAssignment.create({
      data: {
        userId: maker,
        positionId: position.id,
        companyCode,
        scope: 'BRANCHES',
        branches: { create: { branchId: branch } },
      },
    });
  await db.contractTemplate.create({
    data: {
      name: 'Owned canonical',
      type: 'STORE_DIRECT',
      contentHtml: '<p>{customer_name} {customer_salary} {national_id_full}</p>',
      isActive: true,
    },
  });
  await db.contractTemplate.create({
    data: {
      name: 'Owned consent',
      type: 'PDPA_CONSENT',
      contentHtml: '<p>{customer_name} {pdpa_consent_date} {pdpa_signature}</p>',
      isActive: true,
    },
  });
  const module = await Test.createTestingModule({
    controllers: [DocumentsController, ContractDocumentsController],
    providers: [AccessSignaturesBoundaries, ContractSignaturesAccessService, 
      GeneratedDocumentsService,
      AccessGeneratedDocumentsBoundaries,
      DocumentsService,
      ContractDocumentsService,
      ContractFileAccessGuard,
      RolesGuard,
      AccessPolicyService,
      AccessResourceService,
      AccessPartySourceService,
      AccessProcurementSourceService,
      AccessDocumentTemplateBoundaries,
      AccessContractFilesBoundaries,
      AuditService,
      SettingsService,
      SettingsFlagsService,
      SettingsWriteService,
      DocNumberPreviewService,
      { provide: AccessSnapshotService, useValue: snapshots },
      { provide: PrismaService, useValue: db },
      { provide: StorageService, useValue: storage },
      {
        provide: NotificationsService,
        useValue: {
          send: () => {
            throw new Error('No provider send allowed');
          },
        },
      },
      {
        provide: OcrService,
        useValue: {
          generateTemplateHtml: () => {
            throw new Error('Outside exact10');
          },
        },
      },
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
          access: await snapshots.forUser(id),
        };
        await policies.authorize(context);
        return true;
      },
    })
    .compile();
  const policies = module.get(AccessPolicyService);
  app = module.createNestApplication({ logger: false });
  app.use((_req: Request, res: Response, next: () => void) => {
    res.setHeader('x-owned-generated-documents-app', marker);
    const probe = _req.headers['x-disconnect'];
    if (typeof probe === 'string')
      disconnected.set(probe, {
        res,
        headers: jest.spyOn(res, 'setHeader'),
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
  await db.$executeRawUnsafe('CREATE TABLE owned_generated_failures (actor_id text PRIMARY KEY)');
  await db.$executeRawUnsafe('CREATE TABLE owned_generated_barriers (entity_id text PRIMARY KEY)');
  await db.$executeRawUnsafe(
    `CREATE FUNCTION owned_generated_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.entity='generated_document' THEN IF EXISTS(SELECT 1 FROM owned_generated_failures WHERE actor_id=NEW.user_id) THEN RAISE EXCEPTION 'PRIVATE_AUDIT_ERROR'; END IF; IF NEW.action='GENERATED_CONTENT_RELEASE_AUTHORIZED' AND EXISTS(SELECT 1 FROM owned_generated_barriers WHERE entity_id=NEW.entity_id) THEN PERFORM pg_advisory_xact_lock(839259); END IF; END IF; RETURN NEW; END; $$`,
  );
  await db.$executeRawUnsafe(
    'CREATE TRIGGER owned_generated_audit BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION owned_generated_audit()',
  );
  console.log(
    'OWNED_GENERATED_DOCUMENTS_HTTP',
    marker,
    app.getHttpServer().address(),
    'actual controller/guards/policy/canonical services/settings; synthetic JWT, controlled PDF/storage only',
  );
}, 60000);
beforeEach(() => {
  render.mockReset();
  render.mockResolvedValue(pdf);
  jest.clearAllMocks();
});
afterAll(async () => {
  await app?.close();
  await Promise.allSettled([...auditPromises]);
  await db.$disconnect();
  render.mockRestore();
});

describe('exact ten generated document entrances — owned HTTP/PG RED', () => {
  it.each(operations)(
    'useful authorized %s reaches canonical response contract',
    async (operation) => {
      const { contract, document } = await fixture();
      const actor = operation === 'regenerateSignedContractPdfs' ? owner : maker;
      let documentId = document.id;
      if (['getDocument', 'getDocuments', 'downloadDocument', 'getSignedUrl'].includes(operation)) {
        const produced = await http('generateDocument', contract.id, document.id, owner).expect(
          201,
        );
        documentId = produced.body.id;
      }
      const response = await http(operation, contract.id, documentId, actor);
      expect(response.status).toBe(
        operation.startsWith('generate') || operation === 'regenerateSignedContractPdfs'
          ? 201
          : 200,
      );
      if (operation === 'regenerateSignedContractPdfs')
        expect(response.body).toHaveProperty('hasMore');
      if (['generateDocument', 'generatePdpaDocument'].includes(operation))
        expect(response.body.pdfGenerated).toBe(true);
      if (operation === 'getSignedUrl')
        expect(response.body).toMatchObject({ kind: 'authenticated', expiresIn: 0 });
    },
  );
  it.each(operations)(
    'no-grant %s denies without renderer/storage/persistence effects',
    async (operation) => {
      const { contract, document } = await fixture(denied);
      const count = await db.eDocument.count();
      const response = await http(operation, contract.id, document.id, denied);
      expect(response.status).toBe(403);
      expect(render).not.toHaveBeenCalled();
      expect(storage.upload).not.toHaveBeenCalled();
      expect(storage.getStream).not.toHaveBeenCalled();
      expect(storage.getSignedDownloadUrl).not.toHaveBeenCalled();
      expect(await db.eDocument.count()).toBe(count);
    },
  );
  it('current owner detail projects finite reference without raw file material', async () => {
    const { contract, document } = await fixture();
    const response = await http('getDocument', contract.id, document.id, owner).expect(200);
    expect(response.body).not.toHaveProperty('fileUrl');
    expect(response.body).not.toHaveProperty('fileHash');
  });
  it('current owner signed-url issues authenticated descriptor without provider delegation', async () => {
    const { contract, document } = await fixture();
    const produced = await http('generateDocument', contract.id, document.id, owner).expect(201);
    const response = await http('getSignedUrl', contract.id, produced.body.id, owner).expect(200);
    expect(storage.getSignedDownloadUrl).not.toHaveBeenCalled();
    expect(response.body).toMatchObject({ kind: 'authenticated', expiresIn: 0 });
  });
  it('historical hash-shaped EDocument cannot release managed bytes', async () => {
    const { contract, document } = await fixture();
    const response = await http('downloadDocument', contract.id, document.id, owner);
    expect(response.status).toBe(403);
    expect(storage.getStream).not.toHaveBeenCalled();
  });
  it('fresh PDF actually reaches controller bytes and must use private safe headers', async () => {
    const { contract, document } = await fixture();
    const response = await http('downloadPdf', contract.id, document.id, owner).expect(200);
    expect(render).toHaveBeenCalledTimes(1);
    expect(response.body).toEqual(pdf);
    expect(response.headers['cache-control']).toBe('private, no-store');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
  });
  it('settings changed during real placeholder/render pipeline must reject canonical persistence', async () => {
    const { contract, document } = await fixture();
    render.mockImplementationOnce(async () => {
      await db.systemConfig.upsert({
        where: { key: 'company_name_th' },
        create: { key: 'company_name_th', value: 'Changed during render' },
        update: { value: randomUUID() },
      });
      return pdf;
    });
    const before = await db.eDocument.count({ where: { contractId: contract.id } });
    const response = await http('generateDocument', contract.id, document.id, owner);
    expect(render).toHaveBeenCalledTimes(1);
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(await db.eDocument.count({ where: { contractId: contract.id } })).toBe(before);
  });
  it('current canonical Customer source change during render already rejects persistence', async () => {
    const { contract, document, customer } = await fixture();
    render.mockImplementationOnce(async () => {
      await db.customer.update({ where: { id: customer.id }, data: { salary: 26000 } });
      return pdf;
    });
    const before = await db.eDocument.count({ where: { contractId: contract.id } });
    const response = await http('generateDocument', contract.id, document.id, owner);
    expect(render).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(400);
    expect(await db.eDocument.count({ where: { contractId: contract.id } })).toBe(before);
  });
});
async function grant(
  actor: string,
  keys: PermissionKey[] = permissions,
  branchId = branch,
  companyCode = 'SHOP',
) {
  const position = await db.accessPosition.create({
    data: { code: randomUUID(), name: 'Owned scoped', permissions: keys },
  });
  return db.employeeAccessAssignment.create({
    data: {
      userId: actor,
      positionId: position.id,
      companyCode,
      scope: 'BRANCHES',
      branches: { create: { branchId } },
    },
  });
}
async function produced(actor = maker) {
  const data = await fixture(actor),
    response = await http('generateDocument', data.contract.id, data.document.id, actor).expect(
      201,
    );
  const identity = await db.generatedDocumentIdentity.findUniqueOrThrow({
    where: { documentId: response.body.id },
  });
  return { ...data, id: response.body.id as string, identity };
}
async function blockedBy(pid: number) {
  const end = Date.now() + 5000;
  while (Date.now() < end) {
    const [r] = await db.$queryRaw<
      Array<{ blocked: boolean }>
    >`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE ${pid}=ANY(pg_blocking_pids(pid))) AS blocked`;
    if (r.blocked) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error('HTTP did not reach owned DB barrier');
}
describe('independent source capabilities, genuine provenance and bounded effects', () => {
  it.each(
    permissions.filter(
      (k) =>
        ![
          'pdpa.read',
          'payments.read',
          'contract-documents.create',
          'contract-documents.read',
          'contract-documents.export',
          'documents.export',
        ].includes(k),
    ),
  )('generation independently denies missing %s', async (key) => {
    const actor = await user();
    await grant(
      actor,
      permissions.filter((p) => p !== key),
    );
    const { contract, document } = await fixture(actor);
    const response = await http('generateDocument', contract.id, document.id, actor);
    expect(response.status).toBe(403);
    expect(render).not.toHaveBeenCalled();
    expect(storage.uploadOwned).not.toHaveBeenCalled();
  });
  it('generation needs payments.read when actual Payment rows contribute', async () => {
    const actor = await user();
    await grant(actor);
    const { contract, document } = await fixture(actor);
    await db.payment.create({
      data: { contractId: contract.id, installmentNo: 1, dueDate: new Date(), amountDue: 1000 },
    });
    await http('generateDocument', contract.id, document.id, actor).expect(403);
    await grant(actor, ['payments.read'], branch, 'FINANCE');
    await http('generateDocument', contract.id, document.id, actor).expect(201);
  });
  it('blind acknowledgement never grants export or leaks HTML/key/hash', async () => {
    const actor = await user();
    await grant(
      actor,
      permissions.filter((k) => k !== 'documents.export'),
    );
    const { contract, document } = await fixture(actor),
      response = await http('generateDocument', contract.id, document.id, actor).expect(201);
    expect(Object.keys(response.body).sort()).toEqual([
      'documentType',
      'id',
      'pdfGenerated',
      'templateSource',
    ]);
    await http('downloadDocument', contract.id, response.body.id, actor).expect(403);
  });
  it('missing sensitive visibility is unavailable/null, not an empty complete list', async () => {
    const actor = await user();
    await grant(
      actor,
      permissions.filter((k) => k !== 'sensitive.salary.read'),
    );
    const { contract, document } = await fixture(actor),
      response = await http('getDocuments', contract.id, document.id, actor).expect(200);
    expect(response.body).toMatchObject({ availability: 'unavailable', total: null, data: [] });
  });
  it('custom template omission rejects nonowner; explicit builtin does not silently inherit terms', async () => {
    const { contract, document } = await fixture();
    await request(app.getHttpServer())
      .post(`/contracts/${contract.id}/generate-document?company=SHOP`)
      .set('x-test-user', maker)
      .send({})
      .expect(403);
    expect(render).not.toHaveBeenCalled();
    await http('generateDocument', contract.id, document.id).expect(201);
    expect(render.mock.calls[0][0]).not.toContain('Owned canonical');
  });
  it('custom generated artifact needs current owner even when a full-source nonowner can read metadata', async () => {
    const { contract } = await fixture();
    const generated = await request(app.getHttpServer())
      .post(`/contracts/${contract.id}/generate-document?company=SHOP`)
      .set('x-test-user', owner)
      .send({})
      .expect(201);
    await http('getDocument', contract.id, generated.body.id).expect(200);
    await http('downloadDocument', contract.id, generated.body.id).expect(403);
    await http('downloadDocument', contract.id, generated.body.id, owner).expect(200);
  });
  it.each(['RECEIPT_DOWN', 'RECEIPT_INSTALLMENT', 'PAYOFF', 'PRIVATE_TYPE'])(
    'managed generic %s cannot certify a receipt',
    async (documentType) => {
      const { contract } = await fixture();
      await request(app.getHttpServer())
        .post(`/contracts/${contract.id}/generate-document?company=SHOP`)
        .set('x-test-user', maker)
        .send({ documentType, templateSource: 'BUILTIN' })
        .expect(400);
      expect(render).not.toHaveBeenCalled();
      expect(storage.uploadOwned).not.toHaveBeenCalled();
    },
  );
  it('legacy unsupported labels remain bounded unverified with finite ack', async () => {
    const actor = await user();
    await db.user.update({ where: { id: actor }, data: { accessManaged: false } });
    const { contract } = await fixture(actor);
    const response = await request(app.getHttpServer())
      .post(`/contracts/${contract.id}/generate-document?company=SHOP`)
      .set('x-test-user', actor)
      .send({ documentType: 'PRIVATE_LEGACY_LABEL', templateSource: 'BUILTIN' })
      .expect(201);
    expect(response.body).toMatchObject({ documentType: null, contentStatus: 'UNVERIFIED' });
    expect(JSON.stringify(response.body)).not.toContain('PRIVATE_LEGACY_LABEL');
    expect(
      await db.generatedDocumentIdentity.count({ where: { documentId: response.body.id } }),
    ).toBe(0);
    await http('downloadDocument', contract.id, response.body.id, actor).expect(200);
  });
  it('current legacy generation creates provenance useful after real managed grants', async () => {
    const actor = await user();
    await db.user.update({ where: { id: actor }, data: { accessManaged: false } });
    const data = await produced(actor);
    expect(data.identity).toMatchObject({
      producerKind: 'LEGACY_CURRENT_ROLE',
      creationCompany: null,
    });
    await db.user.update({ where: { id: actor }, data: { accessManaged: true } });
    await http('downloadDocument', data.contract.id, data.id, actor).expect(403);
    await grant(actor);
    await http('downloadDocument', data.contract.id, data.id, actor).expect(200);
  });
  it('retained original Product remains the authority after Contract product replacement', async () => {
    const data = await produced();
    const original = data.contract.productId;
    const replacement = await db.product.create({
      data: {
        name: 'Replacement',
        brand: 'Test',
        model: 'Test',
        category: 'PHONE_NEW',
        costPrice: 1,
        branchId: branch,
      },
    });
    await db.contract.update({
      where: { id: data.contract.id },
      data: { productId: replacement.id },
    });
    await http('downloadDocument', data.contract.id, data.id).expect(200);
    const foreign = await db.branch.create({
      data: {
        name: 'Foreign Product source',
        companyId: (await db.companyInfo.findUniqueOrThrow({ where: { companyCode: 'SHOP' } })).id,
      },
    });
    await db.product.update({ where: { id: original }, data: { branchId: foreign.id } });
    await http('downloadDocument', data.contract.id, data.id).expect(403);
  });
  it('retained original salesperson cannot be replaced by a visible current salesperson', async () => {
    const actor = await user();
    await grant(actor);
    const data = await produced(actor);
    await db.contract.update({ where: { id: data.contract.id }, data: { salespersonId: maker } });
    const foreign = await db.branch.create({
      data: {
        name: 'Foreign staff source',
        companyId: (await db.companyInfo.findUniqueOrThrow({ where: { companyCode: 'SHOP' } })).id,
      },
    });
    await db.user.update({ where: { id: actor }, data: { branchId: foreign.id } });
    await http('downloadDocument', data.contract.id, data.id, owner).expect(200);
    // FINANCE authority removes SHOP maker condition; original staff still needs its own read source.
    await grant(actor, permissions, branch, 'FINANCE');
    const response = await request(app.getHttpServer())
      .get(`/documents/${data.id}/download?company=FINANCE`)
      .set('x-test-user', actor);
    expect(response.status).toBe(403);
  });
  it('ordinary value changes retain genuine original bytes; identity cannot update/delete', async () => {
    const data = await produced();
    await db.product.update({
      where: { id: data.contract.productId },
      data: { name: 'Later name' },
    });
    await http('downloadDocument', data.contract.id, data.id).expect(200);
    await expect(
      db.generatedDocumentIdentity.update({
        where: { id: data.identity.id },
        data: { storageKey: 'forged.pdf' },
      }),
    ).rejects.toThrow();
    await expect(
      db.generatedDocumentIdentity.delete({ where: { id: data.identity.id } }),
    ).rejects.toThrow();
  });
  it.each(['fileHash', 'fileUrl'] as const)(
    'stored %s substitution denies before acquisition',
    async (field) => {
      const data = await produced();
      storage.getStream.mockClear();
      await db.eDocument.update({
        where: { id: data.id },
        data: { [field]: 'PRIVATE_SUBSTITUTION' },
      });
      await http('downloadDocument', data.contract.id, data.id).expect(403);
      expect(storage.getStream).not.toHaveBeenCalled();
    },
  );
  it('provider bytes cannot substitute a valid key/hash-shaped identity', async () => {
    const data = await produced();
    files.set(data.identity.storageKey, Buffer.from('%PDF-corrupted'));
    const response = await http('downloadDocument', data.contract.id, data.id).expect(403);
    expect(response.headers['content-disposition']).toBeUndefined();
  });
  it('actor revocation during rendering rejects final persistence and cleans its staging only', async () => {
    const actor = await user();
    await grant(actor);
    const { contract, document } = await fixture(actor);
    render.mockImplementationOnce(async () => {
      await db.user.update({ where: { id: actor }, data: { isActive: false } });
      return pdf;
    });
    await http('generateDocument', contract.id, document.id, actor).expect(403);
    expect(await db.generatedDocumentIdentity.count({ where: { contractId: contract.id } })).toBe(
      0,
    );
    expect(storage.deleteOwned).toHaveBeenCalled();
  });
  it('source change during owned upload rejects final persistence and deletes only operation staging', async () => {
    const { contract, document, customer } = await fixture();
    storage.uploadOwned.mockImplementationOnce(async (key, bytes) => {
      files.set(key, bytes);
      await db.customer.update({ where: { id: customer.id }, data: { salary: 27000 } });
    });
    await http('generateDocument', contract.id, document.id).expect(400);
    expect(await db.generatedDocumentIdentity.count({ where: { contractId: contract.id } })).toBe(
      0,
    );
    expect(storage.deleteOwned).toHaveBeenCalledWith(
      storage.uploadOwned.mock.calls[0][0],
      expect.any(String),
    );
  });
  it('required audit failure rolls back generated identity/row and releases no bytes', async () => {
    const actor = await user();
    await grant(actor);
    const { contract, document } = await fixture(actor);
    await db.$executeRaw`INSERT INTO owned_generated_failures(actor_id) VALUES(${actor})`;
    const response = await http('generateDocument', contract.id, document.id, actor);
    expect(response.status).toBe(500);
    expect(await db.generatedDocumentIdentity.count({ where: { contractId: contract.id } })).toBe(
      0,
    );
    expect(await db.eDocument.count({ where: { contractId: contract.id } })).toBe(1);
    const file = await http('downloadPdf', contract.id, document.id, actor);
    expect(file.status).toBe(500);
    expect(file.headers['content-disposition']).toBeUndefined();
  });
  it('rejects Payment cardinality before renderer/provider work', async () => {
    const { contract, document } = await fixture();
    await db.payment.createMany({
      data: Array.from({ length: 601 }, (_, i) => ({
        contractId: contract.id,
        installmentNo: i + 1,
        dueDate: new Date(),
        amountDue: 1,
      })),
    });
    await http('generateDocument', contract.id, document.id).expect(400);
    expect(render).not.toHaveBeenCalled();
    expect(storage.uploadOwned).not.toHaveBeenCalled();
  });
  it('rejects oversized PDF before staging', async () => {
    const { contract, document } = await fixture();
    render.mockResolvedValueOnce(Buffer.concat([pdf, Buffer.alloc(20 * 1024 * 1024)]));
    await http('generateDocument', contract.id, document.id).expect(400);
    expect(storage.uploadOwned).not.toHaveBeenCalled();
  });
  it('actual generated signed attachment is readable through existing uploaded content seam', async () => {
    const { contract, document } = await fixture();
    const generated = await http('generateSignedDocuments', contract.id, document.id).expect(201);
    expect(generated.body.status).toBe('SUCCESS');
    const attachment = await db.contractDocument.findFirstOrThrow({
      where: { contractId: contract.id, documentType: 'SIGNED_CONTRACT' },
    });
    const response = await request(app.getHttpServer())
      .get(`/contracts/${contract.id}/documents/${attachment.id}/content?company=SHOP`)
      .set('x-test-user', maker)
      .expect(200);
    expect(response.body).toEqual(pdf);
    await db.product.update({ where: { id: contract.productId }, data: { deletedAt: new Date() } });
    await request(app.getHttpServer())
      .get(`/contracts/${contract.id}/documents/${attachment.id}/content?company=SHOP`)
      .set('x-test-user', maker)
      .expect(403);
  });
});

describe('final commit barrier and disconnected transport', () => {
  it.each([false, true])(
    'reaches real required audit barrier before response; disconnect=%s',
    async (disconnect) => {
      const data = await produced(owner),
        probe = randomUUID();
      await db.$executeRaw`INSERT INTO owned_generated_barriers(entity_id) VALUES(${data.id})`;
      let release!: () => void, ready!: (pid: number) => void;
      const gate = new Promise<void>((resolve) => {
          release = resolve;
        }),
        held = new Promise<number>((resolve) => {
          ready = resolve;
        });
      const blocker = db.$transaction(
        async (tx) => {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(839259)`;
          const [row] = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`;
          ready(row.pid);
          await gate;
        },
        { timeout: 10000 },
      );
      const pid = await held;
      let responseSeen = false,
        byteCount = 0;
      const address = app.getHttpServer().address();
      const done = new Promise<void>((resolve, reject) => {
        const req = nodeGet(
          `http://127.0.0.1:${address.port}/documents/${data.id}/download?company=SHOP`,
          { headers: { 'x-test-user': owner, 'x-disconnect': probe } },
          (res) => {
            responseSeen = true;
            res.on('data', (chunk) => {
              byteCount += chunk.length;
            });
            res.on('end', resolve);
          },
        );
        req.on('error', (error) => (disconnect ? resolve() : reject(error)));
        void (async () => {
          try {
            await blockedBy(pid);
            expect(responseSeen).toBe(false);
            expect(byteCount).toBe(0);
            const captured = disconnected.get(probe)!;
            expect(
              captured.headers.mock.calls.some(([name]) =>
                /content-type|content-length|content-disposition/i.test(String(name)),
              ),
            ).toBe(false);
            expect(captured.end).not.toHaveBeenCalled();
            if (disconnect) req.destroy();
          } catch (error) {
            reject(error);
          } finally {
            release();
          }
        })();
      });
      try {
        await done;
        await blocker;
        const end = Date.now() + 3000;
        while (
          !(await db.auditLog.count({
            where: { entityId: data.id, action: 'GENERATED_CONTENT_RELEASE_AUTHORIZED' },
          }))
        ) {
          if (Date.now() > end) throw new Error('Release audit did not commit');
          await new Promise((r) => setTimeout(r, 10));
        }
        await new Promise((r) => setTimeout(r, 30));
        if (disconnect) {
          expect(disconnected.get(probe)!.res.destroyed).toBe(true);
          expect(disconnected.get(probe)!.end).not.toHaveBeenCalled();
          expect(byteCount).toBe(0);
        } else {
          expect(responseSeen).toBe(true);
          expect(byteCount).toBe(pdf.length);
        }
      } finally {
        release();
        await blocker;
        await db.$executeRaw`DELETE FROM owned_generated_barriers WHERE entity_id=${data.id}`;
      }
    },
  );
  it('late owned upload is cleaned after aggregate effect timeout and cannot commit a document', async () => {
    const data = await fixture(owner);
    render.mockImplementationOnce(async (_html, _number, budget) => {
      Object.defineProperty(budget!, 'expiresAt', { value: Date.now() + 15 });
      return pdf;
    });
    let key = '';
    storage.uploadOwned.mockImplementationOnce(async (k, bytes) => {
      key = k;
      await new Promise((r) => setTimeout(r, 60));
      files.set(k, Buffer.from(bytes));
    });
    const response = await http('generateDocument', data.contract.id, data.document.id, owner);
    expect(response.status).toBe(503);
    await new Promise((r) => setTimeout(r, 100));
    expect(files.has(key)).toBe(false);
    expect(await db.eDocument.count({ where: { contractId: data.contract.id } })).toBe(1);
    expect(storage.deleteOwned).toHaveBeenCalledWith(key, expect.any(String));
  });
  it('signed retries preserve genuine attachment and deduplicate delayed notification', async () => {
    const data = await fixture(owner);
    await db.customer.update({
      where: { id: data.customer.id },
      data: { lineIdFinance: 'OWNED-NO-SEND' },
    });
    for (let i = 0; i < 2; i++)
      expect(
        (
          await http('generateSignedDocuments', data.contract.id, data.document.id, owner).expect(
            201,
          )
        ).body.status,
      ).toBe('SUCCESS');
    expect(
      await db.contractDocument.count({
        where: { contractId: data.contract.id, documentType: 'SIGNED_CONTRACT', isLatest: true },
      }),
    ).toBe(1);
    expect(
      await db.notificationLog.count({
        where: {
          relatedId: data.contract.id,
          subject: 'CONTRACT_DOCUMENTS_READY',
          status: 'DELAYED',
        },
      }),
    ).toBe(1);
  });
  it('signed partial retains first original and does not queue notification', async () => {
    const data = await fixture(owner);
    render.mockResolvedValueOnce(pdf).mockRejectedValueOnce(new Error('PRIVATE_RENDERER_ERROR'));
    const response = await http(
      'generateSignedDocuments',
      data.contract.id,
      data.document.id,
      owner,
    ).expect(201);
    expect(response.body.status).toBe('PARTIAL');
    expect(response.body.contract.id).toBeTruthy();
    expect(response.body.pdpa).toBeUndefined();
    expect(JSON.stringify(response.body)).not.toContain('PRIVATE_RENDERER_ERROR');
    expect(await db.notificationLog.count({ where: { relatedId: data.contract.id } })).toBe(0);
  });
});

describe('FINANCE and canonical postcommit event contract', () => {
  it.each(operations)('FINANCE current independently granted %s', async (operation) => {
    const data = await fixture(),
      actor = operation === 'regenerateSignedContractPdfs' ? owner : maker;
    let id = data.document.id;
    if (['getDocument', 'getDocuments', 'downloadDocument', 'getSignedUrl'].includes(operation))
      id = (await http('generateDocument', data.contract.id, id, owner, 'FINANCE').expect(201)).body
        .id;
    const response = await http(operation, data.contract.id, id, actor, 'FINANCE');
    expect(response.status).toBe(
      operation.startsWith('generate') || operation === 'regenerateSignedContractPdfs' ? 201 : 200,
    );
    if (operation === 'regenerateSignedContractPdfs') {
      expect(response.body.total).toBeLessThanOrEqual(10);
      expect(response.body.results.length).toBe(response.body.total);
      expect(response.body.hasMore).toBe(true);
    }
  });
  it('real retained event binds both original template choices/dependencies; caller IDs cannot substitute', async () => {
    const data = await fixture(owner),
      response = await http(
        'generateSignedDocuments',
        data.contract.id,
        data.document.id,
        owner,
      ).expect(201);
    expect(response.body.status).toBe('SUCCESS');
    const contract = await db.generatedDocumentIdentity.findUniqueOrThrow({
        where: { documentId: response.body.contract.id },
      }),
      pdpa = await db.generatedDocumentIdentity.findUniqueOrThrow({
        where: { documentId: response.body.pdpa.id },
      });
    const signatureIds = (
      await db.signature.findMany({
        where: { contractId: data.contract.id, deletedAt: null },
        select: { id: true },
      })
    ).map((s) => s.id);
    const event = await db.signedDocumentProductionEvent.create({
      data: {
        contractId: data.contract.id,
        sourceRevision: contract.sourceRevision,
        signatureIds,
        producerKind: 'CANONICAL_SIGNATURE_COMPLETION',
        contractManifest: contract.manifest!,
        pdpaManifest: pdpa.manifest!,
        contractDependencyRevision: contract.dependencyRevision,
        pdpaDependencyRevision: pdpa.dependencyRevision,
      },
    });
    const service = app.get(GeneratedDocumentsService);
    expect(await service.verifyCommittedSignatureEvent(event.id)).toMatchObject({
      kind: 'committed-signature-production',
      templateSource: 'BUILTIN',
      contractDependencyRevision: contract.dependencyRevision,
    });
    await expect(service.verifyCommittedSignatureEvent(owner)).rejects.toThrow();
    await expect(
      db.signedDocumentProductionEvent.update({
        where: { id: event.id },
        data: { sourceRevision: '0'.repeat(64) },
      }),
    ).rejects.toThrow();
    await db.systemConfig.upsert({
      where: { key: 'company_name_en' },
      create: { key: 'company_name_en', value: randomUUID() },
      update: { value: randomUUID() },
    });
    await expect(service.verifyCommittedSignatureEvent(event.id)).rejects.toThrow();
  });
  it('retained custom event cannot grant raw-template production authority', async () => {
    const data = await fixture(owner),
      a = await request(app.getHttpServer())
        .post(`/contracts/${data.contract.id}/generate-document?company=SHOP`)
        .set('x-test-user', owner)
        .send({ documentType: 'CONTRACT' })
        .expect(201),
      b = await http('generatePdpaDocument', data.contract.id, data.document.id, owner).expect(201);
    const contract = await db.generatedDocumentIdentity.findUniqueOrThrow({
        where: { documentId: a.body.id },
      }),
      pdpa = await db.generatedDocumentIdentity.findUniqueOrThrow({
        where: { documentId: b.body.id },
      });
    const event = await db.signedDocumentProductionEvent.create({
      data: {
        contractId: data.contract.id,
        sourceRevision: contract.sourceRevision,
        signatureIds: (
          await db.signature.findMany({
            where: { contractId: data.contract.id },
            select: { id: true },
          })
        ).map((s) => s.id),
        producerKind: 'CANONICAL_SIGNATURE_COMPLETION',
        contractManifest: contract.manifest!,
        pdpaManifest: pdpa.manifest!,
        contractDependencyRevision: contract.dependencyRevision,
        pdpaDependencyRevision: pdpa.dependencyRevision,
      },
    });
    await expect(
      app.get(GeneratedDocumentsService).verifyCommittedSignatureEvent(event.id),
    ).rejects.toThrow();
  });
  it('new canonical setting inserted during upload fences final commit', async () => {
    const data = await fixture(owner);
    await db.systemConfig.deleteMany({ where: { key: 'company_tax_id' } });
    storage.uploadOwned.mockImplementationOnce(async (key, bytes) => {
      files.set(key, Buffer.from(bytes));
      await db.systemConfig.create({ data: { key: 'company_tax_id', value: 'OWNED-INSERT' } });
    });
    await http('generateDocument', data.contract.id, data.document.id, owner).expect(400);
    expect(
      await db.generatedDocumentIdentity.count({ where: { contractId: data.contract.id } }),
    ).toBe(0);
  });
  it('stored MIME and size claims cannot establish generated identity', async () => {
    const data = await fixture(owner);
    render.mockResolvedValueOnce(Buffer.from('not PDF'));
    await http('generateDocument', data.contract.id, data.document.id, owner).expect(400);
    expect(storage.uploadOwned).not.toHaveBeenCalled();
  });
});

describe('complete same-Customer proof and pre-effect bounds', () => {
  it('cannot combine Customer read on FINANCE with all-five visibility only on SHOP', async () => {
    const actor = await user();
    await grant(
      actor,
      permissions.filter((k) => k !== 'customers.read'),
    );
    await grant(actor, ['customers.read'], branch, 'FINANCE');
    const data = await fixture(actor);
    await http('generateDocument', data.contract.id, data.document.id, actor).expect(403);
    const response = await http('getDocuments', data.contract.id, data.document.id, actor).expect(
      200,
    );
    expect(response.body).toMatchObject({ availability: 'unavailable', total: null, data: [] });
    expect(render).not.toHaveBeenCalled();
  });
  it.each(['deleted', 'merged'])(
    'invalid %s canonical Customer denies metadata and bytes',
    async (state) => {
      const data = await produced(owner);
      const replacement = state === 'merged' ? (await fixture(owner)).customer.id : undefined;
      await db.customer.update({
        where: { id: data.customer.id },
        data: state === 'deleted' ? { deletedAt: new Date() } : { mergedIntoId: replacement },
      });
      await http('getDocuments', data.contract.id, data.id, owner).expect(403);
      await http('downloadDocument', data.contract.id, data.id, owner).expect(403);
      expect(storage.getStream).not.toHaveBeenCalled();
    },
  );
  it('an unverified selected DEVICE_PHOTO cannot be omitted or fetched', async () => {
    const data = await fixture(owner);
    await db.contractDocument.create({
      data: {
        contractId: data.contract.id,
        documentType: 'DEVICE_PHOTO',
        fileName: 'device.png',
        originalName: 'device.png',
        fileUrl: 'https://private.invalid/photo',
        fileHash: '0'.repeat(64),
        fileSize: 1,
        mimeType: 'image/png',
        uploadedById: owner,
      },
    });
    const template = await db.contractTemplate.create({
      data: {
        name: 'Owned photo source',
        type: 'STORE_DIRECT',
        contentHtml: '<div>{device_photos_grid}</div>',
        isActive: true,
      },
    });
    await request(app.getHttpServer())
      .post(`/contracts/${data.contract.id}/generate-document?company=SHOP`)
      .set('x-test-user', owner)
      .send({ documentType: 'CONTRACT', templateId: template.id })
      .expect(403);
    await db.contractTemplate.update({ where: { id: template.id }, data: { isActive: false } });
    expect(render).not.toHaveBeenCalled();
    expect(storage.getStream).not.toHaveBeenCalled();
  });
  it('template and signature cardinality caps reject before effects', async () => {
    const data = await fixture(owner),
      template = await db.contractTemplate.create({
        data: {
          name: 'Owned oversize',
          type: 'STORE_DIRECT',
          contentHtml: 'x'.repeat(2 * 1024 * 1024 + 1),
          isActive: true,
        },
      });
    await request(app.getHttpServer())
      .post(`/contracts/${data.contract.id}/generate-document?company=SHOP`)
      .set('x-test-user', owner)
      .send({ documentType: 'CONTRACT', templateId: template.id })
      .expect(400);
    expect(render).not.toHaveBeenCalled();
    await db.contractTemplate.update({ where: { id: template.id }, data: { isActive: false } });
    await db.signature.createMany({
      data: Array.from({ length: 17 }, () => ({
        contractId: data.contract.id,
        signerType: 'WITNESS_1' as const,
        signatureImage: 'data:image/png;base64,aA==',
      })),
    });
    await http('generateDocument', data.contract.id, data.document.id, owner).expect(400);
    expect(render).not.toHaveBeenCalled();
  });
  it('current actor revoked during acquisition releases no file headers or bytes', async () => {
    const actor = await user();
    await grant(actor);
    const data = await produced(actor);
    storage.getStream.mockImplementationOnce(async (key) => {
      await db.user.update({ where: { id: actor }, data: { isActive: false } });
      return Readable.from([files.get(key)!]);
    });
    const response = await http('downloadDocument', data.contract.id, data.id, actor).expect(403);
    expect(response.headers['content-disposition']).toBeUndefined();
    expect(response.text).not.toContain('OWNED_GENERATED_DOCUMENT');
  });
  it('owner batch stops future effects after current owner revocation', async () => {
    const actor = await user('OWNER');
    render.mockImplementationOnce(async () => {
      await db.user.update({ where: { id: actor }, data: { role: 'SALES' } });
      return pdf;
    });
    const data = await fixture(actor),
      response = await http(
        'regenerateSignedContractPdfs',
        data.contract.id,
        data.document.id,
        actor,
      ).expect(201);
    expect(render).toHaveBeenCalledTimes(1);
    expect(response.body.total).toBeLessThanOrEqual(10);
    expect(
      response.body.results.some((r: { status: string }) => r.status === 'NOT_ATTEMPTED'),
    ).toBe(true);
    expect(storage.uploadOwned).toHaveBeenCalledTimes(1);
  });
});

describe('generated producer pair database constraints', () => {
  it.each([
    ['MANAGED_SOURCE', null],
    ['LEGACY_CURRENT_ROLE', 'SHOP'],
    ['UNKNOWN', null],
    ['MANAGED_SOURCE', 'UNKNOWN'],
  ])(
    'rejects %s/%s even with otherwise genuine source data',
    async (producerKind, creationCompany) => {
      const data = await produced(owner),
        id = randomUUID(),
        token = randomUUID(),
        key = `owned-invalid/${randomUUID()}.pdf`;
      await expect(
        db.$executeRaw`INSERT INTO generated_document_identities(id,document_id,contract_id,customer_id,branch_id,producer_kind,creation_company,operation_token,storage_key,mime_type,file_size,file_hash,source_revision,dependency_revision,document_type,source_complete,manifest) SELECT ${id},${data.document.id},contract_id,customer_id,branch_id,${producerKind},${creationCompany},${token},${key},mime_type,file_size,file_hash,source_revision,dependency_revision,document_type,source_complete,manifest FROM generated_document_identities WHERE id=${data.identity.id}`,
      ).rejects.toThrow(/check constraint/);
    },
  );
});

describe('fix1 generated attachment retry and reference authority', () => {
  async function signed(actor = maker) {
    const data = await fixture(actor);
    await http('generateSignedDocuments', data.contract.id, data.document.id, owner).expect(201);
    const attachment = await db.contractDocument.findFirstOrThrow({
      where: { contractId: data.contract.id, documentType: 'SIGNED_CONTRACT' },
    });
    return { ...data, attachment };
  }
  it('retries a real aborted generated attachment release and commits exactly one byte release', async () => {
    const data = await signed();
    await db.$executeRawUnsafe('CREATE SEQUENCE owned_generated_retry_seq');
    await db.$executeRawUnsafe(
      `CREATE FUNCTION owned_generated_retry() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.document_id='${data.attachment.id}' AND NEW.action='CONTENT_RELEASE_AUTHORIZED' AND nextval('owned_generated_retry_seq')=1 THEN RAISE EXCEPTION 'OWNED_RETRY' USING ERRCODE='40001'; END IF; RETURN NEW; END; $$`,
    );
    await db.$executeRawUnsafe(
      'CREATE TRIGGER owned_generated_retry BEFORE INSERT ON document_audit_logs FOR EACH ROW EXECUTE FUNCTION owned_generated_retry()',
    );
    try {
      storage.getStream.mockClear();
      const response = await request(app.getHttpServer())
        .get(`/contracts/${data.contract.id}/documents/${data.attachment.id}/content?company=SHOP`)
        .set('x-test-user', maker)
        .expect(200);
      expect(response.body).toEqual(pdf);
      expect(storage.getStream).toHaveBeenCalledTimes(1);
      expect(
        await db.documentAuditLog.count({
          where: { documentId: data.attachment.id, action: 'CONTENT_RELEASE_AUTHORIZED' },
        }),
      ).toBe(1);
      expect(
        await db.auditLog.count({
          where: { entityId: data.attachment.id, action: 'CONTRACT_DOCUMENT_CONTENT' },
        }),
      ).toBe(1);
      const [sequence] = await db.$queryRaw<
        Array<{ last_value: bigint }>
      >`SELECT last_value FROM owned_generated_retry_seq`;
      expect(sequence.last_value).toBe(2n);
    } finally {
      await db.$executeRawUnsafe('DROP TRIGGER owned_generated_retry ON document_audit_logs');
      await db.$executeRawUnsafe('DROP FUNCTION owned_generated_retry()');
      await db.$executeRawUnsafe('DROP SEQUENCE owned_generated_retry_seq');
    }
  });
  it.each(['products.read', 'employees.read', 'deleted-product'] as const)(
    'shared generated list/history/checklist enforce original %s',
    async (missing) => {
      const actor = await user();
      await grant(
        actor,
        permissions.filter((key) => key !== missing),
      );
      const data = await signed(actor);
      if (missing === 'deleted-product')
        await db.product.update({
          where: { id: data.contract.productId },
          data: { deletedAt: new Date() },
        });
      for (const suffix of ['', '/audit-trail', '/checklist']) {
        const response = await request(app.getHttpServer())
          .get(`/contracts/${data.contract.id}/documents${suffix}?company=SHOP`)
          .set('x-test-user', actor);
        if (missing === 'deleted-product') expect(response.status).toBe(403);
        else {
          expect(response.status).toBe(200);
          expect(response.body.availability).toBe('unavailable');
          expect(JSON.stringify(response.body)).not.toContain(data.attachment.id);
          if (suffix === '/checklist') expect(response.body.complete).toBeNull();
          else expect(response.body).toMatchObject({ data: [], total: null });
        }
      }
    },
  );
});

describe('fix1 current authority and selection fences', () => {
  it.each(operations)(
    '%s rechecks current actor after successful preflight and a real authority lock wait',
    async (operation) => {
      const actor = await user('OWNER');
      const data = await produced(actor);
      render.mockClear();
      storage.uploadOwned.mockClear();
      storage.getStream.mockClear();
      const boundary = app.get(AccessGeneratedDocumentsBoundaries),
        original = boundary.preflight.bind(boundary);
      let release!: () => void,
        blocker: Promise<unknown> | undefined,
        pid = 0;
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      const preflight = jest
        .spyOn(boundary, 'preflight')
        .mockImplementationOnce(async (op, req) => {
          const result = await original(op, req);
          let ready!: () => void;
          const started = new Promise<void>((resolve) => {
            ready = resolve;
          });
          blocker = db.$transaction(
            async (tx) => {
              const [row] = await tx.$queryRaw<
                Array<{ pid: number }>
              >`SELECT pg_backend_pid() AS pid`;
              pid = row.pid;
              await tx.user.update({ where: { id: actor }, data: { isActive: false } });
              ready();
              await held;
            },
            { timeout: 15000 },
          );
          await started;
          return result;
        });
      try {
        const pending = http(operation, data.contract.id, data.id, actor).then(
          (response) => response,
        );
        const end = Date.now() + 5000;
        while (!pid && Date.now() < end) await new Promise((resolve) => setTimeout(resolve, 5));
        expect(pid).not.toBe(0);
        await blockedBy(pid);
        release();
        await blocker;
        const response = await pending;
        expect(response.status).toBe(403);
        expect(response.headers['content-disposition']).toBeUndefined();
        expect(render).not.toHaveBeenCalled();
        expect(storage.uploadOwned).not.toHaveBeenCalled();
        expect(storage.getStream).not.toHaveBeenCalled();
        expect(
          await db.generatedDocumentIdentity.count({ where: { contractId: data.contract.id } }),
        ).toBe(1);
      } finally {
        release();
        await blocker;
        preflight.mockRestore();
      }
    },
  );
  it.each(['role', 'branch'] as const)(
    'legacy current %s change during render rejects final generation',
    async (change) => {
      const actor = await user();
      await db.user.update({ where: { id: actor }, data: { accessManaged: false } });
      const data = await fixture(actor);
      const foreign = await db.branch.create({
        data: {
          name: 'Legacy moved',
          companyId: (await db.companyInfo.findUniqueOrThrow({ where: { companyCode: 'SHOP' } }))
            .id,
        },
      });
      render.mockImplementationOnce(async () => {
        await db.user.update({
          where: { id: actor },
          data: change === 'role' ? { role: 'ACCOUNTANT' } : { branchId: foreign.id },
        });
        return pdf;
      });
      await http('generateDocument', data.contract.id, data.document.id, actor).expect(403);
      expect(
        await db.generatedDocumentIdentity.count({ where: { contractId: data.contract.id } }),
      ).toBe(0);
      expect(storage.deleteOwned).toHaveBeenCalledTimes(1);
    },
  );
  it.each(['insert', 'reorder'] as const)(
    'template selection %s during upload rejects the final source fence',
    async (change) => {
      const data = await fixture(owner),
        ids: string[] = [];
      const old = await db.contractTemplate.create({
        data: {
          name: 'Old candidate',
          type: 'STORE_DIRECT',
          contentHtml: '<p>OLD</p>',
          isActive: true,
          updatedAt: new Date('2030-01-01'),
        },
      });
      ids.push(old.id);
      const selected = await db.contractTemplate.create({
        data: {
          name: 'Selected',
          type: 'STORE_DIRECT',
          contentHtml: '<p>SELECTED</p>',
          isActive: true,
          updatedAt: new Date('2031-01-01'),
        },
      });
      ids.push(selected.id);
      storage.uploadOwned.mockImplementationOnce(async (key, bytes) => {
        files.set(key, bytes);
        if (change === 'insert')
          ids.push(
            (
              await db.contractTemplate.create({
                data: {
                  name: 'Inserted',
                  type: 'STORE_DIRECT',
                  contentHtml: '<p>INSERTED</p>',
                  isActive: true,
                  updatedAt: new Date('2032-01-01'),
                },
              })
            ).id,
          );
        else
          await db.contractTemplate.update({
            where: { id: old.id },
            data: { updatedAt: new Date('2032-01-01') },
          });
      });
      try {
        await request(app.getHttpServer())
          .post(`/contracts/${data.contract.id}/generate-document?company=SHOP`)
          .set('x-test-user', owner)
          .send({ documentType: 'CONTRACT' })
          .expect(400);
        expect(render).toHaveBeenCalledTimes(1);
        expect(
          await db.generatedDocumentIdentity.count({ where: { contractId: data.contract.id } }),
        ).toBe(0);
        expect(storage.deleteOwned).toHaveBeenCalledTimes(1);
      } finally {
        await db.contractTemplate.updateMany({
          where: { id: { in: ids } },
          data: { isActive: false },
        });
      }
    },
  );
  async function photo(contractId: string) {
    const png =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZ1kAAAAASUVORK5CYII=';
    const response = await request(app.getHttpServer())
      .post(`/contracts/${contractId}/documents?company=SHOP`)
      .set('x-test-user', owner)
      .send({ documentType: 'DEVICE_PHOTO', fileName: 'owned.png', fileUrl: png })
      .expect(201);
    return response.body.id as string;
  }
  it.each(['insert', 'reorder'] as const)(
    'selected photo %s during upload rejects the final source fence',
    async (change) => {
      const data = await fixture(owner);
      const first = await photo(data.contract.id),
        second = await photo(data.contract.id);
      // Canonical upload versions one type. Retained real identities remain valid;
      // deliberately select both as a two-photo gallery for ordering proof.
      await db.contractDocument.update({
        where: { id: first },
        data: { isLatest: true, createdAt: new Date('2020-01-01') },
      });
      await db.contractDocument.update({
        where: { id: second },
        data: { createdAt: new Date('2021-01-01') },
      });
      const template = await db.contractTemplate.create({
        data: {
          name: 'Photo fence',
          type: 'STORE_DIRECT',
          contentHtml: '<div>{device_photos_grid}</div>',
          isActive: true,
        },
      });
      storage.uploadOwned.mockImplementationOnce(async (key, bytes) => {
        files.set(key, bytes);
        if (change === 'insert') await photo(data.contract.id);
        else
          await db.contractDocument.update({
            where: { id: first },
            data: { createdAt: new Date('2022-01-01') },
          });
      });
      try {
        await request(app.getHttpServer())
          .post(`/contracts/${data.contract.id}/generate-document?company=SHOP`)
          .set('x-test-user', owner)
          .send({ documentType: 'CONTRACT', templateId: template.id })
          .expect(400);
        expect(render).toHaveBeenCalledTimes(1);
        expect(
          await db.generatedDocumentIdentity.count({ where: { contractId: data.contract.id } }),
        ).toBe(0);
        expect(storage.deleteOwned).toHaveBeenCalledTimes(1);
      } finally {
        await db.contractTemplate.update({ where: { id: template.id }, data: { isActive: false } });
      }
    },
  );
  it.each(['payment', 'signature', 'consent', 'photo'] as const)(
    'retained original %s reparenting rejects even the owner',
    async (kind) => {
      const data = await fixture(owner),
        other = await fixture(owner);
      let inputId: string, templateId: string | undefined;
      if (kind === 'payment')
        inputId = (
          await db.payment.create({
            data: {
              contractId: data.contract.id,
              installmentNo: 1,
              dueDate: new Date(),
              amountDue: 1000,
            },
          })
        ).id;
      else if (kind === 'signature')
        inputId = (await db.signature.findFirstOrThrow({ where: { contractId: data.contract.id } }))
          .id;
      else if (kind === 'consent') inputId = data.contract.pdpaConsentId!;
      else {
        inputId = await photo(data.contract.id);
        templateId = (
          await db.contractTemplate.create({
            data: {
              name: 'Retained photo',
              type: 'STORE_DIRECT',
              contentHtml: '<div>{device_photos_grid}</div>',
              isActive: true,
            },
          })
        ).id;
      }
      try {
        const response = await request(app.getHttpServer())
          .post(`/contracts/${data.contract.id}/generate-document?company=SHOP`)
          .set('x-test-user', owner)
          .send({
            documentType: 'CONTRACT',
            ...(templateId ? { templateId } : { templateSource: 'BUILTIN' }),
          })
          .expect(201);
        await http('downloadDocument', data.contract.id, response.body.id, owner).expect(200);
        if (kind === 'payment')
          await db.payment.update({
            where: { id: inputId },
            data: { contractId: other.contract.id },
          });
        else if (kind === 'signature')
          await db.signature.update({
            where: { id: inputId },
            data: { contractId: other.contract.id },
          });
        else if (kind === 'consent')
          await db.pDPAConsent.update({
            where: { id: inputId },
            data: { customerId: other.customer.id },
          });
        else
          await db.contractDocument.update({
            where: { id: inputId },
            data: { contractId: other.contract.id },
          });
        storage.getStream.mockClear();
        await http('downloadDocument', data.contract.id, response.body.id, owner).expect(403);
        await http('getDocument', data.contract.id, response.body.id, owner).expect(403);
        expect(storage.getStream).not.toHaveBeenCalled();
      } finally {
        if (templateId)
          await db.contractTemplate.update({
            where: { id: templateId },
            data: { isActive: false },
          });
      }
    },
  );
});
