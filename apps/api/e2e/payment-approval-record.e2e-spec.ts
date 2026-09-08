import { RefundsService } from '../src/modules/refunds/refunds.service';
import { PaymentApprovalSettingsService } from '../src/modules/payments/services/payment-approval-settings.service';
/** Real PostgreSQL payment approval tests. Only a disposable local/CI database is allowed. */
import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../src/prisma/prisma.service';
import { PaymentsService } from '../src/modules/payments/payments.service';
import { ReceiptsService } from '../src/modules/receipts/receipts.service';
import { AuditService } from '../src/modules/audit/audit.service';
import { ProductsService } from '../src/modules/products/products.service';
import { JournalAutoService } from '../src/modules/journal/journal-auto.service';
import { PaymentReceiptTemplate } from '../src/modules/journal/cpa-templates/payment-receipt.template';
import { Vat60dayReversalTemplate } from '../src/modules/journal/cpa-templates/vat-60day-reversal.template';
import { BadDebtService } from '../src/modules/accounting/bad-debt.service';
import { BadDebtProvisionTemplate } from '../src/modules/journal/cpa-templates/bad-debt-provision.template';
import { BadDebtWriteOffTemplate } from '../src/modules/journal/cpa-templates/bad-debt-writeoff.template';
import { EclStageReverseTemplate } from '../src/modules/journal/cpa-templates/ecl-stage-reverse.template';
import { ConsecutiveMissedService } from '../src/modules/overdue/consecutive-missed.service';
import { CreditNoteDocumentService } from '../src/modules/receipts/services/credit-note-document.service';
import { ReceiptVoidReversalTemplate } from '../src/modules/journal/cpa-templates/receipt-void-reversal.template';
import { ContractActivation1ATemplate } from '../src/modules/journal/cpa-templates/contract-activation-1a.template';
import { seedFinanceCoa } from '../prisma/seed-coa-finance';
import { seedStandard17k12m } from '../src/modules/journal/__tests__/scenario-helpers';

import { InstallmentAccrual2ATemplate } from '../src/modules/journal/cpa-templates/installment-accrual-2a.template';

import { PaymentApprovalController } from '../src/modules/payments/payment-approval.controller';
import { ForbiddenException, BadRequestException, ConflictException } from '@nestjs/common';

const describeWithDatabase = process.env.DATABASE_URL ? describe : describe.skip;
const D = (value: string | number) => new Prisma.Decimal(value);
const PERMISSION_KEY = 'payment_approval_permissions';
const configValues: Record<string, string> = {
  late_fee_tier1_amount: '50', late_fee_tier2_amount: '100', late_fee_tier2_min_days: '3',
  adj_auto_route: 'true', [PERMISSION_KEY]: '{}',
};

describeWithDatabase('payment approval execution (real PostgreSQL)', () => {
  let prisma: PrismaService;
  let payments: PaymentsService;
  let receipts: ReceiptsService;
  let journal: JournalAutoService;
  let approvals: PaymentApprovalController;
  let makerId: string;
  let reviewerId: string;
  let ownerId: string;
  const contractIds: string[] = [];
  const userIds: string[] = [];
  const configBefore = new Map<string, { value: string; deletedAt: Date | null } | null>();

  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL!);
    if (!['localhost', '127.0.0.1'].includes(url.hostname) || !['/bc_payment_integration_test', '/test_db'].includes(url.pathname)) {
      throw new Error('Use only disposable bc_payment_integration_test or CI test_db');
    }
    prisma = new PrismaService();
    await prisma.$connect();
    await seedFinanceCoa(prisma as any);
    await prisma.user.upsert({ where: { email: 'admin@bestchoice.com' }, update: {},
      create: { email: 'admin@bestchoice.com', password: 'test-only', name: 'Test Admin', role: 'OWNER' } });
    if (!(await prisma.companyInfo.findFirst({ where: { companyCode: 'FINANCE', deletedAt: null } }))) {
      await prisma.companyInfo.create({ data: { companyCode: 'FINANCE', nameTh: 'Disposable E2E Finance',
        taxId: '9999999999999', address: 'Test only', directorName: 'Test Director', vatRegistered: true, vatRate: '0.0700' } });
    }
    for (const [key, value] of Object.entries(configValues)) {
      const previous = await prisma.systemConfig.findUnique({ where: { key } });
      configBefore.set(key, previous ? { value: previous.value, deletedAt: previous.deletedAt } : null);
      await prisma.systemConfig.upsert({ where: { key }, update: { value, deletedAt: null }, create: { key, value } });
    }
    for (const role of ['SALES', 'FINANCE_MANAGER', 'OWNER'] as const) {
      const user = await prisma.user.create({ data: { email: `approval-${role}-${randomUUID()}@example.test`,
        password: 'test-only', name: `Approval test ${role}`, role, isActive: true } });
      userIds.push(user.id);
      if (role === 'SALES') makerId = user.id;
      if (role === 'FINANCE_MANAGER') reviewerId = user.id;
      if (role === 'OWNER') ownerId = user.id;
    }
    journal = new JournalAutoService(prisma as any);
    receipts = new ReceiptsService(prisma as any, journal,
      new ReceiptVoidReversalTemplate(journal, prisma as any), undefined);
    const badDebt = new BadDebtService(
      prisma as any, journal,
      new BadDebtProvisionTemplate(journal, prisma as any),
      new BadDebtWriteOffTemplate(journal, prisma as any),
      new EclStageReverseTemplate(journal, prisma as any),
      new ConsecutiveMissedService(prisma as any),
      new CreditNoteDocumentService(prisma as any),
      { deliver: async () => ({ delivered: true }) } as any,
    );
    payments = new PaymentsService(
      prisma as any, receipts, new AuditService(prisma as any), journal, new ProductsService(prisma as any),
      { sendFlexMessage: async () => undefined } as any,
      { paymentReceipt: () => ({ quickReply: undefined }) } as any,
      { afterPayment: () => [] } as any, badDebt,
      new PaymentReceiptTemplate(journal, prisma as any), new Vat60dayReversalTemplate(journal, prisma as any),
      undefined, undefined, undefined, undefined,
    );

    approvals = new PaymentApprovalController(prisma, payments, receipts, undefined as any);
  }, 120_000);

  beforeEach(async () => {
    await prisma.systemConfig.update({ where: { key: PERMISSION_KEY }, data: { value: JSON.stringify({
      [reviewerId]: ['WAIVE_LATE_FEE', 'PAYMENT_TOLERANCE'],
      [makerId]: ['WAIVE_LATE_FEE', 'PAYMENT_TOLERANCE'],
    }) } });
  });

  afterAll(async () => {
    if (!prisma) return;
    try {
      if (contractIds.length) {
        const entries = await prisma.journalEntry.findMany({ where: { OR: [
          { referenceId: { in: contractIds } }, ...contractIds.map(id => ({ metadata: { path: ['contractId'], equals: id } })),
        ] }, select: { id: true } });
        const entryIds = entries.map(entry => entry.id);
        const paymentIds = (await prisma.payment.findMany({ where: { contractId: { in: contractIds } }, select: { id: true } })).map(payment => payment.id);
        await prisma.refund.deleteMany({ where: { contractId: { in: contractIds } } });
        await prisma.receipt.deleteMany({ where: { contractId: { in: contractIds } } });
        await prisma.paymentApprovalRequest.deleteMany({ where: { contractId: { in: contractIds } } });
        await prisma.feeWaiverApproval.deleteMany({ where: { waiverPaymentId: { in: paymentIds } } });
        await prisma.paymentDraft.deleteMany({ where: { payment: { contractId: { in: contractIds } } } });
        await prisma.loyaltyPoint.deleteMany({ where: { contractId: { in: contractIds } } });
        await prisma.partialPaymentLink.deleteMany({ where: { payment: { contractId: { in: contractIds } } } });
        await prisma.journalPostAuditLog.deleteMany({ where: { journalEntryId: { in: entryIds } } });
        await prisma.journalLine.deleteMany({ where: { journalEntryId: { in: entryIds } } });
        await prisma.journalEntry.deleteMany({ where: { id: { in: entryIds } } });
        await prisma.payment.deleteMany({ where: { contractId: { in: contractIds } } });
        await prisma.installmentSchedule.deleteMany({ where: { contractId: { in: contractIds } } });
        await prisma.contract.deleteMany({ where: { id: { in: contractIds } } });
      }
      // Keep immutable audit evidence and its actor rows, disabling only users created here.
      await prisma.user.updateMany({ where: { id: { in: userIds } }, data: { isActive: false } });
    } finally {
      for (const [key, previous] of configBefore) {
        if (!previous) await prisma.systemConfig.deleteMany({ where: { key } });
        else await prisma.systemConfig.update({ where: { key }, data: previous });
      }
      await prisma.$disconnect();
    }
  }, 120_000);

  async function fixture() {
    const contract = await seedStandard17k12m(prisma as any);
    contractIds.push(contract.id);
    const row = await prisma.contract.update({ where: { id: contract.id }, data: { monthlyPayment: D('1515.83') } });
    await prisma.user.update({ where: { id: makerId }, data: { branchId: row.branchId } });
    const dueDate = new Date(Date.now() - 5 * 86_400_000);
    const schedule = await prisma.installmentSchedule.update({
      where: { contractId_installmentNo: { contractId: contract.id, installmentNo: 1 } }, data: { dueDate },
    });
    const payment = await prisma.payment.create({ data: { contractId: contract.id, installmentNo: 1,
      amountDue: D('1515.83'), amountPaid: D(0), lateFee: D(100), status: 'PENDING', dueDate } });
    await prisma.payment.create({ data: { contractId: contract.id, installmentNo: 2,
      amountDue: D('1515.83'), amountPaid: D(0), status: 'PENDING', dueDate: new Date(Date.now() + 30 * 86_400_000) } });
    await new ContractActivation1ATemplate(journal, prisma as any).execute(contract.id);
    await new InstallmentAccrual2ATemplate(journal, prisma as any).execute(schedule.id);
    return { contractId: contract.id, paymentId: payment.id };
  }

  async function createRequest(f: { contractId: string; paymentId: string }, requesterId = makerId, tolerance = false) {
    return approvals.create({ action: 'RECORD_PAYMENT', targetId: f.paymentId,
      reason: 'ลูกค้าขออนุโลมค่าปรับและยอดชำระ', payload: {
        contractId: f.contractId, installmentNo: 1, amount: tolerance ? 1565.33 : 1565.83,
        paymentMethod: 'CASH', depositAccountCode: '11-1101',
        evidenceUrl: 'https://example.test/approval.jpg', transactionRef: `approval-${randomUUID()}`,
        case: tolerance ? 'UNDERPAY' : 'NORMAL', lateFeeWaiverAmount: 50, lateFeeWaiverReasonCode: 'other',
      } }, requesterId);
  }

  async function receiptEntries(paymentId: string) {
    return prisma.journalEntry.findMany({ where: { deletedAt: null, status: 'POSTED',
      AND: [{ metadata: { path: ['tag'], equals: 'receipt' } }, { metadata: { path: ['paymentId'], equals: paymentId } }],
    }, include: { lines: true } });
  }

  async function expectPendingWithoutMoney(paymentId: string, requestId?: string) {
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } })).amountPaid.toFixed(2)).toBe('0.00');
    expect(await receiptEntries(paymentId)).toHaveLength(0);
    expect(await prisma.receipt.count({ where: { paymentId } })).toBe(0);
    if (requestId) expect((await prisma.paymentApprovalRequest.findUniqueOrThrow({ where: { id: requestId } })).status).toBe('PENDING');
  }

  it('creates without moving money, then another authorized actor approves waiver and tolerance', async () => {
    const f = await fixture();
    const request = await createRequest(f, makerId, true);
    expect(request.requiredPermissions).toEqual(['WAIVE_LATE_FEE', 'PAYMENT_TOLERANCE']);
    await expectPendingWithoutMoney(f.paymentId, request.id);
    await approvals.approve(request.id, reviewerId, {});
    const reviewed = await prisma.paymentApprovalRequest.findUniqueOrThrow({ where: { id: request.id } });
    expect(reviewed.status).toBe('APPROVED');
    expect(reviewed.requestedById).toBe(makerId);
    expect(reviewed.reviewedById).toBe(reviewerId);
    const payment = await prisma.payment.findUniqueOrThrow({ where: { id: f.paymentId } });
    expect(payment.status).toBe('PAID');
    expect(payment.paidDate).not.toBeNull();
    // amountPaid is credited settlement; the document still reports actual cash.
    expect(payment.amountPaid.toFixed(2)).toBe('1565.83');
    expect(payment.waivedApprovedById).toBe(reviewerId);
    const entries = await receiptEntries(f.paymentId);
    expect(entries).toHaveLength(1);
    const sum = (account: string, side: 'debit' | 'credit') => entries[0].lines
      .filter(line => line.accountCode === account).reduce((total, line) => total.plus(line[side]), D(0)).toFixed(2);
    expect(sum('11-1101', 'debit')).toBe('1565.33');
    expect(sum('52-1105', 'debit')).toBe('50.00');
    expect(sum('52-1104', 'debit')).toBe('0.50');
    expect(sum('11-2103', 'credit')).toBe('1515.83');
    expect(sum('42-1103', 'credit')).toBe('100.00');
    const receipt = await prisma.receipt.findFirstOrThrow({ where: { paymentId: f.paymentId } });
    expect(receipt.amount.toFixed(2)).toBe('1565.33');
    expect(receipt.sourceJournalEntryId).toBe(entries[0].id);
    expect((await receipts.getReceipt(receipt.id)).lateFeeWaivedThisReceipt).toBe('50.00');
  }, 120_000);

  it('requires both permissions for a request that includes waiver and tolerance', async () => {
    const f = await fixture();
    const request = await createRequest(f, makerId, true);
    await prisma.systemConfig.update({ where: { key: PERMISSION_KEY }, data: {
      value: JSON.stringify({ [reviewerId]: ['WAIVE_LATE_FEE'] }),
    } });
    await expect(approvals.approve(request.id, reviewerId, {})).rejects.toBeInstanceOf(ForbiddenException);
    await expectPendingWithoutMoney(f.paymentId, request.id);
  }, 120_000);

  it('rejects self-approval by an assigned non-OWNER even with a reason', async () => {
    const f = await fixture();
    const request = await createRequest(f);
    await expect(approvals.approve(request.id, makerId, { reason: 'มีสิทธิ์แต่ไม่ใช่เจ้าของ' })).rejects.toBeInstanceOf(ForbiddenException);
    await expectPendingWithoutMoney(f.paymentId, request.id);
  }, 120_000);

  it('requires and preserves a reason for OWNER self-approval', async () => {
    const f = await fixture();
    const request = await createRequest(f, ownerId);
    await expect(approvals.approve(request.id, ownerId, {})).rejects.toBeInstanceOf(BadRequestException);
    await expectPendingWithoutMoney(f.paymentId, request.id);
    await approvals.approve(request.id, ownerId, { reason: 'เจ้าของตรวจยอดและหลักฐานด้วยตนเอง' });
    const approved = await prisma.paymentApprovalRequest.findUniqueOrThrow({ where: { id: request.id } });
    expect(approved).toMatchObject({ status: 'APPROVED', reviewedById: ownerId, reviewReason: 'เจ้าของตรวจยอดและหลักฐานด้วยตนเอง' });
    const evidence = await prisma.auditLog.findFirstOrThrow({ where: { entityId: request.id, action: 'PAYMENT_APPROVAL_APPROVED' } });
    expect(evidence.newValue).toMatchObject({ selfApproved: true, requestedById: ownerId });
  }, 120_000);

  it('denies an approval grant revoked after the request was created', async () => {
    const f = await fixture();
    const request = await createRequest(f);
    await prisma.systemConfig.update({ where: { key: PERMISSION_KEY }, data: { value: '{}' } });
    await expect(approvals.approve(request.id, reviewerId, {})).rejects.toBeInstanceOf(ForbiddenException);
    await expectPendingWithoutMoney(f.paymentId, request.id);
  }, 120_000);

  it('denies an inactive approver despite a saved permission grant', async () => {
    const f = await fixture();
    const request = await createRequest(f);
    await prisma.user.update({ where: { id: reviewerId }, data: { isActive: false } });
    try {
      await expect(approvals.approve(request.id, reviewerId, {})).rejects.toBeInstanceOf(ForbiddenException);
      await expectPendingWithoutMoney(f.paymentId, request.id);
    } finally {
      await prisma.user.update({ where: { id: reviewerId }, data: { isActive: true } });
    }
  }, 120_000);

  it('rejects a forged nominee on direct payment recording without an approval request', async () => {
    const f = await fixture();
    await expect(payments.recordPayment(
      f.contractId, 1, 1565.83, 'CASH', makerId, 'https://example.test/forged.jpg',
      undefined, `forged-${randomUUID()}`, '11-1101', undefined, 'NORMAL', true, undefined,
      50, 'other', ownerId,
    )).rejects.toBeInstanceOf(ForbiddenException);
    await expect(payments.recordPayment(
      f.contractId, 1, 1615.33, 'CASH', makerId, 'https://example.test/forged.jpg',
      undefined, `forged-${randomUUID()}`, '11-1101', ownerId, 'UNDERPAY',
    )).rejects.toBeInstanceOf(ForbiddenException);
    await expectPendingWithoutMoney(f.paymentId);
  }, 120_000);

  it('rejects a stale money snapshot instead of approving a changed obligation', async () => {
    const f = await fixture();
    const request = await createRequest(f);
    await prisma.payment.update({ where: { id: f.paymentId }, data: { amountDue: D('1516.83') } });
    await expect(approvals.approve(request.id, reviewerId, {})).rejects.toBeInstanceOf(ConflictException);
    await expectPendingWithoutMoney(f.paymentId, request.id);
  }, 120_000);

  it('posts one receipt JE when the same approval is submitted concurrently', async () => {
    const f = await fixture();
    const request = await createRequest(f);
    const outcomes = await Promise.allSettled([
      approvals.approve(request.id, reviewerId, {}),
      approvals.approve(request.id, reviewerId, {}),
    ]);
    expect(outcomes.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter(result => result.status === 'rejected')).toHaveLength(1);
    expect(await receiptEntries(f.paymentId)).toHaveLength(1);
    expect(await prisma.receipt.count({ where: { paymentId: f.paymentId } })).toBe(1);
    expect((await prisma.paymentApprovalRequest.findUniqueOrThrow({ where: { id: request.id } })).status).toBe('APPROVED');
    expect(await prisma.feeWaiverApproval.count({ where: { waiverPaymentId: f.paymentId } })).toBe(1);
    await expect(approvals.approve(request.id, reviewerId, {})).rejects.toBeInstanceOf(ConflictException);
  }, 120_000);

  it('rolls approval, waiver evidence and payment back when journal posting fails; retry succeeds', async () => {
    const f = await fixture();
    const request = await createRequest(f);
    const failure = jest.spyOn(journal, 'createAndPost').mockRejectedValueOnce(new Error('approval JE failure'));
    try {
      await expect(approvals.approve(request.id, reviewerId, {})).rejects.toThrow('approval JE failure');
    } finally {
      failure.mockRestore();
    }
    await expectPendingWithoutMoney(f.paymentId, request.id);
    const payment = await prisma.payment.findUniqueOrThrow({ where: { id: f.paymentId } });
    expect(payment.lateFeeWaived).toBe(false);
    expect(payment.waivedAmount).toBeNull();
    expect(await prisma.feeWaiverApproval.count({ where: { waiverPaymentId: f.paymentId } })).toBe(0);
    expect(await prisma.auditLog.count({ where: { entityId: request.id, action: 'PAYMENT_APPROVAL_APPROVED' } })).toBe(0);
    await approvals.approve(request.id, reviewerId, {});
    expect(await receiptEntries(f.paymentId)).toHaveLength(1);
    expect((await prisma.paymentApprovalRequest.findUniqueOrThrow({ where: { id: request.id } })).status).toBe('APPROVED');
  }, 120_000);

  it('preserves cumulative settlement when a follow-up overpayment creates advance credit', async () => {
    const f = await fixture();
    await payments.recordPayment(f.contractId, 1, 800, 'CASH', makerId,
      'https://example.test/partial.jpg', undefined, `partial-${randomUUID()}`, '11-1101', undefined, 'PARTIAL');
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: f.paymentId } })).amountPaid.toFixed(2)).toBe('800.00');
    await payments.recordPayment(f.contractId, 1, 900, 'CASH', makerId,
      'https://example.test/overpay.jpg', undefined, `advance-${randomUUID()}`, '11-1101', undefined, 'NORMAL');
    const payment = await prisma.payment.findUniqueOrThrow({ where: { id: f.paymentId } });
    expect(payment.status).toBe('PAID');
    expect(payment.amountPaid.toFixed(2)).toBe('1615.83');
    expect((await prisma.contract.findUniqueOrThrow({ where: { id: f.contractId } })).advanceBalance.toFixed(2)).toBe('84.17');
    const documents = await prisma.receipt.findMany({ where: { paymentId: f.paymentId } });
    expect(documents.map(receipt => receipt.amount.toFixed(2)).sort()).toEqual(['800.00', '900.00']);
    const entries = await receiptEntries(f.paymentId);
    expect(entries).toHaveLength(2);
    expect(entries.flatMap(entry => entry.lines).filter(line => line.accountCode === '11-2103')
      .reduce((sum, line) => sum.plus(line.credit), D(0)).toFixed(2)).toBe('1515.83');
    expect(entries.flatMap(entry => entry.lines).filter(line => line.accountCode === '21-1103')
      .reduce((sum, line) => sum.plus(line.credit), D(0)).toFixed(2)).toBe('84.17');
  }, 120_000);

  it('denies an explicitly assigned approver who has no access to the contract branch', async () => {
    const f = await fixture();
    const request = await createRequest(f);
    await prisma.user.update({ where: { id: reviewerId }, data: { role: 'SALES', branchId: null } });
    try {
      await expect(approvals.approve(request.id, reviewerId, {})).rejects.toBeInstanceOf(ForbiddenException);
      await expectPendingWithoutMoney(f.paymentId, request.id);
    } finally {
      await prisma.user.update({ where: { id: reviewerId }, data: { role: 'FINANCE_MANAGER', branchId: null } });
    }
  }, 120_000);

  it('persists OWNER permission changes and their audit in PostgreSQL', async () => {
    const settings = new PaymentApprovalSettingsService(prisma);
    const result = await settings.updateSettings({ users: [{ userId: reviewerId, permissions: ['VOID_RECEIPT'] }] }, ownerId);
    expect(result.users.find(user => user.id === reviewerId)?.permissions).toEqual(['VOID_RECEIPT']);
    const saved = await prisma.systemConfig.findUniqueOrThrow({ where: { key: PERMISSION_KEY } });
    expect(JSON.parse(saved.value)[reviewerId]).toEqual(['VOID_RECEIPT']);
    expect(await prisma.auditLog.count({ where: { userId: ownerId, action: 'PAYMENT_APPROVAL_PERMISSIONS_UPDATED' } })).toBeGreaterThan(0);
  });

  it('refunds only actual cash after an approved shortage, with a different authorized reviewer', async () => {
    const f = await fixture();
    const request = await approvals.create({ action: 'RECORD_PAYMENT', targetId: f.paymentId,
      reason: 'ขออนุมัติส่วนต่างห้าสิบสตางค์', payload: {
        contractId: f.contractId, installmentNo: 1, amount: 1615.33, case: 'UNDERPAY',
        paymentMethod: 'CASH', depositAccountCode: '11-1101', transactionRef: `refund-cash-${randomUUID()}`,
      } }, makerId);
    await approvals.approve(request.id, reviewerId, {});
    const refundService = new RefundsService(prisma, new AuditService(prisma), new ReceiptVoidReversalTemplate(journal, prisma));
    await expect(refundService.requestRefund({ paymentId: f.paymentId, amount: 1615.83, reason: 'คืนเงินที่รับจริงของรายการทดสอบ' }, makerId)).rejects.toBeInstanceOf(BadRequestException);
    const refund = await refundService.requestRefund({ paymentId: f.paymentId, amount: 1615.33, reason: 'คืนเงินที่รับจริงของรายการทดสอบ' }, makerId);
    await expect(refundService.approveRefund(refund.id, reviewerId, 'FINANCE_MANAGER')).rejects.toBeInstanceOf(ForbiddenException);
    await new PaymentApprovalSettingsService(prisma).updateSettings({ users: [{ userId: reviewerId, permissions: ['REFUND'] }] }, ownerId);
    await refundService.approveRefund(refund.id, reviewerId, 'FINANCE_MANAGER');
    const approved = await prisma.refund.findUniqueOrThrow({ where: { id: refund.id } });
    expect(approved.amount.toFixed(2)).toBe('1615.33');
    expect(approved.approvedById).toBe(reviewerId);
    await refundService.markReversed(refund.id, { bankReversalRef: 'TEST-BANK-REVERSAL', notes: 'หลักฐานจำลองเฉพาะฐานทดสอบ' }, ownerId, 'OWNER');
    expect((await prisma.refund.findUniqueOrThrow({ where: { id: refund.id } })).status).toBe('PROCESSED');
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: f.paymentId } })).amountPaid.toFixed(2)).toBe('0.00');
  });

  it('refuses bank refund for advance-funded receipts before changing balances', async () => {
    const f = await fixture();
    await payments.recordPayment(f.contractId, 1, 800, 'CASH', makerId, undefined, undefined, `partial-refund-${randomUUID()}`, '11-1101', undefined, 'PARTIAL');
    await payments.recordPayment(f.contractId, 1, 900, 'CASH', makerId, undefined, undefined, `advance-refund-${randomUUID()}`, '11-1101', undefined, 'OVERPAY_ADVANCE');
    const refundService = new RefundsService(prisma, new AuditService(prisma), new ReceiptVoidReversalTemplate(journal, prisma));
    await expect(refundService.requestRefund({ paymentId: f.paymentId, amount: 1700, reason: 'ขอคืนเงินรับจริงที่มีเงินล่วงหน้า' }, makerId)).rejects.toBeInstanceOf(BadRequestException);
    expect(await prisma.refund.count({ where: { paymentId: f.paymentId } })).toBe(0);
    expect((await prisma.contract.findUniqueOrThrow({ where: { id: f.contractId } })).advanceBalance.toFixed(2)).toBe('84.17');
  });

});
