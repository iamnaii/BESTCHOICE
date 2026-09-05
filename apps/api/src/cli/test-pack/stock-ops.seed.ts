import { TEST_DOC_PREFIX, TEST_NOTE_MARKER, testNote } from './_context';
import { TEST_ALERT_MODEL, TEST_STOCK_COUNT_PREFIX } from '../../utils/test-data-markers';
import { nextNumberFrom } from './_helpers';
import type { CleanupStat, DomainSeeder, PlanRow, SeedContext, SeedStat } from './_types';

/**
 * marker จริงของโดเมนนี้ — ค่าคงที่เดียวใช้ทั้ง `markerDoc` และ query ของ seed/cleanup
 * ⇒ เอกสารกับโค้ด drift กันไม่ได้อีก (S1, 2026-08-26). หมายเหตุ ALERT_MODEL เป็น
 * "ค่าตรงตัว" (equality) ไม่ใช่ prefix — ReorderPoint/StockAlert ที่สร้างมือด้วย model
 * ชื่ออื่นจะไม่ถูกกวาด
 */
const COUNT_NO_PREFIX = TEST_STOCK_COUNT_PREFIX;
const ALERT_MODEL = TEST_ALERT_MODEL;

/**
 * ไม่โพสต์ JE — seed สถานะไหนก็ได้
 * ใช้เครื่องทดสอบที่โดเมน contracts สร้างไว้ (IMEI ขึ้นต้น TEST-) เท่านั้น
 * ห้ามแตะเครื่องจริง เพราะการโอนย้าย/ปรับสต็อกเปลี่ยน branchId และ status ของเครื่อง
 *
 * ทุกตารางในโดเมนนี้ (StockCount · StockCountItem · StockTransfer · StockAdjustment ·
 * StockAlert · ReorderPoint · BranchReceiving · BranchReceivingItem) **มี deletedAt ทั้งหมด**
 * ⇒ cleanup ใช้ soft delete ล้วน (BranchReceiving เกิดตอนผู้ทดสอบกดยืนยันรับโอน — ไม่มี marker
 * แต่ตามได้จาก FK ตรง transferId)
 */
export const stockOpsSeeder: DomainSeeder = {
  key: 'stock-ops',
  label: 'งานสต็อก (โอนย้าย · นับ · ปรับปรุง · แจ้งเตือน)',
  routes: [
    '/stock',
    '/stock/products',
    '/stock/transfers',
    '/stock/count',
    '/stock/adjustments',
    '/stock/alerts',
    '/stock/workflow',
    '/inventory',
  ],
  markerDoc: `StockCount.countNumber ขึ้นต้น "${COUNT_NO_PREFIX}" · StockTransfer/StockAdjustment.notes ขึ้นต้นด้วย "${TEST_NOTE_MARKER}" · ReorderPoint/StockAlert.model = "${ALERT_MODEL}" (ค่าตรงตัว)`,

  async plan(ctx: SeedContext): Promise<PlanRow[]> {
    const products = await ctx.prisma.product.findMany({
      where: { imeiSerial: { startsWith: 'TEST-' }, status: 'IN_STOCK', deletedAt: null },
      select: { id: true },
      take: 2,
    });
    const rows: PlanRow[] = [];
    if (!products.length) {
      rows.push({
        label: 'ข้าม',
        detail: 'ยังไม่มีเครื่องทดสอบ IN_STOCK — รันโดเมน contracts ก่อน',
      });
      return rows;
    }
    rows.push({
      label: `${TEST_DOC_PREFIX}COUNT`,
      detail: 'ใบนับสต็อกที่กำลังนับ (มีรายการรอกระทบยอด)',
    });
    if (ctx.refs.reviewerId === ctx.refs.ownerId)
      rows.push({
        label: 'ข้ามปรับปรุงสต็อก',
        detail: 'ไม่มีผู้อนุมัติคนที่สอง — สร้างรายการ 4-eyes (ผู้ปรับ ≠ ผู้อนุมัติ) ไม่ได้',
      });
    else
      rows.push({
        label: 'ปรับปรุงสต็อก',
        detail: 'เหตุผล CORRECTION 1 รายการ (ผู้ปรับ ≠ ผู้อนุมัติ)',
      });
    rows.push({
      label: 'จุดสั่งซื้อ + แจ้งเตือน',
      detail: 'ReorderPoint 1 + StockAlert 1 (ACTIVE)',
    });
    if (ctx.refs.secondBranchId)
      rows.push({ label: 'โอนย้ายสาขา', detail: 'PENDING 1 เครื่อง (รอสาขาปลายทางรับ)' });
    else rows.push({ label: 'ข้ามโอนย้าย', detail: 'มีสาขาเดียว — โอนย้ายต้องมี 2 สาขา' });
    return rows;
  },

  async seed(ctx: SeedContext): Promise<SeedStat> {
    const stat: SeedStat = { created: 0, skipped: 0, notes: [] };
    const products = await ctx.prisma.product.findMany({
      where: { imeiSerial: { startsWith: 'TEST-' }, status: 'IN_STOCK', deletedAt: null },
      select: { id: true, status: true },
      take: 2,
    });
    if (!products.length) {
      stat.notes.push(
        'ข้ามทั้งโดเมน — ยังไม่มีเครื่องทดสอบสถานะ IN_STOCK (รันโดเมน contracts ก่อน)',
      );
      return stat;
    }

    // 1) ใบนับสต็อก — ฟิลด์ items ยืนยันจาก prisma/seed.ts (sc-001)
    //    countNumber เป็น @unique เต็มตาราง — จองเลขแบบ max+1 ไม่กรอง deletedAt
    //    (doctrine เดียวกับ nextDocNumber ใน _helpers) และ probe ความซ้ำที่ notes (marker)
    const countPrefix = `${COUNT_NO_PREFIX}${ctx.dateStr}-`;
    const countNotes = testNote('ใบนับสต็อกสำหรับทดสอบ');
    const countExists = await ctx.prisma.stockCount.findFirst({
      where: { notes: countNotes, deletedAt: null },
      select: { id: true },
    });
    if (countExists) {
      stat.skipped += 1;
    } else {
      const lastCount = await ctx.prisma.stockCount.findFirst({
        where: { countNumber: { startsWith: countPrefix } },
        orderBy: { countNumber: 'desc' },
        select: { countNumber: true },
      });
      await ctx.prisma.stockCount.create({
        data: {
          countNumber: nextNumberFrom(countPrefix, lastCount?.countNumber ?? null),
          branchId: ctx.refs.branchId,
          countedById: ctx.refs.salespersonId,
          status: 'IN_PROGRESS',
          startedAt: ctx.today,
          notes: countNotes,
          items: { create: products.map((p) => ({ productId: p.id, expectedStatus: p.status })) },
        },
      });
      stat.created += 1;
    }

    // 2) ปรับปรุงสต็อก — CORRECTION ไม่เปลี่ยนสถานะเครื่อง จึงปลอดภัยที่สุดสำหรับข้อมูลเทส
    //    (เหตุผล DAMAGED ต้องแนบรูปหลักฐาน T5-C14; FOUND ต้องมาจากสถานะใน FOUND_POLICY)
    //    4-eyes: ผู้ปรับต้องคนละคนกับผู้อนุมัติ — SeedRefs **ไม่การันตี** ว่า reviewerId ≠ ownerId
    //    (ระบบที่มี OWNER คนเดียวไม่มี BM ได้คนเดียวกันทั้งสองช่อง) จึงต้องเช็คเองก่อนสร้าง
    //    ห้ามลดมาตรฐานด้วยการยัดคนเดียวกันลงทั้งสองคอลัมน์
    if (ctx.refs.reviewerId === ctx.refs.ownerId) {
      stat.notes.push(
        'ข้ามใบปรับปรุงสต็อก — สภาพแวดล้อมนี้ไม่มีผู้อนุมัติคนที่สอง (ผู้ปรับกับผู้อนุมัติจะเป็นคนเดียวกัน) จึงสร้างรายการ 4-eyes ไม่ได้',
      );
    } else {
      const adjNote = testNote('ปรับปรุงสต็อกสำหรับทดสอบ');
      const adjExists = await ctx.prisma.stockAdjustment.findFirst({
        where: { notes: adjNote, deletedAt: null },
        select: { id: true },
      });
      if (adjExists) {
        stat.skipped += 1;
      } else {
        await ctx.prisma.stockAdjustment.create({
          data: {
            productId: products[0].id,
            branchId: ctx.refs.branchId,
            reason: 'CORRECTION',
            previousStatus: products[0].status,
            notes: adjNote,
            adjustedById: ctx.refs.reviewerId,
            approvedById: ctx.refs.ownerId,
          },
        });
        stat.created += 1;
      }
    }

    // 3) จุดสั่งซื้อ + แจ้งเตือน — StockAlert.reorderPointId เป็น FK บังคับ ⇒ สร้าง ReorderPoint นำ
    //    ReorderPoint มี @@unique([brand, model, storage, category, branchId]) แบบเต็มตาราง
    //    (ไม่ใช่ partial) — แถวที่ cleanup soft delete ไปแล้วยังถือ tuple อยู่ ⇒ probe โดยไม่กรอง
    //    deletedAt แล้ว "กู้คืน" แทนการสร้างซ้ำ ไม่งั้น seed หลัง cleanup ชน P2002
    const alertModel = ALERT_MODEL;
    const rpAny = await ctx.prisma.reorderPoint.findFirst({
      where: { model: alertModel },
      select: { id: true, deletedAt: true },
    });
    if (rpAny && !rpAny.deletedAt) {
      stat.skipped += 1;
    } else if (rpAny) {
      await ctx.prisma.reorderPoint.update({ where: { id: rpAny.id }, data: { deletedAt: null } });
      const restored = await ctx.prisma.stockAlert.updateMany({
        where: { reorderPointId: rpAny.id },
        data: { deletedAt: null },
      });
      if (restored.count === 0) {
        await ctx.prisma.stockAlert.create({
          data: {
            reorderPointId: rpAny.id,
            brand: 'ทดสอบระบบ',
            model: alertModel,
            storage: '128GB',
            category: 'PHONE_NEW',
            branchId: ctx.refs.branchId,
            currentStock: 1,
            minQuantity: 2,
            reorderQuantity: 5,
            status: 'ACTIVE',
          },
        });
        stat.created += 1; // แจ้งเตือนใบนี้เป็นแถวใหม่จริง — ไม่มีแถวเดิมให้กู้
      }
      // แถวที่ "กู้คืน" ไม่ใช่แถวที่สร้างใหม่ — นับเป็น skipped พร้อมบอกจำนวนตรง ๆ
      stat.skipped += 1 + restored.count;
      stat.notes.push(
        `กู้คืนจุดสั่งซื้อ 1 แถว + แจ้งเตือน ${restored.count} แถวที่เคยถูกล้าง ` +
          '(unique constraint กันสร้างแถวใหม่ซ้ำ — แถวกู้คืนนับเป็น skipped ไม่ใช่ created)',
      );
    } else {
      const rp = await ctx.prisma.reorderPoint.create({
        data: {
          brand: 'ทดสอบระบบ',
          model: alertModel,
          storage: '128GB',
          category: 'PHONE_NEW',
          branchId: ctx.refs.branchId,
          minQuantity: 2,
          reorderQuantity: 5,
        },
        select: { id: true },
      });
      await ctx.prisma.stockAlert.create({
        data: {
          reorderPointId: rp.id,
          brand: 'ทดสอบระบบ',
          model: alertModel,
          storage: '128GB',
          category: 'PHONE_NEW',
          branchId: ctx.refs.branchId,
          currentStock: 1,
          minQuantity: 2,
          reorderQuantity: 5,
          status: 'ACTIVE',
        },
      });
      stat.created += 2;
    }

    // 4) โอนย้ายสาขา — ต้องมีสาขาที่สอง
    if (!ctx.refs.secondBranchId) {
      stat.notes.push('ข้ามการโอนย้ายสาขา — ระบบมีสาขาเดียว');
    } else {
      const trNote = testNote('โอนย้ายสาขาสำหรับทดสอบ — รอสาขาปลายทางรับ');
      const exists = await ctx.prisma.stockTransfer.findFirst({
        where: { notes: trNote, deletedAt: null },
        select: { id: true },
      });
      if (exists) {
        stat.skipped += 1;
      } else {
        await ctx.prisma.stockTransfer.create({
          data: {
            productId: products[0].id,
            fromBranchId: ctx.refs.branchId,
            toBranchId: ctx.refs.secondBranchId,
            transferredBy: ctx.refs.reviewerId,
            status: 'PENDING',
            notes: trNote,
          },
        });
        stat.created += 1;
      }
    }
    return stat;
  },

  async cleanup(ctx: SeedContext, dryRun: boolean): Promise<CleanupStat> {
    const alertModel = ALERT_MODEL;
    const [counts, transfers, adjustments, rps] = await Promise.all([
      ctx.prisma.stockCount.findMany({
        where: { countNumber: { startsWith: COUNT_NO_PREFIX }, deletedAt: null },
        select: { id: true, countNumber: true },
      }),
      ctx.prisma.stockTransfer.findMany({
        where: { notes: { startsWith: TEST_NOTE_MARKER }, deletedAt: null },
        select: { id: true },
      }),
      ctx.prisma.stockAdjustment.findMany({
        where: { notes: { startsWith: TEST_NOTE_MARKER }, deletedAt: null },
        select: { id: true },
      }),
      ctx.prisma.reorderPoint.findMany({
        where: { model: alertModel, deletedAt: null },
        select: { id: true },
      }),
    ]);
    const alerts = rps.length
      ? await ctx.prisma.stockAlert.findMany({
          where: { reorderPointId: { in: rps.map((r) => r.id) }, deletedAt: null },
          select: { id: true },
        })
      : [];
    // ใบตรวจรับสาขาที่เกิดจากการกดยืนยันรับโอนของทดสอบ (branch-receiving.service.ts)
    // ไม่มี marker ติดตัว — ตามได้จาก FK ตรง BranchReceiving.transferId (@unique) เท่านั้น
    // ถ้าไม่กวาดตรงนี้จะเหลือใบตรวจรับค้างชี้ไปที่ใบโอนที่ถูกลบไปแล้ว
    const receivings = transfers.length
      ? await ctx.prisma.branchReceiving.findMany({
          where: { transferId: { in: transfers.map((t) => t.id) }, deletedAt: null },
          select: { id: true, transferId: true },
        })
      : [];
    const receivingItems = receivings.length
      ? await ctx.prisma.branchReceivingItem.findMany({
          where: { receivingId: { in: receivings.map((r) => r.id) }, deletedAt: null },
          select: { id: true },
        })
      : [];
    for (const c of counts) console.log(`     ${c.countNumber}`);
    // ใบตรวจรับสาขาไม่มี marker ติดตัว — บรรทัดนี้คือโอกาสเดียวที่ผู้สั่งล้าง (ทั้ง dry-run
    // และของจริง) จะเห็นว่ากำลังกวาดใบไหน (pattern เดียวกับเครื่องจาก PO ใน suppliers-po)
    for (const r of receivings)
      console.log(`     ใบตรวจรับสาขา ${r.id} (ของใบโอนย้าย ${r.transferId})`);

    if (!dryRun) {
      const now = new Date();
      await ctx.prisma.$transaction(async (tx) => {
        if (counts.length) {
          await tx.stockCountItem.updateMany({
            where: { stockCountId: { in: counts.map((c) => c.id) } },
            data: { deletedAt: now },
          });
          await tx.stockCount.updateMany({
            where: { id: { in: counts.map((c) => c.id) } },
            data: { deletedAt: now },
          });
        }
        // ลูก → แม่ → ใบโอน (soft delete ทั้งหมด — ไม่มี FK abort แต่คงลำดับให้อ่านตรงกับโครงสร้าง)
        if (receivingItems.length)
          await tx.branchReceivingItem.updateMany({
            where: { id: { in: receivingItems.map((i) => i.id) } },
            data: { deletedAt: now },
          });
        if (receivings.length)
          await tx.branchReceiving.updateMany({
            where: { id: { in: receivings.map((r) => r.id) } },
            data: { deletedAt: now },
          });
        if (transfers.length)
          await tx.stockTransfer.updateMany({
            where: { id: { in: transfers.map((t) => t.id) } },
            data: { deletedAt: now },
          });
        if (adjustments.length)
          await tx.stockAdjustment.updateMany({
            where: { id: { in: adjustments.map((a) => a.id) } },
            data: { deletedAt: now },
          });
        // แจ้งเตือนต้องออกก่อนจุดสั่งซื้อ — reorderPointId เป็น FK บังคับ
        if (alerts.length)
          await tx.stockAlert.updateMany({
            where: { id: { in: alerts.map((a) => a.id) } },
            data: { deletedAt: now },
          });
        if (rps.length)
          await tx.reorderPoint.updateMany({
            where: { id: { in: rps.map((r) => r.id) } },
            data: { deletedAt: now },
          });
      });
    }
    return {
      removed: {
        ใบนับสต็อก: counts.length,
        ใบโอนย้ายสาขา: transfers.length,
        ใบตรวจรับสาขา: receivings.length,
        รายการตรวจรับสาขา: receivingItems.length,
        ใบปรับปรุงสต็อก: adjustments.length,
        แจ้งเตือนสต็อก: alerts.length,
        จุดสั่งซื้อ: rps.length,
      },
      warnings: [],
    };
  },
};
