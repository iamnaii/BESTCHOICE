/**
 * One-time backfill CLI: link historical ExpenseDocument.vendorSupplierId
 * by exact taxId match against the active Supplier master.
 *
 * Safe de-risk policy (matches contacts-followups epic):
 *   - CONFIDENT match only: vendorTaxId → exactly ONE active Supplier.taxId
 *   - Zero matches  → reported as "no-supplier"   (skipped, never guessed)
 *   - 2+ matches    → reported as "ambiguous"      (skipped, listed)
 *   - No fuzzy name matching, no auto-create of Supplier records
 *
 * ExpenseLine.supplierId is NOT touched here — line-level matching would
 * require name-only (fuzzy) matching, which is out-of-scope. A count of
 * ExpenseLines with supplierId IS NULL AND supplierName != NULL is printed
 * as "needs manual review".
 *
 * Idempotent: only rows with vendorSupplierId IS NULL are scanned.
 * Re-running after a partial apply is safe — already-linked rows are
 * untouched because they no longer satisfy the WHERE clause.
 *
 * Dry-run by default.  Run with --apply to write.
 *
 * Usage (dev, dry-run):
 *   EXPECTED_DB_NAME=bestchoice_dev npm --prefix apps/api run backfill:expense-vendor-fk
 *
 * Usage (dev, apply):
 *   EXPECTED_DB_NAME=bestchoice_dev npm --prefix apps/api run backfill:expense-vendor-fk -- --apply
 *
 * Usage (production, dry-run):
 *   gcloud run jobs execute backfill-expense-vendor-fk --region=asia-southeast1 \
 *     --project=bestchoice-prod \
 *     --update-env-vars=EXPECTED_DB_NAME=bestchoice_prod \
 *     --wait
 *
 * Usage (production, apply):
 *   ... --update-env-vars=EXPECTED_DB_NAME=bestchoice_prod,APPLY=true,ALLOW_PROD_BACKFILL=YES_I_AM_SURE
 *
 * Notes:
 *   - The pure decision helper `resolveVendorMatch` is unit-tested in
 *     backfill-expense-vendor-fk.cli.spec.ts. The runnable main() is
 *     operational glue guarded by `require.main === module` so importing
 *     this file in Jest does NOT connect to a DB or run anything.
 */
import { PrismaClient } from '@prisma/client';

// ─── Pure matching logic (exported for unit tests) ───────────────────────────

export interface SupplierRow {
  id: string;
  taxId: string | null;
}

export type VendorMatchResult =
  | { kind: 'eligible'; supplierId: string }
  | { kind: 'no-supplier' }
  | { kind: 'ambiguous'; candidateIds: string[] };

/**
 * Pure function: given the active suppliers and one expense doc's vendorTaxId,
 * decide the backfill action.
 *
 *   - Exactly one Supplier with taxId === vendorTaxId → eligible
 *   - Zero matches                                    → no-supplier
 *   - 2+ matches                                      → ambiguous
 *   - null / empty vendorTaxId                        → no-supplier
 *     (callers should pre-filter, but this stays safe if they don't)
 */
export function resolveVendorMatch(
  activeSuppliers: SupplierRow[],
  vendorTaxId: string | null,
): VendorMatchResult {
  if (!vendorTaxId || vendorTaxId.trim() === '') {
    return { kind: 'no-supplier' };
  }
  const matches = activeSuppliers.filter(
    (s) => s.taxId !== null && s.taxId === vendorTaxId,
  );
  if (matches.length === 1) {
    return { kind: 'eligible', supplierId: matches[0].id };
  }
  if (matches.length === 0) {
    return { kind: 'no-supplier' };
  }
  return { kind: 'ambiguous', candidateIds: matches.map((s) => s.id) };
}

// ─── Runnable glue — only executes under `require.main === module` ──────────

interface ExpenseDocRow {
  id: string;
  number: string;
  vendorTaxId: string | null;
  vendorName: string | null;
}

const SAMPLE_SIZE = 5; // how many example doc numbers to show per bucket

async function main(): Promise<void> {
  const expectedDb = process.env.EXPECTED_DB_NAME;
  if (!expectedDb) {
    console.error(
      'ERROR: EXPECTED_DB_NAME is required (e.g. EXPECTED_DB_NAME=bestchoice_dev).',
    );
    process.exit(1);
  }

  // --apply flag can come from CLI args OR from env (for Cloud Run Job invocation)
  const applyMode =
    process.argv.includes('--apply') ||
    (process.env.APPLY ?? '').toLowerCase() === 'true';

  const prisma = new PrismaClient();

  // DB name guard — prevents wrong-DB accidents
  const [{ current_database: actualDb }] = await prisma.$queryRaw<
    { current_database: string }[]
  >`SELECT current_database()`;
  if (actualDb !== expectedDb) {
    console.error(
      `ERROR: DB mismatch: connected to "${actualDb}" but EXPECTED_DB_NAME="${expectedDb}". Aborting.`,
    );
    await prisma.$disconnect();
    process.exit(1);
  }

  // Extra guard for production live runs
  if (applyMode && actualDb === 'bestchoice_prod') {
    if (process.env.ALLOW_PROD_BACKFILL !== 'YES_I_AM_SURE') {
      console.error(
        'ERROR: production --apply requires ALLOW_PROD_BACKFILL=YES_I_AM_SURE',
      );
      await prisma.$disconnect();
      process.exit(1);
    }
    console.warn(
      '[backfill-expense-vendor-fk] LIVE prod run starting in 5s — Ctrl+C to abort.',
    );
    await new Promise((r) => setTimeout(r, 5000));
  }

  console.log(
    `[backfill-expense-vendor-fk] DB: ${actualDb}  mode: ${applyMode ? 'APPLY' : 'DRY_RUN'}`,
  );

  try {
    // ── 1. Load active Supplier taxIds into memory ────────────────────────
    const activeSuppliers: SupplierRow[] = await prisma.supplier.findMany({
      where: { deletedAt: null },
      select: { id: true, taxId: true },
    });
    console.log(
      `[backfill-expense-vendor-fk] Loaded ${activeSuppliers.length} active supplier(s).`,
    );

    // ── 2. Load target expense documents ─────────────────────────────────
    const docs: ExpenseDocRow[] = await prisma.expenseDocument.findMany({
      where: {
        vendorSupplierId: null,
        deletedAt: null,
        vendorTaxId: { not: null },
      },
      select: {
        id: true,
        number: true,
        vendorTaxId: true,
        vendorName: true,
      },
      orderBy: { number: 'asc' },
    });
    console.log(
      `[backfill-expense-vendor-fk] Found ${docs.length} doc(s) with vendorTaxId set but vendorSupplierId NULL.`,
    );

    // ── 3. Classify ────────────────────────────────────────────────────────
    const eligible: Array<{ doc: ExpenseDocRow; supplierId: string }> = [];
    const noSupplier: ExpenseDocRow[] = [];
    const ambiguous: Array<{ doc: ExpenseDocRow; candidateIds: string[] }> = [];

    for (const doc of docs) {
      const result = resolveVendorMatch(activeSuppliers, doc.vendorTaxId);
      switch (result.kind) {
        case 'eligible':
          eligible.push({ doc, supplierId: result.supplierId });
          break;
        case 'no-supplier':
          noSupplier.push(doc);
          break;
        case 'ambiguous':
          ambiguous.push({ doc, candidateIds: result.candidateIds });
          break;
      }
    }

    // ── 4. ExpenseLine report-only (no auto-link) ──────────────────────────
    // Lines with supplierId IS NULL + non-empty supplierName require name-only
    // matching which would be fuzzy — out of scope. Just report the count.
    const expenseLineNeedsReview = await prisma.expenseLine.count({
      where: {
        supplierId: null,
        supplierName: { not: null },
      },
    });

    // ── 5. Summary print ──────────────────────────────────────────────────
    console.log('');
    console.log('[backfill-expense-vendor-fk] ===== CLASSIFICATION SUMMARY =====');
    console.log(
      `[backfill-expense-vendor-fk]   total scanned      : ${docs.length}`,
    );
    console.log(
      `[backfill-expense-vendor-fk]   eligible (1 match) : ${eligible.length}${applyMode ? '' : '  (would-link)'}`,
    );
    console.log(
      `[backfill-expense-vendor-fk]   no-supplier        : ${noSupplier.length}  (skipped — no active supplier with that taxId)`,
    );
    console.log(
      `[backfill-expense-vendor-fk]   ambiguous          : ${ambiguous.length}  (skipped — multiple suppliers share that taxId)`,
    );
    console.log(
      `[backfill-expense-vendor-fk]   ExpenseLines needing manual review (supplierName set, supplierId null): ${expenseLineNeedsReview}`,
    );
    console.log('');

    if (eligible.length > 0) {
      const sample = eligible.slice(0, SAMPLE_SIZE);
      console.log(
        `[backfill-expense-vendor-fk]   ELIGIBLE sample (up to ${SAMPLE_SIZE}):`,
      );
      for (const { doc, supplierId } of sample) {
        console.log(
          `    doc=${doc.number}  vendorTaxId=${doc.vendorTaxId}  vendorName=${doc.vendorName ?? '(null)'}  → supplier=${supplierId}`,
        );
      }
      if (eligible.length > SAMPLE_SIZE) {
        console.log(`    ... and ${eligible.length - SAMPLE_SIZE} more`);
      }
      console.log('');
    }

    if (noSupplier.length > 0) {
      const sample = noSupplier.slice(0, SAMPLE_SIZE);
      console.log(
        `[backfill-expense-vendor-fk]   NO-SUPPLIER sample (up to ${SAMPLE_SIZE}):`,
      );
      for (const doc of sample) {
        console.log(
          `    doc=${doc.number}  vendorTaxId=${doc.vendorTaxId}  vendorName=${doc.vendorName ?? '(null)'}`,
        );
      }
      if (noSupplier.length > SAMPLE_SIZE) {
        console.log(`    ... and ${noSupplier.length - SAMPLE_SIZE} more`);
      }
      console.log('');
    }

    if (ambiguous.length > 0) {
      console.log(
        `[backfill-expense-vendor-fk]   AMBIGUOUS sample (up to ${SAMPLE_SIZE}):`,
      );
      for (const { doc, candidateIds } of ambiguous.slice(0, SAMPLE_SIZE)) {
        console.log(
          `    doc=${doc.number}  vendorTaxId=${doc.vendorTaxId}  vendorName=${doc.vendorName ?? '(null)'}  candidates=[${candidateIds.join(', ')}]`,
        );
      }
      if (ambiguous.length > SAMPLE_SIZE) {
        console.log(`    ... and ${ambiguous.length - SAMPLE_SIZE} more`);
      }
      console.log('');
    }

    // ── 6. Dry-run exit ────────────────────────────────────────────────────
    if (!applyMode) {
      console.log(
        '[backfill-expense-vendor-fk] DRY_RUN — no rows updated. Re-run with --apply (or APPLY=true) to commit changes.',
      );
      return;
    }

    // ── 7. Apply eligible rows ────────────────────────────────────────────
    if (eligible.length === 0) {
      console.log('[backfill-expense-vendor-fk] Nothing to apply.');
      return;
    }

    console.log(
      `[backfill-expense-vendor-fk] Applying ${eligible.length} update(s)...`,
    );

    let linked = 0;
    let failed = 0;

    // Process in batches of 100 to keep memory + lock contention bounded.
    const BATCH_SIZE = 100;
    for (let i = 0; i < eligible.length; i += BATCH_SIZE) {
      const batch = eligible.slice(i, i + BATCH_SIZE);
      // Use a transaction per batch for atomicity within the batch.
      await prisma.$transaction(async (tx) => {
        for (const { doc, supplierId } of batch) {
          await tx.expenseDocument.update({
            where: {
              id: doc.id,
              // Idempotency guard: only update if still null (concurrent safety)
              vendorSupplierId: null,
            },
            data: { vendorSupplierId: supplierId },
          });
        }
      });
      linked += batch.length;
      console.log(
        `[backfill-expense-vendor-fk]   ...linked ${linked}/${eligible.length}`,
      );
    }

    console.log('');
    console.log('[backfill-expense-vendor-fk] ===== APPLY SUMMARY =====');
    console.log(
      `[backfill-expense-vendor-fk]   linked    : ${linked}`,
    );
    console.log(
      `[backfill-expense-vendor-fk]   failed    : ${failed}`,
    );
    console.log(
      `[backfill-expense-vendor-fk]   no-match  : ${noSupplier.length}  (manual review required)`,
    );
    console.log(
      `[backfill-expense-vendor-fk]   ambiguous : ${ambiguous.length}  (manual review required)`,
    );
    console.log(
      `[backfill-expense-vendor-fk]   ExpenseLines needing manual review: ${expenseLineNeedsReview}`,
    );
    console.log('[backfill-expense-vendor-fk] Done.');
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(
      '[backfill-expense-vendor-fk] FATAL:',
      err instanceof Error ? err.message : String(err),
    );
    process.exit(1);
  });
}
