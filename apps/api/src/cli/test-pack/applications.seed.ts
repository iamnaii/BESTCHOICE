import { TEST_DOC_PREFIX } from './_context';
import type { CleanupStat, DomainSeeder, PlanRow, SeedContext, SeedStat } from './_types';

/** ไม่โพสต์ JE — seed สถานะไหนก็ได้ */
const ROWS: Array<{
  key: string;
  fullName: string;
  down: number;
  months: number;
  monthly: number;
}> = [
  { key: 'new', fullName: 'ทดสอบระบบ ผู้สมัครผ่อน 1', down: 3000, months: 10, monthly: 2590 },
  { key: 'review', fullName: 'ทดสอบระบบ ผู้สมัครผ่อน 2', down: 5000, months: 12, monthly: 1890 },
];

export const applicationsSeeder: DomainSeeder = {
  key: 'applications',
  label: 'ใบสมัครผ่อนออนไลน์ + ตรวจเครดิต',
  routes: ['/installment-applications', '/customer-intake'],
  markerDoc: `OnlineInstallmentApplication.applicationNumber ขึ้นต้น "${TEST_DOC_PREFIX}"`,

  async plan(): Promise<PlanRow[]> {
    return ROWS.map((r) => ({
      label: `${TEST_DOC_PREFIX}APP ${r.key}`,
      detail: `${r.fullName} · ดาวน์ ฿${r.down.toLocaleString('th-TH')} · ${r.months} งวด × ฿${r.monthly.toLocaleString('th-TH')}`,
    }));
  },

  async seed(ctx: SeedContext): Promise<SeedStat> {
    const stat: SeedStat = { created: 0, skipped: 0, notes: [] };
    const products = await ctx.prisma.product.findMany({
      where: { imeiSerial: { startsWith: 'TEST-' }, deletedAt: null },
      select: { id: true },
      take: 1,
    });
    if (!products.length) {
      stat.notes.push('ข้ามทั้งโดเมน — ยังไม่มีเครื่องทดสอบ (รันโดเมน contracts ก่อน)');
      return stat;
    }
    for (const [i, r] of ROWS.entries()) {
      const applicationNumber = `${TEST_DOC_PREFIX}APP-${ctx.dateStr}-${r.key}`;
      // applicationNumber เป็น @unique เต็มตาราง — probe โดยไม่กรอง deletedAt แล้วกู้คืน
      // แถวที่เคยถูกล้าง (restore-instead-of-recreate) กัน P2002 หลัง seed → cleanup → seed
      const exists = await ctx.prisma.onlineInstallmentApplication.findFirst({
        where: { applicationNumber },
        select: { id: true, deletedAt: true },
      });
      if (exists && !exists.deletedAt) {
        stat.skipped += 1;
        continue;
      }
      if (exists) {
        await ctx.prisma.onlineInstallmentApplication.update({
          where: { id: exists.id },
          data: { deletedAt: null },
        });
        stat.skipped += 1;
        stat.notes.push(
          `กู้คืน ${applicationNumber} ที่เคยถูกล้าง (แถวกู้คืนนับเป็น skipped ไม่ใช่ created)`,
        );
        continue;
      }
      await ctx.prisma.onlineInstallmentApplication.create({
        data: {
          applicationNumber,
          productId: products[0].id,
          fullName: r.fullName,
          phone: `0891000${String(i + 1).padStart(3, '0')}`,
          nationalId: `0000000000${String(i + 1).padStart(3, '0')}`,
          proposedDownPayment: r.down,
          proposedTotalMonths: r.months,
          proposedMonthlyPayment: r.monthly,
        },
      });
      stat.created += 1;
    }
    return stat;
  },

  async cleanup(ctx: SeedContext, dryRun: boolean): Promise<CleanupStat> {
    const rows = await ctx.prisma.onlineInstallmentApplication.findMany({
      where: { applicationNumber: { startsWith: `${TEST_DOC_PREFIX}APP-` }, deletedAt: null },
      select: { id: true, applicationNumber: true },
    });
    for (const r of rows) console.log(`     ${r.applicationNumber}`);
    if (!dryRun && rows.length) {
      // มี deletedAt ⇒ soft delete
      await ctx.prisma.onlineInstallmentApplication.updateMany({
        where: { id: { in: rows.map((r) => r.id) } },
        data: { deletedAt: new Date() },
      });
    }
    return { removed: { ใบสมัครผ่อนออนไลน์: rows.length }, warnings: [] };
  },
};
