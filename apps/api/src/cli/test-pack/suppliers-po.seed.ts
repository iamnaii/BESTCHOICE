import { Prisma } from '@prisma/client';

import { TEST_DOC_PREFIX, TEST_NAME_PREFIX, testName, testNote } from './_context';
import { nextNumberFrom } from './_helpers';
import type { CleanupStat, DomainSeeder, PlanRow, SeedContext, SeedStat } from './_types';

/**
 * prefix จริงของเลขใบสั่งซื้อทดสอบ — ค่าคงที่เดียวใช้ทั้ง `markerDoc` และ query ของ
 * seed/cleanup ⇒ เอกสารกับโค้ด drift กันไม่ได้อีก (S1, 2026-08-26). สำคัญเป็นพิเศษ
 * ที่โดเมนนี้: Supplier/PurchaseOrder เป็นตาราง KEEP — แถวที่ marker ผิดจนกวาดไม่เจอ
 * จะค้างถาวรบน prod (factory reset ไม่ล้างให้)
 */
const PO_NO_PREFIX = `${TEST_DOC_PREFIX}PO-`;

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
  markerDoc: `Supplier.name ขึ้นต้น "${TEST_NAME_PREFIX}" · PurchaseOrder.poNumber ขึ้นต้น "${PO_NO_PREFIX}" (⚠️ ทั้งสองตารางเป็น KEEP — factory reset ไม่ล้างให้)`,

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

    const prefix = `${PO_NO_PREFIX}${ctx.dateStr}-`;
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
      where: { poNumber: { startsWith: PO_NO_PREFIX }, deletedAt: null },
      select: { id: true, poNumber: true },
    });
    // เครื่องที่ QC รับเข้าจาก PO ทดสอบ (po-receiving.service.ts) ไม่มี marker ติดตัว —
    // ตามได้จาก FK ตรง Product.poId เท่านั้น ถ้าไม่กวาดตรงนี้จะเหลือเป็นสต็อกผีถาวร
    const products = pos.length
      ? await ctx.prisma.product.findMany({
          where: { poId: { in: pos.map((p) => p.id) }, deletedAt: null },
          select: { id: true, imeiSerial: true, name: true, status: true },
        })
      : [];
    const suppliers = await ctx.prisma.supplier.findMany({
      where: { name: { startsWith: TEST_NAME_PREFIX }, deletedAt: null },
      select: { id: true, name: true },
    });
    for (const p of pos) console.log(`     ${p.poNumber}`);
    // เครื่องพวกนี้ไม่มี marker — บรรทัดนี้คือโอกาสเดียวที่ผู้สั่งล้าง (ทั้ง dry-run และของจริง)
    // จะเห็นว่ากำลังจะลบเครื่องไหนบ้าง
    for (const p of products)
      console.log(
        `     เครื่องจาก PO ทดสอบ: ${p.imeiSerial ?? '(ไม่มี IMEI)'} "${p.name}" [${p.status}]`,
      );
    for (const s of suppliers) console.log(`     ซัพพลายเออร์ "${s.name}"`);

    // เครื่องที่ไม่ใช่ IN_STOCK แล้ว = ผู้ทดสอบเอาไปขาย/จอง/เปิดสัญญาต่อ — อาจมีเอกสารอื่นชี้อยู่
    // ต้องเด้งเตือนให้คนตัดสิน ไม่ใช่ลบเงียบ ๆ
    const movedProducts = products.filter((p) => p.status !== 'IN_STOCK');

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
          // เครื่องที่รับเข้าจาก PO ทดสอบ — soft delete พร้อมใบในทรานแซกชันเดียวกัน
          // (ไม่มี hard delete ในสายนี้ จึงไม่มีปัญหาลำดับ FK)
          if (products.length) {
            await tx.product.updateMany({
              where: { id: { in: products.map((pr) => pr.id) } },
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

    // ถ้อยคำต้องตรงกับสิ่งที่เกิดจริง: dry-run = ยังไม่ได้ลบ (ให้ตรวจก่อนยืนยัน),
    // live = ลบไปแล้วในทรานแซกชันข้างบน (ให้ตามเช็คเอกสารที่ยังชี้ถึงเครื่อง)
    const warnings: string[] = movedProducts.map((p) =>
      dryRun
        ? `เครื่อง ${p.imeiSerial ?? p.name} จาก PO ทดสอบไม่ได้อยู่สถานะ IN_STOCK แล้ว (สถานะปัจจุบัน: ${p.status}) — อาจมีใบขาย/สัญญา/การจองชี้อยู่ ตรวจก่อนยืนยันการล้าง`
        : `เครื่อง ${p.imeiSerial ?? p.name} จาก PO ทดสอบไม่ได้อยู่สถานะ IN_STOCK (สถานะล่าสุด: ${p.status}) และถูกลบ (soft delete) ไปแล้วในรอบนี้ — ตรวจใบขาย/สัญญา/การจองที่ยังชี้ถึงเครื่องนี้`,
    );
    if (pos.length || suppliers.length)
      warnings.push(
        'ตาราง suppliers + purchase_orders อยู่ใน KEEP_TABLES ของ factory reset — ถ้าไม่ล้างตอนนี้จะรอดข้ามไปปนทะเบียนจริง',
      );
    return {
      removed: {
        ใบสั่งซื้อ: pos.length,
        เครื่องรับเข้าจากใบสั่งซื้อ: products.length,
        ซัพพลายเออร์ทดสอบ: suppliers.length,
      },
      warnings,
    };
  },
};
