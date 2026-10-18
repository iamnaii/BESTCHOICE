/**
 * ภ.พ.30 — ภาษีขายคำนวณที่เดียว: ทุกผู้ใช้ตัวเลขได้ยอดเดียวกันบนฐานข้อมูลจริง (2026-09-30)
 *
 * Runner: vitest (DB-backed; jest ignores *.integration.spec.ts ตาม package.json testPathIgnorePatterns)
 * Run:    cd apps/api && npx vitest run --no-file-parallelism \
 *           src/modules/accounting/pp30-output-vat.integration.spec.ts
 * CI:     .github/workflows/deploy-gcp.yml — ACCT_FILES=$(ls src/modules/accounting/*.integration.spec.ts)
 *
 * ผู้ใช้ตัวเลขที่ต้องได้ยอดเดียวกัน: ตัวคำนวณ `computePp30OutputVat` · `TaxPreviewService.previewPP30`
 * (GET /tax/pp30-preview + ไฟล์ส่งออก) · `FinanceTaxService.getVatMonthly` (หน้า /finance/vat) ·
 * `TaxReportService.generate` (POST /tax/generate) · snapshot ปิดงวด (`MonthlyCloseService.generateReportSnapshots`)
 *
 * นาฬิกาถูกตรึงที่ 15 ต.ค. 2569 12:00 น. เวลาไทย เพราะรายการกลับรายการ / ภาษีขาย 60 วัน / JP5 ลงวันที่ "ตอนนี้"
 *
 * สัญญา ก (17,000 / 12 งวด — seedStandard17k12m):
 *   2A งวด 1 (ครบกำหนด 5 ต.ค.)                        Cr 21-2101  99.17
 *   2A งวด 2 (ครบกำหนด 1 ต.ค. 00:00 น. เวลาไทย)         Cr 21-2101  99.17  ← 2026-09-30T17:00Z ต้องนับเป็นตุลาคม
 *   กลับรายการ 2A งวด 1 (engine กระจกกลาง tag REVERSAL)  Dr 21-2101  99.17
 *   ภาษีขาย 60 วัน งวด 3 และงวด 4                        Cr 21-2103  99.17 × 2
 *   กลับภาษีขาย 60 วัน งวด 4                             Dr 21-2103  99.17
 * สัญญา ข (Scenario A ของ jp5-vat-split.spec.ts): 2A งวด 1-4 (ปี 2568) · งวด 1-3 ชำระแล้ว · JP5 @ 5,000
 *   ใบลดหนี้ ม.82/5 ของงวด 4                            Dr 21-2101  99.17
 *   ภาษีขายถึงกำหนด (21-2102 คงเหลือ 1,190 − 4 × 99.17)    Cr 21-2101 793.32
 *
 * ตุลาคม: เครดิต 21-2101 = 99.17 + 99.17 + 793.32 = 991.66 · หักกลับรายการ 99.17 · หักใบลดหนี้ 99.17
 *   ⇒ 21-2101 สุทธิ 793.32 · ภาษีขาย 60 วัน (21-2103) สุทธิ 198.34 − 99.17 = 99.17 · ภาษีขาย ภ.พ.30 = 892.49
 *   (PP30_INCLUDES_MANDATORY_60DAY = true ตั้งแต่ 16/10/2569 — ฝ่ายบัญชีข้อ 11.1; ระหว่าง 30/09–16/10 ไม่รวม = 793.32)
 *   (ของเดิม: preview ที่นับแต่เครดิต 21-2101 + 21-2103 = 991.66 + 198.34 = 1,190.00)
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { Prisma, PrismaClient } from '@prisma/client';
import { seedFinanceCoa } from '../../../prisma/seed-coa-finance';
import { seedStandard17k12m } from '../journal/__tests__/scenario-helpers';
import { JournalAutoService } from '../journal/journal-auto.service';
import { ContractActivation1ATemplate } from '../journal/cpa-templates/contract-activation-1a.template';
import { InstallmentAccrual2ATemplate } from '../journal/cpa-templates/installment-accrual-2a.template';
import { ExchangeCancelReversalTemplate } from '../journal/cpa-templates/exchange-cancel-reversal.template';
import { Vat60dayMandatoryTemplate } from '../journal/cpa-templates/vat-60day-mandatory.template';
import { Vat60dayReversalTemplate } from '../journal/cpa-templates/vat-60day-reversal.template';
import { RepossessionJP5Template } from '../journal/cpa-templates/repossession-jp5.template';
import { computePp30OutputVat, toPp30OutputVatJson } from '../tax/pp30-output-vat';
import { ADVANCE_VAT_META } from '../journal/advance-vat';
import { TaxPreviewService } from '../tax/services/tax-preview.service';
import { TaxReportService } from '../tax/services/tax-report.service';
import { TaxExportService } from '../tax/services/tax-export.service';
import { TaxService } from '../tax/tax.service';
import { FinanceTaxService } from '../finance-tax/finance-tax.service';
import { MonthlyCloseService } from './monthly-close.service';
import type { AccountingService } from './accounting.service';
import type { PeakService } from '../peak/peak.service';
import type { AuditService } from '../audit/audit.service';
import type { GenerateTaxReportDto } from '../tax/dto/tax.dto';

const prisma = new PrismaClient();

/** 15 ต.ค. 2569 12:00 น. เวลาไทย */
const NOW = new Date('2026-10-15T05:00:00.000Z');
const D = (value: string) => new Prisma.Decimal(value);
const money = (value: unknown) => new Prisma.Decimal(String(value)).toFixed(2);

let financeId = '';
let adminId = '';

type SnapshotAccess = {
  generateReportSnapshots(
    companyId: string,
    year: number,
    month: number,
  ): Promise<Record<string, unknown>>;
};

async function ensureFinanceCompany(): Promise<string> {
  const existing = await prisma.companyInfo.findFirst({ where: { companyCode: 'FINANCE' } });
  if (existing) return existing.id;
  const created = await prisma.companyInfo.create({
    data: {
      nameTh: 'BESTCHOICE FINANCE',
      taxId: '0000000000002',
      companyCode: 'FINANCE',
      address: '1 Finance Rd.',
      directorName: 'Test Director',
      vatRegistered: true,
      vatRate: D('0.0700'),
    },
  });
  return created.id;
}

async function ensureAdmin(): Promise<string> {
  const existing = await prisma.user.findFirst({ where: { email: 'admin@bestchoice.com' } });
  if (existing) return existing.id;
  const created = await prisma.user.create({
    data: { email: 'admin@bestchoice.com', password: 'x', name: 'admin', role: 'OWNER' },
  });
  return created.id;
}

/** ผู้ใช้ตัวเลข ภ.พ.30 ทุกตัว ประกอบจาก service จริง (ส่วนที่ snapshot ปิดงวดไม่ได้ใช้เป็น stub) */
function consumers() {
  const preview = new TaxPreviewService(prisma as any);
  const report = new TaxReportService(prisma as any, preview);
  const tax = new TaxService(preview, report, new TaxExportService(preview));
  const accountingStub = {
    getBranchIdsForCompany: async () => [],
    getTrialBalance: async () => ({}),
    getProfitLossReport: async () => ({}),
    getBalanceSheet: async () => ({}),
  } as unknown as AccountingService;
  const monthlyClose = new MonthlyCloseService(
    prisma as any,
    new JournalAutoService(prisma as any),
    tax,
    accountingStub,
    undefined as unknown as PeakService,
    undefined as unknown as AuditService,
  );
  return {
    preview,
    report,
    finance: new FinanceTaxService(prisma as any),
    monthlyClose: monthlyClose as unknown as SnapshotAccess,
  };
}

/** อ่านภาษีขายของเดือนจากผู้ใช้ตัวเลขทุกตัว */
async function readAll(year: number, month: number) {
  const { preview, report, finance, monthlyClose } = consumers();
  const helper = await computePp30OutputVat(prisma, { companyId: financeId, year, month });
  const pp30 = await preview.previewPP30(financeId, year, month);
  const vatPage = await finance.getVatMonthly(year, month);
  const snapshot = await monthlyClose.generateReportSnapshots(financeId, year, month);
  const taxReport = await report.generate(
    {
      companyId: financeId,
      reportType: 'PP30',
      reportYear: year,
      reportMonth: month,
    } as GenerateTaxReportDto,
    adminId,
  );
  const vatSummary = snapshot.vatSummary as {
    totalVatOutput: Prisma.Decimal;
    outputVatBreakdown: unknown;
  };
  return { helper, pp30, vatPage, vatSummary, taxReport };
}

/** ทุกผู้ใช้ตัวเลขต้องได้ยอดและรายละเอียดเดียวกับตัวคำนวณ */
function expectAllAgree(r: Awaited<ReturnType<typeof readAll>>, totalOutputVat: string) {
  const expected = toPp30OutputVatJson(r.helper);
  expect(expected.totalOutputVat).toBe(totalOutputVat);
  expect(r.pp30.outputVatBreakdown).toEqual(expected);
  expect(r.vatPage.outputVat).toEqual(expected);
  expect(r.vatSummary.outputVatBreakdown).toEqual(expected);
  expect((r.taxReport.generatedData as { outputVatBreakdown: unknown }).outputVatBreakdown).toEqual(
    expected,
  );
  expect(money(r.pp30.totalVatOutput)).toBe(totalOutputVat);
  expect(r.vatPage.vatOutput).toBe(totalOutputVat);
  expect(money(r.vatSummary.totalVatOutput)).toBe(totalOutputVat);
  expect(money(r.taxReport.totalVatOutput)).toBe(totalOutputVat);
}

describe('ภ.พ.30 — ภาษีขายคำนวณที่เดียว (ฐานข้อมูลจริง)', () => {
  beforeAll(async () => {
    // ล้างตารางบัญชีแบบเดียวกับ jp5-vat-split.spec.ts (journalPostAuditLog อ้างอิง journal_entries ต้องล้างก่อน)
    await prisma.journalPostAuditLog.deleteMany({});
    await prisma.journalLine.deleteMany({});
    await prisma.journalEntry.deleteMany({});
    await prisma.receipt.deleteMany({});
    await prisma.eDocument.deleteMany({});
    await prisma.signature.deleteMany({});
    await prisma.contractDocument.deleteMany({});
    await prisma.partialPaymentLink.deleteMany({});
    await prisma.warrantyAuditLog.deleteMany({});
    await prisma.promiseSlot.deleteMany({});
    await prisma.callLog.deleteMany({});
    await prisma.dunningAction.deleteMany({});
    await prisma.repossession.deleteMany({});
    await prisma.installmentSchedule.deleteMany({});
    await prisma.payment.deleteMany({});
    // T1-C7 guard: สัญญาที่ถูกตัดหนี้สูญจริงมีแถว badDebtWriteOffAuditLog (immutable) อ้างอิงอยู่
    const woPoisoned = await prisma.badDebtWriteOffAuditLog.findMany({
      select: { contractId: true },
    });
    await prisma.contract.deleteMany({
      where: { id: { notIn: woPoisoned.map((p) => p.contractId) } },
    });
    await seedFinanceCoa(prisma);
    financeId = await ensureFinanceCompany();
    adminId = await ensureAdmin();
    await prisma.taxReport.deleteMany({
      where: {
        companyId: financeId,
        reportType: 'PP30',
        reportYear: 2026,
        reportMonth: { in: [9, 10, 11, 12] },
      },
    });

    // สร้างสัญญาก่อนตรึงนาฬิกา — เลขสัญญาของ seedStandard17k12m ใช้ Date.now()
    const contractA = (await seedStandard17k12m(prisma)).id;
    const contractB = (await seedStandard17k12m(prisma)).id;
    const contractC = (await seedStandard17k12m(prisma)).id;

    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);

    const journal = new JournalAutoService(prisma as any);
    const activate = new ContractActivation1ATemplate(journal, prisma as any);
    const accrue = new InstallmentAccrual2ATemplate(journal, prisma as any);
    await activate.execute(contractA);
    await activate.execute(contractB);
    await activate.execute(contractC);

    // สัญญา ก — 2A งวด 1 และงวด 2 ลงเดือนตุลาคม (2A ลงวันที่ = วันครบกำหนด)
    const instA = await prisma.installmentSchedule.findMany({
      where: { contractId: contractA },
      orderBy: { installmentNo: 'asc' },
    });
    await prisma.installmentSchedule.update({
      where: { id: instA[0].id },
      data: { dueDate: new Date('2026-10-04T17:00:00.000Z') }, // 5 ต.ค. 00:00 น. เวลาไทย
    });
    await prisma.installmentSchedule.update({
      where: { id: instA[1].id },
      data: { dueDate: new Date('2026-09-30T17:00:00.000Z') }, // 1 ต.ค. 00:00 น. เวลาไทย (ขอบเดือน)
    });
    await accrue.execute(instA[0].id);
    await accrue.execute(instA[1].id);

    // กลับรายการ 2A งวด 1 ด้วย engine กระจกกลาง (tag REVERSAL — รูปเดียวกับการยกเลิกใบเสร็จของ PR #1654)
    const inst1 = await prisma.installmentSchedule.findUniqueOrThrow({
      where: { id: instA[0].id },
    });
    const accrual1 = await prisma.journalEntry.findUniqueOrThrow({
      where: { entryNumber: inst1.accrualJournalEntryId! },
    });
    await new ExchangeCancelReversalTemplate(journal, prisma as any).reverse({
      jeIds: [accrual1.id],
    });

    // ภาษีขาย 60 วัน งวด 3 + งวด 4 แล้วกลับของงวด 4 (ลงวันที่ตอนนี้ = 15 ต.ค.)
    const mandatory = new Vat60dayMandatoryTemplate(journal, prisma as any);
    await mandatory.execute(instA[2].id);
    await mandatory.execute(instA[3].id);
    await new Vat60dayReversalTemplate(journal, prisma as any).execute(instA[3].id);

    // สัญญา ข — Scenario A: 2A งวด 1-4 · งวด 1-3 ชำระแล้ว · JP5 @ 5,000 (ลงวันที่ตอนนี้ = 15 ต.ค.)
    const instB = await prisma.installmentSchedule.findMany({
      where: { contractId: contractB },
      orderBy: { installmentNo: 'asc' },
    });
    for (let i = 0; i < 4; i++) await accrue.execute(instB[i].id);
    for (let i = 0; i < 3; i++) {
      await prisma.payment.create({
        data: {
          contractId: contractB,
          installmentNo: instB[i].installmentNo,
          dueDate: instB[i].dueDate,
          amountDue: D('1515.83'),
          amountPaid: D('1515.83'),
          paidDate: NOW,
          paidAt: NOW,
          status: 'PAID',
        },
      });
    }
    await new RepossessionJP5Template(journal, prisma as any).execute({
      contractId: contractB,
      depositAccountCode: '11-1101',
      repossessionValue: D('5000.00'),
    });

    // PR4 ต10 (หมายเหตุ 5) — สัญญา ค: G1/G2 ข้ามเดือน. พ.ย.: รับค่าปรับดิว 6a 1,419.00 → ภาษีขายรับรู้ ณ วันรับ 92.83
    // (รายการเดียวกับเงิน — stamp advanceVatPark · รูปเดียวกับที่ reschedule-collect.service ลง · ลงตรงเพื่อกำหนดวันที่)
    // ธ.ค.: รอบกลางคืนงวดสุดท้าย (งวด 12 ครบกำหนด 1 ธ.ค.) ตั้งลูกหนี้งวด 99.13 และหักเงินพักเข้างวดพร้อมขากลับ 92.83
    // (template จริง — stamp advanceVatConsume) ⇒ พ.ย. 92.83 · ธ.ค. สุทธิ 99.13 − 92.83 = 6.30 (ไม่ใช่ 7/107 ของเงินสด)
    await prisma.contract.update({
      where: { id: contractC },
      data: { rescheduleAdvanceBalance: D('1419.00') },
    });
    await journal.createAndPost({
      description: 'ปรับดิวงวด #1 — สัญญา ค (เลื่อน 28 วัน, 6a)',
      companyId: financeId,
      postedAt: new Date('2026-11-15T05:00:00.000Z'), // 15 พ.ย. 12:00 น. เวลาไทย
      metadata: {
        tag: 'reschedule-collect',
        flow: 'reschedule-collect',
        contractId: contractC,
        [ADVANCE_VAT_META.park]: '92.83',
      },
      lines: [
        { accountCode: '11-1201', dr: D('1419.00'), cr: D('0') },
        { accountCode: '21-1103', dr: D('0'), cr: D('1419.00') },
        { accountCode: '21-2102', dr: D('92.83'), cr: D('0') },
        { accountCode: '21-2101', dr: D('0'), cr: D('92.83') },
      ],
    });
    const instC = await prisma.installmentSchedule.findMany({
      where: { contractId: contractC },
      orderBy: { installmentNo: 'asc' },
    });
    const instC12 = instC[11];
    await prisma.installmentSchedule.update({
      where: { id: instC12.id },
      data: { dueDate: new Date('2026-11-30T17:00:00.000Z') }, // 1 ธ.ค. 00:00 น. เวลาไทย
    });
    await prisma.payment.create({
      data: {
        contractId: contractC,
        installmentNo: 12,
        dueDate: new Date('2026-11-30T17:00:00.000Z'),
        amountDue: D('1515.87'),
        status: 'PENDING',
      },
    });
    await accrue.execute(instC12.id);

    // F1 (fix round 2, 2026-09-30): รายการปิด/ชำระภาษีขาย ภ.พ.30 ที่แตะทั้ง 21-2101 และ 21-2103 พร้อมกัน (Cr 21-3201)
    // ในเดือนเดียวกัน — ทั้งสองขาต้องไม่กระทบตัวเลขของผู้ใช้คนไหนเลย (round 1 กันฝั่ง 21-2101 ไว้แล้ว แต่ฝั่ง 21-2103
    // ยังรั่วเข้า mandatory60Day ก่อนแก้). เขียนตรงผ่าน JournalAutoService (ไม่มี template เฉพาะสำหรับรายการปิดภาษี)
    await journal.createAndPost({
      description: 'ปิด/ชำระภาษีขาย ภ.พ.30 — ทดสอบ F1 (ต้องไม่กระทบยอดใดๆ)',
      companyId: financeId,
      postedAt: NOW,
      lines: [
        { accountCode: '21-2101', dr: D('99.17'), cr: D('0') },
        { accountCode: '21-2103', dr: D('99.17'), cr: D('0') },
        { accountCode: '21-3201', dr: D('0'), cr: D('198.34') },
      ],
    });
  });

  afterAll(async () => {
    vi.useRealTimers();
    if (financeId) {
      await prisma.taxReport.deleteMany({
        where: {
          companyId: financeId,
          reportType: 'PP30',
          reportYear: 2026,
          reportMonth: { in: [9, 10, 11, 12] },
        },
      });
    }
    await prisma.$disconnect();
  });

  it('ตุลาคม: ทุกผู้ใช้ตัวเลขได้ 892.49 — 21-2101 สุทธิ 793.32 (หักกลับรายการ 99.17 และใบลดหนี้ 99.17) + ภาษีขาย 60 วันสุทธิ 99.17', async () => {
    const r = await readAll(2026, 10);

    // ตัวเลขข้างล่างนี้ (991.66 / 198.34 / 793.32 / 60 วัน 198.34·99.17·99.17) เหมือนเดิมทุกประการแม้ beforeAll
    // จะเพิ่มรายการปิด/ชำระภาษีขายที่แตะทั้ง 21-2101 และ 21-2103 พร้อมกัน (Cr 21-3201) — พิสูจน์ F1 (fix round 2):
    // รายการปิดภาษีไม่กระทบตัวเลขใดๆ เลย ไม่ว่าจะแตะบัญชีไหน (ก่อนแก้ round 2, mandatory60DayDebit จะกลายเป็น
    // 198.34 และ mandatory60DayNet จะกลายเป็น 0.00 เพราะฝั่ง 21-2103 ของรายการปิดรั่วเข้ามา)
    expect(toPp30OutputVatJson(r.helper)).toEqual({
      settledGross: '991.66',
      reductionReversal: '99.17',
      reductionCreditNote: '99.17',
      reductionAdvanceApplied: '0.00',
      reductionOther: '0.00',
      reductionTotal: '198.34',
      settledNet: '793.32',
      mandatory60DayCredit: '198.34',
      mandatory60DayDebit: '99.17',
      mandatory60DayNet: '99.17',
      mandatory60DayIncluded: true,
      totalOutputVat: '892.49',
    });
    expectAllAgree(r, '892.49');
    // ภาษีขาย 60 วันยังแยกให้เห็น และรวมสุทธิในยอดแล้ว
    expect(money(r.pp30.totalVatMandatory60Day)).toBe('99.17');
    expect(money(r.pp30.totalVatSettled)).toBe('793.32');
    // FINANCE ไม่มีสาขาและไม่มีภาษีซื้อในสถานการณ์นี้ ⇒ ภาษีที่ต้องชำระ = ภาษีขาย
    expect(money(r.pp30.netVat)).toBe('892.49');
    expect(r.vatPage.netVat).toBe('892.49');
    expect(money(r.taxReport.netVat)).toBe('892.49');
    // ที่มาของยอดที่ลด ระบุรายการได้
    expect(r.helper.reductionLines.map((l) => [l.kind, l.amount.toFixed(2)]).sort()).toEqual([
      ['CREDIT_NOTE', '99.17'],
      ['REVERSAL', '99.17'],
    ]);
  });

  it('กันยายน: ศูนย์ — 2A ที่ลง 1 ต.ค. 00:00 น. เวลาไทย (2026-09-30T17:00Z) ไม่ตกไปเดือนก่อน', async () => {
    const sep = await readAll(2026, 9);

    expectAllAgree(sep, '0.00');
    expect(sep.vatPage.outputVat.totalOutputVat).toBe('0.00');
  });

  it('PR4 ต10 — พฤศจิกายน: รับค่าปรับดิว 6a 1,419.00 → ภาษีขาย 92.83 รับรู้ ณ วันรับเงิน (G1) ทุกผู้ใช้ตัวเลขตรงกัน', async () => {
    const nov = await readAll(2026, 11);

    expect(toPp30OutputVatJson(nov.helper)).toMatchObject({
      settledGross: '92.83',
      reductionTotal: '0.00',
      reductionAdvanceApplied: '0.00',
      settledNet: '92.83',
      totalOutputVat: '92.83',
    });
    expectAllAgree(nov, '92.83');
  });

  it('PR4 ต10 — ธันวาคม: งวด 12 ตั้ง 99.13 · เงินพักถูกหักเข้างวด ขากลับ 92.83 จัดเป็น ADVANCE_APPLIED (ไม่ใช่ "อื่น ๆ") ⇒ สุทธิ 6.30 (G2)', async () => {
    const dec = await readAll(2026, 12);

    expect(toPp30OutputVatJson(dec.helper)).toEqual({
      settledGross: '99.13',
      reductionReversal: '0.00',
      reductionCreditNote: '0.00',
      reductionAdvanceApplied: '92.83',
      reductionOther: '0.00',
      reductionTotal: '92.83',
      settledNet: '6.30',
      mandatory60DayCredit: '0.00',
      mandatory60DayDebit: '0.00',
      mandatory60DayNet: '0.00',
      mandatory60DayIncluded: true,
      totalOutputVat: '6.30',
    });
    expectAllAgree(dec, '6.30');
    expect(dec.helper.reductionLines.map((l) => [l.kind, l.amount.toFixed(2)])).toEqual([
      ['ADVANCE_APPLIED', '92.83'],
    ]);
    // ผู้ใช้ตัวเลขฝั่ง preview ส่ง kind ต่อ (ไม่มี switch ที่ตัด kind ใหม่ทิ้ง)
    expect(dec.pp30.lineItems.outputVatReductions.map((r) => [r.kind, money(r.vatAmount)])).toEqual(
      [['ADVANCE_APPLIED', '92.83']],
    );
  });
});
