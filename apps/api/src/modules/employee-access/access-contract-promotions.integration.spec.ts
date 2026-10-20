import { CONTRACT_CONSENT_PURPOSES } from '../pdpa/contract-consent-evidence';
import { AccessContractPreparationActions } from './access-contract-preparation-actions';
import { AccessPartySourceService } from './access-party-source.service';
import { AccessProcurementSourceService } from './access-procurement-source.service';
import { linkRoomCreditHistory, lockCreditRoom } from '../credit-check/services/room-credit-history';
import { ContractCancellationService } from '../contracts/services/contract-cancellation.service';
import { ContractCancellationTemplate } from '../journal/cpa-templates/contract-cancellation.template';
import { ExchangeCancelReversalTemplate } from '../journal/cpa-templates/exchange-cancel-reversal.template';
import { EclStageReverseTemplate } from '../journal/cpa-templates/ecl-stage-reverse.template';
import { ContractWorkflowService } from '../contracts/contract-workflow.service';
import { ContractSignatureService } from '../contracts/services/contract-signature.service';
import { DocumentPersistenceService } from '../contracts/services/document-persistence.service';
import { ContractActivation1ATemplate } from '../journal/cpa-templates/contract-activation-1a.template';
import { ShopInventoryTransferTemplate } from '../journal/cpa-templates/shop-inventory-transfer.template';
import { InstallmentInputVatTemplate } from '../journal/cpa-templates/installment-input-vat.template';
import { ProductsService } from '../products/products.service';
import { PromotionsService } from '../promotions/promotions.service';
import { seedFinanceCoa } from '../../../prisma/seed-coa-finance';
import { currentDomainAccess } from './access-execution-context';
import { randomUUID } from 'node:crypto';
import { PermissionKey } from '@installment/shared';
import { Prisma, PrismaClient } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AccessResourceService } from './access-resource.service';
import { AccessSnapshotService } from './access-snapshot.service';
import { ContractQuoteService } from '../contracts/services/contract-quote.service';
import { ContractLifecycleService } from '../contracts/services/contract-lifecycle.service';
import { ContractQueryService } from '../contracts/services/contract-query.service';
import { ContractQuoteDto } from '../contracts/dto/contract-quote.dto';
import { JournalAutoService } from '../journal/journal-auto.service';
import { CompanyResolverService } from '../journal/company-resolver.service';
import { ShopAccountResolver } from '../journal/shop-account-resolver.service';
import { ShopDownPaymentTemplate } from '../journal/cpa-templates/shop-down-payment.template';
import { ShopDownPaymentReversalTemplate } from '../journal/cpa-templates/shop-down-payment-reversal.template';
import { CreditCheckOverrideService } from '../credit-check/services/credit-check-override.service';
import { seedShopCoa } from '../../../prisma/seed-coa-shop';
import { TradeInCreditService } from '../trade-in/services/trade-in-credit.service';

const url = process.env.EMPLOYEE_ACCESS_TEST_DATABASE_URL;
if (
  !url?.includes('/bc_access_task2?host=/tmp/bc-access-contract-promotions.') ||
  process.env.DATABASE_URL !== url ||
  process.env.DATABASE_URL_FINANCE !== url
) {
  throw new Error('Both database URLs must use owned isolated Contract promotion PostgreSQL');
}
const db = new PrismaClient({ datasources: { db: { url } } });
const prisma = db as unknown as PrismaService;
const resources = new AccessResourceService(prisma, new AccessSnapshotService(prisma));
const journal = new JournalAutoService(prisma);
const company = new CompanyResolverService(prisma);
const accounts = new ShopAccountResolver(prisma);
const lifecycle = new ContractLifecycleService(
  prisma,
  new ContractQueryService(prisma),
  new ShopDownPaymentTemplate(journal, prisma, company),
  new ShopDownPaymentReversalTemplate(journal, prisma, company),
  accounts,
);
const provider = jest.fn(async () => {
  expect(currentDomainAccess()).toBeUndefined();
});
const signatures = new ContractSignatureService(
  prisma,
  () => ({ ensureSignedContractDocument: provider }) as unknown as DocumentPersistenceService,
);
const workflow = new ContractWorkflowService(
  prisma,
  { send: provider } as never,
  journal,
  new ContractActivation1ATemplate(journal, prisma),
  new ProductsService(prisma),
  {} as never,
  new ShopInventoryTransferTemplate(journal, prisma, company),
  new ShopDownPaymentTemplate(journal, prisma, company),
  accounts,
  new InstallmentInputVatTemplate(journal, prisma, company),
  undefined,
  undefined,
  new AccessContractPreparationActions(
    resources,
    new AccessPartySourceService(resources, new AccessProcurementSourceService(resources)),
  ),
);
const promotions = new PromotionsService(prisma);
let branchId: string,
  shopId: string,
  owner: string,
  seller: string,
  denied: string,
  finance: string,
  financeId: string;
async function grant(
  userId: string,
  permissions: PermissionKey[],
  companyCode: 'SHOP' | 'FINANCE' = 'SHOP',
  scope: 'BRANCHES' | 'ASSIGNED' | 'COMPANY' = 'BRANCHES',
) {
  const position = await db.accessPosition.create({
    data: { code: randomUUID(), name: 'Owned rate', permissions },
  });
  return db.employeeAccessAssignment.create({
    data: {
      userId,
      positionId: position.id,
      companyCode,
      scope,
      ...(scope === 'COMPANY' ? {} : { branches: { create: [{ branchId }] } }),
    },
  });
}
async function fixture(withActiveContract = false) {
  const product = await db.product.create({
    data: {
      name: 'Owned rate phone',
      brand: 'Apple',
      model: 'Test',
      imeiSerial: randomUUID(),
      category: 'PHONE_NEW',
      costPrice: 6000,
      cashPrice: 10000,
      installmentPrice: 12000,
      branchId,
      ownedByCompanyId: shopId,
    },
  });
  const customer = await db.customer.create({
    data: {
      name: 'Owned rate buyer',
      phone: '0800000000',
      nationalId: randomUUID(),
      birthDate: new Date('1990-01-01'),
    },
  });
  await db.tradeIn.create({
    data: { customerId: customer.id, branchId, deviceBrand: 'Apple', deviceModel: 'Evidence' },
  });
  const promotion = await db.promotion.create({
    data: {
      name: 'Owned named rate',
      type: 'SPECIAL_RATE',
      specialInterestRate: '0.02',
      startDate: new Date('2020-01-01'),
      endDate: new Date('2099-01-01'),
      maxUsageCount: 1,
      conditions: {},
    },
  });
  const hiddenContract = withActiveContract
    ? await db.contract.create({
        data: {
          contractNumber: 'HIDDEN-FINANCE-' + randomUUID(),
          customerId: customer.id,
          productId: (
            await db.product.create({
              data: {
                name: 'Hidden finance product',
                brand: 'Apple',
                model: 'Hidden',
                category: 'PHONE_NEW',
                costPrice: 1000,
                branchId,
                ownedByCompanyId: financeId,
              },
            })
          ).id,
          branchId,
          salespersonId: finance,
          planType: 'STORE_DIRECT',
          status: 'ACTIVE',
          sellingPrice: 5000,
          downPayment: 500,
          financedAmount: 4500,
          interestRate: 0.08,
          interestTotal: 2160,
          totalMonths: 6,
          monthlyPayment: 1000,
        },
      })
    : null;
  const room = await db.chatRoom.create({ data: { customerId: customer.id, channel: 'LINE_SHOP', assignedToId: seller } });
  await db.roomCreditAnalysis.create({ data: { roomId: room.id, status: 'COMPLETED', fileIds: ['synthetic-owned-statement'],
    result: { monthlyIncome: 50000, monthlyExpense: 10000 } } });
  await db.$transaction(async tx => { await lockCreditRoom(tx, room.id); await linkRoomCreditHistory(tx, room.id, customer.id); });
  const check = await db.creditCheck.findFirstOrThrow({ where: { customerId: customer.id } });
  const overrides = new CreditCheckOverrideService(prisma);
  const basis = {
    verifiedMonthlyIncome: 50000,
    livingExpenses: 10000,
    externalMonthlyDebt: 0,
    salaryPayDay: 5,
    evidenceNotes: 'Synthetic verified evidence for isolated promotion producer test.',
  };
  const preview = await overrides.approval.preview(check.id, basis, { id: owner, role: 'OWNER' });
  await overrides.overrideById(
    check.id,
    {
      status: 'APPROVED',
      overrideReason: 'Owned synthetic affordability',
      affordability: {
        ...basis,
        contextToken: preview.contextToken,
        approvedMonthlyPayment: 5000,
        confirmed: true,
      },
    },
    owner,
    'OWNER',
  );
  const dto: ContractQuoteDto & { promotionId: string; downPaymentMethod: 'CASH' } = {
    customerId: customer.id,
    productId: product.id,
    branchId,
    promotionId: promotion.id,
    sellingPrice: 12000,
    downPayment: 2000,
    totalMonths: 6,
    paymentDueDay: 5,
    downPaymentMethod: 'CASH',
  };
  return { product, customer, promotion, dto, hiddenContract };
}
function execute<T>(
  actor: string,
  handler: () => Promise<T>,
  permission: PermissionKey = 'contracts.create',
  companyCode: 'SHOP' | 'FINANCE' = 'SHOP',
) {
  return resources.execute(actor, permission, companyCode, undefined, handler, false, {
    isolationLevel: 'Serializable',
    maxAttempts: 3,
  });
}
beforeAll(async () => {
  shopId = (await db.companyInfo.findUniqueOrThrow({ where: { companyCode: 'SHOP' } })).id;
  branchId = (
    await db.branch.create({
      data: { name: 'Owned rate branch', companyId: shopId, shopCashAccountCode: 'S11-1101' },
    })
  ).id;
  owner = (
    await db.user.create({
      data: {
        name: 'Owned owner',
        email: 'admin@bestchoice.com',
        password: 'unused',
        role: 'OWNER',
        accessManaged: true,
        branchId,
      },
    })
  ).id;
  seller = (
    await db.user.create({
      data: {
        name: 'Owned seller',
        email: randomUUID() + '@test.invalid',
        password: 'unused',
        role: 'SALES',
        accessManaged: true,
        branchId,
      },
    })
  ).id;
  denied = (
    await db.user.create({
      data: {
        name: 'Denied seller',
        email: randomUUID() + '@test.invalid',
        password: 'unused',
        role: 'SALES',
        accessManaged: true,
        branchId,
      },
    })
  ).id;
  await grant(seller, ['credit-checks.read', 'chat.read'], 'SHOP', 'COMPANY');
  await grant(seller, [
    'contracts.create',
    'contracts.update',
    'promotions.read',
    'sales.read',
    'promotions.apply',
    'products.read',
    'customers.read',
    'trade-in.read',
  ]);
  finance = (
    await db.user.create({
      data: {
        name: 'Owned finance',
        email: randomUUID() + '@test.invalid',
        password: 'unused',
        role: 'FINANCE_MANAGER',
        accessManaged: true,
      },
    })
  ).id;
  await grant(finance, ['contracts.approve', 'contracts.activate', 'contracts.read'], 'FINANCE');
  await grant(finance, ['products.read', 'customers.read'], 'SHOP');
  financeId = (await db.companyInfo.findUniqueOrThrow({ where: { companyCode: 'FINANCE' } })).id;
  await grant(denied, ['contracts.create', 'products.read', 'customers.read']);
  await db.interestConfig.create({
    data: {
      name: 'Owned ordinary rate',
      interestRate: '0.08',
      minDownPaymentPct: '0.1',
      storeCommissionPct: '0.1',
      vatPct: '0.07',
      minInstallmentMonths: 1,
      maxInstallmentMonths: 24,
      productCategories: ['PHONE_NEW'],
    },
  });
  await seedShopCoa(db);
  await seedFinanceCoa(db);
});
afterAll(async () => db.$disconnect());
it('creates real named 0.02 financial draft instead of ordinary 0.08 interest', async () => {
  const f = await fixture();
  const { result } = await execute(seller, () =>
    lifecycle.create(f.dto, seller, 'SALES', branchId),
  );
  expect(Number(result.interestRate)).toBe(0.02);
  expect(Number(result.interestTotal)).toBe(1200);
  expect(await db.payment.count({ where: { contractId: result.id } })).toBe(6);
  expect((await db.product.findUniqueOrThrow({ where: { id: f.product.id } })).status).toBe(
    'RESERVED',
  );
  expect(
    (await db.promotion.findUniqueOrThrow({ where: { id: f.promotion.id } })).currentUsageCount,
  ).toBe(1);
});
it('denies named quotation without current independent promotions.apply', async () => {
  const f = await fixture();
  await expect(
    execute(denied, () =>
      new ContractQuoteService(prisma).resolve(f.dto, { id: denied, role: 'SALES', branchId }),
    ),
  ).rejects.toMatchObject({ status: 403 });
});
it('denies real named draft creation without current independent promotions.apply', async () => {
  const f = await fixture();
  await expect(
    execute(denied, () => lifecycle.create(f.dto, denied, 'SALES', branchId)),
  ).rejects.toMatchObject({ status: 403 });
  expect(await db.contract.count({ where: { productId: f.product.id } })).toBe(0);
});

async function draft(actor = seller, withBundle = false) {
  const f = await fixture();
  const bundle = withBundle
    ? await db.product.create({
        data: {
          name: 'Owned accessory',
          brand: 'Apple',
          model: 'Case',
          category: 'ACCESSORY',
          costPrice: 100,
          cashPrice: 200,
          branchId,
          ownedByCompanyId: shopId,
        },
      })
    : null;
  const { result } = await execute(actor, () =>
    lifecycle.create(
      { ...f.dto, ...(bundle ? { bundleProductIds: [bundle.id] } : {}) },
      actor,
      'SALES',
      branchId,
    ),
  );
  return { ...f, contract: result };
}
async function signed(actor = seller, withBundle = false) {
  const f = await draft(actor, withBundle);
  const consent = await db.pDPAConsent.create({
    data: {
      customerId: f.customer.id,
      consentVersion: 'owned',
      privacyNoticeText: 'Synthetic consent',
      purposes: [...CONTRACT_CONSENT_PURPOSES],
      grantedAt: new Date(),
      status: 'GRANTED',
    },
  });
  await db.contract.update({ where: { id: f.contract.id }, data: { pdpaConsentId: consent.id } });
  for (const signerType of ['CUSTOMER', 'COMPANY', 'WITNESS_1', 'WITNESS_2']) {
    await execute(
      actor,
      () =>
        signatures.signContract(
          f.contract.id,
          'synthetic-signature',
          signerType,
          {},
          { staffUserId: actor, signerName: signerType },
        ),
      'contracts.update',
    );
  }
  for (const documentType of [
    'SIGNED_CONTRACT',
    'ID_CARD_COPY',
    'KYC_SELFIE',
    'DEVICE_PHOTO',
  ] as const) {
    await db.contractDocument.create({
      data: {
        contractId: f.contract.id,
        documentType,
        fileName: 'synthetic',
        fileUrl: 'synthetic://owned',
        fileHash: randomUUID(),
        uploadedById: actor,
      },
    });
  }
  await execute(actor, () => workflow.submitForReview(f.contract.id, actor), 'contracts.update');
  return f;
}
async function approved() {
  const f = await signed();
  await execute(
    finance,
    () => workflow.approveContract(f.contract.id, finance, 'FINANCE_MANAGER'),
    'contracts.approve',
    'FINANCE',
  );
  return f;
}
async function activate(id: string, actor = finance) {
  return execute(actor, () => workflow.activate(id), 'contracts.activate', 'FINANCE');
}
async function state(id: string) {
  return {
    contract: await db.contract.findUniqueOrThrow({ where: { id } }),
    terms: await db.contractPromotionTerms.findUniqueOrThrow({
      where: { contractId: id },
      include: { reservation: true },
    }),
    sales: await db.sale.count({ where: { contractId: id } }),
    schedules: await db.installmentSchedule.count({ where: { contractId: id } }),
    journals: await db.journalEntry.count({
      where: { metadata: { path: ['contractId'], equals: id } },
    }),
    usages: await db.promotionUsage.count({ where: { sale: { contractId: id } } }),
    benefits: await db.salePromotionBenefit.count({ where: { sale: { contractId: id } } }),
  };
}
it('signs, reviews and activates actual immutable rate Sale, journals and usage exactly once', async () => {
  const f = await approved();
  const before = await state(f.contract.id);
  expect(before.terms.reservation?.state).toBe('RESERVED');
  await activate(f.contract.id);
  const after = await state(f.contract.id);
  expect(after.contract.status).toBe('ACTIVE');
  expect(after.terms.reservation?.state).toBe('CONSUMED');
  expect(after).toMatchObject({ sales: 1, schedules: 6, usages: 1, benefits: 1 });
  expect(after.journals).toBeGreaterThan(before.journals);
  expect(Number(after.contract.interestRate)).toBe(0.02);
  expect(
    (await db.product.findUniqueOrThrow({ where: { id: f.product.id } })).ownedByCompanyId,
  ).toBe(financeId);
  expect(
    (await db.promotion.findUniqueOrThrow({ where: { id: f.promotion.id } })).currentUsageCount,
  ).toBe(1);
  await expect(activate(f.contract.id)).rejects.toBeDefined();
  expect(await state(f.contract.id)).toEqual(after);
});
it('honors reserved terms after campaign deletion, expiry, rate, cap, price and config changes', async () => {
  const f = await approved();
  await db.promotion.update({
    where: { id: f.promotion.id },
    data: {
      isActive: false,
      deletedAt: new Date(),
      endDate: new Date('2020-01-01'),
      specialInterestRate: 0.09,
      maxUsageCount: 1,
    },
  });
  await db.product.update({ where: { id: f.product.id }, data: { installmentPrice: 15000 } });
  const config = await db.interestConfig.findFirstOrThrow();
  await db.interestConfig.update({
    where: { id: config.id },
    data: { interestRate: 0.15, storeCommissionPct: 0.25 },
  });
  try {
    await activate(f.contract.id);
    const c = await db.contract.findUniqueOrThrow({ where: { id: f.contract.id } });
    expect(Number(c.interestRate)).toBe(0.02);
    expect(Number(c.storeCommission)).toBe(1000);
  } finally {
    await db.interestConfig.update({
      where: { id: config.id },
      data: { interestRate: 0.08, storeCommissionPct: 0.1 },
    });
  }
});
it('quotes reserve nothing and supports zero monthly rate', async () => {
  const f = await fixture();
  await db.promotion.update({ where: { id: f.promotion.id }, data: { specialInterestRate: 0 } });
  const { result } = await execute(seller, () =>
    new ContractQuoteService(prisma).resolve(f.dto, { id: seller, role: 'SALES', branchId }),
  );
  expect(Number(result.interestRate)).toBe(0);
  expect(Number(result.interestTotal)).toBe(0);
  expect(
    (await db.promotion.findUniqueOrThrow({ where: { id: f.promotion.id } })).currentUsageCount,
  ).toBe(0);
  expect(await db.contractPromotionTerms.count({ where: { promotionId: f.promotion.id } })).toBe(0);
});
it.each([
  { isActive: false },
  { deletedAt: new Date() },
  { startDate: new Date('2099-01-01') },
  { endDate: new Date('2020-01-01') },
  { currentUsageCount: 1 },
  { conditions: { minPurchase: 15000 } },
  { conditions: { categories: ['PHONE_USED'] } },
  { conditions: { productIds: ['not-this-product'] } },
  { conditions: { unknown: true } },
])('denies current campaign condition %j before draft money', async (change) => {
  const f = await fixture();
  await db.promotion.update({ where: { id: f.promotion.id }, data: change });
  await expect(
    execute(seller, () => lifecycle.create(f.dto, seller, 'SALES', branchId)),
  ).rejects.toBeDefined();
  expect(await db.contract.count({ where: { productId: f.product.id } })).toBe(0);
  expect((await db.product.findUniqueOrThrow({ where: { id: f.product.id } })).status).toBe(
    'IN_STOCK',
  );
});
it('rejects scalar override even equal to named rate and missing managed execution', async () => {
  const f = await fixture();
  await expect(
    execute(seller, () =>
      lifecycle.create({ ...f.dto, interestRate: 0.02 }, seller, 'OWNER', branchId),
    ),
  ).rejects.toMatchObject({ status: 400 });
  await expect(lifecycle.create(f.dto, owner, 'OWNER', branchId)).rejects.toMatchObject({
    status: 403,
  });
});
it('rejects changed actual baseline and unrepresentable owner rate without rounding', async () => {
  const f = await fixture();
  await expect(
    execute(seller, () =>
      lifecycle.create({ ...f.dto, sellingPrice: 11999 }, seller, 'SALES', branchId),
    ),
  ).rejects.toMatchObject({ status: 400 });
  await expect(
    execute(
      owner,
      () => promotions.update(f.promotion.id, { specialInterestRate: 0.02001 }),
      'promotions.manage',
    ),
  ).rejects.toMatchObject({ status: 400 });
});
it('reserves the last slot for exactly one concurrent canonical draft', async () => {
  const a = await fixture(),
    b = await fixture();
  b.dto.promotionId = a.promotion.id;
  const results = await Promise.allSettled(
    [a, b].map((f) => execute(seller, () => lifecycle.create(f.dto, seller, 'SALES', branchId))),
  );
  expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  expect(await db.contractPromotionTerms.count({ where: { promotionId: a.promotion.id } })).toBe(1);
  expect(
    (await db.promotion.findUniqueOrThrow({ where: { id: a.promotion.id } })).currentUsageCount,
  ).toBe(1);
});
it('allows one concurrent activation with no duplicate Sale, usage, benefit or schedules', async () => {
  const f = await approved();
  const results = await Promise.allSettled([activate(f.contract.id), activate(f.contract.id)]);
  expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  expect(await state(f.contract.id)).toMatchObject({
    sales: 1,
    benefits: 1,
    usages: 1,
    schedules: 6,
  });
});
it('requires current independent FINANCE execution instead of SHOP approval, salesperson or role', async () => {
  const f = await approved();
  await expect(execute(seller, () => workflow.activate(f.contract.id))).rejects.toMatchObject({
    status: 403,
  });
  await expect(workflow.activate(f.contract.id)).rejects.toMatchObject({ status: 403 });
  const assignment = await grant(denied, ['contracts.activate'], 'FINANCE', 'ASSIGNED');
  await expect(activate(f.contract.id, denied)).rejects.toMatchObject({ status: 403 });
  await db.employeeAccessAssignment.update({
    where: { id: assignment.id },
    data: { deletedAt: new Date() },
  });
});
it('requires current independent product/customer sources at activation', async () => {
  const f = await approved();
  const user = await db.user.create({
    data: {
      name: 'Finance only',
      email: randomUUID() + '@test.invalid',
      password: 'unused',
      role: 'FINANCE_MANAGER',
      accessManaged: true,
    },
  });
  await grant(user.id, ['contracts.activate'], 'FINANCE');
  await expect(activate(f.contract.id, user.id)).rejects.toMatchObject({ status: 403 });
  await db.customer.update({ where: { id: f.customer.id }, data: { deletedAt: new Date() } });
  await expect(activate(f.contract.id)).rejects.toMatchObject({ status: 403 });
});
it('keeps activation independent of preparer revocation', async () => {
  const f = await approved();
  await db.user.update({ where: { id: seller }, data: { isActive: false } });
  try {
    await activate(f.contract.id);
  } finally {
    await db.user.update({ where: { id: seller }, data: { isActive: true } });
  }
  expect((await state(f.contract.id)).contract.status).toBe('ACTIVE');
});
it('denies non-owner maker/checker and requires reason for current owner self-approval', async () => {
  const f = await signed(owner);
  await expect(
    execute(
      owner,
      () => workflow.approveContract(f.contract.id, owner, 'OWNER'),
      'contracts.approve',
      'FINANCE',
    ),
  ).rejects.toMatchObject({ status: 400 });
  await expect(
    execute(
      owner,
      () => workflow.approveContract(f.contract.id, owner, 'OWNER', 'x'.repeat(2001)),
      'contracts.approve',
      'FINANCE',
    ),
  ).rejects.toMatchObject({ status: 400 });
  await execute(
    owner,
    () => workflow.approveContract(f.contract.id, owner, 'SALES', 'Synthetic owner review'),
    'contracts.approve',
    'FINANCE',
  );
  expect(
    await db.auditLog.count({
      where: { entityId: f.contract.id, action: 'CONTRACT_PROMOTION_OWNER_SELF_APPROVED' },
    }),
  ).toBe(1);
  const selfApproval = await db.auditLog.findFirstOrThrow({
    where: { entityId: f.contract.id, action: 'CONTRACT_PROMOTION_OWNER_SELF_APPROVED' },
  });
  expect(selfApproval.newValue).toEqual({
    makerId: owner,
    checkerId: owner,
    reason: 'Synthetic owner review',
    fingerprint: f.contract.promotionFingerprint,
  });
  const own = await signed();
  const a = await grant(seller, ['contracts.approve'], 'FINANCE');
  try {
    await expect(
      execute(
        seller,
        () => workflow.approveContract(own.contract.id, seller, 'OWNER', 'spoofed role'),
        'contracts.approve',
        'FINANCE',
      ),
    ).rejects.toMatchObject({ status: 403 });
  } finally {
    await db.employeeAccessAssignment.update({
      where: { id: a.id },
      data: { deletedAt: new Date() },
    });
  }
});
it('rejects financial/bundle edits, permits notes, and validates preparation/capturing actor', async () => {
  const f = await draft();
  await execute(
    seller,
    () => lifecycle.update(f.contract.id, { notes: 'Synthetic note' }, seller),
    'contracts.update',
  );
  await expect(
    execute(
      seller,
      () => lifecycle.update(f.contract.id, { interestRate: 0.01 }, seller),
      'contracts.update',
    ),
  ).rejects.toMatchObject({ status: 400 });
  await expect(
    execute(
      seller,
      () => lifecycle.updateBundles(f.contract.id, [], { id: seller, role: 'SALES', branchId }),
      'contracts.update',
    ),
  ).rejects.toBeDefined();
  await expect(
    execute(
      seller,
      () =>
        signatures.signContract(f.contract.id, 'synthetic', 'CUSTOMER', {}, { staffUserId: owner }),
      'contracts.update',
    ),
  ).rejects.toMatchObject({ status: 403 });
  await expect(
    execute(denied, () => lifecycle.update(f.contract.id, { notes: 'forged' }, denied)),
  ).rejects.toMatchObject({ status: 403 });
});
it('signature deletion invalidates approval and never releases the reservation', async () => {
  const f = await approved();
  await execute(
    seller,
    () => signatures.deleteSignature(f.contract.id, 'CUSTOMER'),
    'contracts.update',
  );
  await expect(activate(f.contract.id)).rejects.toBeDefined();
  expect((await state(f.contract.id)).terms.reservation?.state).toBe('RESERVED');
  expect(
    (await db.promotion.findUniqueOrThrow({ where: { id: f.promotion.id } })).currentUsageCount,
  ).toBe(1);
});
it.each(['interestRate', 'monthlyPayment', 'bundleProductIds', 'schedule'] as const)(
  'detects actual %s tampering before money',
  async (field) => {
    const f = await approved();
    if (field === 'schedule')
      await db.payment.updateMany({ where: { contractId: f.contract.id }, data: { amountDue: 1 } });
    else
      await db.contract.update({
        where: { id: f.contract.id },
        data:
          field === 'bundleProductIds' ? { bundleProductIds: [randomUUID()] } : { [field]: 0.01 },
      });
    await expect(activate(f.contract.id)).rejects.toBeDefined();
    expect((await state(f.contract.id)).sales).toBe(0);
  },
);
it('canonical owner draft cancellation releases once and reverses its down payment', async () => {
  const f = await draft();
  await expect(
    execute(seller, () => lifecycle.softDelete(f.contract.id, seller), 'contracts.update'),
  ).rejects.toMatchObject({ status: 403 });
  await execute(owner, () => lifecycle.softDelete(f.contract.id, owner), 'contracts.update');
  expect((await state(f.contract.id)).terms.reservation?.state).toBe('RELEASED');
  expect(
    (await db.promotion.findUniqueOrThrow({ where: { id: f.promotion.id } })).currentUsageCount,
  ).toBe(0);
  expect((await db.product.findUniqueOrThrow({ where: { id: f.product.id } })).status).toBe(
    'IN_STOCK',
  );
  expect(
    await db.journalEntry.count({
      where: { metadata: { path: ['flow'], equals: 'shop-down-payment-reversal' } },
    }),
  ).toBeGreaterThan(0);
  await expect(
    execute(owner, () => lifecycle.softDelete(f.contract.id, owner), 'contracts.update'),
  ).rejects.toBeDefined();
});
async function failAudit(action: string, work: () => Promise<void>) {
  await db.$executeRawUnsafe(
    `CREATE FUNCTION owned_fail_named_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action = '${action}' THEN RAISE EXCEPTION 'owned late audit failure'; END IF; RETURN NEW; END; $$`,
  );
  await db.$executeRawUnsafe(
    'CREATE TRIGGER owned_fail_named_audit BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION owned_fail_named_audit()',
  );
  try {
    await work();
  } finally {
    await db.$executeRawUnsafe('DROP TRIGGER owned_fail_named_audit ON audit_logs');
    await db.$executeRawUnsafe('DROP FUNCTION owned_fail_named_audit()');
  }
}
it('late activation audit failure rolls back all actual money, stock, Sale and proof; retry consumes once', async () => {
  const f = await approved();
  const before = await state(f.contract.id),
    calls = provider.mock.calls.length;
  await failAudit('CONTRACT_PROMOTION_APPLIED', async () => {
    await expect(activate(f.contract.id)).rejects.toBeDefined();
    expect(await state(f.contract.id)).toEqual(before);
    expect(provider).toHaveBeenCalledTimes(calls);
    expect(
      (await db.product.findUniqueOrThrow({ where: { id: f.product.id } })).ownedByCompanyId,
    ).toBe(shopId);
  });
  await activate(f.contract.id);
  expect((await state(f.contract.id)).usages).toBe(1);
});
it('reservation and release audit failures are atomic with canonical draft/reversal money', async () => {
  const f = await fixture();
  await failAudit('CONTRACT_PROMOTION_RESERVED', async () => {
    await expect(
      execute(seller, () => lifecycle.create(f.dto, seller, 'SALES', branchId)),
    ).rejects.toBeDefined();
    expect(await db.contract.count({ where: { productId: f.product.id } })).toBe(0);
    expect(
      (await db.promotion.findUniqueOrThrow({ where: { id: f.promotion.id } })).currentUsageCount,
    ).toBe(0);
  });
  const d = await draft(),
    before = await state(d.contract.id);
  await failAudit('CONTRACT_PROMOTION_RELEASED', async () => {
    await expect(
      execute(owner, () => lifecycle.softDelete(d.contract.id, owner), 'contracts.update'),
    ).rejects.toBeDefined();
    expect(await state(d.contract.id)).toEqual(before);
    expect((await db.product.findUniqueOrThrow({ where: { id: d.product.id } })).status).toBe(
      'RESERVED',
    );
  });
  await failAudit('CONTRACT_DELETE', async () => {
    await expect(
      execute(owner, () => lifecycle.softDelete(d.contract.id, owner), 'contracts.update'),
    ).rejects.toBeDefined();
    expect(await state(d.contract.id)).toEqual(before);
    expect(
      (await db.promotion.findUniqueOrThrow({ where: { id: d.promotion.id } })).currentUsageCount,
    ).toBe(1);
  });
});
it('DB rejects terms/fingerprint mutation and terminal reservation reset', async () => {
  const f = await approved();
  const terms = await db.contractPromotionTerms.findUniqueOrThrow({
    where: { contractId: f.contract.id },
  });
  await expect(
    db.contractPromotionTerms.update({ where: { id: terms.id }, data: { monthlyRate: 0.01 } }),
  ).rejects.toBeDefined();
  await expect(
    db.contract.update({ where: { id: f.contract.id }, data: { promotionFingerprint: null } }),
  ).rejects.toBeDefined();
  await activate(f.contract.id);
  await expect(
    db.contractPromotionReservation.update({
      where: { termsId: terms.id },
      data: { state: 'RESERVED' },
    }),
  ).rejects.toBeDefined();
});
it('historical rate proof requires independently current FINANCE Product and Contract reads after transfer', async () => {
  const f = await approved();
  await activate(f.contract.id);
  const sale = await db.sale.findFirstOrThrow({ where: { contractId: f.contract.id } });
  const verify = () =>
    execute(
      seller,
      () => promotions.applyToSale(f.promotion.id, sale.id, f.customer.id),
      'promotions.apply',
    );
  await expect(verify()).rejects.toMatchObject({ status: 403 });
  const productGrant = await grant(seller, ['products.read'], 'FINANCE');
  await expect(verify()).rejects.toMatchObject({ status: 403 });
  const contractGrant = await grant(seller, ['contracts.read'], 'FINANCE');
  try {
    expect((await verify()).result.status).toBe('RECORDED');
    const { result } = await execute(
      seller,
      () => promotions.findOne(f.promotion.id),
      'promotions.read',
    );
    expect(result).toMatchObject({ visibleUsageCount: 1 });
    const before = await state(f.contract.id);
    await db.promotion.update({
      where: { id: f.promotion.id },
      data: { isActive: false, endDate: new Date('2020-01-01') },
    });
    await verify();
    expect(await state(f.contract.id)).toEqual(before);
    await db.employeeAccessAssignment.update({
      where: { id: contractGrant.id },
      data: { deletedAt: new Date() },
    });
    expect(
      (await execute(seller, () => promotions.findOne(f.promotion.id), 'promotions.read')).result,
    ).toMatchObject({ visibleUsageCount: 0 });
  } finally {
    await db.employeeAccessAssignment.updateMany({
      where: { id: { in: [productGrant.id, contractGrant.id] } },
      data: { deletedAt: new Date() },
    });
  }
});
/** Hold a real competing connection until the canonical attempt is visibly waiting. */
async function changeWhileWaiting(
  change: (tx: Prisma.TransactionClient) => Promise<unknown>,
  work: () => Promise<unknown>,
) {
  let locked!: () => void, release!: () => void;
  const ready = new Promise<void>((r) => {
    locked = r;
  });
  const gate = new Promise<void>((r) => {
    release = r;
  });
  const blocker = db.$transaction(
    async (tx) => {
      await change(tx);
      locked();
      await gate;
    },
    { timeout: 15000 },
  );
  await ready;
  const result = work().then(
    (value) => ({ value, error: undefined }),
    (error) => ({ value: undefined, error }),
  );
  try {
    let waiting = false;
    for (let attempt = 0; attempt < 200; attempt++) {
      const rows = await db.$queryRaw<
        { count: bigint }[]
      >`SELECT count(*)::bigint AS count FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'`;
      if (Number(rows[0].count) > 0) {
        waiting = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 10));
    }
    expect(waiting).toBe(true);
  } finally {
    release();
    await blocker;
  }
  return result;
}
it.each([
  { isActive: false },
  { endDate: new Date('2020-01-01') },
  { currentUsageCount: 1 },
  { conditions: { minPurchase: 15000 } },
])('rechecks current campaign after actual row-lock wait: %j', async (change) => {
  const f = await fixture();
  const result = await changeWhileWaiting(
    (tx) => tx.promotion.update({ where: { id: f.promotion.id }, data: change }),
    () => execute(seller, () => lifecycle.create(f.dto, seller, 'SALES', branchId)),
  );
  expect(result.error).toBeDefined();
  expect(await db.contract.count({ where: { productId: f.product.id } })).toBe(0);
});
it('rechecks config minimum after actual row wait before reserving or collecting down', async () => {
  const f = await fixture(),
    config = await db.interestConfig.findFirstOrThrow();
  try {
    const result = await changeWhileWaiting(
      (tx) =>
        tx.interestConfig.update({ where: { id: config.id }, data: { minDownPaymentPct: 0.9 } }),
      () => execute(seller, () => lifecycle.create(f.dto, seller, 'SALES', branchId)),
    );
    expect(result.error).toBeDefined();
    expect(await db.contract.count({ where: { productId: f.product.id } })).toBe(0);
  } finally {
    await db.interestConfig.update({ where: { id: config.id }, data: { minDownPaymentPct: 0.1 } });
  }
});
it('current actor revocation wins after authority lock wait', async () => {
  const f = await fixture();
  try {
    const result = await changeWhileWaiting(
      (tx) => tx.user.update({ where: { id: seller }, data: { isActive: false } }),
      () => execute(seller, () => lifecycle.create(f.dto, seller, 'OWNER', branchId)),
    );
    expect(result.error).toBeDefined();
    expect(await db.contract.count({ where: { productId: f.product.id } })).toBe(0);
  } finally {
    await db.user.update({ where: { id: seller }, data: { isActive: true } });
  }
});
it.each(['customer', 'product', 'signature', 'schedule'] as const)(
  'rechecks %s after real activation lock wait',
  async (source) => {
    const f = await approved();
    const result = await changeWhileWaiting(
      async (tx) => {
        if (source === 'customer')
          await tx.customer.update({
            where: { id: f.customer.id },
            data: { deletedAt: new Date() },
          });
        if (source === 'product')
          await tx.product.update({
            where: { id: f.product.id },
            data: { ownedByCompanyId: financeId },
          });
        if (source === 'signature')
          await tx.signature.updateMany({
            where: { contractId: f.contract.id, signerType: 'CUSTOMER' },
            data: { deletedAt: new Date() },
          });
        if (source === 'schedule')
          await tx.payment.updateMany({
            where: { contractId: f.contract.id },
            data: { amountDue: 1 },
          });
      },
      () => activate(f.contract.id),
    );
    expect(result.error).toBeDefined();
    expect(await db.sale.count({ where: { contractId: f.contract.id } })).toBe(0);
    expect((await state(f.contract.id)).terms.reservation?.state).toBe('RESERVED');
  },
);
it('rejects exchange and preexisting Sale retrofit without consuming quota', async () => {
  const f = await approved(),
    other = await draft();
  await db.contract.update({
    where: { id: f.contract.id },
    data: { exchangedFromContractId: other.contract.id },
  });
  await expect(activate(f.contract.id)).rejects.toMatchObject({ status: 400 });
  await db.contract.update({
    where: { id: f.contract.id },
    data: { exchangedFromContractId: null },
  });
  await db.sale.create({
    data: {
      saleNumber: 'OWNED-RETROFIT',
      contractId: f.contract.id,
      saleType: 'INSTALLMENT',
      customerId: f.customer.id,
      productId: f.product.id,
      branchId,
      salespersonId: seller,
      sellingPrice: 12000,
      discount: 0,
      netAmount: 12000,
    },
  });
  await expect(activate(f.contract.id)).rejects.toMatchObject({ status: 400 });
  expect((await state(f.contract.id)).terms.reservation?.state).toBe('RESERVED');
});
it('required owner self-review audit failure rolls back workflow approval', async () => {
  const f = await signed(owner);
  await failAudit('CONTRACT_PROMOTION_OWNER_SELF_APPROVED', async () => {
    await expect(
      execute(
        owner,
        () => workflow.approveContract(f.contract.id, owner, 'OWNER', 'Synthetic reason'),
        'contracts.approve',
        'FINANCE',
      ),
    ).rejects.toBeDefined();
    expect((await state(f.contract.id)).contract.workflowStatus).toBe('PENDING_REVIEW');
  });
});
it('outer signing rollback does not create a PDF or retain the final captured signature', async () => {
  const f = await draft();
  for (const type of ['CUSTOMER', 'COMPANY', 'WITNESS_1'])
    await execute(
      seller,
      () => signatures.signContract(f.contract.id, 'synthetic', type, {}, { staffUserId: seller }),
      'contracts.update',
    );
  const calls = provider.mock.calls.length;
  await expect(
    execute(
      seller,
      async () => {
        await signatures.signContract(
          f.contract.id,
          'synthetic',
          'WITNESS_2',
          {},
          { staffUserId: seller },
        );
        throw new Error('owned outer rollback');
      },
      'contracts.update',
    ),
  ).rejects.toThrow('owned outer rollback');
  expect(provider).toHaveBeenCalledTimes(calls);
  expect(await db.signature.count({ where: { contractId: f.contract.id } })).toBe(3);
});
it('does not infer independent Customer access from the contract creator or branch', async () => {
  const f = await fixture();
  await db.tradeIn.updateMany({
    where: { customerId: f.customer.id },
    data: { deletedAt: new Date() },
  });
  await expect(
    execute(seller, () => lifecycle.create(f.dto, seller, 'SALES', branchId)),
  ).rejects.toMatchObject({ status: 403 });
});
it('does not combine promotion branch A with contract create branch B', async () => {
  const f = await fixture();
  const b = await db.branch.create({ data: { name: 'Owned unrelated', companyId: shopId } });
  const user = await db.user.create({
    data: {
      name: 'Mixed tuples',
      email: randomUUID() + '@test.invalid',
      password: 'unused',
      role: 'SALES',
      accessManaged: true,
      branchId,
    },
  });
  await grant(user.id, ['promotions.apply', 'products.read', 'customers.read']);
  const p = await db.accessPosition.create({
    data: { code: randomUUID(), name: 'Create elsewhere', permissions: ['contracts.create'] },
  });
  await db.employeeAccessAssignment.create({
    data: {
      userId: user.id,
      positionId: p.id,
      companyCode: 'SHOP',
      scope: 'BRANCHES',
      branches: { create: [{ branchId: b.id }] },
    },
  });
  await expect(
    execute(user.id, () => lifecycle.create(f.dto, user.id, 'OWNER', branchId)),
  ).rejects.toMatchObject({ status: 403 });
});

it('activates actual reserved bundle stock and preserves typed complete bundle linkage', async () => {
  const f = await signed(seller, true);
  await execute(
    finance,
    () => workflow.approveContract(f.contract.id, finance, 'FINANCE_MANAGER'),
    'contracts.approve',
    'FINANCE',
  );
  await activate(f.contract.id);
  const sale = await db.sale.findFirstOrThrow({ where: { contractId: f.contract.id } });
  expect(sale.bundleProductIds).toHaveLength(1);
  expect(
    (await db.product.findUniqueOrThrow({ where: { id: sale.bundleProductIds[0] } })).status,
  ).toBe('SOLD_CASH');
  const terms = await db.contractPromotionTerms.findUniqueOrThrow({
    where: { contractId: f.contract.id },
  });
  expect(terms.bundleProductIds).toEqual(sale.bundleProductIds);
});
it('canonical active cancellation retains consumed quota and immutable usage history', async () => {
  const f = await approved();
  await activate(f.contract.id);
  const cancellation = new ContractCancellationService(
    prisma,
    () =>
      new ContractCancellationTemplate(
        prisma,
        new ExchangeCancelReversalTemplate(journal, prisma),
        new EclStageReverseTemplate(journal, prisma),
      ),
    () => company,
  );
  // This managed fixture consumes the same immutable producer and a different
  // protected owner; direct legacy execution is no longer an authority bypass.
  const checker = await db.user.create({data:{name:'Owned cancellation checker',email:randomUUID()+'@test.invalid',
    password:'unused',role:'OWNER',accessManaged:true}});
  const request = (await execute(owner, () => cancellation.requestCancellation(
    f.contract.id, owner, 'Owned cancellation test', 0,
  ), 'sales.cancel.request', 'FINANCE')).result;
  await execute(checker.id, () => cancellation.approveCancellation(request.id, checker.id), 'sales.cancel.approve', 'FINANCE');
  const current = await state(f.contract.id);
  expect(current.contract.status).toBe('CANCELED');
  expect(current.terms.reservation?.state).toBe('CONSUMED');
  expect(current).toMatchObject({ usages: 1, benefits: 1 });
  expect(
    (await db.promotion.findUniqueOrThrow({ where: { id: f.promotion.id } })).currentUsageCount,
  ).toBe(1);
});
it('named reassignment requires current preparation and current owner for signed override', async () => {
  const f = await signed();
  await expect(
    lifecycle.updateSalesperson(f.contract.id, owner, { id: seller, role: 'OWNER' }),
  ).rejects.toMatchObject({ status: 403 });
  await expect(
    execute(
      seller,
      () => lifecycle.updateSalesperson(f.contract.id, owner, { id: seller, role: 'OWNER' }),
      'contracts.update',
    ),
  ).rejects.toMatchObject({ status: 403 });
});
it('non-named canonical drafts retain ordinary category rate and create no promotion evidence', async () => {
  const f = await fixture();
  const dto = { ...f.dto, promotionId: undefined };
  const c = await lifecycle.create(dto, seller, 'SALES', branchId);
  expect(Number(c.interestRate)).toBe(0.08);
  expect(Number(c.interestTotal)).toBe(4800);
  expect(await db.contractPromotionTerms.count({ where: { contractId: c.id } })).toBe(0);
});
it('rejects fractional baseline mismatch before canonical create rounds caller money', async () => {
  const f = await fixture();
  await expect(
    execute(seller, () =>
      lifecycle.create({ ...f.dto, sellingPrice: 12000.001 }, seller, 'SALES', branchId),
    ),
  ).rejects.toMatchObject({ status: 400 });
  expect(await db.contract.count({ where: { productId: f.product.id } })).toBe(0);
});

it.each(['SALES', 'BRANCH_MANAGER', 'FINANCE_MANAGER'] as const)(
  'R91 hides active FINANCE details and refuses forged OWNER override for current %s',
  async (role) => {
    const f = await fixture(true);
    await db.user.update({ where: { id: seller }, data: { role } });
    try {
      const failure = await execute(seller, () =>
        lifecycle.create(
          { ...f.dto, overrideActiveContractCheck: true },
          seller,
          'OWNER',
          branchId,
        ),
      ).catch((error) => error);
      expect(failure).toMatchObject({
        status: 409,
        response: { code: 'CUSTOMER_HAS_ACTIVE_CONTRACT', canOverride: false },
      });
      expect(failure.response).not.toHaveProperty('activeContracts');
      expect(JSON.stringify(failure.response)).not.toContain(f.hiddenContract!.id);
      expect(JSON.stringify(failure.response)).not.toContain(f.hiddenContract!.contractNumber);
      expect(await db.contract.count({ where: { productId: f.product.id } })).toBe(0);
    } finally {
      await db.user.update({ where: { id: seller }, data: { role: 'SALES' } });
    }
  },
);
it('R91 named trade-credit quote uses current owner authority instead of supplied legacy role', async () => {
  const f = await fixture();
  const credit = await db.tradeIn.create({
    data: {
      customerId: f.customer.id,
      branchId,
      deviceBrand: 'Apple',
      deviceModel: 'Credit',
      flow: 'EXCHANGE',
      status: 'ACCEPTED',
      agreedPrice: 2000,
      idCardVerifiedAt: new Date(),
      idCardVerifiedById: owner,
      sellerDeclarationSnapshot: { confirmed: true },
    },
  });
  await db.$transaction((tx) =>
    new TradeInCreditService(prisma).issue(
      tx,
      credit.id,
      new Prisma.Decimal(1000),
      new Prisma.Decimal(1000),
    ),
  );
  const dto = { ...f.dto, tradeInCreditId: credit.id };
  await db.user.update({ where: { id: seller }, data: { role: 'BRANCH_MANAGER' } });
  try {
    await expect(
      execute(seller, () =>
        new ContractQuoteService(prisma).resolve(dto, { id: seller, role: 'OWNER', branchId }),
      ),
    ).rejects.toMatchObject({ status: 400 });
    const { result } = await execute(owner, () =>
      new ContractQuoteService(prisma).resolve(dto, { id: owner, role: 'SALES', branchId }),
    );
    expect(result.interestRate).toBe('0.0200');
    expect(result.sellingPrice).toBe('11000.00');
    expect(result.tradeInCreditAmount).toBe('1000.00');
    expect(
      (await db.promotion.findUniqueOrThrow({ where: { id: f.promotion.id } })).currentUsageCount,
    ).toBe(0);
    expect(await db.tradeInCreditRedemption.count({ where: { tradeInId: credit.id } })).toBe(0);
  } finally {
    await db.user.update({ where: { id: seller }, data: { role: 'SALES' } });
  }
});
it('R91 current owner still needs explicit active override and damaged acknowledgment, then creates the genuine named draft', async () => {
  const f = await fixture(true);
  const failure = await execute(owner, () =>
    lifecycle.create(f.dto, owner, 'SALES', branchId),
  ).catch((error) => error);
  expect(failure).toMatchObject({ status: 409, response: { canOverride: true } });
  expect(failure.response).not.toHaveProperty('activeContracts');
  await db.product.update({ where: { id: f.product.id }, data: { wasPreviouslyDamaged: true } });
  await expect(
    execute(owner, () =>
      lifecycle.create({ ...f.dto, overrideActiveContractCheck: true }, owner, 'SALES', branchId),
    ),
  ).rejects.toMatchObject({ status: 400 });
  const { result } = await execute(owner, () =>
    lifecycle.create(
      { ...f.dto, overrideActiveContractCheck: true, previouslyDamagedAcknowledged: true },
      owner,
      'SALES',
      branchId,
    ),
  );
  expect(Number(result.interestRate)).toBe(0.02);
  expect((await state(result.id)).terms.reservation?.state).toBe('RESERVED');
});
it.each(['BRANCH_MANAGER', 'FINANCE_MANAGER'] as const)(
  'R91 current %s cannot borrow the legacy damaged-product exception',
  async (role) => {
    const f = await fixture();
    await db.product.update({ where: { id: f.product.id }, data: { wasPreviouslyDamaged: true } });
    await db.user.update({ where: { id: seller }, data: { role } });
    try {
      await expect(
        execute(seller, () =>
          lifecycle.create(
            { ...f.dto, previouslyDamagedAcknowledged: true },
            seller,
            'OWNER',
            branchId,
          ),
        ),
      ).rejects.toMatchObject({ status: 403 });
      expect(await db.contract.count({ where: { productId: f.product.id } })).toBe(0);
    } finally {
      await db.user.update({ where: { id: seller }, data: { role: 'SALES' } });
    }
  },
);

it('named rejected signed draft cannot release an unsigned-only reserved quota', async()=>{
  const f=await signed();
  await db.contract.update({where:{id:f.contract.id},data:{workflowStatus:'REJECTED'}});
  const before=await db.signature.findMany({where:{contractId:f.contract.id}});
  await expect(execute(owner,()=>lifecycle.softDelete(f.contract.id,owner),'contracts.update')).rejects.toMatchObject({status:400});
  expect((await state(f.contract.id)).terms.reservation?.state).toBe('RESERVED');
  expect((await db.promotion.findUniqueOrThrow({where:{id:f.promotion.id}})).currentUsageCount).toBe(1);
  expect(await db.signature.findMany({where:{contractId:f.contract.id}})).toEqual(before);
});
