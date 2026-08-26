import { TEST_DOC_PREFIX, testNote } from './_context';
import { nextNumberFrom } from './_helpers';
import type { CleanupStat, DomainSeeder, PlanRow, SeedContext, SeedStat } from './_types';

const DAY = 24 * 60 * 60 * 1000;

/**
 * prefix จริงของเลขใบจองทดสอบ — ค่าคงที่เดียวใช้ทั้ง `markerDoc` (ที่ README generate ไป
 * บอก operator) และ query ของ seed/cleanup ⇒ เอกสารกับโค้ด drift กันไม่ได้อีก (S1, 2026-08-26)
 */
const BOOKING_NO_PREFIX = `${TEST_DOC_PREFIX}BK-`;

/** R2 — PENDING_DEPOSIT เท่านั้น · ใบที่สองเลยกำหนดเพื่อทดสอบ cron ตัดใบจองหมดอายุ */
const ROWS: Array<{
  key: string;
  deposit: number;
  total: number;
  expiresInDays: number;
  note: string;
}> = [
  { key: 'normal', deposit: 2000, total: 25900, expiresInDays: 5, note: 'ใบจองปกติ รอรับมัดจำ' },
  {
    key: 'expired',
    deposit: 1000,
    total: 9900,
    expiresInDays: -3,
    note: 'ใบจองเลยวันหมดอายุ — รอ cron ตัดเป็น EXPIRED',
  },
];

export const bookingsSeeder: DomainSeeder = {
  key: 'bookings',
  label: 'ใบจอง',
  routes: ['/bookings'],
  markerDoc: `Booking.bookingNumber ขึ้นต้น "${BOOKING_NO_PREFIX}"`,

  async plan(): Promise<PlanRow[]> {
    return ROWS.map((r) => ({
      label: `${TEST_DOC_PREFIX}BK ${r.key}`,
      detail: `PENDING_DEPOSIT · มัดจำ ฿${r.deposit.toLocaleString('th-TH')} / รวม ฿${r.total.toLocaleString('th-TH')} · ${r.note}`,
    }));
  },

  async seed(ctx: SeedContext): Promise<SeedStat> {
    const stat: SeedStat = { created: 0, skipped: 0, notes: [] };
    const customer = await ctx.prisma.customer.findFirst({
      where: { name: { startsWith: 'ทดสอบระบบ ลูกค้าใหม่' }, deletedAt: null },
      select: { id: true },
    });
    if (!customer) {
      stat.notes.push('ข้ามทั้งโดเมน — ยังไม่มีลูกค้าทดสอบ (รันโดเมน contracts ก่อน)');
      return stat;
    }

    const prefix = `${BOOKING_NO_PREFIX}${ctx.dateStr}-`;
    for (const r of ROWS) {
      // idempotency probe ที่ notes (marker) — ไม่ใช่ที่เลขเอกสาร: bookingNumber เป็น @unique
      // เต็มตาราง (ไม่ใช่ partial) แถวที่ cleanup soft delete ไปแล้วยังถือเลขอยู่
      // (doctrine เดียวกับ suppliers-po / stock-ops)
      const notes = testNote(r.note);
      const exists = await ctx.prisma.booking.findFirst({
        where: { notes, deletedAt: null },
        select: { id: true },
      });
      if (exists) {
        stat.skipped += 1;
        continue;
      }
      // จองเลขแบบ max+1 โดย "ไม่กรอง deletedAt" — seed → cleanup → seed จึงไม่ชน P2002
      const last = await ctx.prisma.booking.findFirst({
        where: { bookingNumber: { startsWith: prefix } },
        orderBy: { bookingNumber: 'desc' },
        select: { bookingNumber: true },
      });
      await ctx.prisma.booking.create({
        data: {
          bookingNumber: nextNumberFrom(prefix, last?.bookingNumber ?? null),
          customerId: customer.id,
          branchId: ctx.refs.branchId,
          status: 'PENDING_DEPOSIT',
          depositAmount: r.deposit,
          totalAmount: r.total,
          expireDate: new Date(ctx.today.getTime() + r.expiresInDays * DAY),
          notes,
          createdById: ctx.refs.salespersonId,
          // BookingItem.productId เป็น optional — จงใจไม่ผูกเครื่อง (การแปลงเป็นใบขาย
          // ต้องผูกเครื่องก่อน ซึ่งเป็นขั้นตอนที่ผู้ทดสอบทำเองผ่าน UI)
          items: {
            create: [
              { description: 'ทดสอบระบบ สินค้าที่จอง', unitPrice: r.total, amount: r.total },
            ],
          },
        },
      });
      stat.created += 1;
    }
    return stat;
  },

  async cleanup(ctx: SeedContext, dryRun: boolean): Promise<CleanupStat> {
    const rows = await ctx.prisma.booking.findMany({
      where: { bookingNumber: { startsWith: BOOKING_NO_PREFIX }, deletedAt: null },
      select: { id: true, bookingNumber: true, convertedToSaleId: true },
    });
    for (const r of rows)
      console.log(`     ${r.bookingNumber}${r.convertedToSaleId ? ' ⚠️ แปลงเป็นใบขายแล้ว' : ''}`);

    // JE ของใบจอง (รับมัดจำ / ล้างมัดจำเข้าการขาย / ริบ / คืน) stamp metadata.bookingId
    // ทั้ง 4 เทมเพลต (shop-booking-*.template.ts) — ไม่มี FK บนตาราง จึงตามด้วย JSON path
    const jes = rows.length
      ? await ctx.prisma.journalEntry.findMany({
          where: {
            OR: rows.map((r) => ({ metadata: { path: ['bookingId'], equals: r.id } as never })),
          },
          select: { id: true, entryNumber: true },
        })
      : [];
    // เลข JE คือหลักฐานบัญชี และ query เป็น JSON path — พิมพ์ให้คนกดเห็นก่อนลบถาวรเสมอ
    // ทั้ง dry-run และ live (M1, 2026-08-26)
    for (const j of jes) console.log(`     รายการบัญชีมัดจำใบจอง ${j.entryNumber} (ลบถาวร)`);

    if (!dryRun && rows.length) {
      await ctx.prisma.$transaction(async (tx) => {
        if (jes.length) {
          const jeIds = jes.map((j) => j.id);
          // ลำดับเดียวกับ cleanup-test-contracts: audit log (FK Restrict) → lines → entries
          await tx.journalPostAuditLog.deleteMany({ where: { journalEntryId: { in: jeIds } } });
          await tx.journalLine.deleteMany({ where: { journalEntryId: { in: jeIds } } });
          await tx.journalEntry.deleteMany({ where: { id: { in: jeIds } } });
        }
        // BookingItem ไม่มี deletedAt ⇒ hard delete; ตัวใบจองมี deletedAt ⇒ soft delete
        await tx.bookingItem.deleteMany({ where: { bookingId: { in: rows.map((r) => r.id) } } });
        await tx.booking.updateMany({
          where: { id: { in: rows.map((r) => r.id) } },
          data: { deletedAt: new Date() },
        });
      });
    }
    return {
      removed: { ใบจอง: rows.length, 'รายการบัญชีมัดจำใบจอง (ลบถาวร)': jes.length },
      warnings: rows.some((r) => r.convertedToSaleId)
        ? [
            'มีใบจองที่ถูกแปลงเป็นใบขายแล้ว — ยกเลิกใบขายนั้นก่อนล้าง ไม่งั้นใบขายจะชี้ไปใบจองที่ถูกลบ',
          ]
        : [],
    };
  },
};
