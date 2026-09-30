/**
 * ตั้งลูกหนี้งวด ณ วันรับเงิน (คำตัดสินฝ่ายบัญชี D2 2026-09-28 · คำตัดสินผู้คุมงาน R9 + R12 2026-09-29)
 * — ต่อฐานข้อมูลจริง.
 *
 * กติกาที่ไฟล์นี้ปัก:
 *   - ใบรับชำระที่ทำให้งวดชำระครบ → ลง 2A ส่วนที่เหลือของงวด (แกนอย่างเดียว) ก่อนใบรับชำระ ในธุรกรรมเดียวกัน
 *   - ใบรับชำระบางส่วนก่อนวันครบกำหนด → ลง 2A เท่ายอดที่รับ (คำตอบฝ่ายบัญชี ก1 "แบบ ข" 29/09/2569) ·
 *     ตั้งแต่วันครบกำหนด → ไม่ลง 2A (รอบกลางคืนตั้งส่วนที่เหลือ)
 *   - รอบกลางคืนไม่ลง 2A ซ้ำ ตั้งเฉพาะส่วนที่เหลือ และหักเงินรับล่วงหน้าไม่เกินยอดที่ยังค้างบนแถวงวด
 *   - ยกเลิกใบเสร็จก่อนวันครบกำหนด → กลับ 2A ที่ลง ณ วันรับเงินทุกใบของงวด
 *
 * Runner: vitest (jest ข้ามไฟล์ `*.integration.spec.ts`). CI เก็บไฟล์นี้ผ่าน `PAYMENTS_FILES`
 * (`src/modules/payments/services/*.integration.spec.ts` ใน deploy-gcp.yml) — ไม่ต้องแก้ workflow.
 * Run: cd apps/api && npx vitest run --no-file-parallelism \
 *        src/modules/payments/services/accrue-at-receipt.integration.spec.ts
 *
 * สัญญามาตรฐาน 17,000 / 12 งวด (seedStandard17k12m):
 *   งวด 1–11: 1,416.66 + VAT 99.17 = 1,515.83 · ดอกเบี้ย 500.00 · รายการ 2A รวม 2,115.00
 *   งวด 12  : 1,416.74 + VAT 99.13 = 1,515.87 (รับเศษปัด)
 *   1A      : Dr 11-2101 17,000 · Dr 11-2105 1,190 / Cr 21-1101 10,000 · Cr 21-1102 1,000 ·
 *             Cr 11-2106 6,000 · Cr 21-2102 1,190
 */
import {
  earlyPayoffWithApproval,
  voidReceiptWithApproval,
} from '../../../../e2e/helpers/payment-approval';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { AccountingPeriodStatus, PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { seedFinanceCoa } from '../../../../prisma/seed-coa-finance';
import { seedStandard17k12m } from '../../journal/__tests__/scenario-helpers';
import { glContractBalance } from '../../journal/gl-contract-balance';
import { JournalAutoService } from '../../journal/journal-auto.service';
import { ContractActivation1ATemplate } from '../../journal/cpa-templates/contract-activation-1a.template';
import { InstallmentAccrual2ATemplate } from '../../journal/cpa-templates/installment-accrual-2a.template';
import { PaymentReceiptTemplate } from '../../journal/cpa-templates/payment-receipt.template';
import {
  RECEIPT_ACCRUAL_VOID_FLOW,
  ReceiptVoidReversalTemplate,
} from '../../journal/cpa-templates/receipt-void-reversal.template';
import { InstallmentAccrualCron } from '../../journal/cron/installment-accrual.cron';
import { RepossessionJP5Template } from '../../journal/cpa-templates/repossession-jp5.template';
import { EarlyPayoffJP4Template } from '../../journal/cpa-templates/early-payoff-jp4.template';
import { Vat60dayReversalTemplate } from '../../journal/cpa-templates/vat-60day-reversal.template';
import { ShopCollectSettlementTemplate } from '../../journal/cpa-templates/shop-collect-settlement.template';
import { EclStageReverseTemplate } from '../../journal/cpa-templates/ecl-stage-reverse.template';
import { ContractPaymentService } from '../../contracts/contract-payment.service';
import { ProductsService } from '../../products/products.service';
import { ReceiptsService } from '../../receipts/receipts.service';
import { bangkokStartOfDay } from '../../../utils/date.util';
import { isRetryablePrismaWriteError } from '../../../utils/transaction-retry.util';
import type { PaymentCase } from '../dto/payment.dto';
import { PaymentReceiptOrchestrator } from './payment-receipt-orchestrator';

const prisma = new PrismaClient();
const D = (n: string) => new Decimal(n);
const DAY_MS = 86_400_000;
const INSTALLMENT_TOTAL = '1515.83';

/** 7 บรรทัดของ 2A งวดปกติ เรียงตามรหัสบัญชีเพื่อเทียบ (ลำดับบรรทัดจากฐานข้อมูลไม่รับประกัน) */
const ACCRUAL_2A_SORTED = [
  '11-2101:0.00:1416.66',
  '11-2103:1515.83:0.00',
  '11-2105:0.00:99.17',
  '11-2106:500.00:0.00',
  '21-2101:0.00:99.17',
  '21-2102:99.17:0.00',
  '41-1101:0.00:500.00',
];

/** 7 บรรทัดของ 2A งวดสุดท้าย (รับเศษปัด): 1,416.74 + VAT 99.13 = 1,515.87 */
const ACCRUAL_2A_LAST_SORTED = [
  '11-2101:0.00:1416.74',
  '11-2103:1515.87:0.00',
  '11-2105:0.00:99.13',
  '11-2106:500.00:0.00',
  '21-2101:0.00:99.13',
  '21-2102:99.13:0.00',
  '41-1101:0.00:500.00',
];

/** ก1: 2A เท่ายอดที่รับ 1,000 ของงวดปกติ — VAT 65.42 · มูลค่า 934.58 · ดอกเบี้ย 329.85 (Σ 1,395.27) */
const PART_1000_SORTED = [
  '11-2101:0.00:934.58',
  '11-2103:1000.00:0.00',
  '11-2105:0.00:65.42',
  '11-2106:329.85:0.00',
  '21-2101:0.00:65.42',
  '21-2102:65.42:0.00',
  '41-1101:0.00:329.85',
];

/** ก1: ส่วนที่เหลือ 515.83 ของงวดปกติหลังตั้ง 1,000 — VAT 33.75 · มูลค่า 482.08 · ดอกเบี้ย 170.15 */
const REST_515_SORTED = [
  '11-2101:0.00:482.08',
  '11-2103:515.83:0.00',
  '11-2105:0.00:33.75',
  '11-2106:170.15:0.00',
  '21-2101:0.00:33.75',
  '21-2102:33.75:0.00',
  '41-1101:0.00:170.15',
];

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

/** JournalAutoService.resolveSystemUserId requires admin@bestchoice.com. */
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

/**
 * เทสไม่พึ่งว่าตารางงวดบัญชีสะอาด: เปิดงวดของ FINANCE ทุกเดือนที่เทสไฟล์นี้ลงรายการ
 * (ย้อนหลัง 10 วัน ถึงพรุ่งนี้). ไม่สร้างแถวใหม่ — ไม่มีแถว = งวดเปิดอยู่แล้ว.
 * แตะเฉพาะงวดของ FINANCE และจำแถวที่เปิดกับสถานะเดิมไว้ — afterAll คืนค่าใน finally.
 * ปี/เดือนอ่านจากเวลาของเครื่อง แบบเดียวกับ validatePeriodOpen.
 */
async function ensureFinancePeriodsOpen(): Promise<void> {
  const finance = await prisma.companyInfo.findFirstOrThrow({ where: { companyCode: 'FINANCE' } });
  const months = new Map<string, { year: number; month: number }>();
  for (let offset = -10; offset <= 1; offset++) {
    const day = new Date(Date.now() + offset * DAY_MS);
    const year = day.getFullYear();
    const month = day.getMonth() + 1;
    months.set(`${year}-${month}`, { year, month });
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

/** คืนสถานะเดิมของงวดที่ ensureFinancePeriodsOpen เปิดไว้ (แตะเฉพาะแถวที่จำไว้) */
async function restoreFinancePeriods(): Promise<void> {
  const rows = reopenedFinancePeriods.splice(0);
  for (const status of new Set(rows.map((r) => r.status))) {
    await prisma.accountingPeriod.updateMany({
      where: { id: { in: rows.filter((r) => r.status === status).map((r) => r.id) } },
      data: { status },
    });
  }
}

/** 7 บรรทัดของรายการกลับรายการตั้งลูกหนี้งวด งวดปกติ — กระจกของ ACCRUAL_2A_SORTED */
const ACCRUAL_2A_REVERSAL_SORTED = [
  '11-2101:1416.66:0.00',
  '11-2103:0.00:1515.83',
  '11-2105:99.17:0.00',
  '11-2106:0.00:500.00',
  '21-2101:99.17:0.00',
  '21-2102:0.00:99.17',
  '41-1101:500.00:0.00',
];

/** การยกเลิกใบเสร็จต้องมีผู้อนุมัติที่ไม่ใช่ผู้ขอ และมีสิทธิ์ยกเลิก */
async function ensureApprover(): Promise<string> {
  const email = 'test-accrual-void-approver@bestchoice-test.internal';
  const existing = await prisma.user.findFirst({ where: { email } });
  if (existing) return existing.id;
  const created = await prisma.user.create({
    data: {
      email,
      password: 'hashed_placeholder',
      name: 'Accrual Void Approver',
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
  await prisma.payment.deleteMany({});
  await prisma.installmentSchedule.deleteMany({});
  const woPoisoned = await prisma.badDebtWriteOffAuditLog.findMany({
    select: { contractId: true },
  });
  await prisma.contract.deleteMany({
    where: { id: { notIn: woPoisoned.map((p) => p.contractId) } },
  });
}

describe('ตั้งลูกหนี้งวด ณ วันรับเงิน — ทุกเส้นทางรับเงิน (integration)', () => {
  let journal: JournalAutoService;
  let receiptsService: ReceiptsService;
  let orchestrator: PaymentReceiptOrchestrator;
  let recordedById: string;
  let approverId: string;

  /** วันครบกำหนดในอนาคต 60 วันจากตอนรันเทส = งวดยังไม่ถึงกำหนด */
  const futureDue = () => new Date(Date.now() + 60 * DAY_MS);

  /** สัญญามาตรฐาน + 1A + เลื่อนวันครบกำหนดทุกงวด + สร้างแถว Payment ของงวดที่ระบุ */
  const seedContract = async (opts: { dueDate: Date; paymentRows: number[] }) => {
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
          amountDue: D(INSTALLMENT_TOTAL),
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
    opts: { paymentCase?: PaymentCase; paidDate?: Date; enforceSequence?: boolean } = {},
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
      undefined, // consumeAdvance → ค่าเริ่มต้น true
      opts.paidDate,
      undefined, // lateFeeWaiverAmount
      undefined, // lateFeeWaiverReasonCode
      undefined, // waiverApproverId
      opts.enforceSequence ?? true,
    );

  /**
   * เงินเข้าทาง QR ของหน้ารับชำระ — อาร์กิวเมนต์ชุดเดียวกับที่ PaySolutionsConfirmationService ส่ง:
   * 'ONLINE_GATEWAY' · case 'PARTIAL' เสมอ · ไม่ส่งวันที่รับเงิน (= ตอนที่ผู้ให้บริการยืนยัน) ·
   * ข้ามด่านลำดับงวด. เส้นทางรับชำระไม่หักเงินรับล่วงหน้าให้เมื่อ case เป็น 'PARTIAL'.
   */
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
      undefined, // evidenceUrl
      `ชำระผ่าน Pay Solutions (${refno})`,
      refno, // transactionRef
      '11-1201',
      undefined, // toleranceApproverId
      'PARTIAL',
      true, // consumeAdvance
      undefined, // paidDate
      undefined, // lateFeeWaiverAmount
      undefined, // lateFeeWaiverReasonCode
      undefined, // waiverApproverId
      false, // enforceSequence
      0, // additionalLateFee
    );

  /** รอบกลางคืนตัวจริง — ประมวลทุกงวดที่ถึงกำหนดในฐาน จึงตรวจผลเป็นรายสัญญา ไม่ตรวจตัวนับรวม */
  const runNightly = () =>
    new InstallmentAccrualCron(
      prisma as never,
      new InstallmentAccrual2ATemplate(journal, prisma as never),
    ).tick();

  /** เลื่อนวันครบกำหนดของงวด (ตารางงวด + แถว Payment) ไปที่เที่ยงคืนไทยของ "วันนี้ − daysAgo" */
  const setDueDaysAgo = async (contractId: string, installmentNo: number, daysAgo: number) => {
    const due = new Date(bangkokStartOfDay(new Date()).getTime() - daysAgo * DAY_MS);
    await prisma.installmentSchedule.update({
      where: { contractId_installmentNo: { contractId, installmentNo } },
      data: { dueDate: due },
    });
    await prisma.payment.updateMany({
      where: { contractId, installmentNo },
      data: { dueDate: due },
    });
    return due;
  };

  const paymentOf = (contractId: string, installmentNo: number) =>
    prisma.payment.findFirstOrThrow({ where: { contractId, installmentNo, deletedAt: null } });

  const paidOf = async (contractId: string, installmentNo: number) => {
    const row = await paymentOf(contractId, installmentNo);
    return { amountPaid: new Decimal(row.amountPaid.toString()).toFixed(2), status: row.status };
  };

  const statusOf = async (contractId: string) =>
    (await prisma.contract.findUniqueOrThrow({ where: { id: contractId } })).status;

  const advanceOf = async (contractId: string) => {
    const c = await prisma.contract.findUniqueOrThrow({ where: { id: contractId } });
    return {
      generic: new Decimal(c.advanceBalance.toString()).toFixed(2),
      park: new Decimal(c.rescheduleAdvanceBalance.toString()).toFixed(2),
    };
  };

  const scheduleOf = (contractId: string, installmentNo: number) =>
    prisma.installmentSchedule.findUniqueOrThrow({
      where: { contractId_installmentNo: { contractId, installmentNo } },
    });

  /** รายการ tag 2A ของงวด (ทุกสถานะ) */
  const accrualEntries = async (installmentScheduleId: string) => {
    const entries = await prisma.journalEntry.findMany({
      where: {
        metadata: { path: ['installmentScheduleId'], equals: installmentScheduleId },
      } as never,
      include: { lines: true },
      orderBy: { createdAt: 'asc' },
    });
    return entries.filter((e) => (e.metadata as Record<string, unknown>).tag === '2A');
  };

  const sortedLines = (entry: {
    lines: { accountCode: string; debit: unknown; credit: unknown }[];
  }) =>
    entry.lines
      .map(
        (l) =>
          `${l.accountCode}:${new Decimal(String(l.debit)).toFixed(2)}:${new Decimal(String(l.credit)).toFixed(2)}`,
      )
      .sort();

  const flowEntries = (contractId: string, flow: string) =>
    prisma.journalEntry.findMany({
      where: {
        AND: [
          { metadata: { path: ['flow'], equals: flow } } as never,
          { metadata: { path: ['contractId'], equals: contractId } } as never,
        ],
      },
      include: { lines: true },
    });

  /** จำนวนรายการบัญชีทั้งหมดที่ผูกกับสัญญา (ทุก tag) */
  const entryCount = (contractId: string) =>
    prisma.journalEntry.count({
      where: { metadata: { path: ['contractId'], equals: contractId } } as never,
    });

  const balance = async (contractId: string, code: string, side: 'dr' | 'cr') =>
    (await glContractBalance(prisma, contractId, code, side)).toFixed(2);

  /** ยอดที่ตั้งลูกหนี้งวดไปแล้วบนแถวงวด (คอลัมน์ accrued*) */
  const accruedOf = async (contractId: string, installmentNo: number) => {
    const s = await scheduleOf(contractId, installmentNo);
    return [s.accruedAmount, s.accruedVat, s.accruedInterest].map((v) =>
      new Decimal(v.toString()).toFixed(2),
    );
  };

  /** รายการ 2A ของงวดที่ยังมีผล (ไม่ถูกกลับ) */
  const liveAccrualEntries = async (installmentScheduleId: string) =>
    (await accrualEntries(installmentScheduleId)).filter(
      (e) => (e.metadata as Record<string, unknown>).reversed !== true,
    );

  /** ยอดของสัญญาที่มีเฉพาะรายการเปิดสัญญา (1A) — ใช้ยืนยันว่า "ไม่มีการตั้งลูกหนี้งวด" */
  const expectNothingAccrued = async (contractId: string) => {
    expect(await balance(contractId, '11-2101', 'dr')).toBe('17000.00');
    expect(await balance(contractId, '11-2105', 'dr')).toBe('1190.00');
    expect(await balance(contractId, '11-2106', 'cr')).toBe('6000.00');
    expect(await balance(contractId, '21-2102', 'cr')).toBe('1190.00');
    expect(await balance(contractId, '41-1101', 'cr')).toBe('0.00');
    expect(await balance(contractId, '21-2101', 'cr')).toBe('0.00');
  };

  beforeAll(async () => {
    await cleanLedger();
    await seedFinanceCoa(prisma);
    // 21-5101 เป็นขา Dr ของการใช้เครดิต — upsert ซ้ำได้ (แบบเดียวกับ e2e/applycreditbalance-partial)
    await prisma.chartOfAccount.upsert({
      where: { code: '21-5101' },
      create: {
        code: '21-5101',
        name: 'เงินเกินของลูกค้า (Customer Credit Balance)',
        type: 'หนี้สิน',
        normalBalance: 'Cr',
        category: 'หนี้สิน',
      },
      update: { deletedAt: null },
    });
    await ensureFinanceCompany();
    await ensureSystemAdminUser();
    await ensureFinancePeriodsOpen();
    approverId = await ensureApprover();

    journal = new JournalAutoService(prisma as never);
    const receiptTemplate = new PaymentReceiptTemplate(journal, prisma as never);
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

    // seedStandard17k12m สร้างผู้ใช้นี้ให้ — เรียกหนึ่งครั้งเพื่อให้มีแน่นอนก่อนอ่าน id
    await seedStandard17k12m(prisma);
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

  describe('ใบรับชำระที่ทำให้งวดชำระครบ', () => {
    it('จ่ายล่วงหน้าเต็มงวด → ลง 2A เต็มงวด ลงวันที่รับเงิน แล้วลงใบรับชำระ — 11-2103 เหลือ 0', async () => {
      const c = await seedContract({ dueDate: futureDue(), paymentRows: [1, 2] });
      const paidDate = new Date();

      const paid = await record(c.id, 1, 1515.83, 'AAR-FULL-1', { paidDate });
      expect(paid.status).toBe('PAID');

      const sched = await scheduleOf(c.id, 1);
      const accruals = await accrualEntries(sched.id);
      expect(accruals).toHaveLength(1);
      expect(accruals[0].entryNumber).toBe(sched.accrualJournalEntryId);
      expect(accruals[0].status).toBe('POSTED');
      expect(accruals[0].postedAt!.getTime()).toBe(paidDate.getTime());
      const meta = accruals[0].metadata as Record<string, unknown>;
      expect(meta.trigger).toBe('receipt');
      expect(meta.receiptDate).toBe(paidDate.toISOString());
      expect(meta.paymentId).toBeUndefined();
      expect(sortedLines(accruals[0])).toEqual(ACCRUAL_2A_SORTED);

      expect(await balance(c.id, '11-2103', 'dr')).toBe('0.00'); // Dr 1,515.83 (2A) − Cr 1,515.83 (ใบรับชำระ)
      expect(await balance(c.id, '41-1101', 'cr')).toBe('500.00'); // ดอกเบี้ยงวดนี้รับรู้แล้ว
      expect(await balance(c.id, '21-2101', 'cr')).toBe('99.17'); // ภาษีขายงวดนี้รับรู้แล้ว
      expect(await balance(c.id, '11-2101', 'dr')).toBe('15583.34'); // 17,000 − 1,416.66
      expect(await balance(c.id, '11-2106', 'cr')).toBe('5500.00'); // 6,000 − 500
      expect(await balance(c.id, '21-2102', 'cr')).toBe('1090.83'); // 1,190 − 99.17

      // งวดถัดไปที่ยังไม่มีเงินเข้า ต้องยังไม่ถูกตั้งลูกหนี้
      expect((await scheduleOf(c.id, 2)).accrualJournalEntryId).toBeNull();
    });

    it('งวดเดียวจ่ายสองครั้งก่อนครบกำหนด (QR 1,000 แล้วพนักงานรับส่วนที่เหลือ 515.83) → ใบแรกตั้งเท่ายอดที่รับ ใบที่สองตั้งส่วนที่เหลือ ลงวันที่ของแต่ละใบ', async () => {
      const c = await seedContract({ dueDate: futureDue(), paymentRows: [1, 2] });

      const first = await recordPartialQr(c.id, 1, 1000, 'AAR-TWO-1');
      expect(first.status).toBe('PARTIALLY_PAID');
      const sched = await scheduleOf(c.id, 1);
      expect(sched.accrualJournalEntryId).toBeNull(); // ยังตั้งไม่ครบ
      const [partial] = await accrualEntries(sched.id);
      expect(partial.referenceId).toBe(`${sched.id}:receipt-accrual:1`);
      expect((partial.metadata as Record<string, unknown>).portion).toBe('partial');
      expect((partial.metadata as Record<string, unknown>).trigger).toBe('receipt');
      expect(sortedLines(partial)).toEqual(PART_1000_SORTED);
      expect(await accruedOf(c.id, 1)).toEqual(['1000.00', '65.42', '329.85']);
      // ใบรับชำระจดเลขที่ 2A ที่ตัวเองทำให้ลง
      const [firstReceipt] = await flowEntries(c.id, 'payment-receipt');
      expect((firstReceipt.metadata as Record<string, unknown>).accrualEntryNumber).toBe(
        partial.entryNumber,
      );
      expect(await balance(c.id, '11-2103', 'dr')).toBe('0.00'); // Dr 1,000 (2A) − Cr 1,000 (ใบรับชำระ)
      expect(await balance(c.id, '41-1101', 'cr')).toBe('329.85');
      expect(await balance(c.id, '21-2101', 'cr')).toBe('65.42');

      const paidDate = new Date();
      const second = await record(c.id, 1, 515.83, 'AAR-TWO-2', { paidDate });
      expect(second.status).toBe('PAID');

      const accruals = await accrualEntries(sched.id);
      expect(accruals).toHaveLength(2);
      const remainder = accruals[1];
      expect(remainder.referenceId).toBe(sched.id); // ใบที่ทำให้ครบใช้ reference เดิม
      expect(remainder.entryNumber).toBe((await scheduleOf(c.id, 1)).accrualJournalEntryId);
      expect(remainder.postedAt!.getTime()).toBe(paidDate.getTime());
      expect((remainder.metadata as Record<string, unknown>).portion).toBe('remainder');
      expect(sortedLines(remainder)).toEqual(REST_515_SORTED);
      expect(await accruedOf(c.id, 1)).toEqual(['1515.83', '99.17', '500.00']);
      expect(await balance(c.id, '11-2103', 'dr')).toBe('0.00'); // 1,000 + 515.83 − 1,000 − 515.83
      expect(await balance(c.id, '41-1101', 'cr')).toBe('500.00'); // 329.85 + 170.15
      expect(await balance(c.id, '21-2101', 'cr')).toBe('99.17'); // 65.42 + 33.75
      expect(await balance(c.id, '11-2101', 'dr')).toBe('15583.34'); // 17,000 − 934.58 − 482.08
    });

    it('สามครั้งก่อนครบกำหนด (QR 500 / 600 / 415.83) → 2A สามใบ 500 / 600 / ส่วนที่เหลือ 415.83 · ยอดรวมเท่างวดพอดี', async () => {
      const c = await seedContract({ dueDate: futureDue(), paymentRows: [1, 2] });

      await recordPartialQr(c.id, 1, 500, 'AAR-THREE-1');
      await recordPartialQr(c.id, 1, 600, 'AAR-THREE-2');
      expect(await accruedOf(c.id, 1)).toEqual(['1100.00', '71.96', '362.84']);
      const last = await recordPartialQr(c.id, 1, 415.83, 'AAR-THREE-3');
      expect(last.status).toBe('PAID');

      const sched = await scheduleOf(c.id, 1);
      const accruals = await accrualEntries(sched.id);
      expect(accruals.map((e) => e.referenceId)).toEqual([
        `${sched.id}:receipt-accrual:1`,
        `${sched.id}:receipt-accrual:2`,
        sched.id,
      ]);
      expect(accruals.map((e) => sortedLines(e))).toEqual([
        [
          '11-2101:0.00:467.29',
          '11-2103:500.00:0.00',
          '11-2105:0.00:32.71',
          '11-2106:164.93:0.00',
          '21-2101:0.00:32.71',
          '21-2102:32.71:0.00',
          '41-1101:0.00:164.93',
        ],
        [
          '11-2101:0.00:560.75',
          '11-2103:600.00:0.00',
          '11-2105:0.00:39.25',
          '11-2106:197.91:0.00',
          '21-2101:0.00:39.25',
          '21-2102:39.25:0.00',
          '41-1101:0.00:197.91',
        ],
        [
          '11-2101:0.00:388.62',
          '11-2103:415.83:0.00',
          '11-2105:0.00:27.21',
          '11-2106:137.16:0.00',
          '21-2101:0.00:27.21',
          '21-2102:27.21:0.00',
          '41-1101:0.00:137.16',
        ],
      ]);
      expect(sched.accrualJournalEntryId).toBe(accruals[2].entryNumber);
      expect(await accruedOf(c.id, 1)).toEqual(['1515.83', '99.17', '500.00']);
      expect(await balance(c.id, '11-2103', 'dr')).toBe('0.00');
      expect(await balance(c.id, '41-1101', 'cr')).toBe('500.00');
      expect(await balance(c.id, '21-2101', 'cr')).toBe('99.17');
    });

    it('ใบรับชำระสองใบของงวดเดียวกันพร้อมกันก่อนครบกำหนด → ไม่มี 2A ซ้ำหรือเกินงวด: ยอดสะสมบนแถวงวด = Σ 2A ที่ลงจริง = Σ ที่ใบรับชำระล้าง', async () => {
      const c = await seedContract({ dueDate: futureDue(), paymentRows: [1, 2] });

      const results = await Promise.allSettled([
        recordPartialQr(c.id, 1, 400, 'AAR-RACE-1'),
        recordPartialQr(c.id, 1, 700, 'AAR-RACE-2'),
      ]);
      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      expect(fulfilled.length).toBeGreaterThanOrEqual(1);
      // ฝ่ายแพ้ล้มทั้งธุรกรรม และต้องล้มเพราะชนกันเท่านั้น (กันบั๊กอื่นแฝงมาเป็น "ผู้แพ้"):
      //   - isRetryablePrismaWriteError (utils/transaction-retry.util.ts — ตัวตัดสินเดียวกับเส้นทางที่ลองซ้ำ):
      //     P2034 (Serializable) · P2002 (unique index ของ reference) · P2010 ที่ meta.code 40001/40P01 และ
      //     error ไม่มีรหัส (PrismaClientUnknownRequestError) ที่ข้อความเป็น serialization/deadlock — ความล้มเหลว
      //     ใน raw SQL มาในสองรูปนี้ ไม่ใช่ P2034
      //   - P2025 = compare-and-set ของแถวงวดไม่พบแถว · P2028 = ธุรกรรมถูกยกเลิกระหว่างรอ lock
      // สิ่งที่ชี้ขาดว่าไม่มี 2A ซ้ำหรือเกินงวดคือค่าคงที่ของบัญชีข้างล่าง
      for (const r of results) {
        if (r.status === 'rejected') {
          const code = (r.reason as { code?: string }).code ?? '';
          expect(
            isRetryablePrismaWriteError(r.reason) || ['P2025', 'P2028'].includes(code),
            `ฝ่ายที่แพ้ต้องล้มเพราะชนกันเท่านั้น — ได้ ${String(r.reason)}`,
          ).toBe(true);
        }
      }

      const sched = await scheduleOf(c.id, 1);
      const live = await liveAccrualEntries(sched.id);
      const accrued2103 = live
        .flatMap((e) => e.lines)
        .filter((l) => l.accountCode === '11-2103')
        .reduce((s, l) => s.plus(new Decimal(l.debit.toString())), new Decimal(0));
      const receiptsCleared = (await flowEntries(c.id, 'payment-receipt'))
        .flatMap((e) => e.lines)
        .filter((l) => l.accountCode === '11-2103')
        .reduce((s, l) => s.plus(new Decimal(l.credit.toString())), new Decimal(0));
      expect(live).toHaveLength(fulfilled.length);
      expect(new Set(live.map((e) => e.referenceId)).size).toBe(live.length);
      expect((await accruedOf(c.id, 1))[0]).toBe(accrued2103.toFixed(2));
      expect(accrued2103.toFixed(2)).toBe(receiptsCleared.toFixed(2));
      expect(await balance(c.id, '11-2103', 'dr')).toBe('0.00');
    });

    it('ยอดเรียกเก็บ 1,516.00 สูงกว่ายอดของงวดในบัญชี 1,515.83: รับ 1,515.83 เป็นบางส่วน → ตั้งเท่ายอดที่รับ = ทั้งงวด (ครบ) · รับ 0.17 ที่เหลือ → ไม่มี 2A เพิ่ม 0.17 เป็นกำไรปัดเศษ', async () => {
      const c = await seedContract({ dueDate: futureDue(), paymentRows: [1, 2] });
      await prisma.payment.updateMany({
        where: { contractId: c.id, installmentNo: 1 },
        data: { amountDue: D('1516.00') },
      });

      // ใบแรกล้างลูกหนี้ในบัญชีครบ 1,515.83 แต่แถวงวดยังค้าง 0.17 → ใบบางส่วน ซึ่งตั้งเท่ายอดที่รับ = ทั้งงวด
      const firstDate = new Date();
      const first = await recordPartialQr(c.id, 1, 1515.83, 'AAR-BILL-1');
      expect(first.status).toBe('PARTIALLY_PAID');
      const sched = await scheduleOf(c.id, 1);
      const accruals = await accrualEntries(sched.id);
      expect(accruals).toHaveLength(1);
      expect(accruals[0].referenceId).toBe(sched.id);
      expect(sched.accrualJournalEntryId).toBe(accruals[0].entryNumber); // ตั้งครบแล้ว
      expect(accruals[0].postedAt!.getTime()).toBeGreaterThanOrEqual(firstDate.getTime());
      expect(sortedLines(accruals[0])).toEqual(ACCRUAL_2A_SORTED);
      expect(await balance(c.id, '11-2103', 'dr')).toBe('0.00');

      const second = await record(c.id, 1, 0.17, 'AAR-BILL-2', { paidDate: new Date() });
      expect(second.status).toBe('PAID');

      expect(await accrualEntries(sched.id)).toHaveLength(1);
      expect(await balance(c.id, '11-2103', 'dr')).toBe('0.00');
      expect(await balance(c.id, '53-1503', 'cr')).toBe('0.17');
      expect(await balance(c.id, '41-1101', 'cr')).toBe('500.00');
    });

    it('ลูกค้ามีเงินรับล่วงหน้า 500 (จากการจ่ายเกินงวด 1) แล้วจ่ายสดเต็มงวด 2 → 2A ของงวด 2 เป็นแกนอย่างเดียว: ไม่หักเงินรับล่วงหน้า ไม่แตะแถวงวด', async () => {
      const c = await seedContract({ dueDate: futureDue(), paymentRows: [1, 2, 3] });
      const first = await record(c.id, 1, 2015.83, 'AAR-CORE-1'); // จ่ายเกิน 500 → เงินรับล่วงหน้า
      expect(first.status).toBe('PAID');
      expect(await advanceOf(c.id)).toEqual({ generic: '500.00', park: '0.00' });
      expect(await balance(c.id, '21-1103', 'cr')).toBe('500.00');

      // จ่ายเท่ายอดค้างพอดี เส้นทางรับชำระจึงไม่หักเงินรับล่วงหน้าเอง: ตอนที่ template ถูกเรียก
      // เงินรับล่วงหน้า 500 ยังอยู่ครบ — ถ้า 2A ณ วันรับเงินหักเอง เทสนี้ล้ม
      const paid = await record(c.id, 2, 1515.83, 'AAR-CORE-2');
      expect(paid.status).toBe('PAID');

      const accruals = await accrualEntries((await scheduleOf(c.id, 2)).id);
      expect(accruals).toHaveLength(1);
      expect(sortedLines(accruals[0])).toEqual(ACCRUAL_2A_SORTED);
      expect(await advanceOf(c.id)).toEqual({ generic: '500.00', park: '0.00' });
      expect(await flowEntries(c.id, 'advance-consume-on-accrual')).toHaveLength(0);
      expect(await paidOf(c.id, 2)).toEqual({ amountPaid: '1515.83', status: 'PAID' }); // ไม่ถูกบวกด้วยยอดหัก
      expect(await balance(c.id, '21-1103', 'cr')).toBe('500.00');
      expect(await balance(c.id, '11-2103', 'dr')).toBe('0.00');
    });

    it('เงินสด 1,015.83 + หักเงินรับล่วงหน้า 500 ในใบเดียวกัน ปิดงวดก่อนครบกำหนด → ตั้งลูกหนี้งวด · การหักอยู่ในใบรับชำระ ไม่มีรายการหักแยก', async () => {
      const c = await seedContract({ dueDate: futureDue(), paymentRows: [1, 2, 3] });
      await record(c.id, 1, 2015.83, 'AAR-CONS-1');
      expect(await advanceOf(c.id)).toEqual({ generic: '500.00', park: '0.00' });

      const paid = await record(c.id, 2, 1015.83, 'AAR-CONS-2');
      expect(paid.status).toBe('PAID');

      const accruals = await accrualEntries((await scheduleOf(c.id, 2)).id);
      expect(accruals).toHaveLength(1);
      expect(sortedLines(accruals[0])).toEqual(ACCRUAL_2A_SORTED);
      expect(await advanceOf(c.id)).toEqual({ generic: '0.00', park: '0.00' });
      expect(await flowEntries(c.id, 'advance-consume-on-accrual')).toHaveLength(0);
      expect(await paidOf(c.id, 2)).toEqual({ amountPaid: '1515.83', status: 'PAID' });
      expect(await balance(c.id, '21-1103', 'cr')).toBe('0.00'); // Cr 500 (ใบงวด 1) − Dr 500 (ใบงวด 2)
      expect(await balance(c.id, '11-2103', 'dr')).toBe('0.00');
    });

    it('งวดสุดท้าย: มีเงินพักค่าปรับดิว 354 แล้วจ่ายสดเต็มงวด → 2A ใช้ยอดงวดสุดท้าย 1,515.87 และไม่หักเงินพัก', async () => {
      const c = await seedContract({ dueDate: futureDue(), paymentRows: [11, 12] });
      // ตั้งคอลัมน์ตรง ๆ (ดูหมายเหตุเหนือโค้ด) — เทสนี้ไม่ตรวจยอดบัญชี 21-1103
      await prisma.contract.update({
        where: { id: c.id },
        data: { rescheduleAdvanceBalance: D('354') },
      });

      const paid = await record(c.id, 12, 1515.83, 'AAR-CORE-3', { enforceSequence: false });
      expect(paid.status).toBe('PAID');
      expect(await statusOf(c.id)).toBe('ACTIVE'); // งวด 11 ยังค้าง สัญญาจึงยังไม่ปิด

      const accruals = await accrualEntries((await scheduleOf(c.id, 12)).id);
      expect(accruals).toHaveLength(1);
      expect(sortedLines(accruals[0])).toEqual(ACCRUAL_2A_LAST_SORTED);
      expect(await advanceOf(c.id)).toEqual({ generic: '0.00', park: '354.00' });
      expect(await flowEntries(c.id, 'reschedule-park-consume')).toHaveLength(0);
      expect(await paidOf(c.id, 12)).toEqual({ amountPaid: '1515.83', status: 'PAID' });
      // ใบรับชำระ: Dr เงินสด 1,515.83 + Dr 52-1104 0.04 / Cr 11-2103 1,515.87
      expect(await balance(c.id, '11-2103', 'dr')).toBe('0.00');
      expect(await balance(c.id, '52-1104', 'dr')).toBe('0.04');
    });

    it('สัญญาที่ยังไม่มีแถวตารางงวด → ตารางถูกสร้างและตั้งลูกหนี้งวดในธุรกรรมเดียวกัน', async () => {
      const c = await seedStandard17k12m(prisma);
      await new ContractActivation1ATemplate(journal, prisma as never).execute(c.id);
      await prisma.installmentSchedule.deleteMany({ where: { contractId: c.id } });
      for (const installmentNo of [1, 2]) {
        await prisma.payment.create({
          data: {
            contractId: c.id,
            installmentNo,
            dueDate: futureDue(),
            amountDue: D(INSTALLMENT_TOTAL),
            status: 'PENDING',
          },
        });
      }
      const paidDate = new Date();

      const paid = await record(c.id, 1, 1515.83, 'AAR-NOSCHED-1', { paidDate });
      expect(paid.status).toBe('PAID');

      // ensureInstallmentSchedules สร้าง 12 แถว (วันครบกำหนดงวด 1 = หนึ่งเดือนหลังวันสร้างสัญญา = อนาคต)
      expect(await prisma.installmentSchedule.count({ where: { contractId: c.id } })).toBe(12);
      const sched = await scheduleOf(c.id, 1);
      expect(sched.dueDate.getTime()).toBeGreaterThan(paidDate.getTime());
      const accruals = await accrualEntries(sched.id);
      expect(accruals).toHaveLength(1);
      expect(accruals[0].postedAt!.getTime()).toBe(paidDate.getTime());
      expect(await balance(c.id, '11-2103', 'dr')).toBe('0.00');
    });

    it('auto-allocate 3,500 ครอบ 2 งวดเต็ม + งวดที่ 3 บางส่วน 468.34 → 2 งวดตั้งทั้งงวด · งวดที่ 3 ตั้งเท่ายอดที่รับ 468.34', async () => {
      const c = await seedContract({ dueDate: futureDue(), paymentRows: [1, 2, 3, 4] });
      const before = Date.now();

      const res = await orchestrator.autoAllocatePayment(c.id, 3500, 'CASH', recordedById);
      expect(res.allocatedPayments.map((p) => p.status)).toEqual([
        'PAID',
        'PAID',
        'PARTIALLY_PAID',
      ]);

      for (const installmentNo of [1, 2]) {
        const accruals = await accrualEntries((await scheduleOf(c.id, installmentNo)).id);
        expect(accruals).toHaveLength(1);
        expect((accruals[0].metadata as Record<string, unknown>).trigger).toBe('receipt');
        expect(accruals[0].postedAt!.getTime()).toBeGreaterThanOrEqual(before);
        expect(accruals[0].postedAt!.getTime()).toBeLessThanOrEqual(Date.now());
      }
      const third = await scheduleOf(c.id, 3);
      expect(third.accrualJournalEntryId).toBeNull();
      const [thirdPartial] = await accrualEntries(third.id);
      expect(sortedLines(thirdPartial)).toEqual([
        '11-2101:0.00:437.70',
        '11-2103:468.34:0.00',
        '11-2105:0.00:30.64',
        '11-2106:154.48:0.00',
        '21-2101:0.00:30.64',
        '21-2102:30.64:0.00',
        '41-1101:0.00:154.48',
      ]);
      expect((await scheduleOf(c.id, 4)).accrualJournalEntryId).toBeNull();
      expect(await accrualEntries((await scheduleOf(c.id, 4)).id)).toHaveLength(0);
      expect(await balance(c.id, '11-2103', 'dr')).toBe('0.00');
      expect(await balance(c.id, '41-1101', 'cr')).toBe('1154.48'); // 2 × 500 + 154.48
      expect(await balance(c.id, '21-2101', 'cr')).toBe('228.98'); // 2 × 99.17 + 30.64
    });

    it('ใช้เครดิตคงเหลือชำระงวดที่ยังไม่ถึงกำหนดจนครบ → ตั้งลูกหนี้งวดก่อนล้างด้วยเครดิต', async () => {
      const c = await seedContract({ dueDate: futureDue(), paymentRows: [1, 2] });
      // ตั้งคอลัมน์ตรง ๆ (ดูหมายเหตุเหนือโค้ด) — เทสนี้ไม่ตรวจยอดบัญชี 21-5101
      await prisma.contract.update({ where: { id: c.id }, data: { creditBalance: D('1515.83') } });

      const res = await orchestrator.applyCreditBalance(c.id, recordedById);
      expect(res.allocatedPayments.map((p) => p.status)).toEqual(['PAID']);

      const accruals = await accrualEntries((await scheduleOf(c.id, 1)).id);
      expect(accruals).toHaveLength(1);
      expect((accruals[0].metadata as Record<string, unknown>).trigger).toBe('receipt');
      expect(await balance(c.id, '11-2103', 'dr')).toBe('0.00');
      expect(await balance(c.id, '41-1101', 'cr')).toBe('500.00');
    });

    it('งวดที่ถึงกำหนดไปแล้วแต่รอบกลางคืนตกหล่น จ่ายเต็มงวด → 2A ลงวันครบกำหนด ไม่ใช่วันรับเงิน', async () => {
      const pastDue = new Date(Date.now() - 3 * DAY_MS);
      const c = await seedContract({ dueDate: pastDue, paymentRows: [1, 2] });
      // ตัดเรื่องค่าปรับล่าช้าออกจากเทสนี้: แถวที่ lateFeeWaived = true ระบบไม่คิดค่าปรับใหม่
      // (กลวิธีเดียวกับ e2e/recordpayment-prior-partial.e2e-spec.ts)
      await prisma.payment.updateMany({
        where: { contractId: c.id },
        data: { lateFeeWaived: true },
      });

      const paidDate = new Date();
      const paid = await record(c.id, 1, 1515.83, 'AAR-PAST-1', { paidDate });
      expect(paid.status).toBe('PAID');

      const accruals = await accrualEntries((await scheduleOf(c.id, 1)).id);
      expect(accruals).toHaveLength(1);
      expect(accruals[0].postedAt!.getTime()).toBe(pastDue.getTime());
      expect((accruals[0].metadata as Record<string, unknown>).receiptDate).toBe(
        paidDate.toISOString(),
      );
      expect(await balance(c.id, '11-2103', 'dr')).toBe('0.00');
    });
  });

  describe('ใบรับชำระบางส่วน (คำตอบฝ่ายบัญชี ก1 29/09/2569)', () => {
    it('QR 1,000 ของงวดที่ยังไม่ถึงกำหนด → 2A เท่ายอดที่รับ แล้วใบรับชำระ Dr 11-1201 1,000 / Cr 11-2103 1,000', async () => {
      const c = await seedContract({ dueDate: futureDue(), paymentRows: [1, 2] });

      const paid = await recordPartialQr(c.id, 1, 1000, 'AAR-PART-1');
      expect(paid.status).toBe('PARTIALLY_PAID');

      const sched = await scheduleOf(c.id, 1);
      expect(sched.accrualJournalEntryId).toBeNull();
      const accruals = await accrualEntries(sched.id);
      expect(accruals).toHaveLength(1);
      expect(sortedLines(accruals[0])).toEqual(PART_1000_SORTED);
      expect(await entryCount(c.id)).toBe(3); // รายการเปิดสัญญา + 2A บางส่วน + ใบรับชำระ
      const receipts = await flowEntries(c.id, 'payment-receipt');
      expect(receipts).toHaveLength(1);
      expect(sortedLines(receipts[0])).toEqual(['11-1201:1000.00:0.00', '11-2103:0.00:1000.00']);
      expect(await balance(c.id, '11-2103', 'dr')).toBe('0.00');
      expect(await balance(c.id, '11-2101', 'dr')).toBe('16065.42'); // 17,000 − 934.58
      expect(await balance(c.id, '11-2106', 'cr')).toBe('5670.15'); // 6,000 − 329.85
      expect(await balance(c.id, '21-2102', 'cr')).toBe('1124.58'); // 1,190 − 65.42
      expect(await accruedOf(c.id, 1)).toEqual(['1000.00', '65.42', '329.85']);
      expect(await paidOf(c.id, 1)).toEqual({ amountPaid: '1000.00', status: 'PARTIALLY_PAID' });
    });

    it('QR 1,000 ของงวดที่ถึงกำหนดไปแล้วแต่รอบกลางคืนยังไม่ได้ตั้งลูกหนี้ → ไม่มี 2A (พฤติกรรมเดิม — รอบกลางคืนตั้งส่วนที่เหลือ)', async () => {
      const pastDue = new Date(Date.now() - 3 * DAY_MS);
      const c = await seedContract({ dueDate: pastDue, paymentRows: [1, 2] });
      await prisma.payment.updateMany({
        where: { contractId: c.id },
        data: { lateFeeWaived: true },
      });

      const paid = await recordPartialQr(c.id, 1, 1000, 'AAR-PART-2');
      expect(paid.status).toBe('PARTIALLY_PAID');

      const sched = await scheduleOf(c.id, 1);
      expect(sched.accrualJournalEntryId).toBeNull();
      expect(await accrualEntries(sched.id)).toHaveLength(0);
      expect(await balance(c.id, '11-2103', 'dr')).toBe('-1000.00');
      await expectNothingAccrued(c.id);
    });

    it('งวดสุดท้าย: QR 1,000 ขณะมีเงินพักค่าปรับดิว 354 → 2A เท่ายอดที่รับบนฐานงวดสุดท้าย (ดอกเบี้ย 329.83) เงินพักคงเดิม', async () => {
      const c = await seedContract({ dueDate: futureDue(), paymentRows: [11, 12] });
      await prisma.contract.update({
        where: { id: c.id },
        data: { rescheduleAdvanceBalance: D('354') },
      });

      const paid = await recordPartialQr(c.id, 12, 1000, 'AAR-PART-3');
      expect(paid.status).toBe('PARTIALLY_PAID');

      const sched = await scheduleOf(c.id, 12);
      expect(sched.accrualJournalEntryId).toBeNull();
      const [partial] = await accrualEntries(sched.id);
      expect(sortedLines(partial)).toEqual([
        '11-2101:0.00:934.58',
        '11-2103:1000.00:0.00',
        '11-2105:0.00:65.42',
        '11-2106:329.83:0.00',
        '21-2101:0.00:65.42',
        '21-2102:65.42:0.00',
        '41-1101:0.00:329.83',
      ]);
      expect(await advanceOf(c.id)).toEqual({ generic: '0.00', park: '354.00' });
      expect(await flowEntries(c.id, 'reschedule-park-consume')).toHaveLength(0);
      expect(await paidOf(c.id, 12)).toEqual({ amountPaid: '1000.00', status: 'PARTIALLY_PAID' });
      expect(await balance(c.id, '11-2103', 'dr')).toBe('0.00');
    });

    it('QR 800 ของงวด 3 ขณะงวด 1–2 ยังค้าง → 2A เท่ายอดที่รับเฉพาะงวด 3', async () => {
      const c = await seedContract({ dueDate: futureDue(), paymentRows: [1, 2, 3] });

      const paid = await recordPartialQr(c.id, 3, 800, 'AAR-PART-4');
      expect(paid.status).toBe('PARTIALLY_PAID');

      for (const installmentNo of [1, 2]) {
        expect(await accrualEntries((await scheduleOf(c.id, installmentNo)).id)).toHaveLength(0);
      }
      const [partial] = await accrualEntries((await scheduleOf(c.id, 3)).id);
      expect(sortedLines(partial)).toEqual([
        '11-2101:0.00:747.66',
        '11-2103:800.00:0.00',
        '11-2105:0.00:52.34',
        '11-2106:263.88:0.00',
        '21-2101:0.00:52.34',
        '21-2102:52.34:0.00',
        '41-1101:0.00:263.88',
      ]);
      expect(await balance(c.id, '11-2103', 'dr')).toBe('0.00');
      expect(await balance(c.id, '41-1101', 'cr')).toBe('263.88');
    });

    /** ContractPaymentService ของจริง — ต่อสายแบบเดียวกับ shop-collect-payoff.integration.spec.ts */
    const earlyPayoffService = () => {
      const journalForJp4 = new JournalAutoService(prisma as never);
      return new ContractPaymentService(
        prisma as never,
        new ProductsService(prisma as never),
        journalForJp4,
        new EarlyPayoffJP4Template(
          journalForJp4,
          prisma as never,
          new Vat60dayReversalTemplate(journalForJp4, prisma as never),
        ),
        new ShopCollectSettlementTemplate(journalForJp4, prisma as never),
        { generateReceipt: async () => undefined } as never,
        new EclStageReverseTemplate(journalForJp4, prisma as never),
      );
    };
    /** ผู้ขอ = ผู้อนุมัติ = OWNER (แบบเดียวกับ shop-collect-payoff.integration.spec.ts) */
    const ownerIdOf = async () =>
      (await prisma.user.findFirstOrThrow({ where: { email: 'admin@bestchoice.com' } })).id;

    it('ปิดยอดก่อนกำหนด (JP4) หลังงวด 1 รับบางส่วน 1,000 → JP4 ล้างเฉพาะส่วนที่ยังไม่ได้ตั้ง: ดอกเบี้ย/ภาษีขายไม่ถูกรับรู้ซ้ำ', async () => {
      const c = await seedContract({
        dueDate: futureDue(),
        paymentRows: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
      });
      await recordPartialQr(c.id, 1, 1000, 'AAR-JP4-1');
      expect(await accruedOf(c.id, 1)).toEqual(['1000.00', '65.42', '329.85']);

      const contractPayments = earlyPayoffService();
      const quote = await contractPayments.getEarlyPayoffQuote(c.id, 0, '11-1201');
      expect(quote.accruedUnpaid).toEqual({ amount: '1000.00', vat: '65.42', interest: '329.85' });

      await earlyPayoffWithApproval(prisma, contractPayments, c.id, await ownerIdOf(), {
        paymentMethod: 'BANK_TRANSFER',
        discountPct: 0,
        depositAccountCode: '11-1201',
      } as never);

      const [jp4] = await flowEntries(c.id, 'early-payoff');
      // 12 งวดค้าง: gross 16,999.92 − 934.58 · ดอกเบี้ย 6,000 − 329.85 · VAT 1,190.04 − 65.42 (ฐานนับงวดของ JP4)
      expect(sortedLines(jp4)).toEqual([
        '11-1201:17189.96:0.00',
        '11-2101:0.00:16065.34',
        '11-2105:0.00:1124.62',
        '11-2106:5670.15:0.00',
        '21-2101:0.00:1124.62',
        '21-2102:1124.62:0.00',
        '41-1101:0.00:5670.15',
      ]);
      // preview ที่พนักงานเห็นก่อนกดอนุมัติ (journalPreview) === รายการที่ลงจริง — สองฝั่งได้ accruedUnpaid ก้อนเดียวกัน
      expect(
        quote.journalPreview.lines.map((l) => `${l.accountCode}:${l.debit}:${l.credit}`).sort(),
      ).toEqual(sortedLines(jp4));
      // ดอกเบี้ยรับรู้รวมทั้งสัญญา = 329.85 (2A บางส่วน) + 5,670.15 (JP4) = 6,000.00 — ไม่ซ้ำ
      expect(await balance(c.id, '41-1101', 'cr')).toBe('6000.00');
      expect(await balance(c.id, '11-2106', 'cr')).toBe('0.00');
    });

    it('ปิดยอดก่อนกำหนด (JP4) ส่วนลด 50% หลังงวด 1 รับบางส่วน 1,000 → เงินสดในรายการ 14,354.88 / ส่วนลด 2,835.08 ขณะที่ลูกค้าจ่าย 14,657.33 (ส่วนลด 2,532.75) — ส่วนต่าง 302.45 (302.33 = เรื่องคำตอบข้อ 5.3 ที่ PR5 แก้ + 0.12 จากค่างวดของสัญญาทดสอบ) (ฐานของ PR5)', async () => {
      const c = await seedContract({
        dueDate: futureDue(),
        paymentRows: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
      });
      await recordPartialQr(c.id, 1, 1000, 'AAR-JP4-2');

      const contractPayments = earlyPayoffService();
      // ยอดที่ลูกค้าจ่าย (computePayoffQuote — ค่างวดของสัญญาทดสอบ 1,515.84): (18,190.08 − 1,000) − ส่วนลด 2,532.75
      const quote = await contractPayments.getEarlyPayoffQuote(c.id, 50, '11-1201');
      expect(quote.totalPayoff).toBe(14657.33);
      expect(quote.discountAmount).toBe(2532.75);

      await earlyPayoffWithApproval(prisma, contractPayments, c.id, await ownerIdOf(), {
        paymentMethod: 'BANK_TRANSFER',
        discountPct: 50,
        depositAccountCode: '11-1201',
      } as never);

      const [jp4] = await flowEntries(c.id, 'early-payoff');
      // ส่วนลด 52-1106 = HALF_UP(5,670.15 × 50%) — คิดจากดอกเบี้ยที่ยังไม่รับรู้ (คำตอบข้อ 5.2)
      // เงินสด = 16,065.34 − 2,835.08 + 1,124.62 (สูตรของรายการ ไม่ใช่เงินที่รับจริง — คำตอบข้อ 5.3 / PR5)
      expect(sortedLines(jp4)).toEqual([
        '11-1201:14354.88:0.00',
        '11-2101:0.00:16065.34',
        '11-2105:0.00:1124.62',
        '11-2106:5670.15:0.00',
        '21-2101:0.00:1124.62',
        '21-2102:1124.62:0.00',
        '41-1101:0.00:5670.15',
        '52-1106:2835.08:0.00',
      ]);
      // preview ที่พนักงานเห็นก่อนกดอนุมัติ (journalPreview) === รายการที่ลงจริง — สองฝั่งได้ accruedUnpaid ก้อนเดียวกัน
      expect(
        quote.journalPreview.lines.map((l) => `${l.accountCode}:${l.debit}:${l.credit}`).sort(),
      ).toEqual(sortedLines(jp4));
      const jeCash = new Decimal(
        jp4.lines.find((l) => l.accountCode === '11-1201')!.debit.toString(),
      );
      // 302.45 = ส่วนลด 2,835.08 − 2,532.75 (= 302.33 — เรื่องคำตอบข้อ 5.3) + 0.12 จากค่างวดของสัญญาทดสอบ 1,515.84
      // (quote ก่อนส่วนลด 17,190.08 เทียบรายการ 17,189.96 — ที่ส่วนลด 0% ก็ต่าง 0.12)
      expect(new Decimal(quote.totalPayoff).minus(jeCash).toFixed(2)).toBe('302.45');
      expect(await balance(c.id, '41-1101', 'cr')).toBe('6000.00');
    });

    it('ยึดเครื่อง (JP5) หลังงวด 1 รับบางส่วน 1,000 → ขาล้างตามยอดในบัญชี · งวดที่ตั้งบางส่วนนับเป็นงวดที่ยังไม่ตั้ง ไม่มีใบลดหนี้ VAT (ส่วนที่ตั้งแล้วรับเงินแล้ว)', async () => {
      const c = await seedContract({ dueDate: futureDue(), paymentRows: [1, 2] });
      await recordPartialQr(c.id, 1, 1000, 'AAR-JP5-1');

      await new RepossessionJP5Template(journal, prisma as never).execute({
        contractId: c.id,
        depositAccountCode: '11-1101',
        repossessionValue: D('5000.00'),
      });

      const [jp5] = await flowEntries(c.id, 'repossession');
      expect(sortedLines(jp5)).toEqual([
        '11-1101:5000.00:0.00',
        '11-2101:0.00:16065.42',
        '11-2105:0.00:1124.58',
        '11-2106:5670.15:0.00',
        '21-2101:0.00:1124.58', // ภาษีขายส่วนที่ยังไม่ตั้ง (รวมส่วนที่เหลือของงวด 1) ถึงกำหนด ม.82/3
        '21-2102:1124.58:0.00',
        '41-1101:0.00:5670.15',
        '51-1102:12190.00:0.00', // 17,000 + 1,190 − 1,000 (รับแล้ว) − 5,000 (ราคาเครื่อง)
      ]);
      const meta = jp5.metadata as Record<string, unknown>;
      expect(meta.accruedInstallments).toBe(0);
      expect(meta.deferredInstallments).toBe(12);
      // ทุกบัญชีของสัญญาเป็นศูนย์ · ภาษีขาย/ดอกเบี้ยรวม = ของทั้งสัญญาพอดี
      for (const [code, side] of [
        ['11-2101', 'dr'],
        ['11-2103', 'dr'],
        ['11-2105', 'dr'],
        ['11-2106', 'cr'],
        ['21-2102', 'cr'],
      ] as const) {
        expect(await balance(c.id, code, side)).toBe('0.00');
      }
      expect(await balance(c.id, '21-2101', 'cr')).toBe('1190.00'); // 65.42 + 1,124.58
      expect(await balance(c.id, '41-1101', 'cr')).toBe('6000.00'); // 329.85 + 5,670.15
    });
  });

  describe('สถานะสัญญา', () => {
    it('การรับเงินครั้งนี้ปิดสัญญา (บันทึกรับชำระงวดสุดท้ายล่วงหน้า) → สัญญาเป็น COMPLETED ในธุรกรรมเดียวกัน แต่ยังตั้งลูกหนี้งวด', async () => {
      const c = await seedContract({ dueDate: futureDue(), paymentRows: [12] });

      const paid = await record(c.id, 12, 1515.83, 'AAR-DONE-1');
      expect(paid.status).toBe('PAID');
      expect(await statusOf(c.id)).toBe('COMPLETED');

      const accruals = await accrualEntries((await scheduleOf(c.id, 12)).id);
      expect(accruals).toHaveLength(1);
      expect((accruals[0].metadata as Record<string, unknown>).trigger).toBe('receipt');
      expect(sortedLines(accruals[0])).toEqual(ACCRUAL_2A_LAST_SORTED);
      // ใบรับชำระ: Dr เงินสด 1,515.83 + Dr 52-1104 0.04 / Cr 11-2103 1,515.87
      expect(await balance(c.id, '11-2103', 'dr')).toBe('0.00');
      expect(await balance(c.id, '52-1104', 'dr')).toBe('0.04');
      expect(await balance(c.id, '41-1101', 'cr')).toBe('500.00');
    });

    it('การรับเงินครั้งนี้ปิดสัญญา (จัดสรรอัตโนมัติ 3,031.66 ปิดงวด 11 และ 12) → ตั้งลูกหนี้งวดครบทั้งสองงวด', async () => {
      const c = await seedContract({ dueDate: futureDue(), paymentRows: [11, 12] });

      const res = await orchestrator.autoAllocatePayment(c.id, 3031.66, 'CASH', recordedById);
      expect(res.allocatedPayments.map((p) => p.status)).toEqual(['PAID', 'PAID']);
      expect(await statusOf(c.id)).toBe('COMPLETED');

      for (const installmentNo of [11, 12]) {
        const accruals = await accrualEntries((await scheduleOf(c.id, installmentNo)).id);
        expect(accruals).toHaveLength(1);
        expect((accruals[0].metadata as Record<string, unknown>).trigger).toBe('receipt');
      }
      expect(await balance(c.id, '11-2103', 'dr')).toBe('0.00');
      expect(await balance(c.id, '41-1101', 'cr')).toBe('1000.00'); // 2 × 500
      expect(await balance(c.id, '52-1104', 'dr')).toBe('0.04'); // เศษของงวดสุดท้าย
    });

    it('การรับเงินครั้งนี้ปิดสัญญา (ใช้เครดิตคงเหลือปิดงวดสุดท้าย) → ยังตั้งลูกหนี้งวด', async () => {
      const c = await seedContract({ dueDate: futureDue(), paymentRows: [12] });
      await prisma.contract.update({ where: { id: c.id }, data: { creditBalance: D('1515.83') } });

      const res = await orchestrator.applyCreditBalance(c.id, recordedById);
      expect(res.allocatedPayments.map((p) => p.status)).toEqual(['PAID']);
      expect(await statusOf(c.id)).toBe('COMPLETED');

      const accruals = await accrualEntries((await scheduleOf(c.id, 12)).id);
      expect(accruals).toHaveLength(1);
      expect((accruals[0].metadata as Record<string, unknown>).trigger).toBe('receipt');
      expect(await balance(c.id, '11-2103', 'dr')).toBe('0.00');
      expect(await balance(c.id, '41-1101', 'cr')).toBe('500.00');
    });

    it('สัญญาบอกเลิกแล้ว (TERMINATED) แต่มีการใช้เครดิตคงเหลือชำระงวด → พฤติกรรมเดิม: มีใบรับชำระ ไม่ตั้งลูกหนี้งวด', async () => {
      const c = await seedContract({ dueDate: futureDue(), paymentRows: [1, 2] });
      await prisma.contract.update({
        where: { id: c.id },
        data: { status: 'TERMINATED', creditBalance: D('1515.83') },
      });

      const res = await orchestrator.applyCreditBalance(c.id, recordedById);
      expect(res.allocatedPayments.map((p) => p.status)).toEqual(['PAID']);
      expect(await statusOf(c.id)).toBe('TERMINATED');

      const sched = await scheduleOf(c.id, 1);
      expect(sched.accrualJournalEntryId).toBeNull();
      expect(await accrualEntries(sched.id)).toHaveLength(0);
      // ใบรับชำระลงตามเดิม: Dr 21-5101 1,515.83 / Cr 11-2103 1,515.83 — ไม่มี 2A มารองรับ
      expect(await balance(c.id, '11-2103', 'dr')).toBe('-1515.83');
      await expectNothingAccrued(c.id);
    });
  });

  describe('รอบกลางคืนเมื่อถึงวันครบกำหนด', () => {
    it('งวดที่จ่ายล่วงหน้าครบแล้ว ขณะลูกค้ามีเงินรับล่วงหน้า 800 → ไม่ลง 2A ซ้ำ และไม่หักเงินรับล่วงหน้าเข้างวดที่ชำระครบไปแล้ว', async () => {
      const c = await seedContract({ dueDate: futureDue(), paymentRows: [1, 2] });
      const paid = await record(c.id, 1, 2315.83, 'AAR-NIGHT-1'); // จ่ายเกิน 800
      expect(paid.status).toBe('PAID');
      expect(await advanceOf(c.id)).toEqual({ generic: '800.00', park: '0.00' });
      const sched = await scheduleOf(c.id, 1);
      expect(await accrualEntries(sched.id)).toHaveLength(1);
      await setDueDaysAgo(c.id, 1, 0);

      await runNightly();

      const accruals = await accrualEntries(sched.id);
      expect(accruals).toHaveLength(1); // ใบเดียว — ใบที่ลง ณ วันรับเงิน
      expect((accruals[0].metadata as Record<string, unknown>).trigger).toBe('receipt');
      expect(await flowEntries(c.id, 'advance-consume-on-accrual')).toHaveLength(0);
      expect(await advanceOf(c.id)).toEqual({ generic: '800.00', park: '0.00' }); // คงไว้หักงวดถัดไป
      expect(await paidOf(c.id, 1)).toEqual({ amountPaid: '1515.83', status: 'PAID' });
      expect(await balance(c.id, '11-2103', 'dr')).toBe('0.00');
      expect(await balance(c.id, '21-1103', 'cr')).toBe('800.00');
    });

    it('งวดที่รับบางส่วน 1,000 ก่อนครบกำหนด → รอบกลางคืนตั้งส่วนที่เหลือ 515.83 ลงวันครบกำหนด และประทับลิงก์', async () => {
      const c = await seedContract({ dueDate: futureDue(), paymentRows: [1, 2] });
      await recordPartialQr(c.id, 1, 1000, 'AAR-NIGHT-2');
      const sched = await scheduleOf(c.id, 1);
      expect(sched.accrualJournalEntryId).toBeNull();
      const due = await setDueDaysAgo(c.id, 1, 0);

      await runNightly();
      await runNightly(); // รันซ้ำต้องไม่ลงเพิ่ม

      const accruals = await accrualEntries(sched.id);
      expect(accruals).toHaveLength(2); // ใบบางส่วน + ส่วนที่เหลือ
      const remainder = accruals[1];
      expect(remainder.entryNumber).toBe((await scheduleOf(c.id, 1)).accrualJournalEntryId);
      expect(remainder.referenceId).toBe(sched.id);
      expect(remainder.postedAt!.getTime()).toBe(due.getTime());
      expect((remainder.metadata as Record<string, unknown>).trigger).toBeUndefined();
      expect((remainder.metadata as Record<string, unknown>).portion).toBe('remainder');
      expect(sortedLines(remainder)).toEqual(REST_515_SORTED);
      expect(await accruedOf(c.id, 1)).toEqual(['1515.83', '99.17', '500.00']);
      expect(await balance(c.id, '11-2103', 'dr')).toBe('515.83'); // ยังค้างจริง 1,515.83 − 1,000
      expect(await balance(c.id, '41-1101', 'cr')).toBe('500.00'); // 329.85 + 170.15
      expect(await paidOf(c.id, 1)).toEqual({ amountPaid: '1000.00', status: 'PARTIALLY_PAID' });
    });

    it('รับบางส่วน 1,000 ขณะลูกค้ามีเงินรับล่วงหน้า 2,000 → รอบกลางคืนตั้งส่วนที่เหลือ 515.83 และหักเงินรับล่วงหน้าเท่าที่ยังค้าง 515.83 (เดิมหักเต็มงวดเกินไป 1,000)', async () => {
      const c = await seedContract({ dueDate: futureDue(), paymentRows: [1, 2, 3] });
      await record(c.id, 1, 3515.83, 'AAR-NIGHT-3'); // จ่ายเกิน 2,000
      expect(await advanceOf(c.id)).toEqual({ generic: '2000.00', park: '0.00' });
      await recordPartialQr(c.id, 2, 1000, 'AAR-NIGHT-4');
      const sched = await scheduleOf(c.id, 2);
      expect(sched.accrualJournalEntryId).toBeNull();
      expect(await advanceOf(c.id)).toEqual({ generic: '2000.00', park: '0.00' }); // ใบบางส่วนไม่หัก
      await setDueDaysAgo(c.id, 2, 0);

      await runNightly();

      expect(await accrualEntries(sched.id)).toHaveLength(2); // ใบบางส่วน 1,000 + ส่วนที่เหลือ 515.83
      const consumes = await flowEntries(c.id, 'advance-consume-on-accrual');
      expect(consumes).toHaveLength(1);
      expect(sortedLines(consumes[0])).toEqual(['11-2103:0.00:515.83', '21-1103:515.83:0.00']);
      expect(await advanceOf(c.id)).toEqual({ generic: '1484.17', park: '0.00' });
      expect(await paidOf(c.id, 2)).toEqual({ amountPaid: '1515.83', status: 'PAID' });
      // งวด 1 สุทธิ 0 · งวด 2: Dr 1,000 + 515.83 (2A) − Cr 1,000 (ใบรับชำระ) − Cr 515.83 (หักเงินรับล่วงหน้า)
      expect(await balance(c.id, '11-2103', 'dr')).toBe('0.00');
      expect(await balance(c.id, '21-1103', 'cr')).toBe('1484.17');
    });

    it('ยอดเรียกเก็บ 1,516.00 · QR 1,000 ก่อนครบกำหนด · ลูกค้ามีเงินรับล่วงหน้า 2,000 → รอบกลางคืนหักเงินรับล่วงหน้า 515.83 (ยอดที่ยังค้างในบัญชี ไม่ใช่ 516.00 ของยอดเรียกเก็บ) · 11-2103 = 0 · แถวงวดค้าง 0.17', async () => {
      const c = await seedContract({ dueDate: futureDue(), paymentRows: [1, 2, 3] });
      await prisma.payment.updateMany({
        where: { contractId: c.id, installmentNo: 2 },
        data: { amountDue: D('1516.00') },
      });
      await record(c.id, 1, 3515.83, 'AAR-NIGHT-5'); // จ่ายเกิน 2,000 → เงินรับล่วงหน้า
      expect(await advanceOf(c.id)).toEqual({ generic: '2000.00', park: '0.00' });
      await recordPartialQr(c.id, 2, 1000, 'AAR-NIGHT-6');
      const sched = await scheduleOf(c.id, 2);
      await setDueDaysAgo(c.id, 2, 0);

      await runNightly();

      const consumes = await flowEntries(c.id, 'advance-consume-on-accrual');
      expect(consumes).toHaveLength(1);
      expect(sortedLines(consumes[0])).toEqual(['11-2103:0.00:515.83', '21-1103:515.83:0.00']);
      expect(await advanceOf(c.id)).toEqual({ generic: '1484.17', park: '0.00' });
      // 1,000 + 515.83 < ยอดเรียกเก็บ 1,516.00 → แถวงวดยังค้าง 0.17 (เศษของยอดเรียกเก็บ ไม่ใช่ลูกหนี้ในบัญชี)
      expect(await paidOf(c.id, 2)).toEqual({ amountPaid: '1515.83', status: 'PARTIALLY_PAID' });
      // 2A ของงวด 2 ทุกใบรวม = ยอดของงวดในบัญชีพอดี (ก่อน Task 4: ใบเดียวจากรอบกลางคืน · ตั้งแต่ Task 4: ใบบางส่วน + ส่วนที่เหลือ)
      const accrued2103 = (await accrualEntries(sched.id))
        .flatMap((e) => e.lines)
        .filter((l) => l.accountCode === '11-2103')
        .reduce((sum, l) => sum.plus(new Decimal(l.debit.toString())), new Decimal(0));
      expect(accrued2103.toFixed(2)).toBe('1515.83');
      expect(await balance(c.id, '11-2103', 'dr')).toBe('0.00');
      expect(await balance(c.id, '21-1103', 'cr')).toBe('1484.17');
    });
  });

  describe('ยกเลิกใบเสร็จของงวดที่ตั้งลูกหนี้ ณ วันรับเงิน', () => {
    /** ใบเสร็จล่าสุดที่ยังมีผลของงวด (ไม่รวมใบลดหนี้) */
    const receiptIdOf = async (contractId: string, installmentNo: number) => {
      const row = await paymentOf(contractId, installmentNo);
      const receipt = await prisma.receipt.findFirstOrThrow({
        where: {
          paymentId: row.id,
          receiptType: { not: 'CREDIT_NOTE' },
          isVoided: false,
          deletedAt: null,
        },
        orderBy: { createdAt: 'desc' },
      });
      return receipt.id;
    };

    const voidReceipt = (receiptId: string, reason: string) =>
      voidReceiptWithApproval(
        prisma,
        receiptsService,
        receiptId,
        reason,
        recordedById,
        approverId,
        'OWNER',
      );

    /** รายการกลับรายการตั้งลูกหนี้งวดที่ชี้ไปยังรายการ 2A ที่ระบุ */
    const accrualReversalsOf = (accrualEntryId: string) =>
      prisma.journalEntry.findMany({
        where: {
          AND: [
            { metadata: { path: ['flow'], equals: RECEIPT_ACCRUAL_VOID_FLOW } } as never,
            { metadata: { path: ['originalEntryId'], equals: accrualEntryId } } as never,
          ],
        },
        include: { lines: true },
      });

    const voidAudit = async (receiptId: string) => {
      const row = await prisma.auditLog.findFirstOrThrow({
        where: { action: 'RECEIPT_VOID', entity: 'receipt', entityId: receiptId },
        orderBy: { createdAt: 'desc' },
      });
      return row.newValue as Record<string, unknown>;
    };

    const isReversed = (entry: { metadata: unknown }) =>
      (entry.metadata as Record<string, unknown>).reversed === true;

    /**
     * จำลองว่า "วันนี้" คือ `at` และงวดบัญชี FINANCE ของเดือนนั้นปิดแล้วโดยไม่มีวันผ่อนผัน แล้วคืนค่าเดิม.
     * ปลอมเฉพาะ Date (แบบเดียวกับ interco-device-return.integration.spec.ts) — ตัวจับเวลาของ
     * Prisma ไม่ถูกแตะ
     */
    const withFinancePeriodClosed = async (at: Date, run: () => Promise<void>) => {
      const finance = await prisma.companyInfo.findFirstOrThrow({
        where: { companyCode: 'FINANCE' },
      });
      const key = { companyId: finance.id, year: at.getFullYear(), month: at.getMonth() + 1 };
      const period = await prisma.accountingPeriod.findUnique({
        where: { companyId_year_month: key },
      });
      const grace = await prisma.systemConfig.findUnique({ where: { key: 'period_grace_days' } });
      try {
        if (period) {
          await prisma.accountingPeriod.update({
            where: { id: period.id },
            data: { status: 'CLOSED' },
          });
        } else {
          await prisma.accountingPeriod.create({ data: { ...key, status: 'CLOSED' } });
        }
        await prisma.systemConfig.upsert({
          where: { key: 'period_grace_days' },
          update: { value: '0' },
          create: { key: 'period_grace_days', value: '0' },
        });
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(at);
        await run();
      } finally {
        vi.useRealTimers();
        if (period) {
          await prisma.accountingPeriod.update({
            where: { id: period.id },
            data: { status: period.status },
          });
        } else {
          await prisma.accountingPeriod.deleteMany({ where: key });
        }
        if (grace) {
          await prisma.systemConfig.update({
            where: { key: 'period_grace_days' },
            data: { value: grace.value },
          });
        } else {
          await prisma.systemConfig.deleteMany({ where: { key: 'period_grace_days' } });
        }
      }
    };

    it('ยกเลิกก่อนวันครบกำหนด → กลับใบรับชำระและกลับ 2A ทุกบัญชีของงวดกลับไปเท่าก่อนรับเงิน · ถึงวันครบกำหนดรอบกลางคืนตั้งลูกหนี้งวดครั้งเดียว', async () => {
      const c = await seedContract({ dueDate: futureDue(), paymentRows: [1, 2] });
      await record(c.id, 1, 1515.83, 'AAR-VOID-1');
      const sched = await scheduleOf(c.id, 1);
      const [accrual] = await accrualEntries(sched.id);
      const receiptId = await receiptIdOf(c.id, 1);

      const res = await voidReceipt(receiptId, 'ทดสอบยกเลิกใบเสร็จของงวดที่รับเงินก่อนครบกำหนด');
      expect(res.paymentReverted?.toStatus).toBe('PENDING');

      const reversals = await accrualReversalsOf(accrual.id);
      expect(reversals).toHaveLength(1);
      expect(reversals[0].status).toBe('POSTED');
      expect(reversals[0].referenceId).toBe(`${accrual.id}:accrual-void`);
      expect(sortedLines(reversals[0])).toEqual(ACCRUAL_2A_REVERSAL_SORTED);
      expect(reversals[0].metadata).toEqual({
        tag: 'REVERSAL',
        flow: 'receipt-accrual-void',
        idempotencyKey: `receipt-accrual-void:${accrual.id}`,
        originalEntryId: accrual.id,
        originalEntryNumber: accrual.entryNumber,
        contractId: c.id,
      });

      const original = await prisma.journalEntry.findUniqueOrThrow({ where: { id: accrual.id } });
      expect(original.status).toBe('POSTED');
      expect(original.referenceId).toBe(sched.id); // reference เดิมไม่ถูกแก้
      const originalMeta = original.metadata as Record<string, unknown>;
      expect(originalMeta.reversed).toBe(true);
      expect(originalMeta.reversedByEntryNumber).toBe(reversals[0].entryNumber);
      expect((await scheduleOf(c.id, 1)).accrualJournalEntryId).toBeNull();

      // ทุกบัญชีของงวดเท่ากับก่อนรับเงิน (เหลือเฉพาะรายการเปิดสัญญา)
      await expectNothingAccrued(c.id);
      expect(await balance(c.id, '11-2103', 'dr')).toBe('0.00');
      expect(await balance(c.id, '11-1101', 'dr')).toBe('0.00');
      expect(await paidOf(c.id, 1)).toEqual({ amountPaid: '0.00', status: 'PENDING' });
      expect((await voidAudit(receiptId)).accrualReversal).toEqual({
        reversed: true,
        entryNos: [reversals[0].entryNumber],
        accrualEntryNumbers: [accrual.entryNumber],
      });
      expect(await accruedOf(c.id, 1)).toEqual(['0.00', '0.00', '0.00']);

      // ถึงวันครบกำหนด: รอบกลางคืนตั้งลูกหนี้งวดใหม่ — รันสองรอบต้องได้ใบเดียว
      const due = await setDueDaysAgo(c.id, 1, 0);
      await runNightly();
      await runNightly();

      const all = await accrualEntries(sched.id);
      expect(all).toHaveLength(2); // ใบเดิมที่ถูกกลับ + ใบที่ตั้งใหม่
      const active = all.filter((e) => !isReversed(e));
      expect(active).toHaveLength(1);
      expect(active[0].referenceId).toBe(`${sched.id}:re-accrual:1`);
      expect(active[0].postedAt!.getTime()).toBe(due.getTime());
      expect((active[0].metadata as Record<string, unknown>).trigger).toBeUndefined();
      expect(sortedLines(active[0])).toEqual(ACCRUAL_2A_SORTED);
      expect((await scheduleOf(c.id, 1)).accrualJournalEntryId).toBe(active[0].entryNumber);
      expect(await balance(c.id, '11-2103', 'dr')).toBe('1515.83');
      expect(await balance(c.id, '41-1101', 'cr')).toBe('500.00');
      expect(await balance(c.id, '21-2101', 'cr')).toBe('99.17');
    });

    it('ยกเลิกแล้วรับชำระครบอีกครั้งก่อนครบกำหนด → ตั้งลูกหนี้งวดใหม่ ณ วันรับเงินครั้งใหม่ และยกเลิกได้อีกรอบ', async () => {
      const c = await seedContract({ dueDate: futureDue(), paymentRows: [1, 2] });
      await record(c.id, 1, 1515.83, 'AAR-VOID-2A');
      const sched = await scheduleOf(c.id, 1);
      await voidReceipt(await receiptIdOf(c.id, 1), 'ทดสอบยกเลิกใบเสร็จรอบที่หนึ่ง');

      const paidDate = new Date();
      const again = await record(c.id, 1, 1515.83, 'AAR-VOID-2B', { paidDate });
      expect(again.status).toBe('PAID');

      let all = await accrualEntries(sched.id);
      let active = all.filter((e) => !isReversed(e));
      expect(all).toHaveLength(2);
      expect(active).toHaveLength(1);
      expect(active[0].referenceId).toBe(`${sched.id}:re-accrual:1`);
      expect(active[0].postedAt!.getTime()).toBe(paidDate.getTime());
      expect((active[0].metadata as Record<string, unknown>).trigger).toBe('receipt');
      expect(await balance(c.id, '11-2103', 'dr')).toBe('0.00');
      expect(await balance(c.id, '41-1101', 'cr')).toBe('500.00');

      await voidReceipt(await receiptIdOf(c.id, 1), 'ทดสอบยกเลิกใบเสร็จรอบที่สอง');

      all = await accrualEntries(sched.id);
      active = all.filter((e) => !isReversed(e));
      expect(all).toHaveLength(2);
      expect(active).toHaveLength(0);
      expect(await accrualReversalsOf(all[1].id)).toHaveLength(1);
      expect((await scheduleOf(c.id, 1)).accrualJournalEntryId).toBeNull();
      await expectNothingAccrued(c.id);
      expect(await balance(c.id, '11-2103', 'dr')).toBe('0.00');
    });

    it('ยกเลิกในวันครบกำหนด → กลับเฉพาะใบรับชำระ รายการตั้งลูกหนี้งวดคงอยู่', async () => {
      const c = await seedContract({ dueDate: futureDue(), paymentRows: [1, 2] });
      await record(c.id, 1, 1515.83, 'AAR-VOID-3');
      const sched = await scheduleOf(c.id, 1);
      const [accrual] = await accrualEntries(sched.id);
      const receiptId = await receiptIdOf(c.id, 1);
      await setDueDaysAgo(c.id, 1, 0); // เวลาผ่านไปจนถึงวันครบกำหนด

      await voidReceipt(receiptId, 'ทดสอบยกเลิกใบเสร็จในวันครบกำหนด');

      expect(await accrualReversalsOf(accrual.id)).toHaveLength(0);
      const kept = await prisma.journalEntry.findUniqueOrThrow({ where: { id: accrual.id } });
      expect(isReversed(kept)).toBe(false);
      expect((await scheduleOf(c.id, 1)).accrualJournalEntryId).toBe(accrual.entryNumber);
      expect((await voidAudit(receiptId)).accrualReversal).toEqual({
        reversed: false,
        reason: 'DUE_DATE_REACHED',
      });
      expect(await balance(c.id, '11-2103', 'dr')).toBe('1515.83'); // ลูกหนี้งวดกลับมาค้าง
      expect(await balance(c.id, '41-1101', 'cr')).toBe('500.00');
      expect(await balance(c.id, '21-2101', 'cr')).toBe('99.17');
      expect((await paidOf(c.id, 1)).amountPaid).toBe('0.00');
    });

    it('งวดที่รอบกลางคืนตั้งลูกหนี้ → ยกเลิกใบเสร็จไม่กลับรายการตั้งลูกหนี้งวด แม้วันครบกำหนดถูกเลื่อนไปอนาคตภายหลัง', async () => {
      const c = await seedContract({ dueDate: futureDue(), paymentRows: [1, 2] });
      await prisma.payment.updateMany({
        where: { contractId: c.id },
        data: { lateFeeWaived: true },
      });
      await setDueDaysAgo(c.id, 1, 0);
      await runNightly();
      const sched = await scheduleOf(c.id, 1);
      const [accrual] = await accrualEntries(sched.id);
      expect((accrual.metadata as Record<string, unknown>).trigger).toBeUndefined();

      await record(c.id, 1, 1515.83, 'AAR-VOID-4');
      const receiptId = await receiptIdOf(c.id, 1);
      // วันครบกำหนดถูกเลื่อนไปอนาคต (เช่น ปรับดิว) หลังรอบกลางคืนตั้งลูกหนี้งวดไปแล้ว
      const future = futureDue();
      await prisma.installmentSchedule.update({
        where: { id: sched.id },
        data: { dueDate: future },
      });
      await prisma.payment.updateMany({
        where: { contractId: c.id, installmentNo: 1 },
        data: { dueDate: future },
      });

      await voidReceipt(receiptId, 'ทดสอบยกเลิกใบเสร็จของงวดที่รอบกลางคืนตั้งลูกหนี้');

      expect(await accrualReversalsOf(accrual.id)).toHaveLength(0);
      expect((await scheduleOf(c.id, 1)).accrualJournalEntryId).toBe(accrual.entryNumber);
      expect((await voidAudit(receiptId)).accrualReversal).toEqual({
        reversed: false,
        reason: 'NOT_POSTED_AT_RECEIPT',
      });
      expect(await balance(c.id, '11-2103', 'dr')).toBe('1515.83');
      expect(await balance(c.id, '41-1101', 'cr')).toBe('500.00');
    });

    it('ยกเลิกซ้ำ → ใบเสร็จที่ยกเลิกแล้วถูกปฏิเสธ และการกลับรายการตั้งลูกหนี้งวดรอบที่สองของรายการเดิมไม่ลงอะไรเพิ่ม', async () => {
      const c = await seedContract({ dueDate: futureDue(), paymentRows: [1, 2] });
      await record(c.id, 1, 1515.83, 'AAR-VOID-5');
      const sched = await scheduleOf(c.id, 1);
      const [accrual] = await accrualEntries(sched.id);
      const receiptId = await receiptIdOf(c.id, 1);
      await voidReceipt(receiptId, 'ทดสอบยกเลิกใบเสร็จครั้งแรก');
      const entriesAfterFirst = await entryCount(c.id);

      // (1) ยกเลิกใบเดิมซ้ำผ่านคิวอนุมัติ — ถูกปฏิเสธที่ด่าน "ใบเสร็จถูกยกเลิกไปแล้ว" ก่อนถึงการกลับรายการ
      await expect(voidReceipt(receiptId, 'ทดสอบยกเลิกใบเสร็จซ้ำ')).rejects.toThrow();
      expect(await entryCount(c.id)).toBe(entriesAfterFirst);

      // (2) ให้การกลับรายการตั้งลูกหนี้งวดทำงานรอบที่สองกับรายการเดิมจริง ๆ: ชี้ลิงก์ของงวดกลับไปที่รายการ
      // 2A ที่ถูกกลับไปแล้ว (สภาพที่การลองซ้ำจะพบ) แล้วเรียกในธุรกรรมแบบเดียวกับการยกเลิกใบเสร็จ
      const template = new ReceiptVoidReversalTemplate(journal, prisma as never);
      const second = await prisma.$transaction(async (tx) => {
        await tx.installmentSchedule.update({
          where: { id: sched.id },
          data: { accrualJournalEntryId: accrual.entryNumber },
        });
        return template.voidAccrualPostedAtReceipt(sched.id, tx);
      });

      expect(second.result).toEqual({ reversed: false, reason: 'ALREADY_REVERSED' });
      expect(second.warnings).toHaveLength(1); // ส่งหลัง commit โดยผู้เรียก — ที่นี่ไม่ถูกส่ง
      expect(await accrualReversalsOf(accrual.id)).toHaveLength(1);
      expect(await entryCount(c.id)).toBe(entriesAfterFirst);
      const original = await prisma.journalEntry.findUniqueOrThrow({ where: { id: accrual.id } });
      expect((original.metadata as Record<string, unknown>).reversedByEntryNumber).toBe(
        (await accrualReversalsOf(accrual.id))[0].entryNumber,
      );
      await expectNothingAccrued(c.id);
      expect(await balance(c.id, '11-2103', 'dr')).toBe('0.00');
    });

    it('ก1: รับบางส่วน 1,000 แล้วรับ 515.83 ก่อนครบกำหนด → ยกเลิกใบเสร็จ = กลับ 2A ทั้งสองใบ ทุกบัญชีกลับไปเท่าก่อนรับเงิน · ถึงวันครบกำหนดรอบกลางคืนตั้งทั้งงวดใหม่', async () => {
      const c = await seedContract({ dueDate: futureDue(), paymentRows: [1, 2] });
      await recordPartialQr(c.id, 1, 1000, 'AAR-VOIDP-1');
      await record(c.id, 1, 515.83, 'AAR-VOIDP-2');
      const sched = await scheduleOf(c.id, 1);
      const [partial, remainder] = await accrualEntries(sched.id);
      const receiptId = await receiptIdOf(c.id, 1);

      const res = await voidReceipt(receiptId, 'ทดสอบยกเลิกใบเสร็จของงวดที่ตั้งลูกหนี้สองรายการ');
      expect(res.paymentReverted?.toStatus).toBe('PENDING');

      const partialReversals = await accrualReversalsOf(partial.id);
      const remainderReversals = await accrualReversalsOf(remainder.id);
      expect(partialReversals).toHaveLength(1);
      expect(remainderReversals).toHaveLength(1);
      expect(sortedLines(partialReversals[0])).toEqual([
        '11-2101:934.58:0.00',
        '11-2103:0.00:1000.00',
        '11-2105:65.42:0.00',
        '11-2106:0.00:329.85',
        '21-2101:65.42:0.00',
        '21-2102:0.00:65.42',
        '41-1101:329.85:0.00',
      ]);
      expect((await voidAudit(receiptId)).accrualReversal).toEqual({
        reversed: true,
        entryNos: [partialReversals[0].entryNumber, remainderReversals[0].entryNumber],
        accrualEntryNumbers: [partial.entryNumber, remainder.entryNumber],
      });
      const after = await scheduleOf(c.id, 1);
      expect(after.accrualJournalEntryId).toBeNull();
      expect(await accruedOf(c.id, 1)).toEqual(['0.00', '0.00', '0.00']);
      await expectNothingAccrued(c.id);
      expect(await balance(c.id, '11-2103', 'dr')).toBe('0.00');

      // ถึงวันครบกำหนด: ตั้งทั้งงวดใหม่ — `<id>` ถูกใบเดิม (กลับแล้ว) ถือ จึงได้ re-accrual:1
      await setDueDaysAgo(c.id, 1, 0);
      await runNightly();
      const live = await liveAccrualEntries(sched.id);
      expect(live).toHaveLength(1);
      expect(live[0].referenceId).toBe(`${sched.id}:re-accrual:1`);
      expect(sortedLines(live[0])).toEqual(ACCRUAL_2A_SORTED);
      expect(await balance(c.id, '11-2103', 'dr')).toBe('1515.83');
    });

    it('ก1: ยกเลิกใบบางส่วนก่อนครบกำหนด แล้วรับบางส่วนใหม่ → ใบใหม่ได้ reference `<id>:receipt-accrual:2`', async () => {
      const c = await seedContract({ dueDate: futureDue(), paymentRows: [1, 2] });
      await recordPartialQr(c.id, 1, 1000, 'AAR-VOIDP-3');
      const sched = await scheduleOf(c.id, 1);
      await voidReceipt(await receiptIdOf(c.id, 1), 'ทดสอบยกเลิกใบเสร็จบางส่วน');
      expect(await accruedOf(c.id, 1)).toEqual(['0.00', '0.00', '0.00']);

      await recordPartialQr(c.id, 1, 600, 'AAR-VOIDP-4');

      const live = await liveAccrualEntries(sched.id);
      expect(live).toHaveLength(1);
      expect(live[0].referenceId).toBe(`${sched.id}:receipt-accrual:2`);
      expect(await accruedOf(c.id, 1)).toEqual(['600.00', '39.25', '197.91']);
      expect(await balance(c.id, '11-2103', 'dr')).toBe('0.00');
    });

    it('ก1: รับบางส่วนก่อนครบกำหนด ยกเลิกหลังวันครบกำหนด (รอบกลางคืนตั้งส่วนที่เหลือแล้ว) → ไม่กลับ 2A ใดเลย', async () => {
      const c = await seedContract({ dueDate: futureDue(), paymentRows: [1, 2] });
      await prisma.payment.updateMany({
        where: { contractId: c.id },
        data: { lateFeeWaived: true },
      });
      await recordPartialQr(c.id, 1, 1000, 'AAR-VOIDP-5');
      const sched = await scheduleOf(c.id, 1);
      await setDueDaysAgo(c.id, 1, 1);
      await runNightly();
      const before = await accrualEntries(sched.id);
      expect(before).toHaveLength(2);
      const receiptId = await receiptIdOf(c.id, 1);

      await voidReceipt(receiptId, 'ทดสอบยกเลิกใบเสร็จหลังวันครบกำหนด');

      for (const e of before) expect(await accrualReversalsOf(e.id)).toHaveLength(0);
      expect((await voidAudit(receiptId)).accrualReversal).toEqual({
        reversed: false,
        reason: 'DUE_DATE_REACHED',
      });
      expect(await accruedOf(c.id, 1)).toEqual(['1515.83', '99.17', '500.00']);
      expect(await balance(c.id, '11-2103', 'dr')).toBe('1515.83'); // ลูกหนี้งวดกลับมาค้างเต็มงวด
      expect(await balance(c.id, '41-1101', 'cr')).toBe('500.00');
    });

    it('ก1: ใบบางส่วนที่ถูกกลับไปแล้วจากการยกเลิกครั้งก่อน → ยกเลิกครั้งถัดไปไม่กลับใบนั้นซ้ำ และยังกลับใบที่ยังมีผล', async () => {
      const c = await seedContract({ dueDate: futureDue(), paymentRows: [1, 2] });
      await recordPartialQr(c.id, 1, 1000, 'AAR-VOIDP-6');
      const sched = await scheduleOf(c.id, 1);
      await voidReceipt(await receiptIdOf(c.id, 1), 'ทดสอบยกเลิกใบเสร็จบางส่วนรอบที่หนึ่ง');
      await recordPartialQr(c.id, 1, 600, 'AAR-VOIDP-7');
      const [first, second] = await accrualEntries(sched.id);
      expect(first.referenceId).toBe(`${sched.id}:receipt-accrual:1`);
      expect(isReversed(first)).toBe(true);
      expect(second.referenceId).toBe(`${sched.id}:receipt-accrual:2`);
      expect(isReversed(second)).toBe(false);
      const firstReversals = await accrualReversalsOf(first.id);
      expect(firstReversals).toHaveLength(1);
      const receiptId = await receiptIdOf(c.id, 1);

      const res = await voidReceipt(receiptId, 'ทดสอบยกเลิกใบเสร็จบางส่วนรอบที่สอง');
      expect(res.paymentReverted?.toStatus).toBe('PENDING');

      // ใบแรก (ประวัติ) ไม่ถูกกลับซ้ำ — ยังมีรายการกลับใบเดิมใบเดียว · ใบที่สองถูกกลับหนึ่งใบ
      expect((await accrualReversalsOf(first.id)).map((e) => e.id)).toEqual(
        firstReversals.map((e) => e.id),
      );
      const secondReversals = await accrualReversalsOf(second.id);
      expect(secondReversals).toHaveLength(1);
      expect(sortedLines(secondReversals[0])).toEqual([
        '11-2101:560.75:0.00',
        '11-2103:0.00:600.00',
        '11-2105:39.25:0.00',
        '11-2106:0.00:197.91',
        '21-2101:39.25:0.00',
        '21-2102:0.00:39.25',
        '41-1101:197.91:0.00',
      ]);
      expect(await flowEntries(c.id, RECEIPT_ACCRUAL_VOID_FLOW)).toHaveLength(2);
      expect((await voidAudit(receiptId)).accrualReversal).toEqual({
        reversed: true,
        entryNos: [secondReversals[0].entryNumber],
        accrualEntryNumbers: [second.entryNumber],
      });
      expect(await liveAccrualEntries(sched.id)).toHaveLength(0);
      expect(await accruedOf(c.id, 1)).toEqual(['0.00', '0.00', '0.00']);
      await expectNothingAccrued(c.id);
      expect(await balance(c.id, '11-2103', 'dr')).toBe('0.00');
    });

    it('ก1: ใบบางส่วนหลายใบ (500 / 600) + ใบที่ทำให้ครบ 415.83 → ยกเลิกก่อนครบกำหนดกลับครบทุกใบตามลำดับที่ลง', async () => {
      const c = await seedContract({ dueDate: futureDue(), paymentRows: [1, 2] });
      await recordPartialQr(c.id, 1, 500, 'AAR-VOIDP-8');
      await recordPartialQr(c.id, 1, 600, 'AAR-VOIDP-9');
      await recordPartialQr(c.id, 1, 415.83, 'AAR-VOIDP-10');
      const sched = await scheduleOf(c.id, 1);
      const accruals = await accrualEntries(sched.id);
      expect(accruals.map((e) => e.referenceId)).toEqual([
        `${sched.id}:receipt-accrual:1`,
        `${sched.id}:receipt-accrual:2`,
        sched.id,
      ]);
      const receiptId = await receiptIdOf(c.id, 1);

      const res = await voidReceipt(receiptId, 'ทดสอบยกเลิกใบเสร็จของงวดที่ตั้งลูกหนี้สามรายการ');
      expect(res.paymentReverted?.toStatus).toBe('PENDING');

      const perAccrual = await Promise.all(accruals.map((e) => accrualReversalsOf(e.id)));
      expect(perAccrual.map((found) => found.length)).toEqual([1, 1, 1]);
      const reversals = perAccrual.map((found) => found[0]);
      expect(reversals.map((r) => sortedLines(r).find((l) => l.startsWith('11-2103:')))).toEqual([
        '11-2103:0.00:500.00',
        '11-2103:0.00:600.00',
        '11-2103:0.00:415.83',
      ]);
      expect((await voidAudit(receiptId)).accrualReversal).toEqual({
        reversed: true,
        entryNos: reversals.map((r) => r.entryNumber),
        accrualEntryNumbers: accruals.map((e) => e.entryNumber),
      });
      expect(await liveAccrualEntries(sched.id)).toHaveLength(0);
      expect((await scheduleOf(c.id, 1)).accrualJournalEntryId).toBeNull();
      expect(await accruedOf(c.id, 1)).toEqual(['0.00', '0.00', '0.00']);
      await expectNothingAccrued(c.id);
      expect(await balance(c.id, '11-2103', 'dr')).toBe('0.00');
    });

    it('งวดบัญชีของวันที่ยกเลิกปิดแล้ว → การยกเลิกถูกปฏิเสธเหมือนที่เป็นอยู่ ไม่มีรายการใดเปลี่ยน', async () => {
      const c = await seedContract({ dueDate: futureDue(), paymentRows: [1, 2] });
      await record(c.id, 1, 1515.83, 'AAR-VOID-6');
      const sched = await scheduleOf(c.id, 1);
      const receiptId = await receiptIdOf(c.id, 1);
      const entriesBefore = await entryCount(c.id);

      // validatePeriodOpen ปฏิเสธเมื่อ "ตอนนี้" เลยวันสุดท้ายของเดือนที่ปิด + วันผ่อนผัน:
      // จำลองว่าวันนี้คือวันสุดท้ายของเดือนนี้ 12:00 (เวลาของเครื่อง) และไม่มีวันผ่อนผัน
      const today = new Date();
      const voidAt = new Date(today.getFullYear(), today.getMonth() + 1, 0, 12, 0, 0);
      await withFinancePeriodClosed(voidAt, async () => {
        await expect(
          voidReceipt(receiptId, 'ทดสอบยกเลิกใบเสร็จเมื่องวดบัญชีปิดแล้ว'),
        ).rejects.toThrow('ไม่สามารถบันทึกรายการในงวดที่ปิดแล้ว');
      });

      const receipt = await prisma.receipt.findUniqueOrThrow({ where: { id: receiptId } });
      expect(receipt.isVoided).toBe(false);
      expect((await scheduleOf(c.id, 1)).accrualJournalEntryId).toBe(sched.accrualJournalEntryId);
      expect(await entryCount(c.id)).toBe(entriesBefore);
      expect(await balance(c.id, '11-2103', 'dr')).toBe('0.00');
      expect(await paidOf(c.id, 1)).toEqual({ amountPaid: '1515.83', status: 'PAID' });
    });
  });
});
