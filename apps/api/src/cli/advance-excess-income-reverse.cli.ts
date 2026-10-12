/**
 * advance-excess:reverse — กลับรายการรอบกวาดเงินพักส่วนเกิน (42-1106) ของสัญญาแบบกระจก (PR4 final review I2)
 *
 *   EXPECTED_DB_NAME=<db> npm --prefix apps/api run advance-excess:reverse -- --contract <เลขสัญญา|id> --reason "<≥10 ตัวอักษร>"
 *
 * ไม่ตั้ง CONFIRM_REVERSE=YES_I_AM_SURE = dry-run (แสดงรายการที่จะกลับ ไม่เขียนอะไร). ด่าน EXPECTED_DB_NAME ต้องตรง
 * `current_database()` (pattern wipe-accounting C7). ใช้ `AdvanceExcessIncomeTemplate.reverse` ตัวเดียวกับที่เทสปัก —
 * ห้ามใช้ `JournalService.void` กับรายการ flow นี้ (ตั้ง VOIDED + รายการกลับไม่มี metadata ⇒ GL เพี้ยน · กวาดซ้ำไม่ได้).
 * หลังกลับ: 21-1103 ของสัญญากลับมาค้าง · คอลัมน์ถังคืนค่าเดิม · รอบกวาดคืนถัดไปจะลงใหม่ (key :n) เว้นแต่จะยกเลิกใบเสร็จ/
 * คืนเงินให้ยอดหมดก่อน.
 */
import { PrismaClient } from '@prisma/client';
import { JournalAutoService } from '../modules/journal/journal-auto.service';
import { CompanyResolverService } from '../modules/journal/company-resolver.service';
import { AdvanceExcessIncomeTemplate } from '../modules/journal/cpa-templates/advance-excess-income.template';
import { findActiveAdvanceExcessIncome } from '../modules/journal/advance-excess-income.util';
import { parseReverseArgs } from './advance-excess-income-reverse.args';

const CONSENT = 'YES_I_AM_SURE';

async function main() {
  const { contract, reason } = parseReverseArgs(process.argv.slice(2));
  const expectedDb = process.env.EXPECTED_DB_NAME;
  if (!expectedDb) {
    console.error(
      'ERROR: ต้องตั้ง EXPECTED_DB_NAME=<ชื่อฐานข้อมูล> (ต้องตรงกับ current_database())',
    );
    process.exit(1);
  }
  const prisma = new PrismaClient();
  try {
    const [{ current_database: actualDb }] = await prisma.$queryRaw<
      { current_database: string }[]
    >`SELECT current_database()`;
    if (actualDb !== expectedDb) {
      console.error(
        `ERROR: เชื่อมต่อฐาน "${actualDb}" แต่ EXPECTED_DB_NAME="${expectedDb}" — ไม่ทำอะไร`,
      );
      process.exit(1);
    }
    const row = await prisma.contract.findFirst({
      where: { OR: [{ id: contract }, { contractNumber: contract }], deletedAt: null },
      select: { id: true, contractNumber: true, status: true },
    });
    if (!row) {
      console.error(`ERROR: ไม่พบสัญญา "${contract}"`);
      process.exit(1);
    }
    const [active] = await findActiveAdvanceExcessIncome(prisma, row.id);
    if (!active) {
      console.log(
        `สัญญา ${row.contractNumber}: ไม่มีรายการกวาดเงินพักส่วนเกินที่มีผล — ไม่มีอะไรต้องกลับ`,
      );
      return;
    }
    const meta = (active.metadata ?? {}) as Record<string, unknown>;
    console.log(
      `สัญญา ${row.contractNumber} (${row.status}) · รายการที่จะกลับ ${active.entryNumber} · ยอด ${String(meta.amount)} ` +
        `(รายได้ 42-1106 ${String(meta.income)} · ภาษี 21-2102 ${String(meta.vat)}) · เหตุผล: ${reason}`,
    );
    if (process.env.CONFIRM_REVERSE !== CONSENT) {
      console.log(`DRY-RUN — ไม่เขียนอะไร · ตั้ง CONFIRM_REVERSE=${CONSENT} เพื่อกลับรายการจริง`);
      return;
    }
    const actor = await prisma.user.findFirst({
      where: { isSystemUser: true, deletedAt: null },
      select: { id: true },
    });
    const journal = new JournalAutoService(prisma as never);
    const template = new AdvanceExcessIncomeTemplate(
      journal,
      prisma as never,
      new CompanyResolverService(prisma as never),
    );
    const result = await template.reverse(row.id, { reason, actorUserId: actor?.id ?? null });
    console.log(
      JSON.stringify(
        result,
        (_k, v) => (typeof v === 'object' && v !== null && 'toFixed' in v ? String(v) : v),
        2,
      ),
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
