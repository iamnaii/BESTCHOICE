/**
 * Phase 5 Task 4 — State diagram ของ "เครื่อง" (product) พิสูจน์บน DB จริง
 *
 * เป้าหมาย: guard ที่ Task 1-3 วางไว้ต้องทำงาน **ร่วมกัน** บนเส้นทาง production จริง
 * ไม่ใช่แค่ผ่านทีละตัวใน unit test ที่ mock prisma. ทุกการเปลี่ยนสถานะในไฟล์นี้จึงมาจาก
 * service จริง (`activate` / `SalesService.create` / `ContractExchangeService.submit+approve` /
 * `RepossessionsService.createInTx+markReadyForSale+update` / `ProductsService.returnToStock`)
 * — **ห้าม** `prisma.product.update({ status })` เพื่อ "ตั้งฉาก" สถานะ เพราะนั่นคือการเขียน
 * เทสที่พิสูจน์เฉพาะ assertion ของตัวเอง ไม่ได้พิสูจน์ว่า flow จริงพาเครื่องไปสถานะนั้นได้
 *
 * ข้อยกเว้นที่ตั้งใจ (มีเหตุผลกำกับในเคสที่ใช้):
 *   - `contract.status = TERMINATED` ก่อนยึดเครื่อง — ในระบบจริงมาจากขั้นตอนส่งหนังสือ
 *     บอกเลิกสัญญา (letters/dispatch + cron) ซึ่งอยู่นอก state diagram ของ "เครื่อง"
 *     ที่ task นี้พิสูจน์ และ `jp5_require_terminated_status = true` บังคับให้ต้องผ่านมันก่อน
 *
 * สิ่งที่ปัก (สรุปจาก Task 1-3):
 *   1. `product-hold.util.ts` — `assertProductNotHeld` (ลบ / แก้ IMEI) 4 ชั้น
 *   2. `contract-workflow.service.ts` — ด่านสินค้า 2 ชั้น (นอก tx + ใน tx) ตอน activate
 *   3. `sale-writer.service.ts` — POS ขายได้เฉพาะ `IN_STOCK`
 *   4. `product-enter-stock.util.ts` — ประตูเข้า `IN_STOCK` ต้องยืนยันราคา + audit + stockInDate
 *   5. partial unique index `products_imei_serial_active_unique` — IMEI ซ้ำบนแถวที่ยังไม่ถูกลบ
 *   6. `product-hold.util.ts` action `RESTORE_TO_CONTRACT` (final review I-1) — ยกเลิกเปลี่ยน
 *      เครื่องต้องไม่ชุบชีวิตสัญญาเดิมบนเครื่องที่ถูกขาย/จองไปแล้ว
 *
 * Runner: vitest (jest ignore `*.integration.spec.ts`). ต้องมี DB จริง:
 *   cd apps/api && npx vitest run --no-file-parallelism \
 *     src/modules/contracts/__tests__/product-lifecycle.integration.spec.ts
 *
 * CI: ครอบด้วย glob `CONTRACTS_FILES` ใน `.github/workflows/deploy-gcp.yml`
 * (`src/modules/contracts/__tests__/*.integration.spec.ts`) — ตรวจแล้ว ไม่ต้องแก้ workflow
 *
 * Cleanup: SCOPED ตาม id ที่สเปคนี้สร้าง + สวีปตาม prefix `LIFECYCLETEST-` ปิดท้าย
 * (`audit_logs` ลบไม่ได้ — DB trigger `audit_logs_no_delete` ทำให้มัน immutable ตามดีไซน์)
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { ConflictException } from '@nestjs/common';
import { earlyPayoffWithApproval } from '../../../../e2e/helpers/payment-approval';
import { ContractPaymentService } from '../contract-payment.service';
import { EarlyPayoffJP4Template } from '../../journal/cpa-templates/early-payoff-jp4.template';
import { Vat60dayReversalTemplate } from '../../journal/cpa-templates/vat-60day-reversal.template';
import { ShopCollectSettlementTemplate } from '../../journal/cpa-templates/shop-collect-settlement.template';
import { EclStageReverseTemplate } from '../../journal/cpa-templates/ecl-stage-reverse.template';
import { DeviceReturnsService } from '../../device-returns/device-returns.service';
import { DeviceReturnNumberService } from '../../device-returns/device-return-number.service';
import { PAYMENT_APPROVAL_PERMISSIONS_KEY } from '../../payments/services/payment-approval-permissions';
import { Prisma, PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { seedFinanceCoa } from '../../../../prisma/seed-coa-finance';
import { seedShopCoa } from '../../../../prisma/seed-coa-shop';
import { ContractWorkflowService } from '../contract-workflow.service';
import { ProductsService } from '../../products/products.service';
import { ProductPhotosService } from '../../quality-control/product-photos.service';
import { SalesService } from '../../sales/sales.service';
import { RepossessionsService } from '../../repossessions/repossessions.service';
import { RepossessionJP5Template } from '../../journal/cpa-templates/repossession-jp5.template';
import { CreditNoteDocumentService } from '../../receipts/services/credit-note-document.service';
import { ContractExchangeService } from '../../contract-exchange/contract-exchange.service';
import { ExchangeCancelService } from '../../contract-exchange/contract-exchange-cancel.service';
import { AuditService } from '../../audit/audit.service';
import { CompanyResolverService } from '../../journal/company-resolver.service';
import { JournalAutoService } from '../../journal/journal-auto.service';
import { ContractActivation1ATemplate } from '../../journal/cpa-templates/contract-activation-1a.template';
import { ShopInventoryTransferTemplate } from '../../journal/cpa-templates/shop-inventory-transfer.template';
import { ShopDownPaymentTemplate } from '../../journal/cpa-templates/shop-down-payment.template';
import { ShopExternalFinanceSaleTemplate } from '../../journal/cpa-templates/shop-external-finance-sale.template';
import { ShopCashSaleTemplate } from '../../journal/cpa-templates/shop-cash-sale.template';
import { ShopAccountResolver } from '../../journal/shop-account-resolver.service';
import { seedVerifiedContractApproval } from './credit-approval.fixture';

const prisma = new PrismaClient();

// ---------------------------------------------------------------------------
// Service wiring (instance จริง ไม่ผ่าน Nest DI — pattern เดียวกับ
// exchange-priced-flow / contract-cancellation integration specs)
// ---------------------------------------------------------------------------
const journal = new JournalAutoService(prisma as never);
const companyResolver = new CompanyResolverService(prisma as never);
const audit = new AuditService(prisma as never);
const productsService = new ProductsService(prisma as never);
const productPhotosService = new ProductPhotosService(prisma as never);
const shopAccountResolver = new ShopAccountResolver(prisma as never);

const workflow = new ContractWorkflowService(
  prisma as never,
  null as never, // notificationsService — เรียกหลัง tx และมี guard `if (!this.notificationsService)`
  journal,
  new ContractActivation1ATemplate(journal, prisma as never),
  productsService,
  null as never, // contractExchangeService — ใช้เฉพาะสัญญาที่มาจากเปลี่ยนเครื่อง (ไม่มีในไฟล์นี้)
  new ShopInventoryTransferTemplate(journal, prisma as never, companyResolver),
  new ShopDownPaymentTemplate(journal, prisma as never, companyResolver),
  shopAccountResolver,
);

// POS — `SalesService` ประกอบ SaleWriter/SaleCreation ให้เองในคอนสตรักเตอร์
// (interCompanyService ใช้เฉพาะเส้นทางผ่อน/ไฟแนนซ์ภายนอก ไม่ใช่ขายสด)
const salesService = new SalesService(
  prisma as never,
  null as never,
  new ShopCashSaleTemplate(journal, prisma as never, companyResolver),
  shopAccountResolver,
  // C1 — ข้ามเองถ้าผังยังไม่มี S11-3101/S51-1106 (รอคำวินิจฉัยผู้สอบ)
  new ShopExternalFinanceSaleTemplate(journal, prisma as never, companyResolver),
  // ประกันทาง LINE เป็น fire-and-forget หลัง commit — ไฟล์นี้ไม่ตรวจการส่ง
  // ใส่ตัวปลอมที่ไม่ทำอะไร กันไม่ให้ยิงออกเน็ตจริงตอนรันเทสต์
  { notify: async () => {} } as never,
  new ShopDownPaymentTemplate(journal, prisma as never, companyResolver),
);

// เปลี่ยนเครื่องโหมด MEMO: ไม่มี JE เลย (workbook Case 1) — เทมเพลตทั้ง 5 + SHOP legs
// ถูกใช้เฉพาะเส้นทาง PRICED จึงส่ง null พร้อมคอมเมนต์ (แบบเดียวกับ product-guard spec)
const exchangeService = new ContractExchangeService(
  prisma as never,
  audit,
  null as never, // t1a  — PRICED only
  null as never, // t2   — PRICED only
  null as never, // t3   — PRICED only
  null as never, // t4   — PRICED only
  null as never, // t5   — PRICED only
  companyResolver,
  null as never, // shopInventoryTransferTemplate — PRICED only
  null as never, // shopAccountResolver — PRICED only
);

// ยกเลิกเปลี่ยนเครื่อง — เคส MEMO ไม่มี JE เลย จึงไม่ต้องมี reversal template
// (`ExchangeCancelReversalTemplate` ถูกเรียกเฉพาะเส้น FINALIZED/PRICED)
const exchangeCancelService = new ExchangeCancelService(
  prisma as never,
  audit,
  companyResolver,
  null as never, // reversalTemplate — PRICED/FINALIZED only
);

// ยึดเครื่อง (review 2026-09-05): create() ปฏิเสธสัญญาที่ไม่มียอดค้าง ⇒ เทสต้อง seed งวดค้างและเดิน JP5 จริง
// (refund templates ไม่ถูกเรียกใน create(); CN ไม่มี 2A accrual → SKIPPED_NO_ACCRUED; delivery = stub)
const repossessionsService = new RepossessionsService(
  prisma as never,
  journal,
  new RepossessionJP5Template(journal, prisma as never),
  null as never, // refundPayoutTemplate — ไม่ถูกเรียกใน create()
  null as never, // refundWaiveTemplate — ไม่ถูกเรียกใน create()
  new CreditNoteDocumentService(prisma as never),
  { deliver: async () => undefined } as never, // fire-and-forget หลัง tx — ไม่มี CN ให้ส่ง
);

// ---------------------------------------------------------------------------
// ข้อความของด่านที่กำลังพิสูจน์ (ต้องตรงกับ production strings)
// ---------------------------------------------------------------------------
const ACTIVATE_GUARD_MSG = 'สินค้าไม่พร้อมสำหรับเปิดสัญญา';
const POS_GUARD_MSG = 'สินค้าไม่พร้อมขาย หรือถูกขายไปแล้ว';
const DELETE_GUARD_MSG = 'ลบไม่ได้';
const IDENTITY_GUARD_MSG = 'แก้ IMEI ไม่ได้';
// final review I-1 — ด่าน `RESTORE_TO_CONTRACT` ของ `product-hold.util.ts`
const RESTORE_GUARD_MSG = 'ยกเลิกเปลี่ยนเครื่องไม่ได้';

const PREFIX = 'LIFECYCLETEST-';
const RUN = Date.now().toString(36).toUpperCase();
const RUN_NUM = String(Date.now() % 1_000_000).padStart(6, '0');

const dec = (s: string) => new Decimal(s);

// ---------------------------------------------------------------------------
// Tracked rows (SCOPED cleanup)
// ---------------------------------------------------------------------------
const createdContractIds: string[] = [];
const createdProductIds: string[] = [];
const createdCustomerIds: string[] = [];
const createdRequestIds: string[] = [];
let createdBranchId: string | null = null;

let adminId: string;
let shopCompanyId: string;
let financeCompanyId: string;
let branchId: string;

interface SeedProductOpts {
  brand?: string;
  model?: string;
  storage?: string;
  category?: 'PHONE_NEW' | 'PHONE_USED';
  status?: 'IN_STOCK';
  costPrice?: string;
  cashPrice?: string | null;
  installmentPrice?: string | null;
}

/** เครื่องพร้อมขายในคลัง SHOP — จุดตั้งต้นเดียวของทุก state diagram ในไฟล์นี้ */
async function seedProduct(tag: string, opts: SeedProductOpts = {}) {
  const product = await prisma.product.create({
    data: {
      name: `${PREFIX}Phone ${tag}`,
      brand: opts.brand ?? `${PREFIX}Brand`,
      model: opts.model ?? `${PREFIX}Model-${tag}`,
      storage: opts.storage ?? '128GB',
      imeiSerial: `${PREFIX}${RUN}-${tag}`,
      category: opts.category ?? 'PHONE_NEW',
      costPrice: dec(opts.costPrice ?? '6000.00'),
      ...(opts.cashPrice === undefined
        ? {}
        : { cashPrice: opts.cashPrice ? dec(opts.cashPrice) : null }),
      ...(opts.installmentPrice === undefined
        ? {}
        : { installmentPrice: opts.installmentPrice ? dec(opts.installmentPrice) : null }),
      branchId,
      status: opts.status ?? 'IN_STOCK',
      ownedByCompanyId: shopCompanyId,
      stockInDate: new Date(),
    },
  });
  createdProductIds.push(product.id);
  return product;
}

async function seedCustomer(tag: string) {
  const customer = await prisma.customer.create({
    data: {
      name: `${PREFIX}Customer ${tag}`,
      phone: `09${RUN_NUM}${tag}`.slice(0, 12),
      nationalId: `${PREFIX}${RUN}-${tag}`,
    },
  });
  createdCustomerIds.push(customer.id);
  return customer;
}

/**
 * สัญญา DRAFT ที่ผ่านทุกด่านก่อนหน้าด่านสินค้าแล้ว (workflowStatus APPROVED + PDPA +
 * ลายเซ็นครบ 4) — `contractHash` null ⇒ `verifyContractHash` ข้าม (legacy path)
 *
 * ตัวเลข = ชุดเดียวกับ CPA golden 17K/12M: financed 10,000 + คอม 1,000 + ดอกเบี้ย 6,000,
 * VAT 1,190, ค่างวด 1,515.83 (down 2,000 + financed 10,000 = sellingPrice 12,000 —
 * invariant ที่ `ShopInventoryTransferTemplate` assert ตอน activate)
 */
async function seedSignedDraftContract(tag: string, customerId: string, productId: string) {
  const consent = await prisma.pDPAConsent.create({
    data: {
      customerId,
      consentVersion: '1.0',
      privacyNoticeText: 'test',
      status: 'GRANTED',
      grantedAt: new Date(),
    },
  });

  const contract = await prisma.contract.create({
    data: {
      contractNumber: `${PREFIX}${RUN}-${tag}`,
      customerId,
      productId,
      branchId,
      salespersonId: adminId,
      pdpaConsentId: consent.id,
      planType: 'STORE_WITH_INTEREST',
      sellingPrice: dec('12000.00'),
      downPayment: dec('2000.00'),
      // ตั้งแต่ 17f19230f activate() ต้องเห็นหลักฐานรับเงินดาวน์ (วิธี + เวลา) ถึงจะโพสต์ ShopDownPayment
      // ย้อนให้ได้ — เหมือนที่ ContractLifecycleService.create() บันทึกตอนรับเงินจริง
      downPaymentMethod: 'CASH',
      downPaymentReceivedAt: new Date(),
      financedAmount: dec('10000.00'),
      interestRate: dec('0.0500'),
      totalMonths: 12,
      interestTotal: dec('6000.00'),
      storeCommission: dec('1000.00'),
      vatAmount: dec('1190.00'),
      vatPct: dec('0.0700'),
      monthlyPayment: dec('1515.83'),
      paymentDueDay: 1,
      status: 'DRAFT',
      workflowStatus: 'APPROVED',
    },
  });
  createdContractIds.push(contract.id);
  await seedVerifiedContractApproval(prisma, contract.id, adminId);

  for (const signerType of ['CUSTOMER', 'COMPANY', 'WITNESS_1', 'WITNESS_2'] as const) {
    await prisma.signature.create({
      data: { contractId: contract.id, signerType, signatureImage: 'data:image/png;base64,AA==' },
    });
  }
  return contract;
}

/** งวดค้าง N งวด (สถานะ PENDING) — ให้ create() มียอดค้างและ JP5 + ใบรับเข้าสต็อก SHOP โพสต์จริง */
async function seedPendingPayments(contractId: string, installmentCount: number): Promise<void> {
  const startDate = new Date('2025-01-01');
  for (let installmentNo = 1; installmentNo <= installmentCount; installmentNo++) {
    const dueDate = new Date(startDate);
    dueDate.setMonth(dueDate.getMonth() + installmentNo);
    await prisma.payment.update({
      where: { contractId_installmentNo: { contractId, installmentNo } },
      data: { dueDate, status: 'PENDING' },
    });
  }
}

/** ยอดสุทธิ (Dr − Cr) ของบัญชีทั้งบัญชีจาก JE ที่ POSTED — ไฟล์นี้รันทีละเทส จึงใช้ delta ได้ */
async function accountNet(accountCode: string): Promise<Decimal> {
  const lines = await prisma.journalLine.findMany({
    where: { accountCode, journalEntry: { status: 'POSTED', deletedAt: null } },
    select: { debit: true, credit: true },
  });
  return lines.reduce(
    (sum, l) => sum.plus(l.debit.toString()).minus(l.credit.toString()),
    new Decimal(0),
  );
}

/** ขายสดผ่าน POS (เส้นทางเดียวกับหน้าจอ POS: `SalesService.create`) */
function posCashSale(customerId: string, productId: string, sellingPrice: number) {
  return salesService.create(
    {
      saleType: 'CASH',
      customerId,
      productId,
      branchId,
      sellingPrice,
      paymentMethod: 'BANK_TRANSFER',
      amountReceived: sellingPrice,
    } as never,
    adminId,
    'OWNER',
  );
}

const OWNER_USER = () => ({ id: adminId, role: 'OWNER', branchId });

function buildIntake(numberService: Pick<DeviceReturnNumberService, 'next'>) {
  const effects = {
    notify: vi.fn().mockResolvedValue(undefined),
    recomputeForCustomer: vi.fn().mockResolvedValue(undefined),
    log: vi.fn().mockResolvedValue(undefined),
  };
  const service = new DeviceReturnsService(
    prisma as never,
    repossessionsService,
    numberService as DeviceReturnNumberService,
    { notify: effects.notify } as never,
    { recomputeForCustomer: effects.recomputeForCustomer } as never,
    null as never, // journey is unused by intake
    { log: effects.log } as never,
    null as never, // credit-note delivery is unused by intake
  );
  return { service, effects };
}

function intakeDto(contractId: string) {
  return {
    contractId,
    receivingBranchId: branchId,
    deviceReceivedAt: new Date().toISOString(),
    conditionGrade: 'B' as const,
    appraisalPrice: 7000,
    returnReason: 'UNAFFORDABLE' as const,
  };
}

/**
 * interim (Task 4 ของแผนใบรับเครื่องคืน): create() ถูกลบ — ยึดผ่าน createInTx ใต้ tx ของเทสเอง
 * พร้อมใบรับเครื่องคืน synthetic. Task 10 แทนด้วย DeviceReturnsService.create+confirm (เส้นทางจริง).
 */
async function repossessViaCreateInTx(
  contractId: string,
  productId: string,
  customerId: string,
  appraisalPrice: number,
) {
  const { financeCompanyId, shopCompanyId } =
    await repossessionsService.assertRepossessionPeriodsOpen(new Date());
  const dr = await prisma.deviceReturn.create({
    data: {
      docNumber: `DR-LIFECYCLE-${RUN}-${Date.now() % 100000}`,
      contractId,
      productId,
      customerId,
      receivingBranchId: branchId,
      receivedById: adminId,
      returnKind: 'REPOSSESSION',
      returnReason: 'AFTER_TERMINATION',
      deviceReceivedAt: new Date(),
      conditionGrade: 'B',
      appraisalPrice: dec(String(appraisalPrice)),
    },
  });
  return prisma.$transaction((tx) =>
    repossessionsService.createInTx(
      tx,
      {
        contractId,
        repossessedDate: new Date(),
        paymentDate: new Date(),
        conditionGrade: 'B',
        appraisalPrice,
        appraisedById: adminId,
        receivingBranchId: branchId,
        deviceReturnId: dr.id,
        financeCompanyId,
        shopCompanyId,
      },
      adminId,
    ),
  );
}

describe('State diagram ของเครื่อง — flow จริงบน DB จริง (Phase 5 Task 4)', () => {
  beforeAll(async () => {
    await seedFinanceCoa(prisma);
    await seedShopCoa(prisma);

    const shop = await prisma.companyInfo.findFirstOrThrow({
      where: { companyCode: 'SHOP', deletedAt: null },
    });
    const finance = await prisma.companyInfo.findFirstOrThrow({
      where: { companyCode: 'FINANCE', deletedAt: null },
    });
    shopCompanyId = shop.id;
    financeCompanyId = finance.id;

    let admin = await prisma.user.findFirst({ where: { email: 'admin@bestchoice.com' } });
    if (!admin) {
      admin = await prisma.user.create({
        data: { email: 'admin@bestchoice.com', password: 'x', name: 'admin', role: 'OWNER' },
      });
    }
    adminId = admin.id;

    const existing = await prisma.branch.findFirst({
      where: { name: '__lifecycle_test_branch__', deletedAt: null },
    });
    if (existing) {
      branchId = existing.id;
      // ตู้เงินสดสาขา — `ShopDownPaymentTemplate` fail-closed ถ้าไม่มี (เงินดาวน์ > 0)
      if (existing.shopCashAccountCode !== 'S11-1101') {
        await prisma.branch.update({
          where: { id: existing.id },
          data: { shopCashAccountCode: 'S11-1101' },
        });
      }
    } else {
      const branch = await prisma.branch.create({
        data: {
          name: '__lifecycle_test_branch__',
          companyId: shopCompanyId,
          shopCashAccountCode: 'S11-1101',
        },
      });
      branchId = branch.id;
      createdBranchId = branch.id;
    }
  }, 180_000);

  afterAll(async () => {
    try {
      await prisma.deviceReturn.deleteMany({ where: { contractId: { in: createdContractIds } } });
      // งวดค้างที่ seed ให้ JP5 (payments.contract_id FK) + แถวยึดของเคสยึดเครื่อง
      await prisma.payment.deleteMany({ where: { contractId: { in: createdContractIds } } });
      await prisma.repossession.deleteMany({ where: { contractId: { in: createdContractIds } } });
      // JE ที่สเปคนี้ผลิต: (ก) stamp metadata.contractId (1A / SHOP legs), (ข) metadata.saleId
      // (ขายสดหน้าร้าน) — สวีปทั้งสองแบบเหมือน exchange/cancellation specs
      const jeIds = new Set<string>();
      for (const cid of createdContractIds) {
        const rows = await prisma.journalEntry.findMany({
          where: { metadata: { path: ['contractId'], equals: cid } as never },
          select: { id: true },
        });
        rows.forEach((r) => jeIds.add(r.id));
      }
      const sales = await prisma.sale.findMany({
        where: { productId: { in: createdProductIds } },
        select: { id: true },
      });
      const saleIds = sales.map((s) => s.id);
      for (const sid of saleIds) {
        const rows = await prisma.journalEntry.findMany({
          where: { metadata: { path: ['saleId'], equals: sid } as never },
          select: { id: true },
        });
        rows.forEach((r) => jeIds.add(r.id));
      }
      const jeIdList = [...jeIds];

      // JournalPostAuditLog FK-references journal_entries — ต้องล้างก่อน (a48fe1fe)
      await prisma.journalPostAuditLog.deleteMany({ where: { journalEntryId: { in: jeIdList } } });
      await prisma.journalLine.deleteMany({ where: { journalEntryId: { in: jeIdList } } });
      await prisma.journalEntry.deleteMany({ where: { id: { in: jeIdList } } });

      await prisma.salesCommission.deleteMany({ where: { saleId: { in: saleIds } } });
      // sale_cost_snapshots FK-references sales (ON DELETE RESTRICT) — clear it first, or this afterAll
      // aborts here and the credit approvals / contracts below survive into every later spec's cleanup.
      await prisma.saleCostSnapshot.deleteMany({ where: { saleId: { in: saleIds } } });
      await prisma.sale.deleteMany({ where: { id: { in: saleIds } } });
      await prisma.repossession.deleteMany({ where: { productId: { in: createdProductIds } } });
      await prisma.contractExchangeRequest.deleteMany({ where: { id: { in: createdRequestIds } } });
      await prisma.signature.deleteMany({ where: { contractId: { in: createdContractIds } } });
      await prisma.installmentSchedule.deleteMany({
        where: { contractId: { in: createdContractIds } },
      });
      await prisma.payment.deleteMany({ where: { contractId: { in: createdContractIds } } });
      await prisma.creditApproval.deleteMany({ where: { customerId: { in: createdCustomerIds } } });
      await prisma.creditCheck.deleteMany({ where: { customerId: { in: createdCustomerIds } } });
      await prisma.contract.deleteMany({ where: { id: { in: createdContractIds } } });
      await prisma.productPrice.deleteMany({ where: { productId: { in: createdProductIds } } });
      await prisma.productReservation.deleteMany({
        where: { productId: { in: createdProductIds } },
      });
      await prisma.product.deleteMany({ where: { id: { in: createdProductIds } } });
      await prisma.pDPAConsent.deleteMany({ where: { customerId: { in: createdCustomerIds } } });
      await prisma.customer.deleteMany({ where: { id: { in: createdCustomerIds } } });

      // ตาข่ายสุดท้าย: แถวที่ flow จริงสร้างเองนอกรายการ id ที่เราจด (เช่นเคสที่ guard
      // "ควรกัน" แต่หลุด — ถ้ามีจริง เทสจะฟ้องอยู่แล้ว แต่ห้ามทิ้งขยะไว้ในดีบี dev)
      await prisma.product.deleteMany({ where: { imeiSerial: { startsWith: PREFIX } } });
      await prisma.customer.deleteMany({ where: { nationalId: { startsWith: PREFIX } } });

      if (createdBranchId) {
        try {
          await prisma.branch.delete({ where: { id: createdBranchId } });
        } catch (error) {
          if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2003') {
            throw error;
          }
          // ถูกอ้างอิงโดยแถวนอกขอบเขตสเปคนี้ — ปล่อยไว้
        }
      }
    } finally {
      await prisma.$disconnect();
    }
  }, 180_000);

  it('intake preserves a real early payoff committed after eligibility was read', async () => {
    const product = await seedProduct('DR-RACE');
    const customer = await seedCustomer('DR-RACE');
    const contract = await seedSignedDraftContract('DR-RACE', customer.id, product.id);
    await workflow.activate(contract.id);
    const closer = new PrismaClient(); // independent connection for the winning financial transaction
    const approvalConfigBefore = await closer.systemConfig.findUnique({
      where: { key: PAYMENT_APPROVAL_PERMISSIONS_KEY },
      select: { value: true, deletedAt: true },
    });
    const closeJournal = new JournalAutoService(closer as never);
    const payoff = new ContractPaymentService(
      closer as never,
      new ProductsService(closer as never),
      closeJournal,
      new EarlyPayoffJP4Template(
        closeJournal,
        closer as never,
        new Vat60dayReversalTemplate(closeJournal, closer as never),
      ),
      new ShopCollectSettlementTemplate(closeJournal, closer as never),
      { generateReceipt: async () => undefined } as never, // no receipt rendering or outbound delivery
      new EclStageReverseTemplate(closeJournal, closer as never),
    );
    let resume!: () => void;
    let reached!: () => void;
    const paused = new Promise<void>((resolve) => {
      reached = resolve;
    });
    const resumeGate = new Promise<void>((resolve) => {
      resume = resolve;
    });
    const realNumbers = new DeviceReturnNumberService(prisma as never);
    const { service, effects } = buildIntake({
      next: async (tx) => {
        // The real service has completed all eligibility reads; no intake writes yet.
        reached();
        await resumeGate;
        return realNumbers.next(tx);
      },
    });
    const intake = service.create(intakeDto(contract.id), OWNER_USER()).then(
      (row) => ({ row, error: null }),
      (error: unknown) => ({ row: null, error }),
    );
    try {
      await Promise.race([
        paused,
        intake.then(() => {
          throw new Error('Intake ended before the eligibility barrier');
        }),
      ]);
      await earlyPayoffWithApproval(closer, payoff, contract.id, adminId, {
        paymentMethod: 'BANK_TRANSFER',
        discountPct: 0,
      });
      expect(
        await closer.systemConfig.findUnique({
          where: { key: PAYMENT_APPROVAL_PERMISSIONS_KEY },
          select: { value: true, deletedAt: true },
        }),
      ).toEqual(approvalConfigBefore);
      const closed = await closer.contract.findUniqueOrThrow({ where: { id: contract.id } });
      const payments = await closer.payment.findMany({
        where: { contractId: contract.id },
        orderBy: { id: 'asc' },
      });
      const journals = await closer.journalEntry.findMany({
        where: { metadata: { path: ['contractId'], equals: contract.id } },
        include: { lines: { orderBy: { id: 'asc' } } },
        orderBy: { id: 'asc' },
      });
      const ownedProduct = await closer.product.findUniqueOrThrow({ where: { id: product.id } });
      expect(closed.status).toBe('EARLY_PAYOFF');
      expect(payments.length).toBeGreaterThan(0);
      expect(payments.every((p) => p.status === 'PAID')).toBe(true);
      expect(journals.some((j) => (j.metadata as Prisma.JsonObject)?.flow === 'early-payoff')).toBe(
        true,
      );
      expect(ownedProduct.ownedByCompanyId).toBeNull();

      resume();
      const outcome = await intake;
      // Check persisted state first: RED must expose actual lost update, not merely an error shape.
      expect((await prisma.contract.findUniqueOrThrow({ where: { id: contract.id } })).status).toBe(
        'EARLY_PAYOFF',
      );
      expect(await prisma.contract.findUniqueOrThrow({ where: { id: contract.id } })).toEqual(
        closed,
      );
      expect(outcome.error).toBeInstanceOf(ConflictException);
      expect((outcome.error as ConflictException).getStatus()).toBe(409);
      expect((outcome.error as Error).message).toBe(
        'ข้อมูลสัญญาเปลี่ยนระหว่างรับเครื่องคืน กรุณาตรวจสอบแล้วลองใหม่',
      );
      expect(outcome.row).toBeNull();
      expect(await prisma.deviceReturn.count({ where: { contractId: contract.id } })).toBe(0);
      expect(
        await prisma.auditLog.count({
          where: {
            entityId: contract.id,
            action: 'CONTRACT_STATUS_LEGAL',
            newValue: { path: ['reason'], equals: 'DEVICE_RETURN_INTAKE' },
          },
        }),
      ).toBe(0);
      expect(
        await prisma.payment.findMany({
          where: { contractId: contract.id },
          orderBy: { id: 'asc' },
        }),
      ).toEqual(payments);
      expect(
        await prisma.journalEntry.findMany({
          where: { metadata: { path: ['contractId'], equals: contract.id } },
          include: { lines: { orderBy: { id: 'asc' } } },
          orderBy: { id: 'asc' },
        }),
      ).toEqual(journals);
      expect(await prisma.product.findUniqueOrThrow({ where: { id: product.id } })).toEqual(
        ownedProduct,
      );
      expect(effects.log).not.toHaveBeenCalled();
      expect(effects.recomputeForCustomer).not.toHaveBeenCalled();
      expect(effects.notify).not.toHaveBeenCalled();
    } finally {
      resume();
      await intake;
      await closer.$disconnect();
    }
  }, 180_000);

  it('ordinary intake commits one pending document and its legal status audit', async () => {
    const product = await seedProduct('DR-OK');
    const customer = await seedCustomer('DR-OK');
    const contract = await seedSignedDraftContract('DR-OK', customer.id, product.id);
    await workflow.activate(contract.id);
    const { service, effects } = buildIntake(new DeviceReturnNumberService(prisma as never));
    const row = await service.create(intakeDto(contract.id), OWNER_USER());
    expect(row.status).toBe('PENDING_CONFIRM');
    expect((await prisma.contract.findUniqueOrThrow({ where: { id: contract.id } })).status).toBe(
      'TERMINATED',
    );
    expect(await prisma.deviceReturn.count({ where: { contractId: contract.id } })).toBe(1);
    expect(
      await prisma.auditLog.count({
        where: {
          entityId: contract.id,
          action: 'CONTRACT_STATUS_LEGAL',
          newValue: { path: ['reason'], equals: 'DEVICE_RETURN_INTAKE' },
        },
      }),
    ).toBe(1);
    expect(effects.log).toHaveBeenCalledTimes(1);
    expect(effects.recomputeForCustomer).toHaveBeenCalledWith(customer.id);
    expect(effects.notify).toHaveBeenCalledWith(row.id, 'DEVICE_RETURNED');
  }, 180_000);

  it.each(['reject', 'cancel'] as const)(
    'confirm versus %s uses one lock order and returns a clean conflict',
    async (action) => {
      const product = await seedProduct(`DR-${action}`);
      const customer = await seedCustomer(`DR-${action}`);
      const contract = await seedSignedDraftContract(`DR-${action}`, customer.id, product.id);
      await workflow.activate(contract.id);
      const intake = buildIntake(new DeviceReturnNumberService(prisma as never));
      const pending = await intake.service.create(intakeDto(contract.id), OWNER_USER());
      const closer = new PrismaClient();
      let release!: () => void;
      let reached!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const paused = new Promise<void>((resolve) => {
        reached = resolve;
      });
      let closePid: number | undefined;
      const makeService = (client: PrismaClient, pauseFinancial: boolean) => {
        const effects = {
          log: vi.fn().mockResolvedValue(undefined),
          recordAfterCommit: vi.fn().mockResolvedValue(undefined),
          recomputeForCustomer: vi.fn().mockResolvedValue(undefined),
          notify: vi.fn().mockResolvedValue(undefined),
          deliver: vi.fn().mockResolvedValue(undefined),
        };
        const serviceClient = {
          deviceReturn: client.deviceReturn,
          user: client.user,
          $transaction: (fn: (tx: Prisma.TransactionClient) => Promise<unknown>) =>
            client.$transaction(
              async (tx) => {
                if (!pauseFinancial) {
                  const [row] = await tx.$queryRaw<
                    { pid: number }[]
                  >`SELECT pg_backend_pid() AS pid`;
                  closePid = row.pid;
                }
                return fn(tx);
              },
              { timeout: 20_000 },
            ),
        };
        const financial = {
          assertRepossessionPeriodsOpen:
            repossessionsService.assertRepossessionPeriodsOpen.bind(repossessionsService),
          createInTx: async (...args: Parameters<RepossessionsService['createInTx']>) => {
            const result = await repossessionsService.createInTx(...args);
            // Real financial writes hold the contract lock until this transaction commits.
            reached();
            await gate;
            return result;
          },
        };
        return {
          service: new DeviceReturnsService(
            serviceClient as never,
            financial as never,
            null as never,
            effects as never,
            effects as never,
            effects as never,
            effects as never,
            effects as never,
          ),
          effects,
        };
      };
      const confirming = makeService(prisma, true);
      const closing = makeService(closer, false);
      const settle = <T>(promise: Promise<T>) =>
        promise.then(
          (value) => ({ value, error: null }),
          (error: unknown) => ({ value: null, error }),
        );
      const confirmation = settle(confirming.service.confirm(pending.id, {}, OWNER_USER()));
      let closure: ReturnType<typeof settle> | undefined;
      try {
        await Promise.race([
          paused,
          confirmation.then(() => {
            throw new Error('Confirm ended before its financial write barrier');
          }),
        ]);
        closure = settle(
          action === 'reject'
            ? closing.service.reject(
                pending.id,
                { reason: 'ตรวจสอบใบรับเครื่องคืนใหม่' },
                OWNER_USER(),
              )
            : closing.service.cancel(pending.id, OWNER_USER()),
        );
        const deadline = Date.now() + 10_000;
        let waiting = false;
        while (Date.now() < deadline) {
          if (closePid) {
            const rows = await prisma.$queryRaw<{ wait_event_type: string | null }[]>`
              SELECT wait_event_type FROM pg_stat_activity WHERE pid = ${closePid}`;
            if (rows[0]?.wait_event_type === 'Lock') {
              waiting = true;
              break;
            }
          }
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        expect(waiting).toBe(true); // observed database lock wait, not timing alone
        release();
        const [confirmed, closed] = await Promise.all([confirmation, closure]);
        expect(confirmed.error).toBeNull();
        expect(
          closed.error,
          closed.error instanceof Error ? closed.error.message : undefined,
        ).toBeInstanceOf(ConflictException);
        expect((closed.error as ConflictException).getStatus()).toBe(409);
        const row = await prisma.deviceReturn.findUniqueOrThrow({ where: { id: pending.id } });
        expect(row.status).toBe('CONFIRMED');
        expect(row.confirmedById).toBe(adminId);
        expect(row.confirmedAt).not.toBeNull();
        expect(row.repossessionId).not.toBeNull();
        expect(row.rejectedAt).toBeNull();
        expect(row.canceledAt).toBeNull();
        expect(
          (await prisma.contract.findUniqueOrThrow({ where: { id: contract.id } })).status,
        ).toBe('CLOSED_BAD_DEBT');
        expect(await prisma.repossession.count({ where: { contractId: contract.id } })).toBe(1);
        const entries = await prisma.journalEntry.findMany({
          where: { metadata: { path: ['contractId'], equals: contract.id } },
        });
        expect(
          entries.filter((entry) => (entry.metadata as Prisma.JsonObject).flow === 'repossession'),
        ).toHaveLength(1);
        expect(
          entries.filter(
            (entry) => (entry.metadata as Prisma.JsonObject).flow === 'shop-repossession-intake',
          ),
        ).toHaveLength(1);
        expect(closing.effects.log).not.toHaveBeenCalled();
        expect(closing.effects.notify).not.toHaveBeenCalled();
        expect(closing.effects.recomputeForCustomer).not.toHaveBeenCalled();
        expect(confirming.effects.log).toHaveBeenCalledTimes(1);
      } finally {
        release();
        await confirmation;
        if (closure) await closure;
        await closer.$disconnect();
      }
    },
    180_000,
  );

  it('financial failure rolls back the early document claim and all financial writes', async () => {
    const product = await seedProduct('DR-ROLLBACK');
    const customer = await seedCustomer('DR-ROLLBACK');
    const contract = await seedSignedDraftContract('DR-ROLLBACK', customer.id, product.id);
    await workflow.activate(contract.id);
    const intake = buildIntake(new DeviceReturnNumberService(prisma as never));
    const pending = await intake.service.create(intakeDto(contract.id), OWNER_USER());
    const before = {
      document: await prisma.deviceReturn.findUniqueOrThrow({ where: { id: pending.id } }),
      contract: await prisma.contract.findUniqueOrThrow({ where: { id: contract.id } }),
      product: await prisma.product.findUniqueOrThrow({ where: { id: product.id } }),
      journals: await prisma.journalEntry.findMany({
        where: { metadata: { path: ['contractId'], equals: contract.id } },
        include: { lines: { orderBy: { id: 'asc' } } },
        orderBy: { id: 'asc' },
      }),
    };
    const effects = {
      log: vi.fn(),
      notify: vi.fn(),
      recordAfterCommit: vi.fn(),
      recomputeForCustomer: vi.fn(),
      deliver: vi.fn(),
    };
    const failure = new Error('Injected financial failure after real journal writes');
    let claimedStatus: string | undefined;
    const financial = {
      assertRepossessionPeriodsOpen:
        repossessionsService.assertRepossessionPeriodsOpen.bind(repossessionsService),
      createInTx: async (...args: Parameters<RepossessionsService['createInTx']>) => {
        claimedStatus = (
          await args[0].deviceReturn.findUniqueOrThrow({ where: { id: pending.id } })
        ).status;
        await repossessionsService.createInTx(...args);
        throw failure;
      },
    };
    const service = new DeviceReturnsService(
      prisma as never,
      financial as never,
      null as never,
      effects as never,
      effects as never,
      effects as never,
      effects as never,
      effects as never,
    );
    await expect(service.confirm(pending.id, {}, OWNER_USER())).rejects.toBe(failure);
    expect(claimedStatus).toBe('CONFIRMED');
    expect(await prisma.deviceReturn.findUniqueOrThrow({ where: { id: pending.id } })).toEqual(
      before.document,
    );
    expect(await prisma.contract.findUniqueOrThrow({ where: { id: contract.id } })).toEqual(
      before.contract,
    );
    expect(await prisma.product.findUniqueOrThrow({ where: { id: product.id } })).toEqual(
      before.product,
    );
    expect(
      await prisma.journalEntry.findMany({
        where: { metadata: { path: ['contractId'], equals: contract.id } },
        include: { lines: { orderBy: { id: 'asc' } } },
        orderBy: { id: 'asc' },
      }),
    ).toEqual(before.journals);
    expect(await prisma.repossession.count({ where: { contractId: contract.id } })).toBe(0);
    for (const effect of Object.values(effects)) expect(effect).not.toHaveBeenCalled();
  }, 180_000);

  // -------------------------------------------------------------------------
  it('เครื่องเดียวเปิดสองสัญญาพร้อมกันไม่ได้ (สัญญาที่สองแพ้ตอน activate)', async () => {
    const product = await seedProduct('A1');
    const customer1 = await seedCustomer('A1');
    const customer2 = await seedCustomer('A2');
    const c1 = await seedSignedDraftContract('A1', customer1.id, product.id);
    const c2 = await seedSignedDraftContract('A2', customer2.id, product.id);

    // --- สัญญาแรก: เปิดผ่าน flow จริง (1A + SHOP legs + ย้ายกรรมสิทธิ์ + ตารางงวด)
    await workflow.activate(c1.id);

    const afterFirst = await prisma.product.findUniqueOrThrow({ where: { id: product.id } });
    expect(afterFirst.status).toBe('SOLD_INSTALLMENT');
    expect(afterFirst.ownedByCompanyId).toBe(financeCompanyId);
    expect((await prisma.contract.findUniqueOrThrow({ where: { id: c1.id } })).status).toBe(
      'ACTIVE',
    );

    // --- สัญญาที่สองบนเครื่องเดียวกัน: ต้องแพ้ที่ด่านสินค้า
    await expect(workflow.activate(c2.id)).rejects.toThrow(ACTIVATE_GUARD_MSG);

    const c2After = await prisma.contract.findUniqueOrThrow({ where: { id: c2.id } });
    expect(c2After.status).toBe('DRAFT');
    // ไม่มีตารางงวด/JE ของสัญญาที่สองหลุดออกมา (tx rollback ครบ)
    expect(await prisma.installmentSchedule.count({ where: { contractId: c2.id } })).toBe(0);
    expect(
      await prisma.journalEntry.count({
        where: { metadata: { path: ['contractId'], equals: c2.id } as never },
      }),
    ).toBe(0);
    // เครื่องยังผูกกับสัญญาแรกเท่านั้น
    expect(await prisma.sale.count({ where: { productId: product.id } })).toBe(1);
  }, 180_000);

  // -------------------------------------------------------------------------
  it('ขายซ้ำไม่ได้: ขายสด IN_STOCK → SOLD_CASH แล้วขายอีกครั้งถูกปฏิเสธ', async () => {
    const product = await seedProduct('B1', { cashPrice: '9900.00' });
    const customer = await seedCustomer('B1');
    const buyer2 = await seedCustomer('B2');

    const sale = await posCashSale(customer.id, product.id, 9900);
    expect(sale.id).toBeTruthy();

    const afterSale = await prisma.product.findUniqueOrThrow({ where: { id: product.id } });
    expect(afterSale.status).toBe('SOLD_CASH');
    // ขา SHOP ของ POS ลงจริง (รายได้ + ตัดสต็อก) — พิสูจน์ว่าเดินเส้นทางจริงไม่ใช่ stub
    expect(
      await prisma.journalEntry.count({
        where: { metadata: { path: ['saleId'], equals: sale.id } as never },
      }),
    ).toBe(1);

    // ขายซ้ำ (ลูกค้าคนละคน) — ต้องแพ้ที่ `verifyProductInStock`
    await expect(posCashSale(buyer2.id, product.id, 9900)).rejects.toThrow(POS_GUARD_MSG);

    expect(await prisma.sale.count({ where: { productId: product.id } })).toBe(1);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: product.id } })).status).toBe(
      'SOLD_CASH',
    );
  }, 180_000);

  // -------------------------------------------------------------------------
  it('ห่วงโซ่ที่ปิดใน Task 1-2: ลบเครื่องที่อยู่ในสัญญา ACTIVE ไม่ได้ ⇒ รับ IMEI เดิมเข้าใหม่ไม่ได้ (unique index) ⇒ ขายซ้ำไม่ได้', async () => {
    const product = await seedProduct('C1');
    const customer = await seedCustomer('C1');
    const contract = await seedSignedDraftContract('C1', customer.id, product.id);
    await workflow.activate(contract.id);

    const imei = product.imeiSerial as string;

    // (1) ลบเครื่องที่ยังผูกสัญญา ACTIVE — ด่าน Task 1
    await expect(productsService.remove(product.id)).rejects.toThrow(DELETE_GUARD_MSG);

    // (2) แก้ IMEI = ปลด slot ใน partial unique index โดยไม่ต้องลบ — ด่านเดียวกัน
    await expect(
      productsService.update(product.id, { imeiSerial: `${PREFIX}${RUN}-C1-MOVED` } as never),
    ).rejects.toThrow(IDENTITY_GUARD_MSG);

    // (3) แถวเดิมยังมีชีวิต ⇒ partial unique index ยังกัน IMEI ซ้ำอยู่
    //     (`products.service.create` ไม่มี pre-check — พึ่ง index ตรง ๆ เป็น P2002)
    let dupErr: unknown;
    try {
      await productsService.create({
        name: `${PREFIX}Dup C1`,
        brand: `${PREFIX}Brand`,
        model: `${PREFIX}Model-C1`,
        storage: '128GB',
        imeiSerial: imei,
        category: 'PHONE_NEW',
        costPrice: 6000,
        branchId,
      } as never);
    } catch (err) {
      dupErr = err;
    }
    expect(dupErr, 'รับ IMEI เดิมเข้าสต็อกซ้ำได้ทั้งที่เครื่องเดิมยังอยู่ในสัญญา').toBeDefined();
    expect((dupErr as { code?: string }).code).toBe('P2002');
    expect(await prisma.product.count({ where: { imeiSerial: imei, deletedAt: null } })).toBe(1);

    // (4) ปลายทางของห่วงโซ่: ขายเครื่องที่ยังผ่อนอยู่ไม่ได้
    await expect(posCashSale(customer.id, product.id, 9900)).rejects.toThrow(POS_GUARD_MSG);

    const after = await prisma.product.findUniqueOrThrow({ where: { id: product.id } });
    expect(after.deletedAt).toBeNull();
    expect(after.imeiSerial).toBe(imei);
    expect(after.status).toBe('SOLD_INSTALLMENT');
  }, 180_000);

  // -------------------------------------------------------------------------
  it('เปลี่ยนเครื่อง (MEMO): เครื่องเก่า → REFURBISHED, กดปุ่มนำเข้าคลัง (ยืนยันราคา) → IN_STOCK, ขาย POS ได้', async () => {
    // MEMO = รุ่นเดิม + ราคาเดิม ⇒ brand/model/storage ต้องตรงกัน และราคาเครื่องใหม่
    // ต้องเท่ากับ sellingPrice ของสัญญาเดิม (12,000)
    const sameModel = { brand: `${PREFIX}Brand`, model: `${PREFIX}Model-D`, storage: '128GB' };
    const oldProduct = await seedProduct('D1', {
      ...sameModel,
      cashPrice: '15900.00',
      installmentPrice: '12000.00',
    });
    const newProduct = await seedProduct('D2', { ...sameModel, installmentPrice: '12000.00' });
    const customer = await seedCustomer('D1');
    const buyer = await seedCustomer('D2');
    const contract = await seedSignedDraftContract('D1', customer.id, oldProduct.id);

    // เครื่องเก่าเข้าสถานะ SOLD_INSTALLMENT ผ่าน flow จริง
    await workflow.activate(contract.id);

    // --- ส่งคำขอ + อนุมัติเปลี่ยนเครื่อง (MEMO: ไม่มี JE)
    const request = (await exchangeService.submit(
      {
        oldContractId: contract.id,
        oldProductId: oldProduct.id,
        newProductId: newProduct.id,
        conditionNote: 'จอเสีย',
      } as never,
      OWNER_USER() as never,
    )) as { id: string; mode: string };
    createdRequestIds.push(request.id);
    expect(request.mode).toBe('MEMO');

    await exchangeService.approve(
      request.id,
      OWNER_USER() as never,
      { memoAddendumSigned: true, memoMdmSwapped: true } as never,
    );

    const oldAfterSwap = await prisma.product.findUniqueOrThrow({ where: { id: oldProduct.id } });
    expect(oldAfterSwap.status).toBe('REFURBISHED');
    expect(oldAfterSwap.ownedByCompanyId).toBe(shopCompanyId);
    const newAfterSwap = await prisma.product.findUniqueOrThrow({ where: { id: newProduct.id } });
    expect(newAfterSwap.status).toBe('SOLD_INSTALLMENT');
    expect(
      (await prisma.contract.findUniqueOrThrow({ where: { id: contract.id } })).productId,
    ).toBe(newProduct.id);

    // --- REFURBISHED ยังขายที่ POS ไม่ได้ (ต้องผ่านจังหวะตรวจสภาพ/ยืนยันราคาก่อน)
    await expect(posCashSale(buyer.id, oldProduct.id, 8900)).rejects.toThrow(POS_GUARD_MSG);

    // --- ยืนยันราคาไม่ครบ (ราคาผ่อนเก่า 12,000 ยังค้าง) → ถูกปฏิเสธ
    await expect(
      productsService.returnToStock(oldProduct.id, adminId, { cashPrice: 8900 }),
    ).rejects.toThrow(/ยืนยัน/);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: oldProduct.id } })).status).toBe(
      'REFURBISHED',
    );

    // --- ยืนยันครบทุกช่องที่มีราคาเก่าค้าง → เข้าคลัง
    await productsService.returnToStock(oldProduct.id, adminId, {
      cashPrice: 8900,
      installmentPrice: 10900,
      note: 'ตรวจสภาพแล้ว เกรด B',
    });

    const restocked = await prisma.product.findUniqueOrThrow({ where: { id: oldProduct.id } });
    expect(restocked.status).toBe('IN_STOCK');
    expect(restocked.cashPrice?.toString()).toBe('8900');
    expect(restocked.installmentPrice?.toString()).toBe('10900');
    expect(restocked.stockInDate).not.toBeNull();

    const auditRow = await prisma.auditLog.findFirst({
      where: {
        entity: 'product',
        entityId: oldProduct.id,
        action: 'PRODUCT_RETURNED_TO_STOCK',
      },
      orderBy: { createdAt: 'desc' },
    });
    expect(auditRow, 'ต้องมี AuditLog ว่าใครยืนยันราคาเท่าไรตอนนำเข้าคลัง').toBeTruthy();
    expect((auditRow?.newValue as { via?: string })?.via).toBe('BUTTON');

    // --- ขายที่ POS ได้แล้ว
    const sale = await posCashSale(buyer.id, oldProduct.id, 8900);
    expect(sale.id).toBeTruthy();
    expect((await prisma.product.findUniqueOrThrow({ where: { id: oldProduct.id } })).status).toBe(
      'SOLD_CASH',
    );
  }, 180_000);

  // -------------------------------------------------------------------------
  it('ยึดเครื่อง: SOLD_INSTALLMENT → REPOSSESSED → พร้อมขาย (สองราคา) → รอถ่ายรูป → ครบ 6 มุมเข้าคลัง → ขายที่ POS → SOLD_CASH (รายการยึดปิดเอง)', async () => {
    const product = await seedProduct('E1');
    const customer = await seedCustomer('E1');
    const buyer = await seedCustomer('E2');
    const contract = await seedSignedDraftContract('E1', customer.id, product.id);
    await workflow.activate(contract.id);
    await seedPendingPayments(contract.id, 12);
    const inventoryBefore = await accountNet('S11-2002');

    // ขั้นตอนบอกเลิกสัญญา (หนังสือ CONTRACT_TERMINATION_60D + dispatch) อยู่นอก
    // state diagram ของ "เครื่อง" — seed สถานะสัญญาตรง ๆ เพราะ SystemConfig
    // `jp5_require_terminated_status = true` บังคับให้ต้อง TERMINATED ก่อนยึด
    await prisma.contract.update({ where: { id: contract.id }, data: { status: 'TERMINATED' } });

    const { repossession } = await repossessViaCreateInTx(
      contract.id,
      product.id,
      customer.id,
      7000,
    );

    const afterRepo = await prisma.product.findUniqueOrThrow({ where: { id: product.id } });
    expect(afterRepo.status).toBe('REPOSSESSED');
    expect((await prisma.contract.findUniqueOrThrow({ where: { id: contract.id } })).status).toBe(
      'CLOSED_BAD_DEBT',
    );

    // เครื่องยึดยังอยู่ในมือกิจการ — ลบไม่ได้ (Task 1 ชั้นสถานะ)
    await expect(productsService.remove(product.id)).rejects.toThrow(DELETE_GUARD_MSG);

    // "พร้อมขาย" (2026-09-07 เหมือนรับซื้อมือสอง): ตั้งสองราคา → เครื่องเข้าคิวรอถ่ายรูป
    // ไม่ใช่ REFURBISHED + ปุ่มนำเข้าคลังอีกต่อไป
    await expect(
      repossessionsService.update(
        repossession.id,
        { status: 'READY_FOR_SALE', resellPrice: 8900 } as never,
        OWNER_USER() as never,
      ),
    ).rejects.toThrow(/พร้อมขาย/);
    await repossessionsService.markReadyForSale(
      repossession.id,
      { resellPrice: 8900, installmentPrice: 10900 },
      OWNER_USER() as never,
    );
    const refurbished = await prisma.product.findUniqueOrThrow({ where: { id: product.id } });
    expect(refurbished.status).toBe('PHOTO_PENDING');
    expect(refurbished.cashPrice?.toString()).toBe('8900');
    expect(refurbished.installmentPrice?.toString()).toBe('10900');

    // ยังไม่ใช่ของในคลัง — POS ขายไม่ได้ จนกว่ารูป 6 มุมจะครบ
    await expect(posCashSale(buyer.id, product.id, 8900)).rejects.toThrow(POS_GUARD_MSG);

    // 2026-09-05: "ขายแล้ว" ตั้งด้วยมือไม่ได้อีกต่อไป — ขายเครื่องยึดผ่าน POS ทางเดียว
    await expect(
      repossessionsService.update(
        repossession.id,
        { status: 'SOLD', resellPrice: 8900 } as never,
        OWNER_USER() as never,
      ),
    ).rejects.toThrow(/POS/);

    // ขาคู่ SHOP ตอนยึด: กรรมสิทธิ์กลับ SHOP + มือถือกลายเป็นมือสอง + ใบรับเข้าสต็อก
    // (ค้างจ่าย FINANCE เสมอ → Dr S11-2002 / Cr S21-1104 typed DEVICE_RETURN)
    const shopCompany = await prisma.companyInfo.findFirstOrThrow({
      where: { companyCode: 'SHOP', deletedAt: null },
    });
    expect(refurbished.ownedByCompanyId).toBe(shopCompany.id);
    expect(refurbished.category).toBe('PHONE_USED');
    const intake = await prisma.journalEntry.findFirst({
      where: {
        AND: [
          { metadata: { path: ['flow'], equals: 'shop-repossession-intake' } } as never,
          { metadata: { path: ['contractId'], equals: contract.id } } as never,
        ],
        deletedAt: null,
      },
      include: { lines: true },
    });
    expect(intake?.status).toBe('POSTED');
    expect(intake?.companyId).toBe(shopCompany.id);
    expect(
      intake!.lines.map((l) => [l.accountCode, l.debit.toFixed(2), l.credit.toFixed(2)]),
    ).toEqual([
      ['S11-2002', '7000.00', '0.00'],
      ['S21-1104', '0.00', '7000.00'],
    ]);
    expect((intake!.metadata as Record<string, unknown>).shopReceivableType).toBe('DEVICE_RETURN');
    expect((await accountNet('S11-2002')).minus(inventoryBefore).toFixed(2)).toBe('7000.00');

    // ถ่ายรูปครบ 6 มุมที่คิว → ยืนยันรูป → เข้าคลังเอง (ราคาตั้งแล้วตั้งแต่กดพร้อมขาย)
    for (const angle of ['front', 'back', 'left', 'right', 'top', 'bottom']) {
      await productPhotosService.uploadPhoto(
        product.id,
        angle,
        `data:image/jpeg;base64,${angle}`,
        adminId,
      );
    }
    const completed = await productPhotosService.completePhotos(product.id, adminId);
    expect(completed.enteredStock).toBe(true);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: product.id } })).status).toBe(
      'IN_STOCK',
    );

    // ขายที่ POS → รายการยึดถูกปิดเป็น SOLD พร้อมราคาขายจริงโดยอัตโนมัติ
    const sale = await posCashSale(buyer.id, product.id, 8900);
    expect(sale.id).toBeTruthy();
    const sold = await prisma.product.findUniqueOrThrow({ where: { id: product.id } });
    expect(sold.status).toBe('SOLD_CASH');
    const closedRepo = await prisma.repossession.findUniqueOrThrow({
      where: { id: repossession.id },
    });
    expect(closedRepo.status).toBe('SOLD');
    expect(closedRepo.resellPrice?.toString()).toBe('8900');
    // สต็อกมือสองกลับเป็นศูนย์: ใบรับเข้า +7,000 (ราคาประเมิน) ↔ COGS ตอนขาย −7,000 (costPrice = ราคาประเมิน)
    expect((await accountNet('S11-2002')).minus(inventoryBefore).toFixed(2)).toBe('0.00');
  }, 180_000);

  it('ยึดเครื่อง: สัญญาที่ไม่มียอดค้าง → ปฏิเสธ (ผ่อนครบ = เครื่องเป็นของลูกค้า) และไม่แตะสถานะเครื่อง', async () => {
    const product = await seedProduct('E3');
    const customer = await seedCustomer('E3');
    const contract = await seedSignedDraftContract('E3', customer.id, product.id);
    await workflow.activate(contract.id);
    // This fixture represents a fully paid loan, so the real schedule must carry no unpaid debt.
    for (const payment of await prisma.payment.findMany({ where: { contractId: contract.id } })) {
      await prisma.payment.update({
        where: { id: payment.id },
        data: { status: 'PAID', amountPaid: payment.amountDue, paidDate: new Date() },
      });
    }
    await prisma.contract.update({ where: { id: contract.id }, data: { status: 'TERMINATED' } });

    await expect(
      repossessViaCreateInTx(contract.id, product.id, customer.id, 7000),
    ).rejects.toThrow(/ไม่มียอดค้างชำระ/);

    const untouched = await prisma.product.findUniqueOrThrow({ where: { id: product.id } });
    expect(untouched.status).toBe('SOLD_INSTALLMENT');
    expect(await prisma.repossession.findFirst({ where: { productId: product.id } })).toBeNull();
  }, 180_000);

  // -------------------------------------------------------------------------
  // Final review I-1 — รูข้าม task: Task 3 (ปุ่มนำเข้าคลัง) + คำตัดสินเจ้าของ 2026-07-31
  // (ยกเลิก swap ได้ทุกเมื่อ) ต่อกันเป็นเส้นทางเดินได้จริงไปสู่ "เครื่องเดียวสองเจ้าของ"
  // -------------------------------------------------------------------------
  it('ยกเลิกเปลี่ยนเครื่อง (MEMO) หลังเครื่องเก่าถูกขายที่ POS ไปแล้ว → ถูกปฏิเสธ (ไม่ชุบชีวิตสัญญาบนเครื่องของคนอื่น)', async () => {
    const sameModel = { brand: `${PREFIX}Brand`, model: `${PREFIX}Model-F`, storage: '128GB' };
    const oldProduct = await seedProduct('F1', {
      ...sameModel,
      cashPrice: '15900.00',
      installmentPrice: '12000.00',
    });
    const newProduct = await seedProduct('F2', { ...sameModel, installmentPrice: '12000.00' });
    const customer = await seedCustomer('F1');
    const buyer = await seedCustomer('F2');
    const contract = await seedSignedDraftContract('F1', customer.id, oldProduct.id);
    await workflow.activate(contract.id);

    const request = (await exchangeService.submit(
      {
        oldContractId: contract.id,
        oldProductId: oldProduct.id,
        newProductId: newProduct.id,
        conditionNote: 'จอเสีย',
      } as never,
      OWNER_USER() as never,
    )) as { id: string; mode: string };
    createdRequestIds.push(request.id);
    expect(request.mode).toBe('MEMO');

    await exchangeService.approve(
      request.id,
      OWNER_USER() as never,
      { memoAddendumSigned: true, memoMdmSwapped: true } as never,
    );

    // เส้นทางของ Task 3: เครื่องเก่า REFURBISHED → ยืนยันราคา → IN_STOCK → ขายที่ POS
    await productsService.returnToStock(oldProduct.id, adminId, {
      cashPrice: 8900,
      installmentPrice: 10900,
      note: 'ตรวจสภาพแล้ว เกรด B',
    });
    const sale = await posCashSale(buyer.id, oldProduct.id, 8900);
    expect(sale.id).toBeTruthy();
    expect((await prisma.product.findUniqueOrThrow({ where: { id: oldProduct.id } })).status).toBe(
      'SOLD_CASH',
    );

    // ยกเลิก swap ตอนนี้ = เอาสัญญาของลูกค้า A กลับมาเดินบนเครื่องที่ลูกค้า B ซื้อไปแล้ว
    await expect(
      exchangeCancelService.cancel(request.id, 'ลูกค้าขอเครื่องเดิมคืน', OWNER_USER()),
    ).rejects.toThrow(RESTORE_GUARD_MSG);

    // ไม่มีอะไรถูกแตะเลย — สัญญายังชี้เครื่องใหม่, เครื่องเก่ายังเป็นของลูกค้า B,
    // คำขอยังอยู่สถานะ APPROVED (ไม่ถูก mark CANCELED ครึ่งทาง)
    expect(
      (await prisma.contract.findUniqueOrThrow({ where: { id: contract.id } })).productId,
    ).toBe(newProduct.id);
    const oldAfter = await prisma.product.findUniqueOrThrow({ where: { id: oldProduct.id } });
    expect(oldAfter.status).toBe('SOLD_CASH');
    expect((await prisma.product.findUniqueOrThrow({ where: { id: newProduct.id } })).status).toBe(
      'SOLD_INSTALLMENT',
    );
    const reqAfter = await prisma.contractExchangeRequest.findUniqueOrThrow({
      where: { id: request.id },
    });
    expect(reqAfter.status).toBe('APPROVED');
    expect(reqAfter.canceledAt).toBeNull();
  }, 180_000);
});
