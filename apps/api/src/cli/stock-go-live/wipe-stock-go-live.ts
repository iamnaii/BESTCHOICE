/**
 * ล้างคลังก่อนเริ่มใช้จริง — spec docs/superpowers/specs/2026-09-05-stock-go-live-design.md §4
 *
 * แยก "อ่าน" (planWipe) กับ "เขียน" (applyWipe) ให้ CLI (wipe-stock-go-live.cli.ts) เรียกทั้งคู่
 * ใน Serializable tx เดียว — plan คำนวณ **ใน** tx เพื่อกันใบขายที่ commit ระหว่าง plan กับ apply.
 * ไฟล์นี้ไม่แตะ process.env / console — ให้ integration spec เรียกตรง ๆ ได้
 *
 * กติกา (spec §4.2-4.4):
 *   - สินค้า: ล้างเฉพาะ "ของบนชั้น" (ON_SHELF_STATUSES) ที่ไม่ใช่ทดสอบ และผ่านด่าน
 *     `assertProductNotHeld(..., 'DELETE')` — ติดด่าน = ข้าม+รายงาน ไม่ลบ
 *   - สถานะผูกธุรกรรม (TRANSACTION_BOUND_STATUSES) ไม่แตะ รายงานแยก
 *   - PO ที่ยังมีเครื่องที่ไม่ถูกล้างชี้อยู่ → เก็บ+รายงาน (ไม่ปล่อยให้เครื่องชี้ PO ที่ถูกลบ)
 *   - ทุกแถว soft-delete ด้วย `wipedAt` ค่าเดียว ⇒ rollback = UPDATE ... WHERE deleted_at = wipedAt
 *   - ไม่แตะ suppliers / reorder_points / inspections / imported_sales / trade_ins / GL
 */
import { BadRequestException } from '@nestjs/common';
import { Prisma, ProductStatus } from '@prisma/client';
import { assertProductNotHeld } from '../../modules/products/product-hold.util';
import {
  realNoteWhere,
  realProductWhere,
  realPurchaseOrderWhere,
  testProductWhere,
  TEST_ALERT_MODEL,
  TEST_STOCK_COUNT_PREFIX,
} from '../../utils/test-data-markers';

export const STOCK_GO_LIVE_AUDIT_ACTION = 'STOCK_GO_LIVE_WIPE';
export const INVENTORY_GL_ACCOUNTS = ['S11-2001', 'S11-2002', 'S11-2003'] as const;

type StatusClass = 'SHELF' | 'BOUND';
/**
 * `satisfies Record<ProductStatus, ...>` — สถานะใหม่ใน enum จะ compile ไม่ผ่านจนกว่าจะตัดสินว่า
 * อยู่บนชั้น (ล้างได้) หรือผูกธุรกรรม (ไม่แตะ) — pattern เดียวกับ FOUND_POLICY
 */
export const STATUS_CLASS = {
  PO_RECEIVED: 'SHELF',
  QC_PENDING: 'SHELF',
  PHOTO_PENDING: 'SHELF',
  INSPECTION: 'SHELF',
  IN_STOCK: 'SHELF',
  REFURBISHED: 'SHELF',
  DAMAGED: 'SHELF',
  DEFECT_RETURN: 'SHELF',
  LOST: 'SHELF',
  WRITTEN_OFF: 'SHELF',
  RESERVED: 'BOUND',
  SOLD_INSTALLMENT: 'BOUND',
  SOLD_CASH: 'BOUND',
  SOLD_RESELL: 'BOUND',
  REPOSSESSED: 'BOUND',
} satisfies Record<ProductStatus, StatusClass>;

const statusesOf = (cls: StatusClass): ProductStatus[] =>
  (Object.keys(STATUS_CLASS) as ProductStatus[]).filter((s) => STATUS_CLASS[s] === cls);
export const ON_SHELF_STATUSES: ProductStatus[] = statusesOf('SHELF');
export const TRANSACTION_BOUND_STATUSES: ProductStatus[] = statusesOf('BOUND');

/** ตารางที่ถูก soft-delete ด้วย timestamp เดียว — ลำดับนี้ = ลำดับ rollback SQL */
export const WIPED_TABLES = [
  'products',
  'purchase_orders',
  'po_items',
  'goods_receivings',
  'goods_receiving_items',
  'stock_transfers',
  'branch_receivings',
  'branch_receiving_items',
  'stock_counts',
  'stock_count_items',
  'stock_adjustments',
  'stock_alerts',
] as const;
export type WipedTable = (typeof WIPED_TABLES)[number];
export type WipeCounts = Record<WipedTable, number>;

export type WipeClient = Prisma.TransactionClient;

export interface PlanProduct {
  id: string;
  imeiSerial: string | null;
  name: string;
  status: ProductStatus;
  category: string;
  branchName: string;
  /** 2dp string — ห้ามแปลงเป็น number นอกจากตอนพิมพ์ */
  costPrice: string;
  poId: string | null;
}
export interface SkippedProduct extends PlanProduct {
  reason: string;
}
export interface KeptPurchaseOrder {
  id: string;
  poNumber: string;
  reason: string;
}
export interface WipePlan {
  wipedAt: Date;
  branchId: string | null;
  products: PlanProduct[];
  skipped: SkippedProduct[];
  bound: PlanProduct[];
  purchaseOrderIds: string[];
  purchaseOrderNumbers: string[];
  keptPurchaseOrders: KeptPurchaseOrder[];
  goodsReceivingIds: string[];
  stockTransferIds: string[];
  branchReceivingIds: string[];
  stockCountIds: string[];
  stockAdjustmentIds: string[];
  stockAlertIds: string[];
  testProductsRemaining: number;
  testProductsOnlineVisible: { id: string; name: string; imeiSerial: string | null }[];
  tradeInProductCount: number;
  glInventory: { code: string; balance: string }[];
}
export interface WipeOptions {
  /** ล้างเฉพาะสาขา (สินค้า/โอน/นับ/ปรับ/แจ้งเตือน) — PO/ใบรับของไม่มีสาขา จึงเป็นทั้ง DB เสมอ */
  branchId?: string;
}

const PRODUCT_SELECT = {
  id: true,
  imeiSerial: true,
  name: true,
  status: true,
  category: true,
  costPrice: true,
  poId: true,
  deletedAt: true,
  branch: { select: { name: true } },
} satisfies Prisma.ProductSelect;
type ProductRow = Prisma.ProductGetPayload<{ select: typeof PRODUCT_SELECT }>;

const toPlanProduct = (p: ProductRow): PlanProduct => ({
  id: p.id,
  imeiSerial: p.imeiSerial,
  name: p.name,
  status: p.status,
  category: p.category,
  branchName: p.branch.name,
  costPrice: p.costPrice.toFixed(2),
  poId: p.poId,
});

export async function planWipe(
  tx: WipeClient,
  wipedAt: Date,
  opts: WipeOptions = {},
): Promise<WipePlan> {
  const branchScope = opts.branchId ? { branchId: opts.branchId } : {};

  // ── สินค้าบนชั้น (ผ่านด่านถือครองทีละเครื่อง) ─────────────────────────────
  const shelfRows = await tx.product.findMany({
    where: {
      deletedAt: null,
      status: { in: ON_SHELF_STATUSES },
      ...branchScope,
      AND: [realProductWhere],
    },
    select: PRODUCT_SELECT,
    orderBy: { createdAt: 'asc' },
  });
  const products: PlanProduct[] = [];
  const skipped: SkippedProduct[] = [];
  for (const row of shelfRows) {
    try {
      await assertProductNotHeld(
        tx,
        { id: row.id, status: row.status, deletedAt: row.deletedAt },
        'DELETE',
      );
      products.push(toPlanProduct(row));
    } catch (err) {
      if (!(err instanceof BadRequestException)) throw err;
      skipped.push({ ...toPlanProduct(row), reason: err.message });
    }
  }

  const boundRows = await tx.product.findMany({
    where: {
      deletedAt: null,
      status: { in: TRANSACTION_BOUND_STATUSES },
      ...branchScope,
      AND: [realProductWhere],
    },
    select: PRODUCT_SELECT,
    orderBy: { createdAt: 'asc' },
  });
  const bound = boundRows.map(toPlanProduct);

  // ── PO: เก็บทุกใบที่ยังมีเครื่อง live ที่ไม่ถูกล้างชี้อยู่ (ทั้ง DB ไม่ใช่เฉพาะสาขา) ──
  const wipeIds = products.map((p) => p.id);
  const survivorPoRows = await tx.product.findMany({
    where: { deletedAt: null, poId: { not: null }, id: { notIn: wipeIds } },
    select: { poId: true },
    distinct: ['poId'],
  });
  const survivorPoIds = new Set(survivorPoRows.map((r) => r.poId as string));
  const poRows = await tx.purchaseOrder.findMany({
    where: { deletedAt: null, ...realPurchaseOrderWhere },
    select: { id: true, poNumber: true },
    orderBy: { createdAt: 'asc' },
  });
  const purchaseOrderIds: string[] = [];
  const purchaseOrderNumbers: string[] = [];
  const keptPurchaseOrders: KeptPurchaseOrder[] = [];
  for (const po of poRows) {
    if (survivorPoIds.has(po.id)) {
      keptPurchaseOrders.push({
        id: po.id,
        poNumber: po.poNumber,
        reason: 'ยังมีเครื่องที่ไม่ถูกล้าง (ถูกถือ/ผูกธุรกรรม/ทดสอบ) ชี้มาที่ PO นี้',
      });
    } else {
      purchaseOrderIds.push(po.id);
      purchaseOrderNumbers.push(po.poNumber);
    }
  }
  const goodsReceivingIds = (
    await tx.goodsReceiving.findMany({
      where: { deletedAt: null, poId: { in: purchaseOrderIds } },
      select: { id: true },
    })
  ).map((r) => r.id);

  // ── เอกสารเคลื่อนไหว (ตาม marker) ────────────────────────────────────────
  const transferScope: Prisma.StockTransferWhereInput[] = opts.branchId
    ? [{ OR: [{ fromBranchId: opts.branchId }, { toBranchId: opts.branchId }] }]
    : [];
  const stockTransferIds = (
    await tx.stockTransfer.findMany({
      where: { deletedAt: null, AND: [realNoteWhere, ...transferScope] },
      select: { id: true },
    })
  ).map((r) => r.id);
  const branchReceivingIds = (
    await tx.branchReceiving.findMany({
      where: { deletedAt: null, transferId: { in: stockTransferIds } },
      select: { id: true },
    })
  ).map((r) => r.id);
  const stockCountIds = (
    await tx.stockCount.findMany({
      where: {
        deletedAt: null,
        ...branchScope,
        NOT: { countNumber: { startsWith: TEST_STOCK_COUNT_PREFIX } },
      },
      select: { id: true },
    })
  ).map((r) => r.id);
  const stockAdjustmentIds = (
    await tx.stockAdjustment.findMany({
      where: { deletedAt: null, ...branchScope, AND: [realNoteWhere] },
      select: { id: true },
    })
  ).map((r) => r.id);
  const stockAlertIds = (
    await tx.stockAlert.findMany({
      where: { deletedAt: null, ...branchScope, NOT: { model: TEST_ALERT_MODEL } },
      select: { id: true },
    })
  ).map((r) => r.id);

  // ── ข้อมูลประกอบสำหรับ dry-run ──────────────────────────────────────────
  const testProductsRemaining = await tx.product.count({
    where: { deletedAt: null, ...branchScope, AND: [testProductWhere] },
  });
  const testProductsOnlineVisible = await tx.product.findMany({
    where: { deletedAt: null, isOnlineVisible: true, ...branchScope, AND: [testProductWhere] },
    select: { id: true, name: true, imeiSerial: true },
  });
  const tradeInProductCount = await tx.tradeIn.count({
    where: { deletedAt: null, productId: { in: wipeIds } },
  });
  const glRows = await tx.$queryRaw<{ code: string; balance: string }[]>`
    SELECT coa.code AS code,
           COALESCE(SUM(CASE WHEN je.status = 'POSTED' AND je.deleted_at IS NULL
                             THEN jl.debit - jl.credit ELSE 0 END), 0)::text AS balance
    FROM chart_of_accounts coa
    LEFT JOIN journal_lines jl ON jl.account_code = coa.code AND jl.deleted_at IS NULL
    LEFT JOIN journal_entries je ON je.id = jl.journal_entry_id
    WHERE coa.code IN (${Prisma.join([...INVENTORY_GL_ACCOUNTS])})
    GROUP BY coa.code
    ORDER BY coa.code`;
  const glMap = new Map(glRows.map((r) => [r.code, r.balance]));
  const glInventory = INVENTORY_GL_ACCOUNTS.map((code) => ({
    code,
    balance: glMap.get(code) ?? '0',
  }));

  return {
    wipedAt,
    branchId: opts.branchId ?? null,
    products,
    skipped,
    bound,
    purchaseOrderIds,
    purchaseOrderNumbers,
    keptPurchaseOrders,
    goodsReceivingIds,
    stockTransferIds,
    branchReceivingIds,
    stockCountIds,
    stockAdjustmentIds,
    stockAlertIds,
    testProductsRemaining,
    testProductsOnlineVisible,
    tradeInProductCount,
    glInventory,
  };
}

export async function applyWipe(
  tx: WipeClient,
  plan: WipePlan,
  actorUserId: string,
): Promise<WipeCounts> {
  const at = plan.wipedAt;
  const soft = { deletedAt: at };
  const productIds = plan.products.map((p) => p.id);

  const counts: WipeCounts = {
    products: (
      await tx.product.updateMany({
        where: { id: { in: productIds }, deletedAt: null },
        data: soft,
      })
    ).count,
    purchase_orders: (
      await tx.purchaseOrder.updateMany({
        where: { id: { in: plan.purchaseOrderIds }, deletedAt: null },
        data: soft,
      })
    ).count,
    po_items: (
      await tx.pOItem.updateMany({
        where: { poId: { in: plan.purchaseOrderIds }, deletedAt: null },
        data: soft,
      })
    ).count,
    goods_receivings: (
      await tx.goodsReceiving.updateMany({
        where: { id: { in: plan.goodsReceivingIds }, deletedAt: null },
        data: soft,
      })
    ).count,
    goods_receiving_items: (
      await tx.goodsReceivingItem.updateMany({
        where: { receivingId: { in: plan.goodsReceivingIds }, deletedAt: null },
        data: soft,
      })
    ).count,
    stock_transfers: (
      await tx.stockTransfer.updateMany({
        where: { id: { in: plan.stockTransferIds }, deletedAt: null },
        data: soft,
      })
    ).count,
    branch_receivings: (
      await tx.branchReceiving.updateMany({
        where: { id: { in: plan.branchReceivingIds }, deletedAt: null },
        data: soft,
      })
    ).count,
    branch_receiving_items: (
      await tx.branchReceivingItem.updateMany({
        where: { receivingId: { in: plan.branchReceivingIds }, deletedAt: null },
        data: soft,
      })
    ).count,
    stock_counts: (
      await tx.stockCount.updateMany({
        where: { id: { in: plan.stockCountIds }, deletedAt: null },
        data: soft,
      })
    ).count,
    stock_count_items: (
      await tx.stockCountItem.updateMany({
        where: { stockCountId: { in: plan.stockCountIds }, deletedAt: null },
        data: soft,
      })
    ).count,
    stock_adjustments: (
      await tx.stockAdjustment.updateMany({
        where: { id: { in: plan.stockAdjustmentIds }, deletedAt: null },
        data: soft,
      })
    ).count,
    stock_alerts: (
      await tx.stockAlert.updateMany({
        where: { id: { in: plan.stockAlertIds }, deletedAt: null },
        data: soft,
      })
    ).count,
  };

  // ใน tx เดียวกัน (atomic) — แลกกับไม่มี rowHash ตามกติกา database.md "AuditLog — ใน tx"
  await tx.auditLog.create({
    data: {
      userId: actorUserId,
      action: STOCK_GO_LIVE_AUDIT_ACTION,
      entity: 'product',
      entityId: at.toISOString(),
      newValue: {
        wipedAt: at.toISOString(),
        branchId: plan.branchId,
        counts,
        skipped: plan.skipped.map((s) => ({
          id: s.id,
          imeiSerial: s.imeiSerial,
          name: s.name,
          status: s.status,
          reason: s.reason,
        })),
        bound: plan.bound.map((b) => ({
          id: b.id,
          imeiSerial: b.imeiSerial,
          name: b.name,
          status: b.status,
        })),
        // map เป็น object literal เหมือน skipped/bound — `KeptPurchaseOrder` เป็น interface
        // (ไม่มี implicit index signature) จึง cast เป็น InputJsonValue ตรง ๆ ไม่ผ่าน (TS2352)
        keptPurchaseOrders: plan.keptPurchaseOrders.map((k) => ({
          id: k.id,
          poNumber: k.poNumber,
          reason: k.reason,
        })),
        wipedPurchaseOrders: plan.purchaseOrderNumbers,
      } as Prisma.InputJsonValue,
    },
  });

  return counts;
}

/** SQL ย้อนกลับ — หนึ่งบรรทัดต่อตาราง; Postgres เทียบ timestamp(3) กับ ISO string ตรง ๆ ได้ */
export function rollbackSql(wipedAt: Date): string[] {
  const ts = wipedAt.toISOString();
  return WIPED_TABLES.map((t) => `UPDATE "${t}" SET deleted_at = NULL WHERE deleted_at = '${ts}';`);
}

const groupCount = <T>(rows: T[], key: (r: T) => string): [string, number][] => {
  const m = new Map<string, number>();
  for (const r of rows) m.set(key(r), (m.get(key(r)) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
};

export function formatPlan(
  plan: WipePlan,
  mode: 'DRY-RUN' | 'LIVE',
  counts?: WipeCounts,
): string[] {
  const verb = mode === 'DRY-RUN' ? 'จะลบ' : 'ลบแล้ว';
  const out: string[] = [];
  out.push(`โหมด: ${mode}${plan.branchId ? ` · เฉพาะสาขา ${plan.branchId}` : ' · ทุกสาขา'}`);
  out.push('');
  out.push(`${verb} (soft-delete, timestamp เดียว = ${plan.wipedAt.toISOString()}):`);
  const table: [string, number][] = [
    ['products', counts?.products ?? plan.products.length],
    ['purchase_orders', counts?.purchase_orders ?? plan.purchaseOrderIds.length],
    ['goods_receivings', counts?.goods_receivings ?? plan.goodsReceivingIds.length],
    ['stock_transfers', counts?.stock_transfers ?? plan.stockTransferIds.length],
    ['branch_receivings', counts?.branch_receivings ?? plan.branchReceivingIds.length],
    ['stock_counts', counts?.stock_counts ?? plan.stockCountIds.length],
    ['stock_adjustments', counts?.stock_adjustments ?? plan.stockAdjustmentIds.length],
    ['stock_alerts', counts?.stock_alerts ?? plan.stockAlertIds.length],
  ];
  for (const [t, n] of table) out.push(`  ${String(n).padStart(8)}  ${t}`);
  if (counts) {
    out.push(
      `  (ตารางลูก: po_items ${counts.po_items} · goods_receiving_items ${counts.goods_receiving_items} · ` +
        `branch_receiving_items ${counts.branch_receiving_items} · stock_count_items ${counts.stock_count_items})`,
    );
  }
  out.push('');

  const cost = plan.products.reduce((acc, p) => acc.plus(p.costPrice), new Prisma.Decimal(0));
  out.push(
    `สินค้าที่${verb} ${plan.products.length} เครื่อง · ต้นทุนรวมที่จะหายจากภาพรวมคลัง ${cost.toFixed(2)} บาท`,
  );
  for (const [k, n] of groupCount(plan.products, (p) => `สาขา ${p.branchName}`))
    out.push(`  ${String(n).padStart(6)}  ${k}`);
  for (const [k, n] of groupCount(plan.products, (p) => `หมวด ${p.category}`))
    out.push(`  ${String(n).padStart(6)}  ${k}`);
  for (const [k, n] of groupCount(plan.products, (p) => `สถานะ ${p.status}`))
    out.push(`  ${String(n).padStart(6)}  ${k}`);
  out.push('');

  out.push(`เครื่องที่ข้าม (ติดด่านถือครอง — ไม่ลบ): ${plan.skipped.length}`);
  for (const s of plan.skipped)
    out.push(
      `  - ${s.imeiSerial ?? '(ไม่มี IMEI)'} ${s.name} [${s.status}] สาขา ${s.branchName}: ${s.reason}`,
    );
  out.push(
    `เครื่องสถานะผูกธุรกรรม (ไม่แตะ — เคลียร์ผ่านเมนูยกเลิกใบขาย/ยกเลิกสัญญา/ยึดเครื่อง): ${plan.bound.length}`,
  );
  for (const b of plan.bound)
    out.push(`  - ${b.imeiSerial ?? '(ไม่มี IMEI)'} ${b.name} [${b.status}] สาขา ${b.branchName}`);
  out.push(`PO ที่เก็บไว้เพราะยังมีเครื่องชี้อยู่: ${plan.keptPurchaseOrders.length}`);
  for (const k of plan.keptPurchaseOrders) out.push(`  - ${k.poNumber}: ${k.reason}`);
  out.push('');

  out.push(`เครื่องทดสอบที่เหลือ (marker TEST-/ทดสอบระบบ/PO ทดสอบ): ${plan.testProductsRemaining}`);
  if (plan.testProductsOnlineVisible.length) {
    out.push(
      `⚠️  เครื่องทดสอบที่ยังเปิดขายออนไลน์ (isOnlineVisible) — ปิดเองก่อนขายจริง: ${plan.testProductsOnlineVisible.length}`,
    );
    for (const p of plan.testProductsOnlineVisible)
      out.push(`  - ${p.imeiSerial ?? '(ไม่มี IMEI)'} ${p.name}`);
  }
  if (plan.tradeInProductCount > 0) {
    out.push(
      `⚠️  เครื่องเทิร์นที่จะถูกล้าง ${plan.tradeInProductCount} เครื่อง — แถว trade_ins และ JE เทิร์นที่เคยโพสต์ไม่ถูกแตะ (งานของการล้างสมุดทดสอบ)`,
    );
  }
  out.push('');
  out.push('GL สินค้าคงเหลือปัจจุบัน (CLI นี้ไม่แตะบัญชี — ตัวเลขนี้จะไม่ขยับ):');
  for (const g of plan.glInventory) out.push(`  ${g.code}  ${g.balance}`);
  return out;
}
