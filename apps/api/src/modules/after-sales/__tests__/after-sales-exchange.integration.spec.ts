import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { PrismaClient, Prisma } from '@prisma/client';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Readable } from 'stream';

import { AuditService } from '../../audit/audit.service';
import { CompanyResolverService } from '../../journal/company-resolver.service';
import { JournalAutoService } from '../../journal/journal-auto.service';
import { ExchangeNewContract1ATemplate } from '../../journal/cpa-templates/exchange-new-contract-1a.template';
import { ExchangeCloseOld21_1106Template } from '../../journal/cpa-templates/exchange-close-old-21-1106.template';
import { ExchangeBuybackReceivable11_2107Template } from '../../journal/cpa-templates/exchange-buyback-receivable-11-2107.template';
import { ShopExchangeReturnTemplate } from '../../journal/cpa-templates/shop-exchange-return.template';
import { ExchangeEclReversalTemplate } from '../../journal/cpa-templates/exchange-ecl-reversal.template';
import { ExchangeCancelReversalTemplate } from '../../journal/cpa-templates/exchange-cancel-reversal.template';
import { ShopInventoryTransferTemplate } from '../../journal/cpa-templates/shop-inventory-transfer.template';
import { ShopAccountResolver } from '../../journal/shop-account-resolver.service';
import { ContractExchangeService } from '../../contract-exchange/contract-exchange.service';
import { ExchangeCancelService } from '../../contract-exchange/contract-exchange-cancel.service';
import { DefectExchangeService } from '../../defect-exchange/defect-exchange.service';
import { DefectExchangeReversalTemplate } from '../../journal/cpa-templates/defect-exchange-reversal.template';
import { RepairTicketsService } from '../../repair-tickets/repair-tickets.service';
import { RepairTicketDocNumberService } from '../../repair-tickets/services/doc-number.service';
import { ExpenseDocumentsService } from '../../expense-documents/expense-documents.service';
import { ExpenseDocumentCreateService } from '../../expense-documents/services/expense-document-create.service';
import { LineAggregatorService } from '../../expense-documents/services/line-aggregator.service';
import { DocNumberService as ExpenseDocNumberService } from '../../expense-documents/services/doc-number.service';
import { SettingsService } from '../../settings/settings.service';
import { SettingsFlagsService } from '../../settings/services/settings-flags.service';
import { seedStatementReview } from '../../contracts/__tests__/credit-approval.fixture';

import { AfterSalesLookupService } from '../services/after-sales-lookup.service';
import { AfterSalesCaseService } from '../services/after-sales-case.service';
import { AfterSalesQueryService } from '../services/after-sales-query.service';
import { AfterSalesRepairService } from '../services/after-sales-repair.service';
import { AfterSalesExchangeService } from '../services/after-sales-exchange.service';
import { AfterSalesLineService } from '../services/after-sales-line.service';
import { AfterSalesDocNumberService } from '../services/after-sales-doc-number.service';
import { AfterSalesService } from '../after-sales.service';

/**
 * after-sales — เปลี่ยนเครื่อง (SAME_MODEL_EXCHANGE / PRICED_EXCHANGE) บน DB จริง (Task 8, PR2).
 *
 * Wiring instance จริงด้วย `new` (ไม่ผ่าน Nest DI) — pattern เดียวกับ after-sales-flow.integration.spec.ts
 * (Task 7) และ exchange-priced-flow.integration.spec.ts (contract-exchange). ContractExchangeService /
 * ExchangeCancelService / DefectExchangeService เป็นของจริงทั้งชุด (รวม CPA templates ที่พวกมันฉีดเข้าไป)
 * เพราะทุกเคสของไฟล์นี้ไม่โพสต์ JE จริงเลย (เคส 9: MEMO approve/cancel ไม่มี JE ตาม engine): MEMO submit() คืนคำขอ PENDING ทันทีไม่แตะ GL,
 * PRICED submit() ที่ล้มเหลว (เคส 6) โยนก่อนจะแตะ GL/ผลิตภัณฑ์ใดๆ, และ confirmSameModel (เคส 4) เดินผ่าน
 * DefectExchangeService.execute() ซึ่งเรียก DefectExchangeReversalTemplate.reverseContract() ที่เป็น
 * no-op เมื่อสัญญาเดิมไม่มี JE ที่โพสต์แล้ว (เราสร้างสัญญาเดิมตรงด้วย prisma ไม่ผ่าน activate() จริง) —
 * จึง**ไม่ต้อง** seedFinanceCoa/seedShopCoa เหมือน exchange-priced-flow.integration.spec.ts.
 *
 * Runner (vitest — jest ignore `*.integration.spec.ts`):
 *   cd apps/api && DATABASE_URL=postgresql://iamnaii@localhost:5432/after_sales_pr1_test?schema=public \
 *     npx vitest run --no-file-parallelism src/modules/after-sales/__tests__/after-sales-exchange.integration.spec.ts
 *
 * CI: glob AFTERSALES_FILES ใน .github/workflows/deploy-gcp.yml (`src/modules/after-sales/__tests__/*.integration.spec.ts`
 * — ไม่ recurse เข้า subdirectory จึงไฟล์นี้ต้องอยู่ตรงนี้ ไม่ใช่โฟลเดอร์ย่อย).
 *
 * Cleanup: SCOPED ตาม id ที่สเปคนี้สร้างเท่านั้น (afterAll ลบลูกก่อนแม่) — audit_logs ลบไม่ได้
 * (DB trigger immutable ตามดีไซน์ — precedent เดียวกับทุก integration spec อื่นในโปรเจกต์).
 */

const prisma = new PrismaClient();

// ---------------------------------------------------------------------------
// Service wiring — real dependency chain (ไม่มี mock ยกเว้น StorageService/ProductPhotosService
// ที่เป็นตัวปลอมในหน่วยความจำตาม precedent ของ after-sales-flow.integration.spec.ts)
// ---------------------------------------------------------------------------
const journal = new JournalAutoService(prisma as never);
const companyResolver = new CompanyResolverService(prisma as never);
const audit = new AuditService(prisma as never);

const contractExchange = new ContractExchangeService(
  prisma as never,
  audit,
  new ExchangeNewContract1ATemplate(journal, prisma as never),
  new ExchangeCloseOld21_1106Template(journal, prisma as never),
  new ExchangeBuybackReceivable11_2107Template(journal, prisma as never),
  new ShopExchangeReturnTemplate(journal, prisma as never, companyResolver),
  new ExchangeEclReversalTemplate(journal, prisma as never),
  companyResolver,
  new ShopInventoryTransferTemplate(journal, prisma as never, companyResolver),
  new ShopAccountResolver(prisma as never),
);
const exchangeCancel = new ExchangeCancelService(
  prisma as never,
  audit,
  companyResolver,
  new ExchangeCancelReversalTemplate(journal, prisma as never),
);

const defectReversal = new DefectExchangeReversalTemplate(journal, prisma as never);

// RepairTicketsService — ห่วงโซ่จริงเดียวกับ after-sales-flow.integration.spec.ts (Task 7):
// ExpenseDocumentsService ของจริงเพื่อให้ returnToCustomer(payer=SHOP) ทำงานได้ถ้าจำเป็น (ไม่มีเคสไหน
// ในไฟล์นี้ใช้ payer=SHOP จริง แต่ต้องคง shape ของ constructor ให้ตรง)
const settingsFlags = new SettingsFlagsService(prisma as never);
const settingsSvc = new SettingsService(settingsFlags, null as never, null as never, null as never);
const expenseDocNumber = new ExpenseDocNumberService(settingsSvc);
const lineAggregator = new LineAggregatorService();
const expenseCreator = new ExpenseDocumentCreateService(
  prisma as never,
  expenseDocNumber,
  lineAggregator,
  null as never,
  null as never,
  null as never,
  null as never,
);
const expenseDocs = new ExpenseDocumentsService(
  prisma as never,
  null as never,
  null as never,
  expenseCreator,
);
const repairTicketDocNumber = new RepairTicketDocNumberService(prisma as never);
const repairTickets = new RepairTicketsService(
  prisma as never,
  audit,
  expenseDocs,
  null as never,
  null as never,
  repairTicketDocNumber,
);

const defect = new DefectExchangeService(prisma as never, journal, defectReversal, repairTickets);

// ProductPhotosService ปลอม — ไม่มีเคสไหนในไฟล์นี้ต้องใช้รูปตอนซื้อจริง
const productPhotosFake = {
  getPhotos: async () => ({
    photos: { front: null, back: null, left: null, right: null, top: null, bottom: null },
  }),
} as never;

const lookupSvc = new AfterSalesLookupService(
  prisma as never,
  repairTickets,
  defect,
  productPhotosFake,
);
const afterSalesDocNumber = new AfterSalesDocNumberService(prisma as never);

// AfterSalesLineService (Task 3, PR3) — ของจริง ต่อกับ NotificationsService/IntegrationConfigService
// ปลอมตามที่ task-3-brief.md Step 3 กำหนดเป๊ะ (ดู after-sales-flow.integration.spec.ts สำหรับ
// เหตุผลเดียวกัน)
const notificationsFakeImpl = {
  sendFromTemplate: vi.fn().mockResolvedValue({ id: 'n1', status: 'SENT' }),
};
const notificationsFake = notificationsFakeImpl as never;
const integrationConfigFake = { getValue: async () => 'liff-test' } as never;
const line = new AfterSalesLineService(prisma as never, notificationsFake, integrationConfigFake);

// StorageService ปลอมในหน่วยความจำ (Map) — เหมือน after-sales-flow.integration.spec.ts
const files = new Map<string, Buffer>();
const storage = {
  upload: async (k: string, b: Buffer) => {
    files.set(k, b);
    return k;
  },
  delete: async (k: string) => {
    files.delete(k);
  },
  getStream: async (k: string) => Readable.from(files.get(k)!),
} as never;

const caseSvc = new AfterSalesCaseService(
  prisma as never,
  storage,
  audit,
  repairTickets,
  afterSalesDocNumber,
  lookupSvc,
  contractExchange,
  defect,
  line,
);
const querySvc = new AfterSalesQueryService(prisma as never);
const repairSvc = new AfterSalesRepairService(
  prisma as never,
  storage,
  repairTickets,
  querySvc,
  audit,
  line,
);
const exchangeSvc = new AfterSalesExchangeService(
  prisma as never,
  querySvc,
  defect,
  repairTickets,
  audit,
  contractExchange,
  exchangeCancel,
  lookupSvc,
  line,
);

// Facade จริง (Task 8) — เรียกผ่านนี้เพื่อพิสูจน์การ delegate ของ facade เองด้วย เหมือนที่
// after-sales-flow.integration.spec.ts ทำกับ REPAIR (fix round 1 minor note)
const svc = new AfterSalesService(lookupSvc, caseSvc, querySvc, repairSvc, exchangeSvc);

// ---------------------------------------------------------------------------
// Fixtures / run markers
// ---------------------------------------------------------------------------
const RUN = Date.now().toString(36).toUpperCase();
const RUN_NUM = String(Date.now() % 1_000_000).padStart(6, '0');
const PREFIX = 'AFEXCHTEST-';

let adminId: string;
let salesUserId: string;
let bmUserId: string;
let branchId: string;
let supplierId: string;

const OWNER = () => ({ id: adminId, role: 'OWNER', branchId: null as string | null });
const SALES_USER = () => ({ id: salesUserId, role: 'SALES', branchId });
const BM_USER = () => ({ id: bmUserId, role: 'BRANCH_MANAGER', branchId });

// ---------------------------------------------------------------------------
// Tracked rows for SCOPED cleanup (ลูกก่อนแม่ใน afterAll)
// ---------------------------------------------------------------------------
const createdCaseIds: string[] = [];
const createdRepairTicketIds: string[] = [];
const createdRequestIds: string[] = [];
const createdContractIds: string[] = [];
const createdSaleIds: string[] = [];
const createdProductIds: string[] = [];
const createdCustomerIds: string[] = [];

function fakeJpeg(name: string): Express.Multer.File {
  const buf = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]);
  return {
    fieldname: 'photos',
    originalname: name,
    encoding: '7bit',
    mimetype: 'image/jpeg',
    size: buf.length,
    buffer: buf,
    stream: undefined as never,
    destination: '',
    filename: name,
    path: '',
  } as Express.Multer.File;
}

/**
 * สัญญาผ่อน ACTIVE + ใบขาย INSTALLMENT ที่ผูกกัน — `AfterSalesLookupService.lookup()` หา "สัญญา"
 * ผ่าน `Sale.contract` (ไม่ใช่ query `Contract.productId` ตรงๆ) จึงต้องมีทั้งคู่เสมอ (ยืนยันจาก
 * `RepairWarrantyService.lookupByImei`). ไม่มี Payment ใดๆ ถูกสร้าง (บรีฟข้อ 1: "ไม่มี Payment PAID").
 */
async function seedInstallmentFixture(opts: {
  tag: string;
  daysAgoReceived: number;
  tradeInCreditSnapshot?: Prisma.InputJsonValue;
  sellingPrice?: string;
  brand?: string;
  model?: string;
  storage?: string;
}) {
  const brand = opts.brand ?? `${PREFIX}Brand`;
  const model = opts.model ?? `${PREFIX}Model-${opts.tag}`;
  const storage = opts.storage ?? '128GB';
  const sellingPrice = opts.sellingPrice ?? '10000.00';

  const customer = await prisma.customer.create({
    data: {
      name: `${PREFIX}Customer-${opts.tag}-${RUN}`,
      phone: `098${RUN_NUM}`.slice(0, 9) + opts.tag.slice(0, 3),
    },
  });
  createdCustomerIds.push(customer.id);

  const oldProduct = await prisma.product.create({
    data: {
      name: `${PREFIX}OldPhone-${opts.tag}`,
      brand,
      model,
      storage,
      imeiSerial: `${PREFIX}${RUN}-${opts.tag}-OLD`,
      category: 'PHONE_USED',
      costPrice: new Prisma.Decimal('5000.00'),
      branchId,
      status: 'SOLD_INSTALLMENT',
    },
  });
  createdProductIds.push(oldProduct.id);

  const deviceReceivedAt = new Date(Date.now() - opts.daysAgoReceived * 86_400_000);

  const contract = await prisma.contract.create({
    data: {
      contractNumber: `${PREFIX}${RUN}-${opts.tag}`,
      customerId: customer.id,
      productId: oldProduct.id,
      branchId,
      salespersonId: adminId,
      planType: 'STORE_WITH_INTEREST',
      sellingPrice: new Prisma.Decimal(sellingPrice),
      downPayment: new Prisma.Decimal('0.00'),
      financedAmount: new Prisma.Decimal(sellingPrice),
      interestRate: new Prisma.Decimal('0.0500'),
      totalMonths: 10,
      interestTotal: new Prisma.Decimal('1000.00'),
      storeCommission: new Prisma.Decimal('500.00'),
      vatAmount: new Prisma.Decimal('700.00'),
      vatPct: new Prisma.Decimal('0.0700'),
      monthlyPayment: new Prisma.Decimal('1100.00'),
      status: 'ACTIVE',
      deviceReceivedAt,
      ...(opts.tradeInCreditSnapshot !== undefined
        ? { tradeInCreditSnapshot: opts.tradeInCreditSnapshot }
        : {}),
    },
  });
  createdContractIds.push(contract.id);

  const sale = await prisma.sale.create({
    data: {
      saleNumber: `${PREFIX}${RUN}-${opts.tag}-SL`,
      saleType: 'INSTALLMENT',
      customerId: customer.id,
      productId: oldProduct.id,
      branchId,
      salespersonId: adminId,
      sellingPrice: new Prisma.Decimal(sellingPrice),
      netAmount: new Prisma.Decimal(sellingPrice),
      contractId: contract.id,
    },
  });
  createdSaleIds.push(sale.id);

  return {
    customerId: customer.id,
    oldProductId: oldProduct.id,
    oldContractId: contract.id,
    saleId: sale.id,
    brand,
    model,
    storage,
    imei: oldProduct.imeiSerial as string,
  };
}

async function seedReplacementProduct(
  tag: string,
  opts: { brand: string; model: string; storage: string; installmentPrice?: string },
) {
  const p = await prisma.product.create({
    data: {
      name: `${PREFIX}NewPhone-${tag}`,
      brand: opts.brand,
      model: opts.model,
      storage: opts.storage,
      imeiSerial: `${PREFIX}${RUN}-${tag}-NEW`,
      category: 'PHONE_USED',
      costPrice: new Prisma.Decimal('6000.00'),
      installmentPrice: new Prisma.Decimal(opts.installmentPrice ?? '9000.00'),
      branchId,
      status: 'IN_STOCK',
    },
  });
  createdProductIds.push(p.id);
  return p;
}

describe('after-sales exchange — DB จริง (Task 8, PR2)', () => {
  beforeAll(async () => {
    const shop = await prisma.companyInfo.findFirstOrThrow({
      where: { companyCode: 'SHOP', deletedAt: null },
    });

    let admin = await prisma.user.findFirst({ where: { email: 'admin@bestchoice.com' } });
    if (!admin) {
      admin = await prisma.user.create({
        data: { email: 'admin@bestchoice.com', password: 'x', name: 'admin', role: 'OWNER' },
      });
    }
    adminId = admin.id;

    const branchName = '__after_sales_exchange_test_branch__';
    const existingBranch = await prisma.branch.findFirst({
      where: { name: branchName, deletedAt: null },
    });
    if (existingBranch) {
      branchId = existingBranch.id;
    } else {
      const created = await prisma.branch.create({
        data: { name: branchName, companyId: shop.id },
      });
      branchId = created.id;
    }

    const salesUser = await prisma.user.create({
      data: {
        email: `${PREFIX.toLowerCase()}sales-${RUN}@test.local`,
        password: 'x',
        name: 'after-sales-exchange-test-sales',
        role: 'SALES',
        branchId,
      },
    });
    salesUserId = salesUser.id;

    const bmUser = await prisma.user.create({
      data: {
        email: `${PREFIX.toLowerCase()}bm-${RUN}@test.local`,
        password: 'x',
        name: 'after-sales-exchange-test-bm',
        role: 'BRANCH_MANAGER',
        branchId,
      },
    });
    bmUserId = bmUser.id;

    const supplier = await prisma.supplier.create({
      data: {
        name: `${PREFIX}RepairCenter-${RUN}`,
        phone: `02${RUN_NUM}`.slice(0, 10),
        isRepairCenter: true,
      },
    });
    supplierId = supplier.id;
  }, 120_000);

  afterAll(async () => {
    try {
      if (createdCaseIds.length) {
        await prisma.afterSalesEvent.deleteMany({ where: { caseId: { in: createdCaseIds } } });
        await prisma.afterSalesCase.deleteMany({ where: { id: { in: createdCaseIds } } });
      }
      if (createdRepairTicketIds.length) {
        await prisma.repairStatusLog.deleteMany({
          where: { ticketId: { in: createdRepairTicketIds } },
        });
        await prisma.repairTicket.deleteMany({ where: { id: { in: createdRepairTicketIds } } });
      }
      if (createdRequestIds.length) {
        await prisma.contractExchangeRequest.deleteMany({
          where: { id: { in: createdRequestIds } },
        });
      }
      if (createdCustomerIds.length) {
        // seedStatementReview() creates an unbound CreditCheck per customer that needs
        // bindExchangeCreditCheck — must go before Contract (CreditCheck.contractId → Contract FK).
        await prisma.creditCheck.deleteMany({
          where: { customerId: { in: createdCustomerIds } },
        });
      }
      if (createdSaleIds.length) {
        await prisma.sale.deleteMany({ where: { id: { in: createdSaleIds } } });
      }
      if (createdContractIds.length) {
        await prisma.contract.deleteMany({ where: { id: { in: createdContractIds } } });
      }
      if (createdProductIds.length) {
        await prisma.product.deleteMany({ where: { id: { in: createdProductIds } } });
      }
      if (createdCustomerIds.length) {
        await prisma.customer.deleteMany({ where: { id: { in: createdCustomerIds } } });
      }
      if (supplierId) {
        await prisma.supplier.deleteMany({ where: { id: supplierId } });
      }
      // salesUser/bmUser/branch/admin: ปล่อยไว้เสมอ (ไม่ลบ) — ทั้งสองคนเป็น actor ของ AuditLog
      // ที่สร้างระหว่างเทสต์ (AFTER_SALES_CASE_CREATED, AFTER_SALES_EXCHANGE_CONFIRMED, ฯลฯ) และ
      // `audit_logs.user_id` เป็น FK ที่ไม่มี CASCADE (audit เป็น immutable trail) ⇒ ลบ user ที่เคย
      // เป็น actor ไม่ได้เลยตราบใดที่ยังมี audit log อ้างถึง — พิสูจน์จริงบน DB (ลองแล้วชน
      // `audit_logs_user_id_fkey`). Branch ที่ผูกกับ user เหล่านี้ (`branchId`) จึงลบไม่ได้ตามไปด้วย
      // — pattern เดียวกับ `journey-state.activity.db.spec.ts` ที่ไม่เคยลบ actor user ของตัวเอง
      // เช่นกัน. รันซ้ำครั้งถัดไปจะพบ branch เดิม (ค้นด้วยชื่อคงที่) และสร้าง sales/bm user ใหม่
      // ตาม RUN tag — เศษที่เหลือคือแถว `users` ไม่กี่แถวต่อรัน (ไม่มี PII จริง, ไม่มีข้อมูลธุรกิจ)
      // บนฐานทดสอบทิ้งเท่านั้น — branch เองถูกสร้างครั้งเดียวแล้วใช้ซ้ำตลอด (ค้นด้วยชื่อคงที่)
    } finally {
      await prisma.$disconnect();
    }
  }, 120_000);

  // -------------------------------------------------------------------------
  // Main scenario (เคส 1-5 ของบรีฟ) — SAME_MODEL_EXCHANGE ครบวงจร
  // -------------------------------------------------------------------------
  let mainCustomerId: string;
  let mainOldContractId: string;
  let mainOldProductId: string;
  let mainNewProductId: string;
  let mainImei: string;
  let mainCaseId: string;
  let mainNewContractId: string;

  it('1) seed: ลูกค้า/สาขา/เครื่องเดิม PHONE_USED SOLD_INSTALLMENT/สัญญา ACTIVE ในกรอบ 7 วัน/เครื่องทดแทน IN_STOCK', async () => {
    const fx = await seedInstallmentFixture({ tag: 'MAIN', daysAgoReceived: 2 });
    mainCustomerId = fx.customerId;
    mainOldContractId = fx.oldContractId;
    mainOldProductId = fx.oldProductId;
    mainImei = fx.imei;

    const np = await seedReplacementProduct('MAIN', {
      brand: fx.brand,
      model: fx.model,
      storage: fx.storage,
    });
    mainNewProductId = np.id;

    // credit check ที่ยังไม่ผูกสัญญาไหน — DefectExchangeService.execute() (ผ่าน confirmSameModel
    // ในเคส 4) เรียก bindExchangeCreditCheck ซึ่งต้องการแถวนี้ ไม่งั้นโยน 400 ก่อนถึงจุดที่เทสต์
    await seedStatementReview(prisma, mainCustomerId);

    const contract = await prisma.contract.findUniqueOrThrow({ where: { id: mainOldContractId } });
    expect(contract.status).toBe('ACTIVE');
    const oldProduct = await prisma.product.findUniqueOrThrow({ where: { id: mainOldProductId } });
    expect(oldProduct.status).toBe('SOLD_INSTALLMENT');
    const newProduct = await prisma.product.findUniqueOrThrow({ where: { id: mainNewProductId } });
    expect(newProduct.status).toBe('IN_STOCK');
    const paidCount = await prisma.payment.count({ where: { contractId: mainOldContractId } });
    expect(paidCount).toBe(0);
  });

  it('2) createCase(outcome SAME_MODEL_EXCHANGE) โดย SALES → เคส AWAITING_APPROVAL ไม่มี ticket · list tab AWAITING_APPROVAL เห็นแถว exchange.kind=SAME_MODEL', async () => {
    const result = await svc.createCase(
      {
        imei: mainImei,
        symptom: 'จอมีเส้นแนวตั้ง — ทดสอบเปลี่ยนรุ่นเดิม (Task 8)',
        accessories: { box: false, charger: false, case: false },
        unlockConfirmed: true,
        outcome: 'SAME_MODEL_EXCHANGE',
        replacementProductId: mainNewProductId,
        branchId,
      } as never,
      [fakeJpeg('main-intake.jpg')],
      SALES_USER(),
    );
    mainCaseId = result.id;
    createdCaseIds.push(mainCaseId);

    expect(result.stage).toBe('AWAITING_APPROVAL');
    expect(result.repairTicketId).toBeNull();
    expect(result.outcome).toBe('SAME_MODEL_EXCHANGE');

    const listResult = await svc.list({ tab: 'AWAITING_APPROVAL' } as never, OWNER());
    const row = (listResult.data as Array<{ id: string; exchange: { kind: string } | null }>).find(
      (d) => d.id === mainCaseId,
    );
    expect(row).toBeTruthy();
    expect(row?.exchange?.kind).toBe('SAME_MODEL');
  });

  it('3) SALES เรียก confirmSameModel → ForbiddenException (Review Focus 1)', async () => {
    await expect(
      exchangeSvc.confirmSameModel(mainCaseId, {} as never, SALES_USER()),
    ).rejects.toThrow(ForbiddenException);

    const row = await prisma.afterSalesCase.findUniqueOrThrow({ where: { id: mainCaseId } });
    expect(row.stage).toBe('AWAITING_APPROVAL');
    expect(row.replacementContractId).toBeNull();
  });

  it('4) BM confirm → เคส READY_FOR_PICKUP · replacementContractId ชี้สัญญาใหม่ DRAFT · สัญญาเดิม DEFECT_EXCHANGED · เครื่องเดิม DEFECT_RETURN · เครื่องใหม่ RESERVED (engine ทำงานจริง)', async () => {
    const result = await exchangeSvc.confirmSameModel(mainCaseId, {} as never, BM_USER());
    expect(result.stage).toBe('READY_FOR_PICKUP');
    expect(result.replacementContractId).toBeTruthy();
    mainNewContractId = result.replacementContractId as string;
    createdContractIds.push(mainNewContractId);

    const newContract = await prisma.contract.findUniqueOrThrow({
      where: { id: mainNewContractId },
    });
    expect(newContract.status).toBe('DRAFT');
    expect(newContract.parentContractId).toBe(mainOldContractId);

    const oldContract = await prisma.contract.findUniqueOrThrow({
      where: { id: mainOldContractId },
    });
    expect(oldContract.status).toBe('DEFECT_EXCHANGED');

    const oldProduct = await prisma.product.findUniqueOrThrow({ where: { id: mainOldProductId } });
    expect(oldProduct.status).toBe('DEFECT_RETURN');

    const newProduct = await prisma.product.findUniqueOrThrow({ where: { id: mainNewProductId } });
    expect(newProduct.status).toBe('RESERVED');

    const caseRow = await prisma.afterSalesCase.findUniqueOrThrow({ where: { id: mainCaseId } });
    expect(caseRow.stage).toBe('READY_FOR_PICKUP');
    expect(caseRow.replacementContractId).toBe(mainNewContractId);
  });

  it('5) deliver ขณะสัญญาใหม่ยัง DRAFT → BadRequest · เปิดใช้สัญญาใหม่แล้ว deliver สำเร็จ → CLOSED + closedAt · summary.exchanges +1', async () => {
    await expect(exchangeSvc.deliver(mainCaseId, OWNER())).rejects.toThrow(BadRequestException);

    const stillOpen = await prisma.afterSalesCase.findUniqueOrThrow({ where: { id: mainCaseId } });
    expect(stillOpen.stage).toBe('READY_FOR_PICKUP');
    expect(stillOpen.closedAt).toBeNull();

    const before = await svc.list({ summary: true } as never, OWNER());
    const beforeExchanges = (before.summary as { exchanges: number }).exchanges;

    // จำลองการเปิดใช้สัญญาใหม่ที่หน้าสัญญา (ตรงตามบรีฟ — ไม่ผ่าน ContractWorkflowService.activate
    // เพราะที่นี่ทดสอบเฉพาะ deliver() ไม่ใช่การเปิดใช้สัญญาเอง)
    await prisma.contract.update({ where: { id: mainNewContractId }, data: { status: 'ACTIVE' } });

    const delivered = await exchangeSvc.deliver(mainCaseId, OWNER());
    expect(delivered.stage).toBe('CLOSED');
    expect(delivered.closedAt).not.toBeNull();

    const after = await svc.list({ summary: true } as never, OWNER());
    const afterExchanges = (after.summary as { exchanges: number }).exchanges;
    expect(afterExchanges).toBe(beforeExchanges + 1);
  });

  // -------------------------------------------------------------------------
  // เคส 6 — PRICED intake ที่ submit() ปฏิเสธ (tradeInCreditSnapshot ตั้งอยู่แล้ว) → CANCELLED +
  // IMEI เดิมเปิดเคสใหม่ได้ (Review Focus 3)
  // -------------------------------------------------------------------------
  it('6) PRICED intake: seed สัญญาที่ submit() ปฏิเสธ (tradeInCreditSnapshot) → createCase throw + เคส CANCELLED (cancelReason ขึ้นต้น "ยื่นคำขอไม่สำเร็จ") · IMEI เดิมเปิดเคสใหม่ได้', async () => {
    const fx = await seedInstallmentFixture({
      tag: 'FAIL',
      daysAgoReceived: 2,
      // ผ่านด่าน computeOutcomes ตอนแจ้งปัญหา (ไม่เช็คฟิลด์นี้เลย) แต่ ContractExchangeService.submit()
      // ปฏิเสธทันทีตั้งแต่บรรทัดแรกๆ ก่อนแตะ mode/GL ใดๆ — ตรงตามที่บรีฟแนะ (ง่ายสุดที่จะ seed)
      tradeInCreditSnapshot: { note: `เครดิตเทิร์นทดสอบ ${RUN}` },
    });
    const np = await seedReplacementProduct('FAIL', {
      brand: fx.brand,
      model: fx.model,
      storage: fx.storage,
    });

    await expect(
      svc.createCase(
        {
          imei: fx.imei,
          symptom: 'ทดสอบ PRICED ที่ submit ปฏิเสธ (Task 8 เคส 6)',
          accessories: { box: false, charger: false, case: false },
          unlockConfirmed: true,
          outcome: 'PRICED_EXCHANGE',
          replacementProductId: np.id,
          buybackPrice: '5000.00',
          deviceCondition: 'A',
          newTotalMonths: 12,
          branchId,
        } as never,
        [fakeJpeg('fail-intake.jpg')],
        OWNER(),
      ),
    ).rejects.toThrow(BadRequestException);

    const caseRow = await prisma.afterSalesCase.findFirstOrThrow({
      where: { deviceImei: fx.imei },
    });
    createdCaseIds.push(caseRow.id);
    expect(caseRow.stage).toBe('CANCELLED');
    expect(caseRow.cancelledAt).not.toBeNull();
    expect(caseRow.cancelReason ?? '').toMatch(/^ยื่นคำขอไม่สำเร็จ/);

    // Review Focus 3 — IMEI เดิมเปิดเคสใหม่ได้ (เคสเก่าถูกเขียน CANCELLED ตรงๆ ไม่ใช่ derived ⇒
    // candidates query ของ createCase เห็นว่ามันปิดแล้วโดยไม่ต้องพึ่ง reconcile)
    const reopened = await svc.createCase(
      {
        imei: fx.imei,
        symptom: 'เปิดเคสใหม่หลังคำขอเดิมล้มเหลว (Task 8 เคส 6)',
        accessories: { box: false, charger: false, case: false },
        unlockConfirmed: true,
        outcome: 'REPAIR',
        branchId,
      } as never,
      [fakeJpeg('fail-reopen.jpg')],
      OWNER(),
    );
    createdCaseIds.push(reopened.id);
    if (reopened.repairTicketId) createdRepairTicketIds.push(reopened.repairTicketId);
    expect(reopened.id).not.toBe(caseRow.id);
    expect(reopened.caseNumber).toMatch(/^AS-\d{8}-\d{4}$/);
  });

  // -------------------------------------------------------------------------
  // เคส 7 — PRICED สำเร็จ (MEMO: รุ่น/ราคาเดิม) แล้วปฏิเสธผ่าน ContractExchangeService.reject ตรงๆ
  // (endpoint เก่า) → getCase reconcile เป็น CANCELLED จาก request (Review Focus 5)
  // -------------------------------------------------------------------------
  it('7) PRICED สำเร็จ (MEMO — เครื่องทดแทนราคาเท่าเดิม) → เคส AWAITING_APPROVAL + exchangeRequestId · ContractExchangeService.reject ตรงๆ → getCase คืน CANCELLED + cancelReason = reason', async () => {
    const sellingPrice = '10000.00';
    const fx = await seedInstallmentFixture({ tag: 'MEMO', daysAgoReceived: 30, sellingPrice });
    const np = await seedReplacementProduct('MEMO', {
      brand: fx.brand,
      model: fx.model,
      storage: fx.storage,
      installmentPrice: sellingPrice, // รุ่น+ราคาเดิม ⇒ detectMode() ต้องเป็น MEMO
    });

    const result = await svc.createCase(
      {
        imei: fx.imei,
        symptom: 'ทดสอบ MEMO — เปลี่ยนรุ่นเดิมราคาเดิม (Task 8 เคส 7)',
        accessories: { box: false, charger: false, case: false },
        unlockConfirmed: true,
        outcome: 'PRICED_EXCHANGE',
        replacementProductId: np.id,
        // ไม่ส่ง buybackPrice/deviceCondition/newTotalMonths — MEMO branch ของ submit() ปฏิเสธถ้า
        // buybackPrice !== undefined
        branchId,
      } as never,
      [fakeJpeg('memo-intake.jpg')],
      OWNER(),
    );
    const memoCaseId = result.id;
    createdCaseIds.push(memoCaseId);
    expect(result.exchangeRequestId).toBeTruthy();
    const memoRequestId = result.exchangeRequestId as string;
    createdRequestIds.push(memoRequestId);

    const request = await prisma.contractExchangeRequest.findUniqueOrThrow({
      where: { id: memoRequestId },
    });
    expect(request.mode).toBe('MEMO');
    expect(request.status).toBe('PENDING');

    const beforeCase = await svc.getCase(memoCaseId, OWNER());
    expect((beforeCase as { stage: string }).stage).toBe('AWAITING_APPROVAL');

    const reason = `ลูกค้าไม่ยืนยันการเปลี่ยนเครื่อง MEMO — ทดสอบปฏิเสธตรงเอนจิน ${RUN}`;
    await contractExchange.reject(memoRequestId, reason, adminId);

    const afterCase = await svc.getCase(memoCaseId, OWNER());
    expect((afterCase as { stage: string }).stage).toBe('CANCELLED');
    expect((afterCase as { cancelReason: string | null }).cancelReason).toBe(reason);
  });

  // -------------------------------------------------------------------------
  // เคส 8 — drift in-tx guard (R25 g): ปิดใบซ่อมตรงผ่าน RepairTicketsService.returnToCustomer
  // (ไม่ผ่าน AfterSalesRepairService proxy) → case.stage ค้าง READY_FOR_PICKUP → createCase ซ้ำ
  // IMEI เดิม (ไม่เรียก lookup/getCase ก่อน) ต้อง CAS แถวเก่าเป็น CLOSED เอง + สร้างเคสใหม่สำเร็จ
  // -------------------------------------------------------------------------
  it('8) drift in-tx guard: ปิดใบซ่อมตรงผ่าน RepairTicketsService.returnToCustomer (case.stage ค้าง READY_FOR_PICKUP) → createCase ซ้ำ IMEI เดิม CAS แถวเก่าเป็น CLOSED เอง + เคสใหม่สำเร็จ', async () => {
    const imei = `${PREFIX}${RUN}-DRIFT`;
    const customer = await prisma.customer.create({
      data: { name: `${PREFIX}Customer-DRIFT-${RUN}`, phone: `099${RUN_NUM}`.slice(0, 10) + 'D' },
    });
    createdCustomerIds.push(customer.id);

    const product = await prisma.product.create({
      data: {
        name: `${PREFIX}DriftPhone`,
        brand: `${PREFIX}Brand`,
        model: `${PREFIX}Model-DRIFT`,
        storage: '64GB',
        imeiSerial: imei,
        category: 'PHONE_USED',
        costPrice: new Prisma.Decimal('3000.00'),
        branchId,
        status: 'SOLD_CASH',
      },
    });
    createdProductIds.push(product.id);

    const sale = await prisma.sale.create({
      data: {
        saleNumber: `${PREFIX}${RUN}-DRIFT-SL`,
        saleType: 'CASH',
        customerId: customer.id,
        productId: product.id,
        branchId,
        salespersonId: adminId,
        sellingPrice: new Prisma.Decimal('3000.00'),
        netAmount: new Prisma.Decimal('3000.00'),
      },
    });
    createdSaleIds.push(sale.id);

    const created = await svc.createCase(
      {
        imei,
        symptom: 'ทดสอบดริฟท์ — ปิดใบซ่อมตรงนอก proxy (Task 8 เคส 8)',
        accessories: { box: false, charger: false, case: false },
        unlockConfirmed: true,
        outcome: 'REPAIR',
        branchId,
      } as never,
      [fakeJpeg('drift-intake.jpg')],
      OWNER(),
    );
    const driftCaseId = created.id;
    const driftRepairTicketId = created.repairTicketId as string;
    createdCaseIds.push(driftCaseId);
    createdRepairTicketIds.push(driftRepairTicketId);

    await svc.send(driftCaseId, { repairSupplierId: supplierId } as never, OWNER());
    await svc.markRepaired(
      driftCaseId,
      { actualCost: 0, payer: 'SUPPLIER_CLAIM' } as never,
      OWNER(),
    );

    const before = await prisma.afterSalesCase.findUniqueOrThrow({ where: { id: driftCaseId } });
    expect(before.stage).toBe('READY_FOR_PICKUP');

    // bypass proxy — ปิดใบซ่อมตรงผ่าน engine เดิม ไม่ผ่าน AfterSalesRepairService.returnToCustomer
    // ⇒ AfterSalesCase.stage ไม่ถูก sync ตาม (ดริฟท์จริง)
    await repairTickets.returnToCustomer(driftRepairTicketId, {} as never, OWNER());
    const ticket = await prisma.repairTicket.findUniqueOrThrow({
      where: { id: driftRepairTicketId },
    });
    expect(ticket.status).toBe('CLOSED');

    const stillStale = await prisma.afterSalesCase.findUniqueOrThrow({
      where: { id: driftCaseId },
    });
    expect(stillStale.stage).toBe('READY_FOR_PICKUP'); // ดริฟท์ที่ตั้งใจสร้างไว้

    // createCase ซ้ำ IMEI เดิม โดยไม่เรียก lookup/getCase ก่อนเลย — reconcile ในทรานแซกชันของ
    // createCase เอง (candidates query + reconcileStage ต่อแถว) ต้องเห็นว่าเคสเก่าปิดจริงแล้ว
    const reopened = await svc.createCase(
      {
        imei,
        symptom: 'ลูกค้าเอาเครื่องเดิมมาอีกครั้ง — ทดสอบดริฟท์ (Task 8 เคส 8)',
        accessories: { box: false, charger: false, case: false },
        unlockConfirmed: true,
        outcome: 'REPAIR',
        branchId,
      } as never,
      [fakeJpeg('drift-reopen.jpg')],
      OWNER(),
    );
    createdCaseIds.push(reopened.id);
    if (reopened.repairTicketId) createdRepairTicketIds.push(reopened.repairTicketId);
    expect(reopened.id).not.toBe(driftCaseId);

    const after = await prisma.afterSalesCase.findUniqueOrThrow({ where: { id: driftCaseId } });
    expect(after.stage).toBe('CLOSED');
  });

  // -------------------------------------------------------------------------
  // เคส 9 (final fix wave I3) — MEMO อนุมัติผ่าน hub → เคส CLOSED → ยกเลิก swap ผ่าน hub → เคส
  // CANCELLED + cancelReason · IMEI เดิมเปิดเคสใหม่ได้
  // -------------------------------------------------------------------------
  it('9) I3: MEMO approvePriced (checkbox) → CLOSED → cancelSwap → CANCELLED + cancelReason · createCase IMEI เดิมได้', async () => {
    const sellingPrice = '10000.00';
    const fx = await seedInstallmentFixture({ tag: 'SWAP', daysAgoReceived: 30, sellingPrice });
    const np = await seedReplacementProduct('SWAP', {
      brand: fx.brand,
      model: fx.model,
      storage: fx.storage,
      installmentPrice: sellingPrice, // MEMO
    });

    const created = await svc.createCase(
      {
        imei: fx.imei,
        symptom: 'ทดสอบยกเลิก swap หลัง MEMO ลงผล (final fix I3)',
        accessories: { box: false, charger: false, case: false },
        unlockConfirmed: true,
        outcome: 'PRICED_EXCHANGE',
        replacementProductId: np.id,
        branchId,
      } as never,
      [fakeJpeg('swap-intake.jpg')],
      OWNER(),
    );
    createdCaseIds.push(created.id);
    const requestId = created.exchangeRequestId as string;
    createdRequestIds.push(requestId);
    expect(created.stage).toBe('AWAITING_APPROVAL');

    await exchangeSvc.approvePriced(
      created.id,
      { memoAddendumSigned: true, memoMdmSwapped: true } as never,
      OWNER(),
    );
    const closed = await svc.getCase(created.id, OWNER());
    expect((closed as { stage: string }).stage).toBe('CLOSED');

    const reason = `ลูกค้าคืนเครื่องใหม่ — ยกเลิก swap ${RUN}`;
    await exchangeSvc.cancelSwap(created.id, { reason } as never, BM_USER());

    const request = await prisma.contractExchangeRequest.findUniqueOrThrow({
      where: { id: requestId },
    });
    expect(request.status).toBe('CANCELED');
    const row = await prisma.afterSalesCase.findUniqueOrThrow({ where: { id: created.id } });
    expect(row.stage).toBe('CANCELLED');
    expect(row.cancelledAt).not.toBeNull();
    expect(row.cancelReason).toBe(reason);

    const reopened = await svc.createCase(
      {
        imei: fx.imei,
        symptom: 'เปิดเคสใหม่หลังยกเลิก swap (final fix I3)',
        accessories: { box: false, charger: false, case: false },
        unlockConfirmed: true,
        outcome: 'REPAIR',
        branchId,
      } as never,
      [fakeJpeg('swap-reopen.jpg')],
      OWNER(),
    );
    createdCaseIds.push(reopened.id);
    if (reopened.repairTicketId) createdRepairTicketIds.push(reopened.repairTicketId);
    expect(reopened.id).not.toBe(created.id);
  });

  // -------------------------------------------------------------------------
  // เคส 10 (M12 a) — เคสซ่อมที่ซ่อมไม่ได้ → confirmSameModel พร้อม replacementProductId (ต้นทางใบซ่อม)
  // -------------------------------------------------------------------------
  it('10) M12a: REPAIR-origin confirm → ใบซ่อม REPLACED · เคส SAME_MODEL_EXCHANGE READY_FOR_PICKUP · สัญญาเดิม DEFECT_EXCHANGED', async () => {
    const fx = await seedInstallmentFixture({ tag: 'RPX', daysAgoReceived: 2 });
    const np = await seedReplacementProduct('RPX', {
      brand: fx.brand,
      model: fx.model,
      storage: fx.storage,
    });
    await seedStatementReview(prisma, fx.customerId);

    const created = await svc.createCase(
      {
        imei: fx.imei,
        symptom: 'ซ่อมไม่ได้ — เปลี่ยนรุ่นเดิมจากใบซ่อม (M12a)',
        accessories: { box: false, charger: false, case: false },
        unlockConfirmed: true,
        outcome: 'REPAIR',
        branchId,
      } as never,
      [fakeJpeg('rpx-intake.jpg')],
      SALES_USER(),
    );
    createdCaseIds.push(created.id);
    const ticketId = created.repairTicketId as string;
    createdRepairTicketIds.push(ticketId);

    const result = await exchangeSvc.confirmSameModel(
      created.id,
      { replacementProductId: np.id } as never,
      BM_USER(),
    );
    createdContractIds.push(result.replacementContractId as string);
    expect(result.stage).toBe('READY_FOR_PICKUP');

    const ticket = await prisma.repairTicket.findUniqueOrThrow({ where: { id: ticketId } });
    expect(ticket.status).toBe('REPLACED');
    const caseRow = await prisma.afterSalesCase.findUniqueOrThrow({ where: { id: created.id } });
    expect(caseRow.outcome).toBe('SAME_MODEL_EXCHANGE');
    expect(caseRow.stage).toBe('READY_FOR_PICKUP');
    expect(caseRow.replacementContractId).toBe(result.replacementContractId);
    const oldContract = await prisma.contract.findUniqueOrThrow({
      where: { id: fx.oldContractId },
    });
    expect(oldContract.status).toBe('DEFECT_EXCHANGED');

    // getCase (reconcile) ยังได้ READY_FOR_PICKUP — ใบซ่อม REPLACED + สัญญาใหม่ DRAFT
    const read = await svc.getCase(created.id, OWNER());
    expect((read as { stage: string }).stage).toBe('READY_FOR_PICKUP');
  });

  // -------------------------------------------------------------------------
  // เคส 11 (M12 b) — นอกกรอบ 7 วัน ต้นทางเคส (กิ่ง originAfterSalesCaseId ของ engine) บน DB จริง
  // -------------------------------------------------------------------------
  it('11) M12b: นอกกรอบ 7 วัน (deviceReceivedAt = 10 วันก่อน) — SALES ยืนยัน 403 · BM ยืนยันสำเร็จด้วย bypass', async () => {
    const fx = await seedInstallmentFixture({ tag: 'OOW', daysAgoReceived: 10 });
    const np = await seedReplacementProduct('OOW', {
      brand: fx.brand,
      model: fx.model,
      storage: fx.storage,
    });
    await seedStatementReview(prisma, fx.customerId);

    const created = await svc.createCase(
      {
        imei: fx.imei,
        symptom: 'นอกกรอบ 7 วัน — ผจก. ข้ามกรอบ (M12b)',
        accessories: { box: false, charger: false, case: false },
        unlockConfirmed: true,
        outcome: 'SAME_MODEL_EXCHANGE',
        replacementProductId: np.id,
        branchId,
      } as never,
      [fakeJpeg('oow-intake.jpg')],
      BM_USER(),
    );
    createdCaseIds.push(created.id);

    await expect(
      exchangeSvc.confirmSameModel(created.id, {} as never, SALES_USER()),
    ).rejects.toThrow(ForbiddenException);

    const result = await exchangeSvc.confirmSameModel(created.id, {} as never, BM_USER());
    createdContractIds.push(result.replacementContractId as string);
    expect(result.stage).toBe('READY_FOR_PICKUP');

    const oldContract = await prisma.contract.findUniqueOrThrow({
      where: { id: fx.oldContractId },
    });
    expect(oldContract.status).toBe('DEFECT_EXCHANGED');
    const approvedEvent = await prisma.afterSalesEvent.findFirstOrThrow({
      where: { caseId: created.id, kind: 'APPROVED' },
    });
    expect(approvedEvent.note ?? '').toContain('ข้ามกรอบ 7 วัน');
  });

  // -------------------------------------------------------------------------
  // เคส 12 (Task 3, PR3, ruling ง) — confirmSameModel → READY: notifyMoment เรียกตรงๆ (ไม่แข่งกับ
  // fire-and-forget ของ exchangeSvc เอง) → sendFromTemplate ได้ data.readyLine ของกิ่งเปลี่ยนเครื่อง
  // -------------------------------------------------------------------------
  it('12) Task 3 ง: confirmSameModel → READY_FOR_PICKUP → notifyMoment(READY) → sendFromTemplate data.readyLine = "เปลี่ยนเครื่องใหม่ให้แล้ว มารับได้เลย"', async () => {
    const fx = await seedInstallmentFixture({ tag: 'LINE12', daysAgoReceived: 2 });
    // ลูกค้าต้องผูก LINE ไว้ก่อน ไม่งั้น notifyMoment จะเป็น NO_LINK ไม่เรียก sendFromTemplate เลย
    await prisma.customer.update({
      where: { id: fx.customerId },
      data: { lineIdShop: `Utest${RUN}12` },
    });
    const np = await seedReplacementProduct('LINE12', {
      brand: fx.brand,
      model: fx.model,
      storage: fx.storage,
    });
    await seedStatementReview(prisma, fx.customerId);

    const created = await svc.createCase(
      {
        imei: fx.imei,
        symptom: 'ทดสอบ LINE จังหวะที่ 2 — เปลี่ยนรุ่นเดิม (Task 3 เคส 12)',
        accessories: { box: false, charger: false, case: false },
        unlockConfirmed: true,
        outcome: 'SAME_MODEL_EXCHANGE',
        replacementProductId: np.id,
        branchId,
      } as never,
      [fakeJpeg('line12-intake.jpg')],
      SALES_USER(),
    );
    createdCaseIds.push(created.id);

    const result = await exchangeSvc.confirmSameModel(created.id, {} as never, BM_USER());
    createdContractIds.push(result.replacementContractId as string);
    expect(result.stage).toBe('READY_FOR_PICKUP');

    // เรียกตรง ๆ อีกครั้งให้มีจังหวะ await แน่นอน (ไม่แข่งกับ fire-and-forget ของ confirmSameModel เอง)
    const notifyResult = await line.notifyMoment(created.id, 'READY', adminId);
    expect(notifyResult.status).toBe('SENT');

    const call = notificationsFakeImpl.sendFromTemplate.mock.calls.find(
      (c: unknown[]) =>
        (c[3] as { relatedId?: string })?.relatedId === created.id && c[0] === 'AFTER_SALES_READY',
    );
    expect(call).toBeTruthy();
    const data = call![1] as Record<string, string>;
    expect(data.readyLine).toBe('เปลี่ยนเครื่องใหม่ให้แล้ว มารับได้เลย');
  });
});
