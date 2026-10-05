/**
 * ก้อน 3 — คำขอตัดสินค้า (สูญหาย/เสียหาย/ตัดจำหน่าย/พบของคืน) พิสูจน์บน DB จริง (คำตัดสินเจ้าของ 2026-10-05:
 * เจ้าของอนุมัติทุกใบ · คำตอบฝ่ายบัญชี 29–30/09/2569 ข6 ข7 ข้อ 8)
 *
 * ทุกการเปลี่ยนสถานะมาจาก service จริง (`PurchaseOrdersService.create/goodsReceiving` · `StockAdjustmentsService.createRequest/
 * approve/reject/cancel` · `ProductsService.update/remove`) — ไม่เขียนแถว PO / ใบรับของ / สินค้า / คำขอ / JE ด้วย prisma ตรง ๆ
 *
 * สิ่งที่ unit spec (mock) พิสูจน์ไม่ได้ และไฟล์นี้พิสูจน์:
 *   1. LOST บนเครื่องที่ลงบัญชีรับเข้าแล้ว → JE `Dr S53-1102 / Cr S11-2001` ที่ต้นทุน companyId SHOP · S11-2001 ของเครื่องกลับเป็น 0
 *   2. DAMAGED → ไม่มี JE · เครื่องคงในสต๊อก (ข7) · ตัดจำหน่ายต่อจาก DAMAGED ลง JE ได้
 *   3. FOUND → กลับรายการ JE เดิม (กระจก · ใบเดิม metadata.reversed) · เครื่องกลับ IN_STOCK · FOUND ซ้ำถูกปฏิเสธ
 *   4. เครื่องจาก PO ที่ยังรอถ่ายรูป (ไม่มี JE รับเข้า) → ตัดโดยไม่มี JE + Todo แจ้งฝ่ายบัญชี (ข้อ 8)
 *   5. reject / cancel คืนสถานะเดิม (ไม่ใช่ IN_STOCK เสมอ)
 *   6. สองคำขอพร้อมกันบนเครื่องเดียว (สองคอนเนกชัน) → สำเร็จใบเดียว อีกใบ 409 (partial unique index)
 *   7. เครื่องที่รออนุมัติ มองไม่เห็นจาก POS/จอง (ด่านทุกทางกรอง IN_STOCK)
 *   8. ด่านรอบนอก: SALES ต่างสาขา 403 · PATCH สถานะตัดสินค้าถูกปฏิเสธ · ลบเครื่องที่ลงบัญชีแล้วถูกปฏิเสธ
 *
 * Runner: vitest (jest ignore `*.integration.spec.ts`). ต้องมี DB จริง:
 *   cd apps/api && DATABASE_URL=... npx vitest run --no-file-parallelism \
 *     src/modules/inventory/__tests__/stock-adjustment.integration.spec.ts
 * CI: glob `INVENTORY_FILES` ใน `.github/workflows/deploy-gcp.yml` — เพิ่มพร้อมไฟล์นี้
 *
 * Cleanup: SCOPED ตาม id ที่สเปคนี้สร้าง (รวม JE ตัด/กลับรายการ · Todo ที่ service สร้าง)
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { seedFinanceCoa } from '../../../../prisma/seed-coa-finance';
import { seedShopCoa } from '../../../../prisma/seed-coa-shop';
import { PurchaseOrdersService } from '../../purchase-orders/purchase-orders.service';
import { JournalAutoService } from '../../journal/journal-auto.service';
import { CompanyResolverService } from '../../journal/company-resolver.service';
import { ShopAccountResolver } from '../../journal/shop-account-resolver.service';
import { ShopGoodsReceivingTemplate } from '../../journal/cpa-templates/shop-goods-receiving.template';
import { ShopSupplierPaymentTemplate } from '../../journal/cpa-templates/shop-supplier-payment.template';
import { ShopStockWriteOffTemplate, STOCK_WRITEOFF_LOSS_ACCOUNT } from '../../journal/cpa-templates/shop-stock-writeoff.template';
import { ProductsService } from '../../products/products.service';
import { StockReservationService } from '../../products/services/stock-reservation.service';
import { assertManualStatusChangeAllowed } from '../../products/product-status.util';
import { assertSaleProductEligible } from '../../sales/services/sale-product-policy';
import {
  STOCK_ADJUSTMENT_TODO_TAG,
  STOCK_ADJUSTMENT_UNBOOKED_TODO_TAG,
  StockAdjustmentsService,
  adjustmentTodoKey,
} from '../stock-adjustments.service';
import { StockAdjustmentNumberService } from '../stock-adjustment-number.service';

const prisma = new PrismaClient();
const journal = new JournalAutoService(prisma as never);
const companyResolver = new CompanyResolverService(prisma as never);
const shopAccountResolver = new ShopAccountResolver(prisma as never);
const poService = new PurchaseOrdersService(
  prisma as never,
  new ShopGoodsReceivingTemplate(journal, prisma as never, companyResolver),
  shopAccountResolver,
  companyResolver,
  new ShopSupplierPaymentTemplate(journal, prisma as never, companyResolver),
);
const productsService = new ProductsService(prisma as never);
const storageStub = {
  upload: async (key: string) => key,
  delete: async () => undefined,
  getSignedDownloadUrl: async () => 'https://stub',
} as never;
const auditStub = { log: async () => undefined } as never;
const service = new StockAdjustmentsService(
  prisma as never,
  new ShopStockWriteOffTemplate(journal, prisma as never, companyResolver),
  shopAccountResolver,
  companyResolver,
  storageStub,
  new StockAdjustmentNumberService(prisma as never),
  auditStub,
);
// คอนเนกชันที่สอง — เทสต์แข่งกัน (PrismaClient เดียวซ้อน interactive tx สองตัวไม่ได้)
const prisma2 = new PrismaClient({ transactionOptions: { timeout: 20_000 } });
const companyResolver2 = new CompanyResolverService(prisma2 as never);
const service2 = new StockAdjustmentsService(
  prisma2 as never,
  new ShopStockWriteOffTemplate(new JournalAutoService(prisma2 as never), prisma2 as never, companyResolver2),
  new ShopAccountResolver(prisma2 as never),
  companyResolver2,
  storageStub,
  new StockAdjustmentNumberService(prisma2 as never),
  auditStub,
);

const PREFIX = 'SADJTEST-';
const RUN = Date.now().toString(36).toUpperCase();
const WRITEOFF_FLOW = 'shop-stock-writeoff';

const createdPoIds: string[] = [];
const createdSupplierIds: string[] = [];
const createdBranchIds: string[] = [];
const createdUserIds: string[] = [];
const productIds: string[] = [];
let adminId: string;
let salesId: string;
let shopCompanyId: string;
let imeiSeq = 0;
const nextImei = () => `${PREFIX}${RUN}-${String(++imeiSeq).padStart(3, '0')}`;
const dec = (v: string | number | Decimal) => new Decimal(v);
const owner = () => ({ id: adminId, role: 'OWNER', branchId: null });
const salesOf = (branchId: string) => ({ id: salesId, role: 'SALES', branchId });
const JPEG = {
  originalname: 'evidence.jpg',
  mimetype: 'image/jpeg',
  size: 14,
  buffer: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00]),
} as unknown as Express.Multer.File;

async function seedSupplier(tag: string) {
  const supplier = await prisma.supplier.create({
    data: { name: `${PREFIX}Supplier ${tag} ${RUN}`, contactName: 'ทดสอบ', phone: '020000000', hasVat: true },
  });
  createdSupplierIds.push(supplier.id);
  return supplier;
}

/** รับของ 1 รายการ (PHONE_NEW เข้าคลัง+ลงบัญชีทันที · PHONE_USED เข้าคิวรอถ่ายรูป ไม่ลงบัญชี) */
async function receiveOne(tag: string, category: 'PHONE_NEW' | 'PHONE_USED', unitPrice = 10000) {
  const supplier = await seedSupplier(tag);
  const po = await poService.create(
    {
      supplierId: supplier.id,
      orderDate: new Date().toISOString().slice(0, 10),
      items: [{ brand: `${PREFIX}Brand`, storage: '128GB', category, model: `${PREFIX}${tag}`, quantity: 1, unitPrice }],
    } as never,
    adminId,
    'OWNER',
  );
  createdPoIds.push(po.id);
  const received = await poService.goodsReceiving(
    po.id,
    {
      items: [{ poItemId: po.items[0].id, imeiSerial: nextImei(), status: 'PASS' as const }],
      supplierDocType: 'NONE',
      notes: 'ทดสอบ ไม่มีเอกสาร',
    } as never,
    adminId,
  );
  const product = (await prisma.product.findUniqueOrThrow({ where: { id: received.products[0].id } }));
  productIds.push(product.id);
  const grItem = await prisma.goodsReceivingItem.findUniqueOrThrow({ where: { productId: product.id } });
  return { po, product, cost: dec(grItem.receivedCost ?? 0), receivingJeId: grItem.journalEntryId };
}

async function writeoffEntriesOf(adjustmentId: string) {
  return prisma.journalEntry.findMany({
    where: {
      deletedAt: null,
      AND: [{ metadata: { path: ['flow'], equals: WRITEOFF_FLOW } as never }, { metadata: { path: ['adjustmentId'], equals: adjustmentId } as never }],
    },
    include: { lines: { where: { deletedAt: null } } },
  });
}

async function netOf(accountCode: string, jeIds: string[]) {
  const lines = await prisma.journalLine.findMany({ where: { journalEntryId: { in: jeIds }, accountCode, deletedAt: null } });
  return lines.reduce((acc, l) => acc.plus(l.debit).minus(l.credit), dec(0)).toFixed(2);
}

const ownerTodo = (requestNumber: string) =>
  prisma.todo.findFirst({
    where: { tags: { hasEvery: [STOCK_ADJUSTMENT_TODO_TAG, adjustmentTodoKey(requestNumber)] } },
    orderBy: { createdAt: 'desc' },
  });

describe('คำขอตัดสินค้า — flow จริงบน DB จริง (ก้อน 3)', () => {
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

    const salesEmail = `${PREFIX.toLowerCase()}sales@bestchoice.test`;
    let sales = await prisma.user.findFirst({ where: { email: salesEmail } });
    if (!sales) {
      sales = await prisma.user.create({ data: { email: salesEmail, password: 'x', name: 'พนักงานขายทดสอบ', role: 'SALES' } });
      createdUserIds.push(sales.id);
    }
    salesId = sales.id;

    // Todo ของคำขอทดสอบจาก run ก่อน (เลขคำขอรีเซ็ตเมื่อแถวคำขอถูกลบ จึงชนแท็ก sa:<เลข> เดิมได้) — ล้างก่อนเริ่ม
    await prisma.todo.deleteMany({
      where: {
        tags: { hasSome: [STOCK_ADJUSTMENT_TODO_TAG, STOCK_ADJUSTMENT_UNBOOKED_TODO_TAG] },
        OR: [{ title: { contains: 'TEST-' } }, { description: { contains: 'TEST-' } }],
      },
    });
  }, 180_000);

  afterAll(async () => {
    const adjustments = await prisma.stockAdjustment.findMany({
      where: { productId: { in: productIds } },
      select: { id: true, requestNumber: true, journalEntryId: true },
    });
    const todoKeys = adjustments.map((a) => a.requestNumber).filter((n): n is string => !!n).map(adjustmentTodoKey);
    if (todoKeys.length) await prisma.todo.deleteMany({ where: { tags: { hasSome: todoKeys } } });
    const poJes = createdPoIds.length
      ? await prisma.journalEntry.findMany({
          where: { OR: createdPoIds.map((poId) => ({ metadata: { path: ['poId'], equals: poId } as never })) },
          select: { id: true },
        })
      : [];
    const adjJes = adjustments.length
      ? await prisma.journalEntry.findMany({
          where: {
            OR: adjustments.flatMap((a) => [
              { metadata: { path: ['adjustmentId'], equals: a.id } as never },
              { metadata: { path: ['foundAdjustmentId'], equals: a.id } as never },
              ...(a.journalEntryId ? [{ id: a.journalEntryId }] : []),
            ]),
          },
          select: { id: true },
        })
      : [];
    const jeIdList = [...new Set([...poJes, ...adjJes].map((j) => j.id))];
    if (jeIdList.length) {
      await prisma.journalPostAuditLog.deleteMany({ where: { journalEntryId: { in: jeIdList } } });
      await prisma.journalLine.deleteMany({ where: { journalEntryId: { in: jeIdList } } });
      await prisma.journalEntry.deleteMany({ where: { id: { in: jeIdList } } });
    }
    await prisma.stockAdjustment.deleteMany({ where: { productId: { in: productIds } } });
    await prisma.goodsReceivingItem.deleteMany({ where: { receiving: { poId: { in: createdPoIds } } } });
    await prisma.goodsReceiving.deleteMany({ where: { poId: { in: createdPoIds } } });
    await prisma.productPrice.deleteMany({ where: { productId: { in: productIds } } });
    await prisma.productPhoto.deleteMany({ where: { productId: { in: productIds } } });
    await prisma.product.deleteMany({ where: { id: { in: productIds } } });
    await prisma.pOItem.deleteMany({ where: { poId: { in: createdPoIds } } });
    await prisma.purchaseOrder.deleteMany({ where: { id: { in: createdPoIds } } });
    await prisma.supplier.deleteMany({ where: { id: { in: createdSupplierIds } } });
    await prisma.branch.deleteMany({ where: { id: { in: createdBranchIds } } });
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    await prisma.$disconnect();
    await prisma2.$disconnect();
  }, 120_000);

  it('1. LOST บนเครื่องที่ลงบัญชีรับเข้าแล้ว → พักขาย → Todo เจ้าของ → อนุมัติ: Dr S53-1102 / Cr S11-2001 ที่ต้นทุน · S11-2001 ของเครื่องกลับเป็น 0', async () => {
    const { product, cost, receivingJeId } = await receiveOne('LOST1', 'PHONE_NEW');
    expect(product.status).toBe('IN_STOCK');
    expect(receivingJeId).not.toBeNull();
    expect(cost.gt(0)).toBe(true);

    const req = await service.createRequest({ productId: product.id, reason: 'LOST', notes: 'หาไม่พบตอนนับสต๊อก' }, [], salesOf(product.branchId));
    expect(req.status).toBe('PENDING_APPROVAL');
    expect(req.requestNumber).toMatch(/^SA-\d{8}-\d{4}$/);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: product.id } })).status).toBe('ADJUSTMENT_PENDING');
    const todo = await ownerTodo(req.requestNumber!);
    expect(todo?.status).toBe('TODO');
    expect(todo?.priority).toBe('HIGH');

    const result = await service.approve(req.id, owner());
    expect(result.inventoryBooked).toBe(true);
    expect(result.accountingNotified).toBe(false);
    expect(result.productStatus).toBe('LOST');
    expect(result.journalEntryNo).toMatch(/^JE-/);

    const [je] = await writeoffEntriesOf(req.id);
    expect(je).toBeDefined();
    expect(je.companyId).toBe(shopCompanyId);
    expect(je.status).toBe('POSTED');
    const byAcc = Object.fromEntries(je.lines.map((l) => [l.accountCode, [dec(l.debit).toFixed(2), dec(l.credit).toFixed(2)]]));
    expect(byAcc).toEqual({ [STOCK_WRITEOFF_LOSS_ACCOUNT]: [cost.toFixed(2), '0.00'], 'S11-2001': ['0.00', cost.toFixed(2)] });
    expect(await netOf('S11-2001', [receivingJeId!, je.id])).toBe('0.00');

    const after = await prisma.product.findUniqueOrThrow({ where: { id: product.id } });
    expect([after.status, after.deletedAt !== null, after.wasPreviouslyDamaged]).toEqual(['LOST', true, true]);
    const row = await prisma.stockAdjustment.findUniqueOrThrow({ where: { id: req.id } });
    expect([row.status, row.inventoryBooked, row.bookedSource, row.inventoryAccountCode, row.journalEntryId]).toEqual([
      'APPROVED', true, 'GOODS_RECEIVING', 'S11-2001', je.id,
    ]);
    expect(dec(row.costAmount!).toFixed(2)).toBe(cost.toFixed(2));
    expect((await ownerTodo(req.requestNumber!))?.status).toBe('DONE');
  }, 120_000);

  it('2. DAMAGED → ไม่มี JE · เครื่องคงในสต๊อก (ข7) · ตัดจำหน่ายต่อจาก DAMAGED ลง JE ได้', async () => {
    const { product, cost } = await receiveOne('DMG1', 'PHONE_NEW');
    const req = await service.createRequest({ productId: product.id, reason: 'DAMAGED' }, [JPEG], owner());
    expect(req.photos).toHaveLength(1);
    expect(req.photos[0]).toMatch(/^stock-adjustments\//);

    const result = await service.approve(req.id, owner());
    expect([result.journalEntryNo, result.inventoryBooked, result.productStatus]).toEqual([null, null, 'DAMAGED']);
    expect(await writeoffEntriesOf(req.id)).toHaveLength(0);
    const damaged = await prisma.product.findUniqueOrThrow({ where: { id: product.id } });
    expect([damaged.status, damaged.deletedAt, damaged.wasPreviouslyDamaged]).toEqual(['DAMAGED', null, true]);

    // ของเสียเก็บไว้ แล้วตัดทิ้งภายหลัง → ลง JE ตามปกติ (เครื่องเคยลงบัญชีรับเข้า)
    const wo = await service.createRequest({ productId: product.id, reason: 'WRITE_OFF', notes: 'ซ่อมไม่ได้' }, [], owner());
    const woResult = await service.approve(wo.id, owner());
    expect([woResult.inventoryBooked, woResult.productStatus]).toEqual([true, 'WRITTEN_OFF']);
    const [je] = await writeoffEntriesOf(wo.id);
    expect(je.lines.find((l) => l.accountCode === STOCK_WRITEOFF_LOSS_ACCOUNT)!.debit.toFixed(2)).toBe(cost.toFixed(2));
    expect((je.metadata as { reason?: string }).reason).toBe('WRITE_OFF');
  }, 120_000);

  it('3. FOUND → กลับรายการ JE เดิม · เครื่อง IN_STOCK · FOUND ซ้ำถูกปฏิเสธ', async () => {
    const { product, cost } = await receiveOne('FOUND1', 'PHONE_NEW');
    const lost = await service.createRequest({ productId: product.id, reason: 'LOST' }, [], owner());
    await service.approve(lost.id, owner());
    const lostJe = (await writeoffEntriesOf(lost.id))[0];

    const found = await service.createRequest({ productId: product.id, reason: 'FOUND' }, [], owner());
    expect(found.previousStatus).toBe('LOST');
    const result = await service.approve(found.id, owner());
    expect(result.productStatus).toBe('IN_STOCK');
    expect(result.journalEntryNo).toMatch(/^JE-/);

    const foundRow = await prisma.stockAdjustment.findUniqueOrThrow({ where: { id: found.id } });
    expect(foundRow.reversesAdjustmentId).toBe(lost.id);
    const reversal = await prisma.journalEntry.findUniqueOrThrow({ where: { id: foundRow.journalEntryId! }, include: { lines: true } });
    const byAcc = Object.fromEntries(reversal.lines.map((l) => [l.accountCode, [dec(l.debit).toFixed(2), dec(l.credit).toFixed(2)]]));
    expect(byAcc).toEqual({ 'S11-2001': [cost.toFixed(2), '0.00'], [STOCK_WRITEOFF_LOSS_ACCOUNT]: ['0.00', cost.toFixed(2)] });
    const original = await prisma.journalEntry.findUniqueOrThrow({ where: { id: lostJe.id } });
    expect((original.metadata as { reversed?: boolean; reversedByEntryNumber?: string }).reversed).toBe(true);
    expect((original.metadata as { reversedByEntryNumber?: string }).reversedByEntryNumber).toBe(reversal.entryNumber);
    expect(await netOf(STOCK_WRITEOFF_LOSS_ACCOUNT, [lostJe.id, reversal.id])).toBe('0.00');

    const back = await prisma.product.findUniqueOrThrow({ where: { id: product.id } });
    expect([back.status, back.deletedAt]).toEqual(['IN_STOCK', null]);
    expect(back.stockInDate).not.toBeNull();

    // เครื่องอยู่ในคลังแล้ว — "พบของคืน" อีกใบไม่มีความหมาย
    await expect(service.createRequest({ productId: product.id, reason: 'FOUND' }, [], owner())).rejects.toBeInstanceOf(BadRequestException);
  }, 120_000);

  it('4. เครื่องมือสองที่ยังรอถ่ายรูป (ไม่มี JE รับเข้า) → ตัดจำหน่ายโดยไม่มี JE + Todo แจ้งฝ่ายบัญชี (ข้อ 8)', async () => {
    const { product, receivingJeId } = await receiveOne('UNBOOKED1', 'PHONE_USED', 3000);
    expect(product.status).toBe('PHOTO_PENDING');
    expect(receivingJeId).toBeNull();

    const req = await service.createRequest({ productId: product.id, reason: 'WRITE_OFF' }, [], owner());
    const result = await service.approve(req.id, owner());
    expect([result.journalEntryNo, result.inventoryBooked, result.accountingNotified, result.productStatus]).toEqual([null, false, true, 'WRITTEN_OFF']);
    expect(await writeoffEntriesOf(req.id)).toHaveLength(0);
    const todo = await prisma.todo.findFirst({
      where: { tags: { hasEvery: [STOCK_ADJUSTMENT_UNBOOKED_TODO_TAG, adjustmentTodoKey(req.requestNumber!)] } },
    });
    expect(todo?.priority).toBe('MEDIUM');
    expect(todo?.description).toMatch(/ไม่เคยลงบัญชีสินค้าคงคลัง/);
    const row = await prisma.stockAdjustment.findUniqueOrThrow({ where: { id: req.id } });
    expect([row.inventoryBooked, row.journalEntryId, row.bookedSource]).toEqual([false, null, null]);
    expect(row.costAmount!.toFixed(2)).toBe('3210.00'); // 3,000 × 1.07
  }, 120_000);

  it('5. reject คืน IN_STOCK · cancel โดยผู้ขอคืน PHOTO_PENDING (สถานะเดิม ไม่ใช่ IN_STOCK)', async () => {
    const a = await receiveOne('REJ1', 'PHONE_NEW');
    const reqA = await service.createRequest({ productId: a.product.id, reason: 'LOST' }, [], salesOf(a.product.branchId));
    const rejected = await service.reject(reqA.id, { reason: 'เครื่องยังอยู่ ตรวจใหม่แล้ว' }, owner());
    expect([rejected.status, rejected.rejectedReason]).toEqual(['REJECTED', 'เครื่องยังอยู่ ตรวจใหม่แล้ว']);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: a.product.id } })).status).toBe('IN_STOCK');
    expect((await ownerTodo(reqA.requestNumber!))?.status).toBe('DONE');
    // ใบที่พิจารณาแล้ว ยกเลิก/อนุมัติซ้ำไม่ได้
    await expect(service.approve(reqA.id, owner())).rejects.toBeInstanceOf(ConflictException);

    const b = await receiveOne('CAN1', 'PHONE_USED', 2000);
    expect(b.product.status).toBe('PHOTO_PENDING');
    const reqB = await service.createRequest({ productId: b.product.id, reason: 'LOST' }, [], salesOf(b.product.branchId));
    expect((await prisma.product.findUniqueOrThrow({ where: { id: b.product.id } })).status).toBe('ADJUSTMENT_PENDING');
    // คนอื่นยกเลิกไม่ได้
    await expect(
      service.cancel(reqB.id, { id: 'not-the-requester', role: 'SALES', branchId: b.product.branchId }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    const canceled = await service.cancel(reqB.id, salesOf(b.product.branchId));
    expect(canceled.status).toBe('CANCELED');
    expect((await prisma.product.findUniqueOrThrow({ where: { id: b.product.id } })).status).toBe('PHOTO_PENDING');
  }, 120_000);

  it('6. สองคำขอพร้อมกันบนเครื่องเดียว (สองคอนเนกชัน) → สำเร็จใบเดียว อีกใบ 409 · เครื่องมีคำขอค้าง 1 ใบ', async () => {
    const { product } = await receiveOne('RACE1', 'PHONE_NEW');
    const results = await Promise.allSettled([
      service.createRequest({ productId: product.id, reason: 'LOST' }, [], owner()),
      service2.createRequest({ productId: product.id, reason: 'WRITE_OFF' }, [], owner()),
    ]);
    const ok = results.filter((r) => r.status === 'fulfilled');
    const failed = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(ok).toHaveLength(1);
    expect(failed).toHaveLength(1);
    expect(failed[0].reason).toBeInstanceOf(ConflictException);
    expect(await prisma.stockAdjustment.count({ where: { productId: product.id, status: 'PENDING_APPROVAL' } })).toBe(1);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: product.id } })).status).toBe('ADJUSTMENT_PENDING');
  }, 120_000);

  it('7. เครื่องที่รออนุมัติ มองไม่เห็นจาก POS/จอง (ด่านทุกทางกรอง IN_STOCK)', async () => {
    const { product } = await receiveOne('HOLD1', 'PHONE_NEW');
    await service.createRequest({ productId: product.id, reason: 'LOST' }, [], owner());
    expect(await prisma.product.findFirst({ where: { id: product.id, status: 'IN_STOCK', deletedAt: null } })).toBeNull();
    await expect(new StockReservationService(prisma as never).reserve(product.id)).rejects.toThrow(/IN_STOCK/);
    const live = await prisma.product.findUniqueOrThrow({ where: { id: product.id } });
    expect(() => assertSaleProductEligible(live, live.branchId, owner())).toThrow(/ไม่พร้อมขาย/);
  }, 120_000);

  it('8. ด่านรอบนอก: SALES ต่างสาขา 403 · PATCH สถานะตัดสินค้าถูกปฏิเสธ · ลบเครื่องที่ลงบัญชีแล้วถูกปฏิเสธ', async () => {
    const { product } = await receiveOne('GUARD1', 'PHONE_NEW');
    await expect(
      service.createRequest({ productId: product.id, reason: 'LOST' }, [], { id: salesId, role: 'SALES', branchId: 'another-branch' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(() => assertManualStatusChangeAllowed(product.status, 'LOST')).toThrow(/ตัดสินค้า/);
    await expect(productsService.update(product.id, { status: 'DAMAGED' } as never, adminId)).rejects.toThrow(/ตัดสินค้า/);
    await expect(productsService.remove(product.id)).rejects.toThrow(/ตัดสินค้า/);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: product.id } })).deletedAt).toBeNull();
  }, 120_000);
});
