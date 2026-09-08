import { ConfigService } from '@nestjs/config';
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
const originalEnv = { node: process.env.NODE_ENV, rate: process.env.USE_NEW_RATE_LOOKUP };
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
  const pdfJobs: Promise<unknown>[] = [];
  beforeAll(async () => {
    process.env.NODE_ENV = 'production'; // Exercise production workflow gates in the isolated DB.
    process.env.USE_NEW_RATE_LOOKUP = 'false';
    await db.$connect();
    await seedFinanceCoa(db); await seedShopCoa(db);
    ownerId = (await db.user.upsert({ where: { email: 'admin@bestchoice.com' },
      create: { email: 'admin@bestchoice.com', password: 'unused', name: 'ISOLATED OWNER', role: 'OWNER' },
      update: { role: 'OWNER', isActive: true, deletedAt: null } })).id;
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
    await Promise.all(pdfJobs); await db.$disconnect(); // Parent runner destroys this entire database.
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
