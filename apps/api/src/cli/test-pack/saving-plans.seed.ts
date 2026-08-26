import { Prisma } from '@prisma/client';

import { TEST_DOC_PREFIX } from './_context';
import type { CleanupStat, DomainSeeder, PlanRow, SeedContext, SeedStat } from './_types';

const DAY = 24 * 60 * 60 * 1000;

/** ไม่โพสต์ JE — แผนออม/รายการรับเงินออมไม่มีคู่ในสมุดบัญชีเลยโดยธรรมชาติ */
const ROWS: Array<{
  key: string;
  status: 'ACTIVE' | 'COMPLETED';
  target: number;
  monthly: number;
  months: number;
  saved: number;
}> = [
  { key: 'active', status: 'ACTIVE', target: 25900, monthly: 2590, months: 10, saved: 5180 },
  { key: 'done', status: 'COMPLETED', target: 9900, monthly: 1650, months: 6, saved: 9900 },
];

export const savingPlansSeeder: DomainSeeder = {
  key: 'saving-plans',
  label: 'แผนออมเครื่อง',
  routes: ['/saving-plans'],
  markerDoc: `SavingPlan.planNumber ขึ้นต้น "${TEST_DOC_PREFIX}" (SavingPlanPayment ไม่มี marker — ตามจาก FK savingPlanId และไม่มี deletedAt จึงลบถาวร)`,

  async plan(): Promise<PlanRow[]> {
    return ROWS.map((r) => ({
      label: `${TEST_DOC_PREFIX}SP ${r.key}`,
      detail: `${r.status} · เป้า ฿${r.target.toLocaleString('th-TH')} · ออมแล้ว ฿${r.saved.toLocaleString('th-TH')}`,
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
      stat.notes.push('ข้ามทั้งโดเมน — ยังไม่มีลูกค้าทดสอบ (รันโดเมน contracts ก่อน)');
      return stat;
    }
    for (const r of ROWS) {
      const planNumber = `${TEST_DOC_PREFIX}SP-${ctx.dateStr}-${r.key}`;
      // จำนวนงวด ไม่ใช่จำนวนเงิน — Math.round ตรงนี้ถูกต้อง ไม่เข้าข้อห้าม Decimal
      const installments = Math.round(r.saved / r.monthly);
      const startedAt = new Date(ctx.today.getTime() - installments * 30 * DAY);
      const paymentRows = Array.from({ length: installments }, (_, i) => ({
        amount: new Prisma.Decimal(r.monthly),
        paidAt: new Date(ctx.today.getTime() - (installments - i) * 30 * DAY),
        paymentMethod: 'CASH',
      }));

      // planNumber เป็น @unique เต็มตาราง (ไม่ใช่ partial) — แถวที่ cleanup soft delete
      // ไปแล้วยังถือเลขอยู่ ⇒ probe โดยไม่กรอง deletedAt แล้ว "กู้คืน" แทนการสร้างซ้ำ
      // (รีเซ็ตยอด/สถานะกลับค่าตั้งต้น เพราะ QR ระหว่างเทสอาจขยับ totalSaved ไปแล้ว)
      // รายการรับเงินออมของแถวเดิมถูกลบถาวรตอน cleanup (ไม่มี deletedAt) จึงต้องสร้างชุดใหม่
      const any = await ctx.prisma.savingPlan.findUnique({
        where: { planNumber },
        select: { id: true, deletedAt: true },
      });
      if (any && !any.deletedAt) {
        stat.skipped += 1;
        continue;
      }
      if (any) {
        await ctx.prisma.$transaction(async (tx) => {
          await tx.savingPlan.update({
            where: { id: any.id },
            data: {
              deletedAt: null,
              customerId: customer.id,
              status: r.status,
              targetAmount: new Prisma.Decimal(r.target),
              monthlyAmount: new Prisma.Decimal(r.monthly),
              durationMonths: r.months,
              totalSaved: new Prisma.Decimal(r.saved),
              startedAt,
              nextPaymentDueAt:
                r.status === 'ACTIVE' ? new Date(ctx.today.getTime() + 7 * DAY) : null,
              completedAt: r.status === 'COMPLETED' ? ctx.today : null,
              cancelledAt: null,
              // สถานะถูกรีเซ็ตกลับ ACTIVE/COMPLETED — ล้างลิงก์สัญญาที่ค้างไว้ให้สอดคล้อง
              // (วันนี้ยังไม่มีโค้ดฝั่งไหนตั้ง APPLIED — กันไว้เผื่อฟีเจอร์มาทีหลัง)
              appliedToContractId: null,
            },
          });
          await tx.savingPlanPayment.createMany({
            data: paymentRows.map((p) => ({ ...p, savingPlanId: any.id })),
          });
        });
        stat.skipped += 1;
        stat.notes.push(
          `กู้คืนแผนออม ${planNumber} ที่เคยถูกล้าง + สร้างรายการรับเงินออมใหม่ ${installments} รายการ ` +
            '(เลขแผนเป็น unique เต็มตาราง — แถวกู้คืนนับเป็น skipped ไม่ใช่ created)',
        );
        continue;
      }
      await ctx.prisma.savingPlan.create({
        data: {
          planNumber,
          customerId: customer.id,
          targetProductModel: 'ทดสอบระบบ รุ่นเป้าหมาย',
          targetAmount: new Prisma.Decimal(r.target),
          monthlyAmount: new Prisma.Decimal(r.monthly),
          durationMonths: r.months,
          totalSaved: new Prisma.Decimal(r.saved),
          status: r.status,
          startedAt,
          nextPaymentDueAt: r.status === 'ACTIVE' ? new Date(ctx.today.getTime() + 7 * DAY) : null,
          completedAt: r.status === 'COMPLETED' ? ctx.today : null,
          payments: { create: paymentRows },
        },
      });
      stat.created += 1;
    }
    return stat;
  },

  async cleanup(ctx: SeedContext, dryRun: boolean): Promise<CleanupStat> {
    const rows = await ctx.prisma.savingPlan.findMany({
      where: { planNumber: { startsWith: `${TEST_DOC_PREFIX}SP-` }, deletedAt: null },
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
