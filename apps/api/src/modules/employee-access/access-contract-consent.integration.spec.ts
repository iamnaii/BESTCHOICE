import { AccessContractConsentAuthority } from './access-contract-consent-authority';
import { PDPAService } from '../pdpa/pdpa.service';
import { createHash, randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { ExecutionContext, INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { APP_INTERCEPTOR } from '@nestjs/core';
import request from 'supertest';
import { AccessSnapshot, PermissionKey } from '@installment/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AccessSnapshotService } from './access-snapshot.service';
import { AccessResourceService } from './access-resource.service';
import { AccessPartySourceService } from './access-party-source.service';
import { AccessProcurementSourceService } from './access-procurement-source.service';
import { AccessPolicyService } from './access-policy';
import { AccessPolicyInterceptor } from './access-policy.interceptor';
import { AuditService } from '../audit/audit.service';
import { AuditInterceptor } from '../audit/audit.interceptor';
import { ContractsController } from '../contracts/contracts.controller';
import { ContractsService } from '../contracts/contracts.service';
import { ContractWorkflowService } from '../contracts/contract-workflow.service';
import { ContractPaymentService } from '../contracts/contract-payment.service';
import { ContractDocumentService } from '../contracts/contract-document.service';
import { ContractSnapshotService } from '../contracts/contract-snapshot.service';
import { ContractJournalQueryService } from '../journal/contract-journal-query.service';
import { EarlyPayoffSlipService } from '../contracts/early-payoff-slip/early-payoff-slip.service';
import { JourneyEntryWriter } from '../customer-journey/journey-entry-writer.service';
import { CustomerAccessController } from '../customer-access/customer-access.controller';
import { CustomerAccessService } from '../customer-access/customer-access.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { BranchGuard } from '../auth/guards/branch.guard';

const url = process.env.EMPLOYEE_ACCESS_TEST_DATABASE_URL;
if (
  !url?.includes('/bc_access_contract_consent?host=/tmp/bc-access-contract-consent.') ||
  process.env.DATABASE_URL !== url ||
  process.env.DATABASE_URL_FINANCE !== url
)
  throw new Error('Both database URLs must identify owned cluster');
const db = new PrismaClient({ datasources: { db: { url } } });
const snapshots = new AccessSnapshotService(db as PrismaService);
const marker = randomUUID();
const staleSnapshots = new Map<string, AccessSnapshot>();
let app: INestApplication;
let documents: ContractDocumentService;
let customerAccess: CustomerAccessService;
let branchA: string,
  branchB: string,
  maker: string,
  reader: string,
  denied: string,
  asymmetric: string;
const previousNodeEnv = process.env.NODE_ENV;
let captureBody: Record<string, unknown>;
const purposes = [
  'สัญญาผ่อนชำระสินค้า',
  'ติดตามหนี้และบริหารสัญญา',
  'จัดทำเอกสารทางกฎหมาย',
  'ติดต่อสื่อสารเกี่ยวกับสัญญา',
];
const financePermissions: PermissionKey[] = [
  'contracts.read',
  'documents.read',
  'documents.share',
  'contract-documents.read',
  'customers.read',
  'payments.read',
  'receipts.read',
];
const shopPermissions: PermissionKey[] = [
  'contracts.read',
  'contracts.update',
  'customers.read',
  'products.read',
  'documents.create',
  'documents.read',
  'documents.share',
  'contract-documents.read',
];
async function user() {
  return (
    await db.user.create({
      data: {
        name: 'Owned consent test',
        email: randomUUID() + '@test.invalid',
        password: 'unused',
        role: 'SALES',
        accessManaged: true,
      },
    })
  ).id;
}
async function grant(
  id: string,
  permissions: PermissionKey[],
  companyCode: string,
  branches: string[],
  scope: 'BRANCHES' | 'ASSIGNED' = 'BRANCHES',
) {
  const position = await db.accessPosition.create({
    data: { code: randomUUID(), name: 'Owned consent test', permissions },
  });
  return db.employeeAccessAssignment.create({
    data: {
      userId: id,
      positionId: position.id,
      companyCode,
      scope,
      branches: { create: branches.map((branchId) => ({ branchId })) },
    },
  });
}
async function fixture(branchId = branchA, salespersonId = maker, consent = true) {
  const customer = await db.customer.create({
    data: {
      name: 'PRIVATE-CUSTOMER',
      phone: '0800000000',
      nationalId: randomUUID(),
      accessCompanyCode: 'SHOP',
      accessBranchId: branchId,
    },
  });
  const product = await db.product.create({
    data: {
      name: 'PRIVATE-PRODUCT',
      brand: 'Test',
      model: 'Test',
      imeiSerial: randomUUID(),
      category: 'PHONE_NEW',
      costPrice: 7777,
      branchId,
    },
  });
  const proof = consent
    ? await db.pDPAConsent.create({
        data: {
          customerId: customer.id,
          consentVersion: '1.0',
          privacyNoticeText: 'Owned existing notice',
          purposes: ['สัญญาผ่อนชำระสินค้า'],
          status: 'GRANTED',
          grantedAt: new Date(),
          signatureImage: 'PRIVATE-CONSENT',
          ipAddress: '192.0.2.1',
          deviceInfo: 'PRIVATE-DEVICE',
        },
      })
    : null;
  return db.contract.create({
    data: {
      contractNumber: 'CONSENT-' + randomUUID(),
      customerId: customer.id,
      productId: product.id,
      branchId,
      salespersonId,
      assignedToId: reader,
      planType: 'STORE_WITH_INTEREST',
      sellingPrice: 12000,
      downPayment: 2000,
      financedAmount: 10000,
      interestRate: 0.01,
      totalMonths: 10,
      interestTotal: 1000,
      monthlyPayment: 1100,
      status: 'DRAFT',
      contractHash: 'a'.repeat(64),
      pdpaConsentId: proof?.id,
      signatures: {
        create: { signerType: 'CUSTOMER', signatureImage: 'PRIVATE-SIGNATURE', staffUserId: maker },
      },
      payments: { create: { installmentNo: 1, amountDue: 1100, dueDate: new Date('2027-01-05') } },
    },
  });
}
type Route = 'qr-data' | 'pdpa-read' | 'pdpa-capture' | 'customer-link';
function action(
  route: Route,
  id: string,
  actor = route === 'pdpa-capture' ? maker : reader,
  company = route === 'pdpa-capture' ? 'SHOP' : 'FINANCE',
) {
  const path = route.startsWith('pdpa-') ? 'pdpa-consent' : route;
  const call = ['pdpa-capture', 'customer-link'].includes(route)
    ? request(app.getHttpServer()).post(`/contracts/${id}/${path}`)
    : request(app.getHttpServer()).get(`/contracts/${id}/${path}`);
  return call
    .set('x-test-user', actor)
    .set('x-company-scope', company)
    .send(route === 'pdpa-capture' ? captureBody : {})
    .expect('x-owned-contract-consent-app', marker);
}
beforeAll(async () => {
  process.env.NODE_ENV = 'production';
  const notice = await new PDPAService(db as PrismaService).getPrivacyNotice();
  captureBody = {
    signatureImage: 'SYNTHETIC-CUSTOMER-SIGNATURE',
    presentedNoticeVersion: notice.version,
    presentedNoticeDigest: createHash('sha256')
      .update(JSON.stringify({ version: notice.version, text: notice.text, purposes }))
      .digest('hex'),
    acceptedPurposes: purposes,
  };
  const shop = await db.companyInfo.findUniqueOrThrow({ where: { companyCode: 'SHOP' } });
  branchA = (await db.branch.create({ data: { name: 'Consent A', companyId: shop.id } })).id;
  branchB = (await db.branch.create({ data: { name: 'Consent B', companyId: shop.id } })).id;
  maker = await user();
  reader = await user();
  denied = await user();
  asymmetric = await user();
  await grant(maker, shopPermissions, 'SHOP', [branchA]);
  await grant(reader, financePermissions, 'FINANCE', [branchA]);
  await grant(reader, ['customers.read', 'products.read'], 'SHOP', [branchA]);
  await grant(asymmetric, [...shopPermissions, ...financePermissions], 'SHOP', [branchA]);
  await grant(asymmetric, [...shopPermissions, ...financePermissions], 'FINANCE', [branchB]);
  const module = await Test.createTestingModule({
    controllers: [ContractsController, CustomerAccessController],
    providers: [
      AccessContractConsentAuthority,
      AccessResourceService,
      AccessPartySourceService,
      AccessProcurementSourceService,
      AccessPolicyService,
      ContractDocumentService,
      CustomerAccessService,
      { provide: PrismaService, useValue: db },
      { provide: AccessSnapshotService, useValue: snapshots },
      ...[
        JourneyEntryWriter,
        ContractsService,
        ContractWorkflowService,
        ContractPaymentService,
        ContractSnapshotService,
        ContractJournalQueryService,
        EarlyPayoffSlipService,
      ].map((provide) => ({ provide, useValue: {} })),
      { provide: AuditService, useValue: { log: jest.fn() } },
      { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
      { provide: APP_INTERCEPTOR, useClass: AccessPolicyInterceptor },
    ],
  })
    .overrideGuard(JwtAuthGuard)
    .useValue({
      canActivate: async (ctx: ExecutionContext) => {
        const req = ctx.switchToHttp().getRequest();
        const id = req.headers['x-test-user'];
        if (id)
          req.user = {
            ...(await db.user.findUniqueOrThrow({ where: { id } })),
            access: staleSnapshots.get(id) ?? (await snapshots.forUser(id)),
          };
        return true;
      },
    })
    .overrideGuard(RolesGuard)
    .useValue({ canActivate: () => true })
    .overrideGuard(BranchGuard)
    .useValue({ canActivate: () => true })
    .compile();
  documents = module.get(ContractDocumentService);
  customerAccess = module.get(CustomerAccessService);
  app = module.createNestApplication();
  app.use((_req: unknown, res: { setHeader: (k: string, v: string) => void }, next: () => void) => {
    res.setHeader('x-owned-contract-consent-app', marker);
    next();
  });
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
  await app.listen(0, '127.0.0.1');
}, 60000);
afterAll(async () => {
  await app?.close();
  await db.$disconnect();
  process.env.NODE_ENV = previousNodeEnv;
});
for (const route of ['qr-data', 'pdpa-read', 'pdpa-capture', 'customer-link'] as Route[]) {
  it(`R104 ${route} useful exact authorized HTTP success`, async () => {
    const row = await fixture(branchA, maker, route !== 'pdpa-capture');
    const result = await action(route, row.id);
    expect({ status: result.status, body: result.body }).toEqual({
      status: ['pdpa-capture', 'customer-link'].includes(route) ? 201 : 200,
      body: expect.any(Object),
    });
    if (route === 'qr-data')
      expect(result.body).toMatchObject({ contractId: row.id, contractHash: row.contractHash });
    if (route === 'pdpa-read') {
      expect(JSON.stringify(result.body)).not.toContain('PRIVATE-CONSENT');
      expect(JSON.stringify(result.body)).not.toContain('PRIVATE-DEVICE');
    }
    if (route === 'pdpa-capture')
      expect(
        (await db.contract.findUniqueOrThrow({ where: { id: row.id } })).pdpaConsentId,
      ).not.toBeNull();
    if (route === 'customer-link') {
      expect(result.body.token).toMatch(/^[0-9a-f]{64}$/);
      const response = await request(app.getHttpServer()).get(
        '/customer-access/' + result.body.token,
      );
      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        contractNumber: row.contractNumber,
        customerName: 'PRIVATE-CUSTOMER',
      });
    }
  });
  it(`R104 ${route} denies no grants foreign/current/asymmetric controls`, async () => {
    const row = await fixture(branchA, maker, route !== 'pdpa-capture');
    const foreign = await fixture(branchB, maker, route !== 'pdpa-capture');
    expect((await action(route, row.id, denied)).status).toBe(403);
    expect((await action(route, foreign.id)).status).toBe(403);
    if (route !== 'pdpa-capture')
      expect((await action(route, row.id, asymmetric)).status).toBe(403);
    else {
      const actor = await user();
      await grant(actor, ['contracts.update'], 'SHOP', [branchA]);
      await grant(actor, ['documents.create', 'customers.read'], 'SHOP', [branchB]);
      const own = await fixture(branchA, actor, false);
      expect((await action(route, own.id, actor)).status).toBe(403);
    }
    const current = await user();
    const assignment = await grant(
      current,
      route === 'pdpa-capture' ? shopPermissions : financePermissions,
      route === 'pdpa-capture' ? 'SHOP' : 'FINANCE',
      [branchA],
    );
    await grant(current, ['products.read', 'customers.read'], 'SHOP', [branchA]);
    staleSnapshots.set(current, await snapshots.forUser(current));
    await db.employeeAccessAssignment.update({
      where: { id: assignment.id },
      data: { deletedAt: new Date() },
    });
    const own = await fixture(branchA, current, route !== 'pdpa-capture');
    expect((await action(route, own.id, current)).status).toBe(403);
  });
}
it('R118 genuine public QR verifies uniformly without financial status', async () => {
  const row = await fixture();
  for (const status of ['DRAFT', 'ACTIVE', 'OVERDUE'] as const) {
    await db.contract.update({ where: { id: row.id }, data: { status } });
    const response = await request(app.getHttpServer())
      .get(`/contracts/${row.id}/verify`)
      .query({ hash: row.contractHash })
      .expect('x-owned-contract-consent-app', marker);
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      verified: true,
      contract: { status: null },
      signatureCount: 1,
    });
  }
});

it('R120 actorless direct staff callers cannot bypass persisted identity and current execution', async () => {
  const row = await fixture(branchA, maker, false);
  for (const run of [
    () => documents.getQrData(row.id),
    () => documents.getPdpaConsent(row.id),
    () => documents.recordPdpaConsent(row.id, 'SYNTHETIC-SIGNATURE', {}),
    () => customerAccess.generateAccessToken(row.id),
  ]) {
    await expect(run()).rejects.toMatchObject({ status: 403 });
  }
  expect(await db.customerAccessToken.count({ where: { contractId: row.id } })).toBe(0);
  expect((await db.contract.findUniqueOrThrow({ where: { id: row.id } })).pdpaConsentId).toBeNull();
});

function capture(id: string, body: Record<string, unknown> = captureBody, actor = maker) {
  return request(app.getHttpServer())
    .post(`/contracts/${id}/pdpa-consent`)
    .set('x-test-user', actor)
    .set('x-company-scope', 'SHOP')
    .send(body)
    .expect('x-owned-contract-consent-app', marker);
}
async function issue(id: string) {
  const res = await action('customer-link', id);
  expect(res.status).toBe(201);
  return res.body.token as string;
}
function access(token: string) {
  return request(app.getHttpServer())
    .get('/customer-access/' + token)
    .expect('x-owned-contract-consent-app', marker);
}
it('R119 exact canonical notice handshake and private captured evidence', async () => {
  const row = await fixture(branchA, maker, false);
  const before = await action('pdpa-read', row.id, maker, 'SHOP');
  expect(before.status).toBe(200);
  expect(before.body).toEqual({
    notice: {
      version: '1.0',
      text: expect.any(String),
      purposes,
      digest: captureBody.presentedNoticeDigest,
    },
    consent: null,
  });
  const res = await capture(row.id);
  expect(res.status).toBe(201);
  expect(res.body).toEqual({ id: row.id, pdpaConsentId: expect.any(String) });
  const proof = await db.pDPAConsent.findUniqueOrThrow({ where: { id: res.body.pdpaConsentId } });
  expect(proof).toMatchObject({
    customerId: row.customerId,
    capturedById: maker,
    signatureImage: captureBody.signatureImage,
    consentVersion: '1.0',
    privacyNoticeText: before.body.notice.text,
    purposes,
    noticeDigest: before.body.notice.digest,
  });
  const after = await action('pdpa-read', row.id, maker, 'SHOP');
  expect(after.body.consent).toEqual({
    id: proof.id,
    version: '1.0',
    status: 'GRANTED',
    grantedAt: proof.grantedAt!.toISOString(),
    valid: true,
  });
  const audit = await db.auditLog.findFirstOrThrow({
    where: { entityId: row.id, action: 'CONTRACT_PDPA_CAPTURE' },
  });
  expect(audit.userId).toBe(maker);
  expect(JSON.stringify(audit.newValue)).not.toContain('SYNTHETIC-CUSTOMER-SIGNATURE');
  expect(await db.contractDocument.count({ where: { contractId: row.id } })).toBe(0);
});
for (const patch of [
  { presentedNoticeVersion: undefined },
  { presentedNoticeDigest: 'bad' },
  { acceptedPurposes: [] },
  { acceptedPurposes: [...purposes, purposes[0]] },
  { acceptedPurposes: ['invented', ...purposes.slice(1)] },
]) {
  it('R119 malformed or missing confirmation fails400 without consent', async () => {
    const row = await fixture(branchA, maker, false);
    expect((await capture(row.id, { ...captureBody, ...patch })).status).toBe(400);
    expect(await db.pDPAConsent.count({ where: { customerId: row.customerId } })).toBe(0);
  });
}
it('R119 stale wellformed notice fails409; historical consent remains valid across version changes', async () => {
  const row = await fixture(branchA, maker, false);
  expect((await capture(row.id, { ...captureBody, presentedNoticeVersion: 'older' })).status).toBe(
    409,
  );
  const captured = await capture(row.id);
  expect(captured.status).toBe(201);
  const before = await db.pDPAConsent.findUniqueOrThrow({
    where: { id: captured.body.pdpaConsentId },
  });
  await db.systemConfig.upsert({
    where: { key: 'pdpa_privacy_notice_version' },
    create: { key: 'pdpa_privacy_notice_version', value: '2.0' },
    update: { value: '2.0' },
  });
  try {
    const response = await action('pdpa-read', row.id);
    expect(response.body.notice.version).toBe('2.0');
    expect(response.body.consent).toMatchObject({ version: '1.0', valid: true });
    expect(await db.pDPAConsent.findUnique({ where: { id: before.id } })).toEqual(before);
    const other = await fixture(branchA, maker, false);
    expect((await capture(other.id)).status).toBe(409);
  } finally {
    await db.systemConfig.update({
      where: { key: 'pdpa_privacy_notice_version' },
      data: { value: '1.0' },
    });
  }
});
for (const workflowStatus of ['CREATING', 'PENDING_REVIEW', 'APPROVED', 'REJECTED'] as const) {
  it(`R121 revoked draft recapture in ${workflowStatus} preserves prior row and workflow`, async () => {
    const row = await fixture();
    const old = await db.pDPAConsent.update({
      where: { id: row.pdpaConsentId! },
      data: { status: 'REVOKED', revokedAt: new Date(), purposes },
    });
    await db.contract.update({ where: { id: row.id }, data: { workflowStatus } });
    const res = await capture(row.id);
    expect(res.status).toBe(201);
    expect(res.body.pdpaConsentId).not.toBe(old.id);
    expect(await db.pDPAConsent.findUnique({ where: { id: old.id } })).toEqual(old);
    expect(await db.contract.findUnique({ where: { id: row.id } })).toMatchObject({
      workflowStatus,
      status: 'DRAFT',
      contractHash: row.contractHash,
    });
    expect((await capture(row.id)).status).toBe(409);
  });
}
it('R121 active capture denies; foreign linked proof is hidden and safely replaceable', async () => {
  const row = await fixture(branchA, maker, false),
    other = await fixture();
  await db.contract.update({ where: { id: other.id }, data: { pdpaConsentId: null } });
  await db.contract.update({ where: { id: row.id }, data: { pdpaConsentId: other.pdpaConsentId } });
  expect((await action('pdpa-read', row.id)).body.consent).toBeNull();
  const old = await db.pDPAConsent.findUnique({ where: { id: other.pdpaConsentId! } });
  expect((await capture(row.id)).status).toBe(201);
  expect(await db.pDPAConsent.findUnique({ where: { id: other.pdpaConsentId! } })).toEqual(old);
  await db.contract.update({ where: { id: row.id }, data: { status: 'ACTIVE' } });
  expect((await capture(row.id)).status).toBe(403);
});
it('R121 concurrent capture has exactly one evidence row/link/audit', async () => {
  const row = await fixture(branchA, maker, false);
  const responses = await Promise.all([capture(row.id), capture(row.id)]);
  expect(responses.map((r) => r.status).sort()).toEqual([201, 409]);
  expect(await db.pDPAConsent.count({ where: { customerId: row.customerId } })).toBe(1);
  expect(
    await db.auditLog.count({ where: { entityId: row.id, action: 'CONTRACT_PDPA_CAPTURE' } }),
  ).toBe(1);
});
for (const missing of financePermissions) {
  it(`R104 complete customer delegation independently requires ${missing}`, async () => {
    const actor = await user();
    await grant(
      actor,
      financePermissions.filter((p) => p !== missing),
      'FINANCE',
      [branchA],
    );
    await grant(actor, ['products.read'], 'SHOP', [branchA]);
    const row = await fixture();
    expect((await action('customer-link', row.id, actor)).status).toBe(403);
    expect(await db.customerAccessToken.count({ where: { contractId: row.id } })).toBe(0);
  });
}
it('R104 actual current Product ownership and Customer identity are independent', async () => {
  const row = await fixture();
  await db.product.update({ where: { id: row.productId }, data: { branchId: branchB } });
  expect((await action('customer-link', row.id)).status).toBe(403);
  await db.product.update({ where: { id: row.productId }, data: { branchId: branchA } });
  await db.customer.update({ where: { id: row.customerId }, data: { deletedAt: new Date() } });
  expect((await action('customer-link', row.id)).status).toBe(403);
  expect((await capture(row.id)).status).toBe(403);
});
it('R104 capture does not acquire unrelated product or contract-document create authority', async () => {
  const actor = await user();
  await grant(actor, ['contracts.update', 'documents.create', 'customers.read'], 'SHOP', [branchA]);
  const row = await fixture(branchA, actor, false);
  expect((await capture(row.id, captureBody, actor)).status).toBe(201);
});
it('R104 own SHOP QR sharing requires genuine current customer and company signatures', async () => {
  const row = await fixture();
  expect((await action('qr-data', row.id, maker, 'SHOP')).status).toBe(403);
  await db.signature.create({
    data: {
      contractId: row.id,
      signerType: 'COMPANY',
      signatureImage: 'PRIVATE-COMPANY',
      staffUserId: maker,
    },
  });
  expect((await action('qr-data', row.id, maker, 'SHOP')).status).toBe(200);
  await db.signature.updateMany({
    where: { contractId: row.id, signerType: 'CUSTOMER' },
    data: { deletedAt: new Date() },
  });
  expect((await action('qr-data', row.id, maker, 'SHOP')).status).toBe(403);
});
it('R118 malformed multibyte hash never throws and only live signatures count', async () => {
  const row = await fixture();
  const invalid = await request(app.getHttpServer())
    .get(`/contracts/${row.id}/verify`)
    .query({ hash: 'ก'.repeat(64) });
  expect(invalid.status).toBe(200);
  expect(invalid.body.verified).toBe(false);
  await db.signature.updateMany({ where: { contractId: row.id }, data: { deletedAt: new Date() } });
  expect(
    (
      await request(app.getHttpServer())
        .get(`/contracts/${row.id}/verify`)
        .query({ hash: row.contractHash })
    ).body.signatureCount,
  ).toBe(0);
  await db.contract.update({ where: { id: row.id }, data: { deletedAt: new Date() } });
  expect(
    (
      await request(app.getHttpServer())
        .get(`/contracts/${row.id}/verify`)
        .query({ hash: row.contractHash })
    ).body.verified,
  ).toBe(false);
});
it('R104 future provenance and secret-free atomic audit, independent future issuer grants', async () => {
  const row = await fixture();
  const token = await issue(row.id);
  const stored = await db.customerAccessToken.findUniqueOrThrow({ where: { token } });
  expect(stored).toMatchObject({
    issuedById: reader,
    recipientCustomerId: row.customerId,
    accessCompanyCode: 'FINANCE',
    sourceBranchId: branchA,
    projectionVersion: 1,
  });
  const audit = await db.auditLog.findFirstOrThrow({
    where: { action: 'CUSTOMER_ACCESS_ISSUED', entityId: row.id },
  });
  expect(audit.newValue).toMatchObject({
    tokenRowId: stored.id,
    recipientCustomerId: row.customerId,
    issuerId: reader,
    projectionVersion: 1,
  });
  expect(JSON.stringify(audit)).not.toContain(token);
  await db.user.update({ where: { id: reader }, data: { isActive: false } });
  try {
    expect((await access(token)).status).toBe(200);
  } finally {
    await db.user.update({ where: { id: reader }, data: { isActive: true } });
  }
});
it('R104 current recipient substitution denies without spending a token use', async () => {
  const row = await fixture(),
    other = await fixture();
  const token = await issue(row.id);
  await db.contract.update({ where: { id: row.id }, data: { customerId: other.customerId } });
  expect((await access(token)).status).toBe(404);
  expect((await db.customerAccessToken.findUniqueOrThrow({ where: { token } })).accessCount).toBe(
    0,
  );
});
it('R104 atomic 50 ceiling under simultaneous customer requests', async () => {
  const row = await fixture();
  const token = await issue(row.id);
  await db.customerAccessToken.update({ where: { token }, data: { accessCount: 48 } });
  const responses = await Promise.all(Array.from({ length: 12 }, () => access(token)));
  expect(responses.filter((r) => r.status === 200)).toHaveLength(2);
  expect(responses.filter((r) => r.status === 400)).toHaveLength(10);
  expect((await db.customerAccessToken.findUniqueOrThrow({ where: { token } })).accessCount).toBe(
    50,
  );
});
it('R104 explicit legacy token compatibility and expired token denial', async () => {
  const row = await fixture();
  const token = 'b'.repeat(64);
  await db.customerAccessToken.create({
    data: { token, contractId: row.id, expiresAt: new Date(Date.now() + 60000) },
  });
  expect((await access(token)).status).toBe(200);
  const expired = 'c'.repeat(64);
  await db.customerAccessToken.create({
    data: { token: expired, contractId: row.id, expiresAt: new Date(Date.now() - 1) },
  });
  expect((await access(expired)).status).toBe(400);
});
for (const configured of ['0', '-1', 'NaN', 'Infinity', '1.5', '96']) {
  it(`R104 configured token lifetime ${configured} preserves valid positive values`, async () => {
    await db.systemConfig.upsert({
      where: { key: 'customer_access_token_hours' },
      create: { key: 'customer_access_token_hours', value: configured },
      update: { value: configured },
    });
    try {
      const row = await fixture();
      const token = await issue(row.id);
      const stored = await db.customerAccessToken.findUniqueOrThrow({ where: { token } });
      const hours = ['1.5', '96'].includes(configured) ? Number(configured) : 48;
      expect(
        Math.abs(stored.expiresAt.getTime() - stored.createdAt.getTime() - hours * 3600000),
      ).toBeLessThan(2000);
    } finally {
      await db.systemConfig.update({
        where: { key: 'customer_access_token_hours' },
        data: { value: '48' },
      });
    }
  });
}

it('R104 complete delegated projection contains only live allowed metadata, no private files or costs', async () => {
  const row = await fixture();
  await db.contractDocument.createMany({
    data: [
      {
        contractId: row.id,
        documentType: 'SIGNED_CONTRACT',
        fileName: 'signed.pdf',
        fileUrl: 'PRIVATE-STORAGE',
        fileHash: 'PRIVATE-HASH',
        uploadedById: maker,
      },
      {
        contractId: row.id,
        documentType: 'PAYMENT_SCHEDULE',
        fileName: 'deleted.pdf',
        fileUrl: 'PRIVATE-DELETED',
        fileHash: 'PRIVATE-HASH',
        uploadedById: maker,
        deletedAt: new Date(),
      },
      {
        contractId: row.id,
        documentType: 'ID_CARD_COPY',
        fileName: 'id.pdf',
        fileUrl: 'PRIVATE-ID',
        fileHash: 'PRIVATE-HASH',
        uploadedById: maker,
      },
    ],
  });
  await db.receipt.createMany({
    data: [false, true].map((isVoided) => ({
      contractId: row.id,
      receiptNumber: randomUUID(),
      payerName: 'PRIVATE-PAYER',
      receiverName: 'PRIVATE-RECEIVER',
      amount: 500,
      paidDate: new Date(),
      issuedById: maker,
      isVoided,
      fileUrl: 'PRIVATE-RECEIPT',
    })),
  });
  const token = await issue(row.id);
  const result = await access(token);
  expect(result.status).toBe(200);
  expect(Object.keys(result.body).sort()).toEqual(
    [
      'contractNumber',
      'customerName',
      'productName',
      'branchName',
      'status',
      'totalMonths',
      'monthlyPayment',
      'payments',
      'documents',
      'receipts',
    ].sort(),
  );
  expect(result.body.documents).toHaveLength(1);
  expect(Object.keys(result.body.documents[0]).sort()).toEqual(
    ['id', 'documentType', 'fileName', 'createdAt'].sort(),
  );
  expect(result.body.receipts).toHaveLength(1);
  expect(result.body.payments[0]).toMatchObject({
    amountDue: '1100',
    amountPaid: '0',
    status: 'PENDING',
  });
  expect(JSON.stringify(result.body)).not.toMatch(
    /PRIVATE-(STORAGE|HASH|DELETED|ID|RECEIPT|PAYER|RECEIVER)|costPrice|signatureImage|nationalId/,
  );
});
for (const operation of ['capture', 'issue'] as const) {
  it(`R104 required ${operation} audit failure rolls back row/link without orphan`, async () => {
    const row = await fixture(branchA, maker, false);
    await db.$executeRawUnsafe(
      `CREATE OR REPLACE FUNCTION owned_reject_consent_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.entity_id='${row.id}' THEN RAISE EXCEPTION 'owned required audit failure'; END IF; RETURN NEW; END; $$`,
    );
    await db.$executeRawUnsafe(
      'CREATE TRIGGER owned_reject_consent_audit BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION owned_reject_consent_audit()',
    );
    try {
      const result =
        operation === 'capture' ? await capture(row.id) : await action('customer-link', row.id);
      expect(result.status).toBe(500);
    } finally {
      await db.$executeRawUnsafe('DROP TRIGGER owned_reject_consent_audit ON audit_logs');
      await db.$executeRawUnsafe('DROP FUNCTION owned_reject_consent_audit()');
    }
    expect(await db.pDPAConsent.count({ where: { customerId: row.customerId } })).toBe(0);
    expect(await db.customerAccessToken.count({ where: { contractId: row.id } })).toBe(0);
    expect(
      (await db.contract.findUniqueOrThrow({ where: { id: row.id } })).pdpaConsentId,
    ).toBeNull();
  });
}
it('R120 actual unmanaged identity compatibility, branch restriction, and future-only issuance provenance', async () => {
  const actor = await user();
  await db.user.update({ where: { id: actor }, data: { accessManaged: false, branchId: branchA } });
  const row = await fixture(branchA, actor, false);
  expect((await action('qr-data', row.id, actor)).status).toBe(200);
  expect((await action('pdpa-read', row.id, actor)).status).toBe(200);
  expect((await capture(row.id, captureBody, actor)).status).toBe(201);
  const issued = await action('customer-link', row.id, actor);
  expect(issued.status).toBe(201);
  expect(
    await db.customerAccessToken.findUnique({ where: { token: issued.body.token } }),
  ).toMatchObject({ issuedById: actor, recipientCustomerId: row.customerId, projectionVersion: 1 });
  const foreign = await fixture(branchB, actor, false);
  expect((await action('customer-link', foreign.id, actor)).status).toBe(403);
  expect((await capture(foreign.id, captureBody, actor)).status).toBe(403);
  await db.user.update({ where: { id: actor }, data: { isActive: false } });
  await expect(documents.getQrData(row.id, actor)).rejects.toMatchObject({ status: 403 });
});
it('R120 managed direct identity never falls through; owned supplied actor must match', async () => {
  const row = await fixture(branchA, maker, false);
  for (const run of [
    () => documents.getQrData(row.id, reader),
    () => documents.getPdpaConsent(row.id, reader),
    () => documents.recordPdpaConsent(row.id, 'SIGNATURE', {}, maker, captureBody),
    () => customerAccess.generateAccessToken(row.id, reader),
  ])
    await expect(run()).rejects.toMatchObject({ status: 403 });
  const resources = app.get(AccessResourceService);
  await expect(
    resources.execute(
      reader,
      'contracts.read',
      'FINANCE',
      undefined,
      () => documents.getQrData(row.id, maker),
      false,
      { isolationLevel: 'Serializable' },
    ),
  ).rejects.toMatchObject({ status: 403 });
  const result = await resources.execute(
    reader,
    'contracts.read',
    'FINANCE',
    undefined,
    () => documents.getQrData(row.id),
    false,
    { isolationLevel: 'Serializable' },
  );
  expect(result.result.contractId).toBe(row.id);
});
it('R104 maker/owner preparation and current same-parent Customer capability', async () => {
  const actor = await user();
  await grant(actor, shopPermissions, 'SHOP', [branchA]);
  const row = await fixture();
  expect((await action('pdpa-read', row.id, actor, 'SHOP')).status).toBe(403);
  expect((await capture(row.id, captureBody, actor)).status).toBe(403);
  const owner = await user();
  await db.user.update({ where: { id: owner }, data: { role: 'OWNER' } });
  expect((await capture(row.id, captureBody, owner)).status).toBe(201);
});
it('R104 signature bound is enforced in the actual owned direct execution', async () => {
  const row = await fixture(branchA, maker, false);
  const resources = app.get(AccessResourceService);
  await expect(
    resources.execute(
      maker,
      'contracts.update',
      'SHOP',
      undefined,
      () =>
        documents.recordPdpaConsent(
          row.id,
          'x'.repeat(3 * 1024 * 1024 + 1),
          {},
          maker,
          captureBody,
        ),
      false,
      { isolationLevel: 'Serializable' },
    ),
  ).rejects.toMatchObject({ status: 400 });
  expect(await db.pDPAConsent.count({ where: { customerId: row.customerId } })).toBe(0);
});
it('R104 concurrent persisted Contract source change is rechecked after lock wait', async () => {
  const row = await fixture();
  let locked!: () => void, release!: () => void;
  const ready = new Promise<void>((resolve) => (locked = resolve)),
    gate = new Promise<void>((resolve) => (release = resolve));
  const writer = db.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT id FROM contracts WHERE id=${row.id} FOR UPDATE`;
      await tx.contract.update({ where: { id: row.id }, data: { branchId: branchB } });
      locked();
      await gate;
    },
    { timeout: 15000 },
  );
  await ready;
  const response = action('customer-link', row.id).then((r) => r);
  try {
    let blocked = false;
    for (let i = 0; i < 100; i++) {
      const rows = await db.$queryRaw<
        Array<{ count: bigint }>
      >`SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%FROM contracts%'`;
      if (Number(rows[0].count) > 0) {
        blocked = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(blocked).toBe(true);
  } finally {
    release();
    await writer;
  }
  expect((await response).status).toBe(403);
  expect(await db.customerAccessToken.count({ where: { contractId: row.id } })).toBe(0);
});
it('R104 issued provenance cannot be mutated or backfilled onto legacy token', async () => {
  const row = await fixture();
  const token = await issue(row.id);
  await expect(
    db.customerAccessToken.update({
      where: { token },
      data: { recipientCustomerId: (await fixture()).customerId },
    }),
  ).rejects.toThrow('immutable');
  const legacy = await db.customerAccessToken.create({
    data: { token: 'e'.repeat(64), contractId: row.id, expiresAt: new Date(Date.now() + 60000) },
  });
  await expect(
    db.customerAccessToken.update({
      where: { id: legacy.id },
      data: {
        issuedById: reader,
        recipientCustomerId: row.customerId,
        accessCompanyCode: 'FINANCE',
        sourceBranchId: branchA,
        projectionVersion: 1,
      },
    }),
  ).rejects.toThrow('immutable');
  expect(
    (await db.customerAccessToken.findUniqueOrThrow({ where: { id: legacy.id } })).issuedById,
  ).toBeNull();
  await expect(
    db.customerAccessToken.create({
      data: {
        token: 'f'.repeat(64),
        contractId: row.id,
        expiresAt: new Date(Date.now() + 60000),
        issuedById: reader,
      },
    }),
  ).rejects.toThrow();
});

it('R118 malformed array hash and nonexistent contract are generic public denials', async () => {
  const row = await fixture();
  for (const path of [
    `/contracts/${row.id}/verify?hash=a&hash=b`,
    `/contracts/${randomUUID()}/verify?hash=${'a'.repeat(64)}`,
  ]) {
    const res = await request(app.getHttpServer()).get(path);
    expect(res.status).toBe(200);
    expect(res.body.verified).toBe(false);
    expect(res.body.contract).toBeUndefined();
  }
});
it('R104 generic HTTP audits omit raw capture request, QR result and customer bearer', async () => {
  const audit = app.get(AuditService).log as jest.Mock;
  const start = audit.mock.calls.length;
  const row = await fixture(branchA, maker, false);
  expect((await capture(row.id)).status).toBe(201);
  await action('pdpa-read', row.id);
  await action('qr-data', row.id);
  const token = await issue(row.id);
  const records = audit.mock.calls.slice(start);
  expect(records.length).toBeGreaterThanOrEqual(4);
  const text = JSON.stringify(records);
  expect(text).not.toContain(token);
  expect(text).not.toContain(row.contractHash);
  expect(text).not.toContain(captureBody.signatureImage);
  expect(text).not.toContain('presentedNoticeDigest');
  for (const args of records)
    expect(args[0].newValue).toEqual({
      route: expect.any(String),
      outcome: 'SUCCESS',
      statusCode: expect.any(Number),
      duration: expect.any(Number),
    });
});

it('R122 FINANCE delegation accepts genuine exact-parent SHOP Customer read without FINANCE identity grant', async () => {
  const actor = await user();
  await grant(
    actor,
    financePermissions.filter((p) => p !== 'customers.read'),
    'FINANCE',
    [branchA],
  );
  await grant(actor, ['customers.read', 'products.read'], 'SHOP', [branchA]);
  const row = await fixture();
  const response = await action('customer-link', row.id, actor);
  expect(response.status).toBe(201);
  expect((await access(response.body.token)).body.customerName).toBe('PRIVATE-CUSTOMER');
});
it('R122 SHOP Customer branch/assignment cannot be borrowed across original tuples or maker identity', async () => {
  const actor = await user();
  await grant(
    actor,
    financePermissions.filter((p) => p !== 'customers.read'),
    'FINANCE',
    [branchA],
  );
  await grant(actor, ['products.read'], 'SHOP', [branchA]);
  await grant(actor, ['customers.read'], 'SHOP', [branchB]);
  const row = await fixture(branchA, actor);
  expect((await action('customer-link', row.id, actor)).status).toBe(403);
  await grant(actor, ['customers.read'], 'SHOP', [branchA], 'ASSIGNED');
  expect((await action('customer-link', row.id, actor)).status).toBe(403);
  await db.customer.update({ where: { id: row.customerId }, data: { assignedToId: actor } });
  expect((await action('customer-link', row.id, actor)).status).toBe(201);
  await db.customer.update({ where: { id: row.customerId }, data: { assignedToId: maker } });
  expect((await action('customer-link', row.id, actor)).status).toBe(403);
});
