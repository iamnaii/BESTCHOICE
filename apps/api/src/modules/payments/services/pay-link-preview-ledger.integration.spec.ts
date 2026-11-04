/**
 * Task 42 รีวิว I1 — แถว "นำไปชำระ (งวดเก่าก่อน)" ของหน้า `/pay/:token` แบ่งค่างวด / ค่าปรับ **ตรงกับรายการบัญชีที่ webhook ลงจริง** — ต่อฐานข้อมูลจริง
 * ด้วยรายการบัญชีจริงทั้งหมด (ไม่ตั้ง `amountPaid` ตรง ๆ · ไม่จำลอง `PaymentReceiptTemplate`):
 *
 *   1. สัญญามาตรฐาน + 1A · งวด 1–2 เลยกำหนด ตั้งลูกหนี้งวด (2A) ด้วยตัวของรอบกลางคืน
 *   2. ลูกค้าจ่ายที่สาขา 900 ของงวด 1 ผ่าน `PaymentReceiptOrchestrator.recordPayment` ตัวจริง — ค่าปรับ 100 เกิดแล้ว
 *      ⇒ ใบรับชำระลงค่าปรับก่อน: Cr 42-1103 100 / Cr 11-2103 800
 *   3. ลิงก์แจ้งล็อก (AMOUNT · DEVICE_LOCKED) ยอดค้าง 2,331.66 → `PaymentLinkService.resolvePaymentLink` (`GET /line-oa/pay/:token`)
 *   4. เงินเข้าผ่าน webhook PaySolutions ตัวจริง (แถวติดตามชี้ลิงก์ต้นทางแบบที่ intent สร้าง)
 *   ⇒ แถวค่างวดของแต่ละงวด = Cr 11-2103 ของใบรับชำระที่ webhook ลง · แถวค่าปรับ = Cr 42-1103 · งวด 1 ไม่มีแถวค่าปรับ (ใบ 900 ลงไปแล้ว)
 *
 * Runner: vitest (jest ข้าม `*.integration.spec.ts`) · CI เก็บผ่าน `PAYMENTS_FILES`
 * (`src/modules/payments/services/*.integration.spec.ts` ใน .github/workflows/deploy-gcp.yml) — ไม่ต้องแก้ workflow.
 * Run: cd apps/api && npx vitest run --no-file-parallelism \
 *        src/modules/payments/services/pay-link-preview-ledger.integration.spec.ts
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { AccountingPeriodStatus, PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { seedFinanceCoa } from '../../../../prisma/seed-coa-finance';
import { seedStandard17k12m } from '../../journal/__tests__/scenario-helpers';
import { JournalAutoService } from '../../journal/journal-auto.service';
import { ContractActivation1ATemplate } from '../../journal/cpa-templates/contract-activation-1a.template';
import { InstallmentAccrual2ATemplate } from '../../journal/cpa-templates/installment-accrual-2a.template';
import { PaymentReceiptTemplate } from '../../journal/cpa-templates/payment-receipt.template';
import { ReceiptVoidReversalTemplate } from '../../journal/cpa-templates/receipt-void-reversal.template';
import { ReceiptsService } from '../../receipts/receipts.service';
import { PaySolutionsService } from '../../paysolutions/paysolutions.service';
import { PaymentLinkService } from '../../line-oa/payment-links/payment-link.service';
import { PaymentReceiptOrchestrator } from './payment-receipt-orchestrator';
import { accountingPeriodOf } from '../../../utils/period-lock.util';
import { upsertSystemUser } from '../../../../prisma/seeds/collections-foundation.seed';
import { lockPaidUnlockTodoKey } from '../../paysolutions/services/lock-paid-unlock-todo';

const prisma = new PrismaClient();
const D = (n: string) => new Decimal(n);
const DAY_MS = 86_400_000;

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

const reopenedFinancePeriods: { id: string; status: AccountingPeriodStatus }[] = [];

/** เปิดงวดของ FINANCE ทุกเดือนที่ไฟล์นี้ลงรายการ (ย้อนหลัง 40 วัน ถึงพรุ่งนี้) — คืนค่าใน afterAll */
async function ensureFinancePeriodsOpen(): Promise<void> {
  const finance = await prisma.companyInfo.findFirstOrThrow({ where: { companyCode: 'FINANCE' } });
  const months = new Map<string, { year: number; month: number }>();
  for (let offset = -40; offset <= 1; offset++) {
    const { year, month } = accountingPeriodOf(new Date(Date.now() + offset * DAY_MS));
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

async function restoreFinancePeriods(): Promise<void> {
  const rows = reopenedFinancePeriods.splice(0);
  for (const status of new Set(rows.map((r) => r.status))) {
    await prisma.accountingPeriod.updateMany({
      where: { id: { in: rows.filter((r) => r.status === status).map((r) => r.id) } },
      data: { status },
    });
  }
}

async function cleanLedger(): Promise<void> {
  await prisma.todo.deleteMany({ where: { requestKey: { startsWith: 'lock-paid-unlock:' } } });
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

/** Σ Cr ของบัญชีในรายการ */
const credit = (lines: { accountCode: string; credit: unknown }[], code: string) =>
  lines
    .filter((l) => l.accountCode === code)
    .reduce((s, l) => s.plus(String(l.credit)), new Decimal(0))
    .toNumber();

describe('หน้า /pay/:token — แถวนำไปชำระ = รายการบัญชีที่ webhook ลงจริง (integration · รีวิว I1)', () => {
  let journal: JournalAutoService;
  let orchestrator: PaymentReceiptOrchestrator;
  let paysolutions: PaySolutionsService;
  let links: PaymentLinkService;
  let recordedById: string;

  beforeAll(async () => {
    await cleanLedger();
    await seedFinanceCoa(prisma);
    await ensureFinanceCompany();
    await ensureSystemAdminUser();
    await ensureFinancePeriodsOpen();
    await upsertSystemUser(prisma); // ผู้สร้างงานปลดล็อค (CI ไม่ seed)

    journal = new JournalAutoService(prisma as never);
    const receiptTemplate = new PaymentReceiptTemplate(journal, prisma as never);
    const receiptsService = new ReceiptsService(
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
    paysolutions = new PaySolutionsService(
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
    links = new PaymentLinkService(
      { get: (_k: string, def?: unknown) => def } as never,
      prisma as never,
      {
        generateQrDataUrl: async () => null,
        getAccountName: () => 'บริษัท ทดสอบ',
        getMaskedPromptPayId: () => 'xxx-xxx-0000',
      } as never,
      {} as never,
      {} as never,
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

  it('งวด 1 จ่ายที่สาขา 900 ตอนมีค่าปรับแล้ว → หน้าเว็บ: งวด 1 ค่างวดคงเหลือ 715.83 (ไม่มีค่าปรับซ้ำ) · งวด 2 ค่างวด + ค่าปรับ = Cr 11-2103 / Cr 42-1103 ของ webhook', async () => {
    // 1 — สัญญา + 1A · งวด 1 เลยกำหนด 20 วัน · งวด 2 เลยกำหนด 10 วัน · งวดอื่นยังไม่ถึงกำหนด
    const c = await seedStandard17k12m(prisma);
    await new ContractActivation1ATemplate(journal, prisma as never).execute(c.id);
    const dueOf = (no: number) =>
      no === 1
        ? new Date(Date.now() - 20 * DAY_MS)
        : no === 2
          ? new Date(Date.now() - 10 * DAY_MS)
          : new Date(Date.now() + 60 * DAY_MS);
    const schedules = await prisma.installmentSchedule.findMany({
      where: { contractId: c.id },
      select: { id: true, installmentNo: true },
    });
    for (const s of schedules) {
      await prisma.installmentSchedule.update({
        where: { id: s.id },
        data: { dueDate: dueOf(s.installmentNo) },
      });
    }
    const schedId = (no: number) => schedules.find((s) => s.installmentNo === no)!.id;
    for (const installmentNo of [1, 2, 3]) {
      await prisma.payment.create({
        data: {
          contractId: c.id,
          installmentNo,
          dueDate: dueOf(installmentNo),
          amountDue: D('1515.83'),
          // ค่าปรับของงวด 2 = ที่รอบเลยกำหนดตั้งไว้ (ขั้นบันได ≥ 3 วัน = 100) · งวด 1 หน้ารับชำระคิดเองตอนรับเงิน
          lateFee: D(installmentNo === 2 ? '100.00' : '0'),
          status: installmentNo === 3 ? 'PENDING' : 'OVERDUE',
        },
      });
    }
    // ตั้งลูกหนี้งวดของงวดที่ถึงกำหนดแล้ว (ตัวเดียวกับรอบกลางคืน)
    const accrual = new InstallmentAccrual2ATemplate(journal, prisma as never);
    await accrual.execute(schedId(1));
    await accrual.execute(schedId(2));

    // 2 — ลูกค้าจ่ายที่สาขา 900 ของงวด 1 (เส้นทางจริงของหน้ารับชำระ)
    await orchestrator.recordPayment(
      c.id,
      1,
      900,
      'CASH',
      recordedById,
      undefined, // evidenceUrl
      undefined, // notes
      'T42-BRANCH-900',
      '11-1101',
      undefined, // toleranceApproverId
      'PARTIAL',
    );
    const branchReceipt = await prisma.journalEntry.findFirstOrThrow({
      where: {
        AND: [
          { metadata: { path: ['tag'], equals: 'receipt' } },
          { metadata: { path: ['installmentScheduleId'], equals: schedId(1) } },
        ],
      },
      include: { lines: true },
    });
    // ค่าปรับก่อน (ใบเสร็จพิมพ์ค่าปรับ 100 แล้ว)
    expect([
      credit(branchReceipt.lines, '42-1103'),
      credit(branchReceipt.lines, '11-2103'),
    ]).toEqual([100, 800]);
    const first = await prisma.payment.findFirstOrThrow({
      where: { contractId: c.id, installmentNo: 1 },
    });
    expect([first.amountPaid.toFixed(2), first.lateFee.toFixed(2), first.status]).toEqual([
      '900.00',
      '100.00',
      'PARTIALLY_PAID',
    ]);

    // 3 — ลิงก์แจ้งล็อก ยอดค้างรวม (715.83 + 1,615.83) → หน้า /pay/:token
    const link = await links.createPaymentLink(c.id, undefined, {
      amount: 2331.66,
      purpose: 'AMOUNT',
      sourceEvent: 'DEVICE_LOCKED',
    });
    const view = await links.resolvePaymentLink(link.token);
    if (!view.valid) throw new Error('ลิงก์เปิดไม่ได้');
    expect(view.amountKind).toBe('OUTSTANDING');
    expect(view.allocation).toEqual([
      { kind: 'INSTALLMENT_REMAINING', installmentNo: 1, amount: 715.83 },
      { kind: 'INSTALLMENT', installmentNo: 2, amount: 1515.83 },
      { kind: 'LATE_FEE', installmentNo: 2, amount: 100 },
    ]);

    // 4 — เงินเข้า: แถวติดตามแบบที่ intent สร้าง (ชี้ลิงก์ต้นทาง) แล้ว webhook ตัวจริง
    const source = await prisma.paymentLink.findUniqueOrThrow({ where: { token: link.token } });
    const refno = String(Date.now()).slice(-12);
    await prisma.paymentLink.create({
      data: {
        token: refno,
        contractId: c.id,
        amount: D('2331.66'),
        purpose: 'AMOUNT',
        sourceLinkId: source.id,
        status: 'ACTIVE',
        expiresAt: new Date(Date.now() + 30 * 60 * 1000),
      },
    });
    await paysolutions.handlePaymentCallback({
      refno,
      result_code: '00',
      order_no: 't42-o-1',
      transaction_id: 't42-tx-1',
      total: '2331.66',
    });

    // รายการรับชำระที่ webhook ลง (ไม่รวมใบ 900 ของสาขา)
    const posted = new Map<number, { principal: number; fee: number }>();
    for (const no of [1, 2, 3]) {
      const entries = await prisma.journalEntry.findMany({
        where: {
          id: { not: branchReceipt.id },
          AND: [
            { metadata: { path: ['tag'], equals: 'receipt' } },
            { metadata: { path: ['installmentScheduleId'], equals: schedId(no) } },
          ],
        },
        include: { lines: true },
      });
      if (entries.length === 0) continue;
      const lines = entries.flatMap((e) => e.lines);
      posted.set(no, {
        principal: credit(lines, '11-2103') + credit(lines, '53-1503'),
        fee: credit(lines, '42-1103'),
      });
    }
    expect(posted).toEqual(
      new Map([
        [1, { principal: 715.83, fee: 0 }],
        [2, { principal: 1515.83, fee: 100 }],
      ]),
    );

    // แถวของหน้าเว็บต่องวด = ที่บัญชีลง (ค่างวด = Cr 11-2103 · ค่าปรับ = Cr 42-1103)
    const preview = new Map<number, { principal: number; fee: number }>();
    for (const row of view.allocation ?? []) {
      if (row.kind === 'SURPLUS') continue;
      const cur = preview.get(row.installmentNo) ?? { principal: 0, fee: 0 };
      if (row.kind === 'LATE_FEE') cur.fee = row.amount;
      else cur.principal = row.amount;
      preview.set(row.installmentNo, cur);
    }
    expect(preview).toEqual(posted);

    // งานปลดล็อค (หลัง commit) — ผู้รับ = เจ้าของที่ active คนแรก (รีวิว M2) · มีทางสำรองเมื่อการ์ด MDM ไม่มีปุ่ม
    const todo = await prisma.todo.findUniqueOrThrow({
      where: { requestKey: lockPaidUnlockTodoKey(source.id) },
    });
    const firstOwner = await prisma.user.findFirstOrThrow({
      where: { role: 'OWNER', isActive: true, deletedAt: null },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    expect([todo.priority, todo.assigneeId]).toEqual(['HIGH', firstOwner.id]);
    expect(todo.description).toContain('แจ้งเจ้าของ');
  }, 120_000);
});
