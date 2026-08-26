import { TEST_DOC_PREFIX, testNote } from './_context';
import { TEST_CUSTOMER_ADDRESS } from '../seed-test-contracts.cli';
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

/**
 * marker ของใบตรวจเครดิตทดสอบ — CreditCheck ไม่มีคอลัมน์ unique ที่ seeder ตั้งเอง
 * (contractId เป็น @unique แต่จงใจปล่อย null) จึงใช้ข้อความใน reviewNotes เป็นตัวชี้
 * ทั้ง probe กันซ้ำและ cleanup (precedent เดียวกับ suppliers-po ที่ probe ด้วย notes)
 */
const CC_REVIEW_NOTE = testNote('ใบตรวจเครดิตรอตรวจ — สร้างโดยชุดข้อมูลทดสอบ');

export const applicationsSeeder: DomainSeeder = {
  key: 'applications',
  label: 'ใบสมัครผ่อนออนไลน์ + ตรวจเครดิต',
  routes: ['/installment-applications', '/customer-intake'],
  markerDoc: `OnlineInstallmentApplication.applicationNumber ขึ้นต้น "${TEST_DOC_PREFIX}" · CreditCheck.reviewNotes = "${CC_REVIEW_NOTE}"`,

  async plan(): Promise<PlanRow[]> {
    return [
      ...ROWS.map((r) => ({
        label: `${TEST_DOC_PREFIX}APP ${r.key}`,
        detail: `${r.fullName} · ดาวน์ ฿${r.down.toLocaleString('th-TH')} · ${r.months} งวด × ฿${r.monthly.toLocaleString('th-TH')}`,
      })),
      {
        label: 'CreditCheck pending',
        detail: 'ใบตรวจเครดิต PENDING ×1 — แนบลูกค้าทดสอบ ไม่ผูกสัญญา (contractId เป็น @unique)',
      },
    ];
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
        // กู้คืนแล้ว reset กลับสภาพเริ่มต้นที่ seed ไว้ — tester อาจทิ้งสถานะ APPROVED +
        // contractId ที่ชี้สัญญาซึ่งโดเมน contracts ล้างไปแล้ว (ลิงก์ตาย); เคลียร์ผลตรวจ
        // ทั้งชุดให้ใบสมัครที่กู้คืนมาสดจริงเหมือนแถวที่เพิ่งสร้าง
        await ctx.prisma.onlineInstallmentApplication.update({
          where: { id: exists.id },
          data: {
            deletedAt: null,
            status: 'SUBMITTED',
            contractId: null,
            scheduledAt: null,
            reviewedAt: null,
            reviewedById: null,
            rejectReason: null,
          },
        });
        stat.skipped += 1;
        stat.notes.push(
          `กู้คืน ${applicationNumber} ที่เคยถูกล้าง (reset เป็น SUBMITTED · แถวกู้คืนนับเป็น skipped ไม่ใช่ created)`,
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

    // CreditCheck ×1 สถานะ PENDING (aiScore/aiSummary ปล่อย null แบบ cc-007 ใน dev seed) —
    // ให้หน้า /customer-intake มีรายการที่ยังมีงานต่อ. contractId จงใจปล่อย null:
    // คอลัมน์เป็น @unique — ผูกสัญญาทดสอบ = เผา slot ตรวจเครดิตของสัญญานั้น + เสี่ยง P2002
    const testCustomer = await ctx.prisma.customer.findFirst({
      where: { addressCurrent: TEST_CUSTOMER_ADDRESS, deletedAt: null },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    });
    if (!testCustomer) {
      stat.notes.push('ข้าม CreditCheck — ยังไม่มีลูกค้าทดสอบ (รันโดเมน contracts ก่อน)');
      return stat;
    }
    const ccExists = await ctx.prisma.creditCheck.findFirst({
      where: { reviewNotes: CC_REVIEW_NOTE, deletedAt: null },
      select: { id: true },
    });
    if (ccExists) {
      stat.skipped += 1;
    } else {
      await ctx.prisma.creditCheck.create({
        data: {
          customerId: testCustomer.id,
          status: 'PENDING',
          reviewNotes: CC_REVIEW_NOTE,
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
    const ccRows = await ctx.prisma.creditCheck.findMany({
      where: { reviewNotes: CC_REVIEW_NOTE, deletedAt: null },
      select: { id: true },
    });
    if (!dryRun && ccRows.length) {
      // CreditCheck มี deletedAt ⇒ soft delete
      await ctx.prisma.creditCheck.updateMany({
        where: { id: { in: ccRows.map((r) => r.id) } },
        data: { deletedAt: new Date() },
      });
    }
    return {
      removed: { ใบสมัครผ่อนออนไลน์: rows.length, ใบตรวจเครดิต: ccRows.length },
      warnings: [],
    };
  },
};
