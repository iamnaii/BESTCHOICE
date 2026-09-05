/**
 * wipe:stock-go-live — พิสูจน์บน DB จริง (spec 2026-09-05 §4 + §9)
 *
 * เคส:
 *   1. predicate `isTestProduct` ≡ where fragment `testProductWhere`/`realProductWhere` บน DB จริง
 *      (รวมกับดัก NULL ของ imei_serial / po_id)
 *   2. planWipe เลือกเฉพาะ "ของบนชั้น" ที่ไม่ใช่ทดสอบ · ข้ามเครื่องที่ถูกถือ (จองเว็บ) + เก็บ PO ของมัน ·
 *      สถานะผูกธุรกรรมรายงานแยก · เอกสารเคลื่อนไหวเลือกตาม marker
 *   3. applyWipe: deleted_at ค่าเดียวทั้งรอบ · ตารางลูกตามหัว · ของทดสอบ/ที่ถูกถือไม่ถูกแตะ · AuditLog ·
 *      รันซ้ำ = no-op · rollback SQL คืนทุกแถว — ทั้งหมดใน tx เดียวแล้ว ROLL BACK (DB dev แชร์กัน —
 *      ห้าม commit การล้างจริง)
 *
 * Fixture ตั้งด้วย prisma.create ตรง ๆ (สถานะเริ่มต้นของแถว ไม่ใช่การเปลี่ยนสถานะผ่าน flow)
 * เครื่องที่ "ถูกถือ" ใช้ ProductReservation ACTIVE (ชั้น 3 ของ assertProductNotHeld) — ตั้งง่ายกว่าสัญญา
 *
 * Runner: vitest (jest ignore `*.integration.spec.ts`). ต้องมี DB จริง:
 *   cd apps/api && npx vitest run --no-file-parallelism \
 *     src/cli/stock-go-live/__tests__/wipe-stock-go-live.integration.spec.ts
 * CI: glob `STOCK_GO_LIVE_FILES` ใน `.github/workflows/deploy-gcp.yml`
 *
 * Cleanup: sweep ตาม prefix `SGL-` ทั้งก่อนและหลัง (ซากรันที่ crash) — audit_logs immutable ปล่อยไว้
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Prisma, PrismaClient } from '@prisma/client';
import {
  applyWipe,
  planWipe,
  rollbackSql,
  STOCK_GO_LIVE_AUDIT_ACTION,
} from '../wipe-stock-go-live';
import {
  isTestProduct,
  realProductWhere,
  testProductWhere,
  TEST_ALERT_MODEL,
  TEST_NOTE_MARKER,
  TEST_STOCK_COUNT_PREFIX,
} from '../../../utils/test-data-markers';

const prisma = new PrismaClient();
const PREFIX = 'SGL-';
const RUN = Date.now().toString(36).toUpperCase();
const tag = (s: string) => `${PREFIX}${RUN}-${s}`;
const dec = (s: string) => new Prisma.Decimal(s);

class Rollback extends Error {}

let adminId: string;
let shopCompanyId: string;
let branchId: string;

type P = { id: string };
let supplierReal: P, supplierTest: P, po1: P, po2: P, poTest: P, gr1: P, gr2: P;
let A: P, B: P, C: P, D: P, E: P, F: P, G: P, H: P;
let transferReal: P, transferTest: P, brReal: P, countReal: P, countTest: P;
let adjReal: P, adjTest: P, alertReal: P, alertTest: P;

async function product(data: Partial<Prisma.ProductUncheckedCreateInput> & { name: string }) {
  return prisma.product.create({
    data: {
      brand: 'SGL',
      model: tag('MODEL'),
      category: 'PHONE_NEW',
      costPrice: dec('1000.00'),
      branchId,
      status: 'IN_STOCK',
      ownedByCompanyId: shopCompanyId,
      stockInDate: new Date(),
      ...data,
    } as Prisma.ProductUncheckedCreateInput,
    select: { id: true },
  });
}

/** ล้างซาก SGL- ทุกรัน (RUN-independent) — ลำดับตาม FK */
async function sweep() {
  const products = await prisma.product.findMany({
    where: {
      OR: [
        { imeiSerial: { startsWith: PREFIX } },
        { imeiSerial: { startsWith: `TEST-${PREFIX}` } },
        { name: { startsWith: 'SGL ' } },
        { name: { startsWith: `ทดสอบระบบ ${PREFIX}` } },
        { legacyProductCode: { startsWith: `TTFY-${PREFIX}` } },
      ],
    },
    select: { id: true },
  });
  const pids = products.map((p) => p.id);
  await prisma.productReservation.deleteMany({ where: { productId: { in: pids } } });
  await prisma.stockCountItem.deleteMany({ where: { productId: { in: pids } } });
  await prisma.stockCount.deleteMany({
    where: {
      OR: [
        { countNumber: { startsWith: PREFIX } },
        { countNumber: { startsWith: `${TEST_STOCK_COUNT_PREFIX}${PREFIX}` } },
      ],
    },
  });
  await prisma.stockAdjustment.deleteMany({ where: { productId: { in: pids } } });
  await prisma.branchReceivingItem.deleteMany({ where: { productId: { in: pids } } });
  const transfers = await prisma.stockTransfer.findMany({
    where: { productId: { in: pids } },
    select: { id: true },
  });
  await prisma.branchReceiving.deleteMany({
    where: { transferId: { in: transfers.map((t) => t.id) } },
  });
  await prisma.stockTransfer.deleteMany({ where: { productId: { in: pids } } });
  await prisma.stockAlert.deleteMany({ where: { brand: 'SGL' } });
  await prisma.reorderPoint.deleteMany({ where: { brand: 'SGL' } });
  await prisma.product.deleteMany({ where: { id: { in: pids } } });
  const pos = await prisma.purchaseOrder.findMany({
    where: {
      OR: [{ poNumber: { startsWith: PREFIX } }, { poNumber: { startsWith: `TEST-PO-${PREFIX}` } }],
    },
    select: { id: true },
  });
  const poIds = pos.map((p) => p.id);
  await prisma.goodsReceivingItem.deleteMany({ where: { receiving: { poId: { in: poIds } } } });
  await prisma.goodsReceiving.deleteMany({ where: { poId: { in: poIds } } });
  await prisma.pOItem.deleteMany({ where: { poId: { in: poIds } } });
  await prisma.purchaseOrder.deleteMany({ where: { id: { in: poIds } } });
  await prisma.supplier.deleteMany({
    where: {
      OR: [{ name: { startsWith: PREFIX } }, { name: { startsWith: `ทดสอบระบบ ${PREFIX}` } }],
    },
  });
}

describe('wipe:stock-go-live — flow จริงบน DB จริง', () => {
  beforeAll(async () => {
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

    const branchName = '__stockgolive_branch__';
    const existing = await prisma.branch.findFirst({
      where: { name: branchName, deletedAt: null },
    });
    branchId = existing
      ? existing.id
      : (
          await prisma.branch.create({
            data: { name: branchName, companyId: shopCompanyId, shopCashAccountCode: 'S11-1101' },
          })
        ).id;

    await sweep();

    supplierReal = await prisma.supplier.create({
      data: { name: tag('Supplier'), phone: '0200000000' },
      select: { id: true },
    });
    supplierTest = await prisma.supplier.create({
      data: { name: `ทดสอบระบบ ${tag('Supplier')}`, phone: '0200000001' },
      select: { id: true },
    });
    const po = (poNumber: string, supplierId: string) =>
      prisma.purchaseOrder.create({
        data: {
          poNumber,
          supplierId,
          orderDate: new Date(),
          totalAmount: dec('2000.00'),
          createdById: adminId,
          items: { create: [{ quantity: 2, unitPrice: dec('1000.00') }] },
        },
        select: { id: true },
      });
    po1 = await po(tag('PO1'), supplierReal.id);
    po2 = await po(tag('PO2'), supplierReal.id);
    poTest = await po(`TEST-PO-${tag('X')}`, supplierTest.id);
    gr1 = await prisma.goodsReceiving.create({
      data: { grNumber: tag('GR1'), poId: po1.id, receivedById: adminId },
      select: { id: true },
    });
    gr2 = await prisma.goodsReceiving.create({
      data: { grNumber: tag('GR2'), poId: po2.id, receivedById: adminId },
      select: { id: true },
    });

    A = await product({
      name: 'SGL TTFY A',
      imeiSerial: tag('A'),
      legacyProductCode: `TTFY-${tag('A')}`,
      poId: po1.id,
    });
    B = await product({
      name: 'SGL Plain B',
      imeiSerial: tag('B'),
      category: 'PHONE_USED',
      status: 'PHOTO_PENDING',
    });
    C = await product({
      name: 'SGL Test C',
      imeiSerial: `TEST-${tag('C')}`,
      isOnlineVisible: true,
    });
    D = await product({ name: `ทดสอบระบบ ${tag('D')}`, imeiSerial: tag('D') });
    E = await product({
      name: 'SGL Cable E',
      imeiSerial: null,
      category: 'ACCESSORY',
      poId: poTest.id,
    });
    F = await product({ name: 'SGL Held F', imeiSerial: tag('F'), poId: po2.id });
    await prisma.productReservation.create({
      data: {
        productId: F.id,
        sessionId: tag('SESSION'),
        status: 'ACTIVE',
        expiresAt: new Date(Date.now() + 3_600_000),
      },
    });
    G = await product({ name: 'SGL Sold G', imeiSerial: tag('G'), status: 'SOLD_CASH' });
    H = await product({
      name: 'SGL Case H',
      imeiSerial: null,
      category: 'ACCESSORY',
      poId: po1.id,
    });

    transferReal = await prisma.stockTransfer.create({
      data: {
        productId: A.id,
        fromBranchId: branchId,
        toBranchId: branchId,
        transferredBy: adminId,
      },
      select: { id: true },
    });
    transferTest = await prisma.stockTransfer.create({
      data: {
        productId: C.id,
        fromBranchId: branchId,
        toBranchId: branchId,
        transferredBy: adminId,
        notes: `${TEST_NOTE_MARKER} โอนทดสอบ`,
      },
      select: { id: true },
    });
    brReal = await prisma.branchReceiving.create({
      data: {
        transferId: transferReal.id,
        receivedById: adminId,
        items: { create: [{ productId: A.id, status: 'PASS' }] },
      },
      select: { id: true },
    });
    countReal = await prisma.stockCount.create({
      data: {
        countNumber: tag('COUNT'),
        branchId,
        countedById: adminId,
        items: { create: [{ productId: A.id, expectedStatus: 'IN_STOCK' }] },
      },
      select: { id: true },
    });
    countTest = await prisma.stockCount.create({
      data: {
        countNumber: `${TEST_STOCK_COUNT_PREFIX}${tag('X')}`,
        branchId,
        countedById: adminId,
      },
      select: { id: true },
    });
    adjReal = await prisma.stockAdjustment.create({
      data: {
        productId: A.id,
        branchId,
        reason: 'CORRECTION',
        previousStatus: 'IN_STOCK',
        adjustedById: adminId,
        approvedById: adminId,
      },
      select: { id: true },
    });
    adjTest = await prisma.stockAdjustment.create({
      data: {
        productId: C.id,
        branchId,
        reason: 'CORRECTION',
        previousStatus: 'IN_STOCK',
        adjustedById: adminId,
        approvedById: adminId,
        notes: `${TEST_NOTE_MARKER} ปรับทดสอบ`,
      },
      select: { id: true },
    });
    const rp = await prisma.reorderPoint.create({
      data: {
        brand: 'SGL',
        model: tag('RP'),
        category: 'PHONE_NEW',
        branchId,
        minQuantity: 1,
        reorderQuantity: 1,
      },
      select: { id: true },
    });
    const alert = (model: string) =>
      prisma.stockAlert.create({
        data: {
          reorderPointId: rp.id,
          brand: 'SGL',
          model,
          category: 'PHONE_NEW',
          branchId,
          currentStock: 0,
          minQuantity: 1,
          reorderQuantity: 1,
        },
        select: { id: true },
      });
    alertReal = await alert(tag('ALERT'));
    alertTest = await alert(TEST_ALERT_MODEL);
  }, 120_000);

  afterAll(async () => {
    await sweep();
    await prisma.$disconnect();
  });

  it('1. predicate isTestProduct ≡ where fragment บน DB จริง (รวมเคส imei/po เป็น NULL)', async () => {
    const ids = [A, B, C, D, E, F, G, H].map((p) => p.id);
    const rows = await prisma.product.findMany({
      where: { id: { in: ids } },
      select: { id: true, imeiSerial: true, name: true, po: { select: { poNumber: true } } },
    });
    const viaPredicate = rows
      .filter(isTestProduct)
      .map((r) => r.id)
      .sort();
    const viaTestWhere = (
      await prisma.product.findMany({
        where: { id: { in: ids }, AND: [testProductWhere] },
        select: { id: true },
      })
    )
      .map((r) => r.id)
      .sort();
    const viaRealWhere = (
      await prisma.product.findMany({
        where: { id: { in: ids }, AND: [realProductWhere] },
        select: { id: true },
      })
    )
      .map((r) => r.id)
      .sort();

    expect(viaPredicate).toEqual([C.id, D.id, E.id].sort());
    expect(viaTestWhere).toEqual(viaPredicate);
    expect(viaRealWhere).toEqual([A.id, B.id, F.id, G.id, H.id].sort());
    expect(viaTestWhere.length + viaRealWhere.length).toBe(ids.length); // ไม่มีแถวหลุดสองฝั่ง
  });

  it('2. planWipe — ของบนชั้นที่ไม่ใช่ทดสอบ / ข้ามที่ถูกถือ + เก็บ PO / ผูกธุรกรรมรายงานแยก / เอกสารตาม marker', async () => {
    const plan = await planWipe(prisma, new Date(), { branchId });

    expect(plan.products.map((p) => p.id).sort()).toEqual([A.id, B.id, H.id].sort());
    expect(plan.skipped.map((s) => s.id)).toEqual([F.id]);
    expect(plan.skipped[0].reason).toContain('จอง');
    expect(plan.bound.map((b) => b.id)).toEqual([G.id]);

    expect(plan.purchaseOrderIds).toContain(po1.id);
    expect(plan.purchaseOrderIds).not.toContain(po2.id);
    expect(plan.purchaseOrderIds).not.toContain(poTest.id);
    expect(plan.keptPurchaseOrders.map((k) => k.id)).toContain(po2.id);
    expect(plan.goodsReceivingIds).toContain(gr1.id);
    expect(plan.goodsReceivingIds).not.toContain(gr2.id);

    expect(plan.stockTransferIds).toEqual([transferReal.id]);
    expect(plan.branchReceivingIds).toEqual([brReal.id]);
    expect(plan.stockCountIds).toEqual([countReal.id]);
    expect(plan.stockAdjustmentIds).toEqual([adjReal.id]);
    expect(plan.stockAlertIds).toEqual([alertReal.id]);

    expect(plan.testProductsRemaining).toBe(3);
    expect(plan.testProductsOnlineVisible.map((p) => p.id)).toContain(C.id);
    expect(plan.glInventory.map((g) => g.code)).toEqual(['S11-2001', 'S11-2002', 'S11-2003']);
    expect(plan.tradeInProductCount).toBe(0);
  });

  it('3. applyWipe — timestamp เดียว · ตารางลูกตามหัว · ของทดสอบ/ที่ถูกถือรอด · audit · รันซ้ำ no-op · rollback คืนครบ', async () => {
    const wipedAt = new Date();
    const allProductIds = [A, B, C, D, E, F, G, H].map((p) => p.id);

    await expect(
      prisma.$transaction(
        async (tx) => {
          const plan = await planWipe(tx, wipedAt, { branchId });
          const counts = await applyWipe(tx, plan, adminId);
          expect(counts.products).toBe(3);
          expect(counts.stock_transfers).toBe(1);
          expect(counts.branch_receivings).toBe(1);
          expect(counts.branch_receiving_items).toBe(1);
          expect(counts.stock_counts).toBe(1);
          expect(counts.stock_count_items).toBe(1);
          expect(counts.stock_adjustments).toBe(1);
          expect(counts.stock_alerts).toBe(1);
          expect(counts.purchase_orders).toBeGreaterThanOrEqual(1);
          expect(counts.po_items).toBeGreaterThanOrEqual(1);
          expect(counts.goods_receivings).toBeGreaterThanOrEqual(1);

          const at = async (
            table:
              | 'product'
              | 'purchaseOrder'
              | 'goodsReceiving'
              | 'stockTransfer'
              | 'branchReceiving'
              | 'stockCount'
              | 'stockAdjustment'
              | 'stockAlert',
            id: string,
          ) => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const row = await (tx as any)[table].findUniqueOrThrow({
              where: { id },
              select: { deletedAt: true },
            });
            return (row.deletedAt as Date | null)?.getTime() ?? null;
          };
          for (const id of [A.id, B.id, H.id])
            expect(await at('product', id)).toBe(wipedAt.getTime());
          for (const id of [C.id, D.id, E.id, F.id, G.id])
            expect(await at('product', id)).toBeNull();
          expect(await at('purchaseOrder', po1.id)).toBe(wipedAt.getTime());
          expect(await at('purchaseOrder', po2.id)).toBeNull();
          expect(await at('purchaseOrder', poTest.id)).toBeNull();
          expect(await at('goodsReceiving', gr1.id)).toBe(wipedAt.getTime());
          expect(await at('goodsReceiving', gr2.id)).toBeNull();
          expect(await at('stockTransfer', transferReal.id)).toBe(wipedAt.getTime());
          expect(await at('stockTransfer', transferTest.id)).toBeNull();
          expect(await at('branchReceiving', brReal.id)).toBe(wipedAt.getTime());
          expect(await at('stockCount', countReal.id)).toBe(wipedAt.getTime());
          expect(await at('stockCount', countTest.id)).toBeNull();
          expect(await at('stockAdjustment', adjReal.id)).toBe(wipedAt.getTime());
          expect(await at('stockAdjustment', adjTest.id)).toBeNull();
          expect(await at('stockAlert', alertReal.id)).toBe(wipedAt.getTime());
          expect(await at('stockAlert', alertTest.id)).toBeNull();

          const poItems = await tx.pOItem.findMany({
            where: { poId: po1.id },
            select: { deletedAt: true },
          });
          expect(poItems.every((i) => i.deletedAt?.getTime() === wipedAt.getTime())).toBe(true);
          const countItems = await tx.stockCountItem.findMany({
            where: { stockCountId: countReal.id },
            select: { deletedAt: true },
          });
          expect(countItems.every((i) => i.deletedAt?.getTime() === wipedAt.getTime())).toBe(true);
          const brItems = await tx.branchReceivingItem.findMany({
            where: { receivingId: brReal.id },
            select: { deletedAt: true },
          });
          expect(brItems.every((i) => i.deletedAt?.getTime() === wipedAt.getTime())).toBe(true);

          const audit = await tx.auditLog.findFirst({
            where: { action: STOCK_GO_LIVE_AUDIT_ACTION, entityId: wipedAt.toISOString() },
          });
          expect(audit).toBeTruthy();
          expect(audit!.userId).toBe(adminId);
          const nv = audit!.newValue as {
            counts: Record<string, number>;
            skipped: { id: string }[];
          };
          expect(nv.counts.products).toBe(3);
          expect(nv.skipped.map((s) => s.id)).toEqual([F.id]);

          // รันซ้ำ = no-op (เป้าหมายหมดแล้ว; PO2 ยังถูกเก็บเพราะ F ยังถูกถือ)
          const again = await planWipe(tx, new Date(), { branchId });
          expect(again.products).toEqual([]);
          expect(again.stockTransferIds).toEqual([]);
          expect(again.stockCountIds).toEqual([]);
          expect(again.purchaseOrderIds).not.toContain(po1.id);
          expect(again.keptPurchaseOrders.map((k) => k.id)).toContain(po2.id);

          // rollback SQL คืนทุกแถว
          for (const sql of rollbackSql(wipedAt)) await tx.$executeRawUnsafe(sql);
          for (const id of allProductIds) expect(await at('product', id)).toBeNull();
          expect(await at('purchaseOrder', po1.id)).toBeNull();
          expect(await at('goodsReceiving', gr1.id)).toBeNull();
          expect(await at('stockTransfer', transferReal.id)).toBeNull();
          expect(await at('branchReceiving', brReal.id)).toBeNull();
          expect(await at('stockCount', countReal.id)).toBeNull();
          expect(await at('stockAdjustment', adjReal.id)).toBeNull();
          expect(await at('stockAlert', alertReal.id)).toBeNull();
          const poItemsBack = await tx.pOItem.findMany({
            where: { poId: po1.id },
            select: { deletedAt: true },
          });
          expect(poItemsBack.every((i) => i.deletedAt === null)).toBe(true);

          throw new Rollback();
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          timeout: 120_000,
          maxWait: 10_000,
        },
      ),
    ).rejects.toBeInstanceOf(Rollback);

    // นอก tx: ไม่มีอะไร commit
    const after = await prisma.product.findMany({
      where: { id: { in: allProductIds } },
      select: { deletedAt: true },
    });
    expect(after.every((p) => p.deletedAt === null)).toBe(true);
  }, 120_000);
});
