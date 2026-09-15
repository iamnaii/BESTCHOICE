import { ContractQuoteService } from '../src/modules/contracts/services/contract-quote.service';
import { SalesQueryService } from '../src/modules/sales/services/sales-query.service';
import { CustomerPiiService } from '../src/modules/customers/customer-pii.service';
import { TransactionalReportService } from '../src/modules/accounting/transactional-report.service';
import { ConfigService } from '@nestjs/config';
import { TRADE_IN_DECLARATION_VERSION } from '@installment/shared';
import { TradeInService } from '../src/modules/trade-in/trade-in.service';
import { TradeInCreditService } from '../src/modules/trade-in/services/trade-in-credit.service';
import { tradeInProviders } from './support/trade-in-fixture';
import { SaleCreationService } from '../src/modules/sales/services/sale-creation.service';
import { SaleWriterService } from '../src/modules/sales/services/sale-writer.service';
import { SaleVoidService } from '../src/modules/sales/services/sale-void.service';
import { InterCompanyService } from '../src/modules/inter-company/inter-company.service';
import { ShopCashSaleTemplate } from '../src/modules/journal/cpa-templates/shop-cash-sale.template';
import { ShopExternalFinanceSaleTemplate } from '../src/modules/journal/cpa-templates/shop-external-finance-sale.template';
import { ExchangeCancelReversalTemplate } from '../src/modules/journal/cpa-templates/exchange-cancel-reversal.template';
import { ContractCancellationTemplate } from '../src/modules/journal/cpa-templates/contract-cancellation.template';
import { ContractCancellationService } from '../src/modules/contracts/services/contract-cancellation.service';
import { Decimal } from '@prisma/client/runtime/library';
import { createHash, randomUUID } from 'node:crypto';
import { PrismaService } from '../src/prisma/prisma.service';
import { seedFinanceCoa } from '../prisma/seed-coa-finance';
import { seedShopCoa } from '../prisma/seed-coa-shop';
import { CreditCheckService } from '../src/modules/credit-check/credit-check.service';
import { IntegrationConfigService } from '../src/modules/integrations/integration-config.service';
import { AiUsageService } from '../src/modules/ai-usage/ai-usage.service';
import { AiProviderService } from '../src/modules/ai-usage/ai-provider.service';
import { ContractLifecycleService } from '../src/modules/contracts/services/contract-lifecycle.service';
import { ContractQueryService } from '../src/modules/contracts/services/contract-query.service';
import { ContractSignatureService } from '../src/modules/contracts/services/contract-signature.service';
import { ContractWorkflowService } from '../src/modules/contracts/contract-workflow.service';
import { AuditService } from '../src/modules/audit/audit.service';
import { ProductsService } from '../src/modules/products/products.service';
import { PaymentsService } from '../src/modules/payments/payments.service';
import { ReceiptsService } from '../src/modules/receipts/receipts.service';
import { CreditNoteDocumentService } from '../src/modules/receipts/services/credit-note-document.service';
import { BadDebtService } from '../src/modules/accounting/bad-debt.service';
import { ConsecutiveMissedService } from '../src/modules/overdue/consecutive-missed.service';
import { JournalAutoService } from '../src/modules/journal/journal-auto.service';
import { CompanyResolverService } from '../src/modules/journal/company-resolver.service';
import { ShopAccountResolver } from '../src/modules/journal/shop-account-resolver.service';
import { ContractActivation1ATemplate } from '../src/modules/journal/cpa-templates/contract-activation-1a.template';
import { ShopInventoryTransferTemplate } from '../src/modules/journal/cpa-templates/shop-inventory-transfer.template';
import { ShopDownPaymentTemplate } from '../src/modules/journal/cpa-templates/shop-down-payment.template';
import { ShopDownPaymentReversalTemplate } from '../src/modules/journal/cpa-templates/shop-down-payment-reversal.template';
import { InstallmentAccrual2ATemplate } from '../src/modules/journal/cpa-templates/installment-accrual-2a.template';
import { PaymentReceiptTemplate } from '../src/modules/journal/cpa-templates/payment-receipt.template';
import { Vat60dayReversalTemplate } from '../src/modules/journal/cpa-templates/vat-60day-reversal.template';
import { ReceiptVoidReversalTemplate } from '../src/modules/journal/cpa-templates/receipt-void-reversal.template';
import { BadDebtProvisionTemplate } from '../src/modules/journal/cpa-templates/bad-debt-provision.template';
import { BadDebtWriteOffTemplate } from '../src/modules/journal/cpa-templates/bad-debt-writeoff.template';
import { EclStageReverseTemplate } from '../src/modules/journal/cpa-templates/ecl-stage-reverse.template';

if (!process.env.DATABASE_URL?.includes('/bc_chat_credit_test?host=/tmp/bc-chat-credit.')) {
  throw new Error('Only the disposable tools/test-chat-credit.sh database is allowed');
}
const db = new PrismaService();
const originalEnv = { node: process.env.NODE_ENV, rate: process.env.USE_NEW_RATE_LOOKUP, salt: process.env.PII_HASH_SALT };
const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1xkAAAAASUVORK5CYII=';
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const readEntries = (contractId: string) => db.journalEntry.findMany({
  where: { deletedAt: null, metadata: { path: ['contractId'], equals: contractId } }, include: { lines: true },
});
type Entry = Awaited<ReturnType<typeof readEntries>>[number];
const tag = (entry: Entry) => (entry.metadata as Record<string, unknown> | null)?.tag;
const sum = (entries: Entry[], account: string, side: 'debit' | 'credit') => entries.flatMap(entry => entry.lines)
  .filter(line => line.accountCode === account).reduce((total, line) => total.plus(line[side]), new Decimal(0));

describe('approved credit → real create/sign/activate → partial/complete payment → ledger', () => {
  let ownerId: string, branchId: string, shopId: string, financeId: string;
  let credits: CreditCheckService, lifecycle: ContractLifecycleService, signatures: ContractSignatureService;
  let workflow: ContractWorkflowService, payments: PaymentsService, accrual: InstallmentAccrual2ATemplate;
  let tradeIns: TradeInService, tradeCredits: TradeInCreditService, sales: SaleCreationService;
  let saleVoid: SaleVoidService, cancellations: ContractCancellationService;
  const pdfJobs: Promise<unknown>[] = [];
  beforeAll(async () => {
    process.env.NODE_ENV = 'production'; // Exercise production workflow gates in the isolated DB.
    process.env.USE_NEW_RATE_LOOKUP = 'false';
    process.env.PII_HASH_SALT = 'isolated-trade-credit-test-salt-00000000000000000000000000000000';
    await db.$connect();
    await seedFinanceCoa(db); await seedShopCoa(db);
    ownerId = (await db.user.upsert({ where: { email: 'admin@bestchoice.com' },
      create: { email: 'admin@bestchoice.com', password: 'unused', name: 'ISOLATED OWNER', role: 'OWNER', accessibleCompanies: ['SHOP', 'FINANCE'], primaryCompany: 'SHOP' },
      update: { role: 'OWNER', isActive: true, deletedAt: null, accessibleCompanies: ['SHOP', 'FINANCE'], primaryCompany: 'SHOP' } })).id;
    for (const companyCode of ['SHOP', 'FINANCE']) {
      const company = await db.companyInfo.upsert({ where: { companyCode }, create: {
        companyCode, nameTh: `ISOLATED ${companyCode}`, taxId: companyCode === 'SHOP' ? '9999999999996' : '9999999999997',
        address: '1 Synthetic Road', directorName: 'Synthetic Director', vatRegistered: true, vatRate: '0.0700',
      }, update: { vatRegistered: true, vatRate: '0.0700', deletedAt: null, isActive: true } });
      if (companyCode === 'SHOP') shopId = company.id; else financeId = company.id;
    }
    branchId = (await db.branch.create({ data: { name: `ISOLATED CREDIT ${randomUUID()}`, companyId: shopId, shopCashAccountCode: 'S11-1101' } })).id;
    await db.interestConfig.create({ data: { name: 'ISOLATED CREDIT 5% × 12', productCategories: ['ACCESSORY'],
      interestRate: '0.0500', minDownPaymentPct: '0.2000', storeCommissionPct: '0.1000', vatPct: '0.0700',
      minInstallmentMonths: 6, maxInstallmentMonths: 12 } });
    const journal = new JournalAutoService(db), resolver = new CompanyResolverService(db);
    const shopAccounts = new ShopAccountResolver(db), audit = new AuditService(db), products = new ProductsService(db);
    const interco = new InterCompanyService(db);
    sales = new SaleCreationService(db, new SaleWriterService(db, interco, new ShopCashSaleTemplate(journal, db, resolver),
      shopAccounts, new ShopExternalFinanceSaleTemplate(journal, db, resolver), new ShopDownPaymentTemplate(journal, db, resolver)), interco, { notify: async () => undefined } as never);
    const sweep = new ExchangeCancelReversalTemplate(journal, db);
    saleVoid = new SaleVoidService(db, sweep);
    cancellations = new ContractCancellationService(db,
      () => new ContractCancellationTemplate(db, sweep, new EclStageReverseTemplate(journal, db)), () => resolver);
    tradeIns = tradeInProviders(db, { upload: async () => 'synthetic://photo' } as never)
      .find((p): p is { provide: typeof TradeInService; useValue: TradeInService } => typeof p === 'object' && p.provide === TradeInService)!.useValue;
    tradeCredits = new TradeInCreditService(db);
    const down = new ShopDownPaymentTemplate(journal, db, resolver);
    lifecycle = new ContractLifecycleService(db, new ContractQueryService(db), down,
      new ShopDownPaymentReversalTemplate(journal, db, resolver), shopAccounts, undefined, audit);
    const config = new ConfigService({});
    credits = new CreditCheckService(db, new IntegrationConfigService(db, config), new AiProviderService(new AiUsageService(db, config)));
    // Only PDF generation/storage and external notifications are substituted.
    // Real signature persistence and integrity verification still execute.
    signatures = new ContractSignatureService(db, () => ({
      ensureSignedContractDocument: (contractId: string, uploadedById: string) => {
        const job = db.contractDocument.create({ data: { contractId, uploadedById, documentType: 'SIGNED_CONTRACT',
          fileName: 'synthetic-signed.pdf', fileUrl: 'synthetic://signed.pdf', mimeType: 'application/pdf', fileHash: hash(contractId) } });
        pdfJobs.push(job); return job;
      },
    }) as never);
    workflow = new ContractWorkflowService(db, null as never, journal, new ContractActivation1ATemplate(journal, db),
      products, null as never, new ShopInventoryTransferTemplate(journal, db, resolver), down, shopAccounts);
    const receipts = new ReceiptsService(db, journal, new ReceiptVoidReversalTemplate(journal, db), undefined);
    const badDebt = new BadDebtService(db, journal, new BadDebtProvisionTemplate(journal, db),
      new BadDebtWriteOffTemplate(journal, db), new EclStageReverseTemplate(journal, db),
      new ConsecutiveMissedService(db), new CreditNoteDocumentService(db), { deliver: async () => ({ delivered: true }) } as never);
    payments = new PaymentsService(db, receipts, audit, journal, products,
      { sendFlexMessage: async () => undefined } as never, { paymentReceipt: () => ({}) } as never,
      { afterPayment: () => [] } as never, badDebt, new PaymentReceiptTemplate(journal, db), new Vat60dayReversalTemplate(journal, db));
    accrual = new InstallmentAccrual2ATemplate(journal, db);
  }, 120_000);
  afterAll(async () => {
    jest.useRealTimers();
    if (originalEnv.node === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = originalEnv.node;
    if (originalEnv.rate === undefined) delete process.env.USE_NEW_RATE_LOOKUP; else process.env.USE_NEW_RATE_LOOKUP = originalEnv.rate;
    if (originalEnv.salt === undefined) delete process.env.PII_HASH_SALT; else process.env.PII_HASH_SALT = originalEnv.salt;
    await Promise.all(pdfJobs); await db.$disconnect(); // Parent runner destroys this entire database.
  });
  beforeEach(() => jest.useRealTimers());

  async function exchangeCase() {
    const prefix = `0${String(Math.floor(Math.random() * 1e11)).padStart(11, '0')}`;
    const nationalId = prefix + (11 - [...prefix].reduce((s, n, i) => s + Number(n) * (13 - i), 0) % 11) % 10;
    const customer = await db.customer.create({ data: { name: 'ISOLATED EXCHANGE CUSTOMER', nationalId, nationalIdHash: new CustomerPiiService(db).hash(nationalId),
      phone: '0000000000', birthDate: new Date('1990-01-01'), addressIdCard: '1 Synthetic Road', addressCurrent: '1 Synthetic Road',
      references: [{ firstName: 'Synthetic', lastName: 'Reference', phone: '0000000001', relationship: 'เพื่อน' }], salary: 30000, salaryPayDay: 25 } });
    const product = await db.product.create({ data: { name: 'ISOLATED NEW DEVICE', brand: 'SYNTHETIC', model: 'TRADE-CREDIT', category: 'ACCESSORY',
      imeiSerial: `SYNTHETIC-${randomUUID()}`, branchId, ownedByCompanyId: shopId, costPrice: 6000, status: 'IN_STOCK' } });
    const intake = await tradeIns.create({ customerId: customer.id, branchId, deviceBrand: 'SYNTHETIC', deviceModel: 'OLD DEVICE',
      sellerName: customer.name, sellerPhone: customer.phone ?? undefined, sellerIdCardNumber: nationalId, sellerAddress: '1 Synthetic Road',
      serialNumber: `SN-${randomUUID()}`, imeiMissingReason: 'Synthetic device without cellular radio' });
    await db.tradeIn.update({ where: { id: intake.id }, data: { status: 'APPRAISED', offeredPrice: 5500,
      quoteBreakdown: { cashPrice: '5000', exchangePrice: '5500' } } });
    await tradeIns.accept(intake.id, { idCardVerified: true, sellerConsentSigned: true,
      declarationVersion: TRADE_IN_DECLARATION_VERSION, sellerSignatureBase64: image, paymentMethod: 'TRADE_IN_CREDIT' }, ownerId);
    return { customer, product, intake,
      dto: { customerId: customer.id, productId: product.id, branchId, sellingPrice: 15000, tradeInCreditId: intake.id,
        downPayment: 2000, totalMonths: 12, paymentDueDay: 25, paymentMethod: 'CASH' } };
  }

  async function approve(customerId: string) {
    const check = await db.creditCheck.create({ data: { customerId, checkType: 'FULL', status: 'MANUAL_REVIEW',
      statementFiles: ['synthetic.pdf'], aiAnalysis: { monthlyIncome: 30000, monthlyExpense: 10000 } } });
    const basis = { verifiedMonthlyIncome: 30000, livingExpenses: 10000, externalMonthlyDebt: 0, salaryPayDay: 25,
      evidenceNotes: 'หลักฐานจำลองสำหรับทดสอบการนำเครดิตเครื่องเทิร์นมาใช้ซื้อสินค้า' };
    const preview = await credits.override_.approval.preview(check.id, basis, { id: ownerId, role: 'OWNER' });
    await credits.overrideById(check.id, { status: 'APPROVED', overrideReason: 'ตรวจสอบหลักฐานจำลองครบแล้วสำหรับทดสอบเครดิตเทิร์น',
      affordability: { ...basis, contextToken: preview.contextToken, approvedMonthlyPayment: 2000, confirmed: true } }, ownerId, 'OWNER');
  }

  async function activate(contractId: string, customerId: string) {
    const consent = await db.pDPAConsent.create({ data: { customerId, consentVersion: 'SYNTHETIC-1', privacyNoticeText: 'Synthetic consent', status: 'GRANTED', grantedAt: new Date(), purposes: ['CONTRACT'] } });
    await db.contract.update({ where: { id: contractId }, data: { pdpaConsentId: consent.id } });
    await db.contractDocument.createMany({ data: (['ID_CARD_COPY', 'KYC_SELFIE', 'DEVICE_PHOTO'] as const).map(documentType => ({
      contractId, documentType, uploadedById: ownerId, fileName: `${documentType}.png`, fileUrl: `synthetic://${documentType}.png`, fileHash: hash(documentType) })) });
    for (const signerType of ['CUSTOMER', 'COMPANY', 'WITNESS_1', 'WITNESS_2']) await signatures.signContract(contractId, image, signerType,
      { ip: '127.0.0.1', userAgent: 'isolated-jest' }, { signerName: `Synthetic ${signerType}`, staffUserId: ownerId });
    await Promise.all(pdfJobs);
    await workflow.submitForReview(contractId, ownerId, 'OWNER');
    await workflow.approveContract(contractId, ownerId, 'OWNER', 'Synthetic approval');
    await workflow.activate(contractId);
  }

  it('uses base value as cash-sale tender, bonus once, then restores credit on void', async () => {
    const c = await exchangeCase();
    const sale = await sales.create({ ...c.dto, saleType: 'CASH', amountReceived: 9500 }, ownerId, 'OWNER');
    const stored = await db.sale.findUniqueOrThrow({ where: { id: sale.id } });
    expect(stored.netAmount.toNumber()).toBe(14500); expect(stored.amountReceived?.toNumber()).toBe(9500);
    expect(stored.discount.toNumber()).toBe(500);
    const entries = await db.journalEntry.findMany({ where: { metadata: { path: ['saleId'], equals: sale.id } }, include: { lines: true } });
    expect(sum(entries, 'S11-1101', 'debit').minus(sum(entries, 'S11-1101', 'credit')).toNumber()).toBe(9500);
    expect(await tradeCredits.available(c.customer.id, branchId)).toEqual([]);
    await saleVoid.voidSale(sale.id, { id: ownerId, role: 'OWNER', branchId: null }, 'Synthetic void trade credit');
    expect((await tradeCredits.available(c.customer.id, branchId)).map((x) => x.id)).toContain(c.intake.id);
    const source = await db.tradeIn.findUniqueOrThrow({ where: { id: c.intake.id } });
    expect(source.currentRedemptionId).toBeNull();
    expect((await db.journalEntry.findUniqueOrThrow({ where: { id: source.creditIssueJournalId! } })).metadata).not.toMatchObject({ reversed: true });
    await sales.create({ ...c.dto, saleType: 'CASH', amountReceived: 9500 }, ownerId, 'OWNER');
    expect(await db.tradeInCreditRedemption.count({ where: { tradeInId: c.intake.id } })).toBe(2);
  });

  it('persists exactly the quoted amounts and Bangkok schedule without claiming on quote', async () => {
    const c = await exchangeCase(); await approve(c.customer.id);
    const actor = { id: ownerId, role: 'OWNER' };
    const resolver = new ContractQuoteService(db);
    const before = await db.tradeInCreditRedemption.count({ where: { tradeInId: c.intake.id } });
    const quote = await resolver.resolve(c.dto, actor);
    expect(await db.tradeInCreditRedemption.count({ where: { tradeInId: c.intake.id } })).toBe(before);
    expect((await db.product.findUniqueOrThrow({ where: { id: c.product.id } })).status).toBe('IN_STOCK');
    const created = await lifecycle.create({ ...c.dto, quoteFingerprint: quote.fingerprint, downPaymentMethod: 'BANK_TRANSFER',
      downPaymentReference: 'SYNTHETIC-QUOTE-RECEIPT' }, ownerId, 'OWNER');
    const stored = await db.contract.findUniqueOrThrow({ where: { id: created.id }, include: { payments: { orderBy: { installmentNo: 'asc' } } } });
    expect(stored.financedAmount.toFixed(2)).toBe(quote.principal);
    expect(stored.vatAmount!.toFixed(2)).toBe(quote.vatAmount);
    expect(stored.interestTotal.toFixed(2)).toBe(quote.interestTotal);
    expect(stored.payments.map(row => ({ amount: row.amountDue.toFixed(2), date: row.dueDate.toISOString() })))
      .toEqual(quote.schedule.map(row => ({ amount: row.amountDue, date: row.dueDate })));
    expect(stored.downPaymentMethod).toBe('BANK_TRANSFER');
    expect(stored.downPaymentReference).toBe('SYNTHETIC-QUOTE-RECEIPT');
    const paymentIds = stored.payments.map(row => row.id);
    await lifecycle.update(created.id, { notes: 'SYNTHETIC note without receiving again' }, ownerId);
    const after = await db.contract.findUniqueOrThrow({ where: { id: created.id }, include: { payments: { orderBy: { installmentNo: 'asc' } } } });
    expect(after.payments.map(row => row.id)).toEqual(paymentIds);
    expect(after.downPaymentReceivedAt).toEqual(stored.downPaymentReceivedAt);
    expect(sum(await readEntries(created.id), 'S11-1201', 'debit').toNumber()).toBe(2000);
    await lifecycle.softDelete(created.id, ownerId);
    expect(sum(await readEntries(created.id), 'S11-1201', 'credit').toNumber()).toBe(2000);
    expect(sum(await readEntries(created.id), 'S11-1101', 'credit').toNumber()).toBe(0);
  });

  it('rejects a stale fingerprint before stock, credit, contract or money writes', async () => {
    const c = await exchangeCase(); await approve(c.customer.id);
    const resolver = new ContractQuoteService(db), actor = { id: ownerId, role: 'OWNER' };
    const quote = await resolver.resolve(c.dto, actor);
    const company = await db.companyInfo.findUniqueOrThrow({ where: { id: shopId } });
    try {
      await db.companyInfo.update({ where: { id: shopId }, data: { vatRegistered: !company.vatRegistered } });
      await expect(lifecycle.create({ ...c.dto, quoteFingerprint: quote.fingerprint }, ownerId, 'OWNER'))
        .rejects.toMatchObject({ response: { code: 'CONTRACT_QUOTE_CHANGED', quote: { fingerprint: expect.any(String) } } });
      expect(await db.contract.count({ where: { customerId: c.customer.id } })).toBe(0);
      expect(await db.tradeInCreditRedemption.count({ where: { tradeInId: c.intake.id } })).toBe(0);
      expect((await db.product.findUniqueOrThrow({ where: { id: c.product.id } })).status).toBe('IN_STOCK');
      expect(await db.creditApproval.count({ where: { creditCheck: { customerId: c.customer.id }, usedByContractId: { not: null } } })).toBe(0);
    } finally { await db.companyInfo.update({ where: { id: shopId }, data: { vatRegistered: company.vatRegistered } }); }
  });

  it.each(['direct', 'pos'])('carries bank-transfer receipts through %s activation exactly once', async path => {
    const c = await exchangeCase(); await approve(c.customer.id);
    const created = path === 'direct' ? await lifecycle.create({ ...c.dto, downPaymentMethod: 'BANK_TRANSFER', downPaymentReference: 'SYNTHETIC-BANK' }, ownerId, 'OWNER')
      : await sales.create({ ...c.dto, saleType: 'INSTALLMENT', paymentMethod: 'BANK_TRANSFER', downPaymentReference: 'SYNTHETIC-BANK' }, ownerId, 'OWNER');
    const contractId = path === 'direct' ? created.id : (await db.sale.findUniqueOrThrow({ where: { id: created.id } })).contractId!;
    const query = new SalesQueryService(db), actor = { id: ownerId, role: 'OWNER' };
    const draftRows = await query.findAll({ contractStatus: 'DRAFT', branchId }, actor);
    if (path === 'pos') expect(draftRows.data.map(row => row.id)).toContain(created.id);
    expect((await query.findAll({ branchId }, actor)).data.map(row => row.contractId)).not.toContain(contractId);
    expect(sum(await readEntries(contractId), 'S11-1201', 'debit').toNumber()).toBe(2000);
    await activate(contractId, c.customer.id);
    const sale = await db.sale.findFirstOrThrow({ where: { contractId, deletedAt: null } });
    if (path === 'pos') expect(sale.id).toBe(created.id);
    expect(sale.paymentMethod).toBe('BANK_TRANSFER'); expect(sale.amountReceived!.toNumber()).toBe(2000);
    expect((await db.saleCostSnapshot.findUniqueOrThrow({ where: { saleId: sale.id } })).mainProductCost.toNumber()).toBe(6000);
    await db.product.update({ where: { id: c.product.id }, data: { costPrice: 6999 } });
    expect(String((await query.findOne(sale.id, actor)).costPriceSnapshot)).toBe('6000');
    expect((await db.contract.findUniqueOrThrow({ where: { id: contractId } })).downPaymentReference).toBe('SYNTHETIC-BANK');
    expect(await db.sale.count({ where: { contractId, deletedAt: null } })).toBe(1);
    expect(sum(await readEntries(contractId), 'S11-1201', 'debit').toNumber()).toBe(2000);
    expect(sum(await readEntries(contractId), 'S11-1101', 'debit').toNumber()).toBe(0);
  });

  it.each(['direct', 'pos'])('keeps cash down separate through %s installment creation, activation and cancellation', async (path) => {
    const c = await exchangeCase(); await approve(c.customer.id);
    const created = path === 'direct' ? await lifecycle.create(c.dto, ownerId, 'OWNER')
      : await sales.create({ ...c.dto, saleType: 'INSTALLMENT' }, ownerId, 'OWNER');
    const contractId = path === 'direct' ? created.id : (await db.sale.findUniqueOrThrow({ where: { id: created.id } })).contractId!;
    const stored = await db.contract.findUniqueOrThrow({ where: { id: contractId } });
    expect(stored.downPayment.toNumber()).toBe(7000); expect(stored.sellingPrice.toNumber()).toBe(14500);
    expect(stored.financedAmount.toNumber()).toBe(7500);
    await activate(contractId, c.customer.id);
    const entries = await readEntries(contractId);
    expect(sum(entries, 'S11-1101', 'debit').toNumber()).toBe(2000);
    expect(sum(entries, 'S21-2001', 'credit').minus(sum(entries, 'S21-2001', 'debit')).toNumber()).toBe(0);
    expect(await db.sale.count({ where: { contractId, deletedAt: null } })).toBe(1);
    const cancellation = await cancellations.requestCancellation(contractId, ownerId, 'Synthetic trade credit cancellation', 0);
    await cancellations.approveCancellation(cancellation.id, ownerId);
    expect(await db.sale.count({ where: { contractId, deletedAt: null } })).toBe(0);
    expect(await db.financeReceivable.count({ where: { sale: { contractId }, deletedAt: null } })).toBe(0);
    expect((await tradeCredits.available(c.customer.id, branchId)).map((x) => x.id)).toContain(c.intake.id);
    const after = await readEntries(contractId);
    expect(sum(after, 'S21-2001', 'credit').minus(sum(after, 'S21-2001', 'debit')).toNumber()).toBe(2000);
  });

  it.each(['direct', 'pos'])('returns credit and only actual cash when deleting an unsigned %s draft', async (path) => {
    const c = await exchangeCase(); await approve(c.customer.id);
    const created = path === 'direct' ? await lifecycle.create(c.dto, ownerId, 'OWNER') : await sales.create({ ...c.dto, saleType: 'INSTALLMENT' }, ownerId, 'OWNER');
    const contract = path === 'direct' ? created : { id: (await db.sale.findUniqueOrThrow({ where: { id: created.id } })).contractId! };
    await lifecycle.softDelete(contract.id, ownerId);
    expect((await tradeCredits.available(c.customer.id, branchId)).map((x) => x.id)).toContain(c.intake.id);
    const entries = await readEntries(contract.id);
    expect(sum(entries, 'S11-1101', 'debit').toNumber()).toBe(2000);
    expect(sum(entries, 'S11-1101', 'credit').toNumber()).toBe(2000);
    expect(await db.sale.count({ where: { contractId: contract.id, deletedAt: null } })).toBe(0);
    expect(await db.financeReceivable.count({ where: { sale: { contractId: contract.id }, deletedAt: null } })).toBe(0);
    expect(await db.salesCommission.count({ where: { contractId: contract.id, status: { not: 'CLAWED_BACK' }, deletedAt: null } })).toBe(0);
    expect(await db.interCompanyTransaction.count({ where: { contractId: contract.id, deletedAt: null } })).toBe(0);
  });

  it('accepts satang prices without false credit re-quote failures', async () => {
    const c = await exchangeCase();
    const sale = await sales.create({ ...c.dto, saleType: 'CASH', sellingPrice: 15000.11, discount: 0.22, amountReceived: 9499.89 }, ownerId, 'OWNER');
    const saved = await db.sale.findUniqueOrThrow({ where: { id: sale.id } });
    expect(Number(saved.netAmount)).toBe(14499.89);
    expect(Number(saved.amountReceived)).toBe(9499.89);
  });

  it('keeps unused credit and retained cancellation cash in the derived balance sheet', async () => {
    const report = new TransactionalReportService(db, new CompanyResolverService(db));
    // The report cutoff uses the local calendar day; UTC ISO is yesterday after Thai midnight.
    const date = new Date().toLocaleDateString('en-CA');
    const before = await report.getBalanceSheet(date, branchId);
    const c = await exchangeCase();
    const issued = await report.getBalanceSheet(date, branchId);
    expect(issued.liabilities.totalLiabilities - before.liabilities.totalLiabilities).toBe(5000);
    await approve(c.customer.id);
    const sale = await sales.create({ ...c.dto, saleType: 'INSTALLMENT' }, ownerId, 'OWNER');
    const contractId = (await db.sale.findUniqueOrThrow({ where: { id: sale.id } })).contractId!;
    await activate(contractId, c.customer.id);
    const active = await report.getBalanceSheet(date, branchId);
    const cancellation = await cancellations.requestCancellation(contractId, ownerId, 'Synthetic report cancellation', 0);
    await cancellations.approveCancellation(cancellation.id, ownerId);
    const canceled = await report.getBalanceSheet(date, branchId);
    expect(canceled.assets.currentAssets.cashAndBank).toBe(active.assets.currentAssets.cashAndBank);
    expect(canceled.liabilities.totalLiabilities - active.liabilities.totalLiabilities).toBe(7000);
  });

  it('does not return credit when a related commission payout has already been approved', async () => {
    const c = await exchangeCase(); await approve(c.customer.id);
    const sale = await sales.create({ ...c.dto, saleType: 'INSTALLMENT' }, ownerId, 'OWNER');
    const contractId = (await db.sale.findUniqueOrThrow({ where: { id: sale.id } })).contractId!;
    const commission = await db.salesCommission.findFirstOrThrow({ where: { saleId: sale.id } });
    const payout = await db.commissionPayout.upsert({ where: { salespersonId_period: { salespersonId: ownerId, period: commission.period } },
      create: { salespersonId: ownerId, period: commission.period, totalSales: 14500, totalCommission: 435, commissionCount: 1, status: 'APPROVED', generatedAt: new Date() },
      update: { status: 'APPROVED', generatedAt: new Date(), deletedAt: null } });
    try {
      await expect(lifecycle.softDelete(contractId, ownerId)).rejects.toThrow(/รอบจ่าย/);
      expect(await tradeCredits.available(c.customer.id, branchId)).toEqual([]);
      expect((await db.sale.findUniqueOrThrow({ where: { id: sale.id } })).deletedAt).toBeNull();
    } finally { await db.commissionPayout.update({ where: { id: payout.id }, data: { deletedAt: new Date() } }); }
  });

  it('allows only one simultaneous purchase to consume the same credit', async () => {
    const c = await exchangeCase();
    const other = await db.product.create({ data: { name: 'ISOLATED CONCURRENT DEVICE', brand: 'SYNTHETIC', model: 'CONCURRENT', category: 'ACCESSORY', branchId,
      ownedByCompanyId: shopId, imeiSerial: `SYNTHETIC-${randomUUID()}`, costPrice: 6000, status: 'IN_STOCK' } });
    const results = await Promise.allSettled([c.product.id, other.id].map(productId => sales.create({ ...c.dto, productId, saleType: 'CASH', amountReceived: 9500 }, ownerId, 'OWNER')));
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await db.tradeInCreditRedemption.count({ where: { tradeInId: c.intake.id, releasedAt: null } })).toBe(1);
    expect(await db.sale.count({ where: { productId: { in: [c.product.id, other.id] }, deletedAt: null } })).toBe(1);
  });

  it('rolls back the sale, stock and claim when the credit journal fails', async () => {
    const c = await exchangeCase();
    const original = JournalAutoService.prototype.createAndPost;
    const fault = jest.spyOn(JournalAutoService.prototype, 'createAndPost').mockImplementation(function (input, tx) {
      if ((input.metadata as Record<string, unknown> | undefined)?.flow === 'shop-trade-in-credit-applied') throw new Error('Synthetic credit journal failure');
      return original.call(this, input, tx);
    });
    try {
      await expect(sales.create({ ...c.dto, saleType: 'CASH' }, ownerId, 'OWNER')).rejects.toThrow('Synthetic credit journal failure');
    } finally { fault.mockRestore(); }
    expect(await db.sale.count({ where: { productId: c.product.id } })).toBe(0);
    expect((await db.product.findUniqueOrThrow({ where: { id: c.product.id } })).status).toBe('IN_STOCK');
    expect(await db.tradeInCreditRedemption.count({ where: { tradeInId: c.intake.id } })).toBe(0);
    expect((await db.tradeIn.findUniqueOrThrow({ where: { id: c.intake.id } })).currentRedemptionId).toBeNull();
  });

  it('prevents a POS sale and a direct contract from claiming the same credit together', async () => {
    const c = await exchangeCase(); await approve(c.customer.id);
    const other = await db.product.create({ data: { name: 'ISOLATED CASH COMPETITOR', brand: 'SYNTHETIC', model: 'CONCURRENT', category: 'ACCESSORY', branchId,
      ownedByCompanyId: shopId, imeiSerial: `SYNTHETIC-${randomUUID()}`, costPrice: 6000, status: 'IN_STOCK' } });
    const results = await Promise.allSettled([
      lifecycle.create(c.dto, ownerId, 'OWNER'),
      sales.create({ ...c.dto, productId: other.id, saleType: 'CASH' }, ownerId, 'OWNER'),
    ]);
    const rejected = results.find(result => result.status === 'rejected') as PromiseRejectedResult;
    expect([400, 409]).toContain(rejected.reason.getStatus());
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(await db.tradeInCreditRedemption.count({ where: { tradeInId: c.intake.id, releasedAt: null } })).toBe(1);
    expect(await db.product.count({ where: { id: { in: [c.product.id, other.id] }, status: { not: 'IN_STOCK' } } })).toBe(1);
  });

  it('rejects identity mismatch after resolving the existing customer of a seller contact', async () => {
    const c = await exchangeCase();
    const contact = await db.contact.create({ data: { contactCode: `ISOLATED-${randomUUID()}`, name: 'Synthetic Seller', roles: ['TRADE_IN_SELLER'] } });
    await db.customer.update({ where: { id: c.customer.id }, data: { contactId: contact.id } });
    const intake = await db.tradeIn.create({ data: { sellerContactId: contact.id, branchId, deviceBrand: 'SYNTHETIC', deviceModel: 'MISMATCH',
      flow: 'EXCHANGE', status: 'APPRAISED', offeredPrice: 5000, serialNumber: `SN-${randomUUID()}`, imeiMissingReason: 'Wi-Fi only',
      sellerName: 'Other Seller', sellerPhone: '0000000000', sellerAddress: 'Other Address', sellerIdCardNumber: '0000000000001' } });
    await expect(tradeIns.accept(intake.id, { idCardVerified: true, sellerConsentSigned: true, declarationVersion: TRADE_IN_DECLARATION_VERSION,
      sellerSignatureBase64: image, paymentMethod: 'TRADE_IN_CREDIT' }, ownerId)).rejects.toThrow('ไม่ตรงกับลูกค้า');
    expect((await db.tradeIn.findUniqueOrThrow({ where: { id: intake.id } })).productId).toBeNull();
    expect(await db.journalEntry.count({ where: { referenceId: `tradein:${intake.id}` } })).toBe(0);
  });

  it('rejects wrong customers, foreign branches, oversized credit, and finance-only actors atomically', async () => {
    const c = await exchangeCase(), other = await exchangeCase();
    const before = await db.sale.count();
    await expect(sales.create({ ...c.dto, saleType: 'CASH', customerId: other.customer.id }, ownerId, 'OWNER')).rejects.toThrow('ไม่ใช่');
    await expect(sales.create({ ...c.dto, saleType: 'CASH', sellingPrice: 4000 }, ownerId, 'OWNER')).rejects.toThrow('เต็มยอด');
    await expect(sales.create({ ...c.dto, saleType: 'CASH', branchId: (await db.branch.create({ data: { name: `OTHER ${randomUUID()}`, companyId: shopId } })).id }, ownerId, 'OWNER')).rejects.toThrow('สาขา');
    const restricted = await db.user.create({ data: { email: `restricted-${randomUUID()}@test.invalid`, password: 'unused', role: 'OWNER', name: 'ISOLATED FINANCE ONLY', accessibleCompanies: ['FINANCE'] } });
    await expect(sales.create({ ...c.dto, saleType: 'CASH' }, restricted.id, 'OWNER')).rejects.toThrow('สิทธิ์ SHOP');
    expect(await db.sale.count()).toBe(before);
    expect((await db.tradeIn.findUniqueOrThrow({ where: { id: c.intake.id } })).currentRedemptionId).toBeNull();
  });
  it('preserves amount/payday and balances cash and receivables across two receipts', async () => {
    const customer = await db.customer.create({ data: { name: 'ISOLATED SYNTHETIC CUSTOMER', nationalId: `SYNTHETIC-${randomUUID()}`,
      phone: '0000000000', birthDate: new Date('1990-01-01'), addressIdCard: '1 Synthetic Road', addressCurrent: '1 Synthetic Road',
      references: [{ firstName: 'Synthetic', lastName: 'Reference', phone: '0000000001', relationship: 'เพื่อน' }], salary: 20000, salaryPayDay: 31 } });
    const check = await db.creditCheck.create({ data: { customerId: customer.id, checkType: 'FULL', status: 'MANUAL_REVIEW',
      statementFiles: ['synthetic.pdf'], aiAnalysis: { monthlyIncome: 20000, monthlyExpense: 10000 } } });
    const basis = { verifiedMonthlyIncome: 20000, livingExpenses: 10000, externalMonthlyDebt: 0, salaryPayDay: 31,
      evidenceNotes: 'หลักฐานสังเคราะห์สำหรับตรวจรายได้ รายจ่าย หนี้ และวันเงินเดือนออก' };
    const preview = await credits.override_.approval.preview(check.id, basis, { id: ownerId, role: 'OWNER' });
    await credits.overrideById(check.id, { status: 'APPROVED', overrideReason: 'ยืนยันหลักฐานสังเคราะห์และยอดผ่อนสำหรับทดสอบระบบ',
      affordability: { ...basis, contextToken: preview.contextToken, approvedMonthlyPayment: 2000, confirmed: true } }, ownerId, 'OWNER');
    const product = await db.product.create({ data: { name: 'ISOLATED DEVICE', brand: 'SYNTHETIC', model: 'E2E', category: 'ACCESSORY',
      imeiSerial: `SYNTHETIC-${randomUUID()}`, branchId, ownedByCompanyId: shopId, costPrice: 6000, status: 'IN_STOCK' } });
    const created = await lifecycle.create({ customerId: customer.id, productId: product.id, branchId, sellingPrice: 12500,
      downPayment: 2500, totalMonths: 12, paymentDueDay: 31 }, ownerId, 'OWNER');
    const contractId = created.id;
    const stored = await db.contract.findUniqueOrThrow({ where: { id: contractId }, include: { payments: { where: { deletedAt: null }, orderBy: { installmentNo: 'asc' } } } });
    expect(stored.financedAmount.toFixed(2)).toBe('10000.00');
    expect(stored.interestTotal.toFixed(2)).toBe('6000.00');
    expect(stored.storeCommission?.toFixed(2)).toBe('1000.00');
    expect(stored.vatAmount?.toFixed(2)).toBe('1190.00');
    expect(stored.monthlyPayment.toFixed(2)).toBe('1515.83');
    expect(stored.payments).toHaveLength(12);
    expect(stored.payments[11].amountDue.toFixed(2)).toBe('1515.87');
    expect(stored.payments.reduce((total, p) => total.plus(p.amountDue), new Decimal(0)).toFixed(2)).toBe('18190.00');
    expect(stored.payments.every(p => p.amountDue.lte(2000))).toBe(true);
    const approval = await db.creditApproval.findFirstOrThrow({ where: { creditCheckId: check.id, supersededAt: null } });
    expect(approval.usedByContractId).toBe(contractId);
    expect(approval.usedFirstPaymentDue?.getTime()).toBe(stored.payments[0].dueDate.getTime());
    const consent = await db.pDPAConsent.create({ data: { customerId: customer.id, consentVersion: 'SYNTHETIC-1',
      privacyNoticeText: 'Synthetic consent', status: 'GRANTED', grantedAt: new Date(), purposes: ['CONTRACT'] } });
    await db.contract.update({ where: { id: contractId }, data: { pdpaConsentId: consent.id } });
    await db.contractDocument.createMany({ data: (['ID_CARD_COPY', 'KYC_SELFIE', 'DEVICE_PHOTO'] as const).map(documentType => ({
      contractId, documentType, uploadedById: ownerId, fileName: `${documentType}.png`, fileUrl: `synthetic://${documentType}.png`, fileHash: hash(documentType) })) });
    for (const signerType of ['CUSTOMER', 'COMPANY', 'WITNESS_1', 'WITNESS_2']) {
      await signatures.signContract(contractId, image, signerType, { ip: '127.0.0.1', userAgent: 'isolated-jest' },
        { signerName: `Synthetic ${signerType}`, staffUserId: ownerId });
    }
    await Promise.all(pdfJobs); // Document writes must finish before the submit integrity hash.
    expect(await db.signature.count({ where: { contractId, deletedAt: null } })).toBe(4);
    await workflow.submitForReview(contractId, ownerId, 'OWNER');
    await workflow.approveContract(contractId, ownerId, 'OWNER', 'Synthetic approval');
    await workflow.activate(contractId);
    const active = await db.contract.findUniqueOrThrow({ where: { id: contractId } });
    expect(active.status).toBe('ACTIVE');
    expect(active.contractHash).toMatch(/^[a-f0-9]{64}$/);
    const sold = await db.product.findUniqueOrThrow({ where: { id: product.id } });
    expect(sold.status).toBe('SOLD_INSTALLMENT'); expect(sold.ownedByCompanyId).toBe(financeId);
    const entries1 = await readEntries(contractId), oneA = entries1.filter(e => tag(e) === '1A');
    expect(oneA).toHaveLength(1); expect(oneA[0].companyId).toBe(financeId);
    expect(sum(oneA, '11-2101', 'debit').toFixed(2)).toBe('17000.00');
    expect(sum(oneA, '11-2105', 'debit').toFixed(2)).toBe('1190.00');
    expect(sum(oneA, '21-1101', 'credit').toFixed(2)).toBe('10000.00');
    expect(sum(oneA, '21-1102', 'credit').toFixed(2)).toBe('1000.00');
    expect(sum(entries1.filter(e => e.companyId === shopId), 'S41-1103', 'credit').toFixed(2)).toBe('12500.00');
    const schedule = await db.installmentSchedule.findMany({ where: { contractId, deletedAt: null }, orderBy: { installmentNo: 'asc' } });
    expect(schedule).toHaveLength(12);
    expect(schedule.map(p => p.dueDate.getTime())).toEqual(stored.payments.map(p => p.dueDate.getTime()));
    for (const p of stored.payments) expect(p.dueDate.getDate()).toBe(new Date(p.dueDate.getFullYear(), p.dueDate.getMonth() + 1, 0).getDate());
    const paidAt = new Date(schedule[0].dueDate); paidAt.setHours(12, 0, 0, 0);
    jest.useFakeTimers({ now: paidAt, doNotFake: ['nextTick', 'queueMicrotask', 'setImmediate', 'clearImmediate',
      'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'performance', 'hrtime'] });
    await accrual.execute(schedule[0].id);
    expect((await db.installmentSchedule.findUniqueOrThrow({ where: { id: schedule[0].id } })).accrualJournalEntryId).not.toBeNull();
    expect(await accrual.execute(schedule[0].id)).toBeNull();
    const reference = randomUUID();
    const partial = await payments.recordPayment(contractId, 1, 800, 'BANK_TRANSFER', ownerId, 'synthetic://partial.png', undefined,
      `${reference}-partial`, '11-1201', undefined, 'PARTIAL', true, paidAt);
    expect(partial.status).toBe('PARTIALLY_PAID'); expect(Number(partial.amountPaid)).toBe(800);
    const completed = await payments.recordPayment(contractId, 1, 715.83, 'BANK_TRANSFER', ownerId, 'synthetic://complete.png', undefined,
      `${reference}-complete`, '11-1201', undefined, undefined, true, paidAt);
    expect(completed.status).toBe('PAID'); expect(Number(completed.amountPaid)).toBe(1515.83);
    const entries = await readEntries(contractId), receipts = entries.filter(e => tag(e) === 'receipt');
    expect(receipts).toHaveLength(2); expect(receipts.every(e => e.companyId === financeId)).toBe(true);
    expect(sum(receipts, '11-1201', 'debit').toFixed(2)).toBe('1515.83');
    expect(sum(receipts, '11-2103', 'credit').toFixed(2)).toBe('1515.83');
    const financeEntries = entries.filter(e => e.companyId === financeId);
    expect(sum(financeEntries, '11-2103', 'debit').minus(sum(financeEntries, '11-2103', 'credit')).toFixed(2)).toBe('0.00');
    for (const entry of entries) {
      expect(entry.status).toBe('POSTED');
      expect(entry.lines.reduce((total, line) => total.plus(line.debit).minus(line.credit), new Decimal(0)).toFixed(2)).toBe('0.00');
    }
    const receiptRows = await db.receipt.findMany({ where: { contractId, paymentId: completed.id, receiptType: 'INSTALLMENT', isVoided: false } });
    expect(receiptRows.map(r => r.amount.toFixed(2)).sort()).toEqual(['715.83', '800.00']);
    await expect(payments.recordPayment(contractId, 1, 715.83, 'BANK_TRANSFER', ownerId, 'synthetic://complete.png', undefined,
      `${reference}-complete`, '11-1201', undefined, undefined, true, paidAt)).rejects.toThrow();
    expect((await readEntries(contractId)).filter(e => tag(e) === 'receipt')).toHaveLength(2);
    // Include the final rounding remainder; partial-first alone cannot catch residual AR.
    for (let index = 1; index < schedule.length; index++) {
      const due = new Date(schedule[index].dueDate); due.setHours(12, 0, 0, 0);
      jest.setSystemTime(due);
      await accrual.execute(schedule[index].id);
      const journalPreview = await payments.previewJournal({ contractId, installmentNo: index + 1,
        amountReceived: Number(stored.payments[index].amountDue), depositAccountCode: '11-1201', case: 'NORMAL' });
      expect(journalPreview.lines.find(line => line.accountCode === '11-2103')?.credit).toBe(stored.payments[index].amountDue.toFixed(2));
      const paid = await payments.recordPayment(contractId, index + 1, Number(stored.payments[index].amountDue),
        'BANK_TRANSFER', ownerId, 'synthetic://slip.png', undefined, `${reference}-${index + 1}`,
        '11-1201', undefined, undefined, true, due);
      expect(paid.status).toBe('PAID');
    }
    const finalEntries = (await readEntries(contractId)).filter(e => e.companyId === financeId);
    expect(sum(finalEntries, '11-1201', 'debit').toFixed(2)).toBe('18190.00');
    for (const account of ['11-2101', '11-2103', '11-2105', '11-2106', '21-2102']) {
      expect({ account, balance: sum(finalEntries, account, 'debit').minus(sum(finalEntries, account, 'credit')).toFixed(2) })
        .toEqual({ account, balance: '0.00' });
    }
    expect((await db.contract.findUniqueOrThrow({ where: { id: contractId } })).status).toBe('COMPLETED');
  }, 120_000);
});
