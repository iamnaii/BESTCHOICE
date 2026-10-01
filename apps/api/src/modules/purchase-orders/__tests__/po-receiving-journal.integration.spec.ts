/**
 * รับสินค้าเข้าลงบัญชี — พิสูจน์บน DB จริง (คำตอบฝ่ายบัญชี 2026-09-29 ข้อ ข1 ข2 ข5)
 *
 * ทุกการเปลี่ยนสถานะมาจาก service จริง (`PurchaseOrdersService.create` / `goodsReceiving` /
 * `directReceive`) — ไม่เขียนแถว PO / ใบรับของ / สินค้าด้วย prisma ตรง ๆ
 *
 * สิ่งที่ unit spec (mock) พิสูจน์ไม่ได้ และไฟล์นี้พิสูจน์:
 *   1. `JournalAutoService.createAndPost` ตัวจริงรับรายการ (บัญชีมีในผัง · Dr = Cr · companyId = SHOP)
 *   2. ใบสั่งซื้อที่รับสองครั้งได้ JE สองใบ `reference` ไม่ชน partial unique index
 *   3. ต้นทุนของทุกเครื่องในใบสั่งซื้อรวมกัน = ยอดสุทธิที่ต้องจ่าย = เจ้าหนี้ที่ตั้ง (เศษสตางค์ลงครั้งเดียว)
 *   4. ขายเครื่องด้วย `Product.costPrice` แล้วบัญชีสินค้าคงคลังของใบสั่งซื้อนั้นกลับเป็นศูนย์พอดี
 *   5. รายการบัญชีพัง = การรับของไม่เกิด (ไม่เหลือใบรับของ/สินค้า/จำนวนที่รับ)
 *   6. ราคาที่เติมให้ตอนสั่งอุปกรณ์เสริมซ้ำ = ราคาซื้อก่อน VAT ไม่ใช่ต้นทุนรวม VAT (ไม่งั้น VAT ทบทุกรอบ)
 *   7. (คำตอบฝ่ายบัญชี 2026-09-30 ข้อ 8) มือสองที่ต้องรอถ่ายรูปไม่ลงบัญชีตอนรับของ — ลงตอนผ่านเข้าคลัง
 *      (ยืนยันรูปครบ / PATCH เป็นพร้อมขาย) ด้วยต้นทุนที่ปันไว้ · เครื่องที่ถูกกด "ไม่รับเข้าคลัง" ไม่มีรายการเลย
 *   8. (ข3 — แบบหน้าจอที่เจ้าของเคาะ 2026-10-01) ลงบัญชีด้วยวันที่ในเอกสารของผู้จัดจำหน่าย · งวดของวันนั้นปิดแล้ว
 *      = รับได้ ลงวันที่รับของแทน (ทั้งใบรับของและหน่วยที่ผ่านเข้าคลังทีหลัง) + งานแจ้งฝ่ายบัญชี
 *
 * Runner: vitest (jest ignore `*.integration.spec.ts`). ต้องมี DB จริง:
 *   cd apps/api && npx vitest run --no-file-parallelism \
 *     src/modules/purchase-orders/__tests__/po-receiving-journal.integration.spec.ts
 *
 * CI: glob `PO_FILES` ใน `.github/workflows/deploy-gcp.yml` — เพิ่มพร้อมไฟล์นี้
 *
 * Cleanup: SCOPED ตาม id ที่สเปคนี้สร้าง
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { seedFinanceCoa } from '../../../../prisma/seed-coa-finance';
import { seedShopCoa } from '../../../../prisma/seed-coa-shop';
import { PurchaseOrdersService } from '../purchase-orders.service';
import { JournalAutoService } from '../../journal/journal-auto.service';
import { CompanyResolverService } from '../../journal/company-resolver.service';
import { ShopAccountResolver } from '../../journal/shop-account-resolver.service';
import { ShopGoodsReceivingTemplate } from '../../journal/cpa-templates/shop-goods-receiving.template';
import { ShopCashSaleTemplate } from '../../journal/cpa-templates/shop-cash-sale.template';
import { ProductsService } from '../../products/products.service';
import { ProductPhotosService } from '../../quality-control/product-photos.service';
import { ReceivingAcceptanceJournal } from '../services/receiving-acceptance-journal';
import { StockAdjustmentsService } from '../../inventory/stock-adjustments.service';
import { bangkokCalendarParts, bangkokDateString } from '../../../utils/date.util';
import { formatMonthName } from '../../../utils/thai-date.util';

const prisma = new PrismaClient();

const journal = new JournalAutoService(prisma as never);
const companyResolver = new CompanyResolverService(prisma as never);
const shopAccountResolver = new ShopAccountResolver(prisma as never);
const goodsReceivingTemplate = new ShopGoodsReceivingTemplate(journal, prisma as never, companyResolver);
const cashSaleTemplate = new ShopCashSaleTemplate(journal, prisma as never, companyResolver);
const service = new PurchaseOrdersService(prisma as never, goodsReceivingTemplate, shopAccountResolver, companyResolver);
const productsService = new ProductsService(prisma as never);
const productPhotosService = new ProductPhotosService(prisma as never);
const stockAdjustmentsService = new StockAdjustmentsService(prisma as never);
const FULL_ANGLES = { front: 'f.jpg', back: 'b.jpg', left: 'l.jpg', right: 'r.jpg', top: 't.jpg', bottom: 'u.jpg' };

const PREFIX = 'POJETEST-';
const RUN = Date.now().toString(36).toUpperCase();
const FLOW = 'shop-goods-receiving';

const createdPoIds: string[] = [];
const createdSupplierIds: string[] = [];
const createdBranchIds: string[] = [];
const syntheticSaleIds: string[] = [];
const k3GrNumbers: string[] = [];
const createdUserIds: string[] = [];

let adminId: string;
let shopCompanyId: string;
let imeiSeq = 0;
const nextImei = () => `${PREFIX}${RUN}-${String(++imeiSeq).padStart(3, '0')}`;

const dec = (v: string | number) => new Decimal(v);
const sum = (values: Decimal[]) => values.reduce((acc, v) => acc.plus(v), dec(0));

async function seedSupplier(tag: string, hasVat: boolean) {
  const supplier = await prisma.supplier.create({
    data: { name: `${PREFIX}Supplier ${tag} ${RUN}`, contactName: 'ทดสอบ', phone: '020000000', hasVat },
  });
  createdSupplierIds.push(supplier.id);
  return supplier;
}

type ItemInput = { category: string; model: string; quantity: number; unitPrice: number };

async function createOrderedPo(supplierId: string, items: ItemInput[], opts: { discount?: number; discountAfterVat?: number } = {}) {
  const po = await service.create(
    {
      supplierId,
      orderDate: new Date().toISOString().slice(0, 10),
      items: items.map((i) => ({ brand: `${PREFIX}Brand`, storage: '128GB', ...i })),
      ...opts,
    } as never,
    adminId,
    'OWNER',
  );
  createdPoIds.push(po.id);
  expect(po.status).toBe('ORDERED');
  return po;
}

const poItemOf = (po: { items: { id: string; model: string | null }[] }, model: string) =>
  po.items.find((i) => i.model === model)!;

/** JE รับสินค้าเข้าทั้งหมดของใบสั่งซื้อ พร้อมบรรทัด */
async function receivingEntries(poId: string) {
  return prisma.journalEntry.findMany({
    where: {
      AND: [
        { metadata: { path: ['flow'], equals: FLOW } as never },
        { metadata: { path: ['poId'], equals: poId } as never },
      ],
      deletedAt: null,
    },
    include: { lines: true },
    orderBy: { createdAt: 'asc' },
  });
}

/**
 * วันที่ในเอกสาร `monthsBack` เดือนก่อนเดือนปัจจุบัน (ปฏิทินไทย) วันที่ `day` — อยู่ในกรอบย้อนหลัง 365 วันเสมอ (monthsBack ≤ 10)
 * และไม่ใช่วันที่ 1 (ด่านงวดบัญชีอ่านเดือนตามเขตเวลาของโปรเซส — CI รันเป็น UTC)
 */
function pastDoc(monthsBack: number, day: number) {
  const today = bangkokCalendarParts(new Date());
  const first = new Date(Date.UTC(today.year, today.month - monthsBack, 1));
  const year = first.getUTCFullYear();
  const month = first.getUTCMonth() + 1;
  const iso = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const stored = new Date(Date.UTC(year, month - 1, day) - 7 * 60 * 60 * 1000);
  return { year, month, iso, stored: stored.toISOString(), thai: `${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}/${year + 543}`, monthLabel: `${formatMonthName(stored)} ${year + 543}` };
}

/** ปิดงวดบัญชีของ SHOP เดือนหนึ่งชั่วคราว — คืนค่าเดิม (หรือลบแถวที่สร้าง) ด้วย `restore()` */
async function closeShopPeriod(year: number, month: number) {
  const where = { companyId_year_month: { companyId: shopCompanyId, year, month } };
  const before = await prisma.accountingPeriod.findUnique({ where });
  await prisma.accountingPeriod.upsert({
    where,
    create: { companyId: shopCompanyId, year, month, status: 'CLOSED' },
    update: { status: 'CLOSED' },
  });
  return {
    restore: async () => {
      if (before) await prisma.accountingPeriod.update({ where, data: { status: before.status } });
      else await prisma.accountingPeriod.delete({ where });
    },
  };
}

/** ตั้งช่วงผ่อนผันของงวดที่ปิดแล้วชั่วคราว (`period_grace_days`) — คืนค่าเดิมด้วย `restore()` */
async function setGraceDays(days: number) {
  const before = await prisma.systemConfig.findUnique({ where: { key: 'period_grace_days' } });
  await prisma.systemConfig.upsert({
    where: { key: 'period_grace_days' },
    create: { key: 'period_grace_days', value: String(days), label: 'test grace' },
    update: { value: String(days) },
  });
  return {
    restore: async () => {
      if (before) await prisma.systemConfig.update({ where: { key: 'period_grace_days' }, data: { value: before.value } });
      else await prisma.systemConfig.delete({ where: { key: 'period_grace_days' } });
    },
  };
}

/** Dr − Cr ต่อบัญชี ของ JE ชุดที่ส่งมา */
function netByAccount(entries: { lines: { accountCode: string; debit: Decimal | null; credit: Decimal | null }[] }[]) {
  const net: Record<string, Decimal> = {};
  for (const entry of entries) {
    for (const line of entry.lines) {
      net[line.accountCode] = (net[line.accountCode] ?? dec(0)).plus(line.debit ?? 0).minus(line.credit ?? 0);
    }
  }
  return Object.fromEntries(Object.entries(net).map(([code, amount]) => [code, amount.toFixed(2)]));
}

describe('รับสินค้าเข้าลงบัญชี — flow จริงบน DB จริง', () => {
  beforeAll(async () => {
    await seedFinanceCoa(prisma);
    await seedShopCoa(prisma);

    const shop = await prisma.companyInfo.findFirstOrThrow({ where: { companyCode: 'SHOP', deletedAt: null } });
    shopCompanyId = shop.id;

    let admin = await prisma.user.findFirst({ where: { email: 'admin@bestchoice.com' } });
    if (!admin) {
      admin = await prisma.user.create({
        data: { email: 'admin@bestchoice.com', password: 'x', name: 'admin', role: 'OWNER' },
      });
    }
    adminId = admin.id;

    // การรับของลงคลังกลาง (หรือสาขาที่เก่าที่สุด) — ฐานเปล่าไม่มีสาขาเลย จึงสร้างให้หนึ่งสาขา
    const anyBranch = await prisma.branch.findFirst({ where: { isActive: true, deletedAt: null } });
    if (!anyBranch) {
      const branch = await prisma.branch.create({
        data: { name: `${PREFIX}warehouse`, companyId: shopCompanyId, isMainWarehouse: true },
      });
      createdBranchIds.push(branch.id);
    }
  }, 180_000);

  afterAll(async () => {
    const jeIds = new Set<string>();
    for (const poId of createdPoIds) {
      (await receivingEntries(poId)).forEach((e) => jeIds.add(e.id));
    }
    for (const saleId of syntheticSaleIds) {
      const rows = await prisma.journalEntry.findMany({
        where: { metadata: { path: ['saleId'], equals: saleId } as never },
        select: { id: true },
      });
      rows.forEach((r) => jeIds.add(r.id));
    }
    const jeIdList = [...jeIds];
    for (const grNumber of k3GrNumbers) {
      await prisma.todo.deleteMany({ where: { tags: { has: 'goods-receiving-period' }, title: { contains: grNumber } } });
    }
    await prisma.journalPostAuditLog.deleteMany({ where: { journalEntryId: { in: jeIdList } } });
    await prisma.journalLine.deleteMany({ where: { journalEntryId: { in: jeIdList } } });
    await prisma.journalEntry.deleteMany({ where: { id: { in: jeIdList } } });

    const products = await prisma.product.findMany({ where: { poId: { in: createdPoIds } }, select: { id: true } });
    const productIds = products.map((p) => p.id);
    await prisma.stockAdjustment.deleteMany({ where: { productId: { in: productIds } } });
    await prisma.goodsReceivingItem.deleteMany({ where: { receiving: { poId: { in: createdPoIds } } } });
    await prisma.goodsReceiving.deleteMany({ where: { poId: { in: createdPoIds } } });
    await prisma.productPrice.deleteMany({ where: { productId: { in: productIds } } });
    await prisma.productPhoto.deleteMany({ where: { productId: { in: productIds } } });
    await prisma.product.deleteMany({ where: { id: { in: productIds } } });
    await prisma.pOItem.deleteMany({ where: { poId: { in: createdPoIds } } });
    // auditLog ของรับเข้าตรงลบไม่ได้ (immutable) — ไม่มี FK ไปที่ใบสั่งซื้อ จึงไม่ขวางการลบ
    await prisma.purchaseOrder.deleteMany({ where: { id: { in: createdPoIds } } });
    await prisma.supplier.deleteMany({ where: { id: { in: createdSupplierIds } } });
    await prisma.branch.deleteMany({ where: { id: { in: createdBranchIds } } });
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });

    expect(await prisma.purchaseOrder.count({ where: { id: { in: createdPoIds } } })).toBe(0);
    await prisma.$disconnect();
  }, 180_000);

  it('ผู้จัดจำหน่ายจด VAT + ส่วนลดท้ายบิล รับสองครั้ง → ต้นทุนรวม = เจ้าหนี้ = ยอดสุทธิ และขายแล้วสินค้าคงคลังเป็นศูนย์', async () => {
    const supplier = await seedSupplier('VAT', true);
    // 3 × 3,333.33 + 2 × 450.25 = 9,999.99 + 900.50 = 10,900.49 − ส่วนลด 50.17 = 10,850.32 + VAT 759.52 = 11,609.84
    const po = await createOrderedPo(
      supplier.id,
      [
        { category: 'PHONE_NEW', model: `${PREFIX}Phone`, quantity: 3, unitPrice: 3333.33 },
        { category: 'ACCESSORY', model: `${PREFIX}Case`, quantity: 2, unitPrice: 450.25 },
      ],
      { discount: 50.17 },
    );
    expect(dec(po.totalAmount.toString()).toFixed(2)).toBe('10900.49');
    expect(dec(po.netAmount.toString()).toFixed(2)).toBe('11609.84');
    const phone = poItemOf(po, `${PREFIX}Phone`);
    const accessory = poItemOf(po, `${PREFIX}Case`);

    // ── รับครั้งที่ 1: มือถือ 2 เครื่อง (ผ่าน) + 1 เครื่องตรวจไม่ผ่าน + เคส 1 ชิ้น ──
    const first = await service.goodsReceiving(
      po.id,
      {
        items: [
          { poItemId: phone.id, imeiSerial: nextImei(), status: 'PASS', sellingPrice: 5900 },
          { poItemId: phone.id, imeiSerial: nextImei(), status: 'PASS', sellingPrice: 5900 },
          { poItemId: phone.id, imeiSerial: nextImei(), status: 'REJECT', rejectReason: 'จอแตก', defectReason: 'SCREEN' },
          { poItemId: accessory.id, status: 'PASS', sellingPrice: 690 },
        ],
      } as never,
      adminId,
    );
    expect(first.status).toBe('PARTIALLY_RECEIVED');
    expect(first.passed).toBe(3);
    expect(first.journalEntryNo).toMatch(/^JE-/);

    // ปันแบบปัดสะสม: รายการมือถือ = round(11,609.84 × 9,999.99 ÷ 10,900.49) = 10,650.74 · รายการเคส = ที่เหลือ 959.10
    // มือถือหน่วยที่ 1–3 = 3,550.25 / 3,550.24 / 3,550.25 · เคสหน่วยที่ 1–2 = 479.55 / 479.55
    expect(first.products.map((p) => dec(p.costPrice.toString()).toFixed(2)).sort()).toEqual(['3550.25', '3550.24', '479.55'].sort());

    let entries = await receivingEntries(po.id);
    expect(entries).toHaveLength(1);
    expect(entries[0].entryNumber).toBe(first.journalEntryNo);
    expect(entries[0].status).toBe('POSTED');
    expect(entries[0].companyId).toBe(shopCompanyId);
    expect(entries[0].referenceId).toBe(`gr:${first.receivingId}`);
    expect(netByAccount(entries)).toEqual({
      'S11-2001': '7100.49',
      'S11-2003': '479.55',
      'S21-1101': '-7100.49',
      'S21-1102': '-479.55',
    });
    const gr = await prisma.goodsReceiving.findUniqueOrThrow({ where: { id: first.receivingId } });
    expect(entries[0].entryDate.toISOString()).toBe(gr.createdAt.toISOString());

    // ── รับครั้งที่ 2: มือถือเครื่องที่ 3 (ตัวแทนเครื่องที่ตีกลับ) + เคสชิ้นที่ 2 → ครบใบ ──
    const second = await service.goodsReceiving(
      po.id,
      {
        items: [
          { poItemId: accessory.id, status: 'PASS', sellingPrice: 690 },
          { poItemId: phone.id, imeiSerial: nextImei(), status: 'PASS', sellingPrice: 5900 },
        ],
      } as never,
      adminId,
    );
    expect(second.status).toBe('FULLY_RECEIVED');

    entries = await receivingEntries(po.id);
    expect(entries).toHaveLength(2);
    expect(new Set(entries.map((e) => e.referenceId)).size).toBe(2);

    // ปัดรายหน่วยตรง ๆ จะได้ 3 × 3,550.25 + 2 × 479.55 = 11,609.85 (เกิน 0.01) — วิธีปัดสะสมให้มือถือหน่วยที่ 2
    // เป็น 3,550.24 ตั้งแต่การรับครั้งแรก จึงไม่มีเศษเหลือให้ลงตอนรับครบ
    const products = await prisma.product.findMany({ where: { poId: po.id, deletedAt: null } });
    expect(products).toHaveLength(5);
    const costs = products.map((p) => dec(p.costPrice.toString()));
    expect(costs.map((c) => c.toFixed(2)).sort()).toEqual(['3550.24', '3550.25', '3550.25', '479.55', '479.55'].sort());
    expect(sum(costs).toFixed(2)).toBe('11609.84');

    expect(netByAccount(entries)).toEqual({
      'S11-2001': '10650.74',
      'S11-2003': '959.10',
      'S21-1101': '-10650.74',
      'S21-1102': '-959.10',
    });

    // ── ขายทุกชิ้นด้วยต้นทุนของตัวเอง (สิ่งที่ sale-writer ส่งให้ template ตอนขายสด) ──
    const saleEntryIds: string[] = [];
    for (const product of products) {
      const saleId = `${PREFIX}${RUN}-sale-${product.id}`;
      syntheticSaleIds.push(saleId);
      const accounts = shopAccountResolver.resolveProductAccounts(product.category);
      const posted = await cashSaleTemplate.execute({
        idempotencyKey: `shop-cash-sale:${saleId}:${product.id}`,
        saleId,
        productId: product.id,
        cashAccountCode: 'S11-1201',
        revenueAccountCode: accounts.revenueAccountCode,
        revenueAmount: dec(product.category === 'ACCESSORY' ? 690 : 5900),
        cogsAccountCode: accounts.cogsAccountCode,
        inventoryAccountCode: accounts.inventoryAccountCode,
        inventoryCost: dec(product.costPrice.toString()),
      });
      saleEntryIds.push(posted.journalEntryId);
    }
    const saleEntries = await prisma.journalEntry.findMany({ where: { id: { in: saleEntryIds } }, include: { lines: true } });
    const afterSale = netByAccount([...entries, ...saleEntries]);
    expect(afterSale['S11-2001']).toBe('0.00');
    expect(afterSale['S11-2003']).toBe('0.00');
    // ต้นทุนขายรวม = ยอดที่ต้องจ่ายผู้จัดจำหน่าย · เจ้าหนี้ยังค้างเต็ม (การจ่ายเงินยังไม่ลงบัญชี)
    expect(dec(afterSale['S50-1101']).plus(afterSale['S50-1103']).toFixed(2)).toBe('11609.84');
    expect(dec(afterSale['S21-1101']).plus(afterSale['S21-1102']).toFixed(2)).toBe('-11609.84');
  }, 120_000);

  it('ผู้จัดจำหน่ายไม่จด VAT ไม่มีส่วนลด → ต้นทุน = ราคาต่อหน่วย · มือสองลงบัญชีสินค้ามือสอง', async () => {
    const supplier = await seedSupplier('NOVAT', false);
    const po = await createOrderedPo(supplier.id, [
      { category: 'PHONE_USED', model: `${PREFIX}Used`, quantity: 1, unitPrice: 4200 },
    ]);
    expect(dec(po.netAmount.toString()).toFixed(2)).toBe('4200.00');

    const result = await service.goodsReceiving(
      po.id,
      {
        items: [
          {
            poItemId: poItemOf(po, `${PREFIX}Used`).id,
            imeiSerial: nextImei(),
            status: 'PASS',
            anglePhotos: FULL_ANGLES, // ถ่ายครบ 6 มุม + มีราคา = เข้าคลังทันที จึงลงบัญชีตอนรับของ
            sellingPrice: 5900,
          },
        ],
      } as never,
      adminId,
    );

    expect(result.products[0].status).toBe('IN_STOCK');
    expect(dec(result.products[0].costPrice.toString()).toFixed(2)).toBe('4200.00');
    expect(netByAccount(await receivingEntries(po.id))).toEqual({ 'S11-2002': '4200.00', 'S21-1101': '-4200.00' });
  }, 60_000);

  it('รับเข้าตรง (ผู้จัดจำหน่ายจด VAT) → ใบสั่งซื้ออัตโนมัติ + รายการบัญชีในคราวเดียว', async () => {
    const supplier = await seedSupplier('DIRECT', true);
    const result = await service.directReceive(
      {
        supplierId: supplier.id,
        orderDate: new Date().toISOString().slice(0, 10),
        items: [
          {
            category: 'PHONE_NEW',
            brand: `${PREFIX}Brand`,
            model: `${PREFIX}Direct`,
            storage: '256GB',
            quantity: 1,
            unitPrice: 10000,
            status: 'PASS',
            imeiSerial: nextImei(),
            sellingPrice: 13900,
          },
        ],
      } as never,
      adminId,
    );
    createdPoIds.push(result.poId);

    expect(result.status).toBe('FULLY_RECEIVED');
    expect(dec(result.products[0].costPrice.toString()).toFixed(2)).toBe('10700.00');
    expect(netByAccount(await receivingEntries(result.poId))).toEqual({ 'S11-2001': '10700.00', 'S21-1101': '-10700.00' });
  }, 60_000);

  it('รับแล้วตรวจไม่ผ่านทั้งใบ → ไม่มีรายการบัญชี', async () => {
    const supplier = await seedSupplier('REJECT', true);
    const po = await createOrderedPo(supplier.id, [
      { category: 'PHONE_NEW', model: `${PREFIX}Rejected`, quantity: 1, unitPrice: 10000 },
    ]);

    const result = await service.goodsReceiving(
      po.id,
      {
        items: [
          {
            poItemId: poItemOf(po, `${PREFIX}Rejected`).id,
            imeiSerial: nextImei(),
            status: 'REJECT',
            rejectReason: 'จอแตก',
            defectReason: 'SCREEN',
          },
        ],
      } as never,
      adminId,
    );

    expect(result.journalEntryNo).toBeNull();
    expect(await receivingEntries(po.id)).toHaveLength(0);
  }, 60_000);

  it('ใบที่มีหน่วยราคาถูกจำนวนมากและของแถมราคาศูนย์ รับครบได้ (วิธีลงเศษหน่วยเดียวเคยทำให้ต้นทุนติดลบ)', async () => {
    const supplier = await seedSupplier('CHEAP', false);
    // 40 × 1.00 + ของแถม 1 ชิ้น ราคา 0 · ส่วนลด 4.99 → 35.01
    const po = await createOrderedPo(
      supplier.id,
      [
        { category: 'ACCESSORY', model: `${PREFIX}Film`, quantity: 40, unitPrice: 1 },
        { category: 'ACCESSORY', model: `${PREFIX}Gift`, quantity: 1, unitPrice: 0 },
      ],
      { discount: 4.99 },
    );
    expect(dec(po.netAmount.toString()).toFixed(2)).toBe('35.01');
    const film = poItemOf(po, `${PREFIX}Film`);
    const gift = poItemOf(po, `${PREFIX}Gift`);

    const first = await service.goodsReceiving(
      po.id,
      { items: Array.from({ length: 40 }, () => ({ poItemId: film.id, status: 'PASS' })) } as never,
      adminId,
    );
    expect(first.status).toBe('PARTIALLY_RECEIVED');

    // ของแถมมาทีหลังเป็นชิ้นสุดท้ายของใบ — ต้นทุนศูนย์ ไม่มีรายการบัญชีของครั้งนี้ และใบสั่งซื้อครบ
    const second = await service.goodsReceiving(po.id, { items: [{ poItemId: gift.id, status: 'PASS' }] } as never, adminId);
    expect(second.status).toBe('FULLY_RECEIVED');
    expect(second.journalEntryNo).toBeNull();

    const products = await prisma.product.findMany({ where: { poId: po.id, deletedAt: null } });
    const costs = products.map((p) => dec(p.costPrice.toString()));
    expect(costs.every((c) => c.gte(0))).toBe(true);
    expect(sum(costs).toFixed(2)).toBe('35.01');
    expect(netByAccount(await receivingEntries(po.id))).toEqual({ 'S11-2003': '35.01', 'S21-1102': '-35.01' });
  }, 120_000);

  it('รายการบัญชีพัง → การรับของทั้งใบไม่เกิด', async () => {
    const supplier = await seedSupplier('ATOMIC', true);
    const po = await createOrderedPo(supplier.id, [
      { category: 'PHONE_NEW', model: `${PREFIX}Atomic`, quantity: 2, unitPrice: 10000 },
    ]);
    const failingTemplate = {
      execute: async () => {
        throw new Error('journal posting failed (จำลอง)');
      },
    };
    const failingService = new PurchaseOrdersService(
      prisma as never,
      failingTemplate as never,
      shopAccountResolver,
      companyResolver,
    );

    await expect(
      failingService.goodsReceiving(
        po.id,
        { items: [{ poItemId: poItemOf(po, `${PREFIX}Atomic`).id, imeiSerial: nextImei(), status: 'PASS' }] } as never,
        adminId,
      ),
    ).rejects.toThrow(/journal posting failed/);

    expect(await prisma.goodsReceiving.count({ where: { poId: po.id } })).toBe(0);
    expect(await prisma.product.count({ where: { poId: po.id } })).toBe(0);
    const after = await prisma.purchaseOrder.findUniqueOrThrow({ where: { id: po.id }, include: { items: true } });
    expect(after.status).toBe('ORDERED');
    expect(after.items.map((i) => i.receivedQty)).toEqual([0]);
  }, 60_000);

  it('สั่งอุปกรณ์เสริมตัวเดิมซ้ำ: ราคาที่เติมให้ = ราคาซื้อก่อน VAT ของใบล่าสุด ไม่ใช่ต้นทุนรวม VAT', async () => {
    const supplier = await seedSupplier('REORDER', true);
    const po = await createOrderedPo(supplier.id, [
      { category: 'ACCESSORY', model: `${PREFIX}Charger ${RUN}`, quantity: 1, unitPrice: 500 },
    ]);
    const result = await service.goodsReceiving(
      po.id,
      { items: [{ poItemId: poItemOf(po, `${PREFIX}Charger ${RUN}`).id, status: 'PASS' }] } as never,
      adminId,
    );
    expect(dec(result.products[0].costPrice.toString()).toFixed(2)).toBe('535.00');

    const skus = await productsService.findAccessorySkus(`${PREFIX}Charger ${RUN}`);

    expect(skus).toHaveLength(1);
    expect(skus[0].lastCost).toBe(500);
  }, 60_000);

  it('โพสต์ซ้ำด้วยใบรับของเดิม → ได้รายการเดิม ไม่เกิดใบที่สอง', async () => {
    const supplier = await seedSupplier('IDEMP', false);
    const po = await createOrderedPo(supplier.id, [
      { category: 'ACCESSORY', model: `${PREFIX}Cable`, quantity: 1, unitPrice: 120 },
    ]);
    const result = await service.goodsReceiving(
      po.id,
      { items: [{ poItemId: poItemOf(po, `${PREFIX}Cable`).id, status: 'PASS' }] } as never,
      adminId,
    );

    const again = await goodsReceivingTemplate.execute({
      idempotencyKey: `${FLOW}:${result.receivingId}`,
      receivingId: result.receivingId,
      grNumber: result.grNumber,
      poId: po.id,
      poNumber: po.poNumber,
      units: [{ productId: result.products[0].id, inventoryAccountCode: 'S11-2003', payableAccountCode: 'S21-1102', cost: dec(120) }],
    });

    expect(again?.entryNo).toBe(result.journalEntryNo);
    expect(await receivingEntries(po.id)).toHaveLength(1);
  }, 60_000);
  // คำตอบฝ่ายบัญชี 2026-09-30 ข้อ 8: "ปรับโปรแกรมลงสินค้าเข้าคลังและเจ้าหนี้ โดยไม่ลงสินค้าที่ไม่รับเข้าคลัง"
  it('ข้อ 8 — มือสองรอถ่ายรูปลงบัญชีตอนผ่านเข้าคลังด้วยต้นทุนที่ปันไว้ · เครื่องที่ไม่รับเข้าคลังไม่มีรายการ', async () => {
    const supplier = await seedSupplier('Q8', false);
    // ส่วนลด 1.00 บน 4 × 4,200 → ยอดสุทธิ 16,799 → ต้นทุนรายหน่วย 4,199.75 ×4 (ปัดสะสม) ≠ ราคาต่อหน่วย
    const po = await createOrderedPo(
      supplier.id,
      [{ category: 'PHONE_USED', model: `${PREFIX}Q8`, quantity: 4, unitPrice: 4200 }],
      { discount: 1 },
    );
    const line = poItemOf(po, `${PREFIX}Q8`).id;

    const received = await service.goodsReceiving(
      po.id,
      {
        items: [
          { poItemId: line, imeiSerial: nextImei(), status: 'PASS', anglePhotos: FULL_ANGLES, sellingPrice: 5900 }, // เข้าคลังทันที
          { poItemId: line, imeiSerial: nextImei(), status: 'PASS', anglePhotos: FULL_ANGLES }, // รูปครบ ไม่มีราคา → รอ
          { poItemId: line, imeiSerial: nextImei(), status: 'PASS' }, // ไม่มีรูป → รอ (จะถูกตีกลับ)
          { poItemId: line, imeiSerial: nextImei(), status: 'PASS' }, // ไม่มีรูป → รอ (เข้าคลังทาง PATCH)
        ],
      } as never,
      adminId,
    );
    const [inStock, waitingPhotos, rejected, viaPatch] = received.products;
    expect(received.products.map((p) => p.status)).toEqual(['IN_STOCK', 'PHOTO_PENDING', 'PHOTO_PENDING', 'PHOTO_PENDING']);
    expect(received.unitsAwaitingStockEntry).toBe(3);
    const costs = received.products.map((p) => dec(p.costPrice.toString()).toFixed(2));
    expect(sum(costs.map(dec)).toFixed(2)).toBe('16799.00');

    // ตอนรับของ: ลงเฉพาะเครื่องที่เข้าคลังทันที
    expect(netByAccount(await receivingEntries(po.id))).toEqual({ 'S11-2002': costs[0], 'S21-1101': dec(costs[0]).neg().toFixed(2) });
    const items = await prisma.goodsReceivingItem.findMany({
      where: { receivingId: received.receivingId },
      orderBy: { createdAt: 'asc' },
      select: { productId: true, receivedCost: true, journalEntryId: true },
    });
    const byProduct = new Map(items.map((i) => [i.productId, i]));
    expect(received.products.map((p) => byProduct.get(p.id)!.receivedCost!.toFixed(2))).toEqual(costs);
    expect(byProduct.get(inStock.id)!.journalEntryId).not.toBeNull();
    expect([waitingPhotos, rejected, viaPatch].map((p) => byProduct.get(p.id)!.journalEntryId)).toEqual([null, null, null]);

    // (ก) ตั้งราคาแล้วยืนยันรูปครบ → เข้าคลัง → ลงหน่วยนั้นด้วยต้นทุนที่ปันไว้ (ไม่ใช่ 4,200)
    await productsService.update(waitingPhotos.id, { cashPrice: 5900 } as never, adminId);
    const completed = await productPhotosService.completePhotos(waitingPhotos.id, adminId);
    expect(completed.enteredStock).toBe(true);
    const accepted = (await receivingEntries(po.id)).find((e) => e.referenceId === `gr:${received.receivingId}:${waitingPhotos.id}`);
    expect(accepted).toBeDefined();
    expect(accepted!.description).toContain('รับสินค้าเข้าคลังหลังตรวจรับ');
    expect(netByAccount([accepted!])).toEqual({ 'S11-2002': costs[1], 'S21-1101': dec(costs[1]).neg().toFixed(2) });
    expect((await prisma.goodsReceivingItem.findUnique({ where: { productId: waitingPhotos.id } }))!.journalEntryId).toBe(accepted!.id);

    // (ข) กด "ไม่รับเข้าคลัง" → เครื่องหายจากสต๊อก ไม่มีรายการบัญชีใด ๆ ของเครื่องนี้
    await service.rejectQC([rejected.id], 'ตรวจแล้วไม่ผ่าน ส่งคืนผู้จัดจำหน่าย');
    expect((await prisma.product.findUnique({ where: { id: rejected.id } }))!.deletedAt).not.toBeNull();

    // (ค) เข้าคลังทาง PATCH (ผู้จัดการตั้งราคา + เปลี่ยนสถานะ) → ลงบัญชีเหมือนกัน
    await productsService.update(viaPatch.id, { status: 'IN_STOCK', cashPrice: 5900 } as never, adminId);

    // ยอดรวม: เฉพาะ 3 เครื่องที่รับเข้าคลังจริง — เครื่องที่ตีกลับไม่อยู่ในสินค้าคงคลังและเจ้าหนี้
    const accepted3 = dec(costs[0]).plus(costs[1]).plus(costs[3]).toFixed(2);
    const entries = await receivingEntries(po.id);
    expect(entries).toHaveLength(3);
    expect(netByAccount(entries)).toEqual({ 'S11-2002': accepted3, 'S21-1101': dec(accepted3).neg().toFixed(2) });
    expect(entries.every((e) => e.companyId === shopCompanyId && e.status === 'POSTED')).toBe(true);
    expect(entries.some((e) => (e.metadata as { productIds?: string[] }).productIds?.includes(rejected.id))).toBe(false);

    // ยืนยันรูปซ้ำ (เครื่องอยู่ในคลังแล้ว ไม่ผ่านประตูเข้าคลังอีก จึงไม่เรียกตัวลงบัญชีเลย) และเรียกตัวลงบัญชีตรง ๆ ซ้ำ
    // (มีรายการผูกแถวอยู่แล้ว → คืน null) — ทั้งสองทางไม่เกิดรายการที่สอง
    await productPhotosService.completePhotos(waitingPhotos.id, adminId);
    await expect(new ReceivingAcceptanceJournal(prisma as never).bookIfPending(prisma as never, waitingPhotos.id)).resolves.toBeNull();
    expect(await receivingEntries(po.id)).toHaveLength(3);
  }, 120_000);

  it('ข้อ 8 — เครื่องที่ไม่ได้มาจากใบรับของ / รับก่อนมีระบบนี้ ไม่ถูกลงบัญชีตอนเข้าคลัง', async () => {
    const supplier = await seedSupplier('Q8LEGACY', false);
    const po = await createOrderedPo(supplier.id, [{ category: 'PHONE_USED', model: `${PREFIX}Q8L`, quantity: 1, unitPrice: 3000 }]);
    const received = await service.goodsReceiving(
      po.id,
      { items: [{ poItemId: poItemOf(po, `${PREFIX}Q8L`).id, imeiSerial: nextImei(), status: 'PASS' }] } as never,
      adminId,
    );
    const unit = received.products[0];
    // แถวรับของยุคก่อนระบบลงบัญชีรับของไม่มีต้นทุนที่ปันไว้ (จำลองด้วยการล้างค่า)
    await prisma.goodsReceivingItem.update({ where: { productId: unit.id }, data: { receivedCost: null } });

    const booking = new ReceivingAcceptanceJournal(prisma as never);
    await expect(booking.bookIfPending(prisma as never, unit.id)).resolves.toBeNull();
    await expect(booking.bookIfPending(prisma as never, '00000000-0000-4000-8000-000000000000')).resolves.toBeNull();
    await productsService.update(unit.id, { status: 'IN_STOCK', cashPrice: 4500 } as never, adminId);
    expect(await receivingEntries(po.id)).toHaveLength(0);
  }, 60_000);

  it('ข้อ 8 — ประตูเข้าคลังที่เหลือ (นำเข้าคลังพร้อมขาย / พบของ) ลงบัญชีเหมือนกัน · ตีกลับชนยืนยันรูป = ไม่ลงเครื่องที่ถูกตีกลับ', async () => {
    const supplier = await seedSupplier('Q8GATES', false);
    const po = await createOrderedPo(supplier.id, [{ category: 'PHONE_USED', model: `${PREFIX}Q8G`, quantity: 3, unitPrice: 3000 }]);
    const item = poItemOf(po, `${PREFIX}Q8G`);
    const received = await service.goodsReceiving(
      po.id,
      { items: [1, 2, 3].map(() => ({ poItemId: item.id, imeiSerial: nextImei(), status: 'PASS' })) } as never,
      adminId,
    );
    expect(received.journalEntryNo).toBeNull();
    const [viaReturn, viaFound, raced] = received.products;
    const cost = (await prisma.goodsReceivingItem.findUnique({ where: { productId: viaReturn.id } }))!.receivedCost!.toFixed(2);

    // (ก) รอถ่ายรูป → ซ่อม/รอตรวจ (REFURBISHED) → ปุ่ม "นำเข้าคลังพร้อมขาย"
    await productsService.update(viaReturn.id, { status: 'REFURBISHED' } as never, adminId);
    await productsService.returnToStock(viaReturn.id, adminId, { cashPrice: 5900, installmentPrice: 6900 });

    // (ข) รอถ่ายรูป → รอตรวจ (INSPECTION) → แจ้งหาย → พบของ (ต้องมีผู้อนุมัติคนละคน)
    let approver = await prisma.user.findFirst({ where: { email: `${PREFIX.toLowerCase()}bm@bestchoice.test` } });
    if (!approver) {
      approver = await prisma.user.create({
        data: { email: `${PREFIX.toLowerCase()}bm@bestchoice.test`, password: 'x', name: 'ผจก.ทดสอบ', role: 'BRANCH_MANAGER' },
      });
      createdUserIds.push(approver.id);
    }
    await productsService.update(viaFound.id, { status: 'INSPECTION' } as never, adminId);
    await stockAdjustmentsService.create({ productId: viaFound.id, reason: 'LOST', approverId: approver.id } as never, adminId);
    expect(await receivingEntries(po.id)).toHaveLength(1); // หายไม่ลงอะไร
    await stockAdjustmentsService.create({ productId: viaFound.id, reason: 'FOUND', approverId: approver.id } as never, adminId);
    const found = (await prisma.product.findUnique({ where: { id: viaFound.id } }))!;
    expect([found.status, found.deletedAt]).toEqual(['IN_STOCK', null]);

    // (ค) กด "ไม่รับเข้าคลัง" commit ไปก่อน แล้วคำขอยืนยันรูปที่อ่านค่าไว้ก่อนหน้า (ยังเห็นว่ารอถ่ายรูป)
    // มาเขียนสถานะทับ — จำลองลำดับเดียวกับที่ `completePhotos` ทำใน tx ของมัน
    await service.rejectQC([raced.id], 'ตรวจแล้วไม่ผ่าน ส่งคืนผู้จัดจำหน่าย');
    const booking = new ReceivingAcceptanceJournal(prisma as never);
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.product.update({ where: { id: raced.id }, data: { status: 'IN_STOCK', stockInDate: new Date() } });
        return booking.bookIfPending(tx as never, raced.id);
      }),
    ).rejects.toThrow(/รีเฟรชหน้าจอ/);
    const afterRace = (await prisma.product.findUnique({ where: { id: raced.id } }))!;
    expect(afterRace.status).toBe('PHOTO_PENDING'); // ทั้ง tx ย้อนกลับ
    expect(afterRace.deletedAt).not.toBeNull();
    expect((await prisma.goodsReceivingItem.findUnique({ where: { productId: raced.id } }))!.journalEntryId).toBeNull();

    // สองเครื่องที่เข้าคลังจริง = สองรายการ ยอดตามต้นทุนที่ปันไว้ · เครื่องที่ถูกตีกลับไม่อยู่ในบัญชี
    const entries = await receivingEntries(po.id);
    expect(entries.map((e) => (e.metadata as { acceptedProductId?: string }).acceptedProductId).sort()).toEqual(
      [viaReturn.id, viaFound.id].sort(),
    );
    const total = dec(cost).times(2).toFixed(2);
    expect(netByAccount(entries)).toEqual({ 'S11-2002': total, 'S21-1101': dec(total).neg().toFixed(2) });
    expect(entries.every((e) => (e.metadata as { postedOnAcceptanceDate?: boolean }).postedOnAcceptanceDate === false)).toBe(true);
  }, 120_000);
  it('ข3 — ลงบัญชีด้วยวันที่ในเอกสาร · เก็บประเภท/เลขที่/วันที่บนใบรับของ · ตัวตรวจเลขซ้ำ', async () => {
    const supplier = await seedSupplier('K3DOC', true);
    const po = await createOrderedPo(supplier.id, [{ category: 'PHONE_NEW', model: `${PREFIX}K3`, quantity: 1, unitPrice: 10000 }]);
    const docNumber = `IV2609-${RUN}`;
    const doc = pastDoc(1, 15);

    const result = await service.goodsReceiving(
      po.id,
      {
        items: [{ poItemId: poItemOf(po, `${PREFIX}K3`).id, imeiSerial: nextImei(), status: 'PASS', sellingPrice: 13900 }],
        supplierDocType: 'TAX_INVOICE',
        supplierDocNumber: `  ${docNumber}  `,
        supplierDocDate: doc.iso,
      } as never,
      adminId,
    );
    k3GrNumbers.push(result.grNumber);

    // วันที่ในเอกสาร = เที่ยงคืนเวลาไทยของวันนั้น
    const docDate = doc.stored;
    expect(result.supplierDocPeriodClosed).toBe(false);
    const receiving = await prisma.goodsReceiving.findUniqueOrThrow({ where: { id: result.receivingId } });
    expect(receiving.supplierDocType).toBe('TAX_INVOICE');
    expect(receiving.supplierDocNumber).toBe(docNumber);
    expect(receiving.supplierDocDate?.toISOString()).toBe(docDate);

    const [entry] = await receivingEntries(po.id);
    expect(entry.postedAt?.toISOString()).toBe(docDate);
    expect(entry.entryDate.toISOString()).toBe(docDate);
    expect(entry.description).toContain(`ใบกำกับภาษี ${docNumber}`);
    expect(entry.metadata).toMatchObject({
      supplierDocType: 'TAX_INVOICE',
      supplierDocNumber: docNumber,
      supplierDocDate: doc.iso,
      postedOnReceiveDate: false,
    });

    // เลขเดิมของผู้จัดจำหน่ายเดิม (ตัวพิมพ์/ช่องว่างต่างกัน) = ซ้ำ · ผู้จัดจำหน่ายอื่น = ไม่ซ้ำ
    const dup = await service.checkReceivingDoc({ supplierId: supplier.id, docNumber: ` ${docNumber.toLowerCase()} `, docDate: doc.iso });
    expect(dup.duplicates.map((d) => d.grNumber)).toEqual([result.grNumber]);
    expect(dup.periodClosed).toBe(false);
    const other = await seedSupplier('K3OTHER', true);
    expect((await service.checkReceivingDoc({ supplierId: other.id, docNumber })).duplicates).toEqual([]);
  }, 60_000);

  it('ข3 แบบ ข — งวดของวันที่ในเอกสารปิดแล้ว: รับได้ ลงวันที่รับของแทน (ทั้งใบรับของและหน่วยที่เข้าคลังทีหลัง) + แจ้งฝ่ายบัญชี', async () => {
    const doc = pastDoc(3, 20);
    const period = await closeShopPeriod(doc.year, doc.month);
    try {
      const supplier = await seedSupplier('K3CLOSED', false);
      const po = await createOrderedPo(supplier.id, [{ category: 'PHONE_USED', model: `${PREFIX}K3C`, quantity: 2, unitPrice: 4200 }]);
      const line = poItemOf(po, `${PREFIX}K3C`).id;

      // หน้าจอเตือนก่อนกดยืนยัน — ตัวตรวจเดียวกับตอนลงบัญชี
      expect((await service.checkReceivingDoc({ supplierId: supplier.id, docDate: doc.iso })).periodClosed).toBe(true);

      const result = await service.goodsReceiving(
        po.id,
        {
          items: [
            { poItemId: line, imeiSerial: nextImei(), status: 'PASS', anglePhotos: FULL_ANGLES, sellingPrice: 5900 }, // เข้าคลังทันที
            { poItemId: line, imeiSerial: nextImei(), status: 'PASS' }, // รอถ่ายรูป
          ],
          supplierDocType: 'DELIVERY_NOTE',
          supplierDocNumber: `DN-${RUN}`,
          supplierDocDate: doc.iso,
        } as never,
        adminId,
      );
      k3GrNumbers.push(result.grNumber);
      expect(result.supplierDocPeriodClosed).toBe(true);
      expect(result.accountingNotified).toBe(true);

      // วันที่ในเอกสารเก็บตามจริง แต่รายการบัญชีลงวันที่รับของ
      const receiving = await prisma.goodsReceiving.findUniqueOrThrow({ where: { id: result.receivingId } });
      expect(receiving.supplierDocDate?.toISOString()).toBe(doc.stored);
      const [lot] = await receivingEntries(po.id);
      expect(lot.postedAt?.getTime()).toBe(receiving.createdAt.getTime());
      expect(lot.metadata).toMatchObject({ postedOnReceiveDate: true, supplierDocDate: doc.iso });

      // หน่วยที่รอถ่ายรูปเข้าคลังทีหลัง → วันเดียวกับใบรับของ (วันที่รับของ) ไม่ใช่วันที่ในเอกสาร และไม่ใช่วันที่เข้าคลัง
      const pending = result.products[1];
      await productsService.update(pending.id, { status: 'IN_STOCK', cashPrice: 5900 } as never, adminId);
      const unit = (await receivingEntries(po.id)).find((e) => e.referenceId === `gr:${result.receivingId}:${pending.id}`);
      expect(unit?.postedAt?.getTime()).toBe(receiving.createdAt.getTime());
      expect(unit?.metadata).toMatchObject({ postedOnReceiveDate: true, postedOnAcceptanceDate: false });

      // แจ้งฝ่ายบัญชี — งานหนึ่งใบ
      const todos = await prisma.todo.findMany({
        where: { tags: { has: 'goods-receiving-period' }, title: { contains: result.grNumber } },
      });
      expect(todos).toHaveLength(1);
      expect(todos[0].description).toContain(doc.thai);
      expect(todos[0].description).toContain(po.poNumber);
      expect(todos[0].description).toContain(`ใบส่งของ / ใบแจ้งหนี้ DN-${RUN}`);
      expect(todos[0].title).toContain(`งวด${doc.monthLabel}`);
    } finally {
      await period.restore();
    }
  }, 120_000);

  it('ข3 — ตรวจช่องเอกสารก่อนรับของ · ไม่มีเอกสาร + เหตุผล = ลงวันที่รับของ ไม่เก็บเลขที่/วันที่', async () => {
    const supplier = await seedSupplier('K3VAL', true);
    const po = await createOrderedPo(supplier.id, [{ category: 'PHONE_NEW', model: `${PREFIX}K3V`, quantity: 1, unitPrice: 10000 }]);
    const items = () => [{ poItemId: poItemOf(po, `${PREFIX}K3V`).id, imeiSerial: nextImei(), status: 'PASS', sellingPrice: 13900 }];
    const receive = (doc: Record<string, unknown>) => service.goodsReceiving(po.id, { items: items(), ...doc } as never, adminId);
    const tomorrow = bangkokDateString(new Date(Date.now() + 24 * 60 * 60 * 1000));
    const valid = pastDoc(1, 15).iso;

    await expect(receive({ supplierDocType: 'TAX_INVOICE', supplierDocDate: valid })).rejects.toThrow('กรุณากรอกเลขที่เอกสาร');
    await expect(receive({ supplierDocType: 'TAX_INVOICE', supplierDocNumber: '   ', supplierDocDate: valid })).rejects.toThrow('กรุณากรอกเลขที่เอกสาร');
    await expect(receive({ supplierDocType: 'TAX_INVOICE', supplierDocNumber: 'IV-1', supplierDocDate: '2016-09-15' })).rejects.toThrow('วันที่ในเอกสารเก่าเกิน 365 วัน');
    await expect(receive({ supplierDocType: 'CASH_BILL', supplierDocNumber: 'CB-1' })).rejects.toThrow('กรุณาเลือกวันที่ในเอกสาร');
    await expect(receive({ supplierDocType: 'CASH_BILL', supplierDocNumber: 'CB-1', supplierDocDate: '2026-02-30' })).rejects.toThrow('วันที่ในเอกสารไม่ถูกต้อง');
    await expect(receive({ supplierDocType: 'CASH_BILL', supplierDocNumber: 'CB-1', supplierDocDate: tomorrow })).rejects.toThrow('วันที่ในเอกสารต้องไม่เกินวันนี้');
    await expect(receive({ supplierDocType: 'NONE' })).rejects.toThrow('กรุณาเขียนเหตุผลที่ไม่มีเอกสาร');
    await expect(receive({ supplierDocType: 'NONE', notes: '   ' })).rejects.toThrow('กรุณาเขียนเหตุผลที่ไม่มีเอกสาร');
    expect(await prisma.goodsReceiving.count({ where: { poId: po.id } })).toBe(0);

    const result = await receive({ supplierDocType: 'NONE', supplierDocNumber: 'IGNORED', supplierDocDate: valid, notes: 'ร้านไม่ออกบิล' });
    k3GrNumbers.push(result.grNumber);
    expect(result.supplierDocPeriodClosed).toBe(false);
    const receiving = await prisma.goodsReceiving.findUniqueOrThrow({ where: { id: result.receivingId } });
    expect(receiving).toMatchObject({ supplierDocType: 'NONE', supplierDocNumber: null, supplierDocDate: null, notes: 'ร้านไม่ออกบิล' });
    const [entry] = await receivingEntries(po.id);
    expect(entry.postedAt?.getTime()).toBe(receiving.createdAt.getTime());
    expect(entry.metadata).toMatchObject({ supplierDocType: 'NONE', postedOnReceiveDate: false });
  }, 60_000);

  it('ข3 — รับเข้าตรงส่งช่องเอกสารต่อให้ใบรับของ', async () => {
    const supplier = await seedSupplier('K3DIRECT', false);
    const result = await service.directReceive(
      {
        supplierId: supplier.id,
        orderDate: new Date().toISOString().slice(0, 10),
        items: [
          {
            category: 'ACCESSORY',
            brand: `${PREFIX}Brand`,
            model: `${PREFIX}K3D`,
            quantity: 1,
            unitPrice: 300,
            status: 'PASS',
            sellingPrice: 590,
          },
        ],
        supplierDocType: 'CASH_BILL',
        supplierDocNumber: `CB-${RUN}`,
        supplierDocDate: pastDoc(1, 16).iso,
      } as never,
      adminId,
    );
    createdPoIds.push(result.poId);
    k3GrNumbers.push(result.grNumber);
    const receiving = await prisma.goodsReceiving.findUniqueOrThrow({ where: { id: result.receivingId } });
    expect(receiving).toMatchObject({ supplierDocType: 'CASH_BILL', supplierDocNumber: `CB-${RUN}` });
    const [entry] = await receivingEntries(result.poId);
    expect(entry.postedAt?.toISOString()).toBe(pastDoc(1, 16).stored);
  }, 60_000);
  it('ข3 — งวดที่ปิดแล้วแต่ยังอยู่ในช่วงผ่อนผัน: วันที่ในเอกสารไม่ย้อนกลับเข้าเดือนที่ฝ่ายบัญชีปิด (ตัดสินจากสถานะงวด)', async () => {
    const grace = await setGraceDays(36500); // ทุกงวดที่ปิดยังอยู่ในช่วงผ่อนผัน — validatePeriodOpen ยอมให้ลง
    const doc = pastDoc(4, 20);
    const period = await closeShopPeriod(doc.year, doc.month);
    try {
      const supplier = await seedSupplier('K3GRACE', true);
      const po = await createOrderedPo(supplier.id, [{ category: 'PHONE_NEW', model: `${PREFIX}K3G`, quantity: 1, unitPrice: 10000 }]);
      expect((await service.checkReceivingDoc({ supplierId: supplier.id, docDate: doc.iso })).periodClosed).toBe(true);
      const result = await service.goodsReceiving(
        po.id,
        {
          items: [{ poItemId: poItemOf(po, `${PREFIX}K3G`).id, imeiSerial: nextImei(), status: 'PASS', sellingPrice: 13900 }],
          supplierDocType: 'TAX_INVOICE',
          supplierDocNumber: `IVG-${RUN}`,
          supplierDocDate: doc.iso,
        } as never,
        adminId,
      );
      k3GrNumbers.push(result.grNumber);
      expect(result.supplierDocPeriodClosed).toBe(true);
      const receiving = await prisma.goodsReceiving.findUniqueOrThrow({ where: { id: result.receivingId } });
      const [entry] = await receivingEntries(po.id);
      expect(entry.postedAt?.getTime()).toBe(receiving.createdAt.getTime());
    } finally {
      await period.restore();
      await grace.restore();
    }
  }, 60_000);

  it('ข3 — งวดของวันที่ในเอกสารปิดหลังรับของ: หน่วยที่เข้าคลังทีหลังลงวันที่รับของ + งานแจ้งฝ่ายบัญชี (ใบเดียวต่อใบรับของ)', async () => {
    const doc = pastDoc(5, 20);
    const supplier = await seedSupplier('K3LATE', false);
    const po = await createOrderedPo(supplier.id, [{ category: 'PHONE_USED', model: `${PREFIX}K3L`, quantity: 3, unitPrice: 4200 }]);
    const line = poItemOf(po, `${PREFIX}K3L`).id;
    const result = await service.goodsReceiving(
      po.id,
      {
        items: [
          { poItemId: line, imeiSerial: nextImei(), status: 'PASS', anglePhotos: FULL_ANGLES, sellingPrice: 5900 }, // ลงวันที่ในเอกสาร
          { poItemId: line, imeiSerial: nextImei(), status: 'PASS' }, // รอถ่ายรูป
          { poItemId: line, imeiSerial: nextImei(), status: 'PASS' }, // รอถ่ายรูป
        ],
        supplierDocType: 'DELIVERY_NOTE',
        supplierDocNumber: `DNL-${RUN}`,
        supplierDocDate: doc.iso,
      } as never,
      adminId,
    );
    k3GrNumbers.push(result.grNumber);
    expect(result.supplierDocPeriodClosed).toBe(false);
    const [lot] = await receivingEntries(po.id);
    expect(lot.postedAt?.toISOString()).toBe(doc.stored);

    // ฝ่ายบัญชีปิดงวดของวันที่ในเอกสารระหว่างที่เครื่องยังรอถ่ายรูป
    const period = await closeShopPeriod(doc.year, doc.month);
    try {
      const receiving = await prisma.goodsReceiving.findUniqueOrThrow({ where: { id: result.receivingId } });
      for (const pending of [result.products[1], result.products[2]]) {
        await productsService.update(pending.id, { status: 'IN_STOCK', cashPrice: 5900 } as never, adminId);
        const unit = (await receivingEntries(po.id)).find((e) => e.referenceId === `gr:${result.receivingId}:${pending.id}`);
        expect(unit?.postedAt?.getTime()).toBe(receiving.createdAt.getTime());
        expect(unit?.metadata).toMatchObject({ postedOnReceiveDate: true });
      }
      const todos = await prisma.todo.findMany({
        where: { tags: { has: 'goods-receiving-period' }, title: { contains: result.grNumber } },
      });
      expect(todos).toHaveLength(1);
      expect(todos[0].createdById).toBe(adminId);
    } finally {
      await period.restore();
    }
  }, 120_000);

  it('ข3 — งวดปิดแต่ไม่มีอะไรลงบัญชี (ตรวจไม่ผ่านทั้งใบ) → ไม่สร้างงานแจ้งฝ่ายบัญชี', async () => {
    const doc = pastDoc(6, 20);
    const period = await closeShopPeriod(doc.year, doc.month);
    try {
      const supplier = await seedSupplier('K3REJ', true);
      const po = await createOrderedPo(supplier.id, [{ category: 'PHONE_NEW', model: `${PREFIX}K3R`, quantity: 1, unitPrice: 10000 }]);
      const result = await service.goodsReceiving(
        po.id,
        {
          items: [{ poItemId: poItemOf(po, `${PREFIX}K3R`).id, imeiSerial: nextImei(), status: 'REJECT', rejectReason: 'จอแตก', defectReason: 'SCREEN' }],
          supplierDocType: 'TAX_INVOICE',
          supplierDocNumber: `IVR-${RUN}`,
          supplierDocDate: doc.iso,
        } as never,
        adminId,
      );
      k3GrNumbers.push(result.grNumber);
      expect(result.supplierDocPeriodClosed).toBe(false);
      expect(result.accountingNotified).toBe(false);
      expect(await prisma.todo.count({ where: { tags: { has: 'goods-receiving-period' }, title: { contains: result.grNumber } } })).toBe(0);
    } finally {
      await period.restore();
    }
  }, 60_000);
});
