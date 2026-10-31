import { deflateSync } from 'node:zlib';
import { InstallmentAccrual2ATemplate } from '../journal/cpa-templates/installment-accrual-2a.template';
import { AccessPayoffEvidenceBoundary } from '../employee-access/access-payoff-evidence-boundary';
import { Test } from '@nestjs/testing';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { ExecutionContext, INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import request from 'supertest';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { ContractsController } from './contracts.controller';
import { ContractsService } from './contracts.service';
import { ContractWorkflowService } from './contract-workflow.service';
import { ContractDocumentService } from './contract-document.service';
import { ContractSnapshotService } from './contract-snapshot.service';
import { ContractJournalQueryService } from '../journal/contract-journal-query.service';
import { EarlyPayoffSlipService } from './early-payoff-slip/early-payoff-slip.service';
import { StorageService } from '../storage/storage.service';
import { VisionService } from '../chatbot-finance/services/vision.service';
import Anthropic from '@anthropic-ai/sdk';
import { inspect } from 'node:util';
import { IntegrationConfigService } from '../integrations/integration-config.service';
import { AiUsageService } from '../ai-usage/ai-usage.service';
import { FinanceConfigService } from '../chatbot-finance/services/finance-config.service';
import { AccessPayoffRequestBoundary } from '../employee-access/access-payoff-request-boundary';
import { AccessPartySourceService } from '../employee-access/access-party-source.service';
import { AccessProcurementSourceService } from '../employee-access/access-procurement-source.service';
import { AccessPolicyService } from '../employee-access/access-policy';
import { AccessPolicyInterceptor } from '../employee-access/access-policy.interceptor';
import { AuditInterceptor } from '../audit/audit.interceptor';
import { AuditService } from '../audit/audit.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { BranchGuard } from '../auth/guards/branch.guard';
import { createHash, randomUUID } from 'node:crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import * as Sentry from '@sentry/nestjs';
import { Logger } from '@nestjs/common';
import { PermissionKey } from '@installment/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { ContractPaymentService } from './contract-payment.service';
import { ProductsService } from '../products/products.service';
import { JournalAutoService } from '../journal/journal-auto.service';
import { EclStageReverseTemplate } from '../journal/cpa-templates/ecl-stage-reverse.template';
import { EarlyPayoffJP4Template } from '../journal/cpa-templates/early-payoff-jp4.template';
import { ShopCollectSettlementTemplate } from '../journal/cpa-templates/shop-collect-settlement.template';
import { ReceiptVoidReversalTemplate } from '../journal/cpa-templates/receipt-void-reversal.template';
import { ReceiptsService } from '../receipts/receipts.service';
import { LineOaService } from '../line-oa/line-oa.service';
import { JourneyEntryWriter } from '../customer-journey/journey-entry-writer.service';
import { AccessSnapshotService } from '../employee-access/access-snapshot.service';
import { AccessResourceService } from '../employee-access/access-resource.service';
import { currentDomainAccess } from '../employee-access/access-execution-context';

jest.mock('@sentry/nestjs', () => ({ captureMessage: jest.fn(), captureException: jest.fn() }));
jest.mock('@anthropic-ai/sdk', () => ({ __esModule: true, default: jest.fn() }));
const url = process.env.PAYOFF_PRIVATE_TEST_DATABASE_URL;
if (
  !url?.includes('/bc_payoff_private?host=/tmp/bc-payoff-private.') ||
  process.env.DATABASE_URL !== url ||
  process.env.DATABASE_URL_FINANCE !== url
)
  throw new Error('Both database URLs must identify the owned payoff atomic cluster');
const db = new PrismaClient({ datasources: { db: { url } } });
const prisma = db as PrismaService;
const snapshots = new AccessSnapshotService(prisma);
const line = { sendPaymentReceipt: jest.fn().mockResolvedValue(undefined) };
const journey = { recordAfterCommit: jest.fn().mockResolvedValue(undefined) };
const journal = new JournalAutoService(prisma);
const products = new ProductsService(prisma);
const receipts = new ReceiptsService(
  prisma,
  journal,
  {} as ReceiptVoidReversalTemplate,
  line as unknown as LineOaService,
);
const service = new ContractPaymentService(
  prisma,
  products,
  journal,
  {} as EarlyPayoffJP4Template,
  {} as ShopCollectSettlementTemplate,
  receipts,
  new EclStageReverseTemplate(journal, prisma),
  journey as unknown as JourneyEntryWriter,
);
let actor: string,
  legacy: string,
  finance: string,
  shop: string,
  branch: string,
  owner: string,
  denied: string;
const writes: PermissionKey[] = [
  'contracts.read',
  'payments.read',
  'payments.create',
  'documents.create',
];
const paidDate = new Date('2026-10-01T00:00:00.000Z');
async function person(managed: boolean, email = randomUUID() + '@test.invalid') {
  return (
    await db.user.create({
      data: {
        name: 'Owned actor',
        email,
        password: 'unused',
        role: 'ACCOUNTANT',
        accessManaged: managed,
      },
    })
  ).id;
}
async function grant(
  userId: string,
  permissions = writes,
  companyCode = 'FINANCE',
  branchIds?: string[],
  scope?: 'ASSIGNED',
) {
  const position = await db.accessPosition.create({
    data: { code: randomUUID(), name: 'Owned position', permissions },
  });
  return db.employeeAccessAssignment.create({
    data: {
      userId,
      positionId: position.id,
      companyCode,
      scope: scope ?? (branchIds ? 'BRANCHES' : 'COMPANY'),
      ...(branchIds ? { branches: { create: branchIds.map((branchId) => ({ branchId })) } } : {}),
    },
  });
}
async function contract(ecl = 0, origin = branch) {
  const lineUserId = randomUUID();
  const customer = await db.customer.create({
    data: { name: 'PRIVATE-PAYER', phone: '0800000000', lineIdFinance: lineUserId },
  });
  // Task 22 fix round 1 I-1 (ง): the LINE receipt goes to the active OTP link row (bind writes it next to the column)
  await db.customerLineLink.create({
    data: { customerId: customer.id, lineUserId, channel: 'FINANCE' },
  });
  const product = await db.product.create({
    data: {
      name: 'Owned device',
      brand: 'Apple',
      model: 'Test',
      category: 'PHONE_NEW',
      costPrice: 9000,
      branchId: origin,
      ownedByCompanyId: finance,
      status: 'SOLD_INSTALLMENT',
    },
  });
  const row = await db.contract.create({
    data: {
      contractNumber: 'OWNED-' + randomUUID(),
      customerId: customer.id,
      productId: product.id,
      branchId: origin,
      salespersonId: actor,
      planType: 'STORE_WITH_INTEREST',
      sellingPrice: 12000,
      downPayment: 2000,
      financedAmount: 10000,
      totalMonths: 10,
      monthlyPayment: 1200,
      interestRate: 0.02,
      interestTotal: 2000,
      vatAmount: 0,
      vatPct: 0,
      status: 'ACTIVE',
    },
  });
  for (let n = 1; n <= 10; n++) {
    await db.payment.create({
      data: {
        contractId: row.id,
        installmentNo: n,
        dueDate: paidDate,
        amountDue: 1200,
        monthlyPrincipal: 1000,
        monthlyInterest: 200,
        monthlyCommission: 0,
        vatAmount: 0,
      },
    });
    await db.installmentSchedule.create({
      data: {
        contractId: row.id,
        installmentNo: n,
        dueDate: paidDate,
        principal: 1000,
        interest: 200,
        amountDue: 1200,
      },
    });
  }
  await db.journalEntry.create({
    data: {
      entryNumber: 'OPEN-' + randomUUID(),
      entryDate: paidDate,
      postedAt: paidDate,
      description: 'Owned opening ledger',
      status: 'POSTED',
      createdById: legacy,
      companyId: finance,
      metadata: { contractId: row.id, tag: '1A' },
      lines: {
        create: [
          { accountCode: '11-2101', debit: 12000, credit: 0 },
          { accountCode: '11-2106', debit: 0, credit: 2000 },
          { accountCode: '11-1201', debit: 0, credit: 10000 },
          ...(ecl
            ? [
                { accountCode: '11-2102', debit: 0, credit: ecl },
                { accountCode: '51-1103', debit: ecl, credit: 0 },
              ]
            : []),
        ],
      },
    },
  });
  if (ecl > 0)
    await db.badDebtProvision.create({
      data: {
        contractId: row.id,
        provisionDate: paidDate,
        agingBucket: '31-60',
        daysOverdue: 40,
        outstandingAmount: 12000,
        provisionRate: 0.05,
        provisionAmount: ecl,
      },
    });
  return row;
}
async function state(id: string) {
  return {
    contract: await db.contract.findUniqueOrThrow({ where: { id } }),
    paid: await db.payment.count({ where: { contractId: id, status: 'PAID' } }),
    receipts: await db.receipt.count({ where: { contractId: id } }),
    evidence: await db.paymentEvidence.count({ where: { contractId: id } }),
    fingerprints: await db.slipFingerprint.count({ where: { contractId: id } }),
    journals: await db.journalEntry.count({
      where: { metadata: { path: ['contractId'], equals: id } },
    }),
    product: await db.product.findFirst({
      where: { contracts: { some: { id } } },
      select: { ownedByCompanyId: true },
    }),
    audits: await db.auditLog.count({ where: { entityId: id } }),
    provisions: await db.badDebtProvision.findMany({ where: { contractId: id } }),
  };
}

let app: INestApplication;
const marker = randomUUID();
const files = process.env.PAYOFF_PRIVATE_FILES!;
if (!files?.startsWith('/tmp/bc-payoff-private.'))
  throw new Error('Owned private file root required');
// Explicit config map prevents all inherited cloud/provider configuration.
const config = {
  get: (key: string) =>
    ({ STORAGE_LOCAL_DIR: files, NODE_ENV: 'test', JWT_SECRET: 'owned-test-only' })[key],
} as ConfigService;
const storage = new StorageService(config);
const vision = { extractSlip: jest.fn() };
const financeConfig = { isCompanyBankAccount: (account: string) => account === '1234567890' };
const audit = { log: jest.fn().mockResolvedValue(undefined) };
const slip = new EarlyPayoffSlipService(
  prisma,
  storage,
  vision as unknown as VisionService,
  financeConfig as unknown as FinanceConfigService,
  service,
  config,
);
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6QZ8AAAAASUVORK5CYII=',
  'base64',
);
// Distinct valid one-pixel PNGs for independent money cases; exact bytes are reused only intentionally.
function imageBytes() {
  function chunk(name: string, data: Buffer) {
    const body = Buffer.concat([Buffer.from(name), data]);
    let crc = 0xffffffff;
    for (const byte of body) {
      crc ^= byte;
      for (let n = 0; n < 8; n++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    const length = Buffer.alloc(4),
      checksum = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
    return Buffer.concat([length, body, checksum]);
  }
  const header = Buffer.from('00000001000000010806000000', 'hex');
  const pixel = Buffer.from(randomUUID().replace(/-/g, '').slice(0, 8), 'hex');
  return Buffer.concat([
    png.subarray(0, 8),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.concat([Buffer.from([0]), pixel]))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
const uploadOwned = jest.spyOn(storage, 'uploadOwned');
const publicUrl = jest.spyOn(storage, 'getPublicUrl');
const cleanup = jest.spyOn(storage, 'deleteOwned');
function reading() {
  return {
    isSlip: true,
    amount: 12000,
    refNo: randomUUID(),
    bankName: 'KBANK',
    date: '2026-10-01',
    toAccount: '1234567890',
    confidence: 0.99,
  };
}
function http(id: string, who = actor, confirm = false) {
  return request(app.getHttpServer())
    .post(`/contracts/${id}/early-payoff/${confirm ? 'slip-confirm' : 'slip'}`)
    .set('x-test-user', who)
    .set('x-company-scope', 'FINANCE');
}
async function verify(
  id: string,
  who = actor,
  rate: string | undefined = '0',
  reason?: string,
  bytes = imageBytes(),
) {
  const req = http(id, who);
  if (rate !== undefined) req.field('discountPct', rate);
  if (reason !== undefined) req.field('reason', reason);
  const response = await req.attach('slip', bytes, {
    filename: 'slip.png',
    contentType: 'image/png',
  });
  expect(response.headers['x-owned-payoff-private-app']).toBe(marker);
  return response;
}
beforeAll(async () => {
  jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  finance = (await db.companyInfo.findUniqueOrThrow({ where: { companyCode: 'FINANCE' } })).id;
  shop = (await db.companyInfo.findUniqueOrThrow({ where: { companyCode: 'SHOP' } })).id;
  await db.companyInfo.update({
    where: { id: finance },
    data: { nameTh: 'Owned FINANCE receiver' },
  });
  branch = (await db.branch.create({ data: { name: 'Owned origin', companyId: shop } })).id;
  actor = await person(true);
  legacy = await person(false, 'admin@bestchoice.com');
  await grant(actor);
  denied = await person(true);
  owner = await person(true);
  await db.user.update({ where: { id: owner }, data: { role: 'OWNER' } });
  for (const code of [
    '11-1201',
    '11-2101',
    '11-2103',
    '11-2105',
    '21-2102',
    '21-2101',
    '11-2102',
    '11-2106',
    '41-1101',
    '51-1103',
    '52-1106',
  ]) {
    await db.chartOfAccount.upsert({
      where: { code },
      update: {},
      create: { code, name: 'Owned ' + code, type: 'สินทรัพย์', normalBalance: 'Dr' },
    });
  }
  const module = await Test.createTestingModule({
    controllers: [ContractsController],
    providers: [
      AccessPayoffEvidenceBoundary,
      AccessPayoffRequestBoundary,
      AccessResourceService,
      AccessPartySourceService,
      AccessProcurementSourceService,
      AccessPolicyService,
      { provide: PrismaService, useValue: prisma },
      { provide: AccessSnapshotService, useValue: snapshots },
      { provide: ContractPaymentService, useValue: service },
      { provide: EarlyPayoffSlipService, useValue: slip },
      ...[
        ContractWorkflowService,
        ContractDocumentService,
        ContractSnapshotService,
        ContractJournalQueryService,
        JourneyEntryWriter,
      ].map((provide) => ({ provide, useValue: {} })),
      {
        provide: ContractsService,
        useValue: {
          findOne: () => {
            throw new Error('Managed slip must use genuine current source, not legacy findOne');
          },
        },
      },
      { provide: AuditService, useValue: audit },
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
  app.use((_req: unknown, res: { setHeader: (k: string, v: string) => void }, next: () => void) => {
    res.setHeader('x-owned-payoff-private-app', marker);
    next();
  });
  app.useGlobalPipes(
    new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }),
  );
  await app.listen(0, '127.0.0.1');
});
beforeEach(() => {
  vision.extractSlip.mockReset().mockResolvedValue(reading());
  uploadOwned.mockClear();
  publicUrl.mockClear();
  cleanup.mockClear();
  audit.log.mockClear();
  line.sendPaymentReceipt.mockReset().mockResolvedValue(undefined);
  journey.recordAfterCommit.mockReset().mockResolvedValue(undefined);
  jest.mocked(Sentry.captureMessage).mockClear();
});
afterAll(async () => {
  jest.restoreAllMocks();
  await app?.close();
  await db.$disconnect();
});

it('actual marked FileInterceptor/ParseFilePipe rejects missing multipart and invalid MIME before storage', async () => {
  const c = await contract();
  for (const pending of [
    http(c.id, owner).field('discountPct', '0'),
    http(c.id, owner)
      .field('discountPct', '0')
      .attach('slip', Buffer.from('not-image'), { filename: 'bad.txt', contentType: 'text/plain' }),
  ]) {
    const response = await pending;
    expect(response.headers['x-owned-payoff-private-app']).toBe(marker);
    expect(response.status).toBe(400);
  }
  expect(uploadOwned).not.toHaveBeenCalled();
  expect(vision.extractSlip).not.toHaveBeenCalled();
});
it('current no-grant actor is denied before provider work', async () => {
  const c = await contract();
  const response = await verify(c.id, denied);
  expect(response.status).toBe(403);
  expect(uploadOwned).not.toHaveBeenCalled();
  expect(vision.extractSlip).not.toHaveBeenCalled();
});
it('explicit zero produces a useful opaque ticket from real private bytes then canonical receipt', async () => {
  const c = await contract();
  const response = await verify(c.id);
  expect(response.status).toBe(201);
  expect(response.body).toMatchObject({
    matched: true,
    discountPct: 0,
    expectedAmount: 12000,
    ticket: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
  });
  expect(response.body.checks).toHaveLength(5);
  expect(response.body).not.toHaveProperty('imageKey');
  expect(response.body).not.toHaveProperty('slipUrl');
  expect(uploadOwned).toHaveBeenCalledTimes(1);
  expect(vision.extractSlip).toHaveBeenCalledTimes(1);
  expect(publicUrl).not.toHaveBeenCalled();
  const key = uploadOwned.mock.calls[0][0];
  expect(await readFile(join(files, key))).toEqual(uploadOwned.mock.calls[0][1]);
  expect((await stat(join(files, key))).mode & 0o777).toBe(0o600);
  const result = await http(c.id, actor, true).send({ ticket: response.body.ticket });
  expect(result.status).toBe(201);
  expect(result.body).toEqual({
    status: 'COMPLETED',
    receiptId: expect.any(String),
    receiptNumber: expect.any(String),
  });
  expect((await state(c.id)).paid).toBe(10);
  expect(line.sendPaymentReceipt).toHaveBeenCalledTimes(1);
});
it('positive effective input creates only genuine pending request with unreadable OCR for owner too', async () => {
  const c = await contract();
  vision.extractSlip.mockResolvedValue(null);
  const response = await verify(c.id, owner, '50', 'Explicit bounded review reason');
  expect(response.status).toBe(201);
  expect(response.body).toEqual({ requestId: expect.any(String), status: 'PENDING_APPROVAL' });
  const pending = await db.paymentApprovalRequest.findUniqueOrThrow({
    where: { id: response.body.requestId },
  });
  expect(pending.status).toBe('PENDING');
  expect(pending.requestedById).toBe(owner);
  expect((await state(c.id)).paid).toBe(0);
  expect(publicUrl).not.toHaveBeenCalled();
});

async function ticket(c: { id: string }, who = actor, bytes = imageBytes()) {
  const response = await verify(c.id, who, '0', undefined, bytes);
  expect(response.status).toBe(201);
  expect(response.body.matched).toBe(true);
  return response.body.ticket as string;
}
async function evidence(id: string) {
  return db.managedPayoffEvidence.findFirstOrThrow({
    where: { contractId: id },
    orderBy: { createdAt: 'desc' },
  });
}
async function confirm(c: { id: string }, token: string, who = actor) {
  const response = await http(c.id, who, true).send({ ticket: token, notes: 'PRIVATE-NOTES' });
  expect(response.headers['x-owned-payoff-private-app']).toBe(marker);
  return response;
}
it.each([
  'contracts.read',
  'payments.read',
  'payments.create',
  'documents.create',
] as PermissionKey[])(
  'independent current %s is required before any upload',
  async (permission) => {
    const who = await person(true);
    await grant(
      who,
      writes.filter((p) => p !== permission),
    );
    const c = await contract();
    expect((await verify(c.id, who)).status).toBe(403);
    expect(uploadOwned).not.toHaveBeenCalled();
    expect(vision.extractSlip).not.toHaveBeenCalled();
  },
);
it('foreign/asymmetric FINANCE and SHOP tuples cannot manufacture mutation authority', async () => {
  const who = await person(true),
    foreign = (await db.branch.create({ data: { name: 'Foreign', companyId: shop } })).id;
  await grant(who, writes, 'FINANCE', [branch]);
  await grant(who, writes, 'SHOP', [foreign]);
  const c = await contract(0, foreign);
  expect((await verify(c.id, who)).status).toBe(403);
  expect(uploadOwned).not.toHaveBeenCalled();
});
it('case-assigned reads combine with real mutation grants, but assignment alone never writes', async () => {
  const who = await person(true);
  await grant(who, ['contracts.read', 'payments.read'], 'FINANCE', [branch], 'ASSIGNED');
  const c = await contract();
  await db.contract.update({ where: { id: c.id }, data: { assignedToId: who } });
  await grant(who, ['payments.create', 'documents.create'], 'FINANCE', [branch], 'ASSIGNED');
  expect((await verify(c.id, who)).status).toBe(403);
  expect(uploadOwned).not.toHaveBeenCalled();
  await grant(who, ['payments.create', 'documents.create'], 'FINANCE', [branch]);
  expect((await verify(c.id, who)).status).toBe(201);
});
it.each(['product', 'origin', 'context'])(
  'current %s source denial precedes providers',
  async (kind) => {
    const c = await contract();
    if (kind === 'product')
      await db.product.update({ where: { id: c.productId }, data: { ownedByCompanyId: shop } });
    if (kind === 'origin') {
      const retired = await db.branch.create({
        data: { name: 'Retired', companyId: shop, isActive: false },
      });
      await db.contract.update({ where: { id: c.id }, data: { branchId: retired.id } });
    }
    const response =
      kind === 'context'
        ? await http(c.id)
            .set('x-company-scope', 'SHOP')
            .field('discountPct', '0')
            .attach('slip', imageBytes(), { filename: 's.png', contentType: 'image/png' })
        : await verify(c.id);
    expect(response.status).toBe(403);
    expect(uploadOwned).not.toHaveBeenCalled();
  },
);
it.each(['missing-reason', 'empty', 'NaN', 'Infinity', '-1', '101', 'unknown'])(
  'strict multipart rejects %s',
  async (kind) => {
    const c = await contract();
    const req = http(c.id).field(
      'discountPct',
      kind === 'empty' ? '' : kind === 'missing-reason' ? '50' : kind === 'unknown' ? '0' : kind,
    );
    if (kind === 'unknown') req.field('managedEvidenceId', randomUUID());
    const response = await req.attach('slip', imageBytes(), {
      filename: 's.png',
      contentType: 'image/png',
    });
    expect(response.status).toBe(400);
    expect(uploadOwned).not.toHaveBeenCalled();
  },
);
it('real multipart rejects oversize and MIME-spoofed signature before any upload', async () => {
  const c = await contract();
  for (const bytes of [
    Buffer.concat([png, Buffer.alloc(5 * 1024 * 1024)]),
    Buffer.from('not-a-png'),
  ]) {
    const response = await http(c.id)
      .field('discountPct', '0')
      .attach('slip', bytes, { filename: 's.png', contentType: 'image/png' });
    expect(response.status).toBe(400);
    expect(response.headers['x-owned-payoff-private-app']).toBe(marker);
  }
  expect(uploadOwned).not.toHaveBeenCalled();
});
it.each(['employee', 'owner'])(
  'all positive hidden-zero/loss/unreadable/mismatch outcomes remain pending for %s',
  async (viewer) => {
    const who = viewer === 'owner' ? owner : actor;
    for (const kind of [
      'zero-profit',
      'loss',
      'unreadable',
      'mismatch',
      'provider-error',
      'clamp',
      'tiny',
    ]) {
      const c = await contract();
      if (kind === 'zero-profit' || kind === 'loss')
        await db.contract.update({
          where: { id: c.id },
          data: { sellingPrice: kind === 'loss' ? 20000 : 14000 },
        });
      vision.extractSlip.mockResolvedValue(
        kind === 'unreadable' ? null : { ...reading(), amount: kind === 'mismatch' ? 1 : 12000 },
      );
      if (kind === 'provider-error')
        vision.extractSlip.mockRejectedValueOnce(new Error('PRIVATE-PROVIDER-ERROR'));
      const response = await verify(
        c.id,
        who,
        kind === 'clamp' ? '100' : kind === 'tiny' ? '0.00000001' : '50',
        'PRIVATE-REASON',
      );
      expect(response.status).toBe(201);
      expect(response.body).toEqual({ requestId: expect.any(String), status: 'PENDING_APPROVAL' });
      const row = await evidence(c.id);
      expect(row.requestId).toBe(response.body.requestId);
      expect(row.tokenHash).toBeNull();
      expect(row.expiresAt).toBeNull();
      if (['unreadable', 'mismatch', 'provider-error'].includes(kind))
        expect(row.verified).toBe(false);
      if (kind === 'clamp') expect(row.effectiveDiscountPct).toBe('50');
      const req = await db.paymentApprovalRequest.findUniqueOrThrow({
        where: { id: row.requestId! },
      });
      expect(req.snapshot).toMatchObject({
        managedPayoffEvidenceId: row.id,
        managedEarlyPayoffSource: { requesterId: who, contractId: c.id },
      });
      expect((await state(c.id)).paid).toBe(0);
    }
    expect(publicUrl).not.toHaveBeenCalled();
    expect(JSON.stringify(audit.log.mock.calls)).not.toMatch(
      /PRIVATE-REASON|PRIVATE-PROVIDER|token|reading/,
    );
  },
);
it('unreadable explicit zero is useful five-check failure without executable authority', async () => {
  const c = await contract();
  vision.extractSlip.mockResolvedValue(null);
  const response = await verify(c.id);
  expect(response.status).toBe(201);
  expect(response.body).toMatchObject({ matched: false, available: false, ticket: null });
  expect(response.body.checks).toHaveLength(5);
  expect((await evidence(c.id)).tokenHash).toBeNull();
  expect((await state(c.id)).paid).toBe(0);
});
it('opaque token rejects actor/source substitution, legacy v1 and expiry without money', async () => {
  const c = await contract(),
    other = await contract(),
    who = await person(true);
  await grant(who);
  const token = await ticket(c);
  const before = await state(c.id);
  expect((await confirm(c, token, who)).status).toBe(409);
  expect((await confirm(other, token)).status).toBe(409);
  expect((await confirm(c, 'eyJ2IjoxfQ.signature')).status).toBe(400);
  const clock = jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 16 * 60 * 1000);
  try {
    expect((await confirm(c, token)).status).toBe(409);
  } finally {
    clock.mockRestore();
  }
  expect(await state(c.id)).toEqual(before);
  expect((await evidence(c.id)).consumedAt).toBeNull();
});
it('same cash changed allocation inputs and changed quote both invalidate tickets', async () => {
  for (const changedCash of [false, true]) {
    const c = await contract(),
      token = await ticket(c);
    const p = await db.payment.findFirstOrThrow({ where: { contractId: c.id } });
    await db.payment.update({
      where: { id: p.id },
      data: changedCash
        ? { amountPaid: 1, status: 'PARTIALLY_PAID' }
        : { monthlyPrincipal: 999, monthlyInterest: 201 },
    });
    const before = await state(c.id);
    expect((await confirm(c, token)).status).toBe(409);
    expect(await state(c.id)).toEqual(before);
  }
});
it('real canonical 2A posting changes ledger while unchanged customer money remains executable', async () => {
  const c = await contract(),
    token = await ticket(c);
  const schedule = await db.installmentSchedule.findFirstOrThrow({
    where: { contractId: c.id },
    orderBy: { installmentNo: 'asc' },
  });
  const before = await service.getEarlyPayoffQuote(c.id, 0);
  const accrual = await new InstallmentAccrual2ATemplate(journal, prisma).execute(schedule.id);
  expect(accrual).not.toBeNull();
  const after = await service.getEarlyPayoffQuote(c.id, 0);
  expect(after.totalPayoff).toBe(before.totalPayoff);
  expect(after.journalPreview).not.toEqual(before.journalPreview);
  expect((await confirm(c, token)).status).toBe(201);
  expect((await state(c.id)).paid).toBe(10);
});
it('one-time consumption rejects duplicate concurrent confirmation and emits effects once', async () => {
  const c = await contract(),
    token = await ticket(c);
  const responses = await Promise.all([confirm(c, token), confirm(c, token)]);
  expect(responses.map((r) => r.status).sort()).toEqual([201, 403]);
  expect((await state(c.id)).receipts).toBe(1);
  expect(line.sendPaymentReceipt).toHaveBeenCalledTimes(1);
  expect(journey.recordAfterCommit).toHaveBeenCalledTimes(1);
});
it('identical no-ref bytes across random keys, actors and Contracts consume globally only once', async () => {
  const bytes = imageBytes(),
    a = await contract(),
    b = await contract(),
    who = await person(true);
  await grant(who);
  vision.extractSlip.mockResolvedValue({ ...reading(), refNo: null });
  const ta = await ticket(a, actor, bytes),
    tb = await ticket(b, who, bytes);
  const ea = await evidence(a.id),
    eb = await evidence(b.id);
  expect(ea.objectKey).not.toBe(eb.objectKey);
  expect(ea.slipFingerprint).not.toBe(eb.slipFingerprint);
  expect(ea.contentHash).toBe(eb.contentHash);
  const responses = await Promise.all([confirm(a, ta), confirm(b, tb, who)]);
  expect(responses.map((r) => r.status).sort()).toEqual([201, 409]);
  expect(
    await db.managedPayoffEvidence.count({
      where: { contentHash: ea.contentHash, consumedAt: { not: null } },
    }),
  ).toBe(1);
  expect((await state(a.id)).receipts + (await state(b.id)).receipts).toBe(1);
  expect(line.sendPaymentReceipt).toHaveBeenCalledTimes(1);
});
it('genuine legacy ref fingerprint still independently prevents replay across changed bytes', async () => {
  const c = await contract();
  const r = reading();
  vision.extractSlip.mockResolvedValue(r);
  const { slipFingerprint } = await import('./early-payoff-slip/slip-checks');
  await db.slipFingerprint.create({
    data: { contractId: c.id, hash: slipFingerprint(r, 'legacy') },
  });
  const response = await verify(c.id);
  expect(response.status).toBe(201);
  expect(response.body.ticket).toBeNull();
  expect(response.body.checks.find((v: { code: string }) => v.code === 'NOT_REUSED').ok).toBe(
    false,
  );
});
it('current grant revocation during one provider call denies late persistence and retains actual local bytes', async () => {
  const who = await person(true),
    assignment = await grant(who),
    c = await contract();
  vision.extractSlip.mockImplementationOnce(async () => {
    expect(currentDomainAccess()).toBeUndefined();
    await db.employeeAccessAssignment.update({
      where: { id: assignment.id },
      data: { deletedAt: new Date() },
    });
    return reading();
  });
  const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  try {
    expect((await verify(c.id, who)).status).toBe(403);
    expect(uploadOwned).toHaveBeenCalledTimes(1);
    expect(vision.extractSlip).toHaveBeenCalledTimes(1);
    expect(cleanup).toHaveBeenCalledTimes(1);
    const key = uploadOwned.mock.calls[0][0];
    expect(await readFile(join(files, key))).toEqual(uploadOwned.mock.calls[0][1]);
    expect(await db.managedPayoffEvidence.count({ where: { contractId: c.id } })).toBe(0);
    expect(warn).toHaveBeenCalledWith({
      event: 'PAYOFF_EVIDENCE_CLEANUP_RETAINED',
      reason: 'local-path-identity-not-atomic',
    });
  } finally {
    warn.mockRestore();
  }
});
it('current source changed during OCR and revoked permission at confirm remain denied', async () => {
  const c = await contract();
  vision.extractSlip.mockImplementationOnce(async () => {
    await db.product.update({ where: { id: c.productId }, data: { ownedByCompanyId: shop } });
    return reading();
  });
  const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  try {
    expect((await verify(c.id)).status).toBe(403);
  } finally {
    warn.mockRestore();
  }
  const who = await person(true),
    assignment = await grant(who),
    b = await contract(),
    token = await ticket(b, who);
  await db.employeeAccessAssignment.update({
    where: { id: assignment.id },
    data: { deletedAt: new Date() },
  });
  expect((await confirm(b, token, who)).status).toBe(403);
  expect((await state(b.id)).paid).toBe(0);
});
it('private local objects are write-once and retained cleanup never erases or replaces bytes', async () => {
  const c = await contract();
  await ticket(c);
  const row = await evidence(c.id),
    original = await readFile(join(files, row.objectKey));
  await expect(
    storage.uploadOwned(row.objectKey, Buffer.from('replacement'), 'image/png', randomUUID()),
  ).rejects.toThrow();
  expect(await storage.deleteOwned(row.objectKey, row.operationId)).toEqual({
    status: 'retained',
    reason: 'local-path-identity-not-atomic',
  });
  expect(await readFile(join(files, row.objectKey))).toEqual(original);
});
it('immutable evidence rejects PG mutation, deletion, malformed ticket pairs and false linkage', async () => {
  const c = await contract();
  await ticket(c);
  const row = await evidence(c.id);
  for (const data of [
    { objectKey: 'replacement' },
    { reading: {} },
    { moneyFingerprint: 'a'.repeat(64) },
    { tokenHash: 'b'.repeat(64) },
    { expiresAt: new Date(Date.now() + 999999) },
    { requestId: randomUUID() },
  ])
    await expect(
      db.managedPayoffEvidence.update({ where: { id: row.id }, data }),
    ).rejects.toThrow();
  await expect(db.managedPayoffEvidence.delete({ where: { id: row.id } })).rejects.toThrow();
  for (const over of [
    { tokenHash: null, expiresAt: new Date() },
    { expiresAt: new Date(Date.now() + 60 * 60 * 1000) },
    { consumedAt: new Date(), receiptId: randomUUID() },
  ]) {
    const copy = row;
    await expect(
      db.managedPayoffEvidence.create({
        data: {
          ...copy,
          reading: row.reading as Prisma.InputJsonValue,
          checks: row.checks as Prisma.InputJsonValue,
          moneySnapshot: row.moneySnapshot as Prisma.InputJsonValue,
          id: randomUUID(),
          operationId: randomUUID(),
          objectKey: randomUUID(),
          tokenHash: createHash('sha256').update(randomUUID()).digest('hex'),
          ...over,
        },
      }),
    ).rejects.toThrow();
  }
  expect(await evidence(c.id)).toEqual(row);
});
it('pending evidence survives ticket expiry without executable authority or mutable request relink', async () => {
  const c = await contract();
  const response = await verify(c.id, actor, '50', 'Review');
  expect(response.status).toBe(201);
  const row = await evidence(c.id);
  const clock = jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 24 * 60 * 60 * 1000);
  try {
    expect(await evidence(c.id)).toEqual(row);
    expect(await readFile(join(files, row.objectKey))).toEqual(uploadOwned.mock.calls[0][1]);
  } finally {
    clock.mockRestore();
  }
  await expect(
    db.managedPayoffEvidence.update({ where: { id: row.id }, data: { requestId: null } }),
  ).rejects.toThrow();
});
it('late actual domain audit failure rolls back money, receipt, ownership, evidence consumption and effects', async () => {
  const c = await contract(),
    token = await ticket(c),
    before = await state(c.id);
  await db.$executeRawUnsafe(
    `CREATE FUNCTION payoff_private_fail_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='EARLY_PAYOFF_EVIDENCE_CONSUMED' THEN RAISE EXCEPTION 'OWNED-LATE-AUDIT'; END IF; RETURN NEW; END $$`,
  );
  await db.$executeRawUnsafe(
    'CREATE TRIGGER payoff_private_fail_audit BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION payoff_private_fail_audit()',
  );
  try {
    expect((await confirm(c, token)).status).toBe(500);
    expect(await state(c.id)).toEqual(before);
    expect((await evidence(c.id)).consumedAt).toBeNull();
    expect(line.sendPaymentReceipt).not.toHaveBeenCalled();
    expect(journey.recordAfterCommit).not.toHaveBeenCalled();
  } finally {
    await db.$executeRawUnsafe('DROP TRIGGER payoff_private_fail_audit ON audit_logs');
    await db.$executeRawUnsafe('DROP FUNCTION payoff_private_fail_audit()');
  }
  expect((await confirm(c, token)).status).toBe(201);
  expect(line.sendPaymentReceipt).toHaveBeenCalledTimes(1);
});
it('safe audit omits raw ticket, file, provider text and notes on success and denial', async () => {
  const c = await contract(),
    token = await ticket(c);
  expect((await confirm(c, token)).status).toBe(201);
  const row = await evidence(c.id);
  const domain = await db.auditLog.findMany({ where: { entityId: c.id } });
  const serialized = JSON.stringify([...audit.log.mock.calls, domain]);
  for (const secret of [
    token,
    row.objectKey,
    'PRIVATE-NOTES',
    'PRIVATE-REASON',
    'toAccount',
    'confidence',
  ])
    expect(serialized).not.toContain(secret);
});
it('real serializable evidence retry stages private upload and OCR only once outside transaction', async () => {
  const c = await contract();
  await db.$executeRawUnsafe('CREATE SEQUENCE payoff_private_retry');
  await db.$executeRawUnsafe(
    `CREATE FUNCTION payoff_private_retry_evidence() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF nextval('payoff_private_retry')=1 THEN RAISE EXCEPTION 'OWNED-RETRY' USING ERRCODE='40001'; END IF; RETURN NEW; END $$`,
  );
  await db.$executeRawUnsafe(
    'CREATE TRIGGER payoff_private_retry_evidence BEFORE INSERT ON managed_payoff_evidence FOR EACH ROW EXECUTE FUNCTION payoff_private_retry_evidence()',
  );
  vision.extractSlip.mockImplementationOnce(async () => {
    expect(currentDomainAccess()).toBeUndefined();
    return reading();
  });
  try {
    expect((await verify(c.id)).status).toBe(201);
    expect(uploadOwned).toHaveBeenCalledTimes(1);
    expect(vision.extractSlip).toHaveBeenCalledTimes(1);
    expect(cleanup).not.toHaveBeenCalled();
    expect(await db.managedPayoffEvidence.count({ where: { contractId: c.id } })).toBe(1);
  } finally {
    await db.$executeRawUnsafe(
      'DROP TRIGGER payoff_private_retry_evidence ON managed_payoff_evidence',
    );
    await db.$executeRawUnsafe('DROP FUNCTION payoff_private_retry_evidence()');
    await db.$executeRawUnsafe('DROP SEQUENCE payoff_private_retry');
  }
});
it('actual after-commit delivery observes evidence consumption and failure never retries money', async () => {
  const c = await contract(),
    token = await ticket(c);
  let observed = false;
  line.sendPaymentReceipt.mockImplementationOnce(async () => {
    expect(currentDomainAccess()).toBeUndefined();
    expect((await evidence(c.id)).consumedAt).not.toBeNull();
    expect((await state(c.id)).receipts).toBe(1);
    observed = true;
    throw new Error('CONTROLLED-DELIVERY');
  });
  const error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  try {
    expect((await confirm(c, token)).status).toBe(201);
    expect(observed).toBe(true);
    expect(line.sendPaymentReceipt).toHaveBeenCalledTimes(1);
    expect((await state(c.id)).receipts).toBe(1);
  } finally {
    error.mockRestore();
  }
});
it('managed actor cannot stage legacy public evidence without the server preparation context', async () => {
  const c = await contract();
  await expect(
    slip.verify(
      c.id,
      { buffer: png, mimetype: 'image/png', size: png.length } as Express.Multer.File,
      '0',
      actor,
    ),
  ).rejects.toThrow();
  expect(vision.extractSlip).not.toHaveBeenCalled();
  expect(publicUrl).not.toHaveBeenCalled();
  expect(uploadOwned).not.toHaveBeenCalled();
});
it('provider upload failure has fixed response and safe retained cleanup with no OCR or evidence', async () => {
  const c = await contract();
  uploadOwned.mockRejectedValueOnce(new Error('PRIVATE-STORAGE-KEY/PII'));
  const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  try {
    const response = await verify(c.id);
    expect(response.status).toBe(503);
    expect(JSON.stringify(response.body)).not.toContain('PRIVATE');
    expect(vision.extractSlip).not.toHaveBeenCalled();
    expect(await db.managedPayoffEvidence.count({ where: { contractId: c.id } })).toBe(0);
    expect(cleanup).toHaveBeenCalledTimes(1);
  } finally {
    warn.mockRestore();
  }
});
it('missing rate keeps canonical positive default 50 and never issues zero authority', async () => {
  const c = await contract();
  const response = await http(c.id)
    .field('reason', 'Review default')
    .attach('slip', imageBytes(), { filename: 's.png', contentType: 'image/png' });
  expect(response.status).toBe(201);
  expect(response.body).toEqual({ requestId: expect.any(String), status: 'PENDING_APPROVAL' });
  expect((await evidence(c.id)).effectiveDiscountPct).toBe('50');
});
it('actual buffer length defeats forged reported file size before owned provider work', async () => {
  const { procurementPreparation } = await import('../employee-access/access-preparation-context');
  const c = await contract();
  const authorize = jest.fn(),
    bytes = Buffer.concat([png, Buffer.alloc(5 * 1024 * 1024)]);
  await expect(
    procurementPreparation.run(
      { source: 'payoff-slip', authorize, execute: (handler) => handler() },
      () =>
        slip.verifyManaged(
          c.id,
          { buffer: bytes, mimetype: 'image/png', size: 1 } as Express.Multer.File,
          '0',
          actor,
        ),
    ),
  ).rejects.toThrow();
  expect(authorize).not.toHaveBeenCalled();
  expect(uploadOwned).not.toHaveBeenCalled();
  expect(vision.extractSlip).not.toHaveBeenCalled();
});
it('database consumed-content uniqueness itself rolls back canonical money even without advisory replay precheck', async () => {
  const bytes = imageBytes(),
    a = await contract(),
    b = await contract();
  vision.extractSlip.mockResolvedValue({ ...reading(), refNo: null });
  const ta = await ticket(a, actor, bytes);
  await ticket(b, actor, bytes);
  expect((await confirm(a, ta)).status).toBe(201);
  const ea = await evidence(a.id),
    eb = await evidence(b.id),
    before = await state(b.id);
  line.sendPaymentReceipt.mockClear();
  journey.recordAfterCommit.mockClear();
  const executor = new AccessResourceService(prisma, snapshots);
  await expect(
    executor.execute(
      actor,
      'payments.create',
      'FINANCE',
      undefined,
      async () => {
        const result = await service.earlyPayoff(
          b.id,
          actor,
          { paymentMethod: 'BANK_TRANSFER', discountPct: 0, paymentDate: eb.paymentDate },
          undefined,
          {
            imageKey: eb.objectKey,
            hash: eb.slipFingerprint!,
            amount: 12000,
            refNo: null,
            bankName: 'KBANK',
            date: eb.paymentDate,
            confidence: 0.99,
          },
        );
        await currentDomainAccess()!.client.managedPayoffEvidence.update({
          where: { id: eb.id },
          data: { consumedAt: new Date(), receiptId: result.receiptId! },
        });
      },
      false,
      { domain: 'parties', isolationLevel: 'Serializable' },
    ),
  ).rejects.toMatchObject({ code: 'P2002' });
  expect(await state(b.id)).toEqual(before);
  expect((await evidence(b.id)).consumedAt).toBeNull();
  expect(line.sendPaymentReceipt).not.toHaveBeenCalled();
  expect(journey.recordAfterCommit).not.toHaveBeenCalled();
  await expect(
    db.managedPayoffEvidence.update({
      where: { id: ea.id },
      data: { consumedAt: null, receiptId: null },
    }),
  ).rejects.toThrow('immutable');
});
it('legacy verify rechecks persisted migration after OCR before releasing readable v1 authority', async () => {
  const c = await contract(),
    who = await person(false);
  vision.extractSlip.mockImplementationOnce(async () => {
    await db.user.update({ where: { id: who }, data: { accessManaged: true } });
    return reading();
  });
  await expect(
    slip.verify(
      c.id,
      { buffer: imageBytes(), mimetype: 'image/png', size: 68 } as Express.Multer.File,
      '0',
      who,
    ),
  ).rejects.toThrow();
  expect(vision.extractSlip).toHaveBeenCalledTimes(1);
  expect((await state(c.id)).paid).toBe(0);
});
it('genuinely unmanaged legacy verify remains compatible on real owned PostgreSQL', async () => {
  const c = await contract(),
    who = await person(false),
    bytes = imageBytes();
  const result = await slip.verify(
    c.id,
    { buffer: bytes, mimetype: 'image/png', size: bytes.length } as Express.Multer.File,
    '0',
    who,
  );
  expect(result).toMatchObject({
    matched: true,
    expectedAmount: 12000,
    ticket: expect.stringContaining('.'),
  });
  expect(vision.extractSlip).toHaveBeenCalledTimes(1);
});
it('legacy migration during failing OCR never logs provider-private canary text', async () => {
  const c = await contract(),
    who = await person(false),
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  vision.extractSlip.mockImplementationOnce(async () => {
    await db.user.update({ where: { id: who }, data: { accessManaged: true } });
    throw new Error('PRIVATE-OCR-MIGRATION-CANARY');
  });
  try {
    await expect(
      slip.verify(
        c.id,
        { buffer: imageBytes(), mimetype: 'image/png', size: 68 } as Express.Multer.File,
        '0',
        who,
      ),
    ).rejects.toThrow();
    expect(vision.extractSlip).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(warn.mock.calls)).not.toContain('PRIVATE-OCR-MIGRATION-CANARY');
  } finally {
    warn.mockRestore();
  }
});
it('real Vision provider failure during legacy migration has safe Logger and Sentry diagnostics', async () => {
  const c = await contract(),
    who = await person(false);
  const create = jest.fn(async () => {
    await db.user.update({ where: { id: who }, data: { accessManaged: true } });
    throw new Error('PRIVATE-REAL-VISION-MIGRATION-CANARY');
  });
  jest
    .mocked(Anthropic)
    .mockImplementation(() => ({ messages: { create } }) as unknown as Anthropic);
  const realVision = new VisionService(
    {
      getValue: jest.fn().mockResolvedValue('synthetic-controlled-sdk-only'),
    } as unknown as IntegrationConfigService,
    { record: jest.fn().mockResolvedValue(undefined) } as unknown as AiUsageService,
  );
  const actualSlip = new EarlyPayoffSlipService(
    prisma,
    storage,
    realVision,
    financeConfig as unknown as FinanceConfigService,
    service,
    config,
  );
  const error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  jest.mocked(Sentry.captureException).mockClear();
  try {
    await expect(
      actualSlip.verify(
        c.id,
        { buffer: imageBytes(), mimetype: 'image/png', size: 68 } as Express.Multer.File,
        '0',
        who,
      ),
    ).rejects.toThrow();
    expect(create).toHaveBeenCalledTimes(1);
    expect((await state(c.id)).paid).toBe(0);
    expect(
      inspect(
        [
          error.mock.calls,
          warn.mock.calls,
          jest.mocked(Logger.prototype.log).mock.calls,
          jest.mocked(Sentry.captureException).mock.calls,
          jest.mocked(Sentry.captureMessage).mock.calls,
        ],
        { depth: 10 },
      ),
    ).not.toContain('PRIVATE-REAL-VISION-MIGRATION-CANARY');
    expect(Sentry.captureException).not.toHaveBeenCalled();
  } finally {
    error.mockRestore();
    warn.mockRestore();
  }
});
