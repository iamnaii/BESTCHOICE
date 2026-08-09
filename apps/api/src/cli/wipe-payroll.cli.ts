/**
 * Wipe Payroll CLI — คำสั่งเจ้าของ 2026-08-06 ข้อ 3:
 * "ที่เคยมีบันทึกไว้ เรื่องเงินเดือน ล้างออก"
 *
 * ใบเงินเดือนเก่าทั้งหมดถูกบันทึกด้วยผังบัญชีผิดฝั่ง (FINANCE codes ใต้ SHOP
 * companyId — บั๊ก B2) และ OT ผิดบัญชี (53-1105 ค่าอบรม — บั๊ก B1). ระบบใหม่แยก
 * SHOP/FINANCE scope แล้ว — ล้างของเก่าออกให้บันทึกใหม่ด้วยผังที่ถูกต้อง.
 *
 * DESTRUCTIVE — hard-deletes:
 *   1. Journal entries whose metadata.flow ∈ ('expense-payroll',
 *      'expense-payroll-void') + their journal_lines
 *      (รวม JE ที่อ้างโดย ExpenseDocument.journalEntryId ของเอกสาร PAYROLL)
 *   2. Every ExpenseDocument with documentType='PAYROLL' (any status, incl.
 *      soft-deleted) — cascades PayrollDetail → PayrollLine → custom rows
 *   3. TaxReport rows reportType='PND1' still in DRAFT (snapshots of the old
 *      wrong data — regenerable any time). SUBMITTED filings are kept.
 *
 * AuditLog rows are kept (immutable by design — retention cron owns them).
 *
 * Guards (same shape as wipe-accounting.cli.ts / C7 hardening):
 *   CONFIRM_WIPE=YES_I_AM_SURE            — basic consent
 *   EXPECTED_DB_NAME=<db>                 — must match current_database()
 *   NODE_ENV=production → ALLOW_PROD_WIPE=YES_I_AM_SURE
 *   DRY_RUN=1                             — print counts only, delete nothing
 *   5-second Ctrl+C cooldown
 *
 * Usage:
 *   DRY_RUN=1 CONFIRM_WIPE=YES_I_AM_SURE EXPECTED_DB_NAME=bestchoice npm --prefix apps/api run wipe:payroll
 *   CONFIRM_WIPE=YES_I_AM_SURE EXPECTED_DB_NAME=bestchoice npm --prefix apps/api run wipe:payroll
 */
import { PrismaClient, Prisma } from '@prisma/client';

const REQUIRED_CONSENT = 'YES_I_AM_SURE';

async function main(): Promise<void> {
  const dryRun = process.env.DRY_RUN === '1' || process.env.DRY_RUN === 'true';

  if (process.env.CONFIRM_WIPE !== REQUIRED_CONSENT) {
    console.error(`ERROR: Refusing to run without CONFIRM_WIPE=${REQUIRED_CONSENT}`);
    console.error('');
    console.error('This script HARD-DELETES:');
    console.error("  - journal_entries (+ lines) with metadata.flow 'expense-payroll' / 'expense-payroll-void'");
    console.error("  - ALL expense_documents with documentType='PAYROLL' (+ payroll_details/lines/custom rows)");
    console.error("  - tax_reports reportType='PND1' still in DRAFT");
    console.error('');
    console.error(`Dry run first: DRY_RUN=1 CONFIRM_WIPE=${REQUIRED_CONSENT} EXPECTED_DB_NAME=<db> npm --prefix apps/api run wipe:payroll`);
    console.error(`Production: also add ALLOW_PROD_WIPE=${REQUIRED_CONSENT}`);
    process.exit(1);
  }

  if (process.env.NODE_ENV === 'production' && process.env.ALLOW_PROD_WIPE !== REQUIRED_CONSENT) {
    console.error(`ERROR: Refusing to wipe in NODE_ENV=production without ALLOW_PROD_WIPE=${REQUIRED_CONSENT}`);
    process.exit(1);
  }

  const expectedDb = process.env.EXPECTED_DB_NAME;
  if (!expectedDb) {
    console.error('ERROR: Refusing to run without EXPECTED_DB_NAME=<exact-db-name> (must match current_database())');
    process.exit(1);
  }

  const prisma = new PrismaClient();

  const [{ current_database: actualDb }] =
    await prisma.$queryRaw<{ current_database: string }[]>`SELECT current_database()`;
  if (actualDb !== expectedDb) {
    console.error(`ERROR: DB mismatch: connected to "${actualDb}" but EXPECTED_DB_NAME="${expectedDb}". Aborting.`);
    await prisma.$disconnect();
    process.exit(1);
  }

  try {
    // ── Inventory (printed in both modes) ────────────────────────────────
    const payrollDocs = await prisma.expenseDocument.findMany({
      where: { documentType: 'PAYROLL' },
      select: { id: true, number: true, status: true, journalEntryId: true, deletedAt: true },
    });
    const docJeIds = payrollDocs
      .map((d) => d.journalEntryId)
      .filter((v): v is string => v !== null);

    // JEs by flow (covers void-reversal JEs that no document references).
    const flowJes = await prisma.$queryRaw<{ id: string; entry_number: string }[]>`
      SELECT id, entry_number FROM journal_entries
      WHERE metadata->>'flow' IN ('expense-payroll', 'expense-payroll-void')
    `;
    const jeIds = [...new Set([...docJeIds, ...flowJes.map((j) => j.id)])];

    const draftPnd1 = await prisma.taxReport.findMany({
      where: { reportType: 'PND1', status: 'DRAFT' },
      select: { id: true, reportYear: true, reportMonth: true },
    });

    const lineCount = jeIds.length
      ? await prisma.journalLine.count({ where: { journalEntryId: { in: jeIds } } })
      : 0;
    const payrollLineCount = await prisma.payrollLine.count();

    console.log(`[wipe-payroll] database        : ${actualDb}${dryRun ? '  (DRY RUN)' : ''}`);
    console.log(`[wipe-payroll] PAYROLL docs    : ${payrollDocs.length}`);
    for (const d of payrollDocs) {
      console.log(`  - ${d.number}  status=${d.status}${d.deletedAt ? ' (soft-deleted)' : ''}${d.journalEntryId ? ` je=${d.journalEntryId}` : ''}`);
    }
    console.log(`[wipe-payroll] journal entries : ${jeIds.length} (${lineCount} lines)`);
    for (const j of flowJes) console.log(`  - ${j.entry_number}`);
    console.log(`[wipe-payroll] payroll lines   : ${payrollLineCount}`);
    console.log(`[wipe-payroll] PND1 drafts     : ${draftPnd1.length}`);

    if (payrollDocs.length === 0 && jeIds.length === 0 && draftPnd1.length === 0) {
      console.log('[wipe-payroll] Nothing to wipe — done.');
      return;
    }

    if (dryRun) {
      console.log('[wipe-payroll] DRY RUN — no rows deleted.');
      return;
    }

    console.error(`WARNING: About to HARD-DELETE the rows above on database "${actualDb}".`);
    console.error('Press Ctrl+C within 5 seconds to abort.');
    await new Promise((r) => setTimeout(r, 5000));

    await prisma.$transaction(async (tx) => {
      if (jeIds.length > 0) {
        // Undo the FK from documents first so the JE delete can't be blocked.
        await tx.expenseDocument.updateMany({
          where: { journalEntryId: { in: jeIds } },
          data: { journalEntryId: null },
        });
        await tx.journalLine.deleteMany({ where: { journalEntryId: { in: jeIds } } });
        await tx.journalEntry.deleteMany({ where: { id: { in: jeIds } } });
      }
      // ExpenseDocument hard-delete cascades payroll_details → payroll_lines
      // → payroll_custom_income / payroll_custom_deduction (all ON DELETE CASCADE).
      const docIds = payrollDocs.map((d) => d.id);
      if (docIds.length > 0) {
        await tx.$executeRaw`DELETE FROM expense_documents WHERE id IN (${Prisma.join(docIds)})`;
      }
      if (draftPnd1.length > 0) {
        await tx.taxReport.deleteMany({ where: { id: { in: draftPnd1.map((r) => r.id) } } });
      }
    });

    console.log('');
    console.log(`[wipe-payroll] DONE — deleted ${payrollDocs.length} docs, ${jeIds.length} JEs, ${draftPnd1.length} PND1 drafts.`);
    console.log('[wipe-payroll] บันทึกเงินเดือนใหม่ผ่านหน้า รายจ่าย → สร้างเอกสารใหม่ → เงินเดือน (PR)');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error('[wipe-payroll] FAILED:', e);
  process.exit(1);
});
