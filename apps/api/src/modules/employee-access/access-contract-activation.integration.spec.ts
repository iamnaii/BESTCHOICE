import { AccessExchangeSourceService } from './access-exchange-source.service';
import { AccessTradeInProjectionService } from './access-trade-in-projection.service';
import { ExchangeNewContract1ATemplate } from '../journal/cpa-templates/exchange-new-contract-1a.template';
import { ExchangeCloseOld21_1106Template } from '../journal/cpa-templates/exchange-close-old-21-1106.template';
import { ExchangeBuybackReceivable11_2107Template } from '../journal/cpa-templates/exchange-buyback-receivable-11-2107.template';
import { ShopExchangeReturnTemplate } from '../journal/cpa-templates/shop-exchange-return.template';
import { ExchangeEclReversalTemplate } from '../journal/cpa-templates/exchange-ecl-reversal.template';
import { AccessContractActivationBoundary } from './access-contract-activation-boundary';
import { NotificationsService } from '../notifications/notifications.service';
import { JournalAutoService } from '../journal/journal-auto.service';
import { ContractActivation1ATemplate } from '../journal/cpa-templates/contract-activation-1a.template';
import { ProductsService } from '../products/products.service';
import { ContractExchangeService } from '../contract-exchange/contract-exchange.service';
import { ShopInventoryTransferTemplate } from '../journal/cpa-templates/shop-inventory-transfer.template';
import { ShopDownPaymentTemplate } from '../journal/cpa-templates/shop-down-payment.template';
import { ShopAccountResolver } from '../journal/shop-account-resolver.service';
import { InstallmentInputVatTemplate } from '../journal/cpa-templates/installment-input-vat.template';
import { TestModeService } from '../test-mode/test-mode.service';
import { CompanyResolverService } from '../journal/company-resolver.service';
import { seedShopCoa } from '../../../prisma/seed-coa-shop';
import { seedFinanceCoa } from '../../../prisma/seed-coa-finance';
import { CreditApprovalService } from '../credit-check/services/credit-approval';
import { AccessContractPreparationActions } from './access-contract-preparation-actions';
import { randomUUID } from 'node:crypto';
import { Prisma, PrismaClient, SignerType, ContractDocumentType } from '@prisma/client';
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
  !url?.includes('/bc_access_contract_activation?host=/tmp/bc-access-contract-activation.') ||
  process.env.DATABASE_URL !== url ||
  process.env.DATABASE_URL_FINANCE !== url
)
  throw new Error('Both database URLs must identify the owned isolated cluster');
const db = new PrismaClient({ datasources: { db: { url } } });
const snapshots = new AccessSnapshotService(db as PrismaService);
const marker = randomUUID();
const deliveryFailures = new Set<string>();
const effects: Array<{ refId: string; decision: string; inTransaction: boolean }> = [];
const journey = {
  recordAfterCommit: async (entry: {
    refId: string;
    kind?: string;
    data: { decision: string };
  }) => {
    if (entry.kind === 'CONTRACT_ACTIVATED')
      expect((await db.contract.findUniqueOrThrow({ where: { id: entry.refId } })).status).toBe(
        'ACTIVE',
      );
    effects.push({
      refId: entry.refId,
      decision: 'JOURNEY',
      inTransaction: !!currentDomainAccess(),
    });
  },
};
// Real canonical workflow and financial writers; delivery/Journey are mocked.
let workflow: ContractWorkflowService;
let exchange: ContractExchangeService;
let app: INestApplication;
let branchA: string,
  branchB: string,
  maker: string,
  checker: string,
  denied: string,
  asymmetric: string;
const staleSnapshots = new Map<string, AccessSnapshot>();
const previousNodeEnv = process.env.NODE_ENV;
type Method = 'activate';

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
async function fixture(
  method: Method,
  branchId = branchA,
  salespersonId = maker,
  withCustomerOrigin = true,
  existingCustomerId?: string,
) {
  const customer = existingCustomerId
    ? await db.customer.findUniqueOrThrow({ where: { id: existingCustomerId } })
    : await db.customer.create({
        data: {
          name: 'PRIVATE-REVIEW-CUSTOMER',
          phone: '0800000000',
          birthDate: new Date('1990-01-01'),
          nationalId: randomUUID(),
          addressIdCard: 'Owned synthetic address',
          addressCurrent: 'Owned synthetic address',
          references: [{ name: 'Synthetic reference' }],
          ...(withCustomerOrigin ? { accessCompanyCode: 'SHOP', accessBranchId: branchId } : {}),
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
  const contract = await db.contract.create({
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
      workflowStatus: 'APPROVED',
      paymentDueDay: 5,
      storeCommission: 1000,
      downPaymentMethod: 'CASH',
      downPaymentReceivedAt: new Date(),
      payments: {
        create: Array.from({ length: 10 }, (_, i) => ({
          installmentNo: i + 1,
          amountDue: 1100,
          dueDate: new Date(2026, 10 + i, 5),
        })),
      },
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
  const check = await db.creditCheck.findUniqueOrThrow({ where: { contractId: contract.id } });
  await db.creditCheck.update({
    where: { id: check.id },
    data: { statementFiles: ['synthetic-income'] },
  });
  const approval = new CreditApprovalService(db as PrismaService);
  const basis = {
    verifiedMonthlyIncome: 50000,
    livingExpenses: 10000,
    externalMonthlyDebt: 0,
    salaryPayDay: 5,
    evidenceNotes: 'Synthetic verified income evidence for owned activation test.',
  };
  const preview = await approval.preview(check.id, basis);
  await db.$transaction(async (tx) => {
    await approval.approveInTransaction(
      tx,
      await tx.creditCheck.findUniqueOrThrow({ where: { id: check.id } }),
      {
        ...basis,
        contextToken: preview.contextToken,
        approvedMonthlyPayment: 5000,
        confirmed: true,
      },
      maker,
    );
  });
  return contract;
}
function action(
  method: Method,
  id: string,
  actor = checker,
  company = 'FINANCE',
  notes = 'Bounded review reason',
) {
  return request(app.getHttpServer())
    .post(`/contracts/${id}/${method}`)
    .set('x-test-user', actor)
    .set('x-company-scope', company)
    .send({ reviewNotes: notes })
    .expect('x-owned-contract-activation-app', marker);
}
beforeAll(async () => {
  process.env.NODE_ENV = 'production';
  const shop = await db.companyInfo.findUniqueOrThrow({ where: { companyCode: 'SHOP' } });
  branchA = (
    await db.branch.create({
      data: { name: 'Activation A', companyId: shop.id, shopCashAccountCode: 'S11-1101' },
    })
  ).id;
  branchB = (await db.branch.create({ data: { name: 'Review B', companyId: shop.id } })).id;
  maker = await user();
  await db.user.update({ where: { id: maker }, data: { email: 'admin@bestchoice.com' } });
  checker = await user();
  denied = await user();
  asymmetric = await user();
  await grant(maker, ['contracts.update', 'customers.read', 'products.read'], 'SHOP', [branchA]);
  await grant(checker, ['contracts.activate'], 'FINANCE', [branchA]);
  await grant(checker, ['customers.read', 'products.read'], 'SHOP', [branchA]);
  await seedShopCoa(db);
  await seedFinanceCoa(db);
  await grant(
    asymmetric,
    ['contracts.update', 'contracts.activate', 'customers.read', 'products.read'],
    'SHOP',
    [branchA],
  );
  await grant(
    asymmetric,
    ['contracts.update', 'contracts.activate', 'customers.read', 'products.read'],
    'FINANCE',
    [branchB],
  );
  const module = await Test.createTestingModule({
    controllers: [ContractsController],
    providers: [
      AuditService,
      AccessContractActivationBoundary,
      AccessContractPreparationActions,
      AccessResourceService,
      AccessPartySourceService,
      AccessProcurementSourceService,
      AccessPolicyService,
      { provide: PrismaService, useValue: db },
      { provide: AccessSnapshotService, useValue: snapshots },
      ContractWorkflowService,
      JournalAutoService,
      CompanyResolverService,
      ContractActivation1ATemplate,
      ProductsService,
      ShopInventoryTransferTemplate,
      ShopDownPaymentTemplate,
      ShopAccountResolver,
      InstallmentInputVatTemplate,
      { provide: TestModeService, useValue: { isEnabled: async () => false } },
      { provide: JourneyEntryWriter, useValue: journey },
      {
        provide: NotificationsService,
        useValue: {
          send: async (entry: { relatedId: string }) => {
            expect(
              (await db.contract.findUniqueOrThrow({ where: { id: entry.relatedId } })).status,
            ).toBe('ACTIVE');
            effects.push({
              refId: entry.relatedId,
              decision: 'NOTIFY',
              inTransaction: !!currentDomainAccess(),
            });
            if (deliveryFailures.has(entry.relatedId)) throw new Error('owned delivery failure');
          },
        },
      },
      ContractExchangeService,
      AccessExchangeSourceService,
      AccessTradeInProjectionService,
      ExchangeNewContract1ATemplate,
      ExchangeCloseOld21_1106Template,
      ExchangeBuybackReceivable11_2107Template,
      ShopExchangeReturnTemplate,
      ExchangeEclReversalTemplate,
      ...[
        ContractsService,
        ContractPaymentService,
        ContractDocumentService,
        ContractSnapshotService,
        ContractJournalQueryService,
        EarlyPayoffSlipService,
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
  workflow = module.get(ContractWorkflowService);
  exchange = module.get(ContractExchangeService);
  app = module.createNestApplication();
  app.use(
    (_req: unknown, res: { setHeader: (key: string, value: string) => void }, next: () => void) => {
      res.setHeader('x-owned-contract-activation-app', marker);
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

it('R103 authorized activation uses canonical money and stock without general read or write grants', async () => {
  const row = await fixture('activate');
  const result = await action('activate', row.id);
  expect({ status: result.status, body: result.body }).toEqual({
    status: 201,
    body: { id: row.id },
  });
  expect(result.body).toEqual({ id: row.id });
  expect((await db.contract.findUniqueOrThrow({ where: { id: row.id } })).status).toBe('ACTIVE');
  expect((await db.product.findUniqueOrThrow({ where: { id: row.productId } })).status).toBe(
    'SOLD_INSTALLMENT',
  );
  expect(await db.sale.count({ where: { contractId: row.id } })).toBe(1);
  expect(await db.salesCommission.count({ where: { contractId: row.id } })).toBe(1);
  expect(await db.installmentSchedule.count({ where: { contractId: row.id } })).toBe(10);
  expect(
    await db.journalEntry.count({ where: { metadata: { path: ['contractId'], equals: row.id } } }),
  ).toBe(4);
});
it('R103 activation denies no grants and foreign origin without canonical money', async () => {
  const row = await fixture('activate'),
    foreign = await fixture('activate', branchB);
  expect((await action('activate', row.id, denied)).status).toBe(403);
  expect((await action('activate', foreign.id)).status).toBe(403);
  for (const contract of [row, foreign]) {
    expect((await db.contract.findUniqueOrThrow({ where: { id: contract.id } })).status).toBe(
      'DRAFT',
    );
    expect(await db.sale.count({ where: { contractId: contract.id } })).toBe(0);
  }
});
it('R103 activation preserves asymmetric original company and branch tuples', async () => {
  const row = await fixture('activate');
  expect((await action('activate', row.id, asymmetric)).status).toBe(403);
});
it('R103 activation reloads revoked grants despite a stale authenticated snapshot', async () => {
  const actor = await user();
  const assignment = await grant(actor, ['contracts.activate'], 'FINANCE', [branchA]);
  await grant(actor, ['products.read', 'customers.read'], 'SHOP', [branchA]);
  staleSnapshots.set(actor, await snapshots.forUser(actor));
  await db.employeeAccessAssignment.update({
    where: { id: assignment.id },
    data: { deletedAt: new Date() },
  });
  const row = await fixture('activate');
  expect((await action('activate', row.id, actor)).status).toBe(403);
});
it('R115 actorless direct activation cannot bypass current actor proof', async () => {
  const row = await fixture('activate');
  await expect(workflow.activate(row.id)).rejects.toMatchObject({ status: 403 });
  expect((await db.contract.findUniqueOrThrow({ where: { id: row.id } })).status).toBe('DRAFT');
});
async function moneyState(id: string) {
  const contract = await db.contract.findUniqueOrThrow({ where: { id } });
  return {
    status: contract.status,
    product: await db.product.findUniqueOrThrow({ where: { id: contract.productId } }),
    sales: await db.sale.count({ where: { contractId: id } }),
    commissions: await db.salesCommission.count({ where: { contractId: id } }),
    schedules: await db.installmentSchedule.count({ where: { contractId: id } }),
    journals: await db.journalEntry.count({
      where: { metadata: { path: ['contractId'], equals: id } },
    }),
    audits: await db.auditLog.count({ where: { entityId: id, action: 'CONTRACT_ACTIVATED' } }),
  };
}
async function owned<T>(actor: string, work: () => Promise<T>) {
  return new AccessResourceService(db as PrismaService, snapshots).execute(
    actor,
    'contracts.activate',
    'FINANCE',
    undefined,
    work,
    false,
    { isolationLevel: 'Serializable', maxAttempts: 3 },
  );
}
it.each(['product', 'customer', 'bundle', 'finance-owner', 'merged', 'assigned', 'shop-context'])(
  'activation independently denies unavailable current %s source',
  async (kind) => {
    const actor = await user();
    await grant(
      actor,
      ['contracts.activate'],
      'FINANCE',
      [branchA],
      kind === 'assigned' ? 'ASSIGNED' : undefined,
    );
    await grant(
      actor,
      kind === 'customer'
        ? ['products.read']
        : kind === 'product'
          ? ['customers.read']
          : ['products.read', 'customers.read'],
      'SHOP',
      [branchA],
    );
    const row = await fixture('activate');
    if (kind === 'bundle') {
      const bundle = await db.product.create({
        data: {
          name: 'Foreign bundle',
          brand: 'Apple',
          model: 'Test',
          category: 'ACCESSORY',
          costPrice: 300,
          branchId: branchB,
        },
      });
      await db.contract.update({ where: { id: row.id }, data: { bundleProductIds: [bundle.id] } });
    }
    if (kind === 'finance-owner')
      await db.product.update({
        where: { id: row.productId },
        data: {
          ownedByCompanyId: (
            await db.companyInfo.findUniqueOrThrow({ where: { companyCode: 'FINANCE' } })
          ).id,
        },
      });
    if (kind === 'merged')
      await db.customer.update({
        where: { id: row.customerId },
        data: { mergedIntoId: (await fixture('activate')).customerId },
      });
    const before = await moneyState(row.id);
    expect(
      (await action('activate', row.id, actor, kind === 'shop-context' ? 'SHOP' : 'FINANCE'))
        .status,
    ).toBe(403);
    expect(await moneyState(row.id)).toEqual(before);
  },
);
it('activation commits balanced canonical books, safe required audit and actual outer-commit effects once', async () => {
  const row = await fixture('activate');
  expect((await action('activate', row.id)).status).toBe(201);
  const entries = await db.journalEntry.findMany({
    where: { metadata: { path: ['contractId'], equals: row.id } },
    include: { lines: true },
  });
  for (const entry of entries) {
    expect(
      Prisma.Decimal.sum(...entry.lines.map((line) => line.debit)).equals(
        Prisma.Decimal.sum(...entry.lines.map((line) => line.credit)),
      ),
    ).toBe(true);
  }
  expect(new Set(entries.map((entry) => entry.entryDate.toISOString())).size).toBe(1);
  const byTag = Object.fromEntries(
    entries.map((entry) => [(entry.metadata as { tag: string }).tag, entry]),
  );
  expect(Object.keys(byTag).sort()).toEqual([
    '1A',
    'SHOP_DOWN_PAYMENT',
    'SHOP_INVENTORY_TRANSFER_COGS',
    'SHOP_INVENTORY_TRANSFER_REVENUE',
  ]);
  const amounts = (tag: string) =>
    byTag[tag].lines.map((line) => [
      line.accountCode,
      line.debit.toFixed(2),
      line.credit.toFixed(2),
    ]);
  expect(amounts('1A')).toEqual(
    expect.arrayContaining([
      ['11-2101', '12000.00', '0.00'],
      ['11-2105', '840.00', '0.00'],
      ['21-1101', '0.00', '10000.00'],
      ['21-1102', '0.00', '1000.00'],
      ['11-2106', '0.00', '1000.00'],
      ['21-2102', '0.00', '840.00'],
    ]),
  );
  expect(amounts('SHOP_DOWN_PAYMENT')).toEqual(
    expect.arrayContaining([
      ['S11-1101', '2000.00', '0.00'],
      ['S21-2001', '0.00', '2000.00'],
    ]),
  );
  expect(amounts('SHOP_INVENTORY_TRANSFER_COGS')).toEqual(
    expect.arrayContaining([
      ['S50-1101', '7777.00', '0.00'],
      ['S11-2001', '0.00', '7777.00'],
    ]),
  );
  expect(amounts('SHOP_INVENTORY_TRANSFER_REVENUE')).toEqual(
    expect.arrayContaining([
      ['S11-3001', '10000.00', '0.00'],
      ['S11-3002', '1000.00', '0.00'],
      ['S21-2001', '2000.00', '0.00'],
      ['S41-1101', '0.00', '12000.00'],
      ['S41-1201', '0.00', '1000.00'],
    ]),
  );
  const commission = await db.salesCommission.findFirstOrThrow({ where: { contractId: row.id } });
  expect(commission.commissionAmount.toFixed(2)).toBe('360.00');
  expect((await db.contract.findUniqueOrThrow({ where: { id: row.id } })).inputVatStatus).toBe(
    'NOT_ELIGIBLE',
  );
  const audit = await db.auditLog.findFirstOrThrow({
    where: { entityId: row.id, action: 'CONTRACT_ACTIVATED' },
  });
  expect(audit.userId).toBe(checker);
  expect(audit.newValue).toEqual({ operation: 'activate', source: 'FINANCE', outcome: 'SUCCESS' });
  expect(audit.oldValue).toBeNull();
  expect(effects.filter((effect) => effect.refId === row.id)).toEqual([
    { refId: row.id, decision: 'NOTIFY', inTransaction: false },
    { refId: row.id, decision: 'JOURNEY', inTransaction: false },
  ]);
  const before = await moneyState(row.id);
  expect((await action('activate', row.id)).status).toBe(403); // pre-transfer Product source no longer SHOP
  expect(await moneyState(row.id)).toEqual(before);
});
it('concurrent authorized activation commits the canonical financial effects exactly once', async () => {
  const row = await fixture('activate');
  const responses = await Promise.all([action('activate', row.id), action('activate', row.id)]);
  expect(responses.map((res) => res.status).sort()).toEqual([201, 403]);
  expect((await moneyState(row.id)).sales).toBe(1);
  expect((await moneyState(row.id)).audits).toBe(1);
  expect(effects.filter((effect) => effect.refId === row.id)).toHaveLength(2);
});
async function auditFailure(operation: () => Promise<void>, retry: boolean | number = false) {
  if (retry) await db.$executeRawUnsafe('CREATE SEQUENCE activation_retry_seq');
  await db.$executeRawUnsafe(
    `CREATE FUNCTION activation_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='CONTRACT_ACTIVATED'${retry ? ` AND nextval('activation_retry_seq')<=${typeof retry === 'number' ? retry : 1}` : ''} THEN RAISE EXCEPTION 'owned activation audit failure'${retry ? " USING ERRCODE='40001'" : ''}; END IF; RETURN NEW; END $$`,
  );
  await db.$executeRawUnsafe(
    'CREATE TRIGGER activation_failure BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION activation_failure()',
  );
  try {
    await operation();
  } finally {
    await db.$executeRawUnsafe('DROP TRIGGER activation_failure ON audit_logs');
    await db.$executeRawUnsafe('DROP FUNCTION activation_failure()');
    if (retry) await db.$executeRawUnsafe('DROP SEQUENCE activation_retry_seq');
  }
}
it('late required activation audit failure rolls back all money/stock and discards delivery/Journey', async () => {
  const row = await fixture('activate'),
    before = await moneyState(row.id);
  await auditFailure(async () => {
    expect((await action('activate', row.id)).status).toBe(500);
    expect(await moneyState(row.id)).toEqual(before);
    expect(effects.filter((effect) => effect.refId === row.id)).toHaveLength(0);
  });
  expect((await action('activate', row.id)).status).toBe(201);
});
it('whole-attempt serialization retry produces money/audit and delivery/Journey only once', async () => {
  const row = await fixture('activate');
  await auditFailure(async () => {
    expect((await action('activate', row.id)).status).toBe(201);
  }, true);
  expect((await moneyState(row.id)).sales).toBe(1);
  expect((await moneyState(row.id)).audits).toBe(1);
  expect(effects.filter((effect) => effect.refId === row.id)).toHaveLength(2);
});
it('failure after canonical service returns discards the actual outer transaction and queued effects', async () => {
  const row = await fixture('activate'),
    before = await moneyState(row.id);
  await expect(
    owned(checker, async () => {
      await workflow.activate(row.id, checker);
      throw new Error('actual outer failure');
    }),
  ).rejects.toThrow('actual outer failure');
  expect(await moneyState(row.id)).toEqual(before);
  expect(effects.filter((effect) => effect.refId === row.id)).toHaveLength(0);
});
it('direct managed canonical activation requires exact current actor and owned client', async () => {
  const row = await fixture('activate');
  await expect(workflow.activate(row.id, checker)).rejects.toMatchObject({ status: 403 });
  await expect(owned(checker, () => workflow.activate(row.id, denied))).rejects.toMatchObject({
    status: 403,
  });
  await owned(checker, () => workflow.activate(row.id));
  expect((await moneyState(row.id)).audits).toBe(1);
});
async function observeWait(tx: Prisma.TransactionClient, pid: number) {
  for (let i = 0; i < 200; i++) {
    await tx.$executeRaw`SELECT pg_stat_clear_snapshot()`;
    const [row] = await tx.$queryRaw<
      { waiting: boolean }[]
    >`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE wait_event_type='Lock' AND ${pid}=ANY(pg_blocking_pids(pid))) AS waiting`;
    if (row.waiting) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('Request did not reach an observed PostgreSQL lock wait');
}
it.each(['actor', 'contract', 'product', 'customer', 'signature', 'payment', 'credit'] as const)(
  'activation rechecks current %s after an observed PostgreSQL wait',
  async (kind) => {
    const actor = await user();
    await grant(actor, ['contracts.activate'], 'FINANCE', [branchA]);
    await grant(actor, ['products.read', 'customers.read'], 'SHOP', [branchA]);
    const row = await fixture('activate');
    let response: Promise<request.Response> | undefined;
    await db.$transaction(async (tx) => {
      const [{ pid }] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
      if (kind === 'actor') await tx.$executeRaw`SELECT pg_advisory_xact_lock(718294630)`;
      if (kind === 'contract')
        await tx.$queryRaw`SELECT id FROM contracts WHERE id=${row.id} FOR UPDATE`;
      if (kind === 'product')
        await tx.$queryRaw`SELECT id FROM products WHERE id=${row.productId} FOR UPDATE`;
      if (kind === 'customer')
        await tx.$queryRaw`SELECT id FROM customers WHERE id=${row.customerId} FOR UPDATE`;
      if (kind === 'signature')
        await tx.$queryRaw`SELECT id FROM signatures WHERE contract_id=${row.id} FOR UPDATE`;
      if (kind === 'payment')
        await tx.$queryRaw`SELECT id FROM payments WHERE contract_id=${row.id} FOR UPDATE`;
      if (kind === 'credit')
        await tx.$queryRaw`SELECT id FROM credit_checks WHERE contract_id=${row.id} FOR UPDATE`;
      response = action('activate', row.id, actor).then((res) => res);
      await observeWait(tx, pid);
      if (kind === 'actor')
        await tx.user.update({ where: { id: actor }, data: { isActive: false } });
      if (kind === 'contract')
        await tx.contract.update({ where: { id: row.id }, data: { workflowStatus: 'REJECTED' } });
      if (kind === 'product')
        await tx.product.update({ where: { id: row.productId }, data: { branchId: branchB } });
      if (kind === 'customer')
        await tx.customer.update({
          where: { id: row.customerId },
          data: { deletedAt: new Date() },
        });
      if (kind === 'signature')
        await tx.signature.updateMany({
          where: { contractId: row.id, signerType: 'CUSTOMER' },
          data: { deletedAt: new Date() },
        });
      if (kind === 'payment')
        await tx.payment.updateMany({ where: { contractId: row.id }, data: { amountDue: 8000 } });
      if (kind === 'credit')
        await tx.creditCheck.update({ where: { contractId: row.id }, data: { status: 'PENDING' } });
    });
    expect((await response!).status).toBe(
      ['actor', 'product', 'customer'].includes(kind) ? 403 : 400,
    );
    expect((await moneyState(row.id)).sales).toBe(0);
    expect(effects.filter((effect) => effect.refId === row.id)).toHaveLength(0);
  },
);
it.each(['OWNER', 'FINANCE_MANAGER', 'BRANCH_MANAGER'] as const)(
  'R115 explicit current unmigrated %s retains legacy eligible activation',
  async (role) => {
    const actor = await db.user.create({
      data: {
        name: 'Legacy fixture',
        email: randomUUID() + '@test.invalid',
        password: 'unused',
        role,
        branchId: branchA,
        accessManaged: false,
      },
    });
    const row = await fixture('activate');
    await workflow.activate(row.id, actor.id);
    expect((await moneyState(row.id)).sales).toBe(1);
  },
);
it.each(['managed', 'inactive', 'system', 'deleted', 'sales', 'foreign'] as const)(
  'R115 persisted %s actor cannot enter legacy financial activation',
  async (kind) => {
    const actor = await db.user.create({
      data: {
        name: 'Legacy denied',
        email: randomUUID() + '@test.invalid',
        password: 'unused',
        role: kind === 'sales' ? 'SALES' : 'BRANCH_MANAGER',
        branchId: kind === 'foreign' ? branchB : branchA,
        accessManaged: kind === 'managed',
        isActive: kind !== 'inactive',
        isSystemUser: kind === 'system',
        deletedAt: kind === 'deleted' ? new Date() : null,
      },
    });
    const row = await fixture('activate');
    await expect(workflow.activate(row.id, actor.id)).rejects.toMatchObject({ status: 403 });
    expect((await moneyState(row.id)).sales).toBe(0);
  },
);
async function exchangeFixture(replacementBranch = branchA) {
  const old = await fixture('activate');
  expect((await action('activate', old.id)).status).toBe(201);
  const replacement = await fixture('activate', replacementBranch, maker, true, old.customerId);
  await db.contract.update({
    where: { id: replacement.id },
    data: { exchangedFromContractId: old.id, downPayment: 0, financedAmount: 12000 },
  });
  const swap = await db.contractExchangeRequest.create({
    data: {
      oldContractId: old.id,
      newContractId: replacement.id,
      oldProductId: old.productId,
      newProductId: replacement.productId,
      requestedById: maker,
      approvedById: checker,
      approvedAt: new Date(),
      status: 'APPROVED',
      mode: 'PRICED',
      buybackPrice: 11000,
    },
  });
  const actor = await user();
  await grant(
    actor,
    ['contracts.activate', 'contracts.update', 'contract-exchanges.update'],
    'FINANCE',
    [...new Set([branchA, replacementBranch])],
  );
  await grant(actor, ['products.read', 'customers.read'], 'FINANCE', [branchA]);
  await grant(actor, ['products.read', 'customers.read', 'contract-exchanges.update'], 'SHOP', [
    ...new Set([branchA, replacementBranch]),
  ]);
  return { old, replacement, swap, actor };
}
it('actual exchange activation uses the canonical finalizer, original sources, paired books and once-only state', async () => {
  const f = await exchangeFixture();
  const response = await action('activate', f.replacement.id, f.actor);
  expect({ status: response.status, body: response.body }).toEqual({
    status: 201,
    body: { id: f.replacement.id },
  });
  const req = await db.contractExchangeRequest.findUniqueOrThrow({ where: { id: f.swap.id } });
  expect(req.je1aId).toBeTruthy();
  expect(req.je2Id).toBeTruthy();
  expect(req.je3Id).toBeTruthy();
  expect(req.je4Id).toBeTruthy();
  expect((await db.contract.findUniqueOrThrow({ where: { id: f.old.id } })).status).toBe(
    'EXCHANGED',
  );
  expect((await db.product.findUniqueOrThrow({ where: { id: f.old.productId } })).status).toBe(
    'REFURBISHED',
  );
  expect((await moneyState(f.replacement.id)).sales).toBe(0);
  expect((await moneyState(f.replacement.id)).commissions).toBe(0);
  expect((await moneyState(f.replacement.id)).audits).toBe(1);
  const buyback = await db.journalLine.findMany({ where: { journalEntryId: req.je3Id! } });
  expect(
    buyback.map((line) => [line.accountCode, line.debit.toFixed(2), line.credit.toFixed(2)]),
  ).toEqual(
    expect.arrayContaining([
      ['11-2107', '11000.00', '0.00'],
      ['21-1106', '0.00', '11000.00'],
    ]),
  );
  const before = await db.journalEntry.count();
  expect((await action('activate', f.replacement.id, f.actor)).status).toBe(403);
  expect(await db.journalEntry.count()).toBe(before);
});
it('actual exchange activation rolls back old/new state, all canonical books, request references and effects on required audit failure', async () => {
  const f = await exchangeFixture(),
    before = await moneyState(f.replacement.id),
    oldBefore = await moneyState(f.old.id),
    journals = await db.journalEntry.count();
  await auditFailure(async () => {
    expect((await action('activate', f.replacement.id, f.actor)).status).toBe(500);
    expect(await moneyState(f.replacement.id)).toEqual(before);
    expect(await moneyState(f.old.id)).toEqual(oldBefore);
    expect(await db.journalEntry.count()).toBe(journals);
    expect(
      (await db.contractExchangeRequest.findUniqueOrThrow({ where: { id: f.swap.id } })).je1aId,
    ).toBeNull();
    expect(effects.filter((effect) => effect.refId === f.replacement.id)).toHaveLength(0);
  });
});
it.each(['exchange', 'contract-update'] as const)(
  'exchange activation requires independent pre-transfer %s grants',
  async (missing) => {
    const f = await exchangeFixture(),
      actor = await user();
    await grant(
      actor,
      [
        'contracts.activate',
        'products.read',
        'customers.read',
        ...(missing === 'exchange'
          ? ['contracts.update' as const]
          : ['contract-exchanges.update' as const]),
      ],
      'FINANCE',
      [branchA],
    );
    await grant(
      actor,
      [
        'products.read',
        'customers.read',
        ...(missing === 'exchange' ? [] : ['contract-exchanges.update' as const]),
      ],
      'SHOP',
      [branchA],
    );
    expect((await action('activate', f.replacement.id, actor)).status).toBe(403);
    expect((await moneyState(f.replacement.id)).status).toBe('DRAFT');
  },
);
async function finalizeInput(id: string) {
  const tx = currentDomainAccess()!.client;
  const c = await tx.contract.findUniqueOrThrow({ where: { id }, include: { product: true } });
  return {
    ...c,
    exchangedFromContractId: c.exchangedFromContractId!,
    productCategory: c.product.category,
    productCostPrice: c.product.costPrice,
  };
}
it('exchange activation receipt rejects forged JSON, wrong client, wrong identity, replay and cross-attempt reuse', async () => {
  const f = await exchangeFixture();
  await expect(
    owned(f.actor, async () =>
      exchange.finalizeAfterActivation(
        await finalizeInput(f.replacement.id),
        currentDomainAccess()!.client,
        undefined,
        {},
      ),
    ),
  ).rejects.toMatchObject({ status: 403 });
  let retained: object | undefined;
  await owned(f.actor, async () => {
    retained = await exchange.prepareActivation(f.replacement.id, currentDomainAccess()!.client);
  });
  await expect(
    owned(f.actor, async () =>
      exchange.finalizeAfterActivation(
        await finalizeInput(f.replacement.id),
        currentDomainAccess()!.client,
        undefined,
        retained,
      ),
    ),
  ).rejects.toMatchObject({ status: 403 });
  await expect(
    owned(f.actor, async () => {
      const tx = currentDomainAccess()!.client,
        receipt = await exchange.prepareActivation(f.replacement.id, tx);
      await exchange.finalizeAfterActivation(
        await finalizeInput(f.replacement.id),
        db,
        undefined,
        receipt,
      );
    }),
  ).rejects.toMatchObject({ status: 403 });
  await expect(
    owned(f.actor, async () => {
      const tx = currentDomainAccess()!.client,
        receipt = await exchange.prepareActivation(f.replacement.id, tx);
      const input = await finalizeInput(f.replacement.id);
      await expect(
        exchange.finalizeAfterActivation(
          { ...input, productId: f.old.productId },
          tx,
          undefined,
          receipt,
        ),
      ).rejects.toMatchObject({ status: 403 });
      await exchange.finalizeAfterActivation(input, tx, undefined, receipt);
    }),
  ).rejects.toMatchObject({ status: 403 });
});
it('exchange request identity is rechecked after an actual request lock wait', async () => {
  const f = await exchangeFixture();
  let response: Promise<request.Response> | undefined;
  await db.$transaction(async (tx) => {
    const [{ pid }] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
    await tx.$queryRaw`SELECT id FROM contract_exchange_requests WHERE id=${f.swap.id} FOR UPDATE`;
    response = action('activate', f.replacement.id, f.actor).then((res) => res);
    await observeWait(tx, pid);
    await tx.contractExchangeRequest.update({
      where: { id: f.swap.id },
      data: { status: 'REJECTED' },
    });
  });
  expect((await response!).status).toBe(403);
  expect((await moneyState(f.replacement.id)).status).toBe('DRAFT');
});
it('R115 legacy actor migration while the financial transaction waits closes the legacy path', async () => {
  const actor = await db.user.create({
    data: {
      name: 'Legacy migrating',
      email: randomUUID() + '@test.invalid',
      password: 'unused',
      role: 'FINANCE_MANAGER',
      accessManaged: false,
    },
  });
  const row = await fixture('activate');
  let result: Promise<unknown> | undefined;
  await db.$transaction(async (tx) => {
    const [{ pid }] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
    await tx.$queryRaw`SELECT id FROM users WHERE id=${actor.id} FOR UPDATE`;
    result = workflow.activate(row.id, actor.id).catch((error) => error);
    await observeWait(tx, pid);
    await tx.user.update({ where: { id: actor.id }, data: { accessManaged: true } });
  });
  expect(await result).toMatchObject({ status: 403 });
  expect((await moneyState(row.id)).sales).toBe(0);
});
it('current closed books preserve canonical grace semantics at the exact activation posting date after a real period wait', async () => {
  const now = new Date(),
    books = await db.companyInfo.findMany({ where: { companyCode: { in: ['SHOP', 'FINANCE'] } } });
  const periods = await Promise.all(
    books.map((book) =>
      db.accountingPeriod.upsert({
        where: {
          companyId_year_month: {
            companyId: book.id,
            year: now.getFullYear(),
            month: now.getMonth() + 1,
          },
        },
        create: { companyId: book.id, year: now.getFullYear(), month: now.getMonth() + 1 },
        update: { status: 'OPEN' },
      }),
    ),
  );
  const row = await fixture('activate');
  let response: Promise<request.Response> | undefined;
  await db.$transaction(async (tx) => {
    const [{ pid }] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
    const ids = periods.map((period) => period.id);
    await tx.$queryRaw`SELECT id FROM accounting_periods WHERE id=ANY(${ids}::text[]) FOR UPDATE`;
    response = action('activate', row.id).then((res) => res);
    await observeWait(tx, pid);
    await tx.accountingPeriod.updateMany({
      where: { id: { in: ids } },
      data: { status: 'CLOSED' },
    });
  });
  expect((await response!).status).toBe(201);
  await db.accountingPeriod.updateMany({
    where: { id: { in: periods.map((period) => period.id) } },
    data: { status: 'OPEN' },
  });
});
it('exchange activation uses original replacement SHOP read without inventing FINANCE Product read at its destination branch', async () => {
  const f = await exchangeFixture(branchB);
  expect((await action('activate', f.replacement.id, f.actor)).status).toBe(201);
  expect((await moneyState(f.replacement.id)).status).toBe('ACTIVE');
});
it('three failed serialization attempts exhaust the bound and leave no financial or delivery effect', async () => {
  const row = await fixture('activate'),
    before = await moneyState(row.id);
  await auditFailure(async () => {
    expect((await action('activate', row.id)).status).toBe(500);
    const seq = await db.$queryRawUnsafe<{ last_value: bigint }[]>(
      'SELECT last_value FROM activation_retry_seq',
    );
    expect(Number(seq[0].last_value)).toBe(3);
    expect(await moneyState(row.id)).toEqual(before);
    expect(effects.filter((effect) => effect.refId === row.id)).toHaveLength(0);
  }, 3);
});
it('a retry after canonical activation has queued its notification discards the failed attempt queue', async () => {
  const row = await fixture('activate');
  let attempts = 0;
  await owned(checker, async () => {
    await workflow.activate(row.id, checker);
    if (++attempts === 1)
      throw new Prisma.PrismaClientKnownRequestError('owned post-service retry', {
        code: 'P2034',
        clientVersion: 'test',
      });
  });
  expect(attempts).toBe(2);
  expect((await moneyState(row.id)).sales).toBe(1);
  expect(effects.filter((effect) => effect.refId === row.id)).toEqual([
    { refId: row.id, decision: 'NOTIFY', inTransaction: false },
  ]);
});
it('activation consumes same-origin reserved bundle stock and posts its real additional cost once', async () => {
  const row = await fixture('activate');
  const bundle = await db.product.create({
    data: {
      name: 'Owned bundle',
      brand: 'Apple',
      model: 'Test',
      category: 'ACCESSORY',
      costPrice: 300,
      branchId: branchA,
      status: 'RESERVED',
    },
  });
  await db.contract.update({ where: { id: row.id }, data: { bundleProductIds: [bundle.id] } });
  expect((await action('activate', row.id)).status).toBe(201);
  expect((await db.product.findUniqueOrThrow({ where: { id: bundle.id } })).status).toBe(
    'SOLD_CASH',
  );
  const sale = await db.sale.findFirstOrThrow({ where: { contractId: row.id } });
  expect(sale.bundleProductIds).toEqual([bundle.id]);
  const entry = await db.journalEntry.findFirstOrThrow({
    where: {
      AND: [
        { metadata: { path: ['contractId'], equals: row.id } },
        { metadata: { path: ['tag'], equals: 'SHOP_INVENTORY_TRANSFER_COGS' } },
      ],
    },
    include: { lines: true },
  });
  expect(
    entry.lines.some((line) => line.accountCode === 'S50-1103' && line.debit.equals(300)),
  ).toBe(true);
});
async function sealedFixture() {
  const row = await fixture('activate');
  await db.contract.update({ where: { id: row.id }, data: { workflowStatus: 'CREATING' } });
  const resources = new AccessResourceService(db as PrismaService, snapshots);
  await resources.execute(
    maker,
    'contracts.update',
    'SHOP',
    undefined,
    () => workflow.submitForReview(row.id, maker),
    false,
    { isolationLevel: 'Serializable', maxAttempts: 3 },
  );
  const reviewer = await user();
  await grant(reviewer, ['contracts.approve'], 'FINANCE', [branchA]);
  await resources.execute(
    reviewer,
    'contracts.approve',
    'FINANCE',
    undefined,
    () => workflow.approveContract(row.id, reviewer, 'SALES'),
    false,
    { isolationLevel: 'Serializable', maxAttempts: 3 },
  );
  expect(
    (await db.contract.findUniqueOrThrow({ where: { id: row.id } })).contractHash,
  ).toBeTruthy();
  return row;
}
it.each(['customer', 'document'] as const)(
  'activation rejects stale sealed %s after the actual evidence lock wait',
  async (kind) => {
    const row = await sealedFixture();
    let response: Promise<request.Response> | undefined;
    await db.$transaction(async (tx) => {
      const [{ pid }] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
      if (kind === 'customer')
        await tx.$queryRaw`SELECT id FROM customers WHERE id=${row.customerId} FOR UPDATE`;
      else
        await tx.$queryRaw`SELECT id FROM contract_documents WHERE contract_id=${row.id} FOR UPDATE`;
      response = action('activate', row.id).then((res) => res);
      await observeWait(tx, pid);
      if (kind === 'customer')
        await tx.customer.update({
          where: { id: row.customerId },
          data: { nationalId: randomUUID() },
        });
      else
        await tx.contractDocument.updateMany({
          where: { contractId: row.id },
          data: { fileHash: 'different-private-hash' },
        });
    });
    expect((await response!).status).toBe(400);
    expect((await moneyState(row.id)).sales).toBe(0);
  },
);
it('safe managed activation error audit excludes arbitrary body, private conflict identifiers, IP and user-agent', async () => {
  const row = await fixture('activate');
  await db.product.update({ where: { id: row.productId }, data: { status: 'RESERVED' } });
  const competing = await fixture('activate');
  await db.contract.update({
    where: { id: competing.id },
    data: { productId: row.productId, contractNumber: 'PRIVATE-OTHER-CONTRACT' },
  });
  const response = await request(app.getHttpServer())
    .post(`/contracts/${row.id}/activate`)
    .set('x-test-user', checker)
    .set('x-company-scope', 'FINANCE')
    .set('user-agent', 'PRIVATE-USER-AGENT')
    .send({ privateSecret: 'PRIVATE-BODY' });
  expect(response.status).toBe(409);
  expect(JSON.stringify(response.body)).not.toContain('PRIVATE-OTHER-CONTRACT');
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await db.auditLog.count({ where: { entityId: row.id, action: 'POST_ERROR' } })) break;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  const audit = await db.auditLog.findFirstOrThrow({
    where: { entityId: row.id, action: 'POST_ERROR' },
  });
  expect(audit.ipAddress).toBeNull();
  expect(audit.userAgent).toBeNull();
  expect(JSON.stringify(audit.newValue)).not.toMatch(/PRIVATE-|privateSecret/);
});
it.each(['SHOP', 'read-scope', 'weak-isolation'] as const)(
  'direct activation rejects the wrong owned %s execution',
  async (mode) => {
    const actor = await user(true),
      row = await fixture('activate');
    const resources = new AccessResourceService(db as PrismaService, snapshots);
    await expect(
      resources.execute(
        actor,
        'contracts.activate',
        mode === 'SHOP' ? 'SHOP' : 'FINANCE',
        undefined,
        () => workflow.activate(row.id, actor),
        mode === 'read-scope',
        { isolationLevel: mode === 'weak-isolation' ? 'ReadCommitted' : 'Serializable' },
      ),
    ).rejects.toMatchObject({ status: 403 });
    expect((await moneyState(row.id)).sales).toBe(0);
  },
);
it('notification failure after actual commit never retries or reverses canonical money', async () => {
  const row = await fixture('activate');
  deliveryFailures.add(row.id);
  expect((await action('activate', row.id)).status).toBe(201);
  deliveryFailures.delete(row.id);
  expect((await moneyState(row.id)).sales).toBe(1);
  expect((await moneyState(row.id)).audits).toBe(1);
  expect(effects.filter((effect) => effect.refId === row.id)).toHaveLength(2);
});
it('exchange activation receipt can only be minted before the genuine replacement ownership transfer', async () => {
  const f = await exchangeFixture();
  await expect(
    owned(f.actor, async () => {
      const tx = currentDomainAccess()!.client;
      const finance = await tx.companyInfo.findUniqueOrThrow({ where: { companyCode: 'FINANCE' } });
      await tx.product.update({
        where: { id: f.replacement.productId },
        data: { status: 'SOLD_INSTALLMENT', ownedByCompanyId: finance.id },
      });
      await exchange.prepareActivation(f.replacement.id, tx);
    }),
  ).rejects.toMatchObject({ status: 403 });
  expect((await moneyState(f.replacement.id)).status).toBe('DRAFT');
});
