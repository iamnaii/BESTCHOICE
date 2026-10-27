import { TradeInCreditService } from '../trade-in/services/trade-in-credit.service';
import { preparationCreditWhere, assertPreparationCredit } from './access-preparation-credit';
import { currentDomainAccess } from './access-execution-context';
import {
  linkRoomCreditHistory,
  lockCreditRoom,
} from '../credit-check/services/room-credit-history';
import { CreditCheckOverrideService } from '../credit-check/services/credit-check-override.service';
import { ContractQuoteService } from '../contracts/services/contract-quote.service';
import { ContractLifecycleService } from '../contracts/services/contract-lifecycle.service';
import { JournalAutoService } from '../journal/journal-auto.service';
import { CompanyResolverService } from '../journal/company-resolver.service';
import { ShopAccountResolver } from '../journal/shop-account-resolver.service';
import { ShopDownPaymentTemplate } from '../journal/cpa-templates/shop-down-payment.template';
import { ShopDownPaymentReversalTemplate } from '../journal/cpa-templates/shop-down-payment-reversal.template';
import { seedShopCoa } from '../../../prisma/seed-coa-shop';
import { AccessContractPreparationActions } from './access-contract-preparation-actions';
import { AuditService } from '../audit/audit.service';
import { AuditInterceptor } from '../audit/audit.interceptor';
import { AccessContractReadBoundaries } from './access-contract-read-boundaries';
import { randomUUID } from 'node:crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import { Test } from '@nestjs/testing';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { ExecutionContext, INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { PermissionKey, DEFAULT_ACCESS_POSITIONS } from '@installment/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AccessSnapshotService } from './access-snapshot.service';
import { AccessResourceService } from './access-resource.service';
import { AccessPartySourceService } from './access-party-source.service';
import { AccessProcurementSourceService } from './access-procurement-source.service';
import { AccessPolicyService } from './access-policy';
import { AccessPolicyInterceptor } from './access-policy.interceptor';
import { ContractsController } from '../contracts/contracts.controller';
import { ContractsService } from '../contracts/contracts.service';
import { ContractQueryService } from '../contracts/services/contract-query.service';
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
  !url?.includes('/bc_access_preparation_actions?host=/tmp/bc-access-preparation-actions.') ||
  process.env.DATABASE_URL !== url ||
  process.env.DATABASE_URL_FINANCE !== url
)
  throw new Error('Both database URLs must identify the owned isolated cluster');
const db = new PrismaClient({
  datasources: { db: { url } },
  log: [{ emit: 'event', level: 'query' }],
});
let measuredQueries: string[] | undefined;
let afterContractLockQuery: (() => void) | undefined;
db.$on('query', (event) => {
  measuredQueries?.push(event.query);
  if (
    afterContractLockQuery &&
    event.query.includes('FROM contracts') &&
    event.query.includes('FOR SHARE')
  ) {
    const callback = afterContractLockQuery;
    afterContractLockQuery = undefined;
    callback();
  }
});
const snapshots = new AccessSnapshotService(db as PrismaService);
const marker = randomUUID();
const warrantyEffect = jest.fn(async (_id: string) => {
  expect(currentDomainAccess()).toBeUndefined();
});
let app: INestApplication,
  actor: string,
  denied: string,
  assigned: string,
  warranty: string,
  branchA: string,
  branchB: string;
let contractA: string, contractB: string, assignedCase: string, sibling: string;
async function user() {
  return (
    await db.user.create({
      data: {
        name: 'Test',
        email: randomUUID() + '@test.invalid',
        password: 'unused',
        role: 'ACCOUNTANT',
        accessManaged: true,
      },
    })
  ).id;
}
async function grant(
  id: string,
  permissions: PermissionKey[],
  companyCode = 'SHOP',
  branches?: string[],
  scope?: 'ASSIGNED',
) {
  const position = await db.accessPosition.create({
    data: { code: randomUUID(), name: 'Test', permissions },
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
async function contract(branchId: string, assignedToId?: string, salespersonId = actor) {
  const customer = await db.customer.create({
    data: { name: 'Private customer ' + randomUUID(), phone: '0811111111' },
  });
  const product = await db.product.create({
    data: {
      name: 'Private product',
      brand: 'Apple',
      model: 'Test',
      category: 'PHONE_NEW',
      costPrice: 7777,
      branchId,
    },
  });
  return db.contract.create({
    data: {
      contractNumber: 'TEST-' + randomUUID(),
      customerId: customer.id,
      productId: product.id,
      branchId,
      salespersonId,
      assignedToId,
      planType: 'STORE_WITH_INTEREST',
      sellingPrice: 12000,
      downPayment: 2000,
      financedAmount: 10000,
      interestRate: 0.01,
      totalMonths: 10,
      interestTotal: 1000,
      monthlyPayment: 1100,
      notes: 'NEVER-RAW-NOTES',
      contractHash: 'NEVER-HASH',
      status: 'DRAFT',
      payments: { create: { installmentNo: 1, dueDate: new Date('2026-01-01'), amountDue: 1100 } },
    },
  });
}
function http(path: string, id = actor, company = 'SHOP') {
  return request(app.getHttpServer())
    .get(path)
    .set('x-test-user', id)
    .set('x-company-scope', company)
    .expect('x-owned-preparation-action-app', marker);
}
beforeAll(async () => {
  const shop = await db.companyInfo.findUniqueOrThrow({ where: { companyCode: 'SHOP' } });
  branchA = (
    await db.branch.create({
      data: { name: 'A', companyId: shop.id, shopCashAccountCode: 'S11-1101' },
    })
  ).id;
  branchB = (await db.branch.create({ data: { name: 'B', companyId: shop.id } })).id;
  actor = await user();
  denied = await user();
  assigned = await user();
  warranty = await user();
  await grant(
    actor,
    ['contracts.create', 'contracts.read', 'contracts.update', 'products.read', 'customers.read'],
    'SHOP',
    [branchA],
  );
  await grant(assigned, ['contracts.read', 'contracts.update'], 'SHOP', [branchA], 'ASSIGNED');
  await grant(warranty, ['contracts.read'], 'SHOP', [branchA]);
  contractA = (await contract(branchA)).id;
  assignedCase = (await contract(branchA, assigned, assigned)).id;
  sibling = (await contract(branchA, undefined, assigned)).id;
  contractB = (await contract(branchB)).id;
  await grant(actor, ['chat.read', 'credit-checks.read']);
  await seedShopCoa(db);
  const prisma = db as PrismaService;
  const query = new ContractQueryService(prisma);
  const journal = new JournalAutoService(prisma);
  const company = new CompanyResolverService(prisma);
  const lifecycle = new ContractLifecycleService(
    prisma,
    query,
    new ShopDownPaymentTemplate(journal, prisma, company),
    new ShopDownPaymentReversalTemplate(journal, prisma, company),
    new ShopAccountResolver(prisma),
    // ก้อน 5 C3 — the blacklist gate (outside the tx) has its own specs; these preparation cases pin the
    // canonical in-transaction one-live-contract net and its managed redaction, so the gate evaluates NONE.
    // Open design doubt (orchestrator): the real gate's HARD/SOFT reasons carry contract numbers/names.
    { evaluate: async () => ({ level: 'NONE', reasons: [], checkedAt: new Date().toISOString() }) } as never,
    { setShopWarranty: warrantyEffect } as never,
  );
  const quotes = new ContractQuoteService(prisma);
  const module = await Test.createTestingModule({
    controllers: [ContractsController],
    providers: [
      AuditService,
      ContractDocumentService,
      AccessContractReadBoundaries,
      AccessContractPreparationActions,
      AccessResourceService,
      AccessPartySourceService,
      AccessProcurementSourceService,
      AccessPolicyService,
      { provide: PrismaService, useValue: db },
      { provide: AccessSnapshotService, useValue: snapshots },
      {
        provide: ContractsService,
        useValue: {
          findAll: query.findAll.bind(query),
          findOne: query.findOne.bind(query),
          quote: quotes.resolve.bind(quotes),
          create: lifecycle.create.bind(lifecycle),
          update: lifecycle.update.bind(lifecycle),
          updateBundles: lifecycle.updateBundles.bind(lifecycle),
          validateForSubmit: query.validateForSubmit.bind(query),
        },
      },
      ...[
        ContractWorkflowService,
        ContractPaymentService,
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
  app.use(
    (_req: unknown, res: { setHeader: (key: string, value: string) => void }, next: () => void) => {
      res.setHeader('x-owned-preparation-action-app', marker);
      next();
    },
  );
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
  await app.listen(0, '127.0.0.1');
}, 60000);
afterAll(async () => {
  await app?.close();
  await db.$disconnect();
});

async function action(
  method: 'quote' | 'create' | 'update' | 'updateBundles' | 'validate',
  id = actor,
  target = contractA,
) {
  const row = await db.contract.findUniqueOrThrow({ where: { id: target } });
  const path =
    method === 'quote'
      ? '/contracts/quote'
      : method === 'create'
        ? '/contracts'
        : '/contracts/' +
          target +
          (method === 'updateBundles' ? '/bundles' : method === 'validate' ? '/validate' : '');
  const verb =
    method === 'validate' ? 'get' : ['quote', 'create'].includes(method) ? 'post' : 'patch';
  const payload =
    method === 'update'
      ? { notes: 'Authorized preparation note' }
      : method === 'updateBundles'
        ? { bundleProductIds: [] }
        : {
            customerId: row.customerId,
            productId: row.productId,
            branchId: row.branchId,
            sellingPrice: 12000,
            downPayment: 2000,
            totalMonths: 6,
            paymentDueDay: 5,
            downPaymentMethod: 'CASH',
          };
  const client = request(app.getHttpServer());
  return client[verb](path)
    .set('x-test-user', id)
    .set('x-company-scope', 'SHOP')
    .send(method === 'validate' ? undefined : payload)
    .expect('x-owned-preparation-action-app', marker);
}
it.each(['quote', 'update', 'updateBundles', 'validate'] as const)(
  'R102 authorized ordinary SHOP %s reaches canonical action',
  async (method) => {
    const res = await action(method);
    expect(res.status).toBe(method === 'quote' ? 201 : 200);
  },
);
it.each(['quote', 'create', 'update', 'updateBundles', 'validate'] as const)(
  'R102 %s denies no grant and foreign source',
  async (method) => {
    expect((await action(method, denied)).status).toBe(403);
    expect((await action(method, actor, contractB)).status).toBe(403);
  },
);

async function createFixture() {
  const shop = await db.companyInfo.findUniqueOrThrow({ where: { companyCode: 'SHOP' } });
  const product = await db.product.create({
    data: {
      name: 'Owned preparation phone',
      brand: 'Apple',
      model: 'Test',
      imeiSerial: randomUUID(),
      category: 'PHONE_NEW',
      costPrice: 6000,
      cashPrice: 10000,
      installmentPrice: 12000,
      branchId: branchA,
      ownedByCompanyId: shop.id,
    },
  });
  const customer = await db.customer.create({
    data: {
      name: 'Owned preparation buyer',
      phone: '0800000000',
      nationalId: randomUUID(),
      birthDate: new Date('1990-01-01'),
      accessCompanyCode: 'SHOP',
      accessBranchId: branchA,
    },
  });
  const room = await db.chatRoom.create({
    data: { customerId: customer.id, channel: 'LINE_SHOP', assignedToId: actor },
  });
  await db.roomCreditAnalysis.create({
    data: {
      roomId: room.id,
      status: 'COMPLETED',
      fileIds: ['synthetic-owned-statement'],
      result: {
        monthlyIncome: 50000,
        monthlyExpense: 10000,
        averageBalance: 20000,
        statementMonths: 6,
      },
    },
  });
  await db.$transaction(async (tx) => {
    await lockCreditRoom(tx, room.id);
    await linkRoomCreditHistory(tx, room.id, customer.id);
  });
  const check = await db.creditCheck.findFirstOrThrow({ where: { customerId: customer.id } });
  const owner = await db.user.upsert({
    where: { email: 'admin@bestchoice.com' },
    update: {},
    create: {
      email: 'admin@bestchoice.com',
      name: 'Owned approver',
      password: 'unused',
      role: 'OWNER',
      accessManaged: true,
    },
  });
  const overrides = new CreditCheckOverrideService(db as PrismaService);
  const basis = {
    verifiedMonthlyIncome: 50000,
    livingExpenses: 10000,
    externalMonthlyDebt: 0,
    salaryPayDay: 5,
    evidenceNotes: 'Synthetic verified affordability evidence in owned PostgreSQL.',
  };
  const preview = await overrides.approval.preview(check.id, basis, {
    id: owner.id,
    role: 'OWNER',
  });
  await overrides.overrideById(
    check.id,
    {
      status: 'APPROVED',
      overrideReason: 'Owned canonical approval fixture',
      affordability: {
        ...basis,
        contextToken: preview.contextToken,
        approvedMonthlyPayment: 5000,
        confirmed: true,
      },
    },
    owner.id,
    'OWNER',
  );
  const dto = {
    customerId: customer.id,
    productId: product.id,
    branchId: branchA,
    sellingPrice: 12000,
    downPayment: 2000,
    totalMonths: 6,
    paymentDueDay: 5,
    downPaymentMethod: 'CASH',
  };
  return { dto, room, check, customer, product };
}
it('R102 R113 actual SHOP-only create then explicit preparation reload/list uses genuine room approval', async () => {
  const f = await createFixture();
  const res = await request(app.getHttpServer())
    .post('/contracts')
    .set('x-test-user', actor)
    .set('x-company-scope', 'SHOP')
    .send(f.dto)
    .expect('x-owned-preparation-action-app', marker);
  expect({ status: res.status, body: res.body }).toEqual(expect.objectContaining({ status: 201 }));
  const id = res.body.id;
  expect(await db.payment.count({ where: { contractId: id } })).toBe(6);
  expect((await db.product.findUniqueOrThrow({ where: { id: f.product.id } })).status).toBe(
    'RESERVED',
  );
  expect((await db.creditCheck.findUniqueOrThrow({ where: { id: f.check.id } })).contractId).toBe(
    id,
  );
  expect((await http('/contracts/' + id + '?view=preparation').expect(200)).body.view).toBe(
    'SHOP_PREPARATION',
  );
  const list = await http('/contracts?view=preparation&customerId=' + f.customer.id).expect(200);
  expect(list.body.data.map((row: { id: string }) => row.id)).toEqual([id]);
  await http('/contracts/' + id, actor, 'FINANCE').expect(403);
});
function postCreate(dto: object, id = actor) {
  return request(app.getHttpServer())
    .post('/contracts')
    .set('x-test-user', id)
    .set('x-company-scope', 'SHOP')
    .send(dto)
    .expect('x-owned-preparation-action-app', marker);
}
async function assertUnclaimed(f: Awaited<ReturnType<typeof createFixture>>) {
  expect(await db.contract.count({ where: { productId: f.product.id } })).toBe(0);
  expect((await db.product.findUniqueOrThrow({ where: { id: f.product.id } })).status).toBe(
    'IN_STOCK',
  );
  expect(
    (await db.creditCheck.findUniqueOrThrow({ where: { id: f.check.id } })).contractId,
  ).toBeNull();
  expect(
    await db.creditApproval.count({
      where: { creditCheckId: f.check.id, usedByContractId: { not: null } },
    }),
  ).toBe(0);
}
it('quote is read-only; checklist reports unavailable dependent readiness without private values', async () => {
  const before = await Promise.all([
    db.contract.count(),
    db.payment.count(),
    db.shopTender.count(),
    db.journalEntry.count(),
    db.creditApproval.count(),
  ]);
  expect((await action('quote')).status).toBe(201);
  expect(
    await Promise.all([
      db.contract.count(),
      db.payment.count(),
      db.shopTender.count(),
      db.journalEntry.count(),
      db.creditApproval.count(),
    ]),
  ).toEqual(before);
  const res = await action('validate');
  expect(res.body.valid).toBeNull();
  expect(res.body.signatureStatus).toBeNull();
  expect(res.body.documentStatus).toBeNull();
  expect(res.body.availability).toMatchObject({
    credit: 'UNAVAILABLE',
    pdpa: 'UNAVAILABLE',
    signatures: 'UNAVAILABLE',
    documents: 'UNAVAILABLE',
  });
  expect(JSON.stringify(res.body)).not.toMatch(/NEVER-|Private customer|0811111111/);
});
it.each(['unlinked', 'wrong-customer', 'incomplete', 'deleted', 'foreign-channel'] as const)(
  'R113 rejects %s credit, including protected owner for unlinked history',
  async (mode) => {
    const f = await createFixture();
    const analysis = await db.roomCreditAnalysis.findUniqueOrThrow({
      where: { creditCheckId: f.check.id },
    });
    if (mode === 'unlinked')
      await db.roomCreditAnalysis.update({
        where: { id: analysis.id },
        data: { creditCheckId: null },
      });
    if (mode === 'wrong-customer')
      await db.chatRoom.update({
        where: { id: f.room.id },
        data: { customerId: (await db.customer.create({ data: { name: 'Other' } })).id },
      });
    if (mode === 'incomplete')
      await db.roomCreditAnalysis.update({
        where: { id: analysis.id },
        data: { status: 'ANALYZING' },
      });
    if (mode === 'deleted')
      await db.chatRoom.update({ where: { id: f.room.id }, data: { deletedAt: new Date() } });
    if (mode === 'foreign-channel')
      await db.chatRoom.update({ where: { id: f.room.id }, data: { channel: 'LINE_FINANCE' } });
    expect([400, 403]).toContain((await postCreate(f.dto)).status);
    if (mode === 'unlinked') {
      const owner = await db.user.findUniqueOrThrow({ where: { email: 'admin@bestchoice.com' } });
      expect([400, 403]).toContain((await postCreate(f.dto, owner.id)).status);
    }
    await assertUnclaimed(f);
  },
);
it('R102 damaged permission is no-default, scoped, and still requires explicit acknowledgment', async () => {
  const f = await createFixture();
  await db.product.update({ where: { id: f.product.id }, data: { wasPreviouslyDamaged: true } });
  expect((await postCreate({ ...f.dto, previouslyDamagedAcknowledged: true })).status).toBe(403);
  const grantRow = await grant(actor, ['products.sell-previously-damaged'], 'SHOP', [branchB]);
  expect((await postCreate({ ...f.dto, previouslyDamagedAcknowledged: true })).status).toBe(403);
  await db.employeeAccessAssignment.update({
    where: { id: grantRow.id },
    data: { deletedAt: new Date() },
  });
  const correct = await grant(actor, ['products.sell-previously-damaged'], 'SHOP', [branchA]);
  try {
    expect((await postCreate(f.dto)).status).toBe(400);
    expect((await postCreate({ ...f.dto, previouslyDamagedAcknowledged: true })).status).toBe(201);
  } finally {
    await db.employeeAccessAssignment.update({
      where: { id: correct.id },
      data: { deletedAt: new Date() },
    });
  }
});
it('R102 active contract is fail-closed for every actor and grant, without record disclosure (owner ruling 2026-10-23)', async () => {
  const f = await createFixture();
  const active = await contract(branchB);
  await db.contract.update({
    where: { id: active.id },
    data: { customerId: f.customer.id, status: 'ACTIVE', assignedToId: actor },
  });
  const before = await db.contract.count({ where: { customerId: f.customer.id } });
  const expectRefused = async () => {
    const blocked = await postCreate(f.dto);
    expect(blocked.status).toBe(409);
    expect(blocked.body.code).toBe('CUSTOMER_HAS_ACTIVE_CONTRACT');
    // The former exception (and its canOverride hint) no longer exists.
    expect(blocked.body).not.toHaveProperty('canOverride');
    expect(blocked.body).not.toHaveProperty('activeContracts');
    expect(JSON.stringify(blocked.body)).not.toMatch(
      new RegExp(active.id + '|' + active.contractNumber),
    );
    expect(await db.contract.count({ where: { customerId: f.customer.id } })).toBe(before);
  };
  await expectRefused();
  // The retired catalog key is still assignable (stored positions are validated against the catalog)
  // but grants nothing: neither an ASSIGNED nor an exact FINANCE branch grant unlocks a second contract.
  const assignedGrant = await grant(
    actor,
    ['contracts.override-active-contract'],
    'FINANCE',
    undefined,
    'ASSIGNED',
  );
  await expectRefused();
  await db.employeeAccessAssignment.update({
    where: { id: assignedGrant.id },
    data: { deletedAt: new Date() },
  });
  const scoped = await grant(actor, ['contracts.override-active-contract'], 'FINANCE', [branchB]);
  try {
    await expectRefused();
  } finally {
    await db.employeeAccessAssignment.update({
      where: { id: scoped.id },
      data: { deletedAt: new Date() },
    });
  }
});
it.each(['quote', 'create', 'update', 'updateBundles', 'validate'] as const)(
  'current actor revoked during observed lock wait denies %s',
  async (method) => {
    const reader = await user();
    const row = await contract(branchA, undefined, reader);
    await grant(
      reader,
      ['contracts.create', 'contracts.update', 'products.read', 'customers.read'],
      'SHOP',
      [branchA],
    );
    let response: Promise<request.Response> | undefined;
    await db.$transaction(async (tx) => {
      const [{ pid }] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(718294630)`;
      response = action(method, reader, row.id);
      let observed = false;
      for (let i = 0; i < 200; i++) {
        await tx.$executeRaw`SELECT pg_stat_clear_snapshot()`;
        const [state] = await tx.$queryRaw<
          { waiting: boolean }[]
        >`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE wait_event_type='Lock' AND ${pid}=ANY(pg_blocking_pids(pid))) AS waiting`;
        if (state.waiting) {
          observed = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      expect(observed).toBe(true);
      await tx.user.update({ where: { id: reader }, data: { isActive: false } });
    });
    expect((await response!).status).toBe(403);
  },
);
it('required late audit failure rolls back money, schedule, claim and stock; retry commits once', async () => {
  const f = await createFixture();
  const before = await Promise.all([
    db.payment.count(),
    db.shopTender.count(),
    db.journalEntry.count(),
  ]);
  warrantyEffect.mockClear();
  await db.$executeRawUnsafe(
    `CREATE FUNCTION preparation_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='CONTRACT_PREPARATION_CREATE' THEN RAISE EXCEPTION 'owned required audit failure'; END IF; RETURN NEW; END $$`,
  );
  await db.$executeRawUnsafe(
    `CREATE TRIGGER preparation_audit_failure BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION preparation_audit_failure()`,
  );
  try {
    expect((await postCreate(f.dto)).status).toBe(500);
    await assertUnclaimed(f);
    expect(warrantyEffect).not.toHaveBeenCalled();
    expect(
      await Promise.all([db.payment.count(), db.shopTender.count(), db.journalEntry.count()]),
    ).toEqual(before);
  } finally {
    await db.$executeRawUnsafe('DROP TRIGGER preparation_audit_failure ON audit_logs');
    await db.$executeRawUnsafe('DROP FUNCTION preparation_audit_failure()');
  }
  const res = await postCreate(f.dto);
  expect(res.status).toBe(201);
  const id = res.body.id;
  expect(warrantyEffect).toHaveBeenCalledTimes(1);
  expect(warrantyEffect).toHaveBeenCalledWith(id);
  const tenders = await db.shopTender.findMany({ where: { contractId: id } });
  expect(tenders).toHaveLength(1);
  expect(tenders[0].amount.toString()).toBe('2000');
  expect(await db.payment.count({ where: { contractId: id } })).toBe(6);
  expect(
    await db.auditLog.count({ where: { entityId: id, action: 'CONTRACT_PREPARATION_CREATE' } }),
  ).toBe(1);
  expect((await postCreate(f.dto)).status).not.toBe(201);
  expect(await db.shopTender.count({ where: { contractId: id } })).toBe(1);
});
it('concurrent canonical creates claim once and reserve one set of money and payments', async () => {
  const f = await createFixture();
  const responses = await Promise.all([postCreate(f.dto), postCreate(f.dto)]);
  expect(responses.filter((r) => r.status === 201)).toHaveLength(1);
  const row = await db.contract.findFirstOrThrow({ where: { productId: f.product.id } });
  expect(await db.contract.count({ where: { productId: f.product.id } })).toBe(1);
  expect(await db.payment.count({ where: { contractId: row.id } })).toBe(6);
  expect(await db.shopTender.count({ where: { contractId: row.id } })).toBe(1);
  expect(await db.creditApproval.count({ where: { usedByContractId: row.id } })).toBe(1);
});
it('bundle edits authorize both old/new sources and preserve maker, DRAFT and monetary immutability', async () => {
  const f = await createFixture();
  const created = await postCreate(f.dto);
  expect(created.status).toBe(201);
  const id = created.body.id;
  const bundle = await db.product.create({
    data: {
      name: 'Owned case',
      brand: 'Apple',
      model: 'Case',
      category: 'ACCESSORY',
      costPrice: 100,
      branchId: branchA,
    },
  });
  const edit = (ids: string[], userId = actor) =>
    request(app.getHttpServer())
      .patch('/contracts/' + id + '/bundles')
      .set('x-test-user', userId)
      .set('x-company-scope', 'SHOP')
      .send({ bundleProductIds: ids })
      .expect('x-owned-preparation-action-app', marker);
  expect((await edit([bundle.id])).status).toBe(200);
  expect((await db.product.findUniqueOrThrow({ where: { id: bundle.id } })).status).toBe(
    'RESERVED',
  );
  await db.product.update({ where: { id: bundle.id }, data: { branchId: branchB } });
  expect((await edit([])).status).toBe(403);
  expect((await db.product.findUniqueOrThrow({ where: { id: bundle.id } })).status).toBe(
    'RESERVED',
  );
  await db.product.update({ where: { id: bundle.id }, data: { branchId: branchA } });
  expect((await edit([])).status).toBe(200);
  expect((await db.product.findUniqueOrThrow({ where: { id: bundle.id } })).status).toBe(
    'IN_STOCK',
  );
  const manager = await user();
  await db.user.update({
    where: { id: manager },
    data: { role: 'BRANCH_MANAGER', branchId: branchA },
  });
  await grant(manager, ['contracts.update', 'customers.read', 'products.read'], 'SHOP', [branchA]);
  expect((await edit([], manager)).status).toBe(403);
  const money = await request(app.getHttpServer())
    .patch('/contracts/' + id)
    .set('x-test-user', actor)
    .set('x-company-scope', 'SHOP')
    .send({ sellingPrice: 13000 });
  expect(money.status).toBe(400);
  expect((await db.contract.findUniqueOrThrow({ where: { id } })).sellingPrice.toString()).toBe(
    '12000',
  );
  await db.contract.update({ where: { id }, data: { status: 'ACTIVE' } });
  expect((await edit([])).status).toBe(403);
});
it.each(['customer', 'product', 'room'] as const)(
  'rechecks current %s source after observed lock wait before create',
  async (mode) => {
    const f = await createFixture();
    let response: Promise<request.Response> | undefined;
    await db.$transaction(async (tx) => {
      const [{ pid }] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
      if (mode === 'customer')
        await tx.$queryRaw`SELECT id FROM customers WHERE id=${f.customer.id} FOR UPDATE`;
      else if (mode === 'product')
        await tx.$queryRaw`SELECT id FROM products WHERE id=${f.product.id} FOR UPDATE`;
      else await tx.$queryRaw`SELECT id FROM chat_rooms WHERE id=${f.room.id} FOR UPDATE`;
      response = postCreate(f.dto).then((r) => r);
      let observed = false;
      for (let i = 0; i < 200; i++) {
        await tx.$executeRaw`SELECT pg_stat_clear_snapshot()`;
        const [state] = await tx.$queryRaw<
          { waiting: boolean }[]
        >`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE wait_event_type='Lock' AND ${pid}=ANY(pg_blocking_pids(pid))) AS waiting`;
        if (state.waiting) {
          observed = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      expect(observed).toBe(true);
      if (mode === 'customer')
        await tx.customer.update({ where: { id: f.customer.id }, data: { deletedAt: new Date() } });
      if (mode === 'product')
        await tx.product.update({ where: { id: f.product.id }, data: { branchId: branchB } });
      if (mode === 'room')
        await tx.chatRoom.update({ where: { id: f.room.id }, data: { channel: 'LINE_FINANCE' } });
    });
    expect([400, 403]).toContain((await response!).status);
    await assertUnclaimed(f);
  },
);
it('whole-attempt serialization retry retains required audit and effects only once after commit', async () => {
  const f = await createFixture();
  warrantyEffect.mockClear();
  await db.$executeRawUnsafe('CREATE SEQUENCE preparation_retry_seq');
  await db.$executeRawUnsafe(
    `CREATE FUNCTION preparation_retry() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='CONTRACT_PREPARATION_CREATE' AND nextval('preparation_retry_seq')=1 THEN RAISE EXCEPTION 'owned serialization retry' USING ERRCODE='40001'; END IF; RETURN NEW; END $$`,
  );
  await db.$executeRawUnsafe(
    'CREATE TRIGGER preparation_retry BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION preparation_retry()',
  );
  try {
    const res = await postCreate(f.dto);
    expect(res.status).toBe(201);
    const id = res.body.id;
    expect(await db.contract.count({ where: { productId: f.product.id } })).toBe(1);
    expect(await db.payment.count({ where: { contractId: id } })).toBe(6);
    expect(await db.shopTender.count({ where: { contractId: id } })).toBe(1);
    expect(
      await db.auditLog.count({ where: { entityId: id, action: 'CONTRACT_PREPARATION_CREATE' } }),
    ).toBe(1);
    expect(warrantyEffect).toHaveBeenCalledTimes(1);
    const [row] = await db.$queryRaw<
      { last_value: bigint }[]
    >`SELECT last_value FROM preparation_retry_seq`;
    expect(Number(row.last_value)).toBe(2);
  } finally {
    await db.$executeRawUnsafe('DROP TRIGGER preparation_retry ON audit_logs');
    await db.$executeRawUnsafe('DROP FUNCTION preparation_retry()');
    await db.$executeRawUnsafe('DROP SEQUENCE preparation_retry_seq');
  }
});
it('canonical create preempts web holds and cannot steal a paid booking reservation', async () => {
  const f = await createFixture();
  const hold = await db.productReservation.create({
    data: {
      productId: f.product.id,
      customerId: f.customer.id,
      sessionId: randomUUID(),
      expiresAt: new Date('2099-01-01'),
    },
  });
  const res = await postCreate(f.dto);
  expect(res.status).toBe(201);
  expect((await db.productReservation.findUniqueOrThrow({ where: { id: hold.id } })).status).toBe(
    'PREEMPTED',
  );
  const booked = await createFixture();
  await db.booking.create({
    data: {
      bookingNumber: 'BK-OWNED-' + randomUUID(),
      customerId: booked.customer.id,
      branchId: branchA,
      status: 'PAID',
      depositAmount: 100,
      totalAmount: 12000,
      expireDate: new Date('2099-01-01'),
      lockedProductId: booked.product.id,
      createdById: actor,
    },
  });
  await db.product.update({ where: { id: booked.product.id }, data: { status: 'RESERVED' } });
  expect((await postCreate(booked.dto)).status).toBe(400);
  expect((await db.product.findUniqueOrThrow({ where: { id: booked.product.id } })).status).toBe(
    'RESERVED',
  );
  expect(await db.contract.count({ where: { productId: booked.product.id } })).toBe(0);
});
it('read success does not authorize create; independent child grants and action scopes remain paired', async () => {
  const reader = await user();
  await grant(reader, ['contracts.read', 'contracts.update'], 'SHOP', [branchA]);
  const row = await contract(branchA, undefined, reader);
  await http('/contracts/' + row.id + '?view=preparation', reader).expect(200);
  expect((await action('create', reader, row.id)).status).toBe(403);
  expect((await action('update', reader, row.id)).status).toBe(403);
  await grant(reader, ['customers.read', 'products.read'], 'SHOP', [branchB]);
  expect((await action('update', reader, row.id)).status).toBe(403);
});
it('ASSIGNED preparation and another maker are denied; both exception keys have no defaults', async () => {
  for (const method of ['update', 'updateBundles', 'validate'] as const) {
    expect((await action(method, assigned, assignedCase)).status).toBe(403);
    expect((await action(method, actor, sibling)).status).toBe(403);
  }
  for (const position of DEFAULT_ACCESS_POSITIONS) {
    expect(position.permissions).not.toContain('contracts.override-active-contract');
    expect(position.permissions).not.toContain('products.sell-previously-damaged');
  }
  expect(() => preparationCreditWhere('untrusted')).toThrow();
  await expect(assertPreparationCredit(db, 'untrusted', 'untrusted')).rejects.toMatchObject({
    status: 403,
  });
});
it('checklist shows canonical finite labels only with matching child rights and no raw evidence', async () => {
  const f = await createFixture();
  const res = await postCreate(f.dto);
  expect(res.status).toBe(201);
  const childGrant = await grant(
    actor,
    ['documents.read', 'contract-documents.read', 'pdpa.read'],
    'SHOP',
    [branchA],
  );
  try {
    const checklist = await action('validate', actor, res.body.id);
    expect(checklist.status).toBe(200);
    expect(checklist.body.availability).toEqual({
      customer: 'VISIBLE_CURRENT',
      product: 'VISIBLE_CURRENT',
      credit: 'VISIBLE_CURRENT',
      pdpa: 'VISIBLE_CURRENT',
      signatures: 'VISIBLE_CURRENT',
      documents: 'VISIBLE_CURRENT',
    });
    expect(checklist.body.valid).toBe(false);
    expect(checklist.body.signatureStatus.complete).toBe(false);
    expect(checklist.body.documentStatus.checklist.length).toBeGreaterThan(0);
    expect(JSON.stringify(checklist.body)).not.toMatch(
      /synthetic-owned-statement|50000|roomAnalysis|statementFiles|0800000000/,
    );
  } finally {
    await db.employeeAccessAssignment.update({
      where: { id: childGrant.id },
      data: { deletedAt: new Date() },
    });
  }
});
it('R113 branchless room ASSIGNED requires the current assignee and both independent capabilities', async () => {
  const reader = await user();
  await grant(reader, ['contracts.create', 'customers.read', 'products.read'], 'SHOP', [branchA]);
  const f = await createFixture();
  const credit = await grant(reader, ['credit-checks.read'], 'SHOP', undefined, 'ASSIGNED');
  await db.chatRoom.update({ where: { id: f.room.id }, data: { assignedToId: reader } });
  expect((await postCreate(f.dto, reader)).status).toBe(400);
  const chat = await grant(reader, ['chat.read'], 'SHOP', [branchA], 'ASSIGNED');
  expect((await postCreate(f.dto, reader)).status).toBe(400);
  await db.employeeAccessAssignment.update({
    where: { id: chat.id },
    data: { deletedAt: new Date() },
  });
  await grant(reader, ['chat.read'], 'SHOP', undefined, 'ASSIGNED');
  await db.chatRoom.update({ where: { id: f.room.id }, data: { assignedToId: actor } });
  expect((await postCreate(f.dto, reader)).status).toBe(400);
  await db.chatRoom.update({ where: { id: f.room.id }, data: { assignedToId: reader } });
  expect((await postCreate(f.dto, reader)).status).toBe(201);
  expect(credit.scope).toBe('ASSIGNED');
});
it('malformed source/bundles and wrong work context fail without creating side effects', async () => {
  const f = await createFixture();
  for (const payload of [
    { ...f.dto, customerId: 42 },
    { ...f.dto, bundleProductIds: 'wrong' },
    { ...f.dto, bundleProductIds: Array(11).fill(f.product.id) },
  ])
    expect((await postCreate(payload)).status).toBe(400);
  const response = await request(app.getHttpServer())
    .post('/contracts/quote')
    .set('x-test-user', actor)
    .set('x-company-scope', 'FINANCE')
    .send(f.dto)
    .expect('x-owned-preparation-action-app', marker);
  expect(response.status).toBe(403);
  await assertUnclaimed(f);
});

it('trade-in credit requires its independent source grant and preserves real claim and notes-only terms', async () => {
  const f = await createFixture();
  const owner = await db.user.findUniqueOrThrow({ where: { email: 'admin@bestchoice.com' } });
  const credit = await db.tradeIn.create({
    data: {
      customerId: f.customer.id,
      branchId: branchA,
      deviceBrand: 'Apple',
      deviceModel: 'Owned old device',
      flow: 'EXCHANGE',
      status: 'ACCEPTED',
      agreedPrice: 2000,
      idCardVerifiedAt: new Date(),
      idCardVerifiedById: owner.id,
      sellerDeclarationSnapshot: { confirmed: true },
    },
  });
  await db.$transaction((tx) =>
    new TradeInCreditService(db as PrismaService).issue(
      tx,
      credit.id,
      new Prisma.Decimal(2000),
      new Prisma.Decimal(0),
    ),
  );
  const quote = () =>
    request(app.getHttpServer())
      .post('/contracts/quote')
      .set('x-test-user', actor)
      .set('x-company-scope', 'SHOP')
      .send({ ...f.dto, tradeInCreditId: credit.id })
      .expect('x-owned-preparation-action-app', marker);
  expect((await quote()).status).toBe(403);
  expect((await postCreate({ ...f.dto, tradeInCreditId: credit.id })).status).toBe(403);
  const permission = await grant(actor, ['trade-in.read'], 'SHOP', [branchA]);
  try {
    expect((await quote()).status).toBe(201);
    expect(await db.tradeInCreditRedemption.count({ where: { tradeInId: credit.id } })).toBe(0);
    const res = await postCreate({ ...f.dto, tradeInCreditId: credit.id });
    expect(res.status).toBe(201);
    const persisted = await db.contract.findUniqueOrThrow({ where: { id: res.body.id } });
    expect(persisted.downPayment.toString()).toBe('4000');
    expect(await db.tradeInCreditRedemption.count({ where: { contractId: persisted.id } })).toBe(1);
    expect((await action('update', actor, persisted.id)).status).toBe(200);
    const changed = await request(app.getHttpServer())
      .patch('/contracts/' + persisted.id)
      .set('x-test-user', actor)
      .set('x-company-scope', 'SHOP')
      .send({ sellingPrice: 13000 })
      .expect('x-owned-preparation-action-app', marker);
    expect(changed.status).toBe(400);
  } finally {
    await db.employeeAccessAssignment.update({
      where: { id: permission.id },
      data: { deletedAt: new Date() },
    });
  }
});
