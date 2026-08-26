import { Prisma } from '@prisma/client';

import { TEST_DOC_PREFIX, TEST_NAME_PREFIX, testName, testNote } from './_context';
import { nextNumberFrom } from './_helpers';
import type { CleanupStat, DomainSeeder, PlanRow, SeedContext, SeedStat } from './_types';

const SUPPLIERS: Array<{ name: string; phone: string; isRepairCenter: boolean }> = [
  { name: 'ซัพพลายเออร์มือถือ', phone: '021110001', isRepairCenter: false },
  { name: 'ศูนย์ซ่อมพันธมิตร', phone: '021110002', isRepairCenter: true },
];

/**
 * ใบสั่งซื้อ 2 ใบ — สั่งแล้วรอรับของ กับ รับบางส่วนแล้ว
 * ค่า POStatus จริง: DRAFT APPROVED ORDERED PENDING PARTIALLY_RECEIVED FULLY_RECEIVED CANCELLED
 * (**ไม่มี `PARTIAL`** — ชื่อเต็มคือ PARTIALLY_RECEIVED)
 *
 * ไม่โพสต์ JE — โมดูล purchase-orders ทั้งสายไม่แตะสมุดบัญชี
 */
const POS: Array<{
  key: string;
  status: 'ORDERED' | 'PARTIALLY_RECEIVED';
  qty: number;
  unitPrice: number;
  note: string;
}> = [
  { key: 'ordered', status: 'ORDERED', qty: 5, unitPrice: 12000, note: 'ใบสั่งซื้อรอรับของ' },
  {
    key: 'partial',
    status: 'PARTIALLY_RECEIVED',
    qty: 3,
    unitPrice: 21000,
    note: 'ใบสั่งซื้อรับของบางส่วนแล้ว',
  },
];

export const suppliersPoSeeder: DomainSeeder = {
  key: 'suppliers-po',
  label: 'ซัพพลายเออร์ + ใบสั่งซื้อ',
  routes: ['/suppliers', '/suppliers/:id', '/purchase-orders', '/purchase-orders/qc'],
  markerDoc: `Supplier.name ขึ้นต้น "${TEST_NAME_PREFIX}" · PurchaseOrder.poNumber ขึ้นต้น "${TEST_DOC_PREFIX}" (⚠️ ทั้งสองตารางเป็น KEEP — factory reset ไม่ล้างให้)`,

  async plan(): Promise<PlanRow[]> {
    return [
      ...SUPPLIERS.map((s) => ({
        label: testName(s.name),
        detail: s.isRepairCenter ? 'ศูนย์ซ่อม (isRepairCenter = true)' : 'ซัพพลายเออร์ทั่วไป',
      })),
      ...POS.map((p) => ({
        label: `${TEST_DOC_PREFIX}PO ${p.key}`,
        detail: `${p.status} · ${p.qty} ชิ้น × ฿${p.unitPrice.toLocaleString('th-TH')}`,
      })),
    ];
  },

  async seed(ctx: SeedContext): Promise<SeedStat> {
    const stat: SeedStat = { created: 0, skipped: 0, notes: [] };
    const supplierIds: string[] = [];

    for (const s of SUPPLIERS) {
      const name = testName(s.name);
      const found = await ctx.prisma.supplier.findFirst({
        where: { name, deletedAt: null },
        select: { id: true },
      });
      if (found) {
        supplierIds.push(found.id);
        stat.skipped += 1;
        continue;
      }
      const created = await ctx.prisma.supplier.create({
        data: {
          name,
          phone: s.phone,
          isRepairCenter: s.isRepairCenter,
          notes: testNote('ซัพพลายเออร์สำหรับทดสอบ — ลบได้'),
        },
        select: { id: true },
      });
      supplierIds.push(created.id);
      stat.created += 1;
    }

    const prefix = `${TEST_DOC_PREFIX}PO-${ctx.dateStr}-`;
    for (const p of POS) {
      // idempotency probe ที่ notes (marker) — ไม่ใช่ที่เลขเอกสาร เพราะเลขเป็น running number
      const notes = testNote(p.note);
      const exists = await ctx.prisma.purchaseOrder.findFirst({
        where: { notes, deletedAt: null },
        select: { id: true },
      });
      if (exists) {
        stat.skipped += 1;
        continue;
      }
      // poNumber เป็น @unique เต็มตาราง (ไม่ใช่ partial) — แถวที่ soft delete ไปแล้วยังถือเลขอยู่
      // ⇒ จองเลขแบบ max+1 โดย "ไม่กรอง deletedAt" (doctrine เดียวกับ nextDocNumber ใน _helpers)
      const last = await ctx.prisma.purchaseOrder.findFirst({
        where: { poNumber: { startsWith: prefix } },
        orderBy: { poNumber: 'desc' },
        select: { poNumber: true },
      });
      await ctx.prisma.purchaseOrder.create({
        data: {
          poNumber: nextNumberFrom(prefix, last?.poNumber ?? null),
          supplierId: supplierIds[0],
          orderDate: ctx.today,
          // ห้ามคูณเงินเป็น float — Global Constraint: เงินต้องเป็น Prisma.Decimal
          totalAmount: new Prisma.Decimal(p.unitPrice).mul(p.qty),
          status: p.status,
          notes,
          createdById: ctx.refs.reviewerId,
          // ฟิลด์ของ POItem ยืนยันจาก prisma/seed.ts (poItemsData) — brand/model/color/storage/category/quantity/unitPrice/receivedQty
          items: {
            create: [
              {
                brand: 'ทดสอบระบบ',
                model: 'รุ่นทดสอบ',
                storage: '128GB',
                category: 'PHONE_NEW',
                quantity: p.qty,
                unitPrice: p.unitPrice,
                receivedQty: p.status === 'PARTIALLY_RECEIVED' ? 1 : 0,
              },
            ],
          },
        },
      });
      stat.created += 1;
    }
    return stat;
  },

  async cleanup(ctx: SeedContext, dryRun: boolean): Promise<CleanupStat> {
    const pos = await ctx.prisma.purchaseOrder.findMany({
      where: { poNumber: { startsWith: `${TEST_DOC_PREFIX}PO-` }, deletedAt: null },
      select: { id: true, poNumber: true },
    });
    const suppliers = await ctx.prisma.supplier.findMany({
      where: { name: { startsWith: TEST_NAME_PREFIX }, deletedAt: null },
      select: { id: true, name: true },
    });
    for (const p of pos) console.log(`     ${p.poNumber}`);
    for (const s of suppliers) console.log(`     ซัพพลายเออร์ "${s.name}"`);

    if (!dryRun && (pos.length || suppliers.length)) {
      const now = new Date();
      await ctx.prisma.$transaction(async (tx) => {
        if (pos.length) {
          const poIds = pos.map((p) => p.id);
          // ทุกตารางในสายนี้มี deletedAt ⇒ soft delete ทั้งหมด (กฎ .claude/rules/database.md)
          const grs = await tx.goodsReceiving.findMany({
            where: { poId: { in: poIds } },
            select: { id: true },
          });
          if (grs.length) {
            await tx.goodsReceivingItem.updateMany({
              where: { receivingId: { in: grs.map((g) => g.id) } },
              data: { deletedAt: now },
            });
            await tx.goodsReceiving.updateMany({
              where: { id: { in: grs.map((g) => g.id) } },
              data: { deletedAt: now },
            });
          }
          await tx.pOItem.updateMany({ where: { poId: { in: poIds } }, data: { deletedAt: now } });
          await tx.purchaseOrder.updateMany({
            where: { id: { in: poIds } },
            data: { deletedAt: now },
          });
        }
        if (suppliers.length) {
          await tx.supplier.updateMany({
            where: { id: { in: suppliers.map((s) => s.id) } },
            data: { deletedAt: now },
          });
        }
      });
    }

    return {
      removed: { ใบสั่งซื้อ: pos.length, ซัพพลายเออร์ทดสอบ: suppliers.length },
      warnings:
        pos.length || suppliers.length
          ? [
              'ตาราง suppliers + purchase_orders อยู่ใน KEEP_TABLES ของ factory reset — ถ้าไม่ล้างตอนนี้จะรอดข้ามไปปนทะเบียนจริง',
            ]
          : [],
    };
  },
};
