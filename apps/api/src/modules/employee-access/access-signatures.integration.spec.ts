import { currentDomainAccess } from './access-execution-context';
import sharp from 'sharp';
import { AccessSignaturesBoundaries } from './access-signatures-boundaries';
import { ContractSignaturesAccessService } from '../contracts/services/contract-signatures-access.service';
import { ContractDocumentsController } from '../contracts/contract-documents.controller';
import { GeneratedDocumentsService } from '../contracts/services/generated-documents.service';
import { AccessGeneratedDocumentsBoundaries } from './access-generated-documents-boundaries';
import { randomUUID, createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { ExecutionContext, INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { Request, Response, json } from 'express';
import { Prisma, PrismaClient } from '@prisma/client';
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
  !url?.includes('/bc_access_signatures?host=/tmp/bc-access-signatures.') ||
  process.env.DATABASE_URL !== url ||
  process.env.DATABASE_URL_FINANCE !== url
)
  throw new Error('Both URLs must be the owned signatures cluster');
const db = new PrismaClient({ datasources: { db: { url } } });
const snapshots = new AccessSnapshotService(db as PrismaService);
const marker = randomUUID();
const pdf = Buffer.from('%PDF-1.4\n% OWNED_GENERATED_DOCUMENT\n%%EOF');
const files = new Map<string, Buffer>();
const auditPromises = new Set<Promise<unknown>>();
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
const realRender = DocumentRenderingService.prototype.htmlToPdf;
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
  'contract-documents.update',
  'contract-documents.export',
  'sensitive.customer-identity.read',
  'sensitive.cost.read',
  'sensitive.profit.read',
  'sensitive.salary.read',
  'sensitive.seller-bank.read',
];
const operations = ['signContract', 'getSignatures', 'deleteSignature'] as const;
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
async function fixture(actor = maker, signed = false) {
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
        create: (signed ? (['CUSTOMER'] as const) : []).map((signerType) => ({
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
let raster =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZ1kAAAAASUVORK5CYII=';
function http(
  operation: Operation,
  contractId: string,
  actor = maker,
  body: Record<string, unknown> = {},
  query: Record<string, string> = {},
) {
  const path =
    operation === 'signContract'
      ? `/contracts/${contractId}/sign`
      : operation === 'deleteSignature'
        ? `/contracts/${contractId}/signatures/CUSTOMER`
        : `/contracts/${contractId}/signatures`;
  const method =
    operation === 'signContract' ? 'post' : operation === 'deleteSignature' ? 'delete' : 'get';
  const client = request(app.getHttpServer());
  return client[method](path)
    .query({ company: 'SHOP', ...query })
    .set('x-test-user', actor)
    .expect('x-owned-signatures-app', marker)
    .send(
      method === 'post' ? { signerType: 'CUSTOMER', signatureImage: raster, ...body } : undefined,
    );
}
beforeAll(async () => {
  raster =
    'data:image/png;base64,' +
    (
      await sharp({
        create: { width: 32, height: 16, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 1 } },
      })
        .png()
        .toBuffer()
    ).toString('base64');
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
    providers: [
      AccessSignaturesBoundaries,
      ContractSignaturesAccessService,
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
  app = module.createNestApplication({ logger: false, bodyParser: false });
  app.use(json({ limit: '1mb' }));
  app.use((_req: Request, res: Response, next: () => void) => {
    res.setHeader('x-owned-signatures-app', marker);
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
  console.log(
    'OWNED_SIGNATURES_HTTP',
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

describe('signature exact three — owned HTTP/PG PRE-RUNTIME RED', () => {
  it.each(operations)('useful current authorized %s reaches finite contract', async (operation) => {
    const { contract } = await fixture(maker, operation !== 'signContract');
    const response = await http(operation, contract.id);
    expect(response.status).toBe(operation === 'signContract' ? 201 : 200);
    if (operation === 'signContract')
      expect(response.body).toMatchObject({ status: 'CAPTURED', signerType: 'CUSTOMER' });
    if (operation === 'deleteSignature')
      expect(response.body).toMatchObject({ status: 'DELETED', signerType: 'CUSTOMER' });
    if (operation === 'getSignatures')
      expect(response.body).toMatchObject({ availability: 'AVAILABLE', total: 1 });
  });
  it.each(operations)('no-grant %s denies without mutation', async (operation) => {
    const { contract } = await fixture(maker, true);
    await http(operation, contract.id, denied).expect(403);
    expect(await db.signature.count({ where: { contractId: contract.id, deletedAt: null } })).toBe(
      1,
    );
  });
  it('owner capture returns finite acknowledgement with no private evidence', async () => {
    const { contract } = await fixture(owner);
    const response = await http('signContract', contract.id, owner, {
      signerName: 'PRIVATE_SIGNER',
      gpsLatitude: 13,
      gpsLongitude: 100,
    });
    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({ status: 'CAPTURED', signerType: 'CUSTOMER' });
    expect(JSON.stringify(response.body)).not.toMatch(
      /PRIVATE_SIGNER|data:image|contractHash|ipAddress|deviceInfo|gpsLatitude/,
    );
  });
  it('owner presence list omits arbitrary image/name/device/hash evidence', async () => {
    const { contract } = await fixture(owner, true);
    const response = await http('getSignatures', contract.id, owner);
    expect(response.status).toBe(200);
    expect(JSON.stringify(response.body)).not.toMatch(
      /data:image|signatureImage|signatureSvg|signerName|contractHash|ipAddress|deviceInfo|gpsLatitude/,
    );
    expect(response.body).toMatchObject({ availability: 'AVAILABLE', total: 1 });
  });
  it('owner rejects MIME-declared arbitrary image bytes before capture', async () => {
    const { contract } = await fixture(owner);
    const response = await http('signContract', contract.id, owner, {
      signatureImage: 'data:image/png;base64,SGVsbG8=',
    });
    expect(response.status).toBe(400);
    expect(await db.signature.count({ where: { contractId: contract.id } })).toBe(0);
  });
  it('owner rejects free SVG input before capture', async () => {
    const { contract } = await fixture(owner);
    await http('signContract', contract.id, owner, {
      signatureSvg: '<svg onload="PRIVATE_SCRIPT()"/>',
    }).expect(400);
    expect(await db.signature.count({ where: { contractId: contract.id } })).toBe(0);
  });
  it('owner rejects out-of-range GPS before capture', async () => {
    const { contract } = await fixture(owner);
    await http('signContract', contract.id, owner, { gpsLatitude: 200, gpsLongitude: 400 }).expect(
      400,
    );
    expect(await db.signature.count({ where: { contractId: contract.id } })).toBe(0);
  });
  it('owner rejects permissive partial numeric pagination', async () => {
    const { contract } = await fixture(owner, true);
    await http('getSignatures', contract.id, owner, {}, { page: '1garbage' }).expect(400);
  });
  it('canonical STAFF COMPANY alias duplicate remains rejected', async () => {
    const { contract } = await fixture(owner);
    await http('signContract', contract.id, owner, { signerType: 'STAFF' }).expect(201);
    await http('signContract', contract.id, owner, { signerType: 'COMPANY' }).expect(400);
    expect(await db.signature.count({ where: { contractId: contract.id, deletedAt: null } })).toBe(
      1,
    );
  });
  it('canonical active state remains rejected', async () => {
    const { contract } = await fixture(owner);
    await db.contract.update({ where: { id: contract.id }, data: { status: 'ACTIVE' } });
    await http('signContract', contract.id, owner).expect(403);
    expect(await db.signature.count({ where: { contractId: contract.id } })).toBe(0);
  });
  it('delete invalidates current generated evidence while retaining rows', async () => {
    const { contract, document } = await fixture(owner, true);
    await http('deleteSignature', contract.id, owner).expect(200);
    expect(
      (await db.signature.findFirstOrThrow({ where: { contractId: contract.id } })).deletedAt,
    ).not.toBeNull();
    expect(
      (await db.eDocument.findUniqueOrThrow({ where: { id: document.id } })).deletedAt,
    ).not.toBeNull();
  });
});

async function grant(
  actor: string,
  keys: PermissionKey[],
  companyCode: 'SHOP' | 'FINANCE' = 'SHOP',
  branchId = branch,
) {
  const position = await db.accessPosition.create({
    data: { code: randomUUID(), name: 'Owned signature scope', permissions: keys },
  });
  await db.employeeAccessAssignment.create({
    data: {
      userId: actor,
      positionId: position.id,
      companyCode,
      scope: 'BRANCHES',
      branches: { create: { branchId } },
    },
  });
}
async function captureSet(actor = maker, options: { last?: boolean; builtin?: boolean } = {}) {
  const data = await fixture(actor);
  for (const signerType of [
    'CUSTOMER',
    'COMPANY',
    'WITNESS_1',
    ...(options.last ? ['WITNESS_2'] : []),
  ]) {
    await http('signContract', data.contract.id, actor, {
      signerType,
      ...(options.builtin !== false ? { templateSource: 'BUILTIN' } : {}),
    }).expect(201);
  }
  return data;
}
async function blockedBy(pid: number) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const rows = await db.$queryRaw<
      Array<{ blocked: boolean }>
    >`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE ${pid}=ANY(pg_blocking_pids(pid))) AS blocked`;
    if (rows[0].blocked) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('Owned authority lock wait not observed');
}
describe('signature source, projection and inputs', () => {
  it('normalizes new raster, retains exact original privately and protects immutable identity', async () => {
    const data = await fixture(maker);
    const response = await http('signContract', data.contract.id, maker, {
      signerName: 'PRIVATE_SIGNER',
    }).expect(201);
    const identity = await db.signatureCaptureIdentity.findUniqueOrThrow({
      where: { signatureId: response.body.id },
    });
    expect(identity.originalDataUrl).toBe(raster);
    const row = await db.signature.findUniqueOrThrow({ where: { id: response.body.id } });
    expect(row.signatureImage).toMatch(/^data:image\/png;base64,/);
    expect(identity.canonicalSize).toBe(
      Buffer.from(row.signatureImage.split(',')[1], 'base64').length,
    );
    await expect(
      db.signatureCaptureIdentity.update({
        where: { id: identity.id },
        data: { customerId: randomUUID() },
      }),
    ).rejects.toThrow();
    const presence = await http('getSignatures', data.contract.id).expect(200);
    expect(JSON.stringify(presence.body)).not.toMatch(
      /PRIVATE_SIGNER|data:image|Hash|originalData/,
    );
    const evidence = await http(
      'getSignatures',
      data.contract.id,
      maker,
      {},
      { view: 'EVIDENCE' },
    ).expect(200);
    expect(evidence.body.data[0]).toMatchObject({
      signatureImage: row.signatureImage,
      signerName: 'PRIVATE_SIGNER',
      evidenceStatus: 'VERIFIED',
    });
    expect(JSON.stringify(evidence.body)).not.toMatch(
      /originalDataUrl|contractHash|ipAddress|deviceInfo|gpsLatitude/,
    );
  });
  it('capture works without sensitive or generated privileges and independently denies evidence', async () => {
    const actor = await user();
    await grant(actor, [
      'contracts.read',
      'contracts.update',
      'contract-documents.update',
      'documents.read',
      'customers.read',
      'products.read',
    ]);
    const data = await captureSet(actor);
    const response = await http('signContract', data.contract.id, actor, {
      signerType: 'WITNESS_2',
      templateSource: 'BUILTIN',
    }).expect(201);
    expect(response.body.production).toBe('UNAVAILABLE');
    expect(
      await db.signedDocumentProductionEvent.count({ where: { contractId: data.contract.id } }),
    ).toBe(0);
    const evidence = await http(
      'getSignatures',
      data.contract.id,
      actor,
      {},
      { view: 'EVIDENCE' },
    ).expect(200);
    expect(evidence.body).toMatchObject({ availability: 'UNAVAILABLE', data: null, total: null });
    expect(render).not.toHaveBeenCalled();
  });
  it('historical managed private evidence is unverified but finite presence stays useful', async () => {
    const data = await fixture(maker, true);
    const evidence = await http(
      'getSignatures',
      data.contract.id,
      maker,
      {},
      { view: 'EVIDENCE' },
    ).expect(200);
    expect(evidence.body).toMatchObject({ availability: 'UNVERIFIED', data: null, total: null });
    const presence = await http('getSignatures', data.contract.id).expect(200);
    expect(presence.body.data[0].evidenceStatus).toBe('UNVERIFIED');
  });
  it.each(['customers.read', 'products.read'] as PermissionKey[])(
    'capture requires independent %s',
    async (missing) => {
      const actor = await user();
      await grant(
        actor,
        permissions.filter((k) => k !== missing),
      );
      const data = await fixture(actor);
      await http('signContract', data.contract.id, actor).expect(403);
      expect(await db.signature.count({ where: { contractId: data.contract.id } })).toBe(0);
    },
  );
  it('SHOP permission in another branch does not combine with local FINANCE permission', async () => {
    const actor = await user();
    const other = await db.branch.create({
      data: {
        name: 'Other signature branch',
        companyId: (await db.companyInfo.findUniqueOrThrow({ where: { companyCode: 'SHOP' } })).id,
      },
    });
    await grant(actor, permissions, 'SHOP', other.id);
    await grant(actor, permissions, 'FINANCE');
    const data = await fixture(actor);
    await http('signContract', data.contract.id, actor).expect(403);
    await http('signContract', data.contract.id, actor, {}, { company: 'FINANCE' }).expect(403);
  });
  it('FINANCE read uses ordinary source without allowing preparation mutation', async () => {
    const data = await fixture(maker, true);
    await http('getSignatures', data.contract.id, maker, {}, { company: 'FINANCE' }).expect(200);
    await http('deleteSignature', data.contract.id, maker, {}, { company: 'FINANCE' }).expect(403);
  });
  it('original Product permission remains necessary after Contract product replacement', async () => {
    const data = await fixture(maker);
    await http('signContract', data.contract.id).expect(201);
    const other = await db.branch.create({
      data: {
        name: 'Original private source',
        companyId: (await db.companyInfo.findUniqueOrThrow({ where: { companyCode: 'SHOP' } })).id,
      },
    });
    const replacement = await db.product.create({
      data: {
        name: 'Replacement',
        brand: 'Test',
        model: 'Test',
        category: 'PHONE_NEW',
        costPrice: 10,
        branchId: branch,
      },
    });
    await db.contract.update({
      where: { id: data.contract.id },
      data: { productId: replacement.id },
    });
    await db.product.update({
      where: { id: data.contract.productId },
      data: { branchId: other.id },
    });
    const response = await http(
      'getSignatures',
      data.contract.id,
      maker,
      {},
      { view: 'EVIDENCE' },
    ).expect(200);
    expect(response.body.availability).toBe('UNAVAILABLE');
    const allowed = await http(
      'getSignatures',
      data.contract.id,
      owner,
      {},
      { view: 'EVIDENCE' },
    ).expect(200);
    expect(allowed.body.data).toHaveLength(1);
  });
  it.each([
    { templateSource: 'OTHER' },
    { templateSource: 'BUILTIN', templateId: randomUUID() },
    { templateId: randomUUID() },
    { signerName: '\u0001bad' },
    { screenSize: '100x0' },
    { gpsLatitude: 20 },
  ])('rejects malformed capture input %# before mutation', async (body) => {
    const data = await fixture(owner);
    await http('signContract', data.contract.id, owner, body).expect(400);
    expect(await db.signature.count({ where: { contractId: data.contract.id } })).toBe(0);
  });
  it('guardian requirement prevents production until guardian signs', async () => {
    const data = await fixture(maker);
    await db.customer.update({
      where: { id: data.customer.id },
      data: { birthDate: new Date(new Date().getFullYear() - 18, 0, 1) },
    });
    for (const signerType of ['CUSTOMER', 'COMPANY', 'WITNESS_1', 'WITNESS_2']) {
      const response = await http('signContract', data.contract.id, maker, {
        signerType,
        templateSource: 'BUILTIN',
      }).expect(201);
      expect(response.body.production).toBe('NOT_COMPLETE');
    }
    const response = await http('signContract', data.contract.id, maker, {
      signerType: 'GUARDIAN',
      templateSource: 'BUILTIN',
    }).expect(201);
    expect(response.body.production).toBe('SUCCESS');
  });
});

describe('genuine canonical completion and actual outer commit', () => {
  it('produces actual paired canonical documents and claims event once after commit', async () => {
    const data = await captureSet();
    await db.customer.update({
      where: { id: data.customer.id },
      data: { lineIdFinance: 'OWNED_NO_PROVIDER' },
    });
    render.mockImplementation(async () => {
      expect(
        await db.signature.count({ where: { contractId: data.contract.id, deletedAt: null } }),
      ).toBe(4);
      expect(
        await db.signedDocumentProductionEvent.count({ where: { contractId: data.contract.id } }),
      ).toBe(1);
      return pdf;
    });
    const response = await http('signContract', data.contract.id, maker, {
      signerType: 'WITNESS_2',
      templateSource: 'BUILTIN',
    }).expect(201);
    expect(response.body.production).toBe('SUCCESS');
    const event = await db.signedDocumentProductionEvent.findFirstOrThrow({
      where: { contractId: data.contract.id },
    });
    expect(event).toMatchObject({
      initiatorUserId: maker,
      initiatorChannel: 'MANAGED_STAFF',
      selectedCompany: 'SHOP',
    });
    expect(event.signatureIds).toHaveLength(4);
    expect(
      await db.generatedDocumentIdentity.count({ where: { signatureEventId: event.id } }),
    ).toBe(2);
    expect(render).toHaveBeenCalledTimes(2);
    await Promise.all([
      app.get(GeneratedDocumentsService).consumeSignatureEvent(event.id),
      app.get(GeneratedDocumentsService).consumeSignatureEvent(event.id),
    ]);
    expect(render).toHaveBeenCalledTimes(2);
    expect(
      await db.generatedDocumentIdentity.count({ where: { contractId: data.contract.id } }),
    ).toBe(2);
    expect(
      await db.contractDocument.count({
        where: { contractId: data.contract.id, documentType: 'SIGNED_CONTRACT', isLatest: true },
      }),
    ).toBe(1);
    expect(
      await db.notificationLog.count({
        where: { relatedId: data.contract.id, subject: 'CONTRACT_DOCUMENTS_READY' },
      }),
    ).toBe(1);
  });
  it('custom choice is owner-only and never silently substitutes builtin', async () => {
    const data = await captureSet(maker, { builtin: false });
    const denied = await http('signContract', data.contract.id, maker, {
      signerType: 'WITNESS_2',
    }).expect(201);
    expect(denied.body.production).toBe('UNAVAILABLE');
    expect(render).not.toHaveBeenCalled();
    const ownerData = await captureSet(owner, { builtin: false });
    const success = await http('signContract', ownerData.contract.id, owner, {
      signerType: 'WITNESS_2',
    }).expect(201);
    expect(success.body.production).toBe('SUCCESS');
    const event = await db.signedDocumentProductionEvent.findFirstOrThrow({
      where: { contractId: ownerData.contract.id },
    });
    expect(event.contractManifest).toMatchObject({ template: { kind: 'CUSTOM' } });
  });
  it('all consumed signatures need genuine captures and current canonical hashes', async () => {
    const data = await captureSet();
    await db.signature.create({
      data: { contractId: data.contract.id, signerType: 'GUARDIAN', signatureImage: raster },
    });
    const response = await http('signContract', data.contract.id, maker, {
      signerType: 'WITNESS_2',
      templateSource: 'BUILTIN',
    }).expect(201);
    expect(response.body.production).toBe('UNAVAILABLE');
    expect(render).not.toHaveBeenCalled();
    const stale = await captureSet();
    await db.contract.update({ where: { id: stale.contract.id }, data: { sellingPrice: 12000 } });
    expect(
      (
        await http('signContract', stale.contract.id, maker, {
          signerType: 'WITNESS_2',
          templateSource: 'BUILTIN',
        }).expect(201)
      ).body.production,
    ).toBe('UNAVAILABLE');
  });
  it('required signature audit failure rolls back signature, identity and event before effects', async () => {
    const data = await captureSet();
    await db.$executeRawUnsafe(
      `CREATE FUNCTION owned_signature_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.entity='contract_signature' AND NEW.entity_id='${data.contract.id}' THEN RAISE EXCEPTION 'OWNED_REQUIRED_FAILURE'; END IF; RETURN NEW; END; $$`,
    );
    await db.$executeRawUnsafe(
      'CREATE TRIGGER owned_signature_failure BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION owned_signature_failure()',
    );
    try {
      await http('signContract', data.contract.id, maker, {
        signerType: 'WITNESS_2',
        templateSource: 'BUILTIN',
      }).expect(500);
      expect(await db.signature.count({ where: { contractId: data.contract.id } })).toBe(3);
      expect(
        await db.signatureCaptureIdentity.count({ where: { contractId: data.contract.id } }),
      ).toBe(3);
      expect(
        await db.signedDocumentProductionEvent.count({ where: { contractId: data.contract.id } }),
      ).toBe(0);
      expect(render).not.toHaveBeenCalled();
    } finally {
      await db.$executeRawUnsafe('DROP TRIGGER owned_signature_failure ON audit_logs');
      await db.$executeRawUnsafe('DROP FUNCTION owned_signature_failure()');
    }
  });
  it('actual SQLSTATE40001 outer rollback retries capture but produces only committed event once', async () => {
    const data = await captureSet();
    await db.$executeRawUnsafe('CREATE SEQUENCE owned_signature_retry_seq');
    await db.$executeRawUnsafe(
      `CREATE FUNCTION owned_signature_retry() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.entity='contract_signature' AND NEW.entity_id='${data.contract.id}' AND nextval('owned_signature_retry_seq')=1 THEN RAISE EXCEPTION 'OWNED_RETRY' USING ERRCODE='40001'; END IF; RETURN NEW; END; $$`,
    );
    await db.$executeRawUnsafe(
      'CREATE TRIGGER owned_signature_retry BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION owned_signature_retry()',
    );
    try {
      const response = await http('signContract', data.contract.id, maker, {
        signerType: 'WITNESS_2',
        templateSource: 'BUILTIN',
      }).expect(201);
      expect(response.body.production).toBe('SUCCESS');
      expect(await db.signature.count({ where: { contractId: data.contract.id } })).toBe(4);
      expect(
        await db.signedDocumentProductionEvent.count({ where: { contractId: data.contract.id } }),
      ).toBe(1);
      expect(render).toHaveBeenCalledTimes(2);
      const [sequence] = await db.$queryRaw<
        Array<{ last_value: bigint }>
      >`SELECT last_value FROM owned_signature_retry_seq`;
      expect(sequence.last_value).toBe(2n);
    } finally {
      await db.$executeRawUnsafe('DROP TRIGGER owned_signature_retry ON audit_logs');
      await db.$executeRawUnsafe('DROP FUNCTION owned_signature_retry()');
      await db.$executeRawUnsafe('DROP SEQUENCE owned_signature_retry_seq');
    }
  });
  it('postcommit render failure retains capture and finite partial outcome', async () => {
    const data = await captureSet();
    render.mockResolvedValueOnce(pdf).mockRejectedValueOnce(new Error('PRIVATE_RENDER_FAILURE'));
    const response = await http('signContract', data.contract.id, maker, {
      signerType: 'WITNESS_2',
      templateSource: 'BUILTIN',
    }).expect(201);
    expect(response.body.production).toBe('PARTIAL');
    expect(await db.signature.count({ where: { contractId: data.contract.id } })).toBe(4);
    expect(
      await db.generatedDocumentIdentity.count({ where: { contractId: data.contract.id } }),
    ).toBe(1);
    expect(await db.notificationLog.count({ where: { relatedId: data.contract.id } })).toBe(0);
    expect(JSON.stringify(response.body)).not.toContain('PRIVATE_RENDER_FAILURE');
  });
  it.each(['actor', 'contract', 'template'] as const)(
    'current %s change during renderer denies before storage effects',
    async (change) => {
      const actor = await user('OWNER');
      const data = await captureSet(actor, { builtin: change !== 'template' });
      render.mockImplementationOnce(async () => {
        if (change === 'actor')
          await db.user.update({ where: { id: actor }, data: { isActive: false } });
        if (change === 'contract')
          await db.contract.update({
            where: { id: data.contract.id },
            data: { sellingPrice: 12345 },
          });
        if (change === 'template')
          await db.contractTemplate.updateMany({
            where: { type: 'STORE_DIRECT' },
            data: { contentHtml: '<p>CHANGED_TERMS</p>' },
          });
        return pdf;
      });
      const response = await http('signContract', data.contract.id, actor, {
        signerType: 'WITNESS_2',
        ...(change !== 'template' ? { templateSource: 'BUILTIN' } : {}),
      }).expect(201);
      expect(response.body.production).toBe('FAILED');
      expect(await db.signature.count({ where: { contractId: data.contract.id } })).toBe(4);
      expect(
        await db.generatedDocumentIdentity.count({ where: { contractId: data.contract.id } }),
      ).toBe(0);
      expect(storage.uploadOwned).not.toHaveBeenCalled();
    },
  );
  it.each(operations)(
    '%s rechecks actor after successful preflight with observed PG authority lock wait',
    async (operation) => {
      const actor = await user('OWNER'),
        data = await fixture(actor, operation !== 'signContract');
      const boundary = app.get(AccessSignaturesBoundaries),
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
          await original(op, req);
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
        });
      try {
        const pending = http(operation, data.contract.id, actor).then((response) => response);
        const until = Date.now() + 5000;
        while (!pid && Date.now() < until) await new Promise((resolve) => setTimeout(resolve, 5));
        expect(pid).not.toBe(0);
        await blockedBy(pid);
        release();
        await blocker;
        expect((await pending).status).toBe(403);
        expect(
          await db.signature.count({ where: { contractId: data.contract.id, deletedAt: null } }),
        ).toBe(operation === 'signContract' ? 0 : 1);
      } finally {
        release();
        await blocker;
        preflight.mockRestore();
      }
    },
  );
});

describe('legacy channel, event constraints and consumer ownership', () => {
  it('direct unadmitted service request cannot mint or capture through a caller userId', async () => {
    const data = await fixture(owner);
    await expect(
      app.get(ContractSignaturesAccessService).capture(
        {
          user: { id: owner },
          params: { id: data.contract.id },
          query: { company: 'SHOP' },
          headers: {},
          body: {},
        },
        { signatureImage: raster, signerType: 'CUSTOMER' },
      ),
    ).rejects.toThrow();
    await expect(
      app
        .get(DocumentsService)
        .signContract(data.contract.id, raster, 'CUSTOMER', {}, { staffUserId: owner }),
    ).rejects.toThrow();
    await expect(
      app.get(DocumentsService).deleteSignature(data.contract.id, 'CUSTOMER'),
    ).rejects.toThrow();
    expect(await db.signature.count({ where: { contractId: data.contract.id } })).toBe(0);
  });
  it('genuine legacy current role signs and produces with null selected company', async () => {
    const actor = await user('OWNER');
    await db.user.update({ where: { id: actor }, data: { accessManaged: false } });
    const data = await captureSet(actor);
    const response = await http('signContract', data.contract.id, actor, {
      signerType: 'WITNESS_2',
      templateSource: 'BUILTIN',
    }).expect(201);
    expect(response.body.production).toBe('SUCCESS');
    const event = await db.signedDocumentProductionEvent.findFirstOrThrow({
      where: { contractId: data.contract.id },
    });
    expect(event).toMatchObject({
      initiatorUserId: actor,
      initiatorChannel: 'LEGACY_STAFF',
      selectedCompany: null,
    });
    await db.user.update({ where: { id: actor }, data: { role: 'VIEWER' } });
    await http('getSignatures', data.contract.id, actor).expect(403);
    // Existing terminal result cannot authorize new effects after a role change.
    expect(await app.get(GeneratedDocumentsService).consumeSignatureEvent(event.id)).toBe(
      'SUCCESS',
    );
    expect(render).toHaveBeenCalledTimes(2);
  });
  it('event initiator/channel/company CHECK rejects nullable and cross-channel pair substitutions', async () => {
    const data = await captureSet(owner, { last: true });
    const event = await db.signedDocumentProductionEvent.findFirstOrThrow({
      where: { contractId: data.contract.id },
    });
    const base = { ...event, id: undefined, createdAt: undefined };
    const invalid = [
      { initiatorChannel: null },
      { initiatorUserId: null },
      { selectedCompany: null },
      { initiatorChannel: 'LEGACY_STAFF', selectedCompany: 'SHOP' },
      { initiatorChannel: 'OTHER', selectedCompany: null },
      { templateChoice: Prisma.DbNull },
    ];
    for (const pair of invalid)
      await expect(
        db.signedDocumentProductionEvent.create({
          data: {
            ...base,
            contractManifest: base.contractManifest as Prisma.InputJsonValue,
            pdpaManifest: base.pdpaManifest as Prisma.InputJsonValue,
            templateChoice: base.templateChoice as Prisma.InputJsonValue,
            ...pair,
          },
        }),
      ).rejects.toThrow();
    await expect(
      db.signedDocumentProductionEvent.update({
        where: { id: event.id },
        data: { initiatorUserId: maker },
      }),
    ).rejects.toThrow();
  });
  it('two real concurrent consumers share a durable claim and only one renderer pipeline', async () => {
    const data = await captureSet();
    const service = app.get(GeneratedDocumentsService),
      original = service.consumeSignatureEvent.bind(service);
    const delayed = jest.spyOn(service, 'consumeSignatureEvent').mockResolvedValueOnce('PENDING');
    const capture = await http('signContract', data.contract.id, maker, {
      signerType: 'WITNESS_2',
      templateSource: 'BUILTIN',
    }).expect(201);
    expect(capture.body.production).toBe('PENDING');
    delayed.mockRestore();
    const event = await db.signedDocumentProductionEvent.findFirstOrThrow({
      where: { contractId: data.contract.id },
    });
    let release!: () => void, started!: () => void;
    const held = new Promise<void>((resolve) => {
        release = resolve;
      }),
      entered = new Promise<void>((resolve) => {
        started = resolve;
      });
    render.mockImplementationOnce(async () => {
      started();
      await held;
      return pdf;
    });
    const first = original(event.id);
    await entered;
    expect(await original(event.id)).toBe('PENDING');
    expect(render).toHaveBeenCalledTimes(1);
    release();
    expect(await first).toBe('SUCCESS');
    expect(render).toHaveBeenCalledTimes(2);
    expect(
      await db.signedDocumentProductionConsumption.count({ where: { eventId: event.id } }),
    ).toBe(1);
  });
  it('enclosing genuine transaction rollback discards inner capture/event and never starts effects', async () => {
    const data = await captureSet();
    const boundary = app.get(AccessSignaturesBoundaries),
      original = boundary.current.bind(boundary);
    let calls = 0;
    const wrap = jest.spyOn(boundary, 'current').mockImplementation(async (op, req, work) => {
      calls++;
      if (calls === 1) return original(op, req, work);
      return (
        await app.get(AccessResourceService).execute(
          maker,
          'contract-documents.update',
          'SHOP',
          undefined,
          async () => {
            await original(op, req, work);
            expect(render).not.toHaveBeenCalled();
            expect(
              await currentDomainAccess()!.client.signedDocumentProductionEvent.count({
                where: { contractId: data.contract.id },
              }),
            ).toBe(1);
            throw new Error('OWNED_OUTER_ROLLBACK');
          },
          false,
          { domain: 'parties', isolationLevel: 'Serializable' },
        )
      ).result;
    });
    try {
      await http('signContract', data.contract.id, maker, {
        signerType: 'WITNESS_2',
        templateSource: 'BUILTIN',
      }).expect(500);
      expect(await db.signature.count({ where: { contractId: data.contract.id } })).toBe(3);
      expect(
        await db.signedDocumentProductionEvent.count({ where: { contractId: data.contract.id } }),
      ).toBe(0);
      expect(render).not.toHaveBeenCalled();
    } finally {
      wrap.mockRestore();
    }
  });
  it('pending event fails after deletion and generated/uploaded attachments retain soft invalidation', async () => {
    const data = await captureSet();
    const service = app.get(GeneratedDocumentsService);
    const delay = jest.spyOn(service, 'consumeSignatureEvent').mockResolvedValueOnce('PENDING');
    await http('signContract', data.contract.id, maker, {
      signerType: 'WITNESS_2',
      templateSource: 'BUILTIN',
    }).expect(201);
    delay.mockRestore();
    const event = await db.signedDocumentProductionEvent.findFirstOrThrow({
      where: { contractId: data.contract.id },
    });
    const attachment = await db.contractDocument.create({
      data: {
        contractId: data.contract.id,
        documentType: 'SIGNED_CONTRACT',
        fileName: 'retained.pdf',
        originalName: 'retained.pdf',
        fileUrl: 'owned/retained-upload.pdf',
        fileSize: pdf.length,
        mimeType: 'application/pdf',
        uploadedById: maker,
        isLatest: true,
      },
    });
    await db.notificationLog.create({
      data: {
        channel: 'LINE',
        recipient: 'OWNED_NO_PROVIDER',
        message: 'owned',
        subject: 'CONTRACT_DOCUMENTS_READY',
        relatedId: data.contract.id,
        status: 'DELAYED',
      },
    });
    await http('deleteSignature', data.contract.id).expect(200);
    expect(await service.consumeSignatureEvent(event.id)).toBe('FAILED');
    expect(render).not.toHaveBeenCalled();
    expect(
      (await db.contractDocument.findUniqueOrThrow({ where: { id: attachment.id } })).deletedAt,
    ).not.toBeNull();
    expect(
      (await db.eDocument.findUniqueOrThrow({ where: { id: data.document.id } })).deletedAt,
    ).not.toBeNull();
    expect(
      (await db.notificationLog.findFirstOrThrow({ where: { relatedId: data.contract.id } }))
        .status,
    ).toBe('CANCELLED');
    expect(
      (
        await db.signedDocumentProductionConsumption.findUniqueOrThrow({
          where: { eventId: event.id },
        })
      ).status,
    ).toBe('FAILED');
  });
});

describe('bounded raster and actual effect integration', () => {
  it.each(['jpeg', 'webp'] as const)(
    'decodes genuine %s and displays canonical PNG',
    async (format) => {
      const encoder = sharp({
        create: { width: 16, height: 16, channels: 3, background: { r: 10, g: 30, b: 40 } },
      });
      const bytes = await encoder[format]().toBuffer();
      const data = await fixture(maker);
      const response = await http('signContract', data.contract.id, maker, {
        signatureImage: `data:image/${format};base64,${bytes.toString('base64')}`,
      }).expect(201);
      const row = await db.signature.findUniqueOrThrow({ where: { id: response.body.id } });
      expect(
        (await sharp(Buffer.from(row.signatureImage.split(',')[1], 'base64')).metadata()).format,
      ).toBe('png');
    },
  );
  it.each([
    { width: 4097, height: 1 },
    { width: 3000, height: 2000 },
  ])('rejects decoder dimensions/pixels %# before persistence', async (shape) => {
    const bytes = await sharp({
      create: { ...shape, channels: 3, background: { r: 10, g: 30, b: 40 } },
    })
      .png()
      .toBuffer();
    const data = await fixture(owner);
    await http('signContract', data.contract.id, owner, {
      signatureImage: `data:image/png;base64,${bytes.toString('base64')}`,
    }).expect(400);
    expect(await db.signature.count({ where: { contractId: data.contract.id } })).toBe(0);
  });
  it('mismatched MIME and truncated raster reject after syntactic base64 admission', async () => {
    const bytes = await sharp({
      create: { width: 32, height: 32, channels: 3, background: { r: 10, g: 30, b: 40 } },
    })
      .jpeg()
      .toBuffer();
    for (const signatureImage of [
      `data:image/png;base64,${bytes.toString('base64')}`,
      raster.slice(0, -20),
    ]) {
      const data = await fixture(owner);
      await http('signContract', data.contract.id, owner, { signatureImage }).expect(400);
      expect(await db.signature.count({ where: { contractId: data.contract.id } })).toBe(0);
    }
  });
  it('source change during actual upload cleans only this consumer staging and keeps signature', async () => {
    const data = await captureSet();
    storage.uploadOwned.mockImplementationOnce(async (key: string, bytes: Buffer) => {
      files.set(key, Buffer.from(bytes));
      await db.contract.update({ where: { id: data.contract.id }, data: { monthlyPayment: 1010 } });
    });
    const response = await http('signContract', data.contract.id, maker, {
      signerType: 'WITNESS_2',
      templateSource: 'BUILTIN',
    }).expect(201);
    expect(response.body.production).toBe('FAILED');
    expect(storage.deleteOwned).toHaveBeenCalledTimes(1);
    expect(
      await db.generatedDocumentIdentity.count({ where: { contractId: data.contract.id } }),
    ).toBe(0);
    expect(await db.signature.count({ where: { contractId: data.contract.id } })).toBe(4);
  });
  it('actual uploaded identity and generated identities remain retained but unavailable after signature deletion', async () => {
    const data = await captureSet(owner, { last: true });
    const generated = await db.generatedDocumentIdentity.findFirstOrThrow({
      where: { contractId: data.contract.id, documentType: 'CONTRACT' },
    });
    const uploaded = await request(app.getHttpServer())
      .post(`/contracts/${data.contract.id}/documents?company=SHOP`)
      .set('x-test-user', owner)
      .send({
        documentType: 'PDPA_CONSENT',
        fileName: 'owned.pdf',
        fileUrl: `data:application/pdf;base64,${pdf.toString('base64')}`,
        mimeType: 'application/pdf',
      })
      .expect(201);
    expect(
      await db.uploadedContractDocumentIdentity.count({ where: { documentId: uploaded.body.id } }),
    ).toBe(1);
    await http('deleteSignature', data.contract.id, owner).expect(200);
    expect(
      (await db.contractDocument.findUniqueOrThrow({ where: { id: uploaded.body.id } })).deletedAt,
    ).not.toBeNull();
    expect(await db.generatedDocumentIdentity.count({ where: { id: generated.id } })).toBe(1);
    expect(files.has(generated.storageKey)).toBe(true);
    await request(app.getHttpServer())
      .get(`/documents/${generated.documentId}/download?company=SHOP`)
      .set('x-test-user', owner)
      .expect(404);
  });
  it('real operation-owned Chromium renders committed canonical signature pair', async () => {
    const data = await captureSet(owner);
    render.mockImplementation(function (
      this: DocumentRenderingService,
      ...args: Parameters<DocumentRenderingService['htmlToPdf']>
    ) {
      return realRender.apply(this, args);
    });
    const response = await http('signContract', data.contract.id, owner, {
      signerType: 'WITNESS_2',
      templateSource: 'BUILTIN',
    }).expect(201);
    expect(response.body.production).toBe('SUCCESS');
    const identities = await db.generatedDocumentIdentity.findMany({
      where: { contractId: data.contract.id },
    });
    expect(identities).toHaveLength(2);
    for (const identity of identities) {
      const bytes = files.get(identity.storageKey)!;
      expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
      expect(bytes.length).toBeGreaterThan(10000);
    }
    console.log(
      'OWNED_SIGNATURE_REAL_CHROMIUM',
      identities.map((i) => ({ documentType: i.documentType, bytes: i.fileSize })),
      'actual canonical completion, retained event and bounded renderer; no provider',
    );
  }, 60000);
  it('outer audit retains finite operation outcome without capture payload', async () => {
    const data = await fixture(owner);
    await http('signContract', data.contract.id, owner, {
      signerName: 'PRIVATE_SIGNATURE_AUDIT',
      gpsLatitude: 13,
      gpsLongitude: 100,
    }).expect(201);
    await http('getSignatures', data.contract.id, owner, {}, { view: 'EVIDENCE' }).expect(200);
    await http('deleteSignature', data.contract.id, owner).expect(200);
    await Promise.allSettled([...auditPromises]);
    const logs = await db.auditLog.findMany({ where: { entityId: data.contract.id } });
    expect(logs.length).toBeGreaterThanOrEqual(6);
    expect(JSON.stringify(logs.map((l) => l.newValue))).not.toMatch(
      /PRIVATE_SIGNATURE_AUDIT|data:image|gpsLatitude|signatureImage|Hash|deviceInfo/,
    );
  });
});

it.each(['CREATING', 'REJECTED', 'PENDING_REVIEW', 'APPROVED'] as const)(
  'preserves DRAFT %s capture workflow',
  async (workflowStatus) => {
    const data = await fixture(maker);
    await db.contract.update({ where: { id: data.contract.id }, data: { workflowStatus } });
    await http('signContract', data.contract.id).expect(201);
  },
);
it('old unbound retained event is not an automatic-production grant', async () => {
  const data = await captureSet(owner, { last: true });
  const event = await db.signedDocumentProductionEvent.findFirstOrThrow({
    where: { contractId: data.contract.id },
  });
  const old = await db.signedDocumentProductionEvent.create({
    data: {
      contractId: event.contractId,
      sourceRevision: event.sourceRevision,
      signatureIds: event.signatureIds,
      contractManifest: event.contractManifest as Prisma.InputJsonValue,
      pdpaManifest: event.pdpaManifest as Prisma.InputJsonValue,
      contractDependencyRevision: event.contractDependencyRevision,
      pdpaDependencyRevision: event.pdpaDependencyRevision,
      producerKind: event.producerKind,
    },
  });
  render.mockClear();
  await expect(app.get(GeneratedDocumentsService).consumeSignatureEvent(old.id)).rejects.toThrow();
  expect(render).not.toHaveBeenCalled();
  expect(await db.signedDocumentProductionConsumption.count({ where: { eventId: old.id } })).toBe(
    0,
  );
});
