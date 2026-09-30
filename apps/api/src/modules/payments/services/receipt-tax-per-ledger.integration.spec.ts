/**
 * ใบกำกับภาษีตามบัญชี (PR3 — คำตัดสินฝ่ายบัญชี D3–D5 · คำถาม Q4–Q5 · คำตัดสินเจ้าของ 2026-09-30 "ทุกทางที่รับเงิน
 * ต้องออกใบเสร็จถูกต้อง") — ต่อฐานข้อมูลจริง.
 *
 * กติกาที่ไฟล์นี้ปัก:
 *   - ใบเสร็จค่างวดเก็บมูลค่า / VAT / ค่าปรับ / ปัดเศษ / เงินรับล่วงหน้า ณ ตอนออกใบ จากรายการบัญชีที่ผูก
 *     (sourceJournalEntryId)
 *   - VAT ของแถวค่างวด = ภาษีขายของรายการตั้งลูกหนี้งวด (2A) ที่ลงพร้อมกัน
 *   - หนึ่งใบต่อรายการบัญชีหนึ่งรายการ (เรียกซ้ำได้ใบเดิม · unique index กันชั้นสุดท้าย)
 *   - ใบเสร็จปิดยอดก่อนกำหนดยังพิมพ์แบบเดิม (ย้ายไป PR5)
 *
 * Runner: vitest (jest ข้ามไฟล์ `*.integration.spec.ts`). CI เก็บไฟล์นี้ผ่าน `PAYMENTS_FILES`
 * (`src/modules/payments/services/*.integration.spec.ts` ใน .github/workflows/deploy-gcp.yml) — ไม่ต้องแก้ workflow.
 * Run: cd apps/api && npx vitest run --no-file-parallelism \
 *        src/modules/payments/services/receipt-tax-per-ledger.integration.spec.ts
 *
 * สัญญามาตรฐาน 17,000 / 12 งวด (seedStandard17k12m): งวด 1–11 = 1,416.66 + VAT 99.17 = 1,515.83
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { AccountingPeriodStatus, PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { seedFinanceCoa } from '../../../../prisma/seed-coa-finance';
import { seedStandard17k12m } from '../../journal/__tests__/scenario-helpers';
import { JournalAutoService } from '../../journal/journal-auto.service';
import { ContractActivation1ATemplate } from '../../journal/cpa-templates/contract-activation-1a.template';
import { PaymentReceiptTemplate } from '../../journal/cpa-templates/payment-receipt.template';
import { ReceiptVoidReversalTemplate } from '../../journal/cpa-templates/receipt-void-reversal.template';
import { ReceiptsService } from '../../receipts/receipts.service';
import {
  earlyPayoffWithApproval,
  voidReceiptWithApproval,
} from '../../../../e2e/helpers/payment-approval';
import { ContractPaymentService } from '../../contracts/contract-payment.service';
import { ProductsService } from '../../products/products.service';
import { EarlyPayoffJP4Template } from '../../journal/cpa-templates/early-payoff-jp4.template';
import { Vat60dayReversalTemplate } from '../../journal/cpa-templates/vat-60day-reversal.template';
import { ShopCollectSettlementTemplate } from '../../journal/cpa-templates/shop-collect-settlement.template';
import { EclStageReverseTemplate } from '../../journal/cpa-templates/ecl-stage-reverse.template';
import { PaySolutionsService } from '../../paysolutions/paysolutions.service';
import type { PaymentCase } from '../dto/payment.dto';
import { PaymentReceiptOrchestrator } from './payment-receipt-orchestrator';

const prisma = new PrismaClient();
const D = (n: string) => new Decimal(n);
const DAY_MS = 86_400_000;
const INSTALLMENT_TOTAL = '1515.83';

async function ensureFinanceCompany(): Promise<void> {
  const existing = await prisma.companyInfo.findFirst({ where: { companyCode: 'FINANCE' } });
  if (!existing) {
    await prisma.companyInfo.create({
      data: {
        nameTh: 'BESTCHOICE FINANCE',
        taxId: '0000000000003',
        companyCode: 'FINANCE',
        address: '1 Finance Rd.',
        directorName: 'Test Director',
        vatRegistered: true,
        vatRate: D('0.0700'),
      },
    });
  }
}

/** JournalAutoService.resolveSystemUserId requires admin@bestchoice.com (OWNER — webhook ใช้เป็นผู้บันทึกด้วย) */
async function ensureSystemAdminUser(): Promise<void> {
  const existing = await prisma.user.findFirst({ where: { email: 'admin@bestchoice.com' } });
  if (!existing) {
    await prisma.user.create({
      data: {
        email: 'admin@bestchoice.com',
        password: 'hashed_placeholder',
        name: 'System Admin',
        role: 'OWNER',
      },
    });
  }
}

/** แถวงวดบัญชีของ FINANCE ที่ ensureFinancePeriodsOpen เปิด พร้อมสถานะเดิม — restoreFinancePeriods คืนค่า */
const reopenedFinancePeriods: { id: string; status: AccountingPeriodStatus }[] = [];

/** เปิดงวดของ FINANCE ทุกเดือนที่เทสไฟล์นี้ลงรายการ (ย้อนหลัง 10 วัน ถึงพรุ่งนี้) — จำแถวที่เปิดไว้คืนค่าใน afterAll */
async function ensureFinancePeriodsOpen(): Promise<void> {
  const finance = await prisma.companyInfo.findFirstOrThrow({ where: { companyCode: 'FINANCE' } });
  const months = new Map<string, { year: number; month: number }>();
  for (let offset = -10; offset <= 1; offset++) {
    const day = new Date(Date.now() + offset * DAY_MS);
    months.set(`${day.getFullYear()}-${day.getMonth() + 1}`, {
      year: day.getFullYear(),
      month: day.getMonth() + 1,
    });
  }
  const closed = await prisma.accountingPeriod.findMany({
    where: {
      companyId: finance.id,
      status: { in: ['CLOSED', 'SYNCED'] },
      OR: [...months.values()],
    },
    select: { id: true, status: true },
  });
  if (closed.length === 0) return;
  reopenedFinancePeriods.push(...closed);
  await prisma.accountingPeriod.updateMany({
    where: { id: { in: closed.map((p) => p.id) } },
    data: { status: 'OPEN' },
  });
}

async function restoreFinancePeriods(): Promise<void> {
  const rows = reopenedFinancePeriods.splice(0);
  for (const status of new Set(rows.map((r) => r.status))) {
    await prisma.accountingPeriod.updateMany({
      where: { id: { in: rows.filter((r) => r.status === status).map((r) => r.id) } },
      data: { status },
    });
  }
}

/** การยกเลิกใบเสร็จต้องมีผู้อนุมัติที่ไม่ใช่ผู้ขอ และมีสิทธิ์ยกเลิก */
async function ensureApprover(): Promise<string> {
  const email = 'test-receipt-tax-approver@bestchoice-test.internal';
  const existing = await prisma.user.findFirst({ where: { email } });
  if (existing) return existing.id;
  const created = await prisma.user.create({
    data: {
      email,
      password: 'hashed_placeholder',
      name: 'Receipt Tax Approver',
      role: 'ACCOUNTANT',
      isActive: true,
    },
  });
  return created.id;
}

async function cleanLedger(): Promise<void> {
  await prisma.receipt.deleteMany({});
  await prisma.journalPostAuditLog.deleteMany({});
  await prisma.journalLine.deleteMany({});
  await prisma.journalEntry.deleteMany({});
  await prisma.loyaltyPoint.deleteMany({});
  await prisma.paymentLink.deleteMany({});
  await prisma.payment.deleteMany({});
  await prisma.installmentSchedule.deleteMany({});
  const woPoisoned = await prisma.badDebtWriteOffAuditLog.findMany({
    select: { contractId: true },
  });
  await prisma.contract.deleteMany({
    where: { id: { notIn: woPoisoned.map((p) => p.contractId) } },
  });
}

describe('ใบกำกับภาษีตามบัญชี — ทุกเส้นทางรับเงิน (integration)', () => {
  let journal: JournalAutoService;
  let receiptTemplate: PaymentReceiptTemplate;
  let receiptsService: ReceiptsService;
  let orchestrator: PaymentReceiptOrchestrator;
  let recordedById: string;
  let approverId: string;

  /** วันครบกำหนดในอนาคต 60 วัน = งวดยังไม่ถึงกำหนด */
  const futureDue = () => new Date(Date.now() + 60 * DAY_MS);

  /** สัญญามาตรฐาน + 1A + เลื่อนวันครบกำหนดทุกงวด + แถว Payment ของงวดที่ระบุ (ยอดเรียกเก็บ = ยอดในบัญชี เว้นแต่ระบุ) */
  const seedContract = async (opts: {
    dueDate: Date;
    paymentRows: number[];
    amountDue?: string;
  }) => {
    const c = await seedStandard17k12m(prisma);
    await new ContractActivation1ATemplate(journal, prisma as never).execute(c.id);
    await prisma.installmentSchedule.updateMany({
      where: { contractId: c.id },
      data: { dueDate: opts.dueDate },
    });
    for (const installmentNo of opts.paymentRows) {
      await prisma.payment.create({
        data: {
          contractId: c.id,
          installmentNo,
          dueDate: opts.dueDate,
          amountDue: D(opts.amountDue ?? INSTALLMENT_TOTAL),
          status: 'PENDING',
        },
      });
    }
    return c;
  };

  const record = (
    contractId: string,
    installmentNo: number,
    amount: number,
    transactionRef: string,
    opts: { paymentCase?: PaymentCase } = {},
  ) =>
    orchestrator.recordPayment(
      contractId,
      installmentNo,
      amount,
      'CASH',
      recordedById,
      undefined, // evidenceUrl
      undefined, // notes
      transactionRef,
      '11-1101',
      undefined, // toleranceApproverId
      opts.paymentCase,
    );

  /** QR ของหน้ารับชำระ — อาร์กิวเมนต์เดียวกับ PaySolutionsConfirmationService: PARTIAL · ไม่ส่งวันที่ · ข้ามด่านลำดับงวด */
  const recordPartialQr = (
    contractId: string,
    installmentNo: number,
    amount: number,
    refno: string,
  ) =>
    orchestrator.recordPayment(
      contractId,
      installmentNo,
      amount,
      'ONLINE_GATEWAY',
      recordedById,
      undefined,
      `ชำระผ่าน Pay Solutions (${refno})`,
      refno,
      '11-1201',
      undefined,
      'PARTIAL',
      true,
      undefined,
      undefined,
      undefined,
      undefined,
      false,
      0,
    );

  /** ใบเสร็จค่างวดของสัญญา (ไม่รวมใบลดหนี้) เรียงตามเวลาที่ออก */
  const installmentReceipts = (contractId: string) =>
    prisma.receipt.findMany({
      where: { contractId, receiptType: 'INSTALLMENT', deletedAt: null },
      orderBy: [{ createdAt: 'asc' }, { receiptNumber: 'asc' }],
    });

  /** ค่าที่เก็บบนใบ (สตริง 2 ตำแหน่ง) — null = ไม่เก็บ */
  const taxOf = (r: Record<string, unknown>) =>
    Object.fromEntries(
      [
        'amount',
        'amountBeforeVat',
        'vatAmount',
        'roundingAmount',
        'lateFeeAmount',
        'lateFeeWaivedAmount',
        'advanceAmount',
        'advanceVatAmount',
      ].map((k) => [k, r[k] == null ? null : new Decimal(String(r[k])).toFixed(2)]),
    );

  /** ยอด Cr 21-2101 ของรายการ 2A ที่ใบรับชำระ (entry id) ประทับไว้ใน metadata.accrualEntryNumber */
  const accrualVatOfReceiptEntry = async (sourceJournalEntryId: string) => {
    const je = await prisma.journalEntry.findUniqueOrThrow({ where: { id: sourceJournalEntryId } });
    const accrualNo = (je.metadata as Record<string, unknown>).accrualEntryNumber as string;
    const accrual = await prisma.journalEntry.findUniqueOrThrow({
      where: { entryNumber: accrualNo },
      include: { lines: true },
    });
    return accrual.lines
      .filter((l) => l.accountCode === '21-2101')
      .reduce((s, l) => s.plus(l.credit.toString()), new Decimal(0))
      .toFixed(2);
  };

  beforeAll(async () => {
    await cleanLedger();
    await seedFinanceCoa(prisma);
    await ensureFinanceCompany();
    await ensureSystemAdminUser();
    await ensureFinancePeriodsOpen();
    approverId = await ensureApprover();

    journal = new JournalAutoService(prisma as never);
    receiptTemplate = new PaymentReceiptTemplate(journal, prisma as never);
    receiptsService = new ReceiptsService(
      prisma as never,
      journal,
      new ReceiptVoidReversalTemplate(journal, prisma as never),
      undefined,
    );
    const noop = async () => {};
    orchestrator = new PaymentReceiptOrchestrator(
      prisma as never,
      receiptsService,
      { logPaymentEvent: noop, log: noop } as never,
      journal,
      { transferOwnership: noop } as never,
      { reverseStageOnPayment: noop } as never,
      receiptTemplate,
      { execute: noop } as never,
      {
        awardLoyaltyPoints: noop,
        sendPaymentSuccessLine: noop,
        runMdmAutoUnlock: noop,
        checkPromiseAfterPayment: noop,
      },
    );

    await seedStandard17k12m(prisma); // สร้างผู้ใช้ทดสอบให้แน่นอนก่อนอ่าน id
    recordedById = (
      await prisma.user.findFirstOrThrow({
        where: { email: 'test-salesperson@bestchoice-test.internal' },
      })
    ).id;
  });

  afterAll(async () => {
    try {
      await cleanLedger();
    } finally {
      try {
        await restoreFinancePeriods();
      } finally {
        await prisma.$disconnect();
      }
    }
  });

  describe('บันทึกรับชำระ (หน้ารับชำระ / QR ของหน้ารับชำระ)', () => {
    it('ยอดเรียกเก็บ 1,516.00 ของงวด 1,515.83 → ใบเก็บมูลค่า 1,416.66 · VAT 99.17 · ปัดเศษ 0.17 และผูกรายการรับชำระ', async () => {
      const c = await seedContract({
        dueDate: futureDue(),
        paymentRows: [1, 2],
        amountDue: '1516.00',
      });

      await record(c.id, 1, 1516, 'RTX-BILL-1');

      const [r] = await installmentReceipts(c.id);
      expect(taxOf(r)).toEqual({
        amount: '1516.00',
        amountBeforeVat: '1416.66',
        vatAmount: '99.17',
        roundingAmount: '0.17',
        lateFeeAmount: '0.00',
        lateFeeWaivedAmount: '0.00',
        advanceAmount: '0.00',
        advanceVatAmount: '0.00',
      });
      expect(r.sourceJournalEntryId).not.toBeNull();
      const je = await prisma.journalEntry.findUniqueOrThrow({
        where: { id: r.sourceJournalEntryId! },
      });
      expect((je.metadata as Record<string, unknown>).receiptTax).toEqual({
        version: 1,
        ...taxOf(r),
      });
      // VAT ของใบ = ภาษีขายของ 2A ที่ลงพร้อมกัน
      expect(await accrualVatOfReceiptEntry(r.sourceJournalEntryId!)).toBe('99.17');
    });

    it('รับก่อนวันครบกำหนด 700 (QR) แล้ว 815.83 → VAT 45.79 และ 53.38 = ภาษีขายของ 2A ทั้งสองรายการ · รวม 99.17', async () => {
      const c = await seedContract({ dueDate: futureDue(), paymentRows: [1, 2] });

      await recordPartialQr(c.id, 1, 700, 'RTX-SPLIT-1');
      await record(c.id, 1, 815.83, 'RTX-SPLIT-2');

      const [first, second] = await installmentReceipts(c.id);
      expect(taxOf(first).vatAmount).toBe('45.79');
      expect(taxOf(first).amountBeforeVat).toBe('654.21');
      expect(taxOf(second).vatAmount).toBe('53.38');
      expect(taxOf(second).amountBeforeVat).toBe('762.45');
      expect(await accrualVatOfReceiptEntry(first.sourceJournalEntryId!)).toBe('45.79');
      expect(await accrualVatOfReceiptEntry(second.sourceJournalEntryId!)).toBe('53.38');
    });

    it('เรียกออกใบซ้ำด้วยเลขรายการบัญชีเดิม → ได้ใบเดิม · สร้างใบที่สองของรายการเดียวกันตรง ๆ → unique index ปฏิเสธ (P2002)', async () => {
      const c = await seedContract({ dueDate: futureDue(), paymentRows: [1, 2] });
      await record(c.id, 1, 1515.83, 'RTX-IDEM-1');
      const [r] = await installmentReceipts(c.id);
      const je = await prisma.journalEntry.findUniqueOrThrow({
        where: { id: r.sourceJournalEntryId! },
      });

      const again = await receiptsService.generateReceipt(
        c.id,
        r.paymentId,
        'INSTALLMENT',
        1515.83,
        1,
        'CASH',
        null,
        recordedById,
        undefined,
        je.entryNumber,
      );

      expect(again.id).toBe(r.id);
      expect(await installmentReceipts(c.id)).toHaveLength(1);
      await expect(
        prisma.receipt.create({
          data: {
            receiptNumber: `RT-DUP-${Date.now()}`,
            contractId: c.id,
            receiptType: 'INSTALLMENT',
            payerName: 'dup',
            receiverName: 'dup',
            amount: D('1515.83'),
            paidDate: new Date(),
            issuedById: recordedById,
            sourceJournalEntryId: je.id,
          },
        }),
      ).rejects.toMatchObject({ code: 'P2002' });
    });
  });

  describe('ปิดยอดก่อนกำหนด — ยังพิมพ์แบบเดิม (ย้ายไป PR5)', () => {
    it('ใบเสร็จปิดยอดไม่ผูกรายการ JP4 และไม่เก็บค่า (ทุกช่องว่าง → PDF ใช้ตรรกะเดิม) · ยอดเท่ายอดปิด', async () => {
      const c = await seedContract({
        dueDate: futureDue(),
        paymentRows: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
      });
      const contractPayments = new ContractPaymentService(
        prisma as never,
        new ProductsService(prisma as never),
        journal,
        new EarlyPayoffJP4Template(
          journal,
          prisma as never,
          new Vat60dayReversalTemplate(journal, prisma as never),
        ),
        new ShopCollectSettlementTemplate(journal, prisma as never),
        receiptsService,
        new EclStageReverseTemplate(journal, prisma as never),
      );
      const ownerId = (
        await prisma.user.findFirstOrThrow({ where: { email: 'admin@bestchoice.com' } })
      ).id;

      const payoff = await earlyPayoffWithApproval(prisma, contractPayments, c.id, ownerId, {
        paymentMethod: 'BANK_TRANSFER',
        depositAccountCode: '11-1201',
      } as never);

      const r = await prisma.receipt.findFirstOrThrow({
        where: { contractId: c.id, receiptType: 'EARLY_PAYOFF' },
      });
      expect(new Decimal(r.amount.toString()).toFixed(2)).toBe(
        new Decimal(payoff.totalPayoff).toFixed(2),
      );
      expect(r.sourceJournalEntryId).toBeNull();
      expect(taxOf(r)).toEqual({
        amount: new Decimal(payoff.totalPayoff).toFixed(2),
        amountBeforeVat: null,
        vatAmount: null,
        roundingAmount: null,
        lateFeeAmount: null,
        lateFeeWaivedAmount: null,
        advanceAmount: null,
        advanceVatAmount: null,
      });
    });
  });

  describe('กระจายเงินอัตโนมัติ / ใช้เครดิตชำระ (X5 · ใบที่เคยไม่มี)', () => {
    it('กระจายเงิน 3,500 → งวด 1–2 เต็ม + งวด 3 บางส่วน 468.34 → ใบเสร็จ 3 ใบหลัง commit: สถานะ PAID/PAID/PARTIAL · ผูกรายการของงวด · VAT 99.17/99.17/30.64 = ภาษีขายของ 2A', async () => {
      const c = await seedContract({ dueDate: futureDue(), paymentRows: [1, 2, 3] });

      await orchestrator.autoAllocatePayment(c.id, 3500, 'CASH', recordedById);

      const receipts = await installmentReceipts(c.id);
      expect(receipts.map((r) => [r.installmentNo, r.paymentStatus, taxOf(r).amount])).toEqual([
        [1, 'PAID', '1515.83'],
        [2, 'PAID', '1515.83'],
        [3, 'PARTIAL', '468.34'],
      ]);
      expect(receipts.map((r) => taxOf(r).vatAmount)).toEqual(['99.17', '99.17', '30.64']);
      for (const r of receipts) {
        expect(r.sourceJournalEntryId).not.toBeNull();
        expect(await accrualVatOfReceiptEntry(r.sourceJournalEntryId!)).toBe(taxOf(r).vatAmount);
      }
    });

    it('ใช้เครดิต 2,000 ชำระ → ใบเสร็จ 2 ใบ ช่องทาง CREDIT_BALANCE · VAT 99.17 และ 31.67 · ผูกรายการ Dr 21-5101', async () => {
      const c = await seedContract({ dueDate: futureDue(), paymentRows: [1, 2] });
      await prisma.contract.update({ where: { id: c.id }, data: { creditBalance: D('2000') } });

      await orchestrator.applyCreditBalance(c.id, recordedById);

      const receipts = await installmentReceipts(c.id);
      expect(receipts.map((r) => [r.installmentNo, r.paymentMethod, taxOf(r).amount])).toEqual([
        [1, 'CREDIT_BALANCE', '1515.83'],
        [2, 'CREDIT_BALANCE', '484.17'],
      ]);
      expect(receipts.map((r) => taxOf(r).vatAmount)).toEqual(['99.17', '31.67']);
      for (const r of receipts) {
        const je = await prisma.journalEntry.findUniqueOrThrow({
          where: { id: r.sourceJournalEntryId! },
          include: { lines: true },
        });
        expect(je.lines.some((l) => l.accountCode === '21-5101' && l.debit.gt(0))).toBe(true);
        expect(await accrualVatOfReceiptEntry(r.sourceJournalEntryId!)).toBe(taxOf(r).vatAmount);
      }
    });
  });

  describe('เงินเข้าทางลิงก์ชำระ (webhook PaySolutions)', () => {
    it('เงิน 3,031.66 จ่ายงวด 1–2 → ใบเสร็จ 2 ใบ ONLINE_GATEWAY ผูกรายการของแต่ละงวด · VAT 99.17 = ภาษีขายของ 2A · webhook ส่งซ้ำไม่ได้ใบเพิ่ม', async () => {
      const c = await seedContract({ dueDate: futureDue(), paymentRows: [1, 2, 3] });
      const noop = async () => {};
      const paysolutions = new PaySolutionsService(
        prisma as never,
        { get: (_k: string, def?: string) => def ?? '' } as never,
        { sendFlexMessage: noop } as never,
        { getValue: async () => '' } as never,
        {} as never,
        { transferOwnership: noop } as never,
        journal,
        receiptTemplate,
        { execute: noop } as never,
        {} as never,
        { reverseStageOnPayment: noop } as never,
        receiptsService,
      );
      const link = await prisma.paymentLink.create({
        data: {
          token: `rtx-webhook-${Date.now()}`,
          contractId: c.id,
          amount: D('3031.66'),
          status: 'ACTIVE',
          expiresAt: new Date(Date.now() + DAY_MS),
        },
      });
      const payload = {
        refno: link.token,
        result_code: '00',
        order_no: 'rtx-o-1',
        transaction_id: 'rtx-tx-1',
        total: '3031.66',
      };

      await paysolutions.handlePaymentCallback(payload);
      await paysolutions.handlePaymentCallback(payload); // ผู้ให้บริการส่งซ้ำ

      const receipts = await installmentReceipts(c.id);
      expect(
        receipts.map((r) => [r.installmentNo, r.paymentMethod, r.transactionRef, taxOf(r).amount]),
      ).toEqual([
        [1, 'ONLINE_GATEWAY', 'rtx-tx-1', '1515.83'],
        [2, 'ONLINE_GATEWAY', 'rtx-tx-1', '1515.83'],
      ]);
      for (const r of receipts) {
        expect(taxOf(r).vatAmount).toBe('99.17');
        expect(r.sourceJournalEntryId).not.toBeNull();
        expect(await accrualVatOfReceiptEntry(r.sourceJournalEntryId!)).toBe('99.17');
      }
    });
  });

  describe('ยกเลิกใบเสร็จ → ใบลดหนี้คัดลอกทุกบรรทัด (Q5)', () => {
    it('ใบ 1,565.83 (ค่างวด 1,515.83 + ค่าปรับที่พนักงานเพิ่ม 50) → ใบลดหนี้ มูลค่า 1,416.66 · VAT 99.17 · ค่าปรับ 50 เท่าใบเดิม', async () => {
      const c = await seedContract({ dueDate: futureDue(), paymentRows: [1, 2] });
      await orchestrator.recordPayment(
        c.id,
        1,
        1565.83,
        'CASH',
        recordedById,
        undefined, // evidenceUrl
        undefined, // notes
        'RTX-VOID-1',
        '11-1101',
        undefined, // toleranceApproverId
        undefined, // paymentCase
        undefined, // consumeAdvance
        undefined, // paidDate
        undefined, // lateFeeWaiverAmount
        undefined, // lateFeeWaiverReasonCode
        undefined, // waiverApproverId
        true, // enforceSequence
        50, // additionalLateFee
      );
      const [r] = await installmentReceipts(c.id);
      expect(taxOf(r)).toEqual({
        amount: '1565.83',
        amountBeforeVat: '1416.66',
        vatAmount: '99.17',
        roundingAmount: '0.00',
        lateFeeAmount: '50.00',
        lateFeeWaivedAmount: '0.00',
        advanceAmount: '0.00',
        advanceVatAmount: '0.00',
      });

      await voidReceiptWithApproval(
        prisma,
        receiptsService,
        r.id,
        'ทดสอบใบลดหนี้คัดลอกทุกบรรทัด',
        recordedById,
        approverId,
      );

      const cn = await prisma.receipt.findFirstOrThrow({
        where: { contractId: c.id, receiptType: 'CREDIT_NOTE', voidedReceiptId: r.id },
      });
      expect(taxOf(cn)).toEqual(taxOf(r));
    });
  });
});
