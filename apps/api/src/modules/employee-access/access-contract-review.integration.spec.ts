import { AccessContractReviewBoundaries } from './access-contract-review-boundaries';
import { AccessContractPreparationActions } from './access-contract-preparation-actions';
import { randomUUID } from 'node:crypto';
import {
  Prisma,
  PrismaClient,
  ContractWorkflowStatus,
  SignerType,
  ContractDocumentType,
} from '@prisma/client';
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
import { currentDomainAccess } from './access-execution-context';
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
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { BranchGuard } from '../auth/guards/branch.guard';

const url = process.env.EMPLOYEE_ACCESS_TEST_DATABASE_URL;
if (
  !url?.includes('/bc_access_contract_review?host=/tmp/bc-access-contract-review.') ||
  process.env.DATABASE_URL !== url ||
  process.env.DATABASE_URL_FINANCE !== url
)
  throw new Error('Both database URLs must identify the owned isolated cluster');
const db = new PrismaClient({ datasources: { db: { url } } });
const snapshots = new AccessSnapshotService(db as PrismaService);
const marker = randomUUID();
const effects: Array<{ refId: string; decision: string; inTransaction: boolean }> = [];
const journey = {
  recordAfterCommit: async (entry: { refId: string; data: { decision: string } }) => {
    effects.push({
      refId: entry.refId,
      decision: entry.data.decision,
      inTransaction: !!currentDomainAccess(),
    });
  },
};
// Review never calls the activation/stock/journal/provider dependencies. Fail on accidental use.
const external = new Proxy(
  {},
  {
    get: (_target, key) => () => {
      throw new Error(`Unexpected external effect: ${String(key)}`);
    },
  },
);
const workflow = new ContractWorkflowService(
  db as PrismaService,
  external as never,
  external as never,
  external as never,
  external as never,
  external as never,
  external as never,
  external as never,
  external as never,
  external as never,
  { isEnabled: async () => false } as never,
  journey as never,
);
let app: INestApplication;
let branchA: string,
  branchB: string,
  maker: string,
  checker: string,
  denied: string,
  asymmetric: string;
const staleSnapshots = new Map<string, AccessSnapshot>();
const previousNodeEnv = process.env.NODE_ENV;
type Method = 'submit-review' | 'approve' | 'reject';
const methods: Method[] = ['submit-review', 'approve', 'reject'];
async function user(owner = false) {
  return (
    await db.user.create({
      data: {
        name: 'Owned review test',
        email: randomUUID() + '@test.invalid',
        password: 'unused',
        role: owner ? 'OWNER' : 'ACCOUNTANT',
        accessManaged: true,
      },
    })
  ).id;
}
async function grant(
  id: string,
  permissions: PermissionKey[],
  companyCode = 'FINANCE',
  branches?: string[],
  scope?: 'ASSIGNED',
) {
  const position = await db.accessPosition.create({
    data: { code: randomUUID(), name: 'Owned review test', permissions },
  });
  return db.employeeAccessAssignment.create({
    data: {
      userId: id,
      positionId: position.id,
      companyCode,
      scope: scope ?? (branches ? 'BRANCHES' : 'COMPANY'),
      ...(branches ? { branches: { create: branches.map((branchId) => ({ branchId })) } } : {}),
    },
  });
}
async function fixture(method: Method, branchId = branchA, salespersonId = maker) {
  const customer = await db.customer.create({
    data: {
      name: 'PRIVATE-REVIEW-CUSTOMER',
      phone: '0800000000',
      birthDate: new Date('1990-01-01'),
      nationalId: randomUUID(),
      addressIdCard: 'Owned synthetic address',
      addressCurrent: 'Owned synthetic address',
      references: [{ name: 'Synthetic reference' }],
      accessCompanyCode: 'SHOP',
      accessBranchId: branchId,
    },
  });
  const product = await db.product.create({
    data: {
      name: 'PRIVATE-REVIEW-PRODUCT',
      brand: 'Apple',
      model: 'Test',
      imeiSerial: randomUUID(),
      category: 'PHONE_NEW',
      costPrice: 7777,
      branchId,
    },
  });
  const consent = await db.pDPAConsent.create({
    data: {
      customerId: customer.id,
      consentVersion: 'owned-test-v1',
      privacyNoticeText: 'Owned synthetic consent',
      status: 'GRANTED',
      grantedAt: new Date(),
    },
  });
  return db.contract.create({
    data: {
      contractNumber: 'REVIEW-' + randomUUID(),
      customerId: customer.id,
      productId: product.id,
      branchId,
      salespersonId,
      assignedToId: checker,
      planType: 'STORE_WITH_INTEREST',
      sellingPrice: 12000,
      downPayment: 2000,
      financedAmount: 10000,
      interestRate: 0.01,
      totalMonths: 10,
      interestTotal: 1000,
      monthlyPayment: 1100,
      notes: 'PRIVATE-REVIEW-NOTES',
      status: 'DRAFT',
      pdpaConsentId: consent.id,
      creditCheck: { create: { customerId: customer.id, status: 'APPROVED' } },
      workflowStatus: method === 'submit-review' ? 'CREATING' : 'PENDING_REVIEW',
      signatures: {
        create: (['CUSTOMER', 'COMPANY', 'WITNESS_1', 'WITNESS_2'] as SignerType[]).map(
          (signerType) => ({ signerType, signatureImage: 'PRIVATE-SIGNATURE', staffUserId: maker }),
        ),
      },
      contractDocuments: {
        create: (
          [
            'SIGNED_CONTRACT',
            'ID_CARD_COPY',
            'KYC_SELFIE',
            'DEVICE_PHOTO',
          ] as ContractDocumentType[]
        ).map((documentType) => ({
          documentType,
          fileName: 'private.pdf',
          fileUrl: 'private/storage/key',
          fileHash: 'PRIVATE-FILE-HASH',
          uploadedById: maker,
        })),
      },
    },
  });
}
function action(
  method: Method,
  id: string,
  actor = method === 'submit-review' ? maker : checker,
  company = method === 'submit-review' ? 'SHOP' : 'FINANCE',
  notes = 'Bounded review reason',
) {
  return request(app.getHttpServer())
    .post(`/contracts/${id}/${method}`)
    .set('x-test-user', actor)
    .set('x-company-scope', company)
    .send({ reviewNotes: notes })
    .expect('x-owned-contract-review-app', marker);
}
function state(method: Method): ContractWorkflowStatus {
  return method === 'submit-review'
    ? 'PENDING_REVIEW'
    : method === 'approve'
      ? 'APPROVED'
      : 'REJECTED';
}
beforeAll(async () => {
  process.env.NODE_ENV = 'production';
  const shop = await db.companyInfo.findUniqueOrThrow({ where: { companyCode: 'SHOP' } });
  branchA = (await db.branch.create({ data: { name: 'Review A', companyId: shop.id } })).id;
  branchB = (await db.branch.create({ data: { name: 'Review B', companyId: shop.id } })).id;
  maker = await user();
  checker = await user();
  denied = await user();
  asymmetric = await user();
  await grant(maker, ['contracts.update', 'customers.read', 'products.read'], 'SHOP', [branchA]);
  await grant(checker, ['contracts.approve'], 'FINANCE', [branchA]);
  await grant(
    asymmetric,
    ['contracts.update', 'contracts.approve', 'customers.read', 'products.read'],
    'SHOP',
    [branchA],
  );
  await grant(
    asymmetric,
    ['contracts.update', 'contracts.approve', 'customers.read', 'products.read'],
    'FINANCE',
    [branchB],
  );
  const module = await Test.createTestingModule({
    controllers: [ContractsController],
    providers: [
      AuditService,
      AccessContractReviewBoundaries,
      AccessContractPreparationActions,
      AccessResourceService,
      AccessPartySourceService,
      AccessProcurementSourceService,
      AccessPolicyService,
      { provide: PrismaService, useValue: db },
      { provide: AccessSnapshotService, useValue: snapshots },
      { provide: ContractWorkflowService, useValue: workflow },
      ...[
        ContractsService,
        ContractPaymentService,
        ContractDocumentService,
        ContractSnapshotService,
        ContractJournalQueryService,
        EarlyPayoffSlipService,
        JourneyEntryWriter,
      ].map((provide) => ({ provide, useValue: {} })),
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
  app = module.createNestApplication();
  app.use(
    (_req: unknown, res: { setHeader: (key: string, value: string) => void }, next: () => void) => {
      res.setHeader('x-owned-contract-review-app', marker);
      next();
    },
  );
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
  await app.listen(0, '127.0.0.1');
}, 60000);
afterAll(async () => {
  await app?.close();
  await db.$disconnect();
  process.env.NODE_ENV = previousNodeEnv;
});

it.each(methods)(
  'R103 authorized %s executes the actual canonical workflow without a read grant',
  async (method) => {
    const row = await fixture(method);
    const result = await action(method, row.id);
    expect(result.status).toBe(201);
    expect((await db.contract.findUniqueOrThrow({ where: { id: row.id } })).workflowStatus).toBe(
      state(method),
    );
    expect(result.body).toEqual({ id: row.id, workflowStatus: state(method) });
  },
);
it.each(methods)(
  'R103 %s denies no grants and foreign origin without changing state',
  async (method) => {
    const row = await fixture(method),
      foreign = await fixture(method, branchB);
    expect((await action(method, row.id, denied)).status).toBe(403);
    expect((await action(method, foreign.id)).status).toBe(403);
    expect((await db.contract.findUniqueOrThrow({ where: { id: row.id } })).workflowStatus).toBe(
      row.workflowStatus,
    );
    expect(
      (await db.contract.findUniqueOrThrow({ where: { id: foreign.id } })).workflowStatus,
    ).toBe(foreign.workflowStatus);
  },
);
it.each(methods)('R103 %s preserves asymmetric company/branch tuples', async (method) => {
  const row = await fixture(method, method === 'submit-review' ? branchB : branchA, asymmetric);
  expect((await action(method, row.id, asymmetric)).status).toBe(403);
});
it.each(methods)(
  'R103 %s reloads current authority despite a stale authenticated snapshot',
  async (method) => {
    const actor = await user();
    const assignment = await grant(
      actor,
      [
        method === 'submit-review' ? 'contracts.update' : 'contracts.approve',
        'customers.read',
        'products.read',
      ],
      method === 'submit-review' ? 'SHOP' : 'FINANCE',
      [branchA],
    );
    staleSnapshots.set(actor, await snapshots.forUser(actor));
    await db.employeeAccessAssignment.update({
      where: { id: assignment.id },
      data: { deletedAt: new Date() },
    });
    const row = await fixture(method, branchA, method === 'submit-review' ? actor : maker);
    expect((await action(method, row.id, actor)).status).toBe(403);
    expect((await db.contract.findUniqueOrThrow({ where: { id: row.id } })).workflowStatus).toBe(
      row.workflowStatus,
    );
    staleSnapshots.delete(actor);
  },
);

it.each(['approve', 'reject'] as const)(
  'R103 non-owner maker cannot %s their own current work',
  async (method) => {
    const row = await fixture(method, branchA, checker);
    expect((await action(method, row.id, checker)).status).toBe(403);
    expect((await db.contract.findUniqueOrThrow({ where: { id: row.id } })).workflowStatus).toBe(
      'PENDING_REVIEW',
    );
  },
);
it('R103 protected owner cannot submit for another current salesperson', async () => {
  const owner = await user(true),
    row = await fixture('submit-review');
  expect((await action('submit-review', row.id, owner)).status).toBe(403);
});
it.each([
  ['empty', ''],
  ['whitespace', '   '],
  ['overlong', 'x'.repeat(2001)],
])(
  'R103 ordinary owner own approval requires a nonempty bounded reason (%s)',
  async (_label, reason) => {
    const owner = await user(true),
      row = await fixture('approve', branchA, owner);
    expect((await action('approve', row.id, owner, 'FINANCE', reason)).status).toBe(400);
    expect((await db.contract.findUniqueOrThrow({ where: { id: row.id } })).workflowStatus).toBe(
      'PENDING_REVIEW',
    );
  },
);
it('R103 ordinary protected-owner own approval records the actual maker/checker and safe reason', async () => {
  const owner = await user(true),
    row = await fixture('approve', branchA, owner);
  const result = await action('approve', row.id, owner, 'FINANCE', '  Synthetic owner reason  ');
  expect(result.status).toBe(201);
  const audit = await db.auditLog.findFirstOrThrow({
    where: { entityId: row.id, action: 'CONTRACT_OWNER_SELF_APPROVED' },
  });
  expect(audit.newValue).toEqual({
    makerId: owner,
    checkerId: owner,
    reason: 'Synthetic owner reason',
  });
  expect(result.body).toEqual({ id: row.id, workflowStatus: 'APPROVED' });
});
it('owner self-approval accepts a trimmed reason at the 2000-character boundary', async () => {
  const owner = await user(true),
    row = await fixture('approve', branchA, owner);
  expect(
    (await action('approve', row.id, owner, 'FINANCE', '  ' + 'x'.repeat(2000) + '  ')).status,
  ).toBe(201);
  const proof = await db.auditLog.findFirstOrThrow({
    where: { entityId: row.id, action: 'CONTRACT_OWNER_SELF_APPROVED' },
  });
  expect((proof.newValue as { reason: string }).reason).toBe('x'.repeat(2000));
});

it.each(['credit', 'pdpa', 'signature', 'fields'] as const)(
  'production submit preserves canonical missing %s rejection without public checklist reads',
  async (missing) => {
    const row = await fixture('submit-review');
    if (missing === 'credit')
      await db.creditCheck.update({ where: { contractId: row.id }, data: { status: 'PENDING' } });
    if (missing === 'pdpa')
      await db.contract.update({ where: { id: row.id }, data: { pdpaConsentId: null } });
    if (missing === 'signature')
      await db.signature.updateMany({
        where: { contractId: row.id, signerType: 'CUSTOMER' },
        data: { deletedAt: new Date() },
      });
    if (missing === 'fields')
      await db.customer.update({ where: { id: row.customerId }, data: { addressCurrent: null } });
    expect((await action('submit-review', row.id)).status).toBe(400);
    expect((await db.contract.findUniqueOrThrow({ where: { id: row.id } })).workflowStatus).toBe(
      'CREATING',
    );
  },
);
it.each(['document', 'signature', 'guardian'] as const)(
  'approval preserves canonical missing %s rejection without independent evidence reads',
  async (missing) => {
    const row = await fixture('approve');
    if (missing === 'document')
      await db.contractDocument.updateMany({
        where: { contractId: row.id, documentType: 'SIGNED_CONTRACT' },
        data: { deletedAt: new Date() },
      });
    if (missing === 'signature')
      await db.signature.updateMany({
        where: { contractId: row.id, signerType: 'WITNESS_1' },
        data: { deletedAt: new Date() },
      });
    if (missing === 'guardian')
      await db.customer.update({
        where: { id: row.customerId },
        data: { birthDate: new Date('2008-01-01') },
      });
    expect((await action('approve', row.id)).status).toBe(400);
    expect((await db.contract.findUniqueOrThrow({ where: { id: row.id } })).workflowStatus).toBe(
      'PENDING_REVIEW',
    );
  },
);
it.each(['document', 'signature', 'money'] as const)(
  'submission seals canonical evidence and approval refuses a later %s edit',
  async (changed) => {
    const row = await fixture('submit-review');
    expect((await action('submit-review', row.id)).status).toBe(201);
    const sealed = await db.contract.findUniqueOrThrow({ where: { id: row.id } });
    expect(sealed.contractHash).toMatch(/^[a-f0-9]{64}$/);
    if (changed === 'document')
      await db.contractDocument.updateMany({
        where: { contractId: row.id, documentType: 'SIGNED_CONTRACT' },
        data: { fileHash: 'ALTERED-HASH' },
      });
    if (changed === 'signature')
      await db.signature.updateMany({
        where: { contractId: row.id, signerType: 'CUSTOMER' },
        data: { signedAt: new Date('2000-01-01') },
      });
    if (changed === 'money')
      await db.contract.update({ where: { id: row.id }, data: { sellingPrice: 13000 } });
    expect((await action('approve', row.id)).status).toBe(400);
    expect((await db.contract.findUniqueOrThrow({ where: { id: row.id } })).workflowStatus).toBe(
      'PENDING_REVIEW',
    );
  },
);
it.each(['approve', 'reject'] as const)(
  '%s uses assignment-free authority and cannot infer it from collector assignment',
  async (method) => {
    const assigned = await user();
    await grant(assigned, ['contracts.approve'], 'FINANCE', [branchA], 'ASSIGNED');
    const row = await fixture(method);
    await db.contract.update({ where: { id: row.id }, data: { assignedToId: assigned } });
    expect((await action(method, row.id, assigned)).status).toBe(403);
    expect((await action(method, row.id, checker)).status).toBe(201);
  },
);
it.each(['approve', 'reject'] as const)(
  '%s succeeds for explicit FINANCE central COMPANY authority',
  async (method) => {
    const central = await user();
    await grant(central, ['contracts.approve']);
    const row = await fixture(method, branchB);
    expect((await action(method, row.id, central)).status).toBe(201);
  },
);
it.each(methods)('%s requires the selected work context', async (method) => {
  const row = await fixture(method);
  expect(
    (
      await action(
        method,
        row.id,
        method === 'submit-review' ? maker : checker,
        method === 'submit-review' ? 'FINANCE' : 'SHOP',
      )
    ).status,
  ).toBe(403);
});
it('reject requires a genuine reason; protected owner keeps the preexisting self-rejection exception', async () => {
  const owner = await user(true),
    row = await fixture('reject', branchA, owner);
  expect((await action('reject', row.id, owner, 'FINANCE', '  ')).status).toBe(400);
  expect((await action('reject', row.id, owner)).status).toBe(201);
});

async function direct(
  method: Method,
  id: string,
  actor: string,
  callerId = actor,
  callerRole = 'OWNER',
) {
  return new AccessResourceService(db as PrismaService, snapshots).execute(
    actor,
    method === 'submit-review' ? 'contracts.update' : 'contracts.approve',
    method === 'submit-review' ? 'SHOP' : 'FINANCE',
    undefined,
    () =>
      method === 'submit-review'
        ? workflow.submitForReview(id, callerId, callerRole)
        : method === 'approve'
          ? workflow.approveContract(id, callerId, callerRole, 'Direct canonical review')
          : workflow.rejectContract(id, callerId, callerRole, 'Direct canonical review'),
    false,
    { isolationLevel: 'Serializable', maxAttempts: 3 },
  );
}
it.each(methods)(
  '%s managed service calls cannot run outside the current execution',
  async (method) => {
    const row = await fixture(method),
      actor = method === 'submit-review' ? maker : checker;
    const call = () =>
      method === 'submit-review'
        ? workflow.submitForReview(row.id, actor, 'OWNER')
        : method === 'approve'
          ? workflow.approveContract(row.id, actor, 'OWNER', 'spoofed role')
          : workflow.rejectContract(row.id, actor, 'OWNER', 'spoofed role');
    await expect(call()).rejects.toMatchObject({ status: 403 });
  },
);
it.each(methods)('%s canonical calls bind the actor ID to the current snapshot', async (method) => {
  const row = await fixture(method);
  await expect(
    direct(method, row.id, method === 'submit-review' ? maker : checker, denied),
  ).rejects.toMatchObject({ status: 403 });
});
it.each(['approve', 'reject'] as const)(
  '%s ignores a caller-supplied owner role on managed self-review',
  async (method) => {
    const row = await fixture(method, branchA, checker);
    await expect(direct(method, row.id, checker)).rejects.toMatchObject({ status: 403 });
  },
);
it.each(methods)(
  '%s direct canonical managed execution retains required safe decision audit',
  async (method) => {
    const row = await fixture(method);
    await direct(method, row.id, method === 'submit-review' ? maker : checker);
    const actionName =
      method === 'submit-review'
        ? 'CONTRACT_SUBMITTED_FOR_REVIEW'
        : method === 'approve'
          ? 'CONTRACT_REVIEW_APPROVED'
          : 'CONTRACT_REVIEW_REJECTED';
    expect(await db.auditLog.count({ where: { entityId: row.id, action: actionName } })).toBe(1);
  },
);

async function observeWait(tx: Prisma.TransactionClient, pid: number, required = true) {
  for (let i = 0; i < 200; i++) {
    await tx.$executeRaw`SELECT pg_stat_clear_snapshot()`;
    const [row] = await tx.$queryRaw<
      { waiting: boolean }[]
    >`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE wait_event_type='Lock' AND ${pid}=ANY(pg_blocking_pids(pid))) AS waiting`;
    if (row.waiting) return true;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  if (required) throw new Error('Owned request did not reach the observed PostgreSQL lock wait');
  return false;
}
it.each(methods)('%s rechecks current actor after an observed access lock wait', async (method) => {
  const actor = await user();
  await grant(
    actor,
    [
      method === 'submit-review' ? 'contracts.update' : 'contracts.approve',
      'customers.read',
      'products.read',
    ],
    method === 'submit-review' ? 'SHOP' : 'FINANCE',
    [branchA],
  );
  const row = await fixture(method, branchA, method === 'submit-review' ? actor : maker);
  let response: Promise<request.Response> | undefined;
  await db.$transaction(async (tx) => {
    const [{ pid }] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(718294630)`;
    response = action(method, row.id, actor).then((result) => result);
    await observeWait(tx, pid);
    await tx.user.update({ where: { id: actor }, data: { isActive: false } });
  });
  expect((await response!).status).toBe(403);
  expect((await db.contract.findUniqueOrThrow({ where: { id: row.id } })).workflowStatus).toBe(
    row.workflowStatus,
  );
});
it.each(methods)(
  '%s rechecks current Contract origin after an observed source lock wait',
  async (method) => {
    const row = await fixture(method);
    let response: Promise<request.Response> | undefined;
    await db.$transaction(async (tx) => {
      const [{ pid }] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
      await tx.$queryRaw`SELECT id FROM contracts WHERE id=${row.id} FOR UPDATE`;
      response = action(method, row.id).then((result) => result);
      await observeWait(tx, pid);
      await tx.contract.update({ where: { id: row.id }, data: { branchId: branchB } });
    });
    expect((await response!).status).toBe(403);
    expect((await db.contract.findUniqueOrThrow({ where: { id: row.id } })).workflowStatus).toBe(
      row.workflowStatus,
    );
  },
);
it.each(['customer', 'main product', 'bundle product'] as const)(
  'submit rechecks current %s after an observed lock wait',
  async (source) => {
    const row = await fixture('submit-review');
    const product =
      source === 'bundle product'
        ? await db.product.create({
            data: {
              name: 'Owned accessory',
              brand: 'Apple',
              model: 'Test',
              category: 'ACCESSORY',
              costPrice: 100,
              branchId: branchA,
            },
          })
        : { id: row.productId };
    if (source === 'bundle product')
      await db.contract.update({ where: { id: row.id }, data: { bundleProductIds: [product.id] } });
    let response: Promise<request.Response> | undefined;
    await db.$transaction(async (tx) => {
      const [{ pid }] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
      if (source === 'customer')
        await tx.$queryRaw`SELECT id FROM customers WHERE id=${row.customerId} FOR UPDATE`;
      else await tx.$queryRaw`SELECT id FROM products WHERE id=${product.id} FOR UPDATE`;
      response = action('submit-review', row.id).then((result) => result);
      await observeWait(tx, pid);
      if (source === 'customer')
        await tx.customer.update({
          where: { id: row.customerId },
          data: { deletedAt: new Date() },
        });
      else await tx.product.update({ where: { id: product.id }, data: { branchId: branchB } });
    });
    expect((await response!).status).toBe(403);
    expect((await db.contract.findUniqueOrThrow({ where: { id: row.id } })).workflowStatus).toBe(
      'CREATING',
    );
  },
);
it('approval verifies current sealed Customer identity after an observed evidence lock wait', async () => {
  const row = await fixture('submit-review');
  expect((await action('submit-review', row.id)).status).toBe(201);
  let response: Promise<request.Response> | undefined;
  let observed = false;
  await db.$transaction(async (tx) => {
    const [{ pid }] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
    await tx.$queryRaw`SELECT id FROM customers WHERE id=${row.customerId} FOR UPDATE`;
    response = action('approve', row.id).then((result) => result);
    observed = await observeWait(tx, pid, false);
    await tx.customer.update({ where: { id: row.customerId }, data: { nationalId: randomUUID() } });
  });
  expect((await response!).status).toBe(400);
  expect(observed).toBe(true);
  expect((await db.contract.findUniqueOrThrow({ where: { id: row.id } })).workflowStatus).toBe(
    'PENDING_REVIEW',
  );
});
it('submit verifies current credit status after an observed evidence lock wait', async () => {
  const row = await fixture('submit-review');
  let response: Promise<request.Response> | undefined;
  let observed = false;
  await db.$transaction(async (tx) => {
    const [{ pid }] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
    await tx.$queryRaw`SELECT id FROM credit_checks WHERE contract_id=${row.id} FOR UPDATE`;
    response = action('submit-review', row.id).then((result) => result);
    observed = await observeWait(tx, pid, false);
    await tx.creditCheck.update({ where: { contractId: row.id }, data: { status: 'PENDING' } });
  });
  expect((await response!).status).toBe(400);
  expect(observed).toBe(true);
  expect((await db.contract.findUniqueOrThrow({ where: { id: row.id } })).workflowStatus).toBe(
    'CREATING',
  );
});
async function withAuditFailure(
  actionName: string,
  operation: () => Promise<void>,
  retryable = false,
) {
  if (retryable) await db.$executeRawUnsafe('CREATE SEQUENCE review_retry_seq');
  await db.$executeRawUnsafe(
    `CREATE FUNCTION review_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='${actionName}'${retryable ? " AND nextval('review_retry_seq')=1" : ''} THEN RAISE EXCEPTION 'owned review audit failure'${retryable ? " USING ERRCODE='40001'" : ''}; END IF; RETURN NEW; END $$`,
  );
  await db.$executeRawUnsafe(
    'CREATE TRIGGER review_failure BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION review_failure()',
  );
  try {
    await operation();
  } finally {
    await db.$executeRawUnsafe('DROP TRIGGER review_failure ON audit_logs');
    await db.$executeRawUnsafe('DROP FUNCTION review_failure()');
    if (retryable) await db.$executeRawUnsafe('DROP SEQUENCE review_retry_seq');
  }
}
function auditAction(method: Method) {
  return method === 'submit-review'
    ? 'CONTRACT_SUBMITTED_FOR_REVIEW'
    : method === 'approve'
      ? 'CONTRACT_REVIEW_APPROVED'
      : 'CONTRACT_REVIEW_REJECTED';
}
it.each(methods)(
  '%s late required audit failure rolls back canonical state/hash and emits no journey effect',
  async (method) => {
    const row = await fixture(method);
    const before = await db.contract.findUniqueOrThrow({ where: { id: row.id } });
    await withAuditFailure(auditAction(method), async () => {
      expect((await action(method, row.id)).status).toBe(500);
      expect(await db.contract.findUniqueOrThrow({ where: { id: row.id } })).toEqual(before);
      expect(
        await db.auditLog.count({ where: { entityId: row.id, action: auditAction(method) } }),
      ).toBe(0);
      expect(effects.filter((effect) => effect.refId === row.id)).toHaveLength(0);
    });
    expect((await action(method, row.id)).status).toBe(201);
    expect(effects.filter((effect) => effect.refId === row.id)).toEqual(
      method === 'submit-review'
        ? []
        : [{ refId: row.id, decision: state(method), inTransaction: false }],
    );
  },
);
it.each(methods)(
  '%s whole-attempt serialization retry commits once and runs journey only after commit',
  async (method) => {
    const row = await fixture(method);
    await withAuditFailure(
      auditAction(method),
      async () => {
        expect((await action(method, row.id)).status).toBe(201);
        const [{ last_value: attempts }] = await db.$queryRaw<
          { last_value: bigint }[]
        >`SELECT last_value FROM review_retry_seq`;
        expect(Number(attempts)).toBe(2);
      },
      true,
    );
    expect(
      await db.auditLog.count({ where: { entityId: row.id, action: auditAction(method) } }),
    ).toBe(1);
    expect(effects.filter((effect) => effect.refId === row.id)).toEqual(
      method === 'submit-review'
        ? []
        : [{ refId: row.id, decision: state(method), inTransaction: false }],
    );
  },
);
it('late review audit failure also rolls back ordinary owner self-approval proof', async () => {
  const owner = await user(true),
    row = await fixture('approve', branchA, owner);
  await withAuditFailure('CONTRACT_REVIEW_APPROVED', async () => {
    expect((await action('approve', row.id, owner)).status).toBe(500);
    expect((await db.contract.findUniqueOrThrow({ where: { id: row.id } })).workflowStatus).toBe(
      'PENDING_REVIEW',
    );
    expect(
      await db.auditLog.count({
        where: { entityId: row.id, action: 'CONTRACT_OWNER_SELF_APPROVED' },
      }),
    ).toBe(0);
    expect(effects.filter((effect) => effect.refId === row.id)).toHaveLength(0);
  });
});
it.each(methods)(
  'concurrent %s decisions transition once and retain one required decision audit',
  async (method) => {
    const row = await fixture(method);
    const results = await Promise.all([action(method, row.id), action(method, row.id)]);
    expect(results.map((result) => result.status).sort()).toEqual([201, 400]);
    expect(
      await db.auditLog.count({ where: { entityId: row.id, action: auditAction(method) } }),
    ).toBe(1);
    expect(effects.filter((effect) => effect.refId === row.id)).toHaveLength(
      method === 'submit-review' ? 0 : 1,
    );
  },
);
it('submit and review keep stock, monetary terms, payments and journals unchanged', async () => {
  const row = await fixture('submit-review');
  const before = await Promise.all([
    db.payment.count(),
    db.shopTender.count(),
    db.journalEntry.count(),
    db.installmentSchedule.count(),
  ]);
  const productBefore = await db.product.findUniqueOrThrow({ where: { id: row.productId } });
  expect((await action('submit-review', row.id)).status).toBe(201);
  expect((await action('approve', row.id)).status).toBe(201);
  expect(
    await Promise.all([
      db.payment.count(),
      db.shopTender.count(),
      db.journalEntry.count(),
      db.installmentSchedule.count(),
    ]),
  ).toEqual(before);
  expect(await db.product.findUniqueOrThrow({ where: { id: row.productId } })).toEqual(
    productBefore,
  );
  const after = await db.contract.findUniqueOrThrow({ where: { id: row.id } });
  expect([
    after.sellingPrice.toString(),
    after.downPayment.toString(),
    after.financedAmount.toString(),
    after.interestTotal.toString(),
    after.monthlyPayment.toString(),
  ]).toEqual(['12000', '2000', '10000', '1000', '1100']);
  expect(after.status).toBe('DRAFT');
});
it('submission uses current persisted attribution and audits the true maker after reassignment', async () => {
  const current = await user();
  await grant(current, ['contracts.update', 'customers.read', 'products.read'], 'SHOP', [branchA]);
  const row = await fixture('submit-review');
  await db.contract.update({ where: { id: row.id }, data: { salespersonId: current } });
  expect((await action('submit-review', row.id, maker)).status).toBe(403);
  expect((await action('submit-review', row.id, current)).status).toBe(201);
  expect((await action('approve', row.id)).status).toBe(201);
  const proof = await db.auditLog.findFirstOrThrow({
    where: { entityId: row.id, action: 'CONTRACT_REVIEW_APPROVED' },
  });
  expect(proof.newValue).toEqual({
    makerId: current,
    checkerId: checker,
    workflowStatus: 'APPROVED',
  });
});
it.each(['approve', 'reject'] as const)(
  '%s rechecks changed maker/checker after an observed Contract lock wait',
  async (method) => {
    const row = await fixture(method);
    let response: Promise<request.Response> | undefined;
    await db.$transaction(async (tx) => {
      const [{ pid }] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
      await tx.$queryRaw`SELECT id FROM contracts WHERE id=${row.id} FOR UPDATE`;
      response = action(method, row.id).then((result) => result);
      await observeWait(tx, pid);
      await tx.contract.update({ where: { id: row.id }, data: { salespersonId: checker } });
    });
    expect((await response!).status).toBe(403);
    expect(effects.filter((effect) => effect.refId === row.id)).toHaveLength(0);
  },
);
it.each(methods)(
  '%s generic HTTP audit contains only structural route outcome metadata',
  async (method) => {
    const row = await fixture(method);
    const result = await action(
      method,
      row.id,
      method === 'submit-review' ? maker : checker,
      method === 'submit-review' ? 'SHOP' : 'FINANCE',
      'PRIVATE-UNSAFE-REVIEW-NOTE',
    );
    expect(result.status).toBe(201);
    let audit: Awaited<ReturnType<typeof db.auditLog.findFirst>> = null;
    for (let i = 0; i < 100; i++) {
      audit = await db.auditLog.findFirst({ where: { entityId: row.id, action: 'POST' } });
      if (audit) break;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    expect(audit!).toBeTruthy();
    expect(Object.keys(audit!.newValue as object).sort()).toEqual([
      'duration',
      'outcome',
      'route',
      'statusCode',
    ]);
    expect(audit!.newValue).toMatchObject({
      route: `ContractsController.${method === 'submit-review' ? 'submitForReview' : method}`,
      outcome: 'SUCCESS',
      statusCode: 201,
    });
    expect(audit!.ipAddress).toBeNull();
    expect(audit!.userAgent).toBeNull();
    expect(audit!.oldValue).toBeNull();
    expect(JSON.stringify(audit!.newValue)).not.toContain('PRIVATE-');
  },
);
