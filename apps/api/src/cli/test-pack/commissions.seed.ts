import { Prisma } from '@prisma/client';

import { TEST_DOC_PREFIX, testNote } from './_context';
import { round2 } from './_helpers';
import type { CleanupStat, DomainSeeder, PlanRow, SeedContext, SeedStat } from './_types';

/** ค่าคอม = ยอดขาย × อัตรา — Decimal ล้วน (Global Constraint: ห้าม float กับจำนวนเงิน) */
const commissionOf = (saleAmount: number, rate: number): Prisma.Decimal =>
  round2(new Prisma.Decimal(saleAmount).mul(rate));

/**
 * ไม่โพสต์ JE — ครอบ 3 สถานะให้หน้า /commissions มีของให้กด: PENDING → ปุ่มอนุมัติ
 * (SoD: ผู้อนุมัติ ≠ ผู้รับคอม), APPROVED → ปุ่มจ่าย, PAID → แถวจบวงจร
 * หมายเหตุ: แถวพวกนี้ **ไม่มี saleId** จึงไม่เกี่ยวกับด่านยกเลิกใบขาย (G4/G4b) —
 * ค่าคอมที่ผูกใบขายจริงเกิดจากการขายเครื่องทดสอบผ่าน POS และถูกกวาดโดยโดเมน contracts
 */
const ROWS: Array<{
  key: string;
  status: 'PENDING' | 'APPROVED' | 'PAID';
  saleAmount: number;
  rate: number;
}> = [
  { key: 'pending', status: 'PENDING', saleAmount: 25900, rate: 0.02 },
  { key: 'approved', status: 'APPROVED', saleAmount: 34900, rate: 0.02 },
  { key: 'paid', status: 'PAID', saleAmount: 18900, rate: 0.03 },
];

const periodOf = (today: Date) =>
  `${today.getUTCFullYear()}-${String(today.getUTCMonth() + 1).padStart(2, '0')}`;

/**
 * marker ของโดเมนนี้อยู่ที่คอลัมน์ `period` (String อิสระรูป "YYYY-MM") — ใส่ TEST- นำหน้า
 * แยกจากงวดจ่ายจริงเด็ดขาด และ `generatePayouts` ของจริง validate `^\d{4}-\d{2}$`
 * จึงไม่มีวันหยิบงวด TEST- ไปรวมรอบจ่ายจริงได้เลย (commission.service.ts)
 * `notes` ใส่ marker ซ้ำไว้ให้คนอ่านบนหน้าจอ แต่ตัวค้นจริงของ cleanup คือ period
 */
export const commissionsSeeder: DomainSeeder = {
  key: 'commissions',
  label: 'ค่าคอมมิชชั่น',
  routes: ['/commissions'],
  markerDoc: `SalesCommission.period และ CommissionPayout.period ขึ้นต้น "${TEST_DOC_PREFIX}" (เช่น TEST-2026-08 — period เป็น String อิสระ จึงแยกจากงวดจ่ายจริงเด็ดขาด และ generatePayouts ของจริงรับเฉพาะ YYYY-MM จึงมองไม่เห็นงวดทดสอบ)`,

  async plan(ctx: SeedContext): Promise<PlanRow[]> {
    const period = `${TEST_DOC_PREFIX}${periodOf(ctx.today)}`;
    const rows: PlanRow[] = ROWS.map((r) => ({
      label: `ค่าคอม ${r.key}`,
      detail: `${r.status} · ยอดขาย ฿${r.saleAmount.toLocaleString('th-TH')} × ${(r.rate * 100).toFixed(0)}% = ฿${commissionOf(r.saleAmount, r.rate).toNumber().toLocaleString('th-TH')} · งวด ${period}`,
    }));
    rows.push({
      label: 'รอบจ่ายค่าคอม',
      detail: `DRAFT 1 ใบ · งวด ${period} (ทดสอบอนุมัติ/จ่ายรอบ)`,
    });
    return rows;
  },

  async seed(ctx: SeedContext): Promise<SeedStat> {
    const stat: SeedStat = { created: 0, skipped: 0, notes: [] };
    const period = `${TEST_DOC_PREFIX}${periodOf(ctx.today)}`;
    for (const r of ROWS) {
      const amount = commissionOf(r.saleAmount, r.rate);
      const exists = await ctx.prisma.salesCommission.findFirst({
        where: {
          period,
          salespersonId: ctx.refs.salespersonId,
          commissionAmount: amount,
          deletedAt: null,
        },
        select: { id: true },
      });
      if (exists) {
        stat.skipped += 1;
        continue;
      }
      await ctx.prisma.salesCommission.create({
        data: {
          salespersonId: ctx.refs.salespersonId,
          // T4-C10: รายงานรอบจ่ายอ่าน snapshot ไม่ใช่ salespersonId — ตั้งให้ครบเหมือนของจริง
          snapshotSalespersonId: ctx.refs.salespersonId,
          period,
          saleAmount: new Prisma.Decimal(r.saleAmount),
          commissionRate: new Prisma.Decimal(r.rate),
          commissionAmount: amount,
          status: r.status,
          // สถานะต้องเล่าเรื่องเดียวกับ timestamp — APPROVED/PAID มีผู้อนุมัติ, PAID มีวันจ่าย
          ...(r.status !== 'PENDING'
            ? { approvedById: ctx.refs.ownerId, approvedAt: ctx.today }
            : {}),
          ...(r.status === 'PAID' ? { paidAt: ctx.today, paidAmount: amount } : {}),
          notes: testNote(`ค่าคอมสำหรับทดสอบ/${r.key}`),
        },
      });
      stat.created += 1;
    }

    // รอบจ่ายร่าง 1 ใบ — ให้แท็บรอบจ่ายมีของให้กดอนุมัติ → จ่าย (approvePayout/markPayoutPaid)
    // @@unique([salespersonId, period]) เป็น unique เต็มตาราง (ไม่ใช่ partial) — แถวที่
    // cleanup soft delete ไปแล้วยังถือ tuple อยู่ ⇒ probe โดยไม่กรอง deletedAt แล้ว
    // "กู้คืน + คำนวณยอดใหม่" แทนการสร้างซ้ำ (mirror ขา update ของ generatePayouts เป๊ะ
    // รวมการ reset วงจรอนุมัติกลับ DRAFT) ไม่งั้น seed หลัง cleanup เดือนเดียวกันชน P2002
    const totalSales = ROWS.reduce((a, r) => a.plus(r.saleAmount), new Prisma.Decimal(0));
    const totalCommission = ROWS.reduce(
      (a, r) => a.plus(commissionOf(r.saleAmount, r.rate)),
      new Prisma.Decimal(0),
    );
    const payoutAny = await ctx.prisma.commissionPayout.findUnique({
      where: {
        salespersonId_period: { salespersonId: ctx.refs.salespersonId, period },
      },
      select: { id: true, deletedAt: true },
    });
    if (payoutAny && !payoutAny.deletedAt) {
      stat.skipped += 1;
    } else if (payoutAny) {
      await ctx.prisma.commissionPayout.update({
        where: { id: payoutAny.id },
        data: {
          deletedAt: null,
          totalSales,
          totalCommission,
          commissionCount: ROWS.length,
          status: 'DRAFT',
          approvedById: null,
          approvedAt: null,
          paidById: null,
          paidAt: null,
          generatedAt: new Date(),
          notes: testNote('รอบจ่ายค่าคอมสำหรับทดสอบ'),
        },
      });
      stat.skipped += 1;
      stat.notes.push(
        'กู้คืนรอบจ่ายค่าคอม 1 ใบที่เคยถูกล้าง (unique ต่อ พนักงาน+งวด กันสร้างแถวใหม่ซ้ำ — แถวกู้คืนนับเป็น skipped ไม่ใช่ created)',
      );
    } else {
      await ctx.prisma.commissionPayout.create({
        data: {
          salespersonId: ctx.refs.salespersonId,
          period,
          totalSales,
          totalCommission,
          commissionCount: ROWS.length,
          status: 'DRAFT',
          generatedAt: new Date(),
          notes: testNote('รอบจ่ายค่าคอมสำหรับทดสอบ'),
        },
      });
      stat.created += 1;
    }
    return stat;
  },

  async cleanup(ctx: SeedContext, dryRun: boolean): Promise<CleanupStat> {
    const period = { startsWith: TEST_DOC_PREFIX } as const;
    const [commissions, payouts] = await Promise.all([
      ctx.prisma.salesCommission.findMany({
        where: { period, deletedAt: null },
        select: { id: true },
      }),
      ctx.prisma.commissionPayout.findMany({
        where: { period, deletedAt: null },
        select: { id: true },
      }),
    ]);
    if (!dryRun) {
      const now = new Date();
      await ctx.prisma.$transaction(async (tx) => {
        if (commissions.length)
          await tx.salesCommission.updateMany({
            where: { id: { in: commissions.map((c) => c.id) } },
            data: { deletedAt: now },
          });
        if (payouts.length)
          await tx.commissionPayout.updateMany({
            where: { id: { in: payouts.map((p) => p.id) } },
            data: { deletedAt: now },
          });
      });
    }
    return {
      removed: { ค่าคอม: commissions.length, รอบจ่ายค่าคอม: payouts.length },
      warnings: [],
    };
  },
};
