import { TEST_DOC_PREFIX, testNote } from './_context';
import { TEST_CUSTOMER_ADDRESS } from '../seed-test-contracts.cli';
import type { CleanupStat, DomainSeeder, PlanRow, SeedContext, SeedStat } from './_types';

/**
 * marker ของใบตรวจเครดิตทดสอบ — CreditCheck ไม่มีคอลัมน์ unique ที่ seeder ตั้งเอง
 * (contractId เป็น @unique แต่จงใจปล่อย null) จึงใช้ข้อความใน reviewNotes เป็นตัวชี้
 * ทั้ง probe กันซ้ำและ cleanup (precedent เดียวกับ suppliers-po ที่ probe ด้วย notes)
 */
const CC_REVIEW_NOTE = testNote('ใบตรวจเครดิตรอตรวจ — สร้างโดยชุดข้อมูลทดสอบ');

/**
 * prefix จริงของเลขใบสมัครทดสอบ — ค่าคงที่เดียวใช้ทั้ง `markerDoc` และ query ของ
 * cleanup ⇒ เอกสารกับโค้ด drift กันไม่ได้อีก (S1, 2026-08-26)
 */
const APP_NO_PREFIX = `${TEST_DOC_PREFIX}APP-`;

/**
 * ใบสมัครผ่อนออนไลน์ถูกถอด 2026-09-28 (หน้า /installment-applications, หน้าสมัครบนเว็บลูกค้า
 * และ API) โดเมนนี้จึง **ไม่ seed ใบสมัครอีก** เหลือ seed ใบตรวจเครดิต (หน้า /credit-checks
 * ยังใช้อยู่) ส่วน cleanup ยังล้างใบสมัครทดสอบที่ seed ไปก่อนหน้าให้
 * key คง `applications` ไว้ให้ `DOMAINS=applications` ของเดิมยังใช้ได้
 */
export const applicationsSeeder: DomainSeeder = {
  key: 'applications',
  label: 'ตรวจเครดิต (+ ล้างใบสมัครผ่อนออนไลน์ที่ถอดแล้ว)',
  routes: ['/credit-checks'],
  markerDoc: `CreditCheck.reviewNotes = "${CC_REVIEW_NOTE}" · OnlineInstallmentApplication.applicationNumber ขึ้นต้น "${APP_NO_PREFIX}" (ล้างอย่างเดียว)`,

  async plan(): Promise<PlanRow[]> {
    return [
      {
        label: 'CreditCheck pending',
        detail: 'ใบตรวจเครดิต PENDING ×1 — แนบลูกค้าทดสอบ ไม่ผูกสัญญา (contractId เป็น @unique)',
      },
    ];
  },

  async seed(ctx: SeedContext): Promise<SeedStat> {
    const stat: SeedStat = { created: 0, skipped: 0, notes: [] };

    // CreditCheck ×1 สถานะ PENDING (aiScore/aiSummary ปล่อย null แบบ cc-007 ใน dev seed) —
    // ให้หน้า /credit-checks มีรายการที่ยังมีงานต่อ. contractId จงใจปล่อย null:
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
      where: { applicationNumber: { startsWith: APP_NO_PREFIX }, deletedAt: null },
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
