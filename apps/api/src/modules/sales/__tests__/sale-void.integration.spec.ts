/**
 * Void-sale Task 5 — ยกเลิกใบขายพิสูจน์บน DB จริง
 *
 * ทุกการเปลี่ยนสถานะมาจาก service จริง (`SalesService.create` / `SaleVoidService.voidSale` /
 * `CommissionService.generatePayouts+approvePayout+approve+markPaid` /
 * `FinanceReceivableService.recordReceive`) — **ห้าม** `prisma.product.update({ status })`
 * ตั้งฉาก (pattern เดียวกับ product-lifecycle.integration.spec.ts)
 *
 * ข้อยกเว้นที่ตั้งใจ (documented เหมือน `contract.status = TERMINATED` ของเพื่อนบ้าน):
 *   - `salesCommission.period` ถูกย้ายไปงวดสังเคราะห์ (2905-XX) ด้วย prisma ตรง ๆ ในเคส
 *     รอบจ่าย (G4b) — period เป็นป้ายจัดกลุ่มที่คำนวณจากนาฬิกาข้อเครื่อง (`new Date()` ใน
 *     sale-writer) ไม่ใช่สถานะที่มีด่านคุม การย้ายจึงเทียบเท่า "รันเทสคนละเดือน" เท่านั้น
 *     เหตุที่จำเป็น: `generatePayouts(period)` กวาดค่าคอม **ทุกคน** ในงวดนั้นทั้ง DB —
 *     ใช้งวดจริงบน dev DB ที่แชร์กันจะสร้าง/แตะรอบจ่ายของข้อมูลคนอื่น. ความสัมพันธ์ที่
 *     ด่าน G4b ใช้จริง (period ตรงกันระหว่างค่าคอมกับรอบจ่าย + `createdAt <= generatedAt`)
 *     ถูกรักษาไว้ครบทุกเคส
 *
 * เคส (ตาม task brief + คำสั่ง Task 5):
 *   1. ขายสด+ของแถม → void → คืนสต็อกทั้งสองชิ้น / JE สุทธิศูนย์ทุกบัญชี / ค่าคอม
 *      CLAWED_BACK / ขายเครื่องเดิมใหม่ได้จริง
 *   2. ขายผ่านไฟแนนซ์ภายนอก (+ของแถม) → void → receivable ถูกยกเลิก / ไม่มี JE / ไม่แตะค่าคอม
 *   3. G3 ไฟแนนซ์โอนแล้ว → ปฏิเสธ + ไม่มีอะไรถูกเขียน
 *   4. G4 ค่าคอม PAID → ปฏิเสธ + ไม่มีอะไรถูกเขียน
 *   5. G4b DRAFT → ร่างถูก soft-delete + audit + generate ใหม่ได้ยอดถูก
 *   6. G4b APPROVED → ปฏิเสธ + ไม่มีอะไรถูกเขียน
 *   7. G4b คีย์ขายหลังรอบ → void ได้ (generatedAt พิสูจน์ว่าไม่อยู่ในรอบ) + รอบเดิมไม่ถูกแตะ
 *   8. G1 ยกเลิกซ้ำ → ปฏิเสธ + ไม่มี JE ใบสอง
 *   9. Branch scope: BM ต่างสาขา → Forbidden + ไม่มีอะไรถูกเขียน; BM สาขาตัวเอง → ได้
 *   + F1 regression: ขายสด+ของแถมที่มีต้นทุน → JE ต่อชิ้น reference ไม่ชนกัน + void กวาด
 *     ครบทุกใบ (บั๊ก production เดิมจาก PR #1285 ชน migration 20260428010000 — แก้แล้ว
 *     ในคอมมิตนี้: reference = `sale:<saleId>:<productId>`)
 *
 * G5 (เครื่องถูกผูกต่อ) ไม่อยู่ในไฟล์นี้โดยตั้งใจ: การพาเครื่อง SOLD_CASH/SOLD_INSTALLMENT
 * ไปสถานะอื่น "ผ่าน service จริง" ถูกด่านของระบบเองกันไว้หมด (จะต้องตั้งฉากด้วย
 * prisma.product.update ซึ่งไฟล์นี้ห้าม) — ด่าน G5 มี unit coverage ครบใน
 * sale-void.service.spec.ts และชั้น util ถูกพิสูจน์บน DB จริงแล้วใน product-lifecycle spec
 *
 * Runner: vitest (jest ignore `*.integration.spec.ts`). ต้องมี DB จริง:
 *   cd apps/api && npx vitest run --no-file-parallelism \
 *     src/modules/sales/__tests__/sale-void.integration.spec.ts
 *
 * CI: glob `SALES_FILES` ใน `.github/workflows/deploy-gcp.yml`
 * (`src/modules/sales/__tests__/*.integration.spec.ts`) — เพิ่มพร้อมไฟล์นี้
 *
 * Cleanup: SCOPED ตาม id ที่สเปคนี้สร้าง + สวีปตาม prefix `VOIDTEST-` + ยืนยันท้ายรันว่า
 * เหลือ 0 แถว (`audit_logs` ลบไม่ได้ — DB trigger ทำให้ immutable ตามดีไซน์; ผู้ใช้ BM
 * ที่ปรากฏใน audit จึงเป็น find-or-create ถาวรแบบเดียวกับ admin)
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { seedFinanceCoa } from '../../../../prisma/seed-coa-finance';
import { seedShopCoa } from '../../../../prisma/seed-coa-shop';
import { SalesService } from '../sales.service';
import { SaleVoidService } from '../services/sale-void.service';
import type { VoidSaleActor } from '../services/sale-void.service';
import { CommissionService } from '../../commission/commission.service';
import { FinanceReceivableService } from '../../finance-receivable/finance-receivable.service';
import { JournalAutoService } from '../../journal/journal-auto.service';
import { CompanyResolverService } from '../../journal/company-resolver.service';
import { ShopAccountResolver } from '../../journal/shop-account-resolver.service';
import { ShopExternalFinanceSaleTemplate } from '../../journal/cpa-templates/shop-external-finance-sale.template';
import { ShopCashSaleTemplate } from '../../journal/cpa-templates/shop-cash-sale.template';
import { ExchangeCancelReversalTemplate } from '../../journal/cpa-templates/exchange-cancel-reversal.template';

const prisma = new PrismaClient();

// ---------------------------------------------------------------------------
// Service wiring (instance จริง ไม่ผ่าน Nest DI — pattern เดียวกับ
// product-lifecycle / exchange-priced-flow integration specs)
// ---------------------------------------------------------------------------
const journal = new JournalAutoService(prisma as never);
const companyResolver = new CompanyResolverService(prisma as never);
const shopAccountResolver = new ShopAccountResolver(prisma as never);

// POS — interCompanyService ใช้เฉพาะเส้นทางขายผ่อนของเรา (INSTALLMENT) ซึ่งไฟล์นี้ไม่แตะ
const salesService = new SalesService(
  prisma as never,
  null as never,
  new ShopCashSaleTemplate(journal, prisma as never, companyResolver),
  shopAccountResolver,
  // C1 — ข้ามเองถ้าผังยังไม่มี S11-3101/S51-1106 (รอคำวินิจฉัยผู้สอบ)
  new ShopExternalFinanceSaleTemplate(journal, prisma as never, companyResolver),
);

const saleVoidService = new SaleVoidService(
  prisma as never,
  new ExchangeCancelReversalTemplate(journal, prisma as never),
);

const commissionService = new CommissionService(prisma as never);
const financeReceivableService = new FinanceReceivableService(prisma as never);

// ---------------------------------------------------------------------------
const PREFIX = 'VOIDTEST-';
const RUN = Date.now().toString(36).toUpperCase();
const RUN_NUM = String(Date.now() % 1_000_000).padStart(6, '0');
const FINCO = 'VOIDTEST-FINCO';
const VOID_FLOW = 'shop-cash-sale-void';

// งวดสังเคราะห์ของเคสรอบจ่าย — อนาคตไกลพอที่ค่าคอมจริงไม่มีวันตกงวดนี้ และ fix ค่าไว้
// เพื่อให้ cleanup ของรันถัดไปกวาดซาก (ถ้ารันก่อนหน้า crash กลางทาง) ได้ด้วย
const P5 = '2905-01';
const P6 = '2905-02';
const P7 = '2905-03';
const SYNTH_PERIODS = [P5, P6, P7];

const dec = (s: string) => new Decimal(s);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// Tracked rows (SCOPED cleanup)
// ---------------------------------------------------------------------------
const createdSaleIds: string[] = [];
const createdProductIds: string[] = [];
const createdCustomerIds: string[] = [];
const createdUserIds: string[] = []; // เฉพาะ salesperson ต่อรัน — BM/admin เป็นผู้ใช้ถาวร
const createdBranchIds: string[] = [];

let adminId: string;
let bmUserId: string; // find-or-create ถาวร (โผล่ใน audit_logs ที่ immutable — ลบไม่ได้)
let shopCompanyId: string;
let branchId: string;
let branchBId: string;

const OWNER = (): VoidSaleActor => ({ id: adminId, role: 'OWNER', branchId });

// ---------------------------------------------------------------------------
// Seed helpers
// ---------------------------------------------------------------------------
async function seedProduct(tag: string, opts: { costPrice?: string; cashPrice?: string } = {}) {
  const product = await prisma.product.create({
    data: {
      name: `${PREFIX}Phone ${tag}`,
      brand: `${PREFIX}Brand`,
      model: `${PREFIX}Model-${tag}`,
      storage: '128GB',
      imeiSerial: `${PREFIX}${RUN}-${tag}`,
      category: 'PHONE_NEW',
      costPrice: dec(opts.costPrice ?? '6000.00'),
      ...(opts.cashPrice ? { cashPrice: dec(opts.cashPrice) } : {}),
      branchId,
      status: 'IN_STOCK',
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

/** พนักงานขายเฉพาะรัน — แยกคนต่อเคสรอบจ่าย กันชนกับข้อมูล dev จริง (payout unique ต่อคน+งวด) */
async function seedSalesperson(tag: string) {
  const user = await prisma.user.create({
    data: {
      email: `voidtest-${RUN.toLowerCase()}-${tag}@test.local`,
      password: 'x',
      name: `${PREFIX}Sales ${tag}`,
      role: 'SALES',
    },
  });
  createdUserIds.push(user.id);
  return user;
}

/** ขายสดผ่านเส้นทางจริงของ POS (`SalesService.create`) */
async function cashSale(opts: {
  customerId: string;
  productId: string;
  sellingPrice: number;
  bundleProductIds?: string[];
  salespersonId?: string;
}) {
  const sale = (await salesService.create(
    {
      saleType: 'CASH',
      customerId: opts.customerId,
      productId: opts.productId,
      branchId,
      sellingPrice: opts.sellingPrice,
      paymentMethod: 'BANK_TRANSFER',
      amountReceived: opts.sellingPrice,
      bundleProductIds: opts.bundleProductIds ?? [],
    } as never,
    opts.salespersonId ?? adminId,
    'OWNER',
  )) as { id: string };
  createdSaleIds.push(sale.id);
  return sale;
}

/** ขายผ่านไฟแนนซ์ภายนอกผ่านเส้นทางจริง (`SalesService.create`) */
async function externalFinanceSale(opts: {
  customerId: string;
  productId: string;
  sellingPrice: number;
  bundleProductIds?: string[];
}) {
  const sale = (await salesService.create(
    {
      saleType: 'EXTERNAL_FINANCE',
      customerId: opts.customerId,
      productId: opts.productId,
      branchId,
      sellingPrice: opts.sellingPrice,
      paymentMethod: 'BANK_TRANSFER',
      financeCompany: FINCO,
      financeAmount: opts.sellingPrice,
      downPayment: 0,
      bundleProductIds: opts.bundleProductIds ?? [],
    } as never,
    adminId,
    'OWNER',
  )) as { id: string };
  createdSaleIds.push(sale.id);
  return sale;
}

/**
 * ย้ายค่าคอมของใบขายไปงวดสังเคราะห์ — ข้อยกเว้นที่ documented ไว้หัวไฟล์:
 * period มาจากนาฬิกา ไม่ใช่สถานะที่มีด่านคุม; ความสัมพันธ์ที่ G4b ใช้
 * (period ตรงกัน + `createdAt <= generatedAt`) ไม่ถูกแตะ
 */
async function moveCommissionPeriod(saleId: string, period: string) {
  await prisma.salesCommission.updateMany({ where: { saleId }, data: { period } });
}

// ---------------------------------------------------------------------------
// Assertion helpers
// ---------------------------------------------------------------------------

/**
 * Dr − Cr ต่อบัญชี ของ JE ทุกใบที่เกี่ยวกับใบขายนี้ (ใบเดิม stamp `metadata.saleId` +
 * ใบกลับรายการที่ระบุ id ตรง ๆ — mirror ของ sweep engine **ไม่** carry saleId มาด้วย
 * จึงต้องส่ง id แยก)
 */
async function netByAccount(saleId: string, reversalJeIds: string[]) {
  const entries = await prisma.journalEntry.findMany({
    where: {
      OR: [
        { metadata: { path: ['saleId'], equals: saleId } as never },
        { id: { in: reversalJeIds } },
      ],
      status: 'POSTED',
      deletedAt: null,
    },
    include: { lines: true },
  });
  const net: Record<string, Decimal> = {};
  for (const e of entries) {
    for (const l of e.lines) {
      net[l.accountCode] = (net[l.accountCode] ?? new Decimal(0))
        .plus(l.debit ?? 0)
        .minus(l.credit ?? 0);
    }
  }
  return { net, entries };
}

/** id ของ JE กลับรายการ จาก entryNumber ที่ service คืนมา */
async function reversalIdsOf(entryNumbers: string[]) {
  if (entryNumbers.length === 0) return [];
  const rows = await prisma.journalEntry.findMany({
    where: { entryNumber: { in: entryNumbers } },
    select: { id: true },
  });
  expect(rows.length).toBe(entryNumbers.length);
  return rows.map((r) => r.id);
}

/**
 * ภาพรวม state ทุกตารางที่ void แตะได้ — ใช้พิสูจน์ "ไม่มีอะไรถูกเขียน" ของเคส guard
 * (ถ่ายก่อน → ยิง void ให้โดนปฏิเสธ → ถ่ายอีกครั้ง → ต้อง deep-equal)
 */
async function snapshotState(saleId: string) {
  const sale = await prisma.sale.findUniqueOrThrow({ where: { id: saleId } });
  const productIds = [sale.productId, ...sale.bundleProductIds];
  const products = await prisma.product.findMany({
    where: { id: { in: productIds } },
    orderBy: { id: 'asc' },
    select: { id: true, status: true, deletedAt: true },
  });
  const commissions = await prisma.salesCommission.findMany({
    where: { saleId },
    orderBy: { id: 'asc' },
    select: { id: true, status: true, deletedAt: true },
  });
  const receivables = await prisma.financeReceivable.findMany({
    where: { saleId },
    orderBy: { id: 'asc' },
    select: { id: true, status: true, receivedAmount: true, deletedAt: true },
  });
  const payouts = await prisma.commissionPayout.findMany({
    where: { period: { in: SYNTH_PERIODS } },
    orderBy: { id: 'asc' },
    select: { id: true, status: true, deletedAt: true, totalCommission: true, generatedAt: true },
  });
  // metadata รวมอยู่ด้วย — ถ้า void วิ่งไปถึงขั้น stamp `reversed:true` แล้วค่อยพัง
  // ความต่างจะโผล่ตรงนี้
  const jes = await prisma.journalEntry.findMany({
    where: { metadata: { path: ['saleId'], equals: saleId } as never },
    orderBy: { id: 'asc' },
    select: { id: true, status: true, deletedAt: true, metadata: true },
  });
  const voidJeCount = await prisma.journalEntry.count({
    where: { metadata: { path: ['flow'], equals: VOID_FLOW } as never },
  });
  return {
    sale: { deletedAt: sale.deletedAt, voidReason: sale.voidReason, voidedById: sale.voidedById },
    products,
    commissions,
    receivables,
    payouts,
    jes,
    voidJeCount,
  };
}

// ---------------------------------------------------------------------------
describe('ยกเลิกใบขาย — flow จริงบน DB จริง (void-sale Task 5)', () => {
  beforeAll(async () => {
    await seedFinanceCoa(prisma);
    await seedShopCoa(prisma);

    const shop = await prisma.companyInfo.findFirstOrThrow({
      where: { companyCode: 'SHOP', deletedAt: null },
    });
    shopCompanyId = shop.id;

    let admin = await prisma.user.findFirst({ where: { email: 'admin@bestchoice.com' } });
    if (!admin) {
      admin = await prisma.user.create({
        data: { email: 'admin@bestchoice.com', password: 'x', name: 'admin', role: 'OWNER' },
      });
    }
    adminId = admin.id;

    // BM ถาวร (เขียน audit SALE_VOIDED ในเคส 9 — audit_logs immutable ⇒ ลบผู้ใช้ไม่ได้
    // จึงใช้ find-or-create แบบเดียวกับ admin แทนการสร้าง/ลบต่อรัน)
    let bm = await prisma.user.findFirst({ where: { email: 'voidtest.bm@bestchoice.com' } });
    if (!bm) {
      bm = await prisma.user.create({
        data: {
          email: 'voidtest.bm@bestchoice.com',
          password: 'x',
          name: 'voidtest bm',
          role: 'BRANCH_MANAGER',
        },
      });
    }
    bmUserId = bm.id;

    for (const [name, setter] of [
      ['__voidtest_branch__', (id: string) => (branchId = id)],
      ['__voidtest_branch_b__', (id: string) => (branchBId = id)],
    ] as const) {
      const existing = await prisma.branch.findFirst({ where: { name, deletedAt: null } });
      if (existing) {
        setter(existing.id);
      } else {
        const branch = await prisma.branch.create({
          data: { name, companyId: shopCompanyId, shopCashAccountCode: 'S11-1101' },
        });
        setter(branch.id);
        createdBranchIds.push(branch.id);
      }
    }
  }, 180_000);

  afterAll(async () => {
    // ── รวม JE ทั้งหมดของสเปคนี้: ใบเดิม (metadata.saleId) + mirror (originalEntryId) ──
    const jeIds = new Set<string>();
    for (const sid of createdSaleIds) {
      const rows = await prisma.journalEntry.findMany({
        where: { metadata: { path: ['saleId'], equals: sid } as never },
        select: { id: true },
      });
      rows.forEach((r) => jeIds.add(r.id));
    }
    for (const oid of [...jeIds]) {
      const rows = await prisma.journalEntry.findMany({
        where: { metadata: { path: ['originalEntryId'], equals: oid } as never },
        select: { id: true },
      });
      rows.forEach((r) => jeIds.add(r.id));
    }
    const jeIdList = [...jeIds];

    await prisma.journalPostAuditLog.deleteMany({ where: { journalEntryId: { in: jeIdList } } });
    await prisma.journalLine.deleteMany({ where: { journalEntryId: { in: jeIdList } } });
    await prisma.journalEntry.deleteMany({ where: { id: { in: jeIdList } } });

    await prisma.salesCommission.deleteMany({
      where: { OR: [{ saleId: { in: createdSaleIds } }, { period: { in: SYNTH_PERIODS } }] },
    });
    // งวดสังเคราะห์เป็นของสเปคนี้คนเดียว — กวาดทั้งงวด เก็บซากของรันที่ crash ค้างด้วย
    await prisma.commissionPayout.deleteMany({ where: { period: { in: SYNTH_PERIODS } } });
    await prisma.financeReceivable.deleteMany({ where: { saleId: { in: createdSaleIds } } });
    await prisma.sale.deleteMany({ where: { id: { in: createdSaleIds } } });
    await prisma.productPrice.deleteMany({ where: { productId: { in: createdProductIds } } });
    await prisma.productReservation.deleteMany({
      where: { productId: { in: createdProductIds } },
    });
    await prisma.product.deleteMany({ where: { id: { in: createdProductIds } } });
    await prisma.customer.deleteMany({ where: { id: { in: createdCustomerIds } } });
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });

    // ตาข่ายสุดท้าย: แถวที่ flow จริงสร้างนอกรายการ id ที่จดไว้
    await prisma.product.deleteMany({ where: { imeiSerial: { startsWith: PREFIX } } });
    await prisma.customer.deleteMany({ where: { nationalId: { startsWith: PREFIX } } });
    try {
      await prisma.externalFinanceCompany.deleteMany({ where: { name: FINCO } });
    } catch {
      // ยังถูกอ้างโดยแถวนอกขอบเขตสเปคนี้ (เช่นซากรันเก่า) — ปล่อยไว้
    }
    for (const id of createdBranchIds) {
      try {
        await prisma.branch.delete({ where: { id } });
      } catch {
        // ถูกอ้างอิงโดยแถวนอกขอบเขตสเปคนี้ — ปล่อยไว้ (รันหน้า find-or-create ใช้ซ้ำ)
      }
    }

    // ── ยืนยันว่าเหลือ 0 แถว (audit_logs ยกเว้น — immutable by design) ──
    const leftovers: Record<string, number> = {
      products: await prisma.product.count({ where: { imeiSerial: { startsWith: PREFIX } } }),
      customers: await prisma.customer.count({ where: { nationalId: { startsWith: PREFIX } } }),
      sales: createdSaleIds.length
        ? await prisma.sale.count({ where: { id: { in: createdSaleIds } } })
        : 0,
      journalEntries: jeIdList.length
        ? await prisma.journalEntry.count({ where: { id: { in: jeIdList } } })
        : 0,
      commissions: createdSaleIds.length
        ? await prisma.salesCommission.count({ where: { saleId: { in: createdSaleIds } } })
        : 0,
      payouts: await prisma.commissionPayout.count({ where: { period: { in: SYNTH_PERIODS } } }),
      receivables: createdSaleIds.length
        ? await prisma.financeReceivable.count({ where: { saleId: { in: createdSaleIds } } })
        : 0,
      users: createdUserIds.length
        ? await prisma.user.count({ where: { id: { in: createdUserIds } } })
        : 0,
    };
    const dirty = Object.entries(leftovers).filter(([, n]) => n > 0);
    await prisma.$disconnect();
    if (dirty.length > 0) {
      throw new Error(
        `cleanup ไม่หมดจด — เหลือแถวค้าง: ${dirty.map(([k, n]) => `${k}=${n}`).join(', ')}`,
      );
    }
  }, 180_000);

  // -------------------------------------------------------------------------
  // F1 regression (บั๊ก production เดิมจาก PR #1285 — แก้ในคอมมิตนี้): เดิม JE ต่อชิ้น
  // ของขายสดพ่วงของแถม "ที่มีต้นทุน" ใช้ `reference: sale:<saleId>` ซ้ำกัน ชน partial
  // unique `journal_entries_ref_unique` (migration 20260428010000) ⇒ P2002 ทั้งใบล่ม.
  // ตอนนี้ reference = `sale:<saleId>:<productId>` (unique ต่อชิ้นโดยโครงสร้าง) —
  // เทสนี้ปักทั้งการสร้างสำเร็จ + รูปแบบ reference + void กวาดครบทั้งสองใบ
  // -------------------------------------------------------------------------
  it(
    'F1 regression: ขายสด+ของแถมที่มีต้นทุน → สร้างสำเร็จ, JE ต่อชิ้น reference ไม่ซ้ำ, void กวาดครบทุกใบสุทธิศูนย์',
    async () => {
      const main = await seedProduct('Z1', { costPrice: '6000.00' });
      const bundle = await seedProduct('Z2', { costPrice: '500.00' });
      const customer = await seedCustomer('Z1');

      const sale = await cashSale({
        customerId: customer.id,
        productId: main.id,
        sellingPrice: 9900,
        bundleProductIds: [bundle.id],
      });

      // JE ต่อชิ้น 2 ใบ + reference unique ต่อ (ใบขาย, ชิ้น) — regression surface ของ F1
      const originals = await prisma.journalEntry.findMany({
        where: { metadata: { path: ['saleId'], equals: sale.id } as never },
        select: { id: true, referenceId: true },
      });
      expect(originals.length).toBe(2);
      expect(new Set(originals.map((o) => o.referenceId)).size).toBe(2);
      expect(originals.map((o) => o.referenceId).sort()).toEqual(
        [`sale:${sale.id}:${main.id}`, `sale:${sale.id}:${bundle.id}`].sort(),
      );

      // void ต้องกวาด (metadata.saleId) เจอทั้งสองใบ — mirror ครบ + สุทธิศูนย์ทุกบัญชี
      const res = await saleVoidService.voidSale(sale.id, OWNER(), 'คีย์ผิดรุ่น');
      expect(res.reversalEntryNumbers.length).toBe(2);
      const reversalJeIds = await reversalIdsOf(res.reversalEntryNumbers);
      const { net, entries } = await netByAccount(sale.id, reversalJeIds);
      expect(entries.length).toBe(4);
      expect(Object.keys(net).length).toBeGreaterThan(0);
      for (const [code, amount] of Object.entries(net)) {
        expect(amount.toFixed(2), `บัญชี ${code} ต้องสุทธิเป็นศูนย์`).toBe('0.00');
      }
      // ใบเดิมทุกใบถูก stamp reversed (ไม่มีใบไหนหลุดการกวาด)
      const stamped = await prisma.journalEntry.findMany({
        where: { id: { in: originals.map((o) => o.id) } },
        select: { metadata: true },
      });
      for (const je of stamped) {
        expect((je.metadata as { reversed?: boolean }).reversed).toBe(true);
      }
      expect(
        (await prisma.product.findUniqueOrThrow({ where: { id: main.id } })).status,
      ).toBe('IN_STOCK');
      expect(
        (await prisma.product.findUniqueOrThrow({ where: { id: bundle.id } })).status,
      ).toBe('IN_STOCK');
    },
    180_000,
  );

  // -------------------------------------------------------------------------
  it(
    'เคส 1: ขายสด+ของแถม → ยกเลิก → คืนสต็อกทั้งคู่, JE สุทธิศูนย์ทุกบัญชี, ค่าคอม CLAWED_BACK, ขายเครื่องเดิมใหม่ได้',
    async () => {
      const s1 = await seedSalesperson('A0');
      const main = await seedProduct('A1', { costPrice: '6000.00', cashPrice: '9900.00' });
      const bundle = await seedProduct('A2', { costPrice: '500.00' });
      const customer = await seedCustomer('A1');
      const buyer2 = await seedCustomer('A2');

      const sale = await cashSale({
        customerId: customer.id,
        productId: main.id,
        sellingPrice: 9900,
        bundleProductIds: [bundle.id],
        salespersonId: s1.id,
      });

      // ฉากตั้งโดย flow จริง: หลัก+ของแถม SOLD_CASH, JE 1 ใบต่อชิ้น (allocation ตามต้นทุน
      // — เดินได้เพราะ F1 ถูกแก้: reference ต่อชิ้น ไม่ชน journal_entries_ref_unique)
      expect(
        (await prisma.product.findUniqueOrThrow({ where: { id: main.id } })).status,
      ).toBe('SOLD_CASH');
      expect(
        (await prisma.product.findUniqueOrThrow({ where: { id: bundle.id } })).status,
      ).toBe('SOLD_CASH');
      const originals = await prisma.journalEntry.findMany({
        where: { metadata: { path: ['saleId'], equals: sale.id } as never },
        select: { id: true },
      });
      expect(originals.length).toBe(2);

      // ── ยกเลิก ──
      const res = await saleVoidService.voidSale(sale.id, OWNER(), 'คีย์ผิดรุ่น');
      expect(res.restoredProductIds.sort()).toEqual([main.id, bundle.id].sort());
      expect(res.reversalEntryNumbers.length).toBe(2);

      // สินค้าหลัก + ของแถมกลับ IN_STOCK
      expect(
        (await prisma.product.findUniqueOrThrow({ where: { id: main.id } })).status,
      ).toBe('IN_STOCK');
      expect(
        (await prisma.product.findUniqueOrThrow({ where: { id: bundle.id } })).status,
      ).toBe('IN_STOCK');

      // JE สุทธิเป็นศูนย์ทุกบัญชี — ต้องมี JE จริงก่อน (กันผ่านเพราะว่างเปล่า)
      const reversalJeIds = await reversalIdsOf(res.reversalEntryNumbers);
      const { net, entries } = await netByAccount(sale.id, reversalJeIds);
      expect(entries.length).toBe(4); // ใบเดิม 2 + กลับรายการ 2
      expect(Object.keys(net).length).toBeGreaterThan(0);
      for (const [code, amount] of Object.entries(net)) {
        expect(amount.toFixed(2), `บัญชี ${code} ต้องสุทธิเป็นศูนย์`).toBe('0.00');
      }
      // mirror ทุกใบเป็น flow ของ void จริง ๆ ไม่ใช่ JE อื่นบังเอิญติดมา
      const reversals = await prisma.journalEntry.findMany({
        where: { id: { in: reversalJeIds } },
        select: { metadata: true },
      });
      for (const r of reversals) {
        expect((r.metadata as { flow?: string }).flow).toBe(VOID_FLOW);
      }

      // ค่าคอม → CLAWED_BACK
      const commission = await prisma.salesCommission.findFirstOrThrow({
        where: { saleId: sale.id },
      });
      expect(commission.status).toBe('CLAWED_BACK');

      // ใบขาย → ยกเลิก + เหตุผล + ผู้กด + audit
      const voided = await prisma.sale.findUniqueOrThrow({ where: { id: sale.id } });
      expect(voided.deletedAt).not.toBeNull();
      expect(voided.voidReason).toBe('คีย์ผิดรุ่น');
      expect(voided.voidedById).toBe(adminId);
      const audit = await prisma.auditLog.findFirst({
        where: { action: 'SALE_VOIDED', entity: 'sale', entityId: sale.id },
      });
      expect(audit, 'ต้องมี AuditLog SALE_VOIDED ในทรานแซกชันเดียวกัน').toBeTruthy();

      // ── ขายเครื่องเดิมใหม่ได้จริง (เส้นทาง POS เดิม ไม่ใช่แค่เช็คสถานะ) ──
      const sale2 = await cashSale({
        customerId: buyer2.id,
        productId: main.id,
        sellingPrice: 9500,
        salespersonId: s1.id,
      });
      expect(sale2.id).toBeTruthy();
      expect(
        (await prisma.product.findUniqueOrThrow({ where: { id: main.id } })).status,
      ).toBe('SOLD_CASH');
      expect(
        await prisma.journalEntry.count({
          where: { metadata: { path: ['saleId'], equals: sale2.id } as never },
        }),
      ).toBe(1);
    },
    180_000,
  );

  // -------------------------------------------------------------------------
  it(
    'เคส 2: ขายผ่านไฟแนนซ์ภายนอก (+ของแถม) → ยกเลิก → receivable ถูกยกเลิก, ไม่มี JE ให้กลับ (ไม่ throw), ไม่แตะค่าคอม',
    async () => {
      const main = await seedProduct('B1');
      const bundle = await seedProduct('B2', { costPrice: '400.00' });
      const customer = await seedCustomer('B1');

      const sale = await externalFinanceSale({
        customerId: customer.id,
        productId: main.id,
        sellingPrice: 12000,
        bundleProductIds: [bundle.id],
      });

      // ฉากจาก flow จริง: หลัก SOLD_INSTALLMENT / ของแถม SOLD_CASH (สองสถานะในใบเดียว —
      // พิสูจน์ BUNDLE_PRODUCT_STATUS ของด่าน G5 บนข้อมูลจริง), ไม่มี JE, ไม่มีค่าคอม
      expect(
        (await prisma.product.findUniqueOrThrow({ where: { id: main.id } })).status,
      ).toBe('SOLD_INSTALLMENT');
      expect(
        (await prisma.product.findUniqueOrThrow({ where: { id: bundle.id } })).status,
      ).toBe('SOLD_CASH');
      expect(
        await prisma.journalEntry.count({
          where: { metadata: { path: ['saleId'], equals: sale.id } as never },
        }),
      ).toBe(0);
      expect(await prisma.salesCommission.count({ where: { saleId: sale.id } })).toBe(0);
      const receivable = await prisma.financeReceivable.findFirstOrThrow({
        where: { saleId: sale.id },
      });
      expect(receivable.status).toBe('PENDING');

      // ── ยกเลิก — ไม่มี JE ให้กลับรายการ ต้องไม่ throw ──
      const res = await saleVoidService.voidSale(sale.id, OWNER(), 'ไฟแนนซ์ไม่อนุมัติ');
      expect(res.reversalEntryNumbers).toEqual([]);

      expect(
        (await prisma.product.findUniqueOrThrow({ where: { id: main.id } })).status,
      ).toBe('IN_STOCK');
      expect(
        (await prisma.product.findUniqueOrThrow({ where: { id: bundle.id } })).status,
      ).toBe('IN_STOCK');
      const receivableAfter = await prisma.financeReceivable.findUniqueOrThrow({
        where: { id: receivable.id },
      });
      expect(receivableAfter.deletedAt).not.toBeNull();
      // ไม่แตะค่าคอม — ใบขายชนิดนี้ไม่สร้างค่าคอมตั้งแต่แรก และ void ต้องไม่เสกขึ้นมา
      expect(await prisma.salesCommission.count({ where: { saleId: sale.id } })).toBe(0);
      expect(
        (await prisma.sale.findUniqueOrThrow({ where: { id: sale.id } })).deletedAt,
      ).not.toBeNull();
    },
    180_000,
  );

  // -------------------------------------------------------------------------
  it(
    'เคส 3 (G3): ไฟแนนซ์โอนเงินมาแล้ว → ปฏิเสธ และไม่มีอะไรถูกเขียนเลย',
    async () => {
      const main = await seedProduct('C1');
      const customer = await seedCustomer('C1');
      const sale = await externalFinanceSale({
        customerId: customer.id,
        productId: main.id,
        sellingPrice: 15000,
      });

      // เงินเข้าจริงผ่าน service จริง (ไม่ตั้งสถานะเอง)
      const receivable = await prisma.financeReceivable.findFirstOrThrow({
        where: { saleId: sale.id },
      });
      await financeReceivableService.recordReceive(
        receivable.id,
        { receivedAmount: 15000, receivedDate: new Date().toISOString(), bankRef: 'VOIDTEST-TX' },
        adminId,
      );
      expect(
        (await prisma.financeReceivable.findUniqueOrThrow({ where: { id: receivable.id } }))
          .status,
      ).toBe('RECEIVED');

      const before = await snapshotState(sale.id);
      await expect(
        saleVoidService.voidSale(sale.id, OWNER(), 'คีย์ผิด'),
      ).rejects.toThrow(/โอนเงินของใบขายนี้มาแล้ว/);
      const after = await snapshotState(sale.id);
      expect(after).toEqual(before); // ทุกตารางเท่าเดิมทุกไบต์
    },
    180_000,
  );

  // -------------------------------------------------------------------------
  it(
    'เคส 4 (G4): ค่าคอม PAID → ปฏิเสธ และไม่มีอะไรถูกเขียน',
    async () => {
      const s4 = await seedSalesperson('D0');
      const main = await seedProduct('D1');
      const customer = await seedCustomer('D1');
      const sale = await cashSale({
        customerId: customer.id,
        productId: main.id,
        sellingPrice: 9900,
        salespersonId: s4.id,
      });

      // จ่ายค่าคอมผ่านเส้นทางจริง: approve (admin ≠ ผู้รับ — SoD) → markPaid
      const commission = await prisma.salesCommission.findFirstOrThrow({
        where: { saleId: sale.id },
      });
      await commissionService.approve(commission.id, adminId);
      await commissionService.markPaid(commission.id);
      expect(
        (await prisma.salesCommission.findUniqueOrThrow({ where: { id: commission.id } }))
          .status,
      ).toBe('PAID');

      const before = await snapshotState(sale.id);
      await expect(
        saleVoidService.voidSale(sale.id, OWNER(), 'คีย์ผิด'),
      ).rejects.toThrow(/ค่าคอมของใบขายนี้อยู่สถานะ PAID/);
      const after = await snapshotState(sale.id);
      expect(after).toEqual(before);
      expect(
        (await prisma.salesCommission.findUniqueOrThrow({ where: { id: commission.id } }))
          .status,
      ).toBe('PAID');
    },
    180_000,
  );

  // -------------------------------------------------------------------------
  it(
    'เคส 5 (G4b DRAFT): ร่างรอบจ่ายถูก soft-delete + audit แล้ว generate ใหม่ได้ยอดถูก (ไม่รวมใบที่ยกเลิก)',
    async () => {
      const s5 = await seedSalesperson('E0');
      const productA = await seedProduct('E1');
      const productB = await seedProduct('E2');
      const customer = await seedCustomer('E1');

      // ใบขาย A → ย้ายค่าคอมไปงวดสังเคราะห์ → สร้างรอบจ่ายจริง (DRAFT ครอบ A)
      const saleA = await cashSale({
        customerId: customer.id,
        productId: productA.id,
        sellingPrice: 9900,
        salespersonId: s5.id,
      });
      await moveCommissionPeriod(saleA.id, P5);
      // กัน flake จากนาฬิกาสองแหล่ง: `covering` เทียบ commission.createdAt (Prisma engine)
      // กับ payout.generatedAt (Node) — บน Windows timer quantum ~15.6ms ทำให้ลำดับกลับ
      // ด้านได้ถ้าช่องว่างจริงแคบกว่านั้น (prod ช่องว่างเป็นนาที/วัน ไม่ใช่ประเด็นจริง)
      await sleep(150);
      const gen1 = await commissionService.generatePayouts({ period: P5 });
      expect(gen1.created).toBe(1);
      const payoutKey = { salespersonId_period: { salespersonId: s5.id, period: P5 } };
      const payout = await prisma.commissionPayout.findUniqueOrThrow({ where: payoutKey });
      expect(payout.status).toBe('DRAFT');
      expect(payout.generatedAt).not.toBeNull();

      // ใบขาย B คีย์หลังรอบ (createdAt > generatedAt) — รอดจากรอบนี้ แต่ต้องเข้ารอบใหม่
      await sleep(150);
      const saleB = await cashSale({
        customerId: customer.id,
        productId: productB.id,
        sellingPrice: 8000,
        salespersonId: s5.id,
      });
      await moveCommissionPeriod(saleB.id, P5);
      const commissionB = await prisma.salesCommission.findFirstOrThrow({
        where: { saleId: saleB.id },
      });

      // ── ยกเลิกใบ A: ร่างที่ครอบ A ต้องถูก soft-delete + audit ──
      await saleVoidService.voidSale(saleA.id, OWNER(), 'คีย์ผิดรุ่น');
      const payoutAfterVoid = await prisma.commissionPayout.findUniqueOrThrow({
        where: payoutKey,
      });
      expect(payoutAfterVoid.deletedAt).not.toBeNull();
      const draftAudit = await prisma.auditLog.findFirst({
        where: {
          action: 'COMMISSION_PAYOUT_DRAFT_VOIDED',
          entity: 'commission_payout',
          entityId: payout.id,
        },
      });
      expect(draftAudit, 'ต้องมี AuditLog การลบร่างรอบจ่าย').toBeTruthy();
      expect(
        (
          await prisma.salesCommission.findFirstOrThrow({ where: { saleId: saleA.id } })
        ).status,
      ).toBe('CLAWED_BACK');
      expect(
        (await prisma.salesCommission.findUniqueOrThrow({ where: { id: commissionB.id } }))
          .status,
      ).toBe('PENDING');

      // ── generate ใหม่ → ขา restore คำนวณยอดใหม่ ตัด CLAWED_BACK ออกเอง ──
      const gen2 = await commissionService.generatePayouts({ period: P5 });
      expect(gen2.created).toBe(1);
      const regenerated = await prisma.commissionPayout.findUniqueOrThrow({ where: payoutKey });
      expect(regenerated.deletedAt).toBeNull();
      expect(regenerated.status).toBe('DRAFT');
      expect(regenerated.commissionCount).toBe(1);
      expect(regenerated.totalCommission.toString()).toBe(
        commissionB.commissionAmount.toString(),
      );
      expect(regenerated.generatedAt!.getTime()).toBeGreaterThan(payout.generatedAt!.getTime());
    },
    180_000,
  );

  // -------------------------------------------------------------------------
  it(
    'เคส 6 (G4b APPROVED): รอบจ่ายอนุมัติแล้ว → ปฏิเสธ และไม่มีอะไรถูกเขียน',
    async () => {
      const s6 = await seedSalesperson('F0');
      const main = await seedProduct('F1');
      const customer = await seedCustomer('F1');
      const sale = await cashSale({
        customerId: customer.id,
        productId: main.id,
        sellingPrice: 9900,
        salespersonId: s6.id,
      });
      await moveCommissionPeriod(sale.id, P6);
      await sleep(150); // กัน flake นาฬิกาสองแหล่ง — ดูคอมเมนต์ในเคส 5
      await commissionService.generatePayouts({ period: P6 });
      const payout = await prisma.commissionPayout.findUniqueOrThrow({
        where: { salespersonId_period: { salespersonId: s6.id, period: P6 } },
      });
      await commissionService.approvePayout(payout.id, adminId, {});
      expect(
        (await prisma.commissionPayout.findUniqueOrThrow({ where: { id: payout.id } })).status,
      ).toBe('APPROVED');

      const before = await snapshotState(sale.id);
      await expect(
        saleVoidService.voidSale(sale.id, OWNER(), 'คีย์ผิด'),
      ).rejects.toThrow(/รอบจ่ายค่าคอม/);
      const after = await snapshotState(sale.id);
      expect(after).toEqual(before);
      const payoutAfter = await prisma.commissionPayout.findUniqueOrThrow({
        where: { id: payout.id },
      });
      expect(payoutAfter.status).toBe('APPROVED');
      expect(payoutAfter.deletedAt).toBeNull();
    },
    180_000,
  );

  // -------------------------------------------------------------------------
  it(
    'เคส 7 (G4b หลังรอบ): คีย์ขายใหม่หลังสร้างรอบ (แม้รอบ APPROVED) → void ได้ และรอบเดิมไม่ถูกแตะ',
    async () => {
      const s7 = await seedSalesperson('G0');
      const productA = await seedProduct('G1');
      const productB = await seedProduct('G2');
      const customer = await seedCustomer('G1');

      // รอบจ่ายครอบใบ A แล้วถูกอนุมัติ (ผูกเงินแล้ว)
      const saleA = await cashSale({
        customerId: customer.id,
        productId: productA.id,
        sellingPrice: 9900,
        salespersonId: s7.id,
      });
      await moveCommissionPeriod(saleA.id, P7);
      await sleep(150); // กัน flake นาฬิกาสองแหล่ง — ดูคอมเมนต์ในเคส 5
      await commissionService.generatePayouts({ period: P7 });
      const payout = await prisma.commissionPayout.findUniqueOrThrow({
        where: { salespersonId_period: { salespersonId: s7.id, period: P7 } },
      });
      await commissionService.approvePayout(payout.id, adminId, {});

      // ใบ B คีย์ผิดหลังรอบ — `commission.createdAt > payout.generatedAt` พิสูจน์ว่า
      // ยอดของ B ไม่เคยอยู่ในรอบนั้น ⇒ ต้องยกเลิกได้แม้รอบ APPROVED ค้างอยู่
      await sleep(150);
      const saleB = await cashSale({
        customerId: customer.id,
        productId: productB.id,
        sellingPrice: 7500,
        salespersonId: s7.id,
      });
      await moveCommissionPeriod(saleB.id, P7);
      const commissionB = await prisma.salesCommission.findFirstOrThrow({
        where: { saleId: saleB.id },
      });
      expect(commissionB.createdAt.getTime()).toBeGreaterThan(payout.generatedAt!.getTime());

      const res = await saleVoidService.voidSale(saleB.id, OWNER(), 'คีย์ผิดหลังรอบ');
      expect(res.saleNumber).toBeTruthy();

      expect(
        (await prisma.sale.findUniqueOrThrow({ where: { id: saleB.id } })).deletedAt,
      ).not.toBeNull();
      expect(
        (await prisma.salesCommission.findUniqueOrThrow({ where: { id: commissionB.id } }))
          .status,
      ).toBe('CLAWED_BACK');
      // รอบเดิมต้องไม่ถูกแตะแม้แต่นิดเดียว — ใบ A ก็เช่นกัน
      const payoutAfter = await prisma.commissionPayout.findUniqueOrThrow({
        where: { id: payout.id },
      });
      expect(payoutAfter.status).toBe('APPROVED');
      expect(payoutAfter.deletedAt).toBeNull();
      expect(payoutAfter.totalCommission.toString()).toBe(payout.totalCommission.toString());
      expect(
        (await prisma.sale.findUniqueOrThrow({ where: { id: saleA.id } })).deletedAt,
      ).toBeNull();
      expect(
        (
          await prisma.salesCommission.findFirstOrThrow({ where: { saleId: saleA.id } })
        ).status,
      ).toBe('PENDING');
    },
    180_000,
  );

  // -------------------------------------------------------------------------
  it(
    'เคส 8 (G1): ยกเลิกซ้ำ → ปฏิเสธ และไม่มี JE กลับรายการใบที่สอง',
    async () => {
      const main = await seedProduct('H1');
      const customer = await seedCustomer('H1');
      const sale = await cashSale({
        customerId: customer.id,
        productId: main.id,
        sellingPrice: 9900,
      });

      await saleVoidService.voidSale(sale.id, OWNER(), 'คีย์ผิดรุ่น');
      const original = await prisma.journalEntry.findFirstOrThrow({
        where: { metadata: { path: ['saleId'], equals: sale.id } as never },
      });
      const countReversals = () =>
        prisma.journalEntry.count({
          where: { metadata: { path: ['originalEntryId'], equals: original.id } as never },
        });
      expect(await countReversals()).toBe(1);

      await expect(
        saleVoidService.voidSale(sale.id, OWNER(), 'ซ้ำ'),
      ).rejects.toThrow(/ถูกยกเลิกไปแล้ว/);
      expect(await countReversals()).toBe(1); // ไม่มีใบที่สอง
      expect(
        (await prisma.product.findUniqueOrThrow({ where: { id: main.id } })).status,
      ).toBe('IN_STOCK');
    },
    180_000,
  );

  // -------------------------------------------------------------------------
  it(
    'เคส 9 (branch scope): BM ต่างสาขา → Forbidden + ไม่มีอะไรถูกเขียน; BM ไม่มีสาขา (fail-closed) → Forbidden; BM สาขาตัวเอง → ยกเลิกได้',
    async () => {
      const main = await seedProduct('I1');
      const customer = await seedCustomer('I1');
      const sale = await cashSale({
        customerId: customer.id,
        productId: main.id,
        sellingPrice: 9900,
      });

      // BM สาขา B ยกเลิกใบขายสาขา A ไม่ได้
      const before = await snapshotState(sale.id);
      await expect(
        saleVoidService.voidSale(
          sale.id,
          { id: bmUserId, role: 'BRANCH_MANAGER', branchId: branchBId },
          'ข้ามสาขา',
        ),
      ).rejects.toThrow(/สาขาอื่น/);
      // BM ที่ไม่มี branchId ติดตัว (ข้อมูลผิดปกติ) = fail closed
      await expect(
        saleVoidService.voidSale(
          sale.id,
          { id: bmUserId, role: 'BRANCH_MANAGER', branchId: null },
          'ไม่มีสาขา',
        ),
      ).rejects.toThrow(/สาขาอื่น/);
      const after = await snapshotState(sale.id);
      expect(after).toEqual(before);

      // BM สาขาเดียวกับใบขาย → ยกเลิกได้จริง (สิทธิ์ที่ตั้งใจเปิด ไม่ใช่แค่กันข้ามสาขา)
      const res = await saleVoidService.voidSale(
        sale.id,
        { id: bmUserId, role: 'BRANCH_MANAGER', branchId },
        'ลูกค้ายกเลิกหน้าร้าน',
      );
      expect(res.restoredProductIds).toEqual([main.id]);
      const voided = await prisma.sale.findUniqueOrThrow({ where: { id: sale.id } });
      expect(voided.deletedAt).not.toBeNull();
      expect(voided.voidedById).toBe(bmUserId);
      expect(
        (await prisma.product.findUniqueOrThrow({ where: { id: main.id } })).status,
      ).toBe('IN_STOCK');
    },
    180_000,
  );
});
