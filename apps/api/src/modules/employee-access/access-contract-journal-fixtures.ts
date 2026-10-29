// Synthetic owned-PostgreSQL fixtures. Every JE is emitted by its canonical producer.
import {
  LEGACY_OPENING_FLOW,
  LEGACY_PRIOR_RECEIPT_FLOW,
  LEGACY_VAT_CATCHUP_FLOW,
} from '../accounting/peak-export-exclusion';
import {
  LEGACY_OPENING_TAG,
  LEGACY_PRIOR_RECEIPT_TAG,
  LEGACY_VAT_CATCHUP_TAG,
  legacyOpeningReference,
  legacyPriorReceiptReference,
  legacyVatCatchUpReference,
} from '../journal/legacy-import-journal';
import { Prisma, PrismaClient } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { JournalAutoService } from '../journal/journal-auto.service';
import { CompanyResolverService } from '../journal/company-resolver.service';
import { BadDebtProvisionTemplate } from '../journal/cpa-templates/bad-debt-provision.template';
import { EclStageReverseTemplate } from '../journal/cpa-templates/ecl-stage-reverse.template';
import { RescheduleJP6Template } from '../journal/cpa-templates/reschedule-jp6.template';
import { Vat60dayMandatoryTemplate } from '../journal/cpa-templates/vat-60day-mandatory.template';
import { Vat60dayReversalTemplate } from '../journal/cpa-templates/vat-60day-reversal.template';
import { InstallmentAccrual2ATemplate } from '../journal/cpa-templates/installment-accrual-2a.template';
import { PaymentReceiptTemplate } from '../journal/cpa-templates/payment-receipt.template';
import { ReceiptVoidReversalTemplate } from '../journal/cpa-templates/receipt-void-reversal.template';
import { ShopDownPaymentTemplate } from '../journal/cpa-templates/shop-down-payment.template';
import { ShopDownPaymentReversalTemplate } from '../journal/cpa-templates/shop-down-payment-reversal.template';
import { ShopInventoryTransferTemplate } from '../journal/cpa-templates/shop-inventory-transfer.template';

export async function journalScheduleFixtures(db: PrismaClient, contractId: string) {
  const prisma = db as PrismaService;
  const journal = new JournalAutoService(prisma);
  const schedules = await db.installmentSchedule.findMany({
    where: { contractId },
    orderBy: { installmentNo: 'asc' },
  });
  const d = (n: string | number) => new Prisma.Decimal(n);
  const reschedule = new RescheduleJP6Template(journal, prisma);
  await reschedule.recordFeeAdvance({
    contractId,
    feeAmount: d(10),
    depositAccountCode: '11-1201',
  });
  await reschedule.recordBundledPayment({
    contractId,
    installmentScheduleId: schedules[0].id,
    installmentAmount: d(100),
    feeAmount: d(10),
    depositAccountCode: '11-1201',
  });
  await reschedule.consumeAdvanceOnFinalInstallment({
    contractId,
    installmentScheduleId: schedules[1].id,
    advanceAmount: d(10),
    cashRemainder: d(90),
    depositAccountCode: '11-1201',
  });
  await new BadDebtProvisionTemplate(journal, prisma).execute({
    contractId,
    provisionAmount: d(100),
    period: '2026-10',
    runDate: '2026-10-01',
  });
  await new BadDebtProvisionTemplate(journal, prisma).execute({
    contractId,
    provisionAmount: d(-10),
    period: '2026-10',
    runDate: '2026-10-02',
  });
  await new EclStageReverseTemplate(journal, prisma).execute({
    contractId,
    reverseAmount: d(5),
    period: '2026-10',
    fromBucket: '31-60',
    toBucket: '1-30',
  });
  await new Vat60dayMandatoryTemplate(journal, prisma).execute(schedules[2].id);
  await new Vat60dayReversalTemplate(journal, prisma).execute(schedules[2].id);
  await new InstallmentAccrual2ATemplate(journal, prisma).execute(schedules[3].id);
  // Before-due partial creates the receipt-accrual grammar, completion fills the
  // entryNumber backlink; void clears it and re-accrual must remain readable.
  await db.installmentSchedule.update({
    where: { id: schedules[4].id },
    data: { dueDate: new Date('2030-01-01') },
  });
  const payment = await db.payment.findFirstOrThrow({
    where: { contractId, installmentNo: schedules[4].installmentNo },
  });
  const receipt = new PaymentReceiptTemplate(journal, prisma);
  const partial = await receipt.execute({
    installmentScheduleId: schedules[4].id,
    paymentId: payment.id,
    delta: d(100),
    debitAccountCode: '11-1201',
    postedAt: new Date('2026-10-01'),
  });
  const original = await db.journalEntry.findUniqueOrThrow({
    where: { entryNumber: partial.entryNo },
  });
  await new ReceiptVoidReversalTemplate(journal, prisma).voidReceipt(original.id, undefined, {
    flow: 'refund-reversal',
  });
  const resolver = new CompanyResolverService(prisma);
  const down = await new ShopDownPaymentTemplate(journal, prisma, resolver).execute({
    contractId,
    idempotencyKey: `down-${contractId}`,
    cashAccountCode: 'S11-1101',
    downAmount: d(2000),
  });
  await new ShopDownPaymentReversalTemplate(journal, prisma, resolver).execute({
    contractId,
    idempotencyKey: `shop-down-payment-reversal:${contractId}`,
    refundAccountCode: 'S11-1101',
    downAmount: d(2000),
    originalJournalEntryId: down.journalEntryId,
  });
  const contract = await db.contract.findUniqueOrThrow({ where: { id: contractId } });
  await new ShopInventoryTransferTemplate(journal, prisma, resolver).execute({
    contractId,
    productId: contract.productId,
    idempotencyKey: `activation-${contractId}`,
    inventoryAccountCode: 'S11-2001',
    cogsAccountCode: 'S50-1101',
    revenueAccountCode: 'S41-1101',
    costPrice: d(7777),
    salePrice: d(14000),
    downAmount: d(2000),
    financedAmount: d(12000),
    commission: d(0),
  });
  return db.journalEntry.findMany({
    where: { metadata: { path: ['contractId'], equals: contractId } },
    select: { id: true, metadata: true, companyId: true },
  });
}

import { ExchangeNewContract1ATemplate } from '../journal/cpa-templates/exchange-new-contract-1a.template';
import { ExchangeCloseOld21_1106Template } from '../journal/cpa-templates/exchange-close-old-21-1106.template';
import { ExchangeBuybackReceivable11_2107Template } from '../journal/cpa-templates/exchange-buyback-receivable-11-2107.template';
import { ExchangeEclReversalTemplate } from '../journal/cpa-templates/exchange-ecl-reversal.template';
import { ShopExchangeReturnTemplate } from '../journal/cpa-templates/shop-exchange-return.template';
import { ExchangeCancelReversalTemplate } from '../journal/cpa-templates/exchange-cancel-reversal.template';
import { TradeInCreditService } from '../trade-in/services/trade-in-credit.service';

export async function journalExchangeFixtures(
  db: PrismaClient,
  oldId: string,
  newId: string,
  userId: string,
  sweep = true,
) {
  const prisma = db as PrismaService,
    journal = new JournalAutoService(prisma),
    d = (v: number) => new Prisma.Decimal(v);
  const old = await db.contract.findUniqueOrThrow({ where: { id: oldId } });
  const next = await db.contract.update({
    where: { id: newId },
    data: { customerId: old.customerId },
  });
  const request = await db.contractExchangeRequest.create({
    data: {
      oldContractId: oldId,
      newContractId: newId,
      oldProductId: old.productId,
      newProductId: next.productId,
      requestedById: userId,
    },
  });
  const je1 = await new ExchangeNewContract1ATemplate(journal, prisma).execute(newId);
  const je2 = await new ExchangeCloseOld21_1106Template(journal, prisma).execute({
    oldContractId: oldId,
    requestId: request.id,
    buyback: d(100),
    oldGrossOutstanding: d(100),
    oldVatReceivableOutstanding: d(0),
    oldUnearnedInterestOutstanding: d(0),
    oldDeferredVatOutstanding: d(0),
  });
  const je3 = await new ExchangeBuybackReceivable11_2107Template(journal, prisma).execute({
    newContractId: newId,
    buyback: d(100),
  });
  const je4 = await new ShopExchangeReturnTemplate(
    journal,
    prisma,
    new CompanyResolverService(prisma),
  ).execute({
    oldContractId: oldId,
    oldProductId: old.productId,
    newContractId: newId,
    requestId: request.id,
    buyback: d(100),
  });
  await new BadDebtProvisionTemplate(journal, prisma).execute({
    contractId: oldId,
    provisionAmount: d(10),
    period: '2026-10',
    runDate: '2026-10-01',
  });
  const je5 = await new ExchangeEclReversalTemplate(journal, prisma).execute({
    oldContractId: oldId,
    requestId: request.id,
  });
  await db.contractExchangeRequest.update({
    where: { id: request.id },
    data: { je1aId: je1.id, je2Id: je2.id, je3Id: je3.id, je4Id: je4.id, eclReversalJeId: je5?.id },
  });
  const reversed = sweep
    ? await new ExchangeCancelReversalTemplate(journal, prisma).reverse({
        jeIds: [je2.id],
      })
    : { reversalJeIds: [] as string[] };
  await db.contractExchangeRequest.update({
    where: { id: request.id },
    data: { reversalJeIds: reversed.reversalJeIds },
  });
  return {
    request,
    oldEntries: [je2.id, je4.id, je5!.id, ...reversed.reversalJeIds],
    newEntries: [je1.id, je3.id],
  };
}

export async function journalTradeCreditFixture(
  db: PrismaClient,
  contractId: string,
  userId: string,
  sellerContactOnly = false,
) {
  const contract = await db.contract.findUniqueOrThrow({ where: { id: contractId } });
  await db.chartOfAccount.upsert({
    where: { code: 'S21-2003' },
    create: { code: 'S21-2003', name: 'เครดิตเทิร์น', type: 'หนี้สิน', normalBalance: 'Cr' },
    update: { type: 'หนี้สิน', normalBalance: 'Cr' },
  });
  const contact = sellerContactOnly
    ? await db.contact.create({
        data: { contactCode: randomUUID(), name: 'Owned seller', roles: [] },
      })
    : null;
  if (contact)
    await db.customer.update({
      where: { id: contract.customerId },
      data: { contactId: contact.id },
    });
  const trade = await db.tradeIn.create({
    data: {
      customerId: sellerContactOnly ? null : contract.customerId,
      sellerContactId: contact?.id,
      branchId: contract.branchId,
      deviceBrand: 'Test',
      deviceModel: 'Test',
      flow: 'EXCHANGE',
      status: 'ACCEPTED',
      idCardVerifiedAt: new Date(),
      idCardVerifiedById: userId,
      sellerDeclarationSnapshot: { accepted: true },
      agreedPrice: 1000,
    },
  });
  const service = new TradeInCreditService(db as PrismaService);
  await db.$transaction(async (tx) => {
    await service.issue(tx, trade.id, new Prisma.Decimal(1000), new Prisma.Decimal(0));
  });
  const snapshot = await db.$transaction((tx) =>
    service.claim(tx, {
      tradeInId: trade.id,
      customerId: contract.customerId,
      branchId: contract.branchId,
      productId: contract.productId,
      priceAfterDiscount: 12000,
      target: { contractId },
      cashAmount: 1000,
      actorId: userId,
    }),
  );
  await db.$transaction((tx) =>
    service.release(
      tx,
      snapshot as unknown as Prisma.JsonObject,
      { contractId },
      userId,
      'Synthetic release',
      true,
    ),
  );
  return db.tradeInCreditRedemption.findUniqueOrThrow({ where: { id: snapshot.redemptionId } });
}

import { randomUUID } from 'node:crypto';
import { ContractActivation1ATemplate } from '../journal/cpa-templates/contract-activation-1a.template';
import { RepossessionJP5Template } from '../journal/cpa-templates/repossession-jp5.template';
import { ShopCollectShopLegs } from '../journal/cpa-templates/shop-collect-shop-legs.template';
import { RefundPayoutTemplate } from '../journal/cpa-templates/refund-payout.template';
import { RefundWaiveTemplate } from '../journal/cpa-templates/refund-waive.template';
import { ShopCollectSettlementTemplate } from '../journal/cpa-templates/shop-collect-settlement.template';
import { InstallmentInputVatTemplate } from '../journal/cpa-templates/installment-input-vat.template';
import { BadDebtWriteOffTemplate } from '../journal/cpa-templates/bad-debt-writeoff.template';
import { EarlyPayoffJP4Template } from '../journal/cpa-templates/early-payoff-jp4.template';

export async function journalReturnFixtures(
  db: PrismaClient,
  id: string,
  userId: string,
  settle = true,
) {
  const c = await db.contract.findUniqueOrThrow({ where: { id } });
  const prisma = db as PrismaService,
    journal = new JournalAutoService(prisma),
    d = (v: number) => new Prisma.Decimal(v);
  await new ContractActivation1ATemplate(journal, prisma).execute(id);
  const repo = await db.repossession.create({
    data: {
      contractId: id,
      productId: c.productId,
      repossessedDate: new Date(),
      conditionGrade: 'A',
      appraisalPrice: 500,
      appraisedById: userId,
    },
  });
  const device = await db.deviceReturn.create({
    data: {
      contractId: id,
      productId: c.productId,
      customerId: c.customerId,
      receivingBranchId: c.branchId,
      receivedById: userId,
      docNumber: 'TEST-' + randomUUID(),
      returnKind: 'VOLUNTARY',
      returnReason: 'OTHER',
      deviceReceivedAt: new Date(),
      conditionGrade: 'A',
      appraisalPrice: 500,
      repossessionId: repo.id,
    },
  });
  await new RepossessionJP5Template(journal, prisma).execute({
    contractId: id,
    depositAccountCode: '11-2107',
    repossessionValue: d(500),
    customerRefund: d(100),
    shopReceivableType: 'DEVICE_RETURN',
    deviceReturnId: device.id,
  });
  const shop = await db.companyInfo.findUniqueOrThrow({ where: { companyCode: 'SHOP' } });
  const intake = await new ShopCollectShopLegs(journal).postRepossessionIntake({
    contractId: id,
    contractNumber: c.contractNumber,
    productId: c.productId,
    appraisal: d(500),
    shopCompanyId: shop.id,
    deviceReturnId: device.id,
  });
  await new RefundPayoutTemplate(journal, prisma).execute({
    contractId: id,
    amount: 40,
    depositAccountCode: '11-1201',
    requestId: randomUUID(),
    postedById: userId,
  });
  await new RefundWaiveTemplate(journal, prisma).execute({
    contractId: id,
    requestId: randomUUID(),
    postedById: userId,
  });
  if (settle)
    await new ShopCollectSettlementTemplate(journal, prisma).execute({
      contractId: id,
      amount: 100,
      depositAccountCode: '11-1201',
      postedById: userId,
      requestId: randomUUID(),
      typeStamp: 'DEVICE_RETURN',
    });
  return { repo, device, intake };
}
export async function journalInputVatFixture(db: PrismaClient, id: string, userId: string) {
  const c = await db.contract.findUniqueOrThrow({ where: { id } });
  const supplier = await db.supplier.create({
    data: { name: 'TEST supplier', phone: '0800000000', hasVat: true },
  });
  const po = await db.purchaseOrder.create({
    data: {
      poNumber: 'TEST-' + randomUUID(),
      supplierId: supplier.id,
      orderDate: new Date(),
      totalAmount: 1000,
      createdById: userId,
    },
  });
  const item = await db.pOItem.create({ data: { poId: po.id, quantity: 1, unitPrice: 1000 } });
  const receiving = await db.goodsReceiving.create({
    data: {
      poId: po.id,
      grNumber: 'TEST-' + randomUUID(),
      receivedById: userId,
      supplierDocType: 'TAX_INVOICE',
      supplierDocNumber: 'TEST tax',
    },
  });
  await db.goodsReceivingItem.create({
    data: {
      receivingId: receiving.id,
      poItemId: item.id,
      productId: c.productId,
      status: 'PASS',
      receivedVat: 70,
    },
  });
  const result = await new InstallmentInputVatTemplate(
    new JournalAutoService(db as PrismaService),
    db as PrismaService,
    new CompanyResolverService(db as PrismaService),
  ).execute({
    contractId: id,
    contractNumber: c.contractNumber,
    productId: c.productId,
    receivingId: receiving.id,
    grNumber: receiving.grNumber,
    amount: new Prisma.Decimal(70),
    taxInvoiceNumber: 'TEST tax',
    taxInvoiceDate: new Date(),
    postedAt: new Date(),
  });
  await db.contract.update({
    where: { id },
    data: { inputVatJournalEntryId: result!.journalEntryId, inputVatStatus: 'CLAIMED' },
  });
  return { receiving, result };
}
export async function journalWriteoffFixture(db: PrismaClient, id: string, userId: string) {
  const prisma = db as PrismaService,
    journal = new JournalAutoService(prisma);
  await new ContractActivation1ATemplate(journal, prisma).execute(id);
  const result = await new BadDebtWriteOffTemplate(journal, prisma).execute({ contractId: id });
  const c = await db.contract.findUniqueOrThrow({ where: { id } });
  await db.badDebtWriteOffAuditLog.create({
    data: {
      contractId: id,
      contractNumber: c.contractNumber,
      outstandingAmount: 1000,
      provisionAmount: 0,
      writtenOffById: userId,
      writtenOffByRole: 'OWNER',
      approvedById: userId,
      approvedByRole: 'OWNER',
    },
  });
  return result;
}
export async function journalPayoffFixture(db: PrismaClient, id: string) {
  const prisma = db as PrismaService,
    journal = new JournalAutoService(prisma);
  await new ContractActivation1ATemplate(journal, prisma).execute(id);
  await db.payment.deleteMany({ where: { contractId: id } });
  return new EarlyPayoffJP4Template(
    journal,
    prisma,
    new Vat60dayReversalTemplate(journal, prisma),
  ).execute({
    contractId: id,
    depositAccountCode: '11-1201',
    cashReceived: new Prisma.Decimal(14000),
    interestDiscountPercent: new Prisma.Decimal(0),
  });
}

import { PaymentReceiptOrchestrator } from '../payments/services/payment-receipt-orchestrator';
import { RescheduleCollectService } from '../payments/services/reschedule-collect.service';
import { RescheduleService } from '../installments/reschedule.service';
import { PaySolutionsWebhookService } from '../paysolutions/services/paysolutions-webhook.service';

// External receipt/notification/ownership adapters are inert. The actual local
// services, transaction, typed rows and JournalAuto producers run unchanged.
export async function journalDirectFixtures(
  db: PrismaClient,
  overId: string,
  rescheduleId: string,
  surplusId: string,
  userId: string,
  omitSchedule = false,
) {
  const prisma = db as PrismaService,
    journal = new JournalAutoService(prisma);
  const receipt = new PaymentReceiptTemplate(journal, prisma);
  const vat = new Vat60dayReversalTemplate(journal, prisma);
  const externalReceipts = { generateReceipt: async () => undefined } as never;
  const products = { transferOwnership: async () => undefined } as never;
  const host = { checkPromiseAfterPayment: async () => undefined } as never;
  await db.payment.updateMany({ where: { contractId: overId }, data: { amountPaid: 1200 } });
  await new PaymentReceiptOrchestrator(
    prisma,
    externalReceipts,
    {} as never,
    journal,
    products,
    {} as never,
    receipt,
    vat,
    host,
  ).autoAllocatePayment(overId, 100, 'CASH', userId);
  if (omitSchedule)
    await db.installmentSchedule.deleteMany({
      where: { contractId: rescheduleId, installmentNo: 1 },
    });
  const reschedule = new RescheduleCollectService(
    prisma,
    journal,
    new RescheduleService(prisma),
    externalReceipts,
  );
  await reschedule.executeWithCollect({
    contractId: rescheduleId,
    installmentNo: 1,
    daysToShift: 5,
    splitMode: 'SPLIT',
    amount: 10,
    paymentMethod: 'CASH',
    recordedById: userId,
    fixedQuote: { rescheduleFee: '10', lateFee: '0', collectAmount: '10' },
  });
  await db.payment.updateMany({
    where: { contractId: surplusId },
    data: { status: 'PAID', amountPaid: 1200 },
  });
  const link = await db.paymentLink.create({
    data: {
      token: randomUUID(),
      contractId: surplusId,
      amount: 100,
      expiresAt: new Date('2030-01-01'),
    },
  });
  const webhook = new PaySolutionsWebhookService(
    {} as never,
    prisma,
    {} as never,
    products,
    journal,
    receipt,
    vat,
    {} as never,
    {
      sendPaymentSuccessNotification: async () => undefined,
      sendEarlyPayoffSuccessNotification: async () => undefined,
    } as never,
  );
  await webhook.handlePaymentCallback({
    refno: link.token,
    result_code: '00',
    order_no: 'owned',
    transaction_id: 'owned',
    total: '100',
  });
  return { link };
}

import { DefectExchangeReversalTemplate } from '../journal/cpa-templates/defect-exchange-reversal.template';
import { ContractCancellationTemplate } from '../journal/cpa-templates/contract-cancellation.template';
import { IntercoSettlementService } from '../interco-settlement/interco-settlement.service';
import { IntercoPendingService } from '../interco-settlement/interco-pending.service';

export async function journalHistoryFixtures(
  db: PrismaClient,
  id: string,
  nextId: string,
  userId: string,
) {
  const prisma = db as PrismaService,
    journal = new JournalAutoService(prisma);
  const c = await db.contract.findUniqueOrThrow({ where: { id } });
  const next = await db.contract.update({
    where: { id: nextId },
    data: { parentContractId: id, customerId: c.customerId },
  });
  await new ContractActivation1ATemplate(journal, prisma).execute(id);
  await new DefectExchangeReversalTemplate(journal, prisma).reverseContract(id);
  const audit = await db.auditLog.create({
    data: {
      action: 'DEFECT_EXCHANGE',
      entity: 'contract',
      entityId: nextId,
      userId,
      newValue: {
        oldContractId: id,
        newContractId: nextId,
        oldProductId: c.productId,
        newProductId: next.productId,
      },
    },
  });
  return audit;
}
export async function journalAccrualHistoryFixtures(db: PrismaClient, id: string) {
  const prisma = db as PrismaService,
    journal = new JournalAutoService(prisma);
  const schedules = await db.installmentSchedule.findMany({
    where: { contractId: id },
    orderBy: { installmentNo: 'asc' },
  });
  await db.contract.update({
    where: { id },
    data: { advanceBalance: 100, rescheduleAdvanceBalance: 100 },
  });
  const accrual = new InstallmentAccrual2ATemplate(journal, prisma);
  await accrual.execute(schedules[0].id);
  await accrual.execute(schedules[9].id);
  await db.installmentSchedule.update({
    where: { id: schedules[1].id },
    data: { dueDate: new Date('2030-01-01') },
  });
  await db.$transaction((tx) => accrual.accrueAtReceipt(schedules[1].id, new Date(), tx));
  await db.$transaction((tx) =>
    new ReceiptVoidReversalTemplate(journal, prisma).voidAccrualPostedAtReceipt(
      schedules[1].id,
      tx,
    ),
  );
  await db.$transaction((tx) => accrual.accrueAtReceipt(schedules[1].id, new Date(), tx));
  const payment = await db.payment.findUniqueOrThrow({
    where: { contractId_installmentNo: { contractId: id, installmentNo: 3 } },
  });
  const receipt = await new PaymentReceiptTemplate(journal, prisma).execute({
    installmentScheduleId: schedules[2].id,
    paymentId: payment.id,
    delta: new Prisma.Decimal(100),
    debitAccountCode: '11-1201',
  });
  const je = await db.journalEntry.findUniqueOrThrow({ where: { entryNumber: receipt.entryNo } });
  await new ReceiptVoidReversalTemplate(journal, prisma).voidReceipt(je.id);
  return schedules;
}
export async function journalCashFixtures(
  db: PrismaClient,
  id: string,
  deviceId: string,
  legacyId: string,
  userId: string,
) {
  const prisma = db as PrismaService,
    journal = new JournalAutoService(prisma),
    resolver = new CompanyResolverService(prisma);
  const c = await db.contract.findUniqueOrThrow({ where: { id } });
  await new ContractActivation1ATemplate(journal, prisma).execute(id);
  await new ShopInventoryTransferTemplate(journal, prisma, resolver).execute({
    contractId: id,
    productId: c.productId,
    idempotencyKey: randomUUID(),
    inventoryAccountCode: 'S11-2001',
    cogsAccountCode: 'S50-1101',
    revenueAccountCode: 'S41-1101',
    costPrice: new Prisma.Decimal(7777),
    salePrice: new Prisma.Decimal(14000),
    downAmount: new Prisma.Decimal(2000),
    financedAmount: new Prisma.Decimal(12000),
    commission: new Prisma.Decimal(0),
  });
  const cancellation = await db.contractCancellation.create({
    data: {
      contractId: id,
      requestedById: userId,
      approvedById: userId,
      approvedAt: new Date(),
      reason: 'owned',
      refundAmount: 0,
      status: 'APPROVED',
    },
  });
  await new ContractCancellationTemplate(
    prisma,
    new ExchangeCancelReversalTemplate(journal, prisma),
    new EclStageReverseTemplate(journal, prisma),
  ).execute({
    contractId: id,
    cancellationId: cancellation.id,
    isC2: true,
    settledTotal: new Prisma.Decimal(12000),
    settledShopTotal: new Prisma.Decimal(12000),
  });
  const settlements = new IntercoSettlementService(
    prisma,
    new IntercoPendingService(prisma),
    {} as never,
    {} as never,
    resolver,
    journal,
    {} as never,
    new ShopCollectSettlementTemplate(journal, prisma),
  );
  const recall = await settlements.settleDeductionCash(
    id,
    'PAYOUT_RECALL',
    { amount: 100, requestId: randomUUID(), financeDepositAccountCode: '11-1201' },
    userId,
  );
  const device = await settlements.settleDeductionCash(
    deviceId,
    'DEVICE_RETURN',
    { amount: 100, requestId: randomUUID(), financeDepositAccountCode: '11-1201' },
    userId,
  );
  await new ContractActivation1ATemplate(journal, prisma).execute(legacyId);
  const legacy = await db.contract.findUniqueOrThrow({ where: { id: legacyId } });
  await db.repossession.create({
    data: {
      contractId: legacyId,
      productId: legacy.productId,
      repossessedDate: new Date(),
      conditionGrade: 'A',
      appraisalPrice: 500,
      appraisedById: userId,
    },
  });
  await new RepossessionJP5Template(journal, prisma).execute({
    contractId: legacyId,
    depositAccountCode: '11-2107',
    repossessionValue: new Prisma.Decimal(500),
    customerRefund: new Prisma.Decimal(0),
    shopReceivableType: 'SHOP_COLLECT',
  });
  const token = randomUUID();
  await new ShopCollectSettlementTemplate(journal, prisma).execute({
    contractId: legacyId,
    amount: 100,
    depositAccountCode: '11-1201',
    postedById: userId,
    requestId: token,
    typeStamp: 'SHOP_COLLECT',
  });
  const shop = await new ShopCollectShopLegs(journal).postSettlement({
    contractId: legacyId,
    amount: new Prisma.Decimal(100),
    shopCompanyId: await resolver.getShopCompanyId(),
    requestId: token,
  });
  return { cancellation, recall, device, shop };
}

import { ExchangeCancelService } from '../contract-exchange/contract-exchange-cancel.service';

export async function journalCancellationEclFixture(db: PrismaClient, id: string, userId: string) {
  const prisma = db as PrismaService,
    journal = new JournalAutoService(prisma);
  await new ContractActivation1ATemplate(journal, prisma).execute(id);
  await new BadDebtProvisionTemplate(journal, prisma).execute({
    contractId: id,
    provisionAmount: new Prisma.Decimal(100),
    period: '2026-10',
    runDate: '2026-10-01',
  });
  const cancellation = await db.contractCancellation.create({
    data: {
      contractId: id,
      requestedById: userId,
      approvedById: userId,
      approvedAt: new Date(),
      reason: 'owned ECL cancellation',
      refundAmount: 0,
      status: 'APPROVED',
    },
  });
  await new ContractCancellationTemplate(
    prisma,
    new ExchangeCancelReversalTemplate(journal, prisma),
    new EclStageReverseTemplate(journal, prisma),
  ).execute({ contractId: id, cancellationId: cancellation.id });
  const release = await db.journalEntry.findFirstOrThrow({
    where: {
      AND: [
        { metadata: { path: ['contractId'], equals: id } },
        { metadata: { path: ['fromBucket'], equals: 'CANCEL' } },
      ],
    },
  });
  return { cancellation, release };
}

export async function journalExchangeRecallFixture(
  db: PrismaClient,
  oldId: string,
  newId: string,
  userId: string,
) {
  const fixture = await journalExchangeFixtures(db, oldId, newId, userId, false);
  const prisma = db as PrismaService,
    journal = new JournalAutoService(prisma),
    resolver = new CompanyResolverService(prisma);
  const next = await db.contract.findUniqueOrThrow({ where: { id: newId } });
  await db.contract.update({
    where: { id: oldId },
    data: { status: 'EXCHANGED', exchangedAt: new Date() },
  });
  await db.product.update({
    where: { id: fixture.request.oldProductId },
    data: { status: 'REFURBISHED' },
  });
  await db.contractExchangeRequest.update({
    where: { id: fixture.request.id },
    data: { status: 'APPROVED', approvedById: userId, approvedAt: new Date() },
  });
  await new ShopInventoryTransferTemplate(journal, prisma, resolver).execute({
    contractId: newId,
    productId: next.productId,
    idempotencyKey: randomUUID(),
    inventoryAccountCode: 'S11-2001',
    cogsAccountCode: 'S50-1101',
    revenueAccountCode: 'S41-1101',
    costPrice: new Prisma.Decimal(7777),
    salePrice: new Prisma.Decimal(14000),
    downAmount: new Prisma.Decimal(2000),
    financedAmount: new Prisma.Decimal(12000),
    commission: new Prisma.Decimal(0),
  });
  // Durable prior payout snapshot, read by the actual cancellation service.
  // This fixture does not claim to execute batch approval/provider transfer.
  await db.interCoSettlementBatch.create({
    data: {
      batchNumber: 'OWNED-' + randomUUID(),
      status: 'POSTED',
      transferDate: new Date(),
      financeBankCode: '11-1201',
      shopBankCode: 'S11-1201',
      totalFinanced: 12000,
      totalCommission: 0,
      totalAmount: 12000,
      shopPostedAmount: 12000,
      makerId: userId,
      items: {
        create: {
          contractId: newId,
          financedGl: 12000,
          commissionGl: 0,
          shopFinancedGl: 12000,
          shopCommissionGl: 0,
          swapCreditAmount: 100,
        },
      },
    },
  });
  await db.user.update({ where: { id: userId }, data: { accessManaged: false } });
  await new ExchangeCancelService(
    prisma,
    { log: async () => undefined } as never,
    resolver,
    new ExchangeCancelReversalTemplate(journal, prisma),
  ).cancel(fixture.request.id, 'Owned exchange C2 cancellation', { id: userId, role: 'OWNER' });
  const settlement = await new IntercoSettlementService(
    prisma,
    new IntercoPendingService(prisma),
    {} as never,
    {} as never,
    resolver,
    journal,
    {} as never,
    new ShopCollectSettlementTemplate(journal, prisma),
  ).settleDeductionCash(
    newId,
    'PAYOUT_RECALL',
    { amount: 100, requestId: randomUUID(), financeDepositAccountCode: '11-1201' },
    userId,
  );
  const entries = await db.journalEntry.findMany({
    where: { entryNumber: { in: [settlement.financeEntryNo, settlement.shopEntryNo] } },
  });
  return { requestId: fixture.request.id, entries };
}

export async function journalClearedExchangeHistoryFixture(
  db: PrismaClient,
  oldId: string,
  newId: string,
  userId: string,
) {
  const fixture = await journalExchangeFixtures(db, oldId, newId, userId, false);
  const prisma = db as PrismaService,
    journal = new JournalAutoService(prisma);
  const schedule = await db.installmentSchedule.findFirstOrThrow({ where: { contractId: oldId } });
  await new InstallmentAccrual2ATemplate(journal, prisma).execute(schedule.id);
  const refreshed = await db.installmentSchedule.findUniqueOrThrow({ where: { id: schedule.id } });
  const original = await db.journalEntry.findUniqueOrThrow({
    where: { entryNumber: refreshed.accrualJournalEntryId! },
  });
  const reversed = await new ExchangeCancelReversalTemplate(journal, prisma).reverse({
    jeIds: [original.id],
  });
  await db.contractExchangeRequest.update({
    where: { id: fixture.request.id },
    data: { reversalJeIds: reversed.reversalJeIds },
  });
  // Deliberate retained-history shape: actual canonical pair, missing completing
  // link. This is a read-proof negative fixture, not a claim that the exchange
  // cancellation service keeps schedules live or clears this field itself.
  await db.installmentSchedule.update({
    where: { id: schedule.id },
    data: { accrualJournalEntryId: null },
  });
  return { request: fixture.request, original, reversalId: reversed.reversalJeIds[0] };
}

/**
 * รายการบัญชีสามชนิดของตัวนำเข้าระบบเก่า (`cli/legacy-backoffice/writer.ts`) — tag/flow/reference/metadata ชุดเดียวกับที่
 * ตัวเขียนลง (ตัวเขียนใช้ `legacy-import-journal.ts` + flow จาก `peak-export-exclusion.ts` และ `writer.db.spec.ts` ปักรูปเต็ม)
 * · ยอดเป็นตัวเลขสังเคราะห์ที่ดุล (การพิสูจน์ดูเฉพาะตัวตน ไม่ดูยอด)
 */
export async function journalLegacyImportFixture(db: PrismaClient, id: string, legacyCode: string) {
  const journal = new JournalAutoService(db as PrismaService);
  const d = (n: number) => new Prisma.Decimal(n);
  const zero = d(0);
  const importBatch = 'legacy-fixture';
  const schedule = await db.installmentSchedule.findFirstOrThrow({
    where: { contractId: id, installmentNo: 3 },
  });
  const cutoff = new Date('2026-11-30T23:59:59+07:00');
  const opening = await journal.createAndPost({
    description: 'legacy opening',
    reference: legacyOpeningReference(legacyCode),
    metadata: {
      tag: LEGACY_OPENING_TAG,
      flow: LEGACY_OPENING_FLOW,
      idempotencyKey: legacyCode,
      contractId: id,
      importBatch,
    },
    postedAt: cutoff,
    lines: [
      { accountCode: '11-2101', dr: d(1000), cr: zero },
      { accountCode: '32-1101', dr: zero, cr: d(1000) },
    ],
  });
  const marker = await journal.createAndPost({
    description: 'legacy prior receipt',
    reference: legacyPriorReceiptReference(schedule.id),
    metadata: {
      tag: LEGACY_PRIOR_RECEIPT_TAG,
      flow: LEGACY_PRIOR_RECEIPT_FLOW,
      contractId: id,
      installmentScheduleId: schedule.id,
      importBatch,
    },
    postedAt: cutoff,
    lines: [
      { accountCode: '32-1101', dr: d(100), cr: zero },
      { accountCode: '11-2103', dr: zero, cr: d(100) },
    ],
  });
  const catchUp = await journal.createAndPost({
    description: 'legacy VAT catch-up',
    reference: legacyVatCatchUpReference(legacyCode),
    metadata: {
      tag: LEGACY_VAT_CATCHUP_TAG,
      flow: LEGACY_VAT_CATCHUP_FLOW,
      contractId: id,
      importBatch,
    },
    postedAt: new Date('2026-12-01T00:05:00+07:00'),
    lines: [
      { accountCode: '21-2102', dr: d(7), cr: zero },
      { accountCode: '21-2101', dr: zero, cr: d(7) },
    ],
  });
  return { opening, marker, catchUp };
}
