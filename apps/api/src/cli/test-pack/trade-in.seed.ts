import { Prisma } from '@prisma/client';

import { TEST_NOTE_MARKER, testNote } from './_context';
import type { CleanupStat, DomainSeeder, PlanRow, SeedContext, SeedStat } from './_types';

/**
 * R2 — หยุดที่ APPRAISED
 * ACCEPTED สร้าง Product เข้าสต็อก (+ JE รับซื้อถ้าเป็น BUYBACK) ผ่าน
 * trade-in-lifecycle.service.ts ⇒ ให้ผู้ทดสอบกดรับซื้อเองผ่านหน้าจอ
 *
 * flow ปล่อยเป็น default (EXCHANGE) โดยเจตนา: accept() ของ EXCHANGE **ไม่โพสต์ JE**
 * (JE รับซื้อโพสต์เฉพาะ BUYBACK — trade-in-lifecycle.service.ts) ⇒ ผู้ทดสอบกดรับซื้อ
 * ระหว่างเทสได้โดย cleanup ไม่ทิ้ง JE ค้างในสมุด — JE `shop-trade-in:<id>` ไม่มี marker
 * และไม่มี saleId/contractId ใน metadata จึงไม่มีเส้นทางกวาดใดมองเห็นมัน
 *
 * เครื่องที่ accept สร้าง (Product) ได้ marker ผ่าน imeiSerial = imei ของรายการนี้
 * ("TEST-TRADEIN-…") ⇒ ถูกกวาดโดยโดเมน contracts (Product.imeiSerial LIKE 'TEST-%')
 */
const ROWS: Array<{
  key: string;
  status: 'PENDING_APPRAISAL' | 'APPRAISED';
  brand: string;
  model: string;
  estimated: number;
  offered: number | null;
}> = [
  {
    key: 'pending',
    status: 'PENDING_APPRAISAL',
    brand: 'ทดสอบระบบ',
    model: 'รุ่นเทิร์น A',
    estimated: 4500,
    offered: null,
  },
  {
    key: 'appraised',
    status: 'APPRAISED',
    brand: 'ทดสอบระบบ',
    model: 'รุ่นเทิร์น B',
    estimated: 7200,
    offered: 6800,
  },
];

export const tradeInSeeder: DomainSeeder = {
  key: 'trade-in',
  label: 'รับซื้อเครื่องมือสอง',
  routes: ['/trade-in'],
  markerDoc: `TradeIn.notes ขึ้นต้นด้วย "${TEST_NOTE_MARKER}" (เครื่องที่เกิดจากการกดรับซื้อระหว่างเทสได้ imeiSerial "TEST-" — กวาดโดยโดเมน contracts)`,

  async plan(): Promise<PlanRow[]> {
    return ROWS.map((r) => ({
      label: `เทิร์น ${r.key}`,
      detail: `${r.status} · ${r.model} · ประเมิน ฿${r.estimated.toLocaleString('th-TH')}${
        r.offered ? ` · เสนอ ฿${r.offered.toLocaleString('th-TH')}` : ''
      }`,
    }));
  },

  async seed(ctx: SeedContext): Promise<SeedStat> {
    const stat: SeedStat = { created: 0, skipped: 0, notes: [] };
    const customer = await ctx.prisma.customer.findFirst({
      where: { name: { startsWith: 'ทดสอบระบบ ลูกค้าใหม่' }, deletedAt: null },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    });
    if (!customer) {
      // customerId เป็น optional บน TradeIn (ผู้ขาย walk-in) — สร้างต่อได้ ไม่ต้องข้ามโดเมน
      stat.notes.push(
        'ไม่มีลูกค้าทดสอบ — สร้างเป็นรายการ walk-in ไม่ผูกลูกค้า (รันโดเมน contracts ก่อนถ้าต้องการผูก)',
      );
    }
    for (const r of ROWS) {
      const notes = testNote(`รับซื้อมือสอง/${r.key}`);
      // probe ด้วย notes marker รายแถว — ไม่มีคอลัมน์ unique ที่ seeder แตะ (voucherNumber
      // ว่าง, imei ไม่ unique บน trade_ins) ⇒ สร้างใหม่หลัง cleanup ได้ตรง ๆ ไม่ต้องมีขากู้คืน
      const exists = await ctx.prisma.tradeIn.findFirst({
        where: { notes, deletedAt: null },
        select: { id: true },
      });
      if (exists) {
        stat.skipped += 1;
        continue;
      }
      await ctx.prisma.tradeIn.create({
        data: {
          customerId: customer?.id ?? null,
          branchId: ctx.refs.branchId,
          deviceBrand: r.brand,
          deviceModel: r.model,
          deviceStorage: '128GB',
          deviceCondition: 'B',
          imei: `TEST-TRADEIN-${r.key}`,
          // เงินเป็น Prisma.Decimal เสมอ — Global Constraint
          estimatedValue: new Prisma.Decimal(r.estimated),
          offeredPrice: r.offered !== null ? new Prisma.Decimal(r.offered) : null,
          status: r.status,
          // สถานะต้องเล่าเรื่องเดียวกับที่ appraise() ของจริงเขียน (T5-C17):
          // ผู้ตีราคา + ล็อกราคา + เวลาตีครั้งแรก · basePriceAtAppraisal ปล่อย null
          // (แบรนด์ทดสอบไม่มีแถวในตารางราคากลาง — ตรงกับ path "ไม่พบ valuation" ของจริง)
          ...(r.status === 'APPRAISED'
            ? {
                appraisedById: ctx.refs.reviewerId,
                appraisalLocked: true,
                firstAppraisedAt: ctx.today,
              }
            : {}),
          sellerName: 'ทดสอบระบบ ผู้ขายมือสอง',
          sellerPhone: '0895550001',
          notes,
        },
      });
      stat.created += 1;
    }
    return stat;
  },

  async cleanup(ctx: SeedContext, dryRun: boolean): Promise<CleanupStat> {
    const rows = await ctx.prisma.tradeIn.findMany({
      where: { notes: { startsWith: TEST_NOTE_MARKER }, deletedAt: null },
      select: { id: true, status: true, imei: true, deviceModel: true, productId: true },
    });
    // identity ให้คนตรวจก่อน/หลังลบ — พิมพ์ทั้ง dry-run และโหมดจริง
    for (const r of rows) {
      console.log(
        `     ${r.imei ?? '(ไม่มี IMEI)'} · ${r.deviceModel} · ${r.status}${
          r.productId ? ' (รับซื้อแล้ว — มีเครื่องเข้าสต็อก)' : ''
        }`,
      );
    }
    const accepted = rows.filter((r) => r.productId);
    if (!dryRun && rows.length) {
      await ctx.prisma.tradeIn.updateMany({
        where: { id: { in: rows.map((r) => r.id) } },
        data: { deletedAt: new Date() },
      });
    }
    return {
      removed: { รายการรับซื้อมือสอง: rows.length },
      warnings: accepted.length
        ? [
            `รายการที่รับซื้อแล้ว ${accepted.length} รายการมีเครื่องเข้าสต็อก (IMEI TEST-) — เครื่องถูกกวาดโดยโดเมน contracts; ถ้ารัน cleanup เฉพาะโดเมน trade-in เครื่องจะยังค้างในสต็อก`,
          ]
        : [],
    };
  },
};
