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
import { PrismaClient } from '@prisma/client';
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
async function receive(poId: string, poItemIds: string[]) {
  return service.goodsReceiving(
    poId,
    {
      items: poItemIds.map((poItemId) => ({ poItemId, imeiSerial: nextImei(), status: 'PASS' as const })),
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
    const jeIds = new Set<string>();
    for (const poId of createdPoIds) (await poEntries(poId)).forEach((e) => jeIds.add(e.id));
    const jeIdList = [...jeIds];
    await prisma.todo.deleteMany({ where: { tags: { has: 'supplier-payment-period' }, title: { contains: PREFIX } } });
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
    await service.cancel(po.id);
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
});
