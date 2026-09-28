import { TEST_DOC_PREFIX } from './_context';
import type { CleanupStat, DomainSeeder, PlanRow, SeedContext, SeedStat } from './_types';

/**
 * prefix จริงของเลขแผนออมทดสอบ — ค่าคงที่เดียวใช้ทั้ง `markerDoc` และ query ของ
 * cleanup ⇒ เอกสารกับโค้ด drift กันไม่ได้อีก (S1, 2026-08-26)
 */
const PLAN_NO_PREFIX = `${TEST_DOC_PREFIX}SP-`;

/**
 * แผนออมถูกถอดทั้งเว็บลูกค้า แอดมิน และ API เมื่อ 2026-09-28 (คำสั่งเจ้าของ) โดเมนนี้จึง
 * **ไม่ seed อีก เหลือแค่ cleanup** ไว้ล้างแถวทดสอบที่ seed ไปก่อนหน้า
 * ตาราง saving_plans / saving_plan_payments ยังอยู่ในฐานข้อมูล
 */
export const savingPlansSeeder: DomainSeeder = {
  key: 'saving-plans',
  label: 'แผนออมเครื่อง (ถอดแล้ว — ล้างอย่างเดียว)',
  routes: [],
  markerDoc: `SavingPlan.planNumber ขึ้นต้น "${PLAN_NO_PREFIX}" (SavingPlanPayment ไม่มี marker — ตามจาก FK savingPlanId และไม่มี deletedAt จึงลบถาวร)`,

  async plan(): Promise<PlanRow[]> {
    return [];
  },

  async seed(): Promise<SeedStat> {
    return {
      created: 0,
      skipped: 0,
      notes: ['ไม่ seed — แผนออมถูกถอด 2026-09-28 (โดเมนนี้เหลือแค่ cleanup)'],
    };
  },

  async cleanup(ctx: SeedContext, dryRun: boolean): Promise<CleanupStat> {
    const rows = await ctx.prisma.savingPlan.findMany({
      where: { planNumber: { startsWith: PLAN_NO_PREFIX }, deletedAt: null },
      select: { id: true, planNumber: true },
    });
    // รายการรับเงินออมไม่มี marker (ตามจาก FK) และไม่มี deletedAt ⇒ ลบถาวร — นับก่อนลบ
    // เพื่อรายงานจำนวนจริง (รวมรายการที่ผู้ทดสอบจ่ายผ่าน QR ระหว่างเทสด้วย)
    const payments = rows.length
      ? await ctx.prisma.savingPlanPayment.findMany({
          where: { savingPlanId: { in: rows.map((r) => r.id) } },
          select: { id: true },
        })
      : [];
    for (const r of rows) console.log(`     ${r.planNumber}`);
    if (!dryRun && rows.length) {
      await ctx.prisma.$transaction(async (tx) => {
        await tx.savingPlanPayment.deleteMany({
          where: { savingPlanId: { in: rows.map((r) => r.id) } },
        });
        await tx.savingPlan.updateMany({
          where: { id: { in: rows.map((r) => r.id) } },
          data: { deletedAt: new Date() },
        });
      });
    }
    return {
      removed: {
        แผนออมเครื่อง: rows.length,
        'รายการรับเงินออม (ลบถาวร)': payments.length,
      },
      // saving_plans เป็นด่าน IRREPLACEABLE_IF_NONEMPTY ของ factory reset ซึ่งนับ COUNT(*)
      // ทั้งตาราง (รวมแถว soft-deleted — factory-reset.cli.ts countRows) ⇒ แม้ล้างแล้ว
      // แถวยังอยู่จริงบน DB และ factory reset รอบถัดไปจะหยุดถามที่ด่านนี้เสมอ
      warnings: rows.length
        ? [
            'ตาราง saving_plans อยู่ในด่าน IRREPLACEABLE_IF_NONEMPTY ของ factory reset (นับรวมแถวที่ soft delete แล้ว) — factory reset รอบถัดไปจะหยุดถาม ต้องยืนยันด้วย ACK_IRREPLACEABLE=saving_plans',
          ]
        : [],
    };
  },
};
