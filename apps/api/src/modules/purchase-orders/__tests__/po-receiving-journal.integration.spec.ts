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

const prisma = new PrismaClient();

const journal = new JournalAutoService(prisma as never);
const companyResolver = new CompanyResolverService(prisma as never);
const shopAccountResolver = new ShopAccountResolver(prisma as never);
const goodsReceivingTemplate = new ShopGoodsReceivingTemplate(journal, prisma as never, companyResolver);
const cashSaleTemplate = new ShopCashSaleTemplate(journal, prisma as never, companyResolver);
const service = new PurchaseOrdersService(prisma as never, goodsReceivingTemplate, shopAccountResolver, companyResolver);
const productsService = new ProductsService(prisma as never);

const PREFIX = 'POJETEST-';
const RUN = Date.now().toString(36).toUpperCase();
const FLOW = 'shop-goods-receiving';

const createdPoIds: string[] = [];
const createdSupplierIds: string[] = [];
const createdBranchIds: string[] = [];
const syntheticSaleIds: string[] = [];

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
    await prisma.journalPostAuditLog.deleteMany({ where: { journalEntryId: { in: jeIdList } } });
    await prisma.journalLine.deleteMany({ where: { journalEntryId: { in: jeIdList } } });
    await prisma.journalEntry.deleteMany({ where: { id: { in: jeIdList } } });

    const products = await prisma.product.findMany({ where: { poId: { in: createdPoIds } }, select: { id: true } });
    const productIds = products.map((p) => p.id);
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
      { items: [{ poItemId: poItemOf(po, `${PREFIX}Used`).id, imeiSerial: nextImei(), status: 'PASS' }] } as never,
      adminId,
    );

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
      units: [{ inventoryAccountCode: 'S11-2003', payableAccountCode: 'S21-1102', cost: dec(120) }],
    });

    expect(again?.entryNo).toBe(result.journalEntryNo);
    expect(await receivingEntries(po.id)).toHaveLength(1);
  }, 60_000);
});
