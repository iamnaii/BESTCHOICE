import { Prisma, PrismaClient } from '@prisma/client';
import { seedFinanceCoa } from '../../../../prisma/seed-coa-finance';
import { seedShopCoa } from '../../../../prisma/seed-coa-shop';
import {
  earlyPayoffApproved,
  voidReceiptApproved,
} from '../../../cli/legacy-backoffice/__tests__/approval-fixture';
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
  type ContractSpec,
  type InstallmentSpec,
  shopCompanyForTest,
} from '../../../cli/legacy-backoffice/__tests__/synthetic-book';
import {
  findBoundReissueCandidates,
  findDocumentedElsewhere,
  findPaidPaymentsWithoutReceipt,
} from '../../../cli/backfill-payment-receipts.cli';
import type { DumpRow } from '../../../cli/legacy-backoffice/dump-reader';
import { legacyFileContentType, type LegacyFileDetail } from '../../../cli/legacy-backoffice/files';
import type { LegacyContract } from '../../../cli/legacy-backoffice/legacy-book';
import { planImport } from '../../../cli/legacy-backoffice/plan-import';
import { writeLegacyImport } from '../../../cli/legacy-backoffice/writer';
import type { PrismaService } from '../../../prisma/prisma.service';
import { bangkokCalendarParts, bangkokMidnight } from '../../../utils/date.util';
import { buildInstallmentScheduleRows } from '../../../utils/installment-schedule.util';
import { generatePaymentSchedule } from '../../../utils/installment.util';
import { loadLateFeeConfig, resolveLateFee } from '../../../utils/late-fee.util';
import { hashPII } from '../../../utils/pii.util';
import { TEST_NAME_PREFIX } from '../../../utils/test-data-markers';
import { ContractPaymentService } from '../../contracts/contract-payment.service';
import { CustomerPiiService } from '../../customers/customer-pii.service';
import { CompanyResolverService } from '../../journal/company-resolver.service';
import { ContractActivation1ATemplate } from '../../journal/cpa-templates/contract-activation-1a.template';
import { EarlyPayoffJP4Template } from '../../journal/cpa-templates/early-payoff-jp4.template';
import { EclStageReverseTemplate } from '../../journal/cpa-templates/ecl-stage-reverse.template';
import { InstallmentAccrual2ATemplate } from '../../journal/cpa-templates/installment-accrual-2a.template';
import { PaymentReceiptTemplate } from '../../journal/cpa-templates/payment-receipt.template';
import { ReceiptVoidReversalTemplate } from '../../journal/cpa-templates/receipt-void-reversal.template';
import { ShopCollectSettlementTemplate } from '../../journal/cpa-templates/shop-collect-settlement.template';
import { ShopInventoryTransferTemplate } from '../../journal/cpa-templates/shop-inventory-transfer.template';
import { Vat60dayReversalTemplate } from '../../journal/cpa-templates/vat-60day-reversal.template';
import { JournalAutoService } from '../../journal/journal-auto.service';
import { LEGACY_SYSTEM_USER_EMAIL } from '../../journal/legacy-import-journal';
import { PaymentReceiptOrchestrator } from '../../payments/services/payment-receipt-orchestrator';
import { ProductsService } from '../../products/products.service';
import { ReceiptsService } from '../../receipts/receipts.service';
import { RefundsService } from '../../refunds/refunds.service';
import { ReceivableReconService } from '../../receivable-recon/receivable-recon.service';
import type { AuditCheckResult } from '../data-audit.types';
import { ContractTraceService } from '../services/contract-trace.service';
import { DataAuditChecksService } from '../services/data-audit-checks.service';
import { EARLY_PAYOFF_PAYMENT_NOTE_PREFIX } from '../services/payment-backing';

/**
 * Task 16 — ตรวจกลางคืน (data-audit 06:00 + receivable-recon 02:00) บนสัญญาที่นำเข้าจากระบบเก่าและสัญญาปกติ — Postgres จริง
 * ข้อมูลสังเคราะห์ทั้งหมด (เลขสัญญา TEST-T16-<stamp>-…, เลขบัตรขึ้นต้น 09 คำนวณหลักตรวจเอง, เบอร์ 0975…, IMEI 35997…)
 *
 * - ขั้น 1 เช้าวันแรกหลังนำเข้า: สัญญานำเข้า (ผ่อนอยู่ · จ่ายล่วงหน้าบางส่วน · ยอดเรียกเก็บ ≠ ตัวคำนวณ · ประวัติจบ/ปิดก่อนกำหนด) และ
 *   สัญญาปกติ — ห้าข้อไม่มี finding · receivable-recon ไม่ breach
 * - ขั้น 2 หลังวันตัด: รับเงินพร้อมค่าปรับ · เศษปัด 53-1503 · เงินรับล่วงหน้า (พักภาษี PR4 แล้วหักโดยรอบกลางคืน) — ยังไม่มี finding
 * - ขั้น 3 ทำให้เพี้ยน (prisma ตรง): ต้องติดทุกข้อ ทั้งสัญญาปกติและงวดหลังวันตัดของสัญญานำเข้า (ไม่อ่อนลง)
 * - ปิดยอดก่อนกำหนด (JP4) ของสัญญาปกติ: งวดที่ JP4 ปิดไม่ติด orphan_payments (ปฏิทินผูกกับวันนี้ — สูตรยอดปิดนับงวดจากวันนี้) ·
 *   ส่วนเผื่อค่าปรับของ overpaid_contracts ให้เฉพาะงวดที่ JP4 จ่าย (Task 17 ข้อ B)
 *
 * ทุกข้อเรียกด้วย `scope.contractIds` ของสเปคนี้ (ฐานทดสอบอาจมีแถวของสเปคอื่น) · receivable-recon รันทั้งฐานแล้วดูเฉพาะสาขาของสเปคนี้
 *
 * รัน: DATABASE_URL=<ฐานทดสอบ test_db หรือ *_test> NODE_OPTIONS=--max-old-space-size=6144 npx jest <ไฟล์นี้> --runInBand ·
 * ไม่มี DATABASE_URL = ข้าม
 */
const KEY = 'c9'.repeat(32);
const SALT = 'legacy-t16-nightly-checks-salt-001';
const describeDb = process.env.DATABASE_URL ? describe : describe.skip;
const TX = { timeout: 120_000, maxWait: 20_000 };
const LONG = 600_000;
const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);

/** ปฏิทินหลัก (แบบเทสต์ทองคำ): ทำสัญญา 5 ธ.ค. 2024 · งวด n = 5 ของเดือน n ปี 2025 · วันตัดหลังงวด 4 */
const P1 = {
  date: '2024-12-05',
  dueDay: 5,
  firstDue: [2025, 0, 5] as [number, number, number],
  cutoff: new Date('2025-04-30T23:59:59+07:00'),
  due: (no: number) => bangkokMidnight(2025, no - 1, 5),
};
const APR20 = new Date('2025-04-20T10:00:00+07:00');
const MAY2 = new Date('2025-05-02T10:00:00+07:00');
const MAY3 = new Date('2025-05-03T10:00:00+07:00');
const DAY = 24 * 60 * 60 * 1000;
const installmentAmount = (no: number) => (no === 12 ? LAST : MONTHLY);
const full = (n: number): Record<number, InstallmentSpec> =>
  Object.fromEntries(Array.from({ length: n }, (_, i) => [i + 1, { paid: MONTHLY }]));
/** ระบบเก่า ณ วันตัด: งวด 1–3 จ่ายครบ · งวด 4 จ่าย 300 */
const legacyState = () => standardInstallments({ ...full(3), 4: { paid: '300' } });

type Check =
  | 'orphan_contracts'
  | 'orphan_payments'
  | 'overpaid'
  | 'vat'
  | 'hp'
  | 'missing_cogs'
  | 'late_fee_vat_leak'
  | 'commission_mismatch';

describeDb('nightly data-audit + receivable-recon on imported legacy contracts (real DB)', () => {
  let prisma: PrismaClient;
  let pii: CustomerPiiService;
  let journal: JournalAutoService;
  let accrual2A: InstallmentAccrual2ATemplate;
  let activation1A: ContractActivation1ATemplate;
  let orchestrator: PaymentReceiptOrchestrator;
  let contractPayments: ContractPaymentService;
  let receipts: ReceiptsService;
  let checks: DataAuditChecksService;
  let recon: ReceivableReconService;
  let refunds: RefundsService;

  const saved = { key: process.env.PII_ENCRYPTION_KEY, salt: process.env.PII_HASH_SALT };
  const stamp = Date.now().toString(36).toUpperCase();
  const batch = `t16-${stamp.toLowerCase()}`;
  let refSeq = 0;

  let financeCompanyId = '';
  let nativeBranchId = '';
  let legacyBranchId = '';
  let userId = '';
  let approverId = '';
  let importUserId = '';
  let createdImportUser = false;
  let createdAdminId: string | null = null;
  let createdShopId: string | null = null;
  const nativeContractIds: string[] = [];
  const nativeCustomerIds: string[] = [];
  const legacy = new Map<string, string>();
  const native = new Map<string, string>();

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
    await seedShopCoa(prisma); // ขาฝั่ง SHOP ของการเปิดสัญญา A1 (missing_cogs)
    const finance = await prisma.companyInfo.findFirst({
      where: { companyCode: 'FINANCE', deletedAt: null },
      select: { id: true },
    });
    if (!finance) throw new Error('ฐานทดสอบไม่มีบริษัท FINANCE (migration ควรสร้างให้)');
    financeCompanyId = finance.id;

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
            name: `${TEST_NAME_PREFIX} System Admin T16`,
            role: 'OWNER',
          },
        })
      ).id;
    }
    // บัญชีนำเข้าตัวจริง (อีเมลเดียวกับตัวนำเข้า) — ตัวแยกงวดนำเข้าของตรวจกลางคืนอ่านอีเมลนี้
    const importUser = await prisma.user.findUnique({
      where: { email: LEGACY_SYSTEM_USER_EMAIL },
      select: { id: true },
    });
    if (importUser) {
      importUserId = importUser.id;
    } else {
      importUserId = (
        await prisma.user.create({
          data: {
            email: LEGACY_SYSTEM_USER_EMAIL,
            name: 'ย้ายจากระบบเก่า',
            password: 'DISABLED_SERVICE_ACCOUNT_NOT_LOGIN_CAPABLE',
            isActive: false,
            isSystemUser: false,
          },
        })
      ).id;
      createdImportUser = true;
    }
    nativeBranchId = (
      await prisma.branch.create({
        data: { name: `${TEST_NAME_PREFIX} T16 ปกติ ${stamp}`, companyId: financeCompanyId },
      })
    ).id;
    // Task 15: ต้นทางสิทธิ์ของลูกค้าที่นำเข้าต้องเป็นสาขาใต้ SHOP — สาขานำเข้าจึงผูก SHOP
    const shop = await shopCompanyForTest(prisma, 'T16');
    if (shop.created) createdShopId = shop.id;
    legacyBranchId = (
      await prisma.branch.create({
        data: { name: `${TEST_NAME_PREFIX} T16 นำเข้า ${stamp}`, companyId: shop.id },
      })
    ).id;
    userId = (
      await prisma.user.create({
        data: {
          email: `t16-${stamp.toLowerCase()}@bestchoice-test.internal`,
          password: 'hashed_placeholder',
          name: `${TEST_NAME_PREFIX} ผู้รับเงิน T16`,
          role: 'OWNER',
          branchId: nativeBranchId,
        },
      })
    ).id;
    approverId = (
      await prisma.user.create({
        data: {
          email: `t16-approver-${stamp.toLowerCase()}@bestchoice-test.internal`,
          password: 'hashed_placeholder',
          name: `${TEST_NAME_PREFIX} ผู้อนุมัติ T16`,
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
    checks = new DataAuditChecksService(asService);
    recon = new ReceivableReconService(asService);
    refunds = new RefundsService(
      asService,
      {} as never,
      new ReceiptVoidReversalTemplate(journal, asService),
    );

    // สัญญาปกติ — A1 (ถึงวันตัดแบบเดียวกับสัญญานำเข้า) · A2 (เงินรับล่วงหน้า) · C1–C5 (เป้าทำให้เพี้ยนในขั้น 3)
    native.set('A1', await createNative('A1', P1.date, P1.dueDay));
    await bookShopActivation(native.get('A1')!);
    await runNativeToCutoff(native.get('A1')!);
    for (const key of ['A2', 'C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7', 'A4', 'A5']) {
      native.set(key, await createNative(key, P1.date, P1.dueDay));
    }
    // A6 (Task 23 · m-3): เปิดหลังต่อขา SHOP (2026-06-23) แต่ไม่มีขา SHOP ของการเปิดสัญญา — ตัวยกเว้นสัญญาก่อนต่อขา SHOP ต้องไม่ครอบ
    native.set('A6', await createNative('A6', '2026-07-01', 1));

    // สัญญานำเข้า — L1–L3 + H1/H2 (ต้องสะอาด) · L4–L8 (เป้าทำให้เพี้ยนในขั้น 3)
    const flat = Array.from({ length: 12 }, () => ({ amount: '1515.84' }));
    await importLegacy([
      { key: 'L1', installments: legacyState() },
      {
        key: 'L2',
        installments: standardInstallments({ ...full(4), 5: { paid: '500', paidOn: APR20 } }),
      },
      {
        // ระบบเก่าเรียกเก็บ 1,515.84 ทุกงวด (งวด 1–11 = ตัวคำนวณ + 0.01 · งวด 12 = ตัวคำนวณ − 0.03) ⇒ roundingDiff −0.05
        key: 'L3',
        installments: flat.map((inst, i) =>
          i < 3 ? { ...inst, paid: '1515.84' } : i === 3 ? { ...inst, paid: '300' } : inst,
        ),
        detail: { installment_amount: '1515.84' },
      },
      {
        // ประวัติจบ: ราคา − ดาวน์ (9,500) ≠ ยอดจัด finance (10,000) และงวด 1 จ่ายเกินค่างวด — สูตรหัวสัญญาเดิมขึ้น CRITICAL
        key: 'H1',
        statusCode: '3',
        date: '2023-12-05',
        firstDue: [2024, 0, 5],
        installments: standardInstallments({ ...full(12), 1: { paid: '1600' } }),
        detail: { ref_product_price: '11500' },
        peakRemain: '0',
      },
      {
        key: 'H2',
        statusCode: '3',
        date: '2024-03-01',
        firstDue: [2024, 3, 1],
        installments: standardInstallments(full(6)),
        close: { amount: '7500', discount: '1595', date: new Date('2024-10-15T11:00:00+07:00') },
        peakRemain: '0',
      },
      { key: 'L4', installments: legacyState() },
      { key: 'L5', installments: legacyState() },
      { key: 'L6', installments: legacyState() },
      { key: 'L7', installments: legacyState() },
      { key: 'L8', installments: legacyState() },
      { key: 'L9', installments: legacyState() },
      { key: 'L9B', installments: legacyState() },
      { key: 'L9R', installments: legacyState() },
    ]);
  }, LONG);

  afterAll(async () => {
    if (!prisma) return;
    try {
      const legacyRows = await prisma.contract.findMany({
        where: { legacyContractCode: { startsWith: `TEST-T16-${stamp}` } },
        select: { id: true },
      });
      const contracts = await prisma.contract.findMany({
        where: { id: { in: [...nativeContractIds, ...legacyRows.map((c) => c.id)] } },
        select: { id: true, productId: true, customerId: true },
      });
      const contractIds = contracts.map((c) => c.id);
      const entries = await prisma.journalEntry.findMany({
        where: {
          OR: [
            ...contractIds.map((id) => ({ metadata: { path: ['contractId'], equals: id } })),
            { metadata: { path: ['importBatch'], string_starts_with: batch } },
          ],
        },
        select: { id: true },
      });
      const entryIds = entries.map((e) => e.id);
      await prisma.receipt.deleteMany({
        where: { contractId: { in: contractIds }, voidedReceiptId: { not: null } },
      });
      await prisma.receipt.deleteMany({ where: { contractId: { in: contractIds } } });
      await prisma.journalPostAuditLog.deleteMany({ where: { journalEntryId: { in: entryIds } } });
      await prisma.journalLine.deleteMany({ where: { journalEntryId: { in: entryIds } } });
      await prisma.journalEntry.deleteMany({ where: { id: { in: entryIds } } });
      await prisma.paymentEvidence.deleteMany({ where: { contractId: { in: contractIds } } });
      await prisma.refund.deleteMany({ where: { contractId: { in: contractIds } } });
      await prisma.payment.deleteMany({ where: { contractId: { in: contractIds } } });
      await prisma.installmentSchedule.deleteMany({ where: { contractId: { in: contractIds } } });
      await prisma.contractDocument.deleteMany({ where: { contractId: { in: contractIds } } });
      await prisma.contract.deleteMany({ where: { id: { in: contractIds } } });
      await prisma.product.deleteMany({ where: { id: { in: contracts.map((c) => c.productId) } } });
      const customers = await prisma.customer.findMany({
        where: {
          OR: [
            { legacyMemberCode: { startsWith: `TEST-T16M-${stamp}` } },
            { id: { in: [...nativeCustomerIds, ...contracts.map((c) => c.customerId)] } },
          ],
        },
        select: { id: true, contactId: true },
      });
      await prisma.customer.deleteMany({ where: { id: { in: customers.map((c) => c.id) } } });
      await prisma.contact.deleteMany({
        where: { id: { in: customers.map((c) => c.contactId).filter((id): id is string => !!id) } },
      });
      await prisma.receivableReconLog.deleteMany({
        where: { branchId: { in: [nativeBranchId, legacyBranchId] } },
      });
      // AuditLog เป็นแบบเขียนครั้งเดียว — ผู้ใช้ที่ถูกอ้างลบไม่ได้: ปิดใช้งานแทน
      for (const id of [
        createdAdminId,
        createdImportUser ? importUserId : null,
        userId,
        approverId,
      ]) {
        if (!id) continue;
        await prisma.user.delete({ where: { id } }).catch(async () => {
          await prisma.user.update({
            where: { id },
            data: { isActive: false, deletedAt: new Date() },
          });
        });
      }
      for (const id of [nativeBranchId, legacyBranchId]) {
        await prisma.branch.delete({ where: { id } }).catch(async () => {
          await prisma.branch.update({ where: { id }, data: { deletedAt: new Date() } });
        });
      }
      if (createdShopId) {
        await prisma.companyInfo.delete({ where: { id: createdShopId } }).catch(() => undefined);
      }
    } finally {
      await prisma.$disconnect();
      if (saved.key === undefined) delete process.env.PII_ENCRYPTION_KEY;
      else process.env.PII_ENCRYPTION_KEY = saved.key;
      if (saved.salt === undefined) delete process.env.PII_HASH_SALT;
      else process.env.PII_HASH_SALT = saved.salt;
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

  const scheduleOf = (contractId: string, installmentNo: number) =>
    prisma.installmentSchedule.findUniqueOrThrow({
      where: { contractId_installmentNo: { contractId, installmentNo } },
    });

  const paymentOf = (contractId: string, installmentNo: number) =>
    prisma.payment.findFirstOrThrow({ where: { contractId, installmentNo, deletedAt: null } });

  async function nightly2A(contractId: string, installmentNo: number) {
    return accrual2A.execute((await scheduleOf(contractId, installmentNo)).id);
  }

  /** ใบรับชำระผ่านเส้นทางหน้าจอรับชำระ (แบบเทสต์ทองคำ) · `partial` = case PARTIAL */
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
      undefined,
      undefined,
      `T16-${stamp}-${++refSeq}`,
      '11-1101',
      undefined,
      partial ? 'PARTIAL' : undefined,
      undefined,
      paidDate,
      undefined,
      undefined,
      undefined,
      true,
    );
  }

  async function owedOn(contractId: string, installmentNo: number): Promise<string> {
    const p = await paymentOf(contractId, installmentNo);
    return p.amountDue.minus(p.amountPaid).toFixed(2);
  }

  /** สัญญาปกติ — ตารางงวด + แถว Payment จริง + 1A (แบบเทสต์ทองคำ `createNative`) */
  async function createNative(key: string, date: string, dueDay: number): Promise<string> {
    const contractDate = new Date(`${date}T10:00:00+07:00`);
    const customer = await prisma.customer.create({
      data: { name: `${TEST_NAME_PREFIX} T16 สัญญาปกติ ${key}` },
    });
    nativeCustomerIds.push(customer.id);
    const product = await prisma.product.create({
      data: {
        name: `${TEST_NAME_PREFIX} T16 ${key}`,
        brand: 'Apple',
        model: 'iPhone ทดสอบ 13',
        imeiSerial: imei(),
        category: 'PHONE_USED',
        costPrice: D(0),
        branchId: nativeBranchId,
        ownedByCompanyId: financeCompanyId,
        status: 'SOLD_INSTALLMENT',
        isOnlineVisible: false,
      },
    });
    const contract = await prisma.contract.create({
      data: {
        contractNumber: `TEST-T16N-${stamp}-${key}`,
        customerId: customer.id,
        productId: product.id,
        branchId: nativeBranchId,
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
    const payments = generatePaymentSchedule(
      contract.id,
      12,
      18190,
      Number(MONTHLY),
      dueDay,
      { principal: 10000, storeCommission: 1000, interestTotal: 6000, vatAmount: 1190 },
      contractDate,
    );
    await prisma.payment.createMany({ data: payments });
    await activation1A.execute(contract.id, undefined, contractDate);
    return contract.id;
  }

  /**
   * ขาฝั่ง SHOP ของการเปิดสัญญาที่ createNative ไม่ได้ลง (`ContractWorkflowService.activate` → ShopInventoryTransferTemplate):
   * เครื่องต้นทุน 9,000 → ต้นทุนขาย flow `shop-inventory-transfer-cogs` + รายได้หน้าร้าน ผูก `metadata.contractId`
   */
  async function bookShopActivation(contractId: string) {
    const asService = prisma as unknown as PrismaService;
    const c = await prisma.contract.findUniqueOrThrow({
      where: { id: contractId },
      select: { contractNumber: true, productId: true, createdAt: true },
    });
    await prisma.product.update({ where: { id: c.productId }, data: { costPrice: D(9000) } });
    await new ShopInventoryTransferTemplate(
      journal,
      asService,
      new CompanyResolverService(asService),
    ).execute({
      idempotencyKey: `shop-inventory-transfer:${contractId}`,
      contractId,
      contractNumber: c.contractNumber,
      productId: c.productId,
      inventoryAccountCode: 'S11-2002',
      cogsAccountCode: 'S50-1102',
      revenueAccountCode: 'S41-1102',
      costPrice: D(9000),
      salePrice: D(12000),
      downAmount: D(2000),
      financedAmount: D(10000),
      commission: D(1000),
      postedAt: c.createdAt,
    });
  }

  /** ถึงวันตัด: 2A งวด 1–4 · รับงวด 1–3 เต็มงวด · งวด 4 รับ 300 — ลงวันครบกำหนด */
  async function runNativeToCutoff(contractId: string, due: (no: number) => Date = P1.due) {
    for (let no = 1; no <= 4; no++) {
      await nightly2A(contractId, no);
      const amount = no < 4 ? MONTHLY : '300';
      await pay(contractId, no, amount, due(no), D(amount).lt(installmentAmount(no)));
    }
  }

  type LegacySpec = {
    key: string;
    installments: InstallmentSpec[];
    detail?: Record<string, string | null>;
    statusCode?: string;
    date?: string;
    firstDue?: [number, number, number];
    close?: ContractSpec['close'];
    /** ยอดคงเหลือ PEAK (ไม่ส่ง = ยอดค้างของระบบเก่า) */
    peakRemain?: string;
  };

  /** สมุดระบบเก่าสังเคราะห์ → `planImport` → `writeLegacyImport` (ธุรกรรมเดียว · ผู้ใช้ = บัญชีนำเข้า) */
  async function importLegacy(specs: LegacySpec[]) {
    const code = (key: string) => `TEST-T16-${stamp}-${key}`;
    const contracts: LegacyContract[] = [];
    const members: DumpRow[] = [];
    for (const [i, spec] of specs.entries()) {
      const memberId = `16${i + 1}`;
      members.push(
        syntheticMember({
          id: memberId,
          code: `TEST-T16M-${stamp}-${spec.key}`,
          nationalId: await freshNationalId(),
          phone: await freshPhone(),
          name: `${TEST_NAME_PREFIX} T16 สมาชิก`,
        }),
      );
      contracts.push(
        syntheticContract({
          id: `16${i + 1}`,
          code: code(spec.key),
          statusCode: spec.statusCode,
          date: spec.date ?? P1.date,
          memberId,
          firstDue: spec.firstDue ?? P1.firstDue,
          imei: imei(),
          installments: spec.installments,
          detail: spec.detail,
          close: spec.close,
        }),
      );
    }
    const plan = planImport(syntheticBook(contracts, members), {
      cutoff: P1.cutoff,
      peakRecon: syntheticRecon(
        contracts.map((c, i) => [c, peakMatch(c, `T16${stamp}${i}`, specs[i].peakRemain)]),
      ),
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
          branchId: legacyBranchId,
          systemUserId: importUserId,
          files,
          importBatch: batch,
        }),
      TX,
    );
    for (const spec of specs) {
      const id = report.contractIds.get(code(spec.key));
      if (!id) throw new Error(`ไม่พบสัญญานำเข้า ${spec.key}`);
      legacy.set(spec.key, id);
    }
  }

  const ids = (map: Map<string, string>, keys: string[]) => keys.map((k) => map.get(k)!);

  async function run(check: Check, contractIds: string[]): Promise<AuditCheckResult> {
    const scope = { contractIds };
    switch (check) {
      case 'orphan_contracts':
        return checks.checkOrphanContracts(scope);
      case 'orphan_payments':
        return checks.checkOrphanPayments(scope);
      case 'overpaid':
        return checks.checkOverpaidContracts(scope);
      case 'vat':
        return checks.checkVatMismatch(scope);
      case 'hp':
        return checks.checkHpReceivableReconciliation(scope);
      case 'missing_cogs':
        return checks.checkMissingCogs(scope);
      case 'late_fee_vat_leak':
        return checks.checkLateFeeVatLeak(scope);
      case 'commission_mismatch':
        return checks.checkCommissionMismatch(); // ไม่มีขอบเขต — ข้อนี้ไม่อ่านฐาน (SKIPPED)
    }
  }

  /**
   * ห้าข้อหลัก + ข้อ MEDIUM ที่ Task 18 แก้ ไม่มี finding — รายงานชื่อข้อ + รายละเอียดเมื่อมี (ให้อ่านง่ายตอนแดง) ·
   * `commission_mismatch` ต้องเป็น SKIPPED (ไม่ใช่ FAIL รายวัน)
   */
  async function expectClean(contractIds: string[]) {
    const results: Record<string, unknown> = {};
    for (const check of [
      'orphan_contracts',
      'orphan_payments',
      'overpaid',
      'vat',
      'hp',
      'missing_cogs',
      'late_fee_vat_leak',
      'commission_mismatch',
    ] as Check[]) {
      const r = await run(check, contractIds);
      results[check] =
        r.status === 'SKIPPED' && r.count === 0
          ? 'SKIPPED'
          : r.count === 0 && r.status === 'PASS'
            ? 'PASS'
            : r.details;
    }
    expect(results).toEqual({
      orphan_contracts: 'PASS',
      orphan_payments: 'PASS',
      overpaid: 'PASS',
      vat: 'PASS',
      hp: 'PASS',
      missing_cogs: 'PASS',
      late_fee_vat_leak: 'PASS',
      commission_mismatch: 'SKIPPED',
    });
  }

  async function reconBreachesOf(branchIds: string[]) {
    const result = await recon.reconcileBranches();
    return result.breached.filter((b) => branchIds.includes(b.branchId));
  }

  const hpBreaches = async (contractId: string) => {
    const r = await run('hp', [contractId]);
    return (r.details[0] as { breaches: Array<{ contractId: string; gap: string }> }).breaches;
  };

  /**
   * รายชื่อของ `backfill:receipts` ที่ตกในสัญญาเหล่านี้ — `cli` = ออกใบที่ไม่ผูกรายการ · `bound` = ส่งไปออกซ้ำแบบผูกรายการ ·
   * `elsewhere` = ข้ามเพราะเอกสารของเงินอยู่ที่อื่น (`<สัญญา>#<งวด>:<ทาง b|c|b+c>` — Task 25 · r-1)
   */
  const backfillListsOf = async (contractIds: string[]) => {
    const asService = prisma as unknown as PrismaService;
    const pick = (
      rows: { contract_id: string; contract_number: string; installment_no: number }[],
    ) =>
      rows
        .filter((r) => contractIds.includes(r.contract_id))
        .map((r) => `${r.contract_number}#${r.installment_no}`)
        .sort();
    return {
      cli: pick(await findPaidPaymentsWithoutReceipt(asService)),
      bound: pick(await findBoundReissueCandidates(asService)),
      elsewhere: (await findDocumentedElsewhere(asService))
        .filter((r) => contractIds.includes(r.contract_id))
        .map((r) => `${r.contract_number}#${r.installment_no}:${r.path}`)
        .sort(),
    };
  };

  const orphanRowsOf = async (contractId: string) =>
    ((await run('orphan_payments', [contractId])).details as Array<{ installment_no: number }>)
      .map((r) => r.installment_no)
      .sort((a, b) => a - b);

  const cleanKeys = () => [
    ...ids(native, ['A1', 'A2', 'C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7', 'A4', 'A5']),
    ...ids(legacy, [
      'L1',
      'L2',
      'L3',
      'H1',
      'H2',
      'L4',
      'L5',
      'L6',
      'L7',
      'L8',
      'L9',
      'L9B',
      'L9R',
    ]),
  ];

  // ── ขั้น 1–3 (ลำดับในไฟล์ = ลำดับเวลา) ─────────────────────────────────────────────────────────

  it(
    'stage 1 — morning after the import: no finding on imported (active + history) or native contracts',
    async () => {
      await expectClean(cleanKeys());
      expect(await reconBreachesOf([nativeBranchId, legacyBranchId])).toEqual([]);

      // สภาพที่ทำให้ข้อเดิมเตือนปลอมมีอยู่จริง — ไม่ใช่ผ่านเพราะข้อมูลไม่มี
      const h1Rows = await prisma.payment.findMany({ where: { contractId: legacy.get('H1') } });
      expect(h1Rows.some((p) => p.amountPaid.gt(p.amountDue.plus(1)))).toBe(true);
      expect(h1Rows.every((p) => p.recordedById === importUserId && p.paymentMethod === null)).toBe(
        true,
      );
      expect(
        await prisma.installmentSchedule.count({ where: { contractId: legacy.get('H1') } }),
      ).toBe(0);
      const l3 = (await run('hp', ids(legacy, ['L3']))).details[0] as { gap: string };
      expect(l3.gap).toBe('-0.05'); // roundingDiff ของสัญญา (บัญชี − ยอดเรียกเก็บ) อยู่ในเกณฑ์

      // missing_cogs (Task 18): สัญญาปกติ A1 มีต้นทุนเครื่อง 9,000 และขา SHOP ของการเปิดสัญญาจริง (ข้อเดิมหา reference_type
      // 'CONTRACT_COGS' ที่ไม่มีผู้เขียน ⇒ ติด) · สัญญานำเข้าไม่มีขา SHOP โดยตั้งใจ (การขายฝั่งหน้าร้านอยู่ใน PEAK) — เครื่องนำเข้า
      // ต้นทุน 0 และถ้ามีคนใส่ต้นทุนให้เครื่องนำเข้าภายหลัง ก็ยังไม่ติด (ตัวแยก legacy_contract_code)
      const a1Product = await prisma.contract.findUniqueOrThrow({
        where: { id: native.get('A1')! },
        select: { product: { select: { costPrice: true } } },
      });
      expect(a1Product.product.costPrice.toFixed(2)).toBe('9000.00');
      const l1 = await prisma.contract.findUniqueOrThrow({
        where: { id: legacy.get('L1')! },
        select: { productId: true, product: { select: { costPrice: true } } },
      });
      expect(l1.product.costPrice.toFixed(2)).toBe('0.00');
      await prisma.product.update({ where: { id: l1.productId }, data: { costPrice: D(8000) } });
      expect((await run('missing_cogs', cleanKeys())).count).toBe(0);

      // missing_cogs (Task 23 · m-3): สัญญาปกติที่เปิดก่อนต่อขา SHOP — C4 (1A ลง 2024-12-05 · สมุด SHOP ไม่มีลูกหนี้ FINANCE ของสัญญา =
      // legacyNoShop) — ไม่มีต้นทุนขายฝั่ง SHOP โดยชอบ แม้มีคนใส่ต้นทุนเครื่องภายหลัง (เดิมติด) · A6 เปิดหลังต่อขา SHOP (2026-07-01) แต่ไม่มีขา
      // SHOP ยังติด — ตัวยกเว้นต้องครบทั้งสมุด SHOP ว่างและวันเปิดก่อนต่อขา (สมุดว่างอย่างเดียว = ข้อนี้ตาบอดกับการเปิดสัญญาที่ไม่ลงขา SHOP)
      const [c4, a6] = ids(native, ['C4', 'A6']);
      for (const id of [c4, a6]) {
        const { productId } = await prisma.contract.findUniqueOrThrow({
          where: { id },
          select: { productId: true },
        });
        await prisma.product.update({ where: { id: productId }, data: { costPrice: D(9000) } });
      }
      expect(
        ((await run('missing_cogs', [c4, a6])).details as Array<{ id: string }>).map((r) => r.id),
      ).toEqual([a6]);

      // commission_mismatch (Task 18 → SKIPPED): ข้อเดิมเทียบค่าคอมต่องวด (monthlyCommission ของงวด PAID) กับ Cr 42-1105 ซึ่งตอนนี้คือ
      // กำไรจากการจำหน่ายสินทรัพย์ — FINANCE ตั้งค่าคอมครั้งเดียวเป็นหนี้สิน 21-1102 ใน 1A ⇒ งวด PAID ที่มีค่าคอมติดทุกงวด (นำเข้า + ปกติ)
      expect(
        await prisma.payment.count({
          where: {
            contractId: { in: ids(legacy, ['L1', 'H1']).concat(ids(native, ['A1'])) },
            status: 'PAID',
            monthlyCommission: { gt: 0 },
          },
        }),
      ).toBeGreaterThan(0);

      // trace รายสัญญา (Task 18 — ใช้ตัวตรวจชุดเดียวกัน scope ที่สัญญานั้น): สัญญาปกติที่มีขา SHOP ของการเปิดสัญญา · สัญญานำเข้า
      // ผ่อนอยู่ · สัญญาประวัติ (ไม่มีตารางงวด) — ไม่มีข้อ FAIL (เดิม 'CONTRACT' / 'CONTRACT_COGS' / 11-2102 / InterCompanyTransaction
      // ทำให้ติดทุกสัญญา)
      const trace = new ContractTraceService(prisma as unknown as PrismaService, checks);
      const traced: Record<string, string[]> = {};
      for (const [key, id] of [
        ['A1', native.get('A1')!],
        ['L1', legacy.get('L1')!],
        ['H1', legacy.get('H1')!],
        ['C4', c4],
        ['A6', a6],
      ] as const) {
        const t = await trace.traceContract(id);
        traced[key] = Object.values(t.checks)
          .flat()
          .filter((c) => c.status === 'FAIL')
          .map((c) => c.name);
        expect(t.checks.commissionTotal.status).toBe('SKIPPED');
      }
      // Task 23 · m-3: C4 (ก่อนต่อขา SHOP) ไม่ติดต้นทุนขาย / ระหว่างกิจการ · A6 (หลังต่อขา SHOP ไม่มีขา SHOP) ติดทั้งสองข้อ
      expect(traced).toEqual({ A1: [], L1: [], H1: [], C4: [], A6: ['cogs', 'interCompany'] });

      // backfill:receipts (Task 18 review m-2): งวดนำเข้าที่ PAID ก่อนวันตัดไม่มีใบเสร็จในระบบโดยตั้งใจ (PEAK ลงเงินยุคเก่าไปแล้ว) —
      // ตัวออกใบตามหลังต้องไม่หยิบมาออกใบกำกับภาษี ไม่ว่าจะรันเมื่อไร
      const importedPaid = await prisma.payment.count({
        where: { contractId: { in: ids(legacy, ['L1', 'H1']) }, status: 'PAID' },
      });
      expect(importedPaid).toBeGreaterThan(0);
      const backfillCandidates = async (contractIds: string[]) =>
        (await findPaidPaymentsWithoutReceipt(prisma as unknown as PrismaService))
          .filter((r) => contractIds.includes(r.contract_id))
          .map((r) => [r.contract_number, r.installment_no]);
      expect(await backfillCandidates(cleanKeys())).toEqual([]);
      expect(
        (await findBoundReissueCandidates(prisma as unknown as PrismaService)).filter((r) =>
          cleanKeys().includes(r.contract_id),
        ),
      ).toEqual([]);
    },
    LONG,
  );

  it(
    'stage 2 — after cutover: late fee, rounding into 53-1503, advance parked (PR4 VAT) then consumed by 2A — still clean',
    async () => {
      const lateFee = resolveLateFee(await loadLateFeeConfig(prisma), 10);
      expect(lateFee.gt(1)).toBe(true);
      // A1 / L1: งวด 4 ส่วนที่เหลือ · 2A งวด 5 · รับงวด 5 ช้า 10 วัน พร้อมค่าปรับ (amountPaid รวมค่าปรับ)
      for (const id of [native.get('A1')!, legacy.get('L1')!]) {
        await pay(id, 4, await owedOn(id, 4), MAY3);
        await nightly2A(id, 5);
        await pay(
          id,
          5,
          D(MONTHLY).plus(lateFee).toFixed(2),
          new Date(P1.due(5).getTime() + 10 * DAY),
        );
        const p5 = await paymentOf(id, 5);
        expect(p5.amountPaid.toFixed(2)).toBe(D(MONTHLY).plus(lateFee).toFixed(2));
        expect(p5.status).toBe('PAID');
        // late_fee_vat_leak (Task 18): แถวมีค่าปรับ และ VAT ของงวดมาจาก 2A ไม่ใช่จากใบรับชำระ — ข้อเดิมเทียบ Cr 21-2101 ของใบรับ
        // (0) กับ Payment.vatAmount ⇒ ติดทุกงวดที่มีค่าปรับ
        expect([p5.lateFee.toFixed(2), p5.vatAmount?.gt(0)]).toEqual([lateFee.toFixed(2), true]);
      }
      // L2: 2A งวด 5 ส่วนที่เหลือ แล้วรับส่วนที่เหลือวันครบกำหนด
      const l2 = legacy.get('L2')!;
      await nightly2A(l2, 5);
      await pay(l2, 5, await owedOn(l2, 5), P1.due(5));
      // L3: ยอดเรียกเก็บ 1,515.84 > ตัวคำนวณ 1,515.83 → เศษ 0.01 ลง 53-1503 ทุกใบ
      const l3 = legacy.get('L3')!;
      await pay(l3, 4, '1215.84', MAY2);
      await nightly2A(l3, 5);
      await pay(l3, 5, '1515.84', P1.due(5));
      // A2: งวด 1 รับสองงวด → เกิน 1,515.83 พักเป็นเงินรับล่วงหน้า (ภาษีพัก PR4) → 2A งวด 2 หักเข้างวด (ไม่มี paymentId)
      const a2 = native.get('A2')!;
      await nightly2A(a2, 1);
      await pay(a2, 1, D(MONTHLY).times(2).toFixed(2), P1.due(1));
      const parked = await run('vat', [a2]);
      expect(parked.count).toBe(0); // 11-2105 − 21-2102 = ภาษีของเงินรับล่วงหน้าที่ยังค้าง (99.17)
      await nightly2A(a2, 2);
      const p2 = await paymentOf(a2, 2);
      expect([p2.status, p2.amountPaid.toFixed(2), p2.paymentMethod]).toEqual([
        'PAID',
        MONTHLY,
        null,
      ]);
      // backfill:receipts (Task 23 review m-1 ข): งวด 2 ของ A2 ล้างด้วยรอบกลางคืนหักเงินรับล่วงหน้าทั้งงวด — ไม่มีแถวใบเสร็จ ไม่มีรายการผูก
      // paymentId แต่เงินนั้นออกเอกสารพร้อมภาษีแล้วตอนรับ (ใบงวด 1 แถว "พักไว้") ⇒ ไม่ใช่ผู้สมัคร CLI (เดิมได้ใบ INSTALLMENT ใบที่สอง) และไม่อยู่ใน
      // รายชื่อออกซ้ำ (ไม่มีรายการรับชำระให้ผูก) — คำตัดสินเดียวกับทาง (b) ของ orphan_payments · CLI พิมพ์ไว้ว่าข้ามด้วยทาง b (Task 25)
      expect(await prisma.receipt.count({ where: { paymentId: p2.id } })).toBe(0);
      expect(await backfillListsOf([a2])).toEqual({
        cli: [],
        bound: [],
        elsewhere: [`TEST-T16N-${stamp}-A2#2:b`],
      });
      // L9B: งวด 4 (marker 300) รับส่วนที่เหลือหลังวันตัด แล้วยกเลิกใบเสร็จ — แถวกลับเป็นยอดก่อนวันตัด แต่ยังถือ
      // payment_method / ผู้บันทึกของใบที่ยกเลิก (ไม่กลับมาเป็น "ไม่ถูกแตะ") ⇒ หนุนด้วยต้นฉบับที่ reversed=true ตาม (ก)
      const l9b = legacy.get('L9B')!;
      await pay(l9b, 4, await owedOn(l9b, 4), MAY2);
      const l9bRow4 = await paymentOf(l9b, 4);
      const l9bReceipt = await prisma.receipt.findFirstOrThrow({
        where: { paymentId: l9bRow4.id, isVoided: false, deletedAt: null },
      });
      await voidReceiptApproved(
        prisma,
        receipts,
        l9bReceipt.id,
        'ทดสอบยกเลิกใบเสร็จหลังวันตัดระบบ (T16)',
        userId,
        approverId,
      );
      const reverted = await paymentOf(l9b, 4);
      expect([reverted.status, reverted.amountPaid.toFixed(2), reverted.paymentMethod]).toEqual([
        'PARTIALLY_PAID',
        '300.00',
        'CASH',
      ]);

      await expectClean(cleanKeys());
      expect(await reconBreachesOf([nativeBranchId, legacyBranchId])).toEqual([]);
    },
    LONG,
  );

  /** คืนเงินผ่านเส้นทางจริง: ขอ (ฝ่ายบัญชี) → อนุมัติ (OWNER คนละคน) → ยืนยันธนาคาร (OWNER) */
  async function refundInFull(paymentId: string, amount: string) {
    const refund = await refunds.requestRefund(
      { paymentId, amount: Number(amount), reason: 'ทดสอบคืนเงินหลังวันตัดระบบ (T17)' },
      approverId,
    );
    await refunds.approveRefund(refund.id, userId, 'OWNER');
    await refunds.markReversed(
      refund.id,
      { bankReversalRef: `T17-${stamp}-${++refSeq}`, notes: 'ทดสอบ' },
      userId,
      'OWNER',
    );
  }

  it(
    'stage 2b — refunds after cutover: money that cleared the row without a receipt survives (legacy marker · advance consume); a row with no receipt / receipt JE has nothing to refund',
    async () => {
      const noRefundableMoney = /ไม่มีใบเสร็จ\/รายการรับชำระในระบบนี้ให้คืน/;
      const refusesRefund = async (paymentId: string) => {
        const row = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
        await expect(
          refunds.requestRefund(
            { paymentId, amount: Number(row.amountPaid), reason: 'ทดสอบ (T17)' },
            approverId,
          ),
        ).rejects.toThrow(noRefundableMoney);
      };
      // งวดนำเข้าที่ไม่มีใบเสร็จในระบบ — PAID ก่อนวันตัด (L1 งวด 1) และจ่ายบางส่วนก่อนวันตัด (L9R งวด 4) → คืนไม่ได้
      const l9r = legacy.get('L9R')!;
      await refusesRefund((await paymentOf(legacy.get('L1')!, 1)).id);
      await refusesRefund((await paymentOf(l9r, 4)).id);

      // L9R: งวด 4 (marker 300) รับ 1,215.83 หลังวันตัด → คืนเงินใบนั้น → เหลือ 300 PARTIALLY_PAID · รับ 1,215.83 ใหม่ได้
      await pay(l9r, 4, await owedOn(l9r, 4), MAY2);
      await refundInFull((await paymentOf(l9r, 4)).id, '1215.83');
      const l9rRow4 = await paymentOf(l9r, 4);
      expect([l9rRow4.status, l9rRow4.amountPaid.toFixed(2), l9rRow4.paidDate]).toEqual([
        'PARTIALLY_PAID',
        '300.00',
        null,
      ]);
      expect((await run('hp', [l9r])).count).toBe(0);

      // A4 ปกติ: งวด 1 รับเกิน 500 (พักเป็นเงินรับล่วงหน้า) → 2A งวด 2 หัก 500 เข้างวด (ไม่มี paymentId) → รับส่วนที่เหลือ
      // 1,015.83 → คืนเงินใบนั้น → ยอดจากเงินรับล่วงหน้ายังอยู่ 500
      const a4 = native.get('A4')!;
      await nightly2A(a4, 1);
      await pay(a4, 1, D(MONTHLY).plus(500).toFixed(2), P1.due(1));
      await nightly2A(a4, 2);
      expect((await paymentOf(a4, 2)).amountPaid.toFixed(2)).toBe('500.00');
      // I-1: ยอด 500 ล้างงวดด้วยรายการหักเงินรับล่วงหน้า (ไม่มีใบเสร็จ ไม่มี paymentId) — คืนผ่านระบบไม่ได้ (เดิมถอยไป amountPaid
      // แล้วคืน 500 โดยไม่มีรายการบัญชีใด)
      await refusesRefund((await paymentOf(a4, 2)).id);
      await pay(a4, 2, await owedOn(a4, 2), P1.due(2));
      expect((await paymentOf(a4, 2)).status).toBe('PAID');
      await refundInFull((await paymentOf(a4, 2)).id, '1015.83');
      const a4Row2 = await paymentOf(a4, 2);
      expect([a4Row2.status, a4Row2.amountPaid.toFixed(2)]).toEqual(['PARTIALLY_PAID', '500.00']);

      await expectClean(ids(native, ['A4']).concat(ids(legacy, ['L1', 'L9R'])));
      expect(await reconBreachesOf([nativeBranchId, legacyBranchId])).toEqual([]);

      // งวดที่คืนเงินแล้วรับเต็มส่วนที่เหลือได้อีก (ไม่ชนเกณฑ์ ≤ 1 บาท)
      await pay(l9r, 4, await owedOn(l9r, 4), MAY3);
      await pay(a4, 2, await owedOn(a4, 2), P1.due(2));
      expect([(await paymentOf(l9r, 4)).status, (await paymentOf(a4, 2)).status]).toEqual([
        'PAID',
        'PAID',
      ]);
      // Task 18 M-3: คืนเงินรอบสองของเงินที่รับใหม่ได้เต็มใบ — ใบ/รายการของรอบแรกถูกยกเลิก/กลับแล้ว จึงไม่ถูกหักซ้ำ
      // (เดิม remaining = ใบที่ยังมีผล − Σ คืนเงิน PROCESSED = 0 ⇒ 400)
      await refundInFull((await paymentOf(l9r, 4)).id, '1215.83');
      const l9rAgain = await paymentOf(l9r, 4);
      expect([l9rAgain.status, l9rAgain.amountPaid.toFixed(2)]).toEqual([
        'PARTIALLY_PAID',
        '300.00',
      ]);
      expect(
        await prisma.refund.count({ where: { paymentId: l9rAgain.id, status: 'PROCESSED' } }),
      ).toBe(2);
      await expectClean(ids(native, ['A4']).concat(ids(legacy, ['L9R'])));
    },
    LONG,
  );

  it(
    'stage 2c (Task 23 · m-6) — late-fee rows whose receipt parks / consumes advance VAT: late_fee_vat_leak reads the 21-2101 SUM against the stamps on Postgres',
    async () => {
      const a5 = native.get('A5')!;
      const lateFee = resolveLateFee(await loadLateFeeConfig(prisma), 10);
      // ตั้งลูกหนี้งวด 1–2 ก่อนมีเงินรับล่วงหน้า (ไม่ให้รอบกลางคืนหักเงินรับล่วงหน้าเข้างวด 2 แทนใบรับชำระ)
      await nightly2A(a5, 1);
      await nightly2A(a5, 2);
      // งวด 1 ช้า 10 วัน: ค่างวด + ค่าปรับ + 500 → ส่วนเกินพักเป็นเงินรับล่วงหน้า (ใบรับพักภาษี Cr 21-2101 + stamp advanceVatPark)
      await pay(
        a5,
        1,
        D(MONTHLY).plus(lateFee).plus(500).toFixed(2),
        new Date(P1.due(1).getTime() + 10 * DAY),
      );
      // งวด 2 ช้า 10 วัน: จ่ายขาด 300 → ใบเดียวกันหักเงินรับล่วงหน้า 300 (ขากลับ Dr 21-2101 + stamp advanceVatConsume)
      await pay(
        a5,
        2,
        D(MONTHLY).plus(lateFee).minus(300).toFixed(2),
        new Date(P1.due(2).getTime() + 10 * DAY),
      );

      const receiptOf = async (installmentNo: number) => {
        const row = await paymentOf(a5, installmentNo);
        const entry = await prisma.journalEntry.findFirstOrThrow({
          where: {
            AND: [
              { metadata: { path: ['paymentId'], equals: row.id } },
              { metadata: { path: ['tag'], equals: 'receipt' } },
            ],
          },
          select: {
            id: true,
            metadata: true,
            lines: { where: { accountCode: '21-2101', deletedAt: null } },
          },
        });
        const meta = entry.metadata as Record<string, unknown>;
        const outputVat = entry.lines.reduce((s, l) => s.plus(l.credit).minus(l.debit), D(0));
        return {
          row,
          entry,
          shape: [
            row.status,
            row.lateFee.toFixed(2),
            outputVat.toFixed(2),
            meta.advanceVatPark ?? null,
            meta.advanceVatConsume ?? null,
          ],
        };
      };
      const r1 = await receiptOf(1);
      const r2 = await receiptOf(2);
      // ภาษีของเงินรับล่วงหน้า: 500 × 7/107 = 32.71 · 300 × 7/107 = 19.63 — ใบรับชำระของงวดที่มีค่าปรับขยับ 21-2101 จริง
      expect([r1.shape, r2.shape]).toEqual([
        ['PAID', lateFee.toFixed(2), '32.71', '32.71', null],
        ['PAID', lateFee.toFixed(2), '-19.63', null, '19.63'],
      ]);

      // ทาง PASS: Σ(Cr − Dr) 21-2101 ของรายการ = park − consume ที่ stamp ไว้ (เทียบบน Postgres ด้วย `->>`) — ไม่ใช่ภาษีของค่าปรับ
      expect((await run('late_fee_vat_leak', [a5])).details).toEqual([]);
      await expectClean([a5]);

      // ตัวตรวจอ่าน stamp จริง: ถอด stamp ออกจากทั้งสองรายการ ⇒ 21-2101 ของใบ (+32.71 / −19.63) อธิบายไม่ได้ → ติดทั้งสองงวด
      const strip = (entryId: string, key: string) =>
        prisma.$executeRaw`UPDATE journal_entries SET metadata = metadata - ${key} WHERE id = ${entryId}`;
      await strip(r1.entry.id, 'advanceVatPark');
      await strip(r2.entry.id, 'advanceVatConsume');
      try {
        expect(
          (
            (await run('late_fee_vat_leak', [a5])).details as Array<{
              installment_no: number;
              unexplained_vat: string;
            }>
          ).map((r) => [r.installment_no, r.unexplained_vat]),
        ).toEqual([
          [1, '32.71'],
          [2, '-19.63'],
        ]);
      } finally {
        await prisma.journalEntry.update({
          where: { id: r1.entry.id },
          data: { metadata: r1.entry.metadata as Prisma.InputJsonObject },
        });
        await prisma.journalEntry.update({
          where: { id: r2.entry.id },
          data: { metadata: r2.entry.metadata as Prisma.InputJsonObject },
        });
      }
      await expectClean([a5]);
    },
    LONG,
  );

  it(
    'stage 3 — corrupted native contracts and post-cutover rows of imported contracts are still caught',
    async () => {
      const [c1, c2, c3, c4, c5, c6, c7] = ids(native, ['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7']);
      const [l4, l5, l6, l7, l8, l9] = ids(legacy, ['L4', 'L5', 'L6', 'L7', 'L8', 'L9']);
      const softDelete = (where: Prisma.JournalEntryWhereInput) =>
        prisma.journalEntry.updateMany({ where, data: { deletedAt: new Date() } });
      const byContract = (contractId: string) => ({
        metadata: { path: ['contractId'], equals: contractId },
      });

      // C1 ปกติ: รายการเปิดสัญญา 1A หาย
      await softDelete({ AND: [byContract(c1), { metadata: { path: ['tag'], equals: '1A' } }] });
      // C2 ปกติ: งวด 2 ตั้ง 2A แล้ว ถูกแก้ยอดจ่ายโดยไม่มีรายการบัญชี
      await nightly2A(c2, 1);
      await pay(c2, 1, MONTHLY, P1.due(1));
      await nightly2A(c2, 2);
      await prisma.payment.update({
        where: { id: (await paymentOf(c2, 2)).id },
        data: { amountPaid: D(100), status: 'PARTIALLY_PAID' },
      });
      // C3 ปกติ: งวด 1 รับเกิน 5 บาทโดยไม่มีรายการบัญชี
      await nightly2A(c3, 1);
      await pay(c3, 1, MONTHLY, P1.due(1));
      await prisma.payment.update({
        where: { id: (await paymentOf(c3, 1)).id },
        data: { amountPaid: D(MONTHLY).plus(5) },
      });
      // C4 ปกติ: รายการขาเดียวเข้า 11-2103 · C5 ปกติ: VAT รอเรียกเก็บขาเดียว
      const corrupt = (contractId: string, dr: string, cr: string) =>
        journal.createAndPost({
          description: 'T16 corruption',
          reference: `t16-corrupt:${contractId}`,
          metadata: { tag: 't16-corruption', contractId },
          lines: [
            { accountCode: dr, dr: D(100), cr: D(0) },
            { accountCode: cr, dr: D(0), cr: D(100) },
          ],
          postedAt: P1.due(1),
          createdById: userId,
        });
      await corrupt(c4, '11-2103', '32-1101');
      await corrupt(c5, '11-2105', '11-2101');
      // C6 ปกติ: ใบรับชำระที่ลูกค้าจ่ายเกินลูกหนี้ ≤ 1 บาท (ใบที่ผ่านผู้อนุมัติเศษ — จำลองรูปรายการของ PaymentReceiptTemplate:
      // Cr 11-2103 เต็มงวด + Cr 53-1503 เศษ · amountPaid รวมเศษ) สองงวด 0.90 → ไม่ติด (ทะเบียนบวก 53-1503 กลับ) · ไม่มีแถวใบเสร็จ
      // (= ใบออกไม่สำเร็จหลัง commit — Task 23 backfill:receipts)
      const c6Entries: string[] = [];
      for (const no of [1, 2]) {
        await nightly2A(c6, no);
        const p = await paymentOf(c6, no);
        const entry = await journal.createAndPost({
          description: 'T16 receipt with approved ≤1 overpay',
          reference: `t16-overpay:${p.id}`,
          metadata: { tag: 'receipt', flow: 'payment-receipt', paymentId: p.id, contractId: c6 },
          lines: [
            { accountCode: '11-1101', dr: D(MONTHLY).plus('0.90'), cr: D(0) },
            { accountCode: '11-2103', dr: D(0), cr: D(MONTHLY) },
            { accountCode: '53-1503', dr: D(0), cr: D('0.90') },
          ],
          postedAt: P1.due(no),
          createdById: userId,
        });
        c6Entries.push(entry.entryNumber);
        await prisma.payment.update({
          where: { id: p.id },
          data: {
            amountPaid: D(MONTHLY).plus('0.90'),
            status: 'PAID',
            paidDate: P1.due(no),
            paymentMethod: 'CASH',
            recordedById: userId,
          },
        });
      }

      // C7 ปกติ (Task 23 · backfill:receipts): งวด 1 ถูกตั้งเป็น PAID ตรงในฐาน ไม่มีรายการรับชำระและไม่มีใบเสร็จ (รูปแถวของ seed
      // "data-only" / ยุคก่อนมีใบเสร็จอัตโนมัติ) — ผู้สมัครเดียวที่ CLI ยังออกใบให้
      await prisma.payment.update({
        where: { id: (await paymentOf(c7, 1)).id },
        data: {
          amountPaid: D(MONTHLY),
          status: 'PAID',
          paidDate: P1.due(1),
          paymentMethod: 'CASH',
          recordedById: userId,
        },
      });
      // L4 นำเข้า: งวด 8 (ค้าง ไม่มีผู้บันทึก) ถูกแก้ยอดจ่ายโดยไม่มีรายการบัญชี
      await prisma.payment.update({
        where: { id: (await paymentOf(l4, 8)).id },
        data: { amountPaid: D(100), status: 'PARTIALLY_PAID' },
      });
      // L5 นำเข้า: งวด 4 (มี marker) รับส่วนที่เหลือหลังวันตัด แล้วรายการใบรับชำระหาย
      await pay(l5, 4, await owedOn(l5, 4), MAY2);
      const l5Row4 = await paymentOf(l5, 4);
      const deletedReceipt = await softDelete({
        AND: [
          { metadata: { path: ['paymentId'], equals: l5Row4.id } },
          { metadata: { path: ['tag'], equals: 'receipt' } },
        ],
      });
      expect(deletedReceipt.count).toBe(1);
      // L6 นำเข้า: รายการไล่ VAT หาย · L7 นำเข้า: รายการยกมาหาย
      expect(
        (
          await softDelete({
            AND: [byContract(l6), { metadata: { path: ['flow'], equals: 'legacy-vat-catchup' } }],
          })
        ).count,
      ).toBe(1);
      expect(
        (
          await softDelete({
            AND: [byContract(l7), { metadata: { path: ['flow'], equals: 'legacy-opening' } }],
          })
        ).count,
      ).toBe(1);
      // L8 นำเข้า: งวด 4 รับส่วนที่เหลือหลังวันตัด แล้วถูกแก้ยอดจ่ายเกิน 5 บาท
      await pay(l8, 4, await owedOn(l8, 4), MAY2);
      await prisma.payment.update({
        where: { id: (await paymentOf(l8, 4)).id },
        data: { amountPaid: D(MONTHLY).plus(5) },
      });
      // L8 (Task 23 · backfill:receipts): ใบเสร็จหลังวันตัดของงวดนำเข้าหาย (= ออกไม่สำเร็จหลัง commit) — รายการรับชำระยังมีผล
      const l8Row4 = await paymentOf(l8, 4);
      const l8Entry = await prisma.journalEntry.findFirstOrThrow({
        where: {
          AND: [
            { metadata: { path: ['paymentId'], equals: l8Row4.id } },
            { metadata: { path: ['tag'], equals: 'receipt' } },
          ],
        },
        select: { entryNumber: true },
      });
      expect(await prisma.receipt.deleteMany({ where: { paymentId: l8Row4.id } })).toEqual({
        count: 1,
      });
      // L9 นำเข้า — ตาข่ายของจุดบอดตัวแยก: งวด 4 (มีเงินก่อนวันตัด 300 · ผู้บันทึก = บัญชีนำเข้า) ถูกแก้เป็นจ่ายครบตรงในฐาน
      // โดยไม่ตั้ง payment_method ⇒ แถวยังได้ยกเว้น (ง): orphan_payments / overpaid เงียบโดยตั้งใจ — ตัวจับเดียวคือ hp รายสัญญา
      // (ทะเบียนลด 1,215.83 แต่ลูกหนี้ใน GL ไม่ลด) · สัญญาที่ปิดแล้ว (COMPLETED / EARLY_PAYOFF) อยู่นอกขอบเขต hp จึงไม่มีตาข่ายนี้ ·
      // ถ้าจะแก้ขอบเขต/เกณฑ์ของ hp ให้ระวังว่ากำลังถอดตาข่ายเดียวของกรณีนี้
      await prisma.payment.update({
        where: { id: (await paymentOf(l9, 4)).id },
        data: { amountPaid: D(MONTHLY), status: 'PAID' },
      });

      // A1 ปกติ (Task 18 · missing_cogs): ต้นทุนขายฝั่ง SHOP ของการเปิดสัญญาหาย ขณะที่เครื่องมีต้นทุน
      const a1 = native.get('A1')!;
      expect(
        (
          await softDelete({
            AND: [
              byContract(a1),
              { metadata: { path: ['flow'], equals: 'shop-inventory-transfer-cogs' } },
            ],
          })
        ).count,
      ).toBe(1);
      // A1 ปกติ (Task 18 · late_fee_vat_leak): รายการรับชำระของงวด 5 (มีค่าปรับ) ลงภาษีขายของค่าปรับ — จำลองรูปรายการที่ผิด:
      // ย้ายส่วน 7/107 ของค่าปรับจาก Cr 42-1103 ไป Cr 21-2101 ในรายการที่ผูก paymentId (ไม่มี stamp ภาษีของเงินรับล่วงหน้า)
      const a1Row5 = await paymentOf(a1, 5);
      const feeVat = a1Row5.lateFee
        .times(7)
        .div(107)
        .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
      await journal.createAndPost({
        description: 'T18 receipt with VAT on the late fee',
        reference: `t18-fee-vat:${a1Row5.id}`,
        metadata: { tag: 'receipt', flow: 'payment-receipt', paymentId: a1Row5.id, contractId: a1 },
        lines: [
          { accountCode: '42-1103', dr: feeVat, cr: D(0) },
          { accountCode: '21-2101', dr: D(0), cr: feeVat },
        ],
        postedAt: P1.due(5),
        createdById: userId,
      });

      const flagged = async (check: Check, contractId: string) =>
        (await run(check, [contractId])).count;

      expect({
        c1: [await flagged('orphan_contracts', c1), (await hpBreaches(c1)).length],
        c2: [await orphanRowsOf(c2), (await hpBreaches(c2)).map((b) => b.gap)],
        c3: [(await run('overpaid', [c3])).details, (await hpBreaches(c3)).map((b) => b.gap)],
        c4: [(await hpBreaches(c4)).map((b) => b.gap), await flagged('vat', c4)],
        c5: [
          ((await run('vat', [c5])).details as Array<{ diff: string }>).map((r) => r.diff),
          (await hpBreaches(c5)).length,
        ],
        c6: [
          await flagged('hp', c6),
          await flagged('overpaid', c6),
          await flagged('orphan_payments', c6),
        ],
        l4: [await orphanRowsOf(l4), (await hpBreaches(l4)).map((b) => b.gap)],
        l5: [await orphanRowsOf(l5), (await hpBreaches(l5)).map((b) => b.gap)],
        l6: [
          ((await run('vat', [l6])).details as Array<{ diff: string }>).map((r) => r.diff),
          (await hpBreaches(l6)).length,
        ],
        l7: [await flagged('orphan_contracts', l7), (await hpBreaches(l7)).length],
        l8: [
          (
            (await run('overpaid', [l8])).details as Array<{
              installment_nos: number[];
              overpay: string;
            }>
          ).map((r) => [r.installment_nos, r.overpay]),
          await orphanRowsOf(l8),
        ],
        l9: [
          await orphanRowsOf(l9),
          await flagged('overpaid', l9),
          (await hpBreaches(l9)).map((b) => b.gap),
        ],
        a1: ((await run('missing_cogs', [a1])).details as Array<{ id: string }>).map((r) => r.id),
        a1FeeVat: (
          (await run('late_fee_vat_leak', [a1])).details as Array<{
            installment_no: number;
            unexplained_vat: string;
          }>
        ).map((r) => [r.installment_no, r.unexplained_vat]),
      }).toEqual({
        c1: [1, 1],
        c2: [[2], ['100.00']],
        c3: [
          [
            {
              id: c3,
              contract_number: `TEST-T16N-${stamp}-C3`,
              installment_nos: [1],
              overpay: '5.00',
            },
          ],
          ['5.00'],
        ],
        c4: [['100.00'], 0],
        c5: [['100.00'], 0],
        c6: [0, 0, 0],
        l4: [[8], ['100.00']],
        l5: [[4], ['1215.83']],
        // ไล่ VAT ของงวด 4 หาย ⇒ 21-2102 ค้างเกิน 11-2105 เท่าภาษีของส่วนที่ค้าง: 99.17 − HALF_UP(300 × 7/107) = 99.17 − 19.63
        l6: [['-79.54'], 0],
        l7: [1, 1],
        l8: [[[[4], '5.00']], []],
        l9: [[], 0, ['1215.83']],
        a1: [a1],
        a1FeeVat: [[5, feeVat.toFixed(2)]],
      });
      // backfill:receipts (Task 18 review m-2 · Task 23): ผู้สมัครที่ CLI ออกใบที่ไม่ผูกรายการให้ = งวดปกติที่ PAID โดยไม่มีใบเสร็จ**และไม่มี
      // รายการรับชำระที่ยังมีผลผูก paymentId** (C7 งวด 1) · C6 งวด 1–2 มีรายการรับชำระ (ใบเสร็จออกไม่สำเร็จหลัง commit) ⇒ ไม่ใช่ผู้สมัคร
      // อีก (เดิมได้ใบที่ไม่ผูกรายการ ยอด amount_paid — เอกสารใบที่สองของเงินก้อนเดียวกันเมื่อออกซ้ำแบบผูกรายการภายหลัง) · งวดนำเข้าที่ถูก
      // แก้เป็น PAID (L9 งวด 4) และงวดนำเข้าที่ PAID ก่อนวันตัด (L4–L8 งวด 1–3) ไม่ใช่
      const cliScope = [c6, c7, l4, l5, l6, l7, l8, l9];
      expect(
        (await findPaidPaymentsWithoutReceipt(prisma as unknown as PrismaService))
          .filter((r) => cliScope.includes(r.contract_id))
          .map((r) => [r.contract_number, r.installment_no]),
      ).toEqual([[`TEST-T16N-${stamp}-C7`, 1]]);
      // …และเงินที่มีรายการรับชำระยังมีผลแต่ไม่มีใบเสร็จ ถูกส่งไปทาง "ออกใบเสร็จซ้ำ" แบบผูกรายการพร้อมเลขที่รายการ (+ receiptTax.amount
      // ที่ต้องส่ง — รายการที่ลงเองในเทสต์ไม่มี stamp) รวมงวดนำเข้าที่รับหลังวันตัด (L8 งวด 4)
      const key = (r: { contract_number: string; installment_no: number }) =>
        `${r.contract_number}#${r.installment_no}`;
      expect(
        (await findBoundReissueCandidates(prisma as unknown as PrismaService))
          .filter((r) => cliScope.includes(r.contract_id))
          .sort((a, b) => key(a).localeCompare(key(b)))
          .map((r) => [r.contract_number, r.installment_no, r.entries]),
      ).toEqual([
        [
          `TEST-T16-${stamp}-L8`,
          4,
          [{ entryNumber: l8Entry.entryNumber, receiptAmount: '1215.83' }],
        ],
        [`TEST-T16N-${stamp}-C6`, 1, [{ entryNumber: c6Entries[0], receiptAmount: null }]],
        [`TEST-T16N-${stamp}-C6`, 2, [{ entryNumber: c6Entries[1], receiptAmount: null }]],
      ]);
      // สาขาที่มีสัญญาเพี้ยน breach ทั้งสองสาขา (สัญญาปกติ C1–C4 · สัญญานำเข้า L4/L5/L7/L8/L9)
      const breached = await reconBreachesOf([nativeBranchId, legacyBranchId]);
      expect(breached.map((b) => b.branchId).sort()).toEqual(
        [nativeBranchId, legacyBranchId].sort(),
      );
    },
    LONG,
  );

  it(
    'Task 23 — contract trace: every paid row of the contract gets the orphan_payments verdict (no 50-row cap)',
    async () => {
      // D1 ปกติ: 62 แถวงวดที่ถูกตั้งเป็น PAID ตรงในฐานโดยไม่มีรายการบัญชี (แถว 13–62 เติมเอง) — orphan_payments ของสัญญาเดียวเกิน 50 แถว ·
      // เดิม trace อ่าน details ของตรวจกลางคืนที่ตัด 50 ⇒ 12 แถวถูกตัดสินผิดเป็น PASS "backedWithoutPaymentId"
      const d1 = await createNative('D1', P1.date, P1.dueDay);
      native.set('D1', d1);
      const last = await paymentOf(d1, 12);
      await prisma.payment.createMany({
        data: Array.from({ length: 50 }, (_, i) => ({
          contractId: d1,
          installmentNo: 13 + i,
          dueDate: new Date(last.dueDate.getTime() + (i + 1) * 30 * DAY),
          amountDue: last.amountDue,
        })),
      });
      const paid = await prisma.payment.updateMany({
        where: { contractId: d1 },
        data: {
          amountPaid: D(MONTHLY),
          status: 'PAID',
          paidDate: P1.due(1),
          paymentMethod: 'CASH',
          recordedById: userId,
        },
      });
      expect(paid.count).toBe(62);
      // ตรวจกลางคืน: count = จำนวนจริง · details ตัดที่ 50 (Task 25 · m-5 — เดิม count = 50 หลัง LIMIT ทั้งที่มี 62)
      const nightly = await run('orphan_payments', [d1]);
      expect([nightly.count, nightly.details.length]).toEqual([62, 50]);

      const trace = new ContractTraceService(prisma as unknown as PrismaService, checks);
      const t = await trace.traceContract(d1);
      expect(t.checks.payments).toHaveLength(62);
      expect(t.checks.payments.filter((p) => p.status !== 'FAIL').map((p) => p.name)).toEqual([]);
    },
    LONG,
  );

  it(
    'Task 23 (m-5) — trace of a batch (each nightly check run once for every contract) = the trace of each contract alone',
    async () => {
      // ทุกสัญญาของสเปค (หลังขั้น 3 — มีทั้งสัญญาสะอาด สัญญาที่ถูกทำให้เพี้ยน และ D1 ที่ orphan_payments เกิน 50 แถว) · ชุดเดียว > 50 แถวงวดที่ติด
      const trace = new ContractTraceService(prisma as unknown as PrismaService, checks);
      const contractIds = [...native.values(), ...legacy.values()];
      const batch = await trace.traceContracts(contractIds);
      const alone: Awaited<ReturnType<ContractTraceService['traceContract']>>[] = [];
      for (const id of contractIds) alone.push(await trace.traceContract(id));
      expect(batch).toEqual(alone);
      // ไม่ใช่เท่ากันเพราะผ่านหมด — ชุดนี้มีข้อ FAIL จากหลายตัวตรวจ
      const failedNames = new Set(
        batch.flatMap((t) =>
          Object.values(t.checks)
            .flat()
            .filter((c) => c.status === 'FAIL')
            .map((c) => c.name.replace(/^payment_\d+$/, 'payment')),
        ),
      );
      expect([...failedNames].sort()).toEqual(
        ['activation', 'cogs', 'hpReceivable', 'interCompany', 'payment', 'vatTotal'].sort(),
      );
    },
    LONG,
  );

  it(
    'Task 25 (m-2) — bound re-issue list is per receipt entry: a live entry with no receipt bound to it is listed even when the installment already has another receipt row',
    async () => {
      // ทุกสัญญาในเทสต์นี้: งวด 1 PAID ผ่านเส้นทางรับชำระจริง (ใบเสร็จออกหลัง commit และผูกรายการ) แล้วลบใบของรายการล่าสุด
      // (= ใบออกไม่สำเร็จหลัง commit) · งวดมีแถวใบเสร็จอีกใบอยู่แล้ว ⇒ เดิม (ต่อ Payment — "ไม่มีแถวใบเสร็จเลย") ไม่อยู่ในรายชื่อใด
      const ids5: string[] = [];
      for (const key of ['M1', 'M2', 'M3', 'M4', 'M5']) {
        const id = await createNative(key, P1.date, P1.dueDay);
        native.set(key, id);
        ids5.push(id);
        await nightly2A(id, 1);
      }
      const [c1, c2, c3, c4, c5] = ids5;
      const receiptEntryOf = (paymentId: string) =>
        prisma.journalEntry.findMany({
          where: {
            AND: [
              { metadata: { path: ['paymentId'], equals: paymentId } },
              { metadata: { path: ['tag'], equals: 'receipt' } },
            ],
          },
          orderBy: { postedAt: 'asc' },
          select: { id: true, entryNumber: true, metadata: true },
        });
      /** ใบที่ผูกรายการล่าสุดของงวดหาย (ออกไม่สำเร็จหลัง commit) — คืนเลขที่รายการนั้น */
      const dropLastBoundReceipt = async (contractId: string) => {
        const row = await paymentOf(contractId, 1);
        const entries = await receiptEntryOf(row.id);
        const last = entries[entries.length - 1];
        expect(
          await prisma.receipt.deleteMany({ where: { sourceJournalEntryId: last.id } }),
        ).toEqual({ count: 1 });
        return last.entryNumber;
      };

      // M1 ยกเลิกแล้วรับใหม่: ใบแรกถูกยกเลิก (แถวยังอยู่ · รายการแรก reversed) → รับงวดใหม่ → ใบของรายการใหม่หาย
      await pay(c1, 1, MONTHLY, P1.due(1));
      const m1First = await prisma.receipt.findFirstOrThrow({
        where: { paymentId: (await paymentOf(c1, 1)).id, isVoided: false, deletedAt: null },
      });
      await voidReceiptApproved(
        prisma,
        receipts,
        m1First.id,
        'ทดสอบยกเลิกใบเสร็จแล้วรับใหม่ (T25)',
        userId,
        approverId,
      );
      expect((await paymentOf(c1, 1)).status).not.toBe('PAID');
      await pay(c1, 1, MONTHLY, P1.due(1));
      const m1Missing = await dropLastBoundReceipt(c1);

      // M2 ใบบางส่วนอีกใบ: รับ 1,000 (มีใบ) → รับส่วนที่เหลือ 515.83 ปิดงวด → ใบของรายการที่สองหาย
      await pay(c2, 1, '1000', P1.due(1), true);
      await pay(c2, 1, await owedOn(c2, 1), P1.due(1));
      const m2Missing = await dropLastBoundReceipt(c2);

      // M3 (6b): ใบปรับดิว RESCHEDULE_FEE ผูก paymentId ของงวดเดียวกัน (ผูกรายการ tag reschedule-collect — คนละ tag กับรายการรับชำระ) →
      // รับค่างวด → ใบค่างวดหาย
      const m3Row = await paymentOf(c3, 1);
      const feeEntry = await journal.createAndPost({
        description: 'T25 reschedule fee (6b shape)',
        reference: `t25-fee:${m3Row.id}`,
        metadata: {
          tag: 'reschedule-collect',
          flow: 'reschedule-collect',
          contractId: c3,
          paymentId: m3Row.id,
          variant: '6b',
        },
        lines: [
          { accountCode: '11-1101', dr: D(200), cr: D(0) },
          { accountCode: '21-1103', dr: D(0), cr: D(200) },
        ],
        postedAt: P1.due(1),
        createdById: userId,
      });
      await receipts.generateReceipt(
        c3,
        m3Row.id,
        'RESCHEDULE_FEE',
        200,
        1,
        'CASH',
        null,
        userId,
        P1.due(1),
        feeEntry.entryNumber,
      );
      await pay(c3, 1, MONTHLY, P1.due(1));
      const m3Missing = await dropLastBoundReceipt(c3);

      // M4 รายการก่อน PR3 (ไม่มี receiptTax) ที่ใบออกแบบไม่ผูกรายการ (ยุคนั้นไม่ผูก) — ไม่ใช่ใบที่หาย ⇒ ไม่อยู่ในรายชื่อ
      const m4Row = await paymentOf(c4, 1);
      await journal.createAndPost({
        description: 'T25 pre-PR3 receipt entry',
        reference: `t25-pre-pr3:${m4Row.id}`,
        metadata: { tag: 'receipt', flow: 'payment-receipt', paymentId: m4Row.id, contractId: c4 },
        lines: [
          { accountCode: '11-1101', dr: D(MONTHLY), cr: D(0) },
          { accountCode: '11-2103', dr: D(0), cr: D(MONTHLY) },
        ],
        postedAt: P1.due(1),
        createdById: userId,
      });
      await prisma.payment.update({
        where: { id: m4Row.id },
        data: {
          amountPaid: D(MONTHLY),
          status: 'PAID',
          paidDate: P1.due(1),
          paymentMethod: 'CASH',
          recordedById: userId,
        },
      });
      await receipts.generateReceipt(
        c4,
        m4Row.id,
        'INSTALLMENT',
        Number(MONTHLY),
        1,
        'CASH',
        null,
        userId,
        P1.due(1),
      );

      // M5 ผลบวกเท็จที่รู้ของตัวตรวจต่อรายการ (runbook): รายการหลัง PR3 ที่เงินก้อนนั้นมีใบที่ไม่ผูกรายการอยู่แล้ว (เช่น
      // backfill-orphan-partial-receipts ลงรายการให้ใบบางส่วนกำพร้ายุคก่อน PR3) — ยังอยู่ในรายชื่อ แต่ติดป้าย unboundReceipts ให้ตรวจก่อนออกซ้ำ
      await pay(c5, 1, MONTHLY, P1.due(1));
      const [m5Entry] = await receiptEntryOf((await paymentOf(c5, 1)).id);
      await prisma.receipt.updateMany({
        where: { sourceJournalEntryId: m5Entry.id },
        data: { sourceJournalEntryId: null },
      });

      for (const id of ids5) expect((await paymentOf(id, 1)).status).toBe('PAID');
      const bound = (await findBoundReissueCandidates(prisma as unknown as PrismaService))
        .filter((r) => ids5.includes(r.contract_id))
        .map((r) => [r.contract_number, r.installment_no, r.entries, r.unbound_receipts]);
      const no = (key: string) => `TEST-T16N-${stamp}-${key}`;
      expect(bound).toEqual([
        [no('M1'), 1, [{ entryNumber: m1Missing, receiptAmount: MONTHLY }], 0],
        [no('M2'), 1, [{ entryNumber: m2Missing, receiptAmount: '515.83' }], 0],
        [no('M3'), 1, [{ entryNumber: m3Missing, receiptAmount: MONTHLY }], 0],
        [no('M5'), 1, [{ entryNumber: m5Entry.entryNumber, receiptAmount: MONTHLY }], 1],
      ]);
      // งวดเหล่านี้มีแถวใบเสร็จอยู่แล้ว ⇒ ไม่ใช่ผู้สมัครของ CLI (ใบที่ไม่ผูกรายการ) ไม่ว่ากรณีใด
      expect((await backfillListsOf(ids5)).cli).toEqual([]);
    },
    LONG,
  );

  describe('early payoff (JP4) of a native contract — calendar anchored to today', () => {
    let a3 = '';
    let a7 = '';

    beforeAll(async () => {
      const { year: Y, month: M } = bangkokCalendarParts(new Date());
      const ymd = (y: number, m: number, d: number) =>
        new Date(Date.UTC(y, m, d)).toISOString().slice(0, 10);
      const due = (no: number) => bangkokMidnight(Y, M - 6 + no, 1);
      a3 = await createNative('A3', ymd(Y, M - 6, 1), 1);
      native.set('A3', a3);
      await runNativeToCutoff(a3, due);
      await nightly2A(a3, 5);
      await pay(a3, 4, await owedOn(a3, 4), due(5));
      await pay(a3, 5, MONTHLY, due(5));
      // A7 (Task 25 · r-1): ปฏิทินเดียวกับ A3 · งวด 5 ถูกตั้ง PAID ตรงในฐานก่อนปิดยอด — ไม่มีรายการรับชำระและไม่มีใบเสร็จ (รูปแถวของ
      // seed "data-only" / ยุคก่อนมีใบเสร็จอัตโนมัติ แบบ C7) แล้วจึงปิดยอดก่อนกำหนด (ในเทสต์)
      a7 = await createNative('A7', ymd(Y, M - 6, 1), 1);
      native.set('A7', a7);
      await runNativeToCutoff(a7, due);
      await nightly2A(a7, 5);
      await pay(a7, 4, await owedOn(a7, 4), due(5));
      await prisma.payment.update({
        where: { id: (await paymentOf(a7, 5)).id },
        data: {
          amountPaid: D(MONTHLY),
          status: 'PAID',
          paidDate: due(5),
          paymentMethod: 'CASH',
          recordedById: userId,
        },
      });
    }, LONG);

    it(
      'rows paid by the contract-level JP4 entry are backed (no paymentId on JP4) — incl. a late fee collected by JP4',
      async () => {
        // งวด 6 ครบกำหนดวันที่ 1 ของเดือนนี้และยังค้าง — จำลอง cron ค่าปรับ (ตั้ง lateFee ให้งวดค้าง)
        const row6 = await paymentOf(a3, 6);
        await prisma.payment.update({ where: { id: row6.id }, data: { lateFee: D(100) } });
        await earlyPayoffApproved(prisma, contractPayments, a3, userId, {
          paymentMethod: 'BANK_TRANSFER',
          discountPct: 50,
          depositAccountCode: '11-1201',
        });
        const rows = await prisma.payment.findMany({ where: { contractId: a3 } });
        expect(rows.every((p) => p.status === 'PAID')).toBe(true);
        // JP4 กระจายยอดปิด FIFO ด้วย owed = amountDue + lateFee − amountPaid ⇒ ค่าปรับอยู่ใน amountPaid ของงวด 6 ขณะที่
        // Cr 42-1103 อยู่ในรายการ JP4 ระดับสัญญา (ไม่มี paymentId) — overpaid ต้องไม่นับเป็นรับเกิน
        const paid6 = await paymentOf(a3, 6);
        expect(paid6.amountPaid.toFixed(2)).toBe(paid6.amountDue.plus(100).toFixed(2));
        const jp4 = await prisma.journalEntry.count({
          where: {
            AND: [
              { metadata: { path: ['contractId'], equals: a3 } },
              { metadata: { path: ['flow'], equals: 'early-payoff' } },
            ],
          },
        });
        expect(jp4).toBe(1);
        expect((await run('orphan_payments', [a3])).count).toBe(0);
        expect((await run('overpaid', [a3])).count).toBe(0);
        expect((await run('orphan_contracts', [a3])).count).toBe(0);
        // backfill:receipts (Task 23 review m-1 ก): งวด 6–12 ที่ JP4 ปิด ไม่มีแถวใบเสร็จของงวด (ใบ EARLY_PAYOFF ไม่ผูก paymentId · JP4 ไม่มี
        // paymentId — ในเทสต์นี้ไม่ออกใบปิดยอดเลยด้วย) — เอกสารของเงินนั้นคือใบปิดยอด ⇒ ไม่ใช่ผู้สมัคร CLI (เดิมได้ใบ INSTALLMENT ทุกงวด) —
        // คำตัดสินเดียวกับทาง (c) ของ orphan_payments
        expect(await prisma.receipt.count({ where: { paymentId: paid6.id } })).toBe(0);
        // …และ CLI พิมพ์งวดเหล่านั้นว่าข้ามด้วยทาง c (Task 25) — คนรันเห็นก่อนรันจริง
        expect(await backfillListsOf([a3])).toEqual({
          cli: [],
          bound: [],
          elsewhere: [6, 7, 8, 9, 10, 11, 12].map((no) => `TEST-T16N-${stamp}-A3#${no}:c`).sort(),
        });
      },
      LONG,
    );

    it(
      'the JP4 late-fee allowance covers only the rows JP4 paid — a row PAID before the payoff overpaid within its leftover fee is caught',
      async () => {
        // ต่อจากเทสต์ก่อนหน้า (JP4 ลงแล้ว) — งวด 5 ชำระครบด้วยใบรับชำระก่อนปิดยอด · ภายหลังพนักงานเพิ่มค่าปรับ 100 ให้แถวที่จ่ายแล้ว
        // และยอดจ่ายถูกแก้เกิน 50 (ไม่เกินค่าปรับ) — เดิมส่วนเผื่อของ JP4 ครอบทุกแถวของสัญญาจึงไม่ติด
        const [entry] = await prisma.journalEntry.findMany({
          where: {
            AND: [
              { metadata: { path: ['contractId'], equals: a3 } },
              { metadata: { path: ['flow'], equals: 'early-payoff' } },
            ],
          },
          select: { id: true, postedAt: true, metadata: true },
        });
        const { firstUnpaidInstallmentNo, lastUnpaidInstallmentNo, ...withoutRange } =
          entry.metadata as Record<string, unknown>;
        expect([firstUnpaidInstallmentNo, lastUnpaidInstallmentNo]).toEqual([6, 12]);
        const row5 = await paymentOf(a3, 5);
        expect(row5.status).toBe('PAID');
        expect(row5.paidDate?.getTime()).not.toBe(entry.postedAt?.getTime());
        await prisma.payment.update({
          where: { id: row5.id },
          data: { lateFee: D(100), amountPaid: row5.amountDue.plus(50) },
        });
        const caught = [
          {
            id: a3,
            contract_number: `TEST-T16N-${stamp}-A3`,
            installment_nos: [5],
            overpay: '50.00',
          },
        ];
        // งวด 6 (JP4 เก็บค่าปรับ 100 ไว้ใน amountPaid) ยังได้ส่วนเผื่อ — ไม่อยู่ใน installment_nos
        expect((await run('overpaid', [a3])).details).toEqual(caught);

        // แถวที่รับเงินวันเดียวกับวันปิดยอด (หน้ารับชำระกับหน้าปิดยอดส่งวันที่ YYYY-MM-DD ⇒ เวลาเท่ากันทุกตัว) — วันที่อย่างเดียว
        // แยกไม่ได้ · ช่วงงวดที่ JP4 ปิด (firstUnpaidInstallmentNo..lastUnpaidInstallmentNo) แยกได้
        await prisma.payment.update({ where: { id: row5.id }, data: { paidDate: entry.postedAt } });
        expect((await run('overpaid', [a3])).details).toEqual(caught);

        // รายการ JP4 ก่อน 2026-10-18 ไม่มีช่วงงวด — เหลือวันที่เป็นตัวแยก (แถวที่ JP4 จ่ายยังได้ส่วนเผื่อ)
        await prisma.journalEntry.update({
          where: { id: entry.id },
          data: { metadata: withoutRange as Prisma.InputJsonObject },
        });
        await prisma.payment.update({ where: { id: row5.id }, data: { paidDate: row5.paidDate } });
        expect((await run('overpaid', [a3])).details).toEqual(caught);
      },
      LONG,
    );

    it(
      'Task 25 (r-1) — JP4 backs only the rows it settled: a row PAID before the payoff with no entry stays an orphan and a backfill:receipts candidate',
      async () => {
        await earlyPayoffApproved(prisma, contractPayments, a7, userId, {
          paymentMethod: 'BANK_TRANSFER',
          discountPct: 50,
          depositAccountCode: '11-1201',
        });
        const [entry] = await prisma.journalEntry.findMany({
          where: {
            AND: [
              { metadata: { path: ['contractId'], equals: a7 } },
              { metadata: { path: ['flow'], equals: 'early-payoff' } },
            ],
          },
          select: { id: true, postedAt: true, metadata: true },
        });
        const { firstUnpaidInstallmentNo, lastUnpaidInstallmentNo, ...withoutRange } =
          entry.metadata as Record<string, unknown>;
        expect([firstUnpaidInstallmentNo, lastUnpaidInstallmentNo]).toEqual([6, 12]);
        const row5 = await paymentOf(a7, 5);
        expect([row5.status, row5.paidDate?.getTime() === entry.postedAt?.getTime()]).toEqual([
          'PAID',
          false,
        ]);
        expect(
          (await prisma.payment.findMany({ where: { contractId: a7 } })).every(
            (p) => p.status === 'PAID',
          ),
        ).toBe(true);

        // ทาง (c) ตัดสินต่อแถวที่ JP4 จ่าย (วันที่ = วันของ JP4 · งวดอยู่ในช่วงที่ JP4 stamp — ตัวเดียวกับส่วนเผื่อค่าปรับของ
        // overpaid_contracts) ⇒ งวด 6–12 หนุนด้วย JP4 · งวด 5 (PAID ก่อนปิดยอด ไม่มีรายการ) ไม่อยู่ใต้ JP4 — เดิมทั้งสัญญาถือว่าหนุน
        // ⇒ orphan_payments (CRITICAL) และ backfill:receipts ข้ามเงียบ
        expect(await orphanRowsOf(a7)).toEqual([5]);
        expect(await backfillListsOf([a7])).toEqual({
          cli: [`TEST-T16N-${stamp}-A7#5`],
          bound: [],
          elsewhere: [6, 7, 8, 9, 10, 11, 12].map((no) => `TEST-T16N-${stamp}-A7#${no}:c`).sort(),
        });

        // รายการ JP4 2026-07-09…10-18 (ไม่มีช่วงงวด · postedAt = paidDate) — วันที่เป็นตัวแยก: งวด 6–12 ยังหนุนด้วย JP4 · งวด 5 (วันอื่น) ยังติด
        await prisma.journalEntry.update({
          where: { id: entry.id },
          data: { metadata: withoutRange as Prisma.InputJsonObject },
        });
        expect(await orphanRowsOf(a7)).toEqual([5]);
        expect((await backfillListsOf([a7])).cli).toEqual([`TEST-T16N-${stamp}-A7#5`]);

        // Task 25 fix round 1 (m-1): รายการ JP4 ก่อน 2026-07-09 (`711fcfa4c`) — ไม่มีช่วงงวด และ postedAt = เวลาที่ลงรายการ (≠ Payment.paidDate)
        // ⇒ แถวที่ JP4 จ่ายรู้จักจากคำนำหน้า notes ที่ earlyPayoff ประทับทุกแถวที่ปิด (ตั้งแต่ 2026-04-07) · งวด 5 (ไม่มีคำนำหน้า) ยังติด
        const row6 = await paymentOf(a7, 6);
        expect(row6.notes).toBe(EARLY_PAYOFF_PAYMENT_NOTE_PREFIX);
        await prisma.journalEntry.update({
          where: { id: entry.id },
          data: { postedAt: new Date(entry.postedAt!.getTime() + 9 * 60 * 60 * 1000) },
        });
        expect(await orphanRowsOf(a7)).toEqual([5]);
        expect(await backfillListsOf([a7])).toEqual({
          cli: [`TEST-T16N-${stamp}-A7#5`],
          bound: [],
          elsewhere: [6, 7, 8, 9, 10, 11, 12].map((no) => `TEST-T16N-${stamp}-A7#${no}:c`).sort(),
        });
        // รูปเดียวกันแต่แถวไม่มีคำนำหน้า ⇒ ไม่มีอะไรบอกว่า JP4 จ่าย — ติด orphan_payments และเป็นผู้สมัคร CLI
        await prisma.payment.update({ where: { id: row6.id }, data: { notes: null } });
        expect(await orphanRowsOf(a7)).toEqual([5, 6]);
        expect((await backfillListsOf([a7])).cli).toEqual(
          [`TEST-T16N-${stamp}-A7#5`, `TEST-T16N-${stamp}-A7#6`].sort(),
        );
        // JP4 ที่มีช่วงงวดตัดสินแบบเดิมทุกข้อ (วันที่ + ช่วง) — คำนำหน้าไม่ใช่ข้อยกเว้นของมัน
        await prisma.payment.update({ where: { id: row6.id }, data: { notes: row6.notes } });
        await prisma.journalEntry.update({
          where: { id: entry.id },
          data: { metadata: entry.metadata as Prisma.InputJsonObject },
        });
        expect(await orphanRowsOf(a7)).toEqual([5, 6, 7, 8, 9, 10, 11, 12]);
      },
      LONG,
    );
  });
});
