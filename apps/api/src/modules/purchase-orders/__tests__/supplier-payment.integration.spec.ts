/**
 * จ่ายเงินผู้จัดจำหน่าย (ก้อน 2 · คำตัดสินเจ้าของ 2026-10-05) — พิสูจน์บน DB จริง
 *
 * ทุกการเปลี่ยนสถานะมาจาก service จริง (`PurchaseOrdersService.create` / `goodsReceiving` / `recordSupplierPayment` /
 * `voidSupplierPayment` / `cancel`) — ไม่เขียนแถว PO / การจ่าย / JE ด้วย prisma ตรง ๆ
 *
 * สิ่งที่พิสูจน์:
 *   1. มัดจำก่อนรับของ → Dr S11-4201 / Cr S11-1202 · PO = จ่ายมัดจำ · ยอดมัดจำค้างอ่านจากสมุดบัญชี
 *   2. รับของบางส่วนแล้วจ่ายเกินเจ้าหนี้ → ชำระเท่าเจ้าหนี้ที่เกิดแล้ว ส่วนเกินเป็นมัดจำ (ข้อสมมติ ข) · ยกเลิกรายการ = กลับรายการ
 *   3. ด่านตรวจ: เกินยอดสุทธิ · วันที่อนาคต/เก่าเกิน 365 วัน · ไม่มีสลิป · ยอดศูนย์ · PO ยกเลิกแล้ว → 400 และไม่มีแถว/JE เกิด
 *   4. (Task 4) มัดจำถูกหักเข้าเจ้าหนี้อัตโนมัติตอนรับของ / ตอนเครื่องรอถ่ายรูปผ่านเข้าคลัง · JE รับของติด supplierId
 *   5. (Task 5) ยกเลิกใบสั่งซื้อที่มีมัดจำ: ต้องเลือกได้คืน/ไม่ได้คืน · รับเข้าตรงจ่ายทันที = ชำระใน tx เดียวกัน
 *
 * Runner: vitest (jest ignore `*.integration.spec.ts`). ต้องมี DB จริง:
 *   cd apps/api && DATABASE_URL=... npx vitest run --no-file-parallelism \
 *     src/modules/purchase-orders/__tests__/supplier-payment.integration.spec.ts
 * CI: glob `PO_FILES` ใน `.github/workflows/deploy-gcp.yml` ครอบไฟล์นี้แล้ว
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { seedFinanceCoa } from '../../../../prisma/seed-coa-finance';
import { seedShopCoa } from '../../../../prisma/seed-coa-shop';
import { PurchaseOrdersService } from '../purchase-orders.service';
import { JournalAutoService } from '../../journal/journal-auto.service';
import { CompanyResolverService } from '../../journal/company-resolver.service';
import { ShopAccountResolver } from '../../journal/shop-account-resolver.service';
import { ShopGoodsReceivingTemplate } from '../../journal/cpa-templates/shop-goods-receiving.template';
import { ShopSupplierPaymentTemplate } from '../../journal/cpa-templates/shop-supplier-payment.template';
import { bangkokDateString } from '../../../utils/date.util';
import { ProductsService } from '../../products/products.service';
import { ProductPhotosService } from '../../quality-control/product-photos.service';
import { SupplierPaymentService, SUPPLIER_PAYMENT_PERIOD_TODO_TAG } from '../services/supplier-payment.service';
import { bangkokCalendarParts } from '../../../utils/date.util';

const prisma = new PrismaClient();
const journal = new JournalAutoService(prisma as never);
const companyResolver = new CompanyResolverService(prisma as never);
const shopAccountResolver = new ShopAccountResolver(prisma as never);
const goodsReceivingTemplate = new ShopGoodsReceivingTemplate(journal, prisma as never, companyResolver);
const supplierPaymentTemplate = new ShopSupplierPaymentTemplate(journal, prisma as never, companyResolver);
const service = new PurchaseOrdersService(
  prisma as never,
  goodsReceivingTemplate,
  shopAccountResolver,
  companyResolver,
  supplierPaymentTemplate,
);

const productsService = new ProductsService(prisma as never);
// คอนเนกชันที่สอง — เทสต์แข่งกัน (PrismaClient เดียวซ้อน interactive tx สองตัวไม่ได้ · แบบเดียวกับ contract-cancellation spec)
const prisma2 = new PrismaClient({ transactionOptions: { timeout: 20_000 } });
const companyResolver2 = new CompanyResolverService(prisma2 as never);
const service2 = new SupplierPaymentService(prisma2 as never, {
  template: new ShopSupplierPaymentTemplate(new JournalAutoService(prisma2 as never), prisma2 as never, companyResolver2),
  accounts: new ShopAccountResolver(prisma2 as never),
  companies: companyResolver2,
});
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const productPhotosService = new ProductPhotosService(prisma as never);
const FULL_ANGLES = { front: 'f.jpg', back: 'b.jpg', left: 'l.jpg', right: 'r.jpg', top: 't.jpg', bottom: 'u.jpg' };
const PREFIX = 'SPAYTEST-';
const RUN = Date.now().toString(36).toUpperCase();
const SLIP = 'data:image/png;base64,c2xpcA==';
const today = () => bangkokDateString(new Date());

const createdPoIds: string[] = [];
const createdSupplierIds: string[] = [];
const createdBranchIds: string[] = [];
let adminId: string;
let shopCompanyId: string;
let imeiSeq = 0;
const nextImei = () => `${PREFIX}${RUN}-${String(++imeiSeq).padStart(3, '0')}`;
const dec = (v: string | number) => new Decimal(v);

async function seedSupplier(tag: string, hasVat: boolean) {
  const supplier = await prisma.supplier.create({
    data: { name: `${PREFIX}Supplier ${tag} ${RUN}`, contactName: 'ทดสอบ', phone: '020000000', hasVat },
  });
  createdSupplierIds.push(supplier.id);
  return supplier;
}

type ItemInput = { category: string; model: string; quantity: number; unitPrice: number };

/** ใบสั่งซื้อตัวอย่างเดียวกับเอกสารถามบัญชี 02/10: A 10,000 + B 5,000 − ส่วนลด 300 + VAT = 15,729 (ต้นทุน A 10,486 · B 5,243) */
async function createDocExamplePo(supplierId: string) {
  return createOrderedPo(
    supplierId,
    [
      { category: 'PHONE_NEW', model: `${PREFIX}A`, quantity: 1, unitPrice: 10000 },
      { category: 'PHONE_NEW', model: `${PREFIX}B`, quantity: 1, unitPrice: 5000 },
    ],
    { discount: 300 },
  );
}

async function createOrderedPo(supplierId: string, items: ItemInput[], opts: { discount?: number } = {}) {
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

const poItemOf = (po: { items: { id: string; model: string | null }[] }, model: string) => po.items.find((i) => i.model === model)!;

/** รับของ (ผ่านทุกชิ้น) — ไม่มีเอกสาร ลงบัญชีวันที่รับของ */
async function receive(poId: string, poItemIds: string[], extra: Record<string, unknown> = {}) {
  return service.goodsReceiving(
    poId,
    {
      items: poItemIds.map((poItemId) => ({ poItemId, imeiSerial: nextImei(), status: 'PASS' as const, ...extra })),
      supplierDocType: 'NONE',
      notes: 'ทดสอบ ไม่มีเอกสาร',
    } as never,
    adminId,
  );
}

/** JE ทุกใบของใบสั่งซื้อ (รับของ + จ่ายเงิน + กลับรายการ) พร้อมบรรทัด */
async function poEntries(poId: string) {
  return prisma.journalEntry.findMany({
    where: { deletedAt: null, AND: [{ metadata: { path: ['poId'], equals: poId } as never }] },
    include: { lines: { where: { deletedAt: null } } },
    orderBy: { createdAt: 'asc' },
  });
}

function netByAccount(entries: { lines: { accountCode: string; debit: Decimal | null; credit: Decimal | null }[] }[]) {
  const net: Record<string, Decimal> = {};
  for (const entry of entries) {
    for (const line of entry.lines) {
      net[line.accountCode] = (net[line.accountCode] ?? dec(0)).plus(line.debit ?? 0).minus(line.credit ?? 0);
    }
  }
  return Object.fromEntries(Object.entries(net).filter(([, v]) => !v.isZero()).map(([code, amount]) => [code, amount.toFixed(2)]));
}

const freshPo = (id: string) => prisma.purchaseOrder.findUniqueOrThrow({ where: { id } });

/** ปิดงวดบัญชีของ SHOP เดือนหนึ่งชั่วคราว — คืนค่าเดิม (หรือลบแถวที่สร้าง) ด้วย `restore()` */
async function closeShopPeriod(year: number, month: number) {
  const where = { companyId_year_month: { companyId: shopCompanyId, year, month } };
  const before = await prisma.accountingPeriod.findUnique({ where });
  await prisma.accountingPeriod.upsert({ where, create: { companyId: shopCompanyId, year, month, status: 'CLOSED' }, update: { status: 'CLOSED' } });
  return {
    restore: async () => {
      if (before) await prisma.accountingPeriod.update({ where, data: { status: before.status } });
      else await prisma.accountingPeriod.delete({ where });
    },
  };
}
async function setGraceDays(days: number) {
  const before = await prisma.systemConfig.findUnique({ where: { key: 'period_grace_days' } });
  await prisma.systemConfig.upsert({ where: { key: 'period_grace_days' }, create: { key: 'period_grace_days', value: String(days), label: 'test grace' }, update: { value: String(days) } });
  return {
    restore: async () => {
      if (before) await prisma.systemConfig.update({ where: { key: 'period_grace_days' }, data: { value: before.value } });
      else await prisma.systemConfig.delete({ where: { key: 'period_grace_days' } });
    },
  };
}
/** วันที่ `day` ของเดือน `monthsBack` เดือนก่อน (ปฏิทินไทย) เป็น YYYY-MM-DD + ปี/เดือนของงวด */
function pastDay(monthsBack: number, day: number) {
  const today = bangkokCalendarParts(new Date());
  const first = new Date(Date.UTC(today.year, today.month - monthsBack, 1));
  const year = first.getUTCFullYear();
  const month = first.getUTCMonth() + 1;
  return { year, month, iso: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}` };
}

describe('จ่ายเงินผู้จัดจำหน่าย — flow จริงบน DB จริง', () => {
  beforeAll(async () => {
    await seedFinanceCoa(prisma);
    await seedShopCoa(prisma);
    const shop = await prisma.companyInfo.findFirstOrThrow({ where: { companyCode: 'SHOP', deletedAt: null } });
    shopCompanyId = shop.id;
    let admin = await prisma.user.findFirst({ where: { email: 'admin@bestchoice.com' } });
    if (!admin) {
      admin = await prisma.user.create({ data: { email: 'admin@bestchoice.com', password: 'x', name: 'admin', role: 'OWNER' } });
    }
    adminId = admin.id;
    const anyBranch = await prisma.branch.findFirst({ where: { isActive: true, deletedAt: null } });
    if (!anyBranch) {
      const branch = await prisma.branch.create({ data: { name: `${PREFIX}warehouse`, companyId: shopCompanyId, isMainWarehouse: true } });
      createdBranchIds.push(branch.id);
    }
  }, 180_000);

  afterAll(async () => {
    // ใบที่หลุดจากการติดตาม (เทสต์ล้มก่อน push id) ก็ต้องถูกลบ — ไม่งั้นเลขที่ใบสั่งซื้อ/ใบรับของแบบนับต่อเดือนชนในรอบถัดไป
    const leaked = await prisma.purchaseOrder.findMany({ where: { supplierId: { in: createdSupplierIds } }, select: { id: true } });
    for (const po of leaked) if (!createdPoIds.includes(po.id)) createdPoIds.push(po.id);
    const jeIds = new Set<string>();
    for (const poId of createdPoIds) (await poEntries(poId)).forEach((e) => jeIds.add(e.id));
    const jeIdList = [...jeIds];
    const poNumbers = (await prisma.purchaseOrder.findMany({ where: { id: { in: createdPoIds } }, select: { poNumber: true } })).map((p) => p.poNumber);
    for (const n of poNumbers) await prisma.todo.deleteMany({ where: { tags: { has: SUPPLIER_PAYMENT_PERIOD_TODO_TAG }, title: { contains: n } } });
    await prisma.journalPostAuditLog.deleteMany({ where: { journalEntryId: { in: jeIdList } } });
    await prisma.journalLine.deleteMany({ where: { journalEntryId: { in: jeIdList } } });
    await prisma.purchaseOrderPayment.deleteMany({ where: { poId: { in: createdPoIds } } });
    await prisma.journalEntry.deleteMany({ where: { id: { in: jeIdList } } });
    const products = await prisma.product.findMany({ where: { poId: { in: createdPoIds } }, select: { id: true } });
    const productIds = products.map((p) => p.id);
    await prisma.goodsReceivingItem.deleteMany({ where: { receiving: { poId: { in: createdPoIds } } } });
    await prisma.goodsReceiving.deleteMany({ where: { poId: { in: createdPoIds } } });
    await prisma.productPrice.deleteMany({ where: { productId: { in: productIds } } });
    await prisma.productPhoto.deleteMany({ where: { productId: { in: productIds } } });
    await prisma.product.deleteMany({ where: { id: { in: productIds } } });
    await prisma.pOItem.deleteMany({ where: { poId: { in: createdPoIds } } });
    await prisma.purchaseOrder.deleteMany({ where: { id: { in: createdPoIds } } });
    await prisma.supplier.deleteMany({ where: { id: { in: createdSupplierIds } } });
    await prisma.branch.deleteMany({ where: { id: { in: createdBranchIds } } });
    expect(await prisma.purchaseOrder.count({ where: { id: { in: createdPoIds } } })).toBe(0);
    await prisma2.$disconnect();
    await prisma.$disconnect();
  }, 180_000);

  it('มัดจำก่อนรับของ → Dr S11-4201 / Cr S11-1202 ติด supplierId · PO = จ่ายมัดจำ · มัดจำค้างอ่านจากสมุดบัญชี', async () => {
    const supplier = await seedSupplier('DEP', true);
    const po = await createDocExamplePo(supplier.id);
    expect(dec(po.netAmount.toString()).toFixed(2)).toBe('15729.00');

    const res = await service.recordSupplierPayment(po.id, { paidAt: today(), amount: 5000, slipUrl: SLIP, reference: 'TXN-1' }, adminId);
    expect(res.payments.map((p) => [p.kind, p.amount])).toEqual([['DEPOSIT', '5000.00']]);
    expect(res.periodClosed).toBe(false);
    expect(res.accountingNotified).toBe(false);

    const je = await prisma.journalEntry.findUniqueOrThrow({ where: { id: res.payments[0].journalEntryId! }, include: { lines: true } });
    expect(netByAccount([je])).toEqual({ 'S11-4201': '5000.00', 'S11-1202': '-5000.00' });
    expect(je.metadata).toMatchObject({ tag: 'SHOP_SUPPLIER_PAYMENT', kind: 'DEPOSIT', poId: po.id, supplierId: supplier.id });
    expect(je.companyId).toBe(shopCompanyId);
    expect(res.payments[0].journalEntryNo).toBe(je.entryNumber);

    const fresh = await freshPo(po.id);
    expect(fresh.paymentStatus).toBe('DEPOSIT_PAID');
    expect(fresh.paidAmount.toFixed(2)).toBe('5000.00');

    const list = await service.listSupplierPayments(po.id);
    expect(list.summary).toMatchObject({ depositOutstanding: '5000.00', payableOutstanding: '0.00', paidTotal: '5000.00', remainingOnPo: '10729.00', status: 'DEPOSIT_PAID' });
    expect(list.payments).toHaveLength(1);
    expect(list.payments[0].createdBy?.id).toBe(adminId);
    expect(list.payments[0].slipUrl).toBe(SLIP);
  });

  it('รับของบางส่วนแล้วจ่ายเกินเจ้าหนี้ → ชำระเท่าเจ้าหนี้ + ส่วนเกินเป็นมัดจำ · ยกเลิกมัดจำ = กลับรายการ · ห้ามเกินยอดสุทธิ', async () => {
    const supplier = await seedSupplier('SET', true);
    const po = await createDocExamplePo(supplier.id);
    await receive(po.id, [poItemOf(po, `${PREFIX}A`).id]); // เจ้าหนี้ S21-1101 10,486

    const r1 = await service.recordSupplierPayment(po.id, { paidAt: today(), amount: 12000, slipUrl: SLIP }, adminId);
    expect(r1.payments.map((p) => [p.kind, p.amount])).toEqual([
      ['SETTLEMENT', '10486.00'],
      ['DEPOSIT', '1514.00'],
    ]);
    const settle = await prisma.journalEntry.findUniqueOrThrow({ where: { id: r1.payments[0].journalEntryId! }, include: { lines: true } });
    expect(netByAccount([settle])).toEqual({ 'S21-1101': '10486.00', 'S11-1202': '-10486.00' });
    expect(r1.summary).toMatchObject({ payableOutstanding: '0.00', depositOutstanding: '1514.00', paidTotal: '12000.00', status: 'PARTIALLY_PAID' });
    expect((await freshPo(po.id)).paidAmount.toFixed(2)).toBe('12000.00');

    // ยกเลิกรายการมัดจำที่บันทึกเกิน → กลับรายการ Dr S11-1202 / Cr S11-4201 ลงวันที่ที่กด
    const deposit = r1.payments[1];
    const v = await service.voidSupplierPayment(po.id, deposit.id, adminId, 'กรอกยอดผิด ที่ถูกคือ 10,486');
    expect(v.reversalJournalEntryNo).toBeTruthy();
    const reversal = await prisma.journalEntry.findUniqueOrThrow({ where: { id: v.payment.reversalJournalEntryId! }, include: { lines: true } });
    expect(netByAccount([reversal])).toEqual({ 'S11-1202': '1514.00', 'S11-4201': '-1514.00' });
    expect(reversal.metadata).toMatchObject({ tag: 'SHOP_SUPPLIER_PAYMENT_REVERSAL', reversesEntryId: deposit.journalEntryId });
    expect(v.payment.voidReason).toBe('กรอกยอดผิด ที่ถูกคือ 10,486');
    expect(v.summary).toMatchObject({ depositOutstanding: '0.00', paidTotal: '10486.00' });
    expect((await freshPo(po.id)).paidAmount.toFixed(2)).toBe('10486.00');
    await expect(service.voidSupplierPayment(po.id, deposit.id, adminId, 'ซ้ำ')).rejects.toBeInstanceOf(BadRequestException);

    // สมุดบัญชีของใบนี้สุทธิ: สินค้า 10,486 · เจ้าหนี้ 0 · ธนาคารจ่ายออก −10,486 · มัดจำ 0
    expect(netByAccount(await poEntries(po.id))).toEqual({ 'S11-2001': '10486.00', 'S11-1202': '-10486.00' });

    // จ่ายได้อีกไม่เกิน 15,729 − 10,486 = 5,243
    await expect(service.recordSupplierPayment(po.id, { paidAt: today(), amount: 6000, slipUrl: SLIP }, adminId)).rejects.toThrow(/เกินยอดสุทธิ/);
    const list = await service.listSupplierPayments(po.id);
    expect(list.payments.map((p) => [p.kind, p.voidedAt !== null])).toEqual([
      ['SETTLEMENT', false],
      ['DEPOSIT', true],
    ]);
  });

  it('ด่านตรวจก่อนบันทึก: วันที่อนาคต · เก่าเกิน 365 วัน · ไม่มีสลิป · ยอดศูนย์ · PO ยกเลิกแล้ว → 400 และไม่มีแถว/JE เกิด', async () => {
    const supplier = await seedSupplier('GUARD', false);
    const po = await createOrderedPo(supplier.id, [{ category: 'PHONE_USED', model: `${PREFIX}U`, quantity: 1, unitPrice: 8000 }]);
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const tooOld = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000);
    const attempts = [
      { paidAt: bangkokDateString(tomorrow), amount: 1000, slipUrl: SLIP },
      { paidAt: bangkokDateString(tooOld), amount: 1000, slipUrl: SLIP },
      { paidAt: today(), amount: 1000, slipUrl: '  ' },
      { paidAt: today(), amount: 0, slipUrl: SLIP },
      { paidAt: today(), amount: -5, slipUrl: SLIP },
    ];
    for (const input of attempts) {
      await expect(service.recordSupplierPayment(po.id, input, adminId)).rejects.toBeInstanceOf(BadRequestException);
    }
    await service.cancel(po.id, adminId);
    await expect(service.recordSupplierPayment(po.id, { paidAt: today(), amount: 1000, slipUrl: SLIP }, adminId)).rejects.toBeInstanceOf(BadRequestException);

    expect(await prisma.purchaseOrderPayment.count({ where: { poId: po.id } })).toBe(0);
    expect(await poEntries(po.id)).toHaveLength(0);
    const fresh = await freshPo(po.id);
    expect(fresh.paymentStatus).toBe('UNPAID');
    expect(fresh.paidAmount.toFixed(2)).toBe('0.00');
    const list = await service.listSupplierPayments(po.id);
    expect(list.payments).toEqual([]);
    expect(list.summary.status).toBe('UNPAID');
  });

  // ───────────── Task 4: หักมัดจำเข้าเจ้าหนี้อัตโนมัติตอนรับของ (ข้อสมมติ ค) ─────────────

  it('มัดจำ 5,000 → รับของทั้งใบ → หักมัดจำเข้าเจ้าหนี้วันเดียวกับรายการรับของ · JE รับของติด supplierId · ชำระส่วนที่เหลือแล้วเจ้าหนี้ศูนย์', async () => {
    const supplier = await seedSupplier('APPLY', true);
    const po = await createDocExamplePo(supplier.id);
    await service.recordSupplierPayment(po.id, { paidAt: today(), amount: 5000, slipUrl: SLIP }, adminId);

    const received = await receive(po.id, [poItemOf(po, `${PREFIX}A`).id, poItemOf(po, `${PREFIX}B`).id]);
    expect(received.depositApplied).toEqual({ amount: '5000.00', journalEntryNo: expect.any(String) });

    const entries = await poEntries(po.id);
    const receivingJe = entries.find((e) => (e.metadata as { tag?: string }).tag === 'SHOP_GOODS_RECEIVING')!;
    expect(receivingJe.metadata).toMatchObject({ supplierId: supplier.id, supplierName: supplier.name });
    const applied = entries.find((e) => (e.metadata as { kind?: string }).kind === 'DEPOSIT_APPLIED')!;
    expect(netByAccount([applied])).toEqual({ 'S21-1101': '5000.00', 'S11-4201': '-5000.00' });
    expect(applied.entryDate.toISOString()).toBe(receivingJe.entryDate.toISOString());
    expect(applied.metadata).toMatchObject({ receivingId: received.receivingId, grNumber: received.grNumber, supplierId: supplier.id });

    const rows = await prisma.purchaseOrderPayment.findMany({ where: { poId: po.id }, orderBy: { createdAt: 'asc' } });
    expect(rows.map((r) => [r.kind, r.amount.toFixed(2), r.receivingId])).toEqual([
      ['DEPOSIT', '5000.00', null],
      ['DEPOSIT_APPLIED', '5000.00', received.receivingId],
    ]);

    const list = await service.listSupplierPayments(po.id);
    expect(list.summary).toMatchObject({ depositOutstanding: '0.00', payableOutstanding: '10729.00', paidTotal: '5000.00', status: 'PARTIALLY_PAID' });
    expect((await freshPo(po.id)).paidAmount.toFixed(2)).toBe('5000.00');

    const settle = await service.recordSupplierPayment(po.id, { paidAt: today(), amount: 10729, slipUrl: SLIP }, adminId);
    expect(settle.payments.map((p) => [p.kind, p.amount])).toEqual([['SETTLEMENT', '10729.00']]);
    expect(settle.summary).toMatchObject({ payableOutstanding: '0.00', paidTotal: '15729.00', remainingOnPo: '0.00', status: 'FULLY_PAID' });
    expect(netByAccount(await poEntries(po.id))).toEqual({ 'S11-2001': '15729.00', 'S11-1202': '-15729.00' });
    expect((await freshPo(po.id)).paymentStatus).toBe('FULLY_PAID');
  });

  it('มัดจำมากกว่าเจ้าหนี้ที่เกิดในครั้งแรก → หักเท่าที่เกิด เหลือรอครั้งถัดไป', async () => {
    const supplier = await seedSupplier('PARTIAL', true);
    const po = await createDocExamplePo(supplier.id);
    await service.recordSupplierPayment(po.id, { paidAt: today(), amount: 6000, slipUrl: SLIP }, adminId);

    const first = await receive(po.id, [poItemOf(po, `${PREFIX}B`).id]); // เจ้าหนี้ 5,243
    expect(first.depositApplied?.amount).toBe('5243.00');
    let list = await service.listSupplierPayments(po.id);
    expect(list.summary).toMatchObject({ depositOutstanding: '757.00', payableOutstanding: '0.00' });

    const second = await receive(po.id, [poItemOf(po, `${PREFIX}A`).id]); // เจ้าหนี้ 10,486
    expect(second.depositApplied?.amount).toBe('757.00');
    list = await service.listSupplierPayments(po.id);
    expect(list.summary).toMatchObject({ depositOutstanding: '0.00', payableOutstanding: '9729.00', paidTotal: '6000.00' });

    const third = await receive(po.id, []).catch((e: Error) => e); // ไม่มีอะไรรับแล้ว — ต้องไม่สร้างรายการหักเพิ่ม
    expect(third).toBeInstanceOf(Error);
    expect(await prisma.purchaseOrderPayment.count({ where: { poId: po.id, kind: 'DEPOSIT_APPLIED' } })).toBe(2);
  });

  it('มือสองรอถ่ายรูป: มัดจำยังค้างจนเครื่องผ่านเข้าคลัง แล้วจึงหักเข้าเจ้าหนี้วันเดียวกับรายการของหน่วย', async () => {
    const supplier = await seedSupplier('USED', false);
    const po = await createOrderedPo(supplier.id, [{ category: 'PHONE_USED', model: `${PREFIX}Used`, quantity: 1, unitPrice: 8000 }]);
    await service.recordSupplierPayment(po.id, { paidAt: today(), amount: 3000, slipUrl: SLIP }, adminId);

    // รูปครบแต่ไม่มีราคา → รอถ่ายรูป (ไม่ลงบัญชี ไม่หักมัดจำ)
    const received = await receive(po.id, [poItemOf(po, `${PREFIX}Used`).id], { anglePhotos: FULL_ANGLES });
    expect(received.products[0].status).toBe('PHOTO_PENDING');
    expect(received.journalEntryNo).toBeNull();
    expect(received.depositApplied).toBeNull();
    let list = await service.listSupplierPayments(po.id);
    expect(list.summary).toMatchObject({ depositOutstanding: '3000.00', payableOutstanding: '0.00', status: 'DEPOSIT_PAID' });

    await productsService.update(received.products[0].id, { cashPrice: 7900 } as never, adminId);
    await productPhotosService.completePhotos(received.products[0].id, adminId);

    const entries = await poEntries(po.id);
    const unitJe = entries.find((e) => (e.metadata as { acceptedProductId?: string }).acceptedProductId === received.products[0].id)!;
    const applied = entries.find((e) => (e.metadata as { kind?: string }).kind === 'DEPOSIT_APPLIED')!;
    expect(unitJe.metadata).toMatchObject({ supplierId: supplier.id });
    expect(netByAccount([applied])).toEqual({ 'S21-1101': '3000.00', 'S11-4201': '-3000.00' });
    expect(applied.entryDate.toISOString()).toBe(unitJe.entryDate.toISOString());
    list = await service.listSupplierPayments(po.id);
    expect(list.summary).toMatchObject({ depositOutstanding: '0.00', payableOutstanding: '5000.00', paidTotal: '3000.00', status: 'PARTIALLY_PAID' });
  });

  // ───────────── Task 5: ยกเลิกใบสั่งซื้อที่มีมัดจำ (คำตัดสินเจ้าของ ข้อ 6) · รับเข้าตรงจ่ายทันที ─────────────

  it('ยกเลิกใบที่มีมัดจำโดยไม่บอกผล → 400 ใบยังอยู่ · ได้คืนครบ → Dr S11-1201 / Cr S11-4201 + CANCELLED + จ่ายแล้ว 0', async () => {
    const supplier = await seedSupplier('CANCEL-R', false);
    const po = await createOrderedPo(supplier.id, [{ category: 'PHONE_USED', model: `${PREFIX}C1`, quantity: 1, unitPrice: 8000 }]);
    await service.recordSupplierPayment(po.id, { paidAt: today(), amount: 3000, slipUrl: SLIP }, adminId);

    await expect(service.cancel(po.id, adminId)).rejects.toThrow(/มัดจำค้าง/);
    expect((await freshPo(po.id)).status).toBe('ORDERED');

    const res = await service.cancel(po.id, adminId, { depositOutcome: 'REFUNDED', refundedAt: today(), slipUrl: SLIP });
    expect(res.status).toBe('CANCELLED');
    expect(res.depositClosed?.payments.map((p) => [p.kind, p.amount, p.bankAccountCode])).toEqual([['DEPOSIT_REFUND', '3000.00', 'S11-1201']]);
    const je = await prisma.journalEntry.findUniqueOrThrow({ where: { id: res.depositClosed!.payments[0].journalEntryId! }, include: { lines: true } });
    expect(netByAccount([je])).toEqual({ 'S11-1201': '3000.00', 'S11-4201': '-3000.00' });
    const fresh = await freshPo(po.id);
    expect(fresh.status).toBe('CANCELLED');
    expect(fresh.paidAmount.toFixed(2)).toBe('0.00');
    expect(fresh.paymentStatus).toBe('UNPAID');
    expect(netByAccount(await poEntries(po.id))).toEqual({ 'S11-1202': '-3000.00', 'S11-1201': '3000.00' });
    expect((await service.listSupplierPayments(po.id)).summary.depositOutstanding).toBe('0.00');
  });

  it('ได้คืนไม่ครบ → คืน 2,000 เข้า S11-1201 + ส่วนขาด 1,000 ลง S53-1105 · ไม่ได้คืน → S53-1105 ทั้งก้อน (ต้องมีเหตุผล)', async () => {
    const supplier = await seedSupplier('CANCEL-P', false);
    const partial = await createOrderedPo(supplier.id, [{ category: 'PHONE_USED', model: `${PREFIX}C2`, quantity: 1, unitPrice: 8000 }]);
    await service.recordSupplierPayment(partial.id, { paidAt: today(), amount: 3000, slipUrl: SLIP }, adminId);
    const r1 = await service.cancel(partial.id, adminId, { depositOutcome: 'REFUNDED', refundAmount: 2000, slipUrl: SLIP, reason: 'หักค่าดำเนินการ' });
    expect(r1.depositClosed?.payments.map((p) => [p.kind, p.amount])).toEqual([
      ['DEPOSIT_REFUND', '2000.00'],
      ['DEPOSIT_FORFEIT', '1000.00'],
    ]);
    expect(netByAccount(await poEntries(partial.id))).toEqual({ 'S11-1202': '-3000.00', 'S11-1201': '2000.00', 'S53-1105': '1000.00' });
    expect((await freshPo(partial.id)).paidAmount.toFixed(2)).toBe('1000.00'); // เงินที่เสียไปจริง

    const forfeit = await createOrderedPo(supplier.id, [{ category: 'PHONE_USED', model: `${PREFIX}C3`, quantity: 1, unitPrice: 8000 }]);
    await service.recordSupplierPayment(forfeit.id, { paidAt: today(), amount: 3000, slipUrl: SLIP }, adminId);
    await expect(service.cancel(forfeit.id, adminId, { depositOutcome: 'FORFEITED' })).rejects.toThrow(/เหตุผล/);
    await expect(service.cancel(forfeit.id, adminId, { depositOutcome: 'REFUNDED', refundAmount: 5000, slipUrl: SLIP })).rejects.toThrow(/ไม่เกินมัดจำค้าง/);
    expect((await freshPo(forfeit.id)).status).toBe('ORDERED');
    const r2 = await service.cancel(forfeit.id, adminId, { depositOutcome: 'FORFEITED', reason: 'ผู้จัดจำหน่ายริบมัดจำ' });
    expect(r2.depositClosed?.payments.map((p) => [p.kind, p.amount])).toEqual([['DEPOSIT_FORFEIT', '3000.00']]);
    expect(netByAccount(await poEntries(forfeit.id))).toEqual({ 'S11-1202': '-3000.00', 'S53-1105': '3000.00' });
    expect((await freshPo(forfeit.id)).status).toBe('CANCELLED');
  });

  it('รับเข้าตรงจ่ายทันที: โอน + สลิป → ชำระค่าสินค้าใน tx เดียวกับรับของ · เงินสด → 400 ไม่มีใบสั่งซื้อเกิด', async () => {
    const supplier = await seedSupplier('DIRECT', false);
    const dto = () => ({
      supplierId: supplier.id,
      orderDate: today(),
      supplierDocType: 'NONE',
      notes: 'ทดสอบ ไม่มีเอกสาร',
      items: [{ category: 'PHONE_NEW', brand: `${PREFIX}Brand`, model: `${PREFIX}D`, storage: '128GB', quantity: 1, unitPrice: 9000, imeiSerial: nextImei(), status: 'PASS' }],
      paymentStatus: 'FULLY_PAID',
      paymentMethod: 'BANK_TRANSFER',
      paidAmount: 9000,
      paymentNotes: 'โอนทันที',
      attachments: [SLIP],
    });
    const before = await prisma.purchaseOrder.count({ where: { supplierId: supplier.id } });
    await expect(service.directReceive({ ...dto(), paymentMethod: 'CASH' } as never, adminId)).rejects.toThrow(/โอนธนาคาร/);
    await expect(service.directReceive({ ...dto(), attachments: [] } as never, adminId)).rejects.toThrow(/สลิป/);
    expect(await prisma.purchaseOrder.count({ where: { supplierId: supplier.id } })).toBe(before);

    const res = await service.directReceive(dto() as never, adminId);
    createdPoIds.push(res.poId);
    expect(res.payment?.payments.map((p) => [p.kind, p.amount])).toEqual([['SETTLEMENT', '9000.00']]);
    const po = await freshPo(res.poId);
    expect(po.paymentStatus).toBe('FULLY_PAID');
    expect(po.paidAmount.toFixed(2)).toBe('9000.00');
    expect(po.paymentMethod).toBe('BANK_TRANSFER');
    expect(netByAccount(await poEntries(po.id))).toEqual({ 'S11-2001': '9000.00', 'S11-1202': '-9000.00' });
    const list = await service.listSupplierPayments(po.id);
    expect(list.summary).toMatchObject({ payableOutstanding: '0.00', depositOutstanding: '0.00', status: 'FULLY_PAID' });
  });

  // ───────────── Task 6: เจ้าหนี้รายผู้จัดจำหน่ายจากสมุดบัญชี (บัญชีย่อยตามผู้ติดต่อ) ─────────────

  it('ledger รายผู้จัดจำหน่าย: ยกมา/รับของ/จ่าย/คงเหลือ/มัดจำค้าง ตรงกับสมุดบัญชี · รายการเคลื่อนไหวไล่ยอดคงเหลือจนศูนย์', async () => {
    const paidUp = await seedSupplier('LEDGER-X', true);
    const owed = await seedSupplier('LEDGER-Y', false);
    const month = today().slice(0, 7);

    const poX = await createDocExamplePo(paidUp.id);
    await service.recordSupplierPayment(poX.id, { paidAt: today(), amount: 5000, slipUrl: SLIP }, adminId);
    await receive(poX.id, [poItemOf(poX, `${PREFIX}A`).id, poItemOf(poX, `${PREFIX}B`).id]);
    await service.recordSupplierPayment(poX.id, { paidAt: today(), amount: 10729, slipUrl: SLIP }, adminId);

    const poY = await createOrderedPo(owed.id, [{ category: 'ACCESSORY', model: `${PREFIX}Case`, quantity: 2, unitPrice: 450 }]);
    await receive(poY.id, [poItemOf(poY, `${PREFIX}Case`).id, poItemOf(poY, `${PREFIX}Case`).id]);
    const poY2 = await createOrderedPo(owed.id, [{ category: 'PHONE_USED', model: `${PREFIX}Y2`, quantity: 1, unitPrice: 6000 }]);
    await service.recordSupplierPayment(poY2.id, { paidAt: today(), amount: 1000, slipUrl: SLIP }, adminId); // มัดจำค้าง ยังไม่รับของ

    const ledger = await service.getSupplierLedger(month);
    expect(ledger.month).toBe(month);
    const rowX = ledger.suppliers.find((r) => r.supplier.id === paidUp.id)!;
    expect(rowX).toMatchObject({ opening: '0.00', receipts: '15729.00', payments: '15729.00', closing: '0.00', depositsOutstanding: '0.00', openPoCount: 0, nextDue: null });
    const rowY = ledger.suppliers.find((r) => r.supplier.id === owed.id)!;
    expect(rowY).toMatchObject({ opening: '0.00', receipts: '900.00', payments: '0.00', closing: '900.00', depositsOutstanding: '1000.00', openPoCount: 2 });
    expect(rowY.supplier).toMatchObject({ name: owed.name, hasVat: false });
    expect(rowY.payableByAccount).toEqual({ 'S21-1102': '900.00' });
    expect(rowY.openPos.map((o) => [o.poNumber, o.remaining, o.paymentStatus])).toEqual(
      expect.arrayContaining([
        [poY.poNumber, '900.00', 'UNPAID'],
        [poY2.poNumber, '5000.00', 'DEPOSIT_PAID'],
      ]),
    );
    expect(rowX.openPos).toEqual([]);
    expect(Number(ledger.totals.closing)).toBeGreaterThanOrEqual(900);
    expect(Number(ledger.totals.depositsOutstanding)).toBeGreaterThanOrEqual(1000);

    const moves = await service.getSupplierLedgerMovements(paidUp.id, month);
    expect(moves.supplier.id).toBe(paidUp.id);
    expect(moves.opening).toBe('0.00');
    expect(moves.rows.map((r) => [r.kind, r.payableIncrease, r.payableDecrease, r.depositChange, r.running])).toEqual([
      ['DEPOSIT', '0.00', '0.00', '5000.00', '0.00'],
      ['RECEIVING', '15729.00', '0.00', '0.00', '15729.00'],
      ['DEPOSIT_APPLIED', '0.00', '5000.00', '-5000.00', '10729.00'],
      ['SETTLEMENT', '0.00', '10729.00', '0.00', '0.00'],
    ]);
    expect(moves.rows[1]).toMatchObject({ poNumber: poX.poNumber, entryNumber: expect.any(String) });
    expect(moves.closing).toBe('0.00');
  });

  // ───────────── รอบแก้หลังผู้ตรวจอิสระ (2026-10-05) ─────────────

  it('[race] ยกเลิกใบขณะมัดจำกำลังถูกบันทึก (tx ค้าง) → การยกเลิกต้องรอล็อกใบ แล้วปฏิเสธเพราะมีมัดจำค้าง ไม่ใช่ยกเลิกทิ้งเงิน', async () => {
    const supplier = await seedSupplier('RACE-C', false);
    const po = await createOrderedPo(supplier.id, [{ category: 'PHONE_USED', model: `${PREFIX}RC`, quantity: 1, unitPrice: 8000 }]);
    await prisma2.$queryRaw`SELECT 1`;
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    let gateHit = false;
    const t1 = prisma2.$transaction(async (tx) => {
      await service2.recordInTx(tx as never, po.id, { paidAt: today(), amount: 3000, slipUrl: SLIP }, adminId);
      gateHit = true;
      await gate; // ค้าง tx ไว้หลังบันทึกมัดจำ ยังไม่ commit
    }, { timeout: 20_000 });
    let deadline = Date.now() + 5_000;
    while (!gateHit && Date.now() < deadline) await sleep(10);
    expect(gateHit).toBe(true);

    // T2 ยกเลิกโดยไม่บอกผลมัดจำ — ต้องไปติดล็อกของใบ (ไม่ใช่ผ่านทางลัดที่มองไม่เห็นมัดจำของ T1)
    const t2 = service.cancel(po.id, adminId).then(() => ({ ok: true, err: null as unknown })).catch((err: unknown) => ({ ok: false, err }));
    let waiters = 0;
    deadline = Date.now() + 6_000;
    while (Date.now() < deadline) {
      const rows = await prisma.$queryRaw<Array<{ n: number }>>(Prisma.sql`SELECT COUNT(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'`);
      waiters = rows[0]?.n ?? 0;
      if (waiters > 0) break;
      await sleep(25);
    }
    release();
    await t1;
    const outcome = await t2;
    expect(waiters, 'การยกเลิกต้องติดคิวบนล็อกของใบก่อน T1 commit').toBeGreaterThan(0);
    expect(outcome.ok).toBe(false);
    expect((outcome.err as Error).message).toMatch(/มัดจำค้าง/);
    const fresh = await freshPo(po.id);
    expect(fresh.status).toBe('ORDERED');
    expect((await service.listSupplierPayments(po.id)).summary.depositOutstanding).toBe('3000.00');
  });

  it('งวดปิด: วันโอนอยู่ในเดือนที่ปิดแล้ว → ลงวันที่วันนี้ + งานแจ้งฝ่ายบัญชี · เดือนปัจจุบันปิดก่อนสิ้นเดือน → ยังลงได้ในช่วงผ่อนผัน + แจ้ง (กติกาเดียวกับรับของ)', async () => {
    const supplier = await seedSupplier('PERIOD', false);
    const po = await createOrderedPo(supplier.id, [{ category: 'PHONE_USED', model: `${PREFIX}P`, quantity: 1, unitPrice: 8000 }]);
    const past = pastDay(2, 15);
    const closedPast = await closeShopPeriod(past.year, past.month);
    try {
      const res = await service.recordSupplierPayment(po.id, { paidAt: past.iso, amount: 1000, slipUrl: SLIP }, adminId);
      expect(res.periodClosed).toBe(true);
      expect(res.accountingNotified).toBe(true);
      expect(res.payments[0].paidAt.toISOString()).toBe(new Date(`${past.iso}T00:00:00+07:00`).toISOString());
      expect(bangkokCalendarParts(res.payments[0].postedAt)).toEqual(bangkokCalendarParts(new Date()));
      const je = await prisma.journalEntry.findUniqueOrThrow({ where: { id: res.payments[0].journalEntryId! } });
      expect(bangkokCalendarParts(je.entryDate)).toEqual(bangkokCalendarParts(new Date()));
      const todo = await prisma.todo.findFirst({ where: { tags: { has: SUPPLIER_PAYMENT_PERIOD_TODO_TAG }, title: { contains: po.poNumber } } });
      expect(todo?.description).toContain('งวดบัญชีที่ปิดแล้ว');
    } finally {
      await closedPast.restore();
    }

    // ฝ่ายบัญชีปิดเดือนปัจจุบันก่อนสิ้นเดือน: กติกาทั้งระบบ (`validatePeriodOpen` ช่วงผ่อนผันนับจากสิ้นเดือน) ยังให้ลงในเดือนนั้นได้
    // พร้อม stamp periodClosed + งานแจ้ง — เหมือนการรับของ · ด่าน 400 ของ `resolvePostingDate` เป็นตาข่ายกรณีวันนี้พ้นช่วงผ่อนผันแล้ว
    const now = bangkokCalendarParts(new Date());
    const closedNow = await closeShopPeriod(now.year, now.month + 1);
    const grace = await setGraceDays(0);
    try {
      const res = await service.recordSupplierPayment(po.id, { paidAt: today(), amount: 500, slipUrl: SLIP }, adminId);
      expect(res.periodClosed).toBe(true);
      expect(res.accountingNotified).toBe(true);
      expect(await prisma.purchaseOrderPayment.count({ where: { poId: po.id } })).toBe(2);
    } finally {
      await grace.restore();
      await closedNow.restore();
    }
  });

  it('requestId: ส่งคำขอเดิมซ้ำ (กดซ้ำ/เน็ตส่งซ้ำ) → ได้รายการเดิม ไม่เกิดรายการผี', async () => {
    const supplier = await seedSupplier('IDEMP', true);
    const po = await createDocExamplePo(supplier.id);
    await receive(po.id, [poItemOf(po, `${PREFIX}A`).id]); // เจ้าหนี้ 10,486
    const input = { paidAt: today(), amount: 10486, slipUrl: SLIP, requestId: `req-${RUN}-1` };
    const first = await service.recordSupplierPayment(po.id, input, adminId);
    const second = await service.recordSupplierPayment(po.id, input, adminId);
    expect(second.payments.map((p) => p.id)).toEqual(first.payments.map((p) => p.id));
    expect(await prisma.purchaseOrderPayment.count({ where: { poId: po.id, deletedAt: null } })).toBe(1);
    expect((await freshPo(po.id)).paidAmount.toFixed(2)).toBe('10486.00');
    expect(netByAccount(await poEntries(po.id))).toEqual({ 'S11-2001': '10486.00', 'S11-1202': '-10486.00' });
  });

  it('ด่าน void: มัดจำที่ถูกหักเข้าเจ้าหนี้แล้ว / รายการที่ระบบสร้าง → 400 ไม่มีการกลับรายการ · เงื่อนไขผู้จัดจำหน่าย (paymentMethod) ไม่ถูกเขียนทับ', async () => {
    const supplier = await seedSupplier('VOIDG', true);
    const po = await service.create(
      { supplierId: supplier.id, orderDate: today(), paymentMethod: 'CREDIT', items: [{ brand: `${PREFIX}Brand`, storage: '128GB', category: 'PHONE_NEW', model: `${PREFIX}V`, quantity: 1, unitPrice: 10000 }] } as never,
      adminId,
      'OWNER',
    );
    createdPoIds.push(po.id);
    const dep = await service.recordSupplierPayment(po.id, { paidAt: today(), amount: 4000, slipUrl: SLIP }, adminId);
    expect((await freshPo(po.id)).paymentMethod).toBe('CREDIT');
    await receive(po.id, [poItemOf(po, `${PREFIX}V`).id]); // หักมัดจำ 4,000 เข้าเจ้าหนี้ 10,700
    const applied = await prisma.purchaseOrderPayment.findFirstOrThrow({ where: { poId: po.id, kind: 'DEPOSIT_APPLIED' } });
    await expect(service.voidSupplierPayment(po.id, dep.payments[0].id, adminId, 'ลองยกเลิก')).rejects.toThrow(/หักเข้าเจ้าหนี้/);
    await expect(service.voidSupplierPayment(po.id, applied.id, adminId, 'ลองยกเลิก')).rejects.toThrow(/ระบบสร้าง/);
    expect(await prisma.purchaseOrderPayment.count({ where: { poId: po.id, voidedAt: { not: null } } })).toBe(0);
    expect((await service.listSupplierPayments(po.id)).summary).toMatchObject({ depositOutstanding: '0.00', payableOutstanding: '6700.00' });
    expect((await freshPo(po.id)).paymentMethod).toBe('CREDIT');
  });

  it('หักมัดจำเข้าเจ้าหนี้ลงวันไม่ก่อนวันโอนมัดจำ: เอกสารลงวันที่ย้อนหลัง มัดจำโอนวันนี้ → รายการหักลงวันนี้ (ไม่ทำให้ S11-4201 ติดลบในเดือนก่อน)', async () => {
    const supplier = await seedSupplier('DATE', true);
    const po = await createDocExamplePo(supplier.id);
    await service.recordSupplierPayment(po.id, { paidAt: today(), amount: 5000, slipUrl: SLIP }, adminId);
    const doc = pastDay(0, Math.max(1, bangkokCalendarParts(new Date()).day - 3)); // วันที่ในเอกสารก่อนหน้า 3 วัน (เดือนเดียวกัน งวดเปิด)
    const received = await service.goodsReceiving(
      po.id,
      { items: [{ poItemId: poItemOf(po, `${PREFIX}A`).id, imeiSerial: nextImei(), status: 'PASS' }], supplierDocType: 'TAX_INVOICE', supplierDocNumber: `IV-${RUN}`, supplierDocDate: doc.iso } as never,
      adminId,
    );
    const entries = await poEntries(po.id);
    const receivingJe = entries.find((e) => (e.metadata as { tag?: string }).tag === 'SHOP_GOODS_RECEIVING')!;
    const applied = entries.find((e) => (e.metadata as { kind?: string }).kind === 'DEPOSIT_APPLIED')!;
    expect(bangkokCalendarParts(receivingJe.entryDate).day).toBe(Number(doc.iso.slice(8, 10)));
    expect(bangkokCalendarParts(applied.entryDate)).toEqual(bangkokCalendarParts(new Date()));
    expect(received.depositApplied?.amount).toBe('5000.00');
  });

  it('รับเข้าตรงจ่ายทันที: วันโอน = วันนี้ (ไม่ใช่ orderDate) — orderDate ล่วงหน้าไม่ทำให้รับของล้ม', async () => {
    const supplier = await seedSupplier('DIRECT-DATE', false);
    const tomorrow = bangkokDateString(new Date(Date.now() + 24 * 60 * 60 * 1000));
    const res = await service.directReceive(
      {
        supplierId: supplier.id, orderDate: tomorrow, supplierDocType: 'NONE', notes: 'ทดสอบ ไม่มีเอกสาร',
        items: [{ category: 'PHONE_NEW', brand: `${PREFIX}Brand`, model: `${PREFIX}DD`, storage: '128GB', quantity: 1, unitPrice: 9000, imeiSerial: nextImei(), status: 'PASS' }],
        paymentStatus: 'FULLY_PAID', paymentMethod: 'BANK_TRANSFER', paidAmount: 9000, attachments: [SLIP],
      } as never,
      adminId,
    );
    createdPoIds.push(res.poId);
    expect(res.payment?.payments[0].kind).toBe('SETTLEMENT');
    expect(bangkokCalendarParts(res.payment!.payments[0].paidAt)).toEqual(bangkokCalendarParts(new Date()));
  });
});
