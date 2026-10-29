import { Prisma, PrismaClient } from '@prisma/client';
import { seedFinanceCoa } from '../../../../prisma/seed-coa-finance';
import { PeakExportService } from '../../../modules/accounting/peak-export.service';
import { ContractPaymentService } from '../../../modules/contracts/contract-payment.service';
import { CustomerPiiService } from '../../../modules/customers/customer-pii.service';
import { CompanyResolverService } from '../../../modules/journal/company-resolver.service';
import { BadDebtWriteOffTemplate } from '../../../modules/journal/cpa-templates/bad-debt-writeoff.template';
import { ContractActivation1ATemplate } from '../../../modules/journal/cpa-templates/contract-activation-1a.template';
import { EarlyPayoffJP4Template } from '../../../modules/journal/cpa-templates/early-payoff-jp4.template';
import { EclStageReverseTemplate } from '../../../modules/journal/cpa-templates/ecl-stage-reverse.template';
import { InstallmentAccrual2ATemplate } from '../../../modules/journal/cpa-templates/installment-accrual-2a.template';
import { PaymentReceiptTemplate } from '../../../modules/journal/cpa-templates/payment-receipt.template';
import { ReceiptVoidReversalTemplate } from '../../../modules/journal/cpa-templates/receipt-void-reversal.template';
import { RepossessionJP5Template } from '../../../modules/journal/cpa-templates/repossession-jp5.template';
import { ShopCollectSettlementTemplate } from '../../../modules/journal/cpa-templates/shop-collect-settlement.template';
import { Vat60dayReversalTemplate } from '../../../modules/journal/cpa-templates/vat-60day-reversal.template';
import { glContractBalance } from '../../../modules/journal/gl-contract-balance';
import { JournalAutoService } from '../../../modules/journal/journal-auto.service';
import { PaymentReceiptOrchestrator } from '../../../modules/payments/services/payment-receipt-orchestrator';
import { ProductsService } from '../../../modules/products/products.service';
import { ReceiptsService } from '../../../modules/receipts/receipts.service';
import type { PrismaService } from '../../../prisma/prisma.service';
import { bangkokCalendarParts, bangkokMidnight } from '../../../utils/date.util';
import { buildInstallmentScheduleRows } from '../../../utils/installment-schedule.util';
import { generatePaymentSchedule } from '../../../utils/installment.util';
import { hashPII } from '../../../utils/pii.util';
import { TEST_NAME_PREFIX } from '../../../utils/test-data-markers';
import { legacyFileContentType, type LegacyFileDetail } from '../files';
import type { DumpRow } from '../dump-reader';
import type { LegacyContract } from '../legacy-book';
import { CARRY_FORWARD_ACCOUNTS, type CarryForwardAccount } from '../opening';
import { planImport, type ImportPlan, type PlannedContract } from '../plan-import';
import { writeLegacyImport, type WriteReport } from '../writer';
import {
  LAST,
  MONTHLY,
  peakMatch,
  standardInstallments,
  syntheticBook,
  syntheticContract,
  syntheticMember,
  syntheticRecon,
  thaiId,
  type InstallmentSpec,
} from './synthetic-book';
import { earlyPayoffApproved, voidReceiptApproved } from './approval-fixture';

/**
 * เทสต์ทองคำ (Task 11 · ร่าง 5) — สัญญาที่นำเข้าจากระบบเก่า (B) ต้องเดินต่อกับเทมเพลตจริงได้เหมือนสัญญาที่เปิดใน BESTCHOICE
 * ตั้งแต่แรก (A) — บน Postgres จริง ข้อมูลสังเคราะห์ทั้งหมด (เลขสัญญา TEST-T11-<stamp>-…, เลขบัตรขึ้นต้น 09 ที่คำนวณหลักตรวจเอง,
 * เบอร์ 0975…, IMEI 35997…) · ลบเฉพาะแถวที่สเปคนี้สร้าง (AuditLog เป็นแบบเขียนครั้งเดียว — แถวของสเปคนี้คงอยู่
 * พร้อมผู้ใช้ที่มันอ้าง)
 *
 * สัญญามาตรฐาน CPA: ยอดจัด 10,000 · ค่าคอม 1,000 · ดอกเบี้ย 6,000 (500 / งวด) · VAT 1,190 · 12 งวด → งวด 1–11 = 1,416.66 +
 * VAT 99.17 = 1,515.83 · งวด 12 = 1,416.74 + 99.13 = 1,515.87 · วันตัดหลังงวด 4 · ระบบเก่า: งวด 1–3 จ่ายครบ งวด 4 จ่าย 300
 *
 * - A = เส้นทางจริงของระบบ: รายการเปิดสัญญา 1A (`ContractActivation1ATemplate` — รายการบัญชีที่ `ContractWorkflowService.activate`
 *   ลง · ตัว activate เองต้องมี PDPA / ลายเซ็น / ใบจอง / SHOP ซึ่งไม่แตะบัญชียกมาแม้แต่บัญชีเดียว) + ตารางงวด
 *   `buildInstallmentScheduleRows` และแถว Payment `generatePaymentSchedule` (ตัวเดียวกับการสร้างสัญญา — มียอดแยกครบ) + 2A
 *   รอบกลางคืน (`InstallmentAccrual2ATemplate.execute`) ทีละงวด + ใบรับชำระผ่าน `PaymentReceiptOrchestrator.recordPayment`
 *   (เส้นทางหน้าจอรับชำระ — เรียก `PaymentReceiptTemplate` พร้อม `contractStatusBeforeReceipt` และแก้แถว Payment ในธุรกรรมเดียวกัน)
 * - B = `planImport` + `writeLegacyImport` แล้วเดินต่อด้วยเทมเพลตชุดเดียวกับ A
 * - ตัวเลขที่คาดหวังเป็น literal ที่คำนวณมือจากสูตร CPA เสมอ — ไม่เอาค่าจาก B มาเป็นค่าคาดหวัง
 *
 * ช่วงเวลา: เส้นทางรับชำระปฏิเสธวันที่ในอนาคต — ชุดหลักจึงใช้ปฏิทินปี 2025 (วันตัด 30 เม.ย. 2025 23:59:59 กรุงเทพ)
 * กติกาไม่ขึ้นกับวันที่ · ชุดปิดก่อนกำหนด (JP4) ผูกกับวันนี้ เพราะสูตรยอดปิดนับงวดที่ "ยังไม่ถึงกำหนด" จากวันนี้
 *
 * รัน: DATABASE_URL=<ฐานทดสอบ test_db หรือ *_test> NODE_OPTIONS=--max-old-space-size=6144 npx jest <ไฟล์นี้> --runInBand
 * · ไม่มี DATABASE_URL = ข้าม · ทุกเทสต์รันเดี่ยวด้วย `-t` ได้ (ดูหมายเหตุลำดับที่หัวชุดหลัก)
 */
const KEY = 'c9'.repeat(32);
const SALT = 'legacy-t11-opening-golden-salt-001';
const describeDb = process.env.DATABASE_URL ? describe : describe.skip;
const TX = { timeout: 120_000, maxWait: 20_000 };
const LONG = 600_000;
const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);

/** ด้านที่ยอดปกติของบัญชียกมาอยู่ — ยอดติดลบ = บัญชีกลับด้าน */
const SIDE: Record<CarryForwardAccount, 'dr' | 'cr'> = {
  '11-2101': 'dr',
  '11-2103': 'dr',
  '11-2105': 'dr',
  '11-2106': 'cr',
  '21-2102': 'cr',
};
type Carry = Record<CarryForwardAccount, string>;
const ALL_ZERO: Carry = {
  '11-2101': '0.00',
  '11-2103': '0.00',
  '11-2105': '0.00',
  '11-2106': '0.00',
  '21-2102': '0.00',
};
/**
 * ยอดยกมาทองคำ ณ วันตัดหลังงวด 4 (งวด 1–3 ชำระครบ · งวด 4 ค้าง): 11-2101 = 17,000 − 4 × 1,416.66 · 11-2105 = 1,190 − 4 × 99.17 ·
 * 11-2106 = 500 × 8 · 21-2102 = VAT งวด 5–12 · 11-2103 = 1,515.83 − ยอดที่จ่ายของงวด 4
 */
const cutoffCarry = (installment4Outstanding: string): Carry => ({
  '11-2101': '11333.36',
  '11-2103': installment4Outstanding,
  '11-2105': '793.32',
  '11-2106': '4000.00',
  '21-2102': '793.32',
});

/** ปฏิทินหลัก: ทำสัญญา 5 ธ.ค. 2024 · งวด 1 = 5 ม.ค. 2025 … งวด 12 = 5 ธ.ค. 2025 · วันตัดหลังงวด 4 */
const P1 = {
  date: '2024-12-05',
  dueDay: 5,
  firstDue: [2025, 0, 5] as [number, number, number],
  cutoff: new Date('2025-04-30T23:59:59+07:00'),
  due: (no: number) => bangkokMidnight(2025, no - 1, 5),
};
/** ก่อนวันตัด ก่อนงวด 5 ครบกำหนด — วันรับเงินล่วงหน้าบางส่วนของงวด 5 */
const APR20 = new Date('2025-04-20T10:00:00+07:00');
/** หลังวันตัด ก่อนงวด 5 — วันรับเงินของงวด 4 ส่วนที่เหลือ */
const MAY2 = new Date('2025-05-02T10:00:00+07:00');
const MAY3 = new Date('2025-05-03T10:00:00+07:00');
/** ช่วงส่งออก PEAK: วันตัด + รายการไล่ VAT 1 พ.ค. + 2A งวด 5 (5 พ.ค.) และงวด 6 (5 มิ.ย.) */
const PEAK_FROM = new Date('2025-04-01T00:00:00+07:00');
const PEAK_TO = new Date('2025-06-30T23:59:59+07:00');
/** รหัส PEAK ทดสอบของบัญชีดอกเบี้ย (ในผังยังว่าง — แบบ peak-export.legacy-exclusion.db.spec.ts) */
const PEAK_2106 = 'T11-2106';
const PEAK_4101 = 'T11-4101';

const installmentAmount = (no: number) => (no === 12 ? LAST : MONTHLY);
/** ระบบเก่า ณ วันตัด: งวด 1–3 จ่ายครบ · งวด 4 จ่าย `installment4Paid` (ใบรับเงินลงวันครบกำหนด · '0' = ไม่ได้จ่าย) */
const legacyState = (installment4Paid = '300'): Record<number, InstallmentSpec> => {
  const state: Record<number, InstallmentSpec> = {
    1: { paid: MONTHLY },
    2: { paid: MONTHLY },
    3: { paid: MONTHLY },
  };
  if (installment4Paid !== '0') state[4] = { paid: installment4Paid };
  return state;
};

/** แยกคอลัมน์ CSV แบบรู้จักเครื่องหมายคำพูด (ชื่อบัญชี/คำอธิบายอาจมี comma) */
function csvCells(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

describeDb('legacy opening state runs on the real templates — golden (real DB)', () => {
  let prisma: PrismaClient;
  let pii: CustomerPiiService;
  let journal: JournalAutoService;
  let accrual2A: InstallmentAccrual2ATemplate;
  let activation1A: ContractActivation1ATemplate;
  let receipts: ReceiptsService;
  let orchestrator: PaymentReceiptOrchestrator;
  let contractPayments: ContractPaymentService;
  let peakExport: PeakExportService;

  const saved = { key: process.env.PII_ENCRYPTION_KEY, salt: process.env.PII_HASH_SALT };
  const stamp = Date.now().toString(36).toUpperCase();
  const batch = `t11-${stamp.toLowerCase()}`;
  let run = 0;
  let refSeq = 0;

  let financeCompanyId = '';
  let branchId = '';
  let userId = '';
  let approverId = '';
  let createdAdminId: string | null = null;
  const nativeContractIds: string[] = [];
  const nativeCustomerIds: string[] = [];
  const savedPeakCodes: Array<{ code: string; peakCode: string | null }> = [];

  async function restorePeakCodes() {
    for (const m of savedPeakCodes.splice(0)) {
      await prisma.chartOfAccount.update({
        where: { code: m.code },
        data: { peakCode: m.peakCode },
      });
    }
  }

  beforeAll(async () => {
    const dbName = new URL(process.env.DATABASE_URL as string).pathname.slice(1);
    if (!/^test_db$|_test$/.test(dbName)) {
      throw new Error(
        `สเปคนี้เขียนแถวจริง — ต้องรันกับฐานทดสอบ (test_db หรือ *_test) แต่ได้ "${dbName}"`,
      );
    }
    process.env.PII_ENCRYPTION_KEY = KEY;
    process.env.PII_HASH_SALT = SALT;
    prisma = new PrismaClient();
    await prisma.$connect();
    const asService = prisma as unknown as PrismaService;
    pii = new CustomerPiiService(asService);

    await seedFinanceCoa(prisma);
    const finance = await prisma.companyInfo.findFirst({
      where: { companyCode: 'FINANCE', deletedAt: null },
      select: { id: true },
    });
    if (!finance) throw new Error('ฐานทดสอบไม่มีบริษัท FINANCE (migration ควรสร้างให้)');
    financeCompanyId = finance.id;

    // JournalAutoService ใช้ผู้ใช้ระบบ admin@bestchoice.com เป็นผู้สร้างรายการอัตโนมัติ
    const admin = await prisma.user.findFirst({
      where: { email: 'admin@bestchoice.com', deletedAt: null },
      select: { id: true },
    });
    if (!admin) {
      createdAdminId = (
        await prisma.user.create({
          data: {
            email: 'admin@bestchoice.com',
            password: 'hashed_placeholder',
            name: `${TEST_NAME_PREFIX} System Admin T11`,
            role: 'OWNER',
          },
        })
      ).id;
    }
    branchId = (
      await prisma.branch.create({
        data: { name: `${TEST_NAME_PREFIX} T11 ${stamp}`, companyId: financeCompanyId },
      })
    ).id;
    userId = (
      await prisma.user.create({
        data: {
          email: `t11-${stamp.toLowerCase()}@bestchoice-test.internal`,
          password: 'hashed_placeholder',
          name: `${TEST_NAME_PREFIX} ย้ายจากระบบเก่า T11`,
          role: 'OWNER',
          branchId,
        },
      })
    ).id;
    approverId = (
      await prisma.user.create({
        data: {
          email: `t11-approver-${stamp.toLowerCase()}@bestchoice-test.internal`,
          password: 'hashed_placeholder',
          name: `${TEST_NAME_PREFIX} ผู้อนุมัติ T11`,
          role: 'ACCOUNTANT',
          isActive: true,
        },
      })
    ).id;

    journal = new JournalAutoService(asService);
    accrual2A = new InstallmentAccrual2ATemplate(journal, asService);
    activation1A = new ContractActivation1ATemplate(journal, asService);
    receipts = new ReceiptsService(
      asService,
      journal,
      new ReceiptVoidReversalTemplate(journal, asService),
      undefined,
    );
    const noop = async () => {};
    orchestrator = new PaymentReceiptOrchestrator(
      asService,
      receipts,
      { logPaymentEvent: noop, log: noop } as never,
      journal,
      { transferOwnership: noop } as never,
      { reverseStageOnPayment: noop } as never,
      // สร้างแบบเดียวกับ backfill-orphan-partial-receipts.cli.ts
      new PaymentReceiptTemplate(journal, asService),
      new Vat60dayReversalTemplate(journal, asService),
      {
        awardLoyaltyPoints: noop,
        sendPaymentSuccessLine: noop,
        runMdmAutoUnlock: noop,
        checkPromiseAfterPayment: noop,
      },
    );
    contractPayments = new ContractPaymentService(
      asService,
      new ProductsService(asService),
      journal,
      new EarlyPayoffJP4Template(
        journal,
        asService,
        new Vat60dayReversalTemplate(journal, asService),
      ),
      new ShopCollectSettlementTemplate(journal, asService),
      { generateReceipt: async () => undefined } as never,
      new EclStageReverseTemplate(journal, asService),
    );
    peakExport = new PeakExportService(asService, new CompanyResolverService(asService));
  }, LONG);

  afterAll(async () => {
    if (!prisma) return;
    try {
      // รหัส PEAK ทดสอบคืนก่อนและไม่ขึ้นกับการลบแถว (ฐานทดสอบอาจใช้ร่วมกับสเปคอื่น)
      await restorePeakCodes();
    } finally {
      try {
        const legacy = await prisma.contract.findMany({
          where: { legacyContractCode: { startsWith: `TEST-T11-${stamp}` } },
          select: { id: true },
        });
        const contracts = await prisma.contract.findMany({
          where: { id: { in: [...nativeContractIds, ...legacy.map((c) => c.id)] } },
          select: { id: true, productId: true, customerId: true },
        });
        const contractIds = contracts.map((c) => c.id);
        const byContract = contractIds.map((id) => ({
          metadata: { path: ['contractId'], equals: id },
        }));
        const entries = await prisma.journalEntry.findMany({
          where: {
            OR: [...byContract, { metadata: { path: ['importBatch'], string_starts_with: batch } }],
          },
          select: { id: true },
        });
        const entryIds = entries.map((e) => e.id);
        // ใบลดหนี้อ้างใบเสร็จที่ถูกยกเลิก — ลบก่อน
        await prisma.receipt.deleteMany({
          where: { contractId: { in: contractIds }, voidedReceiptId: { not: null } },
        });
        await prisma.receipt.deleteMany({ where: { contractId: { in: contractIds } } });
        await prisma.journalPostAuditLog.deleteMany({
          where: { journalEntryId: { in: entryIds } },
        });
        await prisma.journalLine.deleteMany({ where: { journalEntryId: { in: entryIds } } });
        await prisma.journalEntry.deleteMany({ where: { id: { in: entryIds } } });
        await prisma.paymentEvidence.deleteMany({ where: { contractId: { in: contractIds } } });
        await prisma.payment.deleteMany({ where: { contractId: { in: contractIds } } });
        await prisma.installmentSchedule.deleteMany({
          where: { contractId: { in: contractIds } },
        });
        await prisma.contractDocument.deleteMany({ where: { contractId: { in: contractIds } } });
        await prisma.contract.deleteMany({ where: { id: { in: contractIds } } });
        await prisma.product.deleteMany({
          where: { id: { in: contracts.map((c) => c.productId) } },
        });
        const customers = await prisma.customer.findMany({
          where: {
            OR: [
              { legacyMemberCode: { startsWith: `TEST-T11M-${stamp}` } },
              { id: { in: [...nativeCustomerIds, ...contracts.map((c) => c.customerId)] } },
            ],
          },
          select: { id: true, contactId: true },
        });
        await prisma.customer.deleteMany({ where: { id: { in: customers.map((c) => c.id) } } });
        await prisma.contact.deleteMany({
          where: {
            id: { in: customers.map((c) => c.contactId).filter((id): id is string => !!id) },
          },
        });
        // AuditLog เป็นแบบเขียนครั้งเดียว (trigger) — ผู้ใช้ที่ถูกอ้างลบไม่ได้: ปิดใช้งานแทน · ผู้ใช้ระบบ admin ที่สร้างให้ลบเมื่อลบได้
        // ไม่งั้นคงไว้ (ปิดใช้งานแล้วรอบถัดไปสร้างใหม่ไม่ได้เพราะอีเมลซ้ำ)
        if (createdAdminId) {
          await prisma.user.delete({ where: { id: createdAdminId } }).catch(() => undefined);
        }
        for (const id of [userId, approverId].filter(Boolean)) {
          await prisma.user.delete({ where: { id } }).catch(async () => {
            await prisma.user.update({
              where: { id },
              data: { isActive: false, deletedAt: new Date() },
            });
          });
        }
        await prisma.branch.delete({ where: { id: branchId } }).catch(async () => {
          await prisma.branch.update({ where: { id: branchId }, data: { deletedAt: new Date() } });
        });
      } finally {
        await prisma.$disconnect();
        if (saved.key === undefined) delete process.env.PII_ENCRYPTION_KEY;
        else process.env.PII_ENCRYPTION_KEY = saved.key;
        if (saved.salt === undefined) delete process.env.PII_HASH_SALT;
        else process.env.PII_HASH_SALT = saved.salt;
      }
    }
  }, LONG);

  // ── ตัวช่วย ────────────────────────────────────────────────────────────────────────────────

  const hash = (v: string) => hashPII(v, SALT);
  const imei = () => `35997${String(Math.floor(Math.random() * 1e10)).padStart(10, '0')}`;

  async function freshNationalId(): Promise<string> {
    for (let i = 0; i < 20; i++) {
      const id = thaiId(`09${String(Math.floor(Math.random() * 1e10)).padStart(10, '0')}`);
      const taken =
        (await prisma.customer.count({
          where: { OR: [{ nationalId: id }, { nationalIdHash: hash(id) }] },
        })) + (await prisma.contact.count({ where: { nationalIdHash: hash(id) } }));
      if (taken === 0) return id;
    }
    throw new Error('หาเลขบัตรทดสอบที่ว่างไม่ได้');
  }

  async function freshPhone(): Promise<string> {
    for (let i = 0; i < 20; i++) {
      const phone = `0975${String(Math.floor(Math.random() * 1e6)).padStart(6, '0')}`;
      const taken = await prisma.customer.count({
        where: { OR: [{ phone }, { phoneHash: hash(phone) }] },
      });
      if (taken === 0) return phone;
    }
    throw new Error('หาเบอร์ทดสอบที่ว่างไม่ได้');
  }

  const bal = async (contractId: string, code: string, side: 'dr' | 'cr') =>
    (await glContractBalance(prisma, contractId, code, side)).toFixed(2);

  async function carry(contractId: string): Promise<Carry> {
    const out = {} as Carry;
    for (const code of CARRY_FORWARD_ACCOUNTS) out[code] = await bal(contractId, code, SIDE[code]);
    return out;
  }

  /** บัญชียกมาที่ติดลบ (ยอดอยู่ผิดด้าน) — ต้องว่างทุกขั้น */
  const negatives = (c: Carry) =>
    Object.entries(c).filter(([, v]) => D(v).isNegative()) as Array<[string, string]>;

  const scheduleOf = (contractId: string, installmentNo: number) =>
    prisma.installmentSchedule.findUniqueOrThrow({
      where: { contractId_installmentNo: { contractId, installmentNo } },
    });

  const paymentOf = (contractId: string, installmentNo: number) =>
    prisma.payment.findFirstOrThrow({ where: { contractId, installmentNo, deletedAt: null } });

  /** 2A รอบกลางคืนของงวด (ลงวันครบกำหนด) · null = งวดตั้งครบแล้ว */
  async function nightly2A(contractId: string, installmentNo: number) {
    return accrual2A.execute((await scheduleOf(contractId, installmentNo)).id);
  }

  /** ใบรับชำระผ่านเส้นทางหน้าจอรับชำระ · `partial` = case PARTIAL */
  function pay(
    contractId: string,
    installmentNo: number,
    amount: string,
    paidDate: Date,
    partial = false,
  ) {
    return orchestrator.recordPayment(
      contractId,
      installmentNo,
      Number(amount),
      'CASH',
      userId,
      undefined, // evidenceUrl
      undefined, // notes
      `T11-${stamp}-${++refSeq}`,
      '11-1101',
      undefined, // toleranceApproverId
      partial ? 'PARTIAL' : undefined,
      undefined, // consumeAdvance
      paidDate,
      undefined,
      undefined,
      undefined,
      true, // enforceSequence
    );
  }

  /** ยอดที่ยังค้างบนแถว Payment ของงวด (ยอดเรียกเก็บ − ยอดจ่าย) */
  async function owedOn(contractId: string, installmentNo: number): Promise<string> {
    const p = await paymentOf(contractId, installmentNo);
    return p.amountDue.minus(p.amountPaid).toFixed(2);
  }

  /** รายการบัญชีของสัญญา (POSTED) */
  const entriesOf = (contractId: string, where: Prisma.JournalEntryWhereInput = {}) =>
    prisma.journalEntry.findMany({
      where: {
        AND: [{ metadata: { path: ['contractId'], equals: contractId } }, where],
        status: 'POSTED',
        deletedAt: null,
      },
      include: { lines: true },
      orderBy: { entryNumber: 'asc' },
    });

  const metaOf = (e: { metadata: Prisma.JsonValue }) =>
    (e.metadata ?? {}) as Record<string, unknown>;
  const tagOf = (e: { metadata: Prisma.JsonValue }) => metaOf(e).tag;
  const flowOf = (e: { metadata: Prisma.JsonValue }) => metaOf(e).flow;

  const sortedLines = (e: {
    lines: Array<{ accountCode: string; debit: unknown; credit: unknown }>;
  }) =>
    e.lines
      .map(
        (l) =>
          `${l.accountCode}:${D(String(l.debit)).toFixed(2)}:${D(String(l.credit)).toFixed(2)}`,
      )
      .sort();

  /** รายการ tag 2A ของงวด (ทุกสัญญา) */
  async function accrualEntriesOf(contractId: string, installmentNo: number) {
    const s = await scheduleOf(contractId, installmentNo);
    return (await entriesOf(contractId)).filter(
      (e) => tagOf(e) === '2A' && metaOf(e).installmentScheduleId === s.id,
    );
  }

  /**
   * สัญญา A — เส้นทางเปิดสัญญาของระบบ: ตารางงวด `buildInstallmentScheduleRows` + แถว Payment `generatePaymentSchedule` (ยอดแยก
   * เงินต้น/ดอกเบี้ย/ค่าคอม/VAT แบบการสร้างสัญญาจริง) + 1A
   */
  async function createNative(key: string, date: string, dueDay: number): Promise<string> {
    const contractDate = new Date(`${date}T10:00:00+07:00`);
    const customer = await prisma.customer.create({
      data: { name: `${TEST_NAME_PREFIX} T11 สัญญาปกติ ${key}` },
    });
    nativeCustomerIds.push(customer.id);
    const product = await prisma.product.create({
      data: {
        name: `${TEST_NAME_PREFIX} T11 ${key}`,
        brand: 'Apple',
        model: 'iPhone ทดสอบ 13',
        imeiSerial: imei(),
        category: 'PHONE_USED',
        costPrice: D(0),
        branchId,
        ownedByCompanyId: financeCompanyId,
        status: 'SOLD_INSTALLMENT',
        isOnlineVisible: false,
      },
    });
    const contract = await prisma.contract.create({
      data: {
        contractNumber: `TEST-T11N-${stamp}-${key}`,
        customerId: customer.id,
        productId: product.id,
        branchId,
        salespersonId: userId,
        planType: 'STORE_WITH_INTEREST',
        sellingPrice: D('12000'),
        downPayment: D('2000'),
        financedAmount: D('10000'),
        interestRate: D('0.0500'),
        totalMonths: 12,
        interestTotal: D('6000'),
        storeCommission: D('1000'),
        vatAmount: D('1190'),
        vatPct: D('0.07'),
        monthlyPayment: D(MONTHLY),
        status: 'ACTIVE',
        workflowStatus: 'APPROVED',
        paymentDueDay: dueDay,
        createdAt: contractDate,
      },
    });
    nativeContractIds.push(contract.id);
    const rows = buildInstallmentScheduleRows({
      id: contract.id,
      totalMonths: 12,
      financedAmount: D('10000'),
      interestTotal: D('6000'),
      monthlyPayment: D(MONTHLY),
      paymentDueDay: dueDay,
      createdAt: contractDate,
    });
    await prisma.installmentSchedule.createMany({ data: rows });
    // ยอดผ่อนรวม 18,190 = ยอดจัด + ค่าคอม + ดอกเบี้ย + VAT (แบบ credit-approval.fixture / การสร้างสัญญา)
    const payments = generatePaymentSchedule(
      contract.id,
      12,
      18190,
      Number(MONTHLY),
      dueDay,
      { principal: 10000, storeCommission: 1000, interestTotal: 6000, vatAmount: 1190 },
      contractDate,
    );
    if (payments.some((p, i) => p.dueDate.getTime() !== (rows[i].dueDate as Date).getTime())) {
      throw new Error('createNative: วันครบกำหนดของแถว Payment ไม่ตรงตารางงวด');
    }
    await prisma.payment.createMany({ data: payments });
    await activation1A.execute(contract.id, undefined, contractDate);
    return contract.id;
  }

  /** A ถึงวันตัด: 2A งวด 1–4 · ใบรับชำระงวด 1–3 เต็มงวด · งวด 4 = `installment4Paid` — ทุกใบลงวันครบกำหนด */
  async function runNativeToCutoff(
    contractId: string,
    due: (no: number) => Date,
    installment4Paid = '300',
  ) {
    for (let no = 1; no <= 4; no++) {
      await nightly2A(contractId, no);
      const amount = no < 4 ? MONTHLY : installment4Paid;
      if (D(amount).isZero()) continue;
      await pay(contractId, no, amount, due(no), D(amount).lt(installmentAmount(no)));
    }
  }

  /**
   * จ่ายงวด 4..`through` ของทุกสัญญาใน `ids` ให้ครบตามลำดับ (ข้ามงวดที่ PAID แล้ว) — งวด 4 ส่วนที่เหลือรับ 3 พ.ค.
   * · งวด 5+ ตั้ง 2A รอบกลางคืนแล้วรับวันครบกำหนด — ให้เทสต์ในชุดหลักรันเดี่ยว (`-t`) ได้
   */
  async function settleThrough(ids: string[], through: number) {
    for (let no = 4; no <= through; no++) {
      for (const id of ids) {
        if ((await paymentOf(id, no)).status === 'PAID') continue;
        await nightly2A(id, no);
        await pay(id, no, await owedOn(id, no), no === 4 ? MAY3 : P1.due(no));
      }
    }
  }

  type LegacySpec = {
    key: string;
    installments: InstallmentSpec[];
    detail?: Record<string, string | null>;
    /** ยอดคงเหลือ PEAK = ยอดค้างของระบบเก่า + ค่านี้ (ไม่ส่ง = เท่ากัน) */
    peakRemainOffset?: string;
    /** ยอดใบแจ้งหนี้ PEAK (ไม่ส่ง = Σ ค่างวดระบบเก่า) */
    peakNetAmount?: string;
  };
  type Imported = {
    plan: ImportPlan;
    report: WriteReport;
    item: (key: string) => PlannedContract;
    contractId: (key: string) => string;
    code: (key: string) => string;
  };

  /** สัญญา B — สมุดระบบเก่าสังเคราะห์ → `planImport` → `writeLegacyImport` (ธุรกรรมเดียว) */
  async function importLegacy(
    timeline: { date: string; firstDue: [number, number, number]; cutoff: Date },
    specs: LegacySpec[],
  ): Promise<Imported> {
    const r = ++run;
    const code = (key: string) => `TEST-T11-${stamp}-${r}-${key}`;
    const contracts: LegacyContract[] = [];
    const members: DumpRow[] = [];
    for (const [i, spec] of specs.entries()) {
      const memberId = `${r}${i + 1}`;
      members.push(
        syntheticMember({
          id: memberId,
          code: `TEST-T11M-${stamp}-${r}-${spec.key}`,
          nationalId: await freshNationalId(),
          phone: await freshPhone(),
          name: `${TEST_NAME_PREFIX} T11 สมาชิก`,
        }),
      );
      contracts.push(
        syntheticContract({
          id: `${r}${i + 1}`,
          code: code(spec.key),
          date: timeline.date,
          memberId,
          firstDue: timeline.firstDue,
          imei: imei(),
          installments: spec.installments,
          detail: spec.detail,
        }),
      );
    }
    const plan = planImport(syntheticBook(contracts, members), {
      cutoff: timeline.cutoff,
      peakRecon: syntheticRecon(
        contracts.map((c, i) => {
          const spec = specs[i];
          const outstanding = c.installments.reduce(
            (s, inst) => (inst.balance.gt(0) ? s.plus(inst.balance) : s),
            D(0),
          );
          const remain = spec.peakRemainOffset
            ? outstanding.plus(spec.peakRemainOffset)
            : undefined;
          return [c, peakMatch(c, `T11${stamp}${r}${i}`, remain, spec.peakNetAmount)];
        }),
      ),
      canceledMap: new Map(),
      moneyOverrides: new Map(),
      customerOverrides: new Map(),
    });
    expect(plan.blockers).toEqual([]);
    const files = new Map<string, LegacyFileDetail>();
    for (const path of plan.items.flatMap((i) => i.attachmentPaths)) {
      files.set(path, {
        key: `legacy-import-test/${path}`,
        size: 1024,
        sha256: 'd'.repeat(64),
        contentType: legacyFileContentType(path),
      });
    }
    const report = await prisma.$transaction(
      (tx) =>
        writeLegacyImport(tx, plan, {
          journal,
          pii,
          financeCompanyId,
          branchId,
          systemUserId: userId,
          files,
          importBatch: `${batch}-${r}`,
        }),
      TX,
    );
    return {
      plan,
      report,
      item: (key) => plan.items.find((i) => i.code === code(key)) as PlannedContract,
      contractId: (key) => report.contractIds.get(code(key)) as string,
      code,
    };
  }

  // ── ชุดหลัก (ปฏิทิน 2025): A1 (ปกติ) · B1 (นำเข้า) · B3 (ยอดเรียกเก็บ +0.01 / งวดสุดท้ายเท่ากัน) · B4 (ยกเลิกใบเสร็จหลังวันตัด)
  //
  // ลำดับ: เทสต์ "receipt after cutoff" → "contract runs to zero" → "peak export" ใช้ A1/B1 ร่วมกันตามลำดับในไฟล์ (งวด 4 →
  // 5–12 → ส่งออกช่วงที่มี 2A งวด 5–6) · แต่ละเทสต์เรียก `settleThrough` ให้ได้สภาพที่ต้องการเองก่อน จึงรันเดี่ยวด้วย `-t` ได้
  // ("imported state equals native state" ต้องรันก่อนเทสต์ที่จ่ายงวด 4 ของ A1/B1 — ลำดับในไฟล์รับประกัน) · เทสต์อื่นสร้างสัญญาของตัวเอง

  describe('imported B vs native A (calendar 2025, cutoff after installment 4)', () => {
    let a1 = '';
    let b1 = '';
    let b3 = '';
    let b4 = '';
    let imported: Imported;

    beforeAll(async () => {
      a1 = await createNative('A1', P1.date, P1.dueDay);
      await runNativeToCutoff(a1, P1.due);
      const flat = Array.from({ length: 12 }, () => ({ amount: '1515.84' }));
      imported = await importLegacy(P1, [
        { key: 'B1', installments: standardInstallments(legacyState()) },
        {
          key: 'B3',
          // ระบบเก่าเรียกเก็บ 1,515.84 ทุกงวด: งวด 1–11 = ตัวคำนวณ + 0.01 · งวด 12 = เท่ากัน (ตัวคำนวณ 1,515.87)
          installments: flat.map((inst, i) =>
            i < 3 ? { ...inst, paid: '1515.84' } : i === 3 ? { ...inst, paid: '300' } : inst,
          ),
          detail: { installment_amount: '1515.84' },
        },
        { key: 'B4', installments: standardInstallments(legacyState()) },
      ]);
      b1 = imported.contractId('B1');
      b3 = imported.contractId('B3');
      b4 = imported.contractId('B4');
    }, LONG);

    it(
      'imported state equals native state',
      async () => {
        const golden = cutoffCarry('1215.83');
        expect(await carry(a1)).toEqual(golden);
        expect(await carry(b1)).toEqual(golden);

        // 21-2102 เท่ากันหลังรายการไล่ VAT เท่านั้น: รายการยกมาลง Cr 21-2102 = VAT งวด 5–12 (793.32) + VAT ของงวด 4 ส่วนที่ค้าง
        // (99.17 − VAT ของ 300 = 19.63 → 79.54) = 872.86 · A ส่งส่วนนั้นเข้า 21-2101 ไปแล้วตอน 2A งวด 4
        const legacyOf = (kind: string) =>
          imported.report.journalEntries.filter((e) => e.contractId === b1 && e.kind === kind);
        const [openingRef] = legacyOf('opening');
        const opening = await prisma.journalEntry.findUniqueOrThrow({
          where: { id: openingRef.id },
          include: { lines: true },
        });
        expect(sortedLines(opening).filter((l) => l.startsWith('21-2102:'))).toEqual([
          '21-2102:0.00:872.86',
        ]);
        const [catchUpRef] = legacyOf('catch-up');
        const catchUp = await prisma.journalEntry.findUniqueOrThrow({
          where: { id: catchUpRef.id },
          include: { lines: true },
        });
        expect(sortedLines(catchUp)).toEqual(['21-2101:0.00:79.54', '21-2102:79.54:0.00']);

        // A รับรู้ดอกเบี้ย / VAT งวด 1–4 ในระบบ · B ไม่มี (PEAK รับรู้แล้ว) — นอกบัญชียกมา
        expect([await bal(a1, '41-1101', 'cr'), await bal(a1, '21-2101', 'cr')]).toEqual([
          '2000.00',
          '396.68',
        ]);
        expect([await bal(b1, '41-1101', 'cr'), await bal(b1, '21-2101', 'cr')]).toEqual([
          '0.00',
          '79.54',
        ]);

        // งวด 1–4 ของ B ประทับว่าตั้งลูกหนี้แล้ว (ลิงก์รายการยกมา) · 5–12 ยังไม่ตั้ง · marker งวด 4 = 300
        const rows = await prisma.installmentSchedule.findMany({
          where: { contractId: b1 },
          orderBy: { installmentNo: 'asc' },
        });
        expect(rows.map((r) => r.accrualJournalEntryId)).toEqual([
          ...Array(4).fill(openingRef.entryNumber),
          ...Array(8).fill(null),
        ]);
        expect(legacyOf('marker').map((m) => m.installmentNo)).toEqual([4]);
        expect(imported.item('B1').roundingDiff.toFixed(2)).toBe('0.00');

        // ลิงก์ประทับต้องมีผลจริง: รอบกลางคืนบนงวด 1–4 ของ B ไม่ลงอะไร (คืน null · ไม่มีรายการ 2A · จำนวนรายการเท่าเดิม)
        const before = (await entriesOf(b1)).length;
        for (let no = 1; no <= 4; no++) {
          expect({ no, result: await nightly2A(b1, no) }).toEqual({ no, result: null });
        }
        const after = await entriesOf(b1);
        expect(after).toHaveLength(before);
        expect(after.filter((e) => tagOf(e) === '2A')).toEqual([]);
        expect(await carry(b1)).toEqual(golden);
      },
      LONG,
    );

    it(
      'receipt after cutoff clears only the remainder',
      async () => {
        // brief: "ยอดที่เหลือ 700" — ยอดที่เหลือจริงของงวด 4 = 1,515.83 − 300 = 1,215.83 ⇒ รับ 700 (บางส่วน) แล้ว 515.83 (ปิดงวด)
        for (const id of [a1, b1]) await pay(id, 4, '700', MAY2, true);
        expect(await bal(b1, '11-2103', 'dr')).toBe('515.83');
        const partial = await paymentOf(b1, 4);
        expect([partial.status, partial.amountPaid.toFixed(2)]).toEqual([
          'PARTIALLY_PAID',
          '1000.00',
        ]);

        for (const id of [a1, b1]) await pay(id, 4, '515.83', MAY3);
        expect(await bal(b1, '11-2103', 'dr')).toBe('0.00');
        const paid = await paymentOf(b1, 4);
        expect([paid.status, paid.amountPaid.toFixed(2)]).toEqual(['PAID', '1515.83']);
        expect(await carry(b1)).toEqual(await carry(a1));

        // ไม่มี 2A เพิ่ม (งวด 4 ประทับแล้ว) · ใบรับชำระสองใบล้าง 11-2103 รวม 1,215.83 ไม่มีเศษปัด
        const b1Entries = await entriesOf(b1);
        expect(b1Entries.filter((e) => tagOf(e) === '2A')).toEqual([]);
        const receipts4 = b1Entries.filter((e) => flowOf(e) === 'payment-receipt');
        expect(receipts4.map(sortedLines)).toEqual([
          ['11-1101:700.00:0.00', '11-2103:0.00:700.00'],
          ['11-1101:515.83:0.00', '11-2103:0.00:515.83'],
        ]);
        // VAT ที่ใบเสร็จหลังวันตัดพิมพ์ (45.79 + 33.75) = รายการไล่ VAT (79.54) — ภาษีของงวด 4 ไม่ถูกพิมพ์ซ้ำ/ขาด
        expect(
          receipts4.map(
            (e) => (metaOf(e).receiptTax as Record<string, string> | undefined)?.vatAmount,
          ),
        ).toEqual(['45.79', '33.75']);
      },
      LONG,
    );

    it(
      'contract runs to zero',
      async () => {
        await settleThrough([a1, b1], 4);
        expect(await bal(a1, '41-1101', 'cr')).toBe('2000.00');
        for (let no = 5; no <= 12; no++) {
          for (const id of [a1, b1]) await nightly2A(id, no);
          const accrued = await carry(b1);
          expect({ no, negatives: negatives(accrued) }).toEqual({ no, negatives: [] });
          expect(accrued).toEqual(await carry(a1));

          for (const id of [a1, b1]) await pay(id, no, installmentAmount(no), P1.due(no));
          const paid = await carry(b1);
          expect({ no, negatives: negatives(paid) }).toEqual({ no, negatives: [] });
          expect(paid).toEqual(await carry(a1));
          expect(paid['11-2103']).toBe('0.00');
        }
        expect(await carry(b1)).toEqual(ALL_ZERO);
        expect(await carry(a1)).toEqual(ALL_ZERO);

        // ดอกเบี้ยงวด 5–12: 500 × 8 = 4,000 · A ทั้งสัญญา 6,000
        expect(await bal(b1, '41-1101', 'cr')).toBe('4000.00');
        expect(await bal(a1, '41-1101', 'cr')).toBe('6000.00');
        // VAT: B = ไล่ VAT งวด 4 (79.54) + 2A งวด 5–12 (793.32) · A = ทั้งสัญญา 1,190
        expect(await bal(b1, '21-2101', 'cr')).toBe('872.86');
        expect(await bal(a1, '21-2101', 'cr')).toBe('1190.00');
        // ไม่มีเศษปัดในสัญญาที่ยอดเรียกเก็บตรงตัวคำนวณ
        expect([await bal(b1, '53-1503', 'cr'), await bal(b1, '52-1104', 'dr')]).toEqual([
          '0.00',
          '0.00',
        ]);
        const contracts = await prisma.contract.findMany({
          where: { id: { in: [a1, b1] } },
          select: { status: true },
        });
        expect(contracts.map((c) => c.status)).toEqual(['COMPLETED', 'COMPLETED']);
      },
      LONG,
    );

    it(
      'peak export excludes legacy interest',
      async () => {
        await settleThrough([a1, b1], 6);
        const a2A = [...(await accrualEntriesOf(a1, 5)), ...(await accrualEntriesOf(a1, 6))];
        const b2A = [...(await accrualEntriesOf(b1, 5)), ...(await accrualEntriesOf(b1, 6))];
        expect([a2A.length, b2A.length]).toEqual([2, 2]);
        const scheduleIds = await Promise.all(
          [4, 5, 6].map(async (no) => (await scheduleOf(b1, no)).id),
        );
        const bReceipts = (await entriesOf(b1)).filter(
          (e) =>
            flowOf(e) === 'payment-receipt' &&
            scheduleIds.includes(metaOf(e).installmentScheduleId as string),
        );
        expect(bReceipts.length).toBeGreaterThanOrEqual(3);
        const legacyOf = (kind: string) =>
          imported.report.journalEntries.filter((e) => e.contractId === b1 && e.kind === kind);
        const [catchUp] = legacyOf('catch-up');
        const hidden = [...legacyOf('opening'), ...legacyOf('marker')].map((e) => e.entryNumber);
        expect(hidden).toHaveLength(2);

        let csv = '';
        try {
          for (const [code, peakCode] of [
            ['11-2106', PEAK_2106],
            ['41-1101', PEAK_4101],
          ] as const) {
            const row = await prisma.chartOfAccount.findUniqueOrThrow({
              where: { code },
              select: { code: true, peakCode: true },
            });
            if (!savedPeakCodes.some((s) => s.code === code)) savedPeakCodes.push(row);
            await prisma.chartOfAccount.update({ where: { code }, data: { peakCode } });
          }
          csv = (await peakExport.exportJournalWithPeakCodes(PEAK_FROM, PEAK_TO)).csv;
        } finally {
          await restorePeakCodes();
        }

        // อ่านเฉพาะแถวของรายการที่เทสต์นี้สร้าง (ไฟล์มีทุกรายการ FINANCE ในช่วง — แถวของสเปคอื่นไม่ถูกแปลงเป็นตัวเลข)
        const mine = new Set([
          ...a2A.map((e) => e.entryNumber),
          ...b2A.map((e) => e.entryNumber),
          ...bReceipts.map((e) => e.entryNumber),
          catchUp.entryNumber,
          ...hidden,
        ]);
        const rows = csv
          .replace(/^\uFEFF/, '')
          .split(/\r?\n/)
          .slice(1)
          .map(csvCells)
          .filter((cols) => mine.has(cols[1]))
          .map((cols) => ({
            entry: cols[1],
            account: cols[4],
            debit: D(cols[6]),
            credit: D(cols[7]),
          }));
        const rowsOf = (entryNumber: string) => rows.filter((r) => r.entry === entryNumber);
        const accountsOf = (entryNumber: string) =>
          rowsOf(entryNumber)
            .map((r) => r.account)
            .sort();

        // A: 2A งวด 5 และ 6 ส่งดอกเบี้ยครบ (ตัวเทียบ — บัญชีดอกเบี้ยมีรหัส PEAK ในการส่งออกครั้งนี้)
        for (const e of a2A) {
          expect(accountsOf(e.entryNumber)).toEqual([
            '11-2101',
            '11-2103',
            '11-2105',
            '11-2106',
            '21-2101',
            '21-2102',
            '41-1101',
          ]);
        }
        // B: 2A ไม่มี 11-2106 / 41-1101 · ทุกรายการของ B ที่ส่งออกยังดุล
        for (const e of b2A) {
          expect(accountsOf(e.entryNumber)).toEqual([
            '11-2101',
            '11-2103',
            '11-2105',
            '21-2101',
            '21-2102',
          ]);
        }
        for (const e of [...b2A, ...bReceipts, catchUp]) {
          const r = rowsOf(e.entryNumber);
          expect({ entry: e.entryNumber, exported: r.length > 0 }).toEqual({
            entry: e.entryNumber,
            exported: true,
          });
          expect(r.filter((x) => x.account === '11-2106' || x.account === '41-1101')).toEqual([]);
          const dr = r.reduce((s, x) => s.plus(x.debit), D(0));
          const cr = r.reduce((s, x) => s.plus(x.credit), D(0));
          expect({ entry: e.entryNumber, dr: dr.toFixed(2) }).toEqual({
            entry: e.entryNumber,
            dr: cr.toFixed(2),
          });
        }
        // รายการยกมา + marker ไม่อยู่ในไฟล์ · รายการไล่ VAT อยู่ (ภาษีของงวดค้างยังไม่เคยยื่นใน PEAK)
        for (const entry of hidden) {
          expect({ entry, rows: rowsOf(entry) }).toEqual({ entry, rows: [] });
        }
        expect(
          rowsOf(catchUp.entryNumber)
            .map((r) => `${r.account}:${r.debit.toFixed(2)}:${r.credit.toFixed(2)}`)
            .sort(),
        ).toEqual(['21-2101:0.00:79.54', '21-2102:79.54:0.00']);
      },
      LONG,
    );

    it(
      'imported Payment rows carry the native breakdown columns (principal + interest + commission + VAT = amountDue)',
      async () => {
        const rowsOf = (contractId: string) =>
          prisma.payment.findMany({ where: { contractId }, orderBy: { installmentNo: 'asc' } });
        const split = (p: Awaited<ReturnType<typeof rowsOf>>[number]) =>
          [p.monthlyPrincipal, p.monthlyInterest, p.monthlyCommission, p.vatAmount].map((v) =>
            v === null ? null : v.toFixed(2),
          );
        // generatePaymentSchedule: ดอกเบี้ย 500 · ค่าคอม 1,000 ÷ 12 = 83.33 · เงินต้น 1,416.66 − 500 − 83.33 = 833.33 ·
        // VAT = ค่างวด − สามยอด · งวด 12 รับเศษ: เงินต้น 10,000 − 833.33 × 11 = 833.37 · ค่าคอม 83.37 · VAT 99.13
        const golden = Array.from({ length: 12 }, (_, i) =>
          i === 11
            ? [12, LAST, ['833.37', '500.00', '83.37', '99.13']]
            : [i + 1, MONTHLY, ['833.33', '500.00', '83.33', '99.17']],
        );
        for (const id of [a1, b1]) {
          expect(
            (await rowsOf(id)).map((p) => [p.installmentNo, p.amountDue.toFixed(2), split(p)]),
          ).toEqual(golden);
        }
        // ยอดเรียกเก็บของระบบเก่าที่ต่างจากตัวคำนวณ (B3: 1,515.84 ทุกงวด) — สี่ยอดยังรวมเท่ายอดเรียกเก็บ (เศษลง VAT)
        for (const p of await rowsOf(b3)) {
          const [principal, interest, commission, vat] = split(p);
          expect([principal, interest, commission, vat].includes(null)).toBe(false);
          expect(D(principal!).plus(interest!).plus(commission!).plus(vat!).toFixed(2)).toBe(
            p.amountDue.toFixed(2),
          );
          expect(p.amountDue.toFixed(2)).toBe('1515.84');
        }
        expect(split((await rowsOf(b3))[0])).toEqual(['833.33', '500.00', '83.33', '99.18']);
        expect(split((await rowsOf(b3))[11])).toEqual(['833.37', '500.00', '83.37', '99.10']);
      },
      LONG,
    );

    it(
      'legacy billing +0.01 / flat last installment (roundingDiff ≠ 0) still runs to zero — satang lands in 53-1503 / 52-1104',
      async () => {
        // ยอดเรียกเก็บ − ตัวคำนวณ ของงวดที่ยังไม่ชำระครบ: งวด 4–11 = +0.01 × 8 · งวด 12 = 1,515.84 − 1,515.87 = −0.03
        // ⇒ roundingDiff (บัญชี − PEAK) = −0.08 + 0.03 = −0.05
        const item = imported.item('B3');
        expect(item.roundingDiff.toFixed(2)).toBe('-0.05');
        expect(await carry(b3)).toEqual(cutoffCarry('1215.83'));

        await pay(b3, 4, '1215.84', MAY2);
        expect({ step: 'receipt 4', c: negatives(await carry(b3)) }).toEqual({
          step: 'receipt 4',
          c: [],
        });
        for (let no = 5; no <= 12; no++) {
          await nightly2A(b3, no);
          expect({ no, step: '2A', c: negatives(await carry(b3)) }).toEqual({
            no,
            step: '2A',
            c: [],
          });
          await pay(b3, no, '1515.84', P1.due(no));
          const after = await carry(b3);
          expect({ no, step: 'receipt', c: negatives(after) }).toEqual({
            no,
            step: 'receipt',
            c: [],
          });
          expect(after['11-2103']).toBe('0.00');
        }
        expect(await carry(b3)).toEqual(ALL_ZERO);
        const payments = await prisma.payment.findMany({
          where: { contractId: b3 },
          orderBy: { installmentNo: 'asc' },
        });
        expect(payments.every((p) => p.status === 'PAID')).toBe(true);
        // เก็บเกิน 0.01 × 8 ใบ → Cr 53-1503 0.08 · งวด 12 ขาด 0.03 (ยอดเรียกเก็บ < ตัวคำนวณ) → Dr 52-1104 0.03 อนุมัติอัตโนมัติ
        // (ผู้จ่ายครบยอดเรียกเก็บ) · สุทธิ 0.05 = −roundingDiff
        expect([await bal(b3, '53-1503', 'cr'), await bal(b3, '52-1104', 'dr')]).toEqual([
          '0.08',
          '0.03',
        ]);
        expect(await bal(b3, '41-1101', 'cr')).toBe('4000.00');
      },
      LONG,
    );

    it(
      'void after cutover of the receipt on a marker row → Payment back to PARTIALLY_PAID, 11-2103 restored, marker untouched',
      async () => {
        await pay(b4, 4, '1215.83', MAY2);
        expect(await bal(b4, '11-2103', 'dr')).toBe('0.00');
        const payment = await paymentOf(b4, 4);
        expect(payment.status).toBe('PAID');
        const receipt = await prisma.receipt.findFirstOrThrow({
          where: { paymentId: payment.id, isVoided: false, deletedAt: null },
        });
        expect(receipt.amount.toFixed(2)).toBe('1215.83');

        await voidReceiptApproved(
          prisma,
          receipts,
          receipt.id,
          'ทดสอบยกเลิกใบเสร็จหลังวันตัดระบบ',
          userId,
          approverId,
        );

        const reverted = await paymentOf(b4, 4);
        expect([reverted.status, reverted.amountPaid.toFixed(2), reverted.paidDate]).toEqual([
          'PARTIALLY_PAID',
          '300.00',
          null,
        ]);
        expect(await bal(b4, '11-2103', 'dr')).toBe('1215.83');
        const markers = (await entriesOf(b4)).filter((e) => flowOf(e) === 'legacy-prior-receipt');
        expect(markers).toHaveLength(1);
        expect(metaOf(markers[0]).reversed).toBeUndefined();
        expect(sortedLines(markers[0])).toEqual(['11-2103:0.00:300.00', '32-1101:300.00:0.00']);

        // รับใหม่หลังยกเลิก — ล้างเฉพาะส่วนที่เหลือได้อีกครั้ง
        await pay(b4, 4, '1215.83', MAY3);
        expect(await bal(b4, '11-2103', 'dr')).toBe('0.00');
        expect((await paymentOf(b4, 4)).status).toBe('PAID');
      },
      LONG,
    );

    // ── เคสจาก carry ของ Task 7 / 10 — แต่ละเคสสร้างสัญญาของตัวเอง ─────────────────────────────────────────────

    it(
      'bad-debt write-off on imported B with a due-unpaid installment equals native A (CN Dr 21-2101 79.54 via the stamped link)',
      async () => {
        const a = await createNative('A6', P1.date, P1.dueDay);
        await runNativeToCutoff(a, P1.due);
        const b = (
          await importLegacy(P1, [{ key: 'B6', installments: standardInstallments(legacyState()) }])
        ).contractId('B6');
        expect(await carry(b)).toEqual(cutoffCarry('1215.83'));

        const writeOff = new BadDebtWriteOffTemplate(journal, prisma as unknown as PrismaService);
        for (const id of [a, b]) await writeOff.execute({ contractId: id });
        const entryOf = async (id: string) => {
          const list = (await entriesOf(id)).filter((e) => flowOf(e) === 'write-off');
          expect(list).toHaveLength(1);
          return list[0];
        };
        const woA = await entryOf(a);
        const woB = await entryOf(b);
        // ใบลดหนี้ ม.82/5 ของงวด 4 ส่วนที่ค้าง (1,215.83) = VAT 79.54 — เห็นได้เพราะงวด 4 ของ B ประทับลิงก์ตั้งลูกหนี้แล้ว ·
        // หนี้สูญ = ลูกหนี้รวม VAT 13,342.51 − 79.54 = 13,262.97
        const golden = [
          '11-2101:0.00:11333.36',
          '11-2103:0.00:1215.83',
          '11-2105:0.00:793.32',
          '11-2106:4000.00:0.00',
          '21-2101:0.00:793.32',
          '21-2101:79.54:0.00',
          '21-2102:793.32:0.00',
          '41-1101:0.00:4000.00',
          '51-1102:13262.97:0.00',
        ];
        expect(sortedLines(woA)).toEqual(golden);
        expect(sortedLines(woB)).toEqual(golden);
        expect(await carry(b)).toEqual(ALL_ZERO);
        expect(await carry(a)).toEqual(ALL_ZERO);
      },
      LONG,
    );

    it(
      'JP5 repossession on imported B with a due-unpaid installment equals native A',
      async () => {
        const a = await createNative('A7', P1.date, P1.dueDay);
        await runNativeToCutoff(a, P1.due);
        const b = (
          await importLegacy(P1, [{ key: 'B7', installments: standardInstallments(legacyState()) }])
        ).contractId('B7');
        expect(await carry(b)).toEqual(cutoffCarry('1215.83'));

        const jp5 = new RepossessionJP5Template(journal, prisma as unknown as PrismaService);
        for (const id of [a, b]) {
          await jp5.execute({
            contractId: id,
            depositAccountCode: '11-1101',
            repossessionValue: D('5000.00'),
          });
        }
        const entryOf = async (id: string) => {
          const list = (await entriesOf(id)).filter((e) => flowOf(e) === 'repossession');
          expect(list).toHaveLength(1);
          return list[0];
        };
        const jp5A = await entryOf(a);
        const jp5B = await entryOf(b);
        // ราคาเครื่อง 5,000 · ใบลดหนี้ VAT 79.54 · ขาดทุน = 13,342.51 − 5,000 − 79.54 = 8,262.97
        const golden = [
          '11-1101:5000.00:0.00',
          '11-2101:0.00:11333.36',
          '11-2103:0.00:1215.83',
          '11-2105:0.00:793.32',
          '11-2106:4000.00:0.00',
          '21-2101:0.00:793.32',
          '21-2101:79.54:0.00',
          '21-2102:793.32:0.00',
          '41-1101:0.00:4000.00',
          '51-1102:8262.97:0.00',
        ];
        expect(sortedLines(jp5A)).toEqual(golden);
        expect(sortedLines(jp5B)).toEqual(golden);
        expect(await carry(b)).toEqual(ALL_ZERO);
        expect(await carry(a)).toEqual(ALL_ZERO);
      },
      LONG,
    );

    it(
      'future installment partially prepaid before cutover (marker + accrued columns) equals native A and runs to zero',
      async () => {
        // งวด 1–4 จ่ายครบ · งวด 5 (ครบ 5 พ.ค.) จ่ายล่วงหน้า 500 วันที่ 20 เม.ย. — native ตั้ง 2A เท่ายอดที่รับ (ก1)
        const a = await createNative('A5', P1.date, P1.dueDay);
        await runNativeToCutoff(a, P1.due, MONTHLY);
        await pay(a, 5, '500', APR20, true);
        const b = (
          await importLegacy(P1, [
            {
              key: 'B5',
              installments: standardInstallments({
                ...legacyState(MONTHLY),
                5: { paid: '500', paidOn: APR20 },
              }),
            },
          ])
        ).contractId('B5');

        // 2A บางส่วน 500: VAT 32.71 · มูลค่า 467.29 · ดอกเบี้ย 164.93 ⇒ 11-2101 = 11,333.36 − 467.29 · 11-2105 = 793.32 − 32.71 ·
        // 11-2106 = 4,000 − 164.93 · 21-2102 = 793.32 − 32.71 · 11-2103 = 500 − 500
        const atCutoff: Carry = {
          '11-2101': '10866.07',
          '11-2103': '0.00',
          '11-2105': '760.61',
          '11-2106': '3835.07',
          '21-2102': '760.61',
        };
        expect(await carry(a)).toEqual(atCutoff);
        expect(await carry(b)).toEqual(atCutoff);
        for (const id of [a, b]) {
          const s = await scheduleOf(id, 5);
          expect([
            s.accrualJournalEntryId,
            s.accruedAmount.toFixed(2),
            s.accruedVat.toFixed(2),
            s.accruedInterest.toFixed(2),
          ]).toEqual([null, '500.00', '32.71', '164.93']);
        }
        const bRefs = (await entriesOf(b)).filter((e) => flowOf(e) === 'legacy-prior-receipt');
        expect(bRefs.map(sortedLines)).toEqual([['11-2103:0.00:500.00', '32-1101:500.00:0.00']]);
        expect((await entriesOf(b)).filter((e) => flowOf(e) === 'legacy-vat-catchup')).toEqual([]);

        // วันครบกำหนดงวด 5: รอบกลางคืนตั้งส่วนที่เหลือ 1,015.83 (VAT 66.46 · ดอกเบี้ย 335.07) แล้วรับส่วนที่เหลือ
        for (const id of [a, b]) await nightly2A(id, 5);
        expect(await carry(b)).toEqual(await carry(a));
        expect(await bal(b, '11-2103', 'dr')).toBe('1015.83');
        const [rest] = await accrualEntriesOf(b, 5);
        expect(sortedLines(rest)).toEqual([
          '11-2101:0.00:949.37',
          '11-2103:1015.83:0.00',
          '11-2105:0.00:66.46',
          '11-2106:335.07:0.00',
          '21-2101:0.00:66.46',
          '21-2102:66.46:0.00',
          '41-1101:0.00:335.07',
        ]);
        for (const id of [a, b]) await pay(id, 5, '1015.83', P1.due(5));
        expect(await bal(b, '11-2103', 'dr')).toBe('0.00');
        expect((await paymentOf(b, 5)).status).toBe('PAID');

        for (let no = 6; no <= 12; no++) {
          for (const id of [a, b]) await nightly2A(id, no);
          for (const id of [a, b]) await pay(id, no, installmentAmount(no), P1.due(no));
          const c = await carry(b);
          expect({ no, negatives: negatives(c) }).toEqual({ no, negatives: [] });
          expect(c).toEqual(await carry(a));
        }
        expect(await carry(b)).toEqual(ALL_ZERO);
        // B รับรู้ดอกเบี้ย / VAT ตั้งแต่ส่วนที่เหลือของงวด 5: 335.07 + 500 × 7 · 66.46 + 99.17 × 6 + 99.13
        expect([await bal(b, '41-1101', 'cr'), await bal(b, '21-2101', 'cr')]).toEqual([
          '3835.07',
          '760.61',
        ]);
      },
      LONG,
    );

    it(
      'PEAK lower by the invoice satang → last installment billing trimmed (satangGap −0.04, roundingDiff +0.04) and the satang lands in 52-1104',
      async () => {
        // PEAK ใบแจ้งหนี้ 18,189.96 (1,515.83 × 12) ต่ำกว่า Σ ค่างวดระบบเก่า 18,190.00 อยู่ 0.04 · ยอดคงเหลือ PEAK ต่ำกว่าเท่ากัน
        const imp = await importLegacy(P1, [
          {
            key: 'B8',
            installments: standardInstallments(legacyState()),
            peakRemainOffset: '-0.04',
            peakNetAmount: '18189.96',
          },
        ]);
        const b = imp.contractId('B8');
        const item = imp.item('B8');
        expect([
          item.peak?.satangGap.toFixed(2),
          item.peak?.satangGapInstallmentNo,
          item.peak?.adjustment.toFixed(2),
          item.roundingDiff.toFixed(2),
        ]).toEqual(['-0.04', 12, '0.00', '0.04']);
        expect(imp.plan.totals.satangTrim.toFixed(2)).toBe('-0.04');
        // บัญชีคงยอดของตัวคำนวณ (เท่าสัญญาปกติ) · แถวงวด 12 เรียกเก็บ 1,515.83 · VAT ของแถวรับเศษ (1,515.83 − 1,416.74)
        expect(await carry(b)).toEqual(cutoffCarry('1215.83'));
        const last = await paymentOf(b, 12);
        expect([
          last.amountDue.toFixed(2),
          last.monthlyPrincipal?.toFixed(2),
          last.monthlyInterest?.toFixed(2),
          last.monthlyCommission?.toFixed(2),
          last.vatAmount?.toFixed(2),
        ]).toEqual(['1515.83', '833.37', '500.00', '83.37', '99.09']);

        await pay(b, 4, await owedOn(b, 4), MAY2);
        for (let no = 5; no <= 12; no++) {
          await nightly2A(b, no);
          await pay(b, no, await owedOn(b, no), P1.due(no));
          const c = await carry(b);
          expect({ no, negatives: negatives(c), r: c['11-2103'] }).toEqual({
            no,
            negatives: [],
            r: '0.00',
          });
        }
        expect(await carry(b)).toEqual(ALL_ZERO);
        // งวด 12 รับ 1,515.83 ต่ำกว่าตัวคำนวณ 1,515.87 → Dr 52-1104 0.04 (อนุมัติอัตโนมัติ — จ่ายครบยอดเรียกเก็บ) = roundingDiff
        expect([await bal(b, '52-1104', 'dr'), await bal(b, '53-1503', 'cr')]).toEqual([
          '0.04',
          '0.00',
        ]);
        expect((await paymentOf(b, 12)).status).toBe('PAID');
      },
      LONG,
    );

    it(
      'PEAK_LOWER_UNEXPLAINED FIFO leftover (0.50 on an unpaid due installment) equals native A and the first receipt after cutover closes the row',
      async () => {
        // ระบบเก่า: งวด 4 ไม่ได้จ่าย · PEAK ค้างน้อยกว่า 0.50 (ไม่ใช่เศษของยอดใบแจ้งหนี้) → ไล่ FIFO เป็นยอดจ่าย 0.50 ของงวด 4
        const a = await createNative('A9', P1.date, P1.dueDay);
        await runNativeToCutoff(a, P1.due, '0.50');
        const imp = await importLegacy(P1, [
          {
            key: 'B9',
            installments: standardInstallments(legacyState('0')),
            peakRemainOffset: '-0.50',
          },
        ]);
        const b = imp.contractId('B9');
        expect(
          imp.plan.warnings.filter(
            (w) => w.startsWith('PEAK_LOWER_UNEXPLAINED') && w.includes(imp.code('B9')),
          ),
        ).toHaveLength(1);
        const row4 = await paymentOf(b, 4);
        expect([row4.status, row4.amountPaid.toFixed(2)]).toEqual(['PARTIALLY_PAID', '0.50']);

        // marker 0.50 · ไล่ VAT = 99.17 − VAT ของ 0.50 (0.03) = 99.14
        const golden = cutoffCarry('1515.33');
        expect(await carry(a)).toEqual(golden);
        expect(await carry(b)).toEqual(golden);
        const catchUp = (await entriesOf(b)).filter((e) => flowOf(e) === 'legacy-vat-catchup');
        expect(catchUp.map(sortedLines)).toEqual([['21-2101:0.00:99.14', '21-2102:99.14:0.00']]);

        for (const id of [a, b]) await pay(id, 4, '1515.33', MAY2);
        for (const id of [a, b]) {
          expect(await bal(id, '11-2103', 'dr')).toBe('0.00');
          const p = await paymentOf(id, 4);
          expect([p.status, p.amountPaid.toFixed(2)]).toEqual(['PAID', '1515.83']);
        }
        expect(await carry(b)).toEqual(await carry(a));
        expect([await bal(b, '52-1104', 'dr'), await bal(b, '53-1503', 'cr')]).toEqual([
          '0.00',
          '0.00',
        ]);
      },
      LONG,
    );
  });

  // ── ปิดก่อนกำหนด (JP4) — ปฏิทินผูกกับวันนี้: งวด 6 ครบกำหนดวันที่ 1 ของเดือนนี้ · งวด 7–12 ยังไม่ถึงกำหนด ─────────────

  describe('early payoff after cutover (calendar anchored to today)', () => {
    let a2 = '';
    let b2 = '';

    beforeAll(async () => {
      // อ่านวันนี้ตอนเริ่มชุด (ไม่ใช่ตอนเก็บ describe) — ช่วงคร่อมเที่ยงคืนวันสิ้นเดือนเหลือแค่เวลาของชุดนี้
      const { year: Y, month: M } = bangkokCalendarParts(new Date());
      const ymd = (y: number, m: number, d: number) =>
        new Date(Date.UTC(y, m, d)).toISOString().slice(0, 10);
      const due = (no: number) => bangkokMidnight(Y, M - 6 + no, 1);
      const P2 = {
        date: ymd(Y, M - 6, 1),
        dueDay: 1,
        firstDue: [Y, M - 5, 1] as [number, number, number],
        // วินาทีสุดท้ายของเดือนที่งวด 4 ครบกำหนด (งวด 5 ครบวันที่ 1 ของเดือนถัดไป)
        cutoff: new Date(bangkokMidnight(Y, M - 1, 1).getTime() - 1000),
      };
      a2 = await createNative('A2', P2.date, P2.dueDay);
      await runNativeToCutoff(a2, due);
      const imported = await importLegacy(P2, [
        { key: 'B2', installments: standardInstallments(legacyState()) },
      ]);
      b2 = imported.contractId('B2');
      // หลังวันตัด: งวด 4 ส่วนที่เหลือ + งวด 5 + งวด 6 (ลงวันครบกำหนด — ไม่เกินวันนี้)
      for (const id of [a2, b2]) {
        await nightly2A(id, 5);
        await pay(id, 4, '1215.83', due(5));
        await pay(id, 5, MONTHLY, due(5));
        await nightly2A(id, 6);
        await pay(id, 6, MONTHLY, due(6));
      }
    }, LONG);

    it(
      'early payoff after cutover',
      async () => {
        const afterSix: Carry = {
          '11-2101': '8500.04',
          '11-2103': '0.00',
          '11-2105': '594.98',
          '11-2106': '3000.00',
          '21-2102': '594.98',
        };
        expect(await carry(a2)).toEqual(afterSix);
        expect(await carry(b2)).toEqual(afterSix);

        const quoteA = await contractPayments.getEarlyPayoffQuote(a2, 50);
        const quoteB = await contractPayments.getEarlyPayoffQuote(b2, 50);
        const money = (q: typeof quoteA) => ({
          remainingMonths: q.remainingMonths,
          notDueMonths: q.notDueMonths,
          discountAmount: q.discountAmount,
          totalPayoff: q.totalPayoff,
        });
        expect(money(quoteB)).toEqual(money(quoteA));
        // สูตรยอดปิด (computePayoffQuote ผ่าน getEarlyPayoffQuote): 6 งวดค้าง 9,094.98 ÷ 1.07 = 8,499.98 − ต้นทุน
        // (10,000 + 1,000) ÷ 12 × 6 = 5,500.00 → กำไร 2,999.98 × 50% = ส่วนลด 1,499.99 → ยอดปิด 7,594.99
        expect(money(quoteB)).toEqual({
          remainingMonths: 6,
          notDueMonths: 6,
          discountAmount: 1499.99,
          totalPayoff: 7594.99,
        });

        for (const id of [a2, b2]) {
          await earlyPayoffApproved(prisma, contractPayments, id, userId, {
            paymentMethod: 'BANK_TRANSFER',
            discountPct: 50,
            depositAccountCode: '11-1201',
          });
        }
        const jp4Of = async (id: string) => {
          const list = (await entriesOf(id)).filter((e) => flowOf(e) === 'early-payoff');
          expect(list).toHaveLength(1);
          return list[0];
        };
        const jp4A = await jp4Of(a2);
        const jp4B = await jp4Of(b2);
        expect(sortedLines(jp4B)).toEqual(sortedLines(jp4A));
        // ส่วนลด: ฐานยอดปิด = ส่วนลดของสูตรยอดปิดตัวเดียวกับสัญญาปกติ (1,499.99) · 52-1106 ในรายการ = ลูกหนี้ตามบัญชี
        // (8,500.04 + 594.98) − เงินที่รับ 7,594.99 = 1,500.03 — ต่างจากสูตรเฉพาะเศษงวดสุดท้าย 0.04 เหมือนสัญญาปกติทุกตัวอักษร
        expect(sortedLines(jp4B)).toEqual([
          '11-1201:7594.99:0.00',
          '11-2101:0.00:8500.04',
          '11-2105:0.00:594.98',
          '11-2106:3000.00:0.00',
          '21-2101:0.00:594.98',
          '21-2102:594.98:0.00',
          '41-1101:0.00:3000.00',
          '52-1106:1500.03:0.00',
        ]);
        const meta = jp4B.metadata as Record<string, string>;
        expect([meta.quoteDiscountAmount, meta.cashReceived, meta.discount]).toEqual([
          '1499.99',
          '7594.99',
          '1500.03',
        ]);

        expect(await carry(b2)).toEqual(ALL_ZERO);
        expect(await carry(a2)).toEqual(ALL_ZERO);
        const payments = await prisma.payment.findMany({ where: { contractId: b2 } });
        expect(payments.every((p) => p.status === 'PAID')).toBe(true);
      },
      LONG,
    );
  });
});
