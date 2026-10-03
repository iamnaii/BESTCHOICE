import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { PrismaClient, Prisma } from '@prisma/client';
import { ConflictException, ForbiddenException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Readable } from 'stream';

import { AuditService } from '../../audit/audit.service';
import { RepairTicketsService } from '../../repair-tickets/repair-tickets.service';
import { RepairTicketDocNumberService } from '../../repair-tickets/services/doc-number.service';
import { ExpenseDocumentsService } from '../../expense-documents/expense-documents.service';
import { ExpenseDocumentCreateService } from '../../expense-documents/services/expense-document-create.service';
import { LineAggregatorService } from '../../expense-documents/services/line-aggregator.service';
import { DocNumberService as ExpenseDocNumberService } from '../../expense-documents/services/doc-number.service';
import { OtherIncomeLifecycleService } from '../../other-income/services/other-income-lifecycle.service';
import { DocNumberService as OtherIncomeDocNumberService } from '../../other-income/services/doc-number.service';
import { SettingsService } from '../../settings/settings.service';
import { SettingsFlagsService } from '../../settings/services/settings-flags.service';

import { AfterSalesLookupService } from '../services/after-sales-lookup.service';
import { AfterSalesCaseService } from '../services/after-sales-case.service';
import { AfterSalesQueryService } from '../services/after-sales-query.service';
import { AfterSalesRepairService } from '../services/after-sales-repair.service';
import { AfterSalesLineService } from '../services/after-sales-line.service';
import { AfterSalesDocNumberService } from '../services/after-sales-doc-number.service';
import { AfterSalesService } from '../after-sales.service';

/**
 * after-sales — flow จริงบน DB จริง (Task 7, after-sales-hub PR1).
 *
 * Wiring instance จริงด้วย `new` (ไม่ผ่าน Nest DI) — pattern เดียวกับ
 * device-return-flow.integration.spec.ts / interco-netting.integration.spec.ts.
 * StorageService / ProductPhotosService / DefectExchangeService เป็นตัวปลอมในหน่วยความจำ
 * ตามที่ task-7-brief.md กำหนด — ทุกอย่างอื่น (RepairTicketsService, ExpenseDocumentsService,
 * AuditService, ฯลฯ) เป็นของจริงต่อกันเป็นห่วงโซ่ real dependency. เคส 3-8 เรียกผ่าน facade
 * `AfterSalesService` (ไม่ใช่ sub-service ตรง ๆ) เพื่อให้การ delegate ของ facade เองถูกทดสอบด้วย
 * (fix round 1 Minor).
 *
 * Runner: vitest (jest ignore *.integration.spec.ts).
 *   cd apps/api && DATABASE_URL=postgresql://test:test@localhost:5432/test_db?schema=public \
 *     npx vitest run --no-file-parallelism src/modules/after-sales/__tests__/after-sales-flow.integration.spec.ts
 *
 * CI: glob AFTERSALES_FILES ใน .github/workflows/deploy-gcp.yml.
 *
 * Cleanup: SCOPED ตาม id ที่สเปคนี้สร้างเท่านั้น (afterAll ลบลูกก่อนแม่) — audit_logs ลบไม่ได้
 * (DB trigger immutable ตามดีไซน์ — precedent เดียวกับ device-return-flow spec).
 *
 * Fix round 1 (2026-09-24) — Critical: R16 บังคับ branch scope ใน
 * AfterSalesCaseService.createCase เอง (BranchGuard มองไม่เห็น branchId ใน multipart body) —
 * เคส 8 พิสูจน์ว่า SALES สาขาอื่นสร้างเคสให้สาขาอื่นไม่ได้และไม่มีแถวใหม่เกิด. Important: R17
 * จับ expenseDocumentId ทันทีหลัง fetch ticket ก่อน assertion ใด ๆ กัน ExpenseDocument ที่สร้าง
 * สำเร็จหลุด cleanup ถ้า assertion ถัดไปพัง.
 */

const prisma = new PrismaClient();

// ---------------------------------------------------------------------------
// Service wiring — ห่วงโซ่ real dependency ของ RepairTicketsService (ExpenseDocumentsService
// ของจริงเพื่อให้ returnToCustomer(payer=SHOP) สร้าง ExpenseDocument DRAFT จริง)
// ---------------------------------------------------------------------------
const audit = new AuditService(prisma as never);

const settingsFlags = new SettingsFlagsService(prisma as never);
// write / pettyCash / docNumberPreview ไม่ถูกเรียกจากเส้นทางที่เทสต์นี้ใช้ (createDraftForRepair
// เรียกแค่ this.settings.getKey / getDocPrefixMap ซึ่ง delegate ไปที่ `flags` เท่านั้น)
const settingsSvc = new SettingsService(settingsFlags, null as never, null as never, null as never);
const expenseDocNumber = new ExpenseDocNumberService(settingsSvc);
const lineAggregator = new LineAggregatorService();
// transition / ssoConfig / payrollCustom / pettyCash ไม่ถูกเรียกจาก createDraftForRepair
const expenseCreator = new ExpenseDocumentCreateService(
  prisma as never,
  expenseDocNumber,
  lineAggregator,
  null as never,
  null as never,
  null as never,
  null as never,
);
// query / lifecycle ไม่ถูกเรียก — เทสต์นี้ใช้เฉพาะ createDraftForRepair ซึ่ง delegate ตรงไปที่ creator
const expenseDocs = new ExpenseDocumentsService(
  prisma as never,
  null as never,
  null as never,
  expenseCreator,
);

const repairTicketDocNumber = new RepairTicketDocNumberService(prisma as never);
// otherIncome — Task 3 เคส ค ต้องการ payer=CUSTOMER จริง (returnToCustomer สร้าง OtherIncome
// DRAFT) ⇒ ต่อ OtherIncomeLifecycleService ของจริงเฉพาะเท่าที่ createDraftForRepair ใช้ (docNumber
// + เขียนตรง — ไม่แตะ validation/autoJournal/template/journalOverride/config เลย) แล้วห่อเป็น
// fake ที่มีแค่เมธอดเดียวแทนการสร้าง facade เต็ม (เหมือน pattern productPhotosFake/storage ด้านล่าง)
const otherIncomeDocNumber = new OtherIncomeDocNumberService(prisma as never);
const otherIncomeLifecycle = new OtherIncomeLifecycleService(
  prisma as never,
  otherIncomeDocNumber,
  null as never,
  null as never,
  null as never,
  null as never,
  null as never,
  null as never,
);
const otherIncomeFake = {
  createDraftForRepair: (dto: never, tx: never) =>
    otherIncomeLifecycle.createDraftForRepair(dto, tx),
} as never;
// settings ไม่ถูกเรียกในเส้นทางที่เทสต์นี้ใช้ (facade docblock: "settings is injected but
// unused — kept for signature stability")
const repairTickets = new RepairTicketsService(
  prisma as never,
  audit,
  expenseDocs,
  otherIncomeFake,
  null as never,
  repairTicketDocNumber,
);

// ProductPhotosService ปลอม — คืนรูปตอนซื้อมุมเดียว (front) ตามที่ brief กำหนด
const productPhotosFake = {
  getPhotos: async () => ({
    photos: {
      front: 'data:image/jpeg;base64,/9j/4AAQ',
      back: null,
      left: null,
      right: null,
      top: null,
      bottom: null,
    },
  }),
} as never;
// DefectExchangeService ปลอม — ไม่ถูกเรียกจริงในสถานการณ์ CASH_SALE (ไม่มี contract) แต่ต้องมีเพื่อ
// ให้ตรง constructor shape
const defectExchangeFake = {
  checkEligibility: async () => ({ eligible: false, reasons: ['เกินกรอบ 7 วัน'] }),
} as never;
// ContractExchangeService ปลอม (Task 4, PR 2) — ไฟล์นี้ทดสอบเฉพาะ outcome=REPAIR (PR 1 scope)
// จึงไม่มีเคสไหนเรียก submit() จริง แต่ต้องมีเพื่อให้ตรง constructor shape ของ AfterSalesCaseService
const contractExchangeFake = {
  submit: async () => {
    throw new Error('contractExchangeFake.submit ไม่ถูกเรียกในสเปคนี้ (ทดสอบเฉพาะ REPAIR)');
  },
} as never;

const lookupSvc = new AfterSalesLookupService(
  prisma as never,
  repairTickets,
  defectExchangeFake,
  productPhotosFake,
);
const afterSalesDocNumber = new AfterSalesDocNumberService(prisma as never);

// AfterSalesLineService (Task 3) — ของจริง ต่อกับ NotificationsService/IntegrationConfigService
// ปลอมตามที่ task-3-brief.md Step 3 กำหนดเป๊ะ (ไม่ใช้ mock ของ notifyMoment เอง — ต้องพิสูจน์ว่า
// service จริงเขียน AfterSalesEvent + เรียก sendFromTemplate ด้วยข้อมูลที่ถูกต้องบน DB จริง)
const notificationsFakeImpl = {
  sendFromTemplate: vi.fn().mockResolvedValue({ id: 'n1', status: 'SENT' }),
};
const notificationsFake = notificationsFakeImpl as never;
const integrationConfigFake = { getValue: async () => 'liff-test' } as never;
const line = new AfterSalesLineService(prisma as never, notificationsFake, integrationConfigFake);

// StorageService ปลอมในหน่วยความจำ (Map) — ตามที่ brief กำหนดเป๊ะ
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
  contractExchangeFake,
  defectExchangeFake,
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
// AfterSalesExchangeService ปลอม (Task 8, PR 2) — ไฟล์นี้ทดสอบเฉพาะ outcome=REPAIR (PR 1 scope)
// จึงไม่มีเคสไหนเรียก route เปลี่ยนเครื่องผ่าน facade เลย; ผ่าน `as never` แทนการ wiring ของจริง
// (เทียบ contractExchangeFake/defectExchangeFake ด้านบน — pattern เดียวกัน)
const exchangeSvcFake = {} as never;

const svc = new AfterSalesService(lookupSvc, caseSvc, querySvc, repairSvc, exchangeSvcFake);

// ---------------------------------------------------------------------------
// Fixtures / run markers
// ---------------------------------------------------------------------------
const RUN = Date.now().toString(36).toUpperCase();
const RUN_NUM = String(Date.now() % 1_000_000).padStart(6, '0');
const PREFIX = 'AFTERSALESTEST-';
const IMEI = `${PREFIX}${RUN}`;

let adminId: string;
let branchId: string;
let supplierId: string;
let customerId: string;
let productId: string;
let saleId: string;
let caseId: string;
let repairTicketId: string;
let expenseDocumentId: string | null = null;

// A1 final-fix brief — เคสแยกต่างหาก (IMEI คนละตัว) สำหรับพิสูจน์ reconcileStage: ปิดใบซ่อม
// ตรงผ่าน RepairTicketsService (ไม่ผ่าน AfterSalesRepairService proxy) เพื่อจำลองใบซ่อมที่ถูก
// แก้นอก proxy จริง — case.stage ต้องดริฟท์ค้างที่ READY_FOR_PICKUP ขณะที่ ticket.status เป็น CLOSED
const IMEI2 = `${PREFIX}${RUN}-DRIFT`;
let customerId2: string;
let productId2: string;
let saleId2: string;
let caseId2: string;
let repairTicketId2: string;
let caseId3: string; // เคสใหม่ของ IMEI2 ที่เปิดได้สำเร็จหลัง reconcile (ไม่ 409)
let repairTicketId3: string;

let branchCreatedFresh = false;

const OWNER = () => ({ id: adminId, role: 'OWNER', branchId: null as string | null });

function bkkYyyymmdd(date: Date): string {
  const [y, m, d] = date
    .toLocaleString('en-CA', {
      timeZone: 'Asia/Bangkok',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
    .split('-');
  return `${y}${m}${d}`;
}

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

describe('after-sales flow — DB จริง (Task 7, PR1)', () => {
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

    const branchName = '__after_sales_test_branch__';
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
      branchCreatedFresh = true;
    }

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
      if (caseId) {
        await prisma.afterSalesEvent.deleteMany({ where: { caseId } });
        await prisma.afterSalesCase.deleteMany({ where: { id: caseId } });
      }
      if (repairTicketId) {
        await prisma.repairStatusLog.deleteMany({ where: { ticketId: repairTicketId } });
        await prisma.repairTicket.deleteMany({ where: { id: repairTicketId } });
      }
      if (expenseDocumentId) {
        // ExpenseDetail/ExpenseLine cascade จาก ExpenseDocument (onDelete: Cascade)
        await prisma.expenseDocument.deleteMany({ where: { id: expenseDocumentId } });
      }
      if (saleId) {
        await prisma.sale.deleteMany({ where: { id: saleId } });
      }
      if (productId) {
        await prisma.product.deleteMany({ where: { id: productId } });
      }
      if (customerId) {
        await prisma.customer.deleteMany({ where: { id: customerId } });
      }
      // A1 final-fix brief — เคสดริฟท์ (IMEI2) + เคสใหม่ที่เปิดซ้ำได้สำเร็จ (caseId3) ลูกก่อนแม่
      if (caseId3) {
        await prisma.afterSalesEvent.deleteMany({ where: { caseId: caseId3 } });
        await prisma.afterSalesCase.deleteMany({ where: { id: caseId3 } });
      }
      if (repairTicketId3) {
        await prisma.repairStatusLog.deleteMany({ where: { ticketId: repairTicketId3 } });
        await prisma.repairTicket.deleteMany({ where: { id: repairTicketId3 } });
      }
      if (caseId2) {
        await prisma.afterSalesEvent.deleteMany({ where: { caseId: caseId2 } });
        await prisma.afterSalesCase.deleteMany({ where: { id: caseId2 } });
      }
      if (repairTicketId2) {
        await prisma.repairStatusLog.deleteMany({ where: { ticketId: repairTicketId2 } });
        await prisma.repairTicket.deleteMany({ where: { id: repairTicketId2 } });
      }
      if (saleId2) {
        await prisma.sale.deleteMany({ where: { id: saleId2 } });
      }
      if (productId2) {
        await prisma.product.deleteMany({ where: { id: productId2 } });
      }
      if (customerId2) {
        await prisma.customer.deleteMany({ where: { id: customerId2 } });
      }
      if (supplierId) {
        await prisma.supplier.deleteMany({ where: { id: supplierId } });
      }
      if (branchCreatedFresh && branchId) {
        try {
          await prisma.branch.delete({ where: { id: branchId } });
        } catch (error) {
          if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2003') {
            throw error;
          }
        }
      }
    } finally {
      await prisma.$disconnect();
    }
  }, 120_000);

  // -------------------------------------------------------------------------
  it('1) seed: ลูกค้า + เครื่อง PHONE_USED (IMEI) + ใบขายสดเมื่อ 3 วันก่อน', async () => {
    const customer = await prisma.customer.create({
      data: {
        name: `${PREFIX}Customer ${RUN}`,
        phone: `098${RUN_NUM}`.slice(0, 12),
      },
    });
    customerId = customer.id;

    const product = await prisma.product.create({
      data: {
        name: `${PREFIX}Phone ${RUN}`,
        brand: `${PREFIX}Brand`,
        model: `${PREFIX}Model-${RUN}`,
        storage: '128GB',
        imeiSerial: IMEI,
        category: 'PHONE_USED',
        costPrice: new Prisma.Decimal('3000.00'),
        branchId,
        status: 'SOLD_CASH',
      },
    });
    productId = product.id;

    const threeDaysAgo = new Date(Date.now() - 3 * 86400_000);
    const ninetyDaysAhead = new Date(Date.now() + 90 * 86400_000);
    const sale = await prisma.sale.create({
      data: {
        saleNumber: `${PREFIX}${RUN}`,
        saleType: 'CASH',
        customerId,
        productId,
        branchId,
        salespersonId: adminId,
        sellingPrice: new Prisma.Decimal('3671.00'),
        netAmount: new Prisma.Decimal('3671.00'),
        createdAt: threeDaysAgo,
        shopWarrantyEndDate: ninetyDaysAhead,
      },
    });
    saleId = sale.id;

    expect(customerId).toBeTruthy();
    expect(productId).toBeTruthy();
    expect(saleId).toBeTruthy();
  });

  // -------------------------------------------------------------------------
  it('2) lookup({imei}) → found=true, source=CASH_SALE, REPAIR เปิด, CASH_SAME_MODEL_EXCHANGE ปิด', async () => {
    const result = await svc.lookup({ imei: IMEI }, OWNER());
    expect(result.found).toBe(true);
    expect(result.source).toBe('CASH_SALE');
    expect(result.outcomes[0]).toMatchObject({ outcome: 'REPAIR', enabled: true });
    expect(result.outcomes[1]).toMatchObject({
      outcome: 'CASH_SAME_MODEL_EXCHANGE',
      enabled: false,
    });
  });

  // -------------------------------------------------------------------------
  it('3) createCase → เลข AS-YYYYMMDD-NNNN, repairTicket RT- warrantyStatus≠WALK_IN, purchasePhotoKeys ยาว 1, storage 2 ไฟล์, events 2 แถว', async () => {
    const dto = {
      imei: IMEI,
      symptom: 'จอแตกมุมซ้ายบน กดหน้าจอไม่ติดบางจุด',
      accessories: { box: true, charger: false, case: false },
      unlockConfirmed: true,
      outcome: 'REPAIR' as const,
      branchId,
    };
    const result = await svc.createCase(dto as never, [fakeJpeg('intake.jpg')], OWNER());
    caseId = result.id;
    repairTicketId = result.repairTicketId!;

    const yyyymmdd = bkkYyyymmdd(new Date());
    expect(result.caseNumber).toMatch(new RegExp(`^AS-${yyyymmdd}-\\d{4}$`));
    expect(repairTicketId).toBeTruthy();

    const ticket = await prisma.repairTicket.findUniqueOrThrow({
      where: { id: repairTicketId },
    });
    expect(ticket.ticketNumber).toMatch(/^RT-/);
    expect(ticket.warrantyStatus).not.toBe('WALK_IN');

    const caseRow = await prisma.afterSalesCase.findUniqueOrThrow({ where: { id: caseId } });
    expect(caseRow.purchasePhotoKeys).toHaveLength(1);

    expect(files.size).toBe(2);

    const events = await prisma.afterSalesEvent.findMany({ where: { caseId } });
    // Task 3 — createCase ยิง notifyMoment('RECEIVED') แบบ fire-and-forget หลัง audit.log เสมอ
    // (ลูกค้า fixture นี้ไม่มี lineIdShop ⇒ จะเขียนแถว LINE_SKIPPED_NO_LINK เพิ่มเข้ามาแบบ async
    // นอกทรานแซกชันสร้างเคส — เวลาที่แถวนั้นมาถึงไม่แน่นอน race กับ assertion นี้ตรงๆ) จึงกรองเฉพาะ
    // 2 event ของทรานแซกชันสร้างเคส (RECEIVED + OUTCOME_SET) แทนนับทั้งหมด
    expect(events.filter((e) => e.kind === 'RECEIVED' || e.kind === 'OUTCOME_SET')).toHaveLength(2);
  });

  // -------------------------------------------------------------------------
  it('4) createCase ซ้ำ IMEI เดิม (เคสยังไม่ปิด) → ConflictException', async () => {
    const dto = {
      imei: IMEI,
      symptom: 'มาซ้ำ — ทดสอบกันเปิดซ้ำ',
      accessories: { box: false, charger: false, case: false },
      unlockConfirmed: true,
      outcome: 'REPAIR' as const,
      branchId,
    };
    await expect(svc.createCase(dto as never, [fakeJpeg('intake2.jpg')], OWNER())).rejects.toThrow(
      ConflictException,
    );
  });

  // -------------------------------------------------------------------------
  it('5) send → IN_REPAIR · markRepaired(1500, SHOP) → READY_FOR_PICKUP · returnToCustomer({}) → CLOSED + ใบซ่อม CLOSED + expenseDocumentId ไม่ null', async () => {
    let r = await svc.send(caseId, { repairSupplierId: supplierId } as never, OWNER());
    expect(r.stage).toBe('IN_REPAIR');

    r = await svc.markRepaired(caseId, { actualCost: 1500, payer: 'SHOP' } as never, OWNER());
    expect(r.stage).toBe('READY_FOR_PICKUP');

    r = await svc.returnToCustomer(caseId, {} as never, OWNER());
    expect(r.stage).toBe('CLOSED');

    const ticket = await prisma.repairTicket.findUniqueOrThrow({
      where: { id: repairTicketId },
    });
    // R17 (fix round 1, Important) — จับ id ไว้ก่อนสำหรับ afterAll ทันทีที่รู้ค่า ก่อน assertion
    // ใด ๆ ที่อาจ throw แล้วปล่อยให้ ExpenseDocument ที่สร้างสำเร็จแล้วหลุด cleanup
    expenseDocumentId = ticket.expenseDocumentId ?? null;
    expect(ticket.status).toBe('CLOSED');
    expect(ticket.expenseDocumentId).not.toBeNull();
  });

  // -------------------------------------------------------------------------
  it('6) list({tab:DONE, summary:true}, owner) → มีเคสนี้ + summary.repairCostShop >= 1500', async () => {
    const result = await svc.list({ tab: 'DONE', summary: true } as never, OWNER());
    expect(result.data.some((d) => d.id === caseId)).toBe(true);
    expect(result.summary).toBeTruthy();
    expect(result.summary!.repairCostShop).toBeGreaterThanOrEqual(1500);
  });

  // -------------------------------------------------------------------------
  it('7) SALES ของสาขาอื่น getCase → ForbiddenException', async () => {
    const other = { id: randomUUID(), role: 'SALES', branchId: randomUUID() };
    await expect(svc.getCase(caseId, other)).rejects.toThrow(ForbiddenException);
  });

  // -------------------------------------------------------------------------
  // 8) CRITICAL (fix round 1) — SALES ของสาขาอื่นเรียก createCase สำหรับสาขาที่ seed ไว้
  // (dto.branchId = สาขาที่สร้างเคส แต่ user.branchId เป็นสาขาอื่น) ต้องถูกปฏิเสธที่ service ชั้นแรก
  // ก่อนแตะ storage/lookup/tx ใด ๆ — ไม่มีแถวใหม่เกิดขึ้นเลย (นับ after_sales_cases ของ RUN นี้
  // ไม่ขยับจากที่ case 3 ทิ้งไว้)
  it('8) SALES ของสาขาอื่น createCase สำหรับสาขานี้ → ForbiddenException ไม่มีแถวใหม่เกิดขึ้น', async () => {
    const before = await prisma.afterSalesCase.count({ where: { deviceImei: IMEI } });

    const otherBranchUser = { id: randomUUID(), role: 'SALES', branchId: randomUUID() };
    const dto = {
      imei: IMEI,
      symptom: 'ทดสอบ R16 — สาขาอื่นสร้างเคสสาขานี้ไม่ได้',
      accessories: { box: false, charger: false, case: false },
      unlockConfirmed: true,
      outcome: 'REPAIR' as const,
      branchId, // สาขาที่ seed ไว้ — ไม่ใช่สาขาของ otherBranchUser
    };

    await expect(
      svc.createCase(dto as never, [fakeJpeg('intake3.jpg')], otherBranchUser),
    ).rejects.toThrow(ForbiddenException);

    const after = await prisma.afterSalesCase.count({ where: { deviceImei: IMEI } });
    expect(after).toBe(before);
  });

  // -------------------------------------------------------------------------
  // 9-12) A1 (final-fix brief) — reconcileStage self-heals a stage that drifted because the
  // repair ticket was closed OUTSIDE the after-sales proxy (`repairTickets.returnToCustomer`
  // called directly, not through `svc.returnToCustomer`/`repairSvc.returnToCustomer` — so
  // `AfterSalesRepairService.sync()` never runs and `AfterSalesCase.stage` never gets written).
  // -------------------------------------------------------------------------
  it('9) seed เคสที่สอง (IMEI แยก) แล้วเดินจน READY_FOR_PICKUP ผ่าน proxy ปกติ (stage ยัง sync ตรงกับ ticket)', async () => {
    const customer = await prisma.customer.create({
      data: { name: `${PREFIX}Customer2 ${RUN}`, phone: `097${RUN_NUM}`.slice(0, 12) },
    });
    customerId2 = customer.id;

    const product = await prisma.product.create({
      data: {
        name: `${PREFIX}Phone2 ${RUN}`,
        brand: `${PREFIX}Brand`,
        model: `${PREFIX}Model2-${RUN}`,
        storage: '256GB',
        imeiSerial: IMEI2,
        category: 'PHONE_USED',
        costPrice: new Prisma.Decimal('3000.00'),
        branchId,
        status: 'SOLD_CASH',
      },
    });
    productId2 = product.id;

    const threeDaysAgo = new Date(Date.now() - 3 * 86400_000);
    const ninetyDaysAhead = new Date(Date.now() + 90 * 86400_000);
    const sale = await prisma.sale.create({
      data: {
        saleNumber: `${PREFIX}${RUN}-D`,
        saleType: 'CASH',
        customerId: customerId2,
        productId: productId2,
        branchId,
        salespersonId: adminId,
        sellingPrice: new Prisma.Decimal('3671.00'),
        netAmount: new Prisma.Decimal('3671.00'),
        createdAt: threeDaysAgo,
        shopWarrantyEndDate: ninetyDaysAhead,
      },
    });
    saleId2 = sale.id;

    const created = await svc.createCase(
      {
        imei: IMEI2,
        symptom: 'จอมีเส้นแนวตั้ง — ทดสอบ reconcileStage (A1 final-fix)',
        accessories: { box: false, charger: false, case: false },
        unlockConfirmed: true,
        outcome: 'REPAIR' as const,
        branchId,
      } as never,
      [fakeJpeg('drift-intake.jpg')],
      OWNER(),
    );
    caseId2 = created.id;
    repairTicketId2 = created.repairTicketId!;

    let r = await svc.send(caseId2, { repairSupplierId: supplierId } as never, OWNER());
    expect(r.stage).toBe('IN_REPAIR');

    // payer SUPPLIER_CLAIM + actualCost 0 — ไม่สร้างเอกสารบัญชี ให้ทดสอบเรื่อง reconcile ล้วนๆ
    r = await svc.markRepaired(
      caseId2,
      { actualCost: 0, payer: 'SUPPLIER_CLAIM' } as never,
      OWNER(),
    );
    expect(r.stage).toBe('READY_FOR_PICKUP');
  });

  it('10) bypass proxy: ปิดใบซ่อมตรงผ่าน RepairTicketsService.returnToCustomer → ticket.status=CLOSED แต่ case.stage ยังค้าง READY_FOR_PICKUP (ดริฟท์จริง)', async () => {
    await repairTickets.returnToCustomer(repairTicketId2, {} as never, OWNER());

    const ticket = await prisma.repairTicket.findUniqueOrThrow({
      where: { id: repairTicketId2 },
    });
    expect(ticket.status).toBe('CLOSED');

    const caseRow = await prisma.afterSalesCase.findUniqueOrThrow({ where: { id: caseId2 } });
    expect(caseRow.stage).toBe('READY_FOR_PICKUP'); // sync() ไม่เคยรัน — นี่คือดริฟท์ที่ A1 แก้
    expect(caseRow.closedAt).toBeNull();
  });

  it('11) list({tab:READY}) reconcile แล้วเคสนี้หลุดจากแท็บ READY + DB ถูกเขียนกลับเป็น CLOSED จริง', async () => {
    const readyResult = await svc.list({ tab: 'READY' } as never, OWNER());
    expect(readyResult.data.some((d) => d.id === caseId2)).toBe(false);

    const caseRow = await prisma.afterSalesCase.findUniqueOrThrow({ where: { id: caseId2 } });
    expect(caseRow.stage).toBe('CLOSED');
    expect(caseRow.closedAt).not.toBeNull();
  });

  it('12) list({tab:DONE}) เจอเคสนี้แล้ว + getCase คืน stage=CLOSED (ทั้งคู่พิสูจน์ตามที่ brief ระบุ)', async () => {
    const doneResult = await svc.list({ tab: 'DONE' } as never, OWNER());
    expect(doneResult.data.some((d) => d.id === caseId2)).toBe(true);

    const detail = await svc.getCase(caseId2, OWNER());
    expect(detail.stage).toBe('CLOSED');
  });

  it('13) เปิดเคสใหม่สำหรับ IMEI เดียวกัน (IMEI2) สำเร็จ — ไม่ 409 เพราะเคสเก่า derived ปิดแล้วจริง', async () => {
    const result = await svc.createCase(
      {
        imei: IMEI2,
        symptom: 'ลูกค้าเอาเครื่องเดิมมาอีกครั้ง — ทดสอบว่าไม่ถูกบล็อกถาวร (A1 final-fix)',
        accessories: { box: false, charger: false, case: false },
        unlockConfirmed: true,
        outcome: 'REPAIR' as const,
        branchId,
      } as never,
      [fakeJpeg('reopen-intake.jpg')],
      OWNER(),
    );
    caseId3 = result.id;
    repairTicketId3 = result.repairTicketId!;

    expect(result.caseNumber).toMatch(/^AS-\d{8}-\d{4}$/);
    expect(repairTicketId3).toBeTruthy();
  });
});

// -----------------------------------------------------------------------------
// Task 3 (PR 3) — 3 จังหวะ LINE ลูกค้า บน DB จริง (เคส ก-ค ของ task-3-brief.md Step 3)
//
// `AfterSalesLineService` ของจริง (`line`, ประกาศไว้ในหัวไฟล์ข้างบน) ต่อกับ
// NotificationsService/IntegrationConfigService ปลอมตามบรีฟเป๊ะ — ไม่ mock notifyMoment เอง
// เพื่อพิสูจน์ทั้งสาย: อ่านเคส+ลูกค้าจาก DB จริง → เขียน AfterSalesEvent จริง → เรียก
// sendFromTemplate ด้วยข้อมูลจริง. ทุกเคสเรียก `await line.notifyMoment(...)` ตรง ๆ ต่อจาก
// action ปกติ (ตามที่บรีฟสั่ง "ไม่แข่งกับ fire-and-forget") — ตัว fire-and-forget ในคอมันของ
// caseSvc/repairSvc เองก็ยิงคู่ขนานไปด้วย (ไม่มีอะไรกันมัน) จึงอาจเห็น LINE_SENT/sendFromTemplate
// มากกว่า 1 ครั้งต่อเคส — assertion ด้านล่างใช้ toHaveBeenCalledWith (นับได้ว่าเคยถูกเรียกแบบนั้น
// ไม่ใช่ toHaveBeenCalledTimes) และกรอง events/calls ด้วย caseId ที่ตรงกันเท่านั้น เพื่อไม่ปนกัน.
// -----------------------------------------------------------------------------
describe('after-sales — LINE 3 จังหวะ (Task 3, PR3, เคส ก-ค)', () => {
  const LINE_PREFIX = 'AFTERSALESLINETEST-';
  const lineImeiA = `${LINE_PREFIX}${RUN}-A`; // (ก) มี lineIdShop
  const lineImeiB = `${LINE_PREFIX}${RUN}-B`; // (ข) ไม่มี lineIdShop
  const lineImeiC = `${LINE_PREFIX}${RUN}-C`; // (ค) markRepaired → returnToCustomer

  // สาขาของตัวเอง ไม่ยืมของ describe บนสุด — describe นั้น `afterAll` อาจลบ branch ของมันทิ้ง
  // (`branchCreatedFresh`) ก่อนที่ describe นี้จะเริ่มรัน (vitest รัน describe ตามลำดับในไฟล์ —
  // afterAll ของ describe ก่อนหน้าจบก่อน beforeAll/it ของ describe นี้เริ่มเสมอ)
  let lineBranchId: string;
  let lineBranchCreatedFresh = false;

  let custA: string, prodA: string, saleA: string, caseA: string, ticketA: string | null;
  let custB: string, prodB: string, saleB: string, caseB: string, ticketB: string | null;
  let custC: string, prodC: string, saleC: string, caseC: string, ticketC: string | null;
  let otherIncomeIdC: string | null = null;

  beforeAll(async () => {
    const branchName = '__after_sales_line_test_branch__';
    const existing = await prisma.branch.findFirst({
      where: { name: branchName, deletedAt: null },
    });
    if (existing) {
      lineBranchId = existing.id;
    } else {
      const shop = await prisma.companyInfo.findFirstOrThrow({
        where: { companyCode: 'SHOP', deletedAt: null },
      });
      const created = await prisma.branch.create({
        data: { name: branchName, companyId: shop.id },
      });
      lineBranchId = created.id;
      lineBranchCreatedFresh = true;
    }
  });

  async function seedCashSaleFixture(opts: { imei: string; tag: string; lineIdShop?: string }) {
    const customer = await prisma.customer.create({
      data: {
        name: `${LINE_PREFIX}Customer-${opts.tag}-${RUN}`,
        phone: `096${RUN_NUM}`.slice(0, 9) + opts.tag,
        ...(opts.lineIdShop ? { lineIdShop: opts.lineIdShop } : {}),
      },
    });
    const product = await prisma.product.create({
      data: {
        name: `${LINE_PREFIX}Phone-${opts.tag}`,
        brand: `${LINE_PREFIX}Brand`,
        model: `${LINE_PREFIX}Model-${opts.tag}`,
        storage: '128GB',
        imeiSerial: opts.imei,
        category: 'PHONE_USED',
        costPrice: new Prisma.Decimal('3000.00'),
        branchId: lineBranchId,
        status: 'SOLD_CASH',
      },
    });
    const threeDaysAgo = new Date(Date.now() - 3 * 86400_000);
    const ninetyDaysAhead = new Date(Date.now() + 90 * 86400_000);
    const sale = await prisma.sale.create({
      data: {
        saleNumber: `${LINE_PREFIX}${RUN}-${opts.tag}`,
        saleType: 'CASH',
        customerId: customer.id,
        productId: product.id,
        branchId: lineBranchId,
        salespersonId: adminId,
        sellingPrice: new Prisma.Decimal('3671.00'),
        netAmount: new Prisma.Decimal('3671.00'),
        createdAt: threeDaysAgo,
        shopWarrantyEndDate: ninetyDaysAhead,
      },
    });
    return { customerId: customer.id, productId: product.id, saleId: sale.id };
  }

  afterAll(async () => {
    const caseIds = [caseA, caseB, caseC].filter(Boolean) as string[];
    const ticketIds = [ticketA, ticketB, ticketC].filter(Boolean) as string[];
    const productIds = [prodA, prodB, prodC].filter(Boolean) as string[];
    const customerIds = [custA, custB, custC].filter(Boolean) as string[];
    const saleIds = [saleA, saleB, saleC].filter(Boolean) as string[];

    if (caseIds.length) {
      await prisma.afterSalesEvent.deleteMany({ where: { caseId: { in: caseIds } } });
      await prisma.afterSalesCase.deleteMany({ where: { id: { in: caseIds } } });
    }
    if (ticketIds.length) {
      await prisma.repairStatusLog.deleteMany({ where: { ticketId: { in: ticketIds } } });
      await prisma.repairTicket.deleteMany({ where: { id: { in: ticketIds } } });
    }
    if (otherIncomeIdC) {
      // ticketC (payer=CUSTOMER) → returnToCustomer สร้าง OtherIncome DRAFT จริง — ลบหลัง
      // repairTicket (ซึ่งอ้าง otherIncomeId) ถูกลบไปแล้วข้างบน
      await prisma.otherIncomeItem.deleteMany({ where: { otherIncomeId: otherIncomeIdC } });
      await prisma.otherIncome.deleteMany({ where: { id: otherIncomeIdC } });
    }
    if (saleIds.length) await prisma.sale.deleteMany({ where: { id: { in: saleIds } } });
    if (productIds.length) await prisma.product.deleteMany({ where: { id: { in: productIds } } });
    if (customerIds.length)
      await prisma.customer.deleteMany({ where: { id: { in: customerIds } } });
    if (lineBranchCreatedFresh && lineBranchId) {
      try {
        await prisma.branch.delete({ where: { id: lineBranchId } });
      } catch (error) {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2003') {
          throw error;
        }
      }
    }
  });

  // (ก) ลูกค้าตั้ง lineIdShop → createCase REPAIR → notifyMoment(RECEIVED) → LINE_SENT +
  // sendFromTemplate ด้วย caseNumber/branchName/liffLine ขึ้นต้น "ดูสถานะเคส: https://liff.line.me/liff-test/"
  it('ก) ลูกค้าตั้ง lineIdShop → createCase REPAIR → notifyMoment(RECEIVED) → LINE_SENT + sendFromTemplate ด้วย data ที่ถูกต้อง + lookup().lineLinked=true', async () => {
    const fx = await seedCashSaleFixture({ imei: lineImeiA, tag: 'A', lineIdShop: `Utest${RUN}A` });
    custA = fx.customerId;
    prodA = fx.productId;
    saleA = fx.saleId;

    const result = await caseSvc.createCase(
      {
        imei: lineImeiA,
        symptom: 'ทดสอบ LINE จังหวะที่ 1 (Task 3 เคส ก)',
        accessories: { box: false, charger: false, case: false },
        unlockConfirmed: true,
        outcome: 'REPAIR' as const,
        branchId: lineBranchId,
      } as never,
      [fakeJpeg('line-a-intake.jpg')],
      OWNER(),
    );
    caseA = result.id;
    ticketA = result.repairTicketId;

    // เรียกตรง ๆ อีกครั้ง (ไม่แข่งกับ fire-and-forget ของ createCase เอง) ให้มีจังหวะ await แน่นอน
    const notifyResult = await line.notifyMoment(caseA, 'RECEIVED', adminId);
    expect(notifyResult.status).toBe('SENT');

    const events = await prisma.afterSalesEvent.findMany({
      where: { caseId: caseA, kind: 'LINE_SENT' },
    });
    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events.some((e) => (e.note ?? '').startsWith('[AFTER_SALES_RECEIVED]'))).toBe(true);

    const call = notificationsFakeImpl.sendFromTemplate.mock.calls.find(
      (c: unknown[]) => (c[3] as { relatedId?: string })?.relatedId === caseA,
    );
    expect(call).toBeTruthy();
    const [eventType, data] = call as [string, Record<string, string>];
    expect(eventType).toBe('AFTER_SALES_RECEIVED');
    expect(data.caseNumber).toBe(result.caseNumber);
    expect(data.branchName).toBeTruthy();
    expect(data.liffLine).toMatch(/^ดูสถานะเคส: https:\/\/liff\.line\.me\/liff-test\//);

    // Step 2 ปิดวง — lookup ของสัญญาเดียวกันต้องรายงาน lineLinked=true
    const found = await lookupSvc.lookup({ imei: lineImeiA }, OWNER());
    expect(found.lineLinked).toBe(true);
    expect(found).not.toHaveProperty('customer.lineIdShop');
  });

  // (ข) ลูกค้าไม่มี lineIdShop → LINE_SKIPPED_NO_LINK, sendFromTemplate ไม่ถูกเรียก,
  // lookup().lineLinked === false
  it('ข) ลูกค้าไม่มี lineIdShop → LINE_SKIPPED_NO_LINK + sendFromTemplate ไม่ถูกเรียก + lookup().lineLinked=false', async () => {
    const fx = await seedCashSaleFixture({ imei: lineImeiB, tag: 'B' }); // ไม่ตั้ง lineIdShop
    custB = fx.customerId;
    prodB = fx.productId;
    saleB = fx.saleId;

    const result = await caseSvc.createCase(
      {
        imei: lineImeiB,
        symptom: 'ทดสอบ LINE จังหวะที่ 1 — ไม่มี lineIdShop (Task 3 เคส ข)',
        accessories: { box: false, charger: false, case: false },
        unlockConfirmed: true,
        outcome: 'REPAIR' as const,
        branchId: lineBranchId,
      } as never,
      [fakeJpeg('line-b-intake.jpg')],
      OWNER(),
    );
    caseB = result.id;
    ticketB = result.repairTicketId;

    const notifyResult = await line.notifyMoment(caseB, 'RECEIVED', adminId);
    expect(notifyResult.status).toBe('NO_LINK');

    const events = await prisma.afterSalesEvent.findMany({
      where: { caseId: caseB, kind: 'LINE_SKIPPED_NO_LINK' },
    });
    expect(events.length).toBeGreaterThanOrEqual(1);

    const called = notificationsFakeImpl.sendFromTemplate.mock.calls.some(
      (c: unknown[]) => (c[3] as { relatedId?: string })?.relatedId === caseB,
    );
    expect(called).toBe(false);

    const found = await lookupSvc.lookup({ imei: lineImeiB }, OWNER());
    expect(found.lineLinked).toBe(false);

    // Task 8 carry — getCase() ของเคสนี้ (ลูกค้าไม่ผูก LINE) ต้องรายงาน lineLinked=false,
    // timeline มีแถว LINE_SKIPPED_NO_LINK, และ lineEvents (Task 8 ใหม่) เห็นแถวเดียวกันนั้น
    // โดย note ยังขึ้นต้นด้วย tag ของจังหวะ RECEIVED
    const c = await querySvc.getCase(caseB, OWNER());
    expect(c.lineLinked).toBe(false);
    expect(c.timeline.some((t) => t.kind === 'LINE_SKIPPED_NO_LINK')).toBe(true);
    expect(c.lineEvents[0]).toMatchObject({ kind: 'LINE_SKIPPED_NO_LINK' });
    expect((c.lineEvents[0].note as string).startsWith('[AFTER_SALES_RECEIVED]')).toBe(true);
  });

  // (ค) markRepaired (ซ่อมที่ร้าน ผู้จ่ายลูกค้า 500) → READY costLine ตรง · returnToCustomer →
  // CLOSED warrantyLines มี "ประกันร้าน ถึง"
  it('ค) markRepaired ซ่อมที่ร้าน ผู้จ่ายลูกค้า 500 → READY costLine="ค่าซ่อม 500 บาท ชำระที่สาขา" · returnToCustomer → CLOSED warrantyLines มี "ประกันร้าน ถึง"', async () => {
    const fx = await seedCashSaleFixture({ imei: lineImeiC, tag: 'C', lineIdShop: `Utest${RUN}C` });
    custC = fx.customerId;
    prodC = fx.productId;
    saleC = fx.saleId;

    const created = await caseSvc.createCase(
      {
        imei: lineImeiC,
        symptom: 'ทดสอบ LINE จังหวะที่ 2/3 (Task 3 เคส ค)',
        accessories: { box: false, charger: false, case: false },
        unlockConfirmed: true,
        outcome: 'REPAIR' as const,
        branchId: lineBranchId,
      } as never,
      [fakeJpeg('line-c-intake.jpg')],
      OWNER(),
    );
    caseC = created.id;
    ticketC = created.repairTicketId;

    // ซ่อมที่ร้าน (ไม่ผ่าน send() — repairSupplierId เป็น null ตั้งแต่สร้าง) ผู้จ่ายลูกค้า 500
    await repairSvc.markRepaired(caseC, { actualCost: 500, payer: 'CUSTOMER' } as never, OWNER());

    await line.notifyMoment(caseC, 'READY', adminId);
    const readyCall = notificationsFakeImpl.sendFromTemplate.mock.calls.find(
      (c: unknown[]) =>
        (c[3] as { relatedId?: string })?.relatedId === caseC && c[0] === 'AFTER_SALES_READY',
    );
    expect(readyCall).toBeTruthy();
    const readyData = readyCall![1] as Record<string, string>;
    expect(readyData.costLine).toBe('ค่าซ่อม 500 บาท ชำระที่สาขา');

    await repairSvc.returnToCustomer(caseC, {} as never, OWNER());
    // R17 pattern — จับ otherIncomeId ไว้ทันที (payer=CUSTOMER → returnToCustomer สร้าง OtherIncome
    // DRAFT จริง) เพื่อให้ afterAll ลบได้ ไม่งั้น customer.deleteMany ชน FK ทีหลัง
    const ticketRowC = await prisma.repairTicket.findUniqueOrThrow({ where: { id: ticketC! } });
    otherIncomeIdC = ticketRowC.otherIncomeId;
    await line.notifyMoment(caseC, 'CLOSED', adminId);
    const closedCall = notificationsFakeImpl.sendFromTemplate.mock.calls.find(
      (c: unknown[]) =>
        (c[3] as { relatedId?: string })?.relatedId === caseC && c[0] === 'AFTER_SALES_CLOSED',
    );
    expect(closedCall).toBeTruthy();
    const closedData = closedCall![1] as Record<string, string>;
    expect(closedData.warrantyLines).toContain('ประกันร้าน ถึง');
  });
});
