/**
 * Import historical Tooltify SALES into `imported_sales` (Flow B).
 *
 * WHY
 * ---
 * Tooltify (the shop's previous POS) exported yearly xlsx reports before the
 * switch to BESTCHOICE. Those historical sales are stats-only reference data
 * (browse/filter/export) — they must NOT flow through SalesService, which
 * would fire accounting journals for sales that never happened in THIS
 * ledger. This CLI bootstraps its own `PrismaClient` and writes straight to
 * `ImportedSale` via `createMany`, bypassing the service layer entirely.
 *
 * Reads every `*.xlsx` file under `<TOOLTIFY_IMPORT_DIR>/ขาย/`, parses the
 * "รายการขาย ( N )" detail table out of each (readXlsxRows + parseSalesLineItems),
 * and prints a per-file + per-channel reconciliation summary before writing
 * anything.
 *
 * GUARDS
 * ------
 * - TOOLTIFY_IMPORT_DIR required (folder containing ขาย/*.xlsx).
 * - EXPECTED_DB_NAME required; SELECT current_database() must match → exit 1.
 * - DRY-RUN by default: parses + prints counts, writes NOTHING, exit 0.
 * - CONFIRM_IMPORT=YES_I_AM_SURE → actually writes.
 * - NODE_ENV=production also requires ALLOW_PROD_IMPORT=YES_I_AM_SURE.
 * - Idempotent: `createMany({ skipDuplicates: true })` against the
 *   `@@unique([source, barcode, orderNumber, soldAt])` constraint — re-running
 *   the same files is safe and inserts 0 the second time.
 *
 * USAGE
 * -----
 *   Dry-run:  TOOLTIFY_IMPORT_DIR=<folder> EXPECTED_DB_NAME=<db> \
 *             npm --prefix apps/api run import:tooltify
 *   Write:    CONFIRM_IMPORT=YES_I_AM_SURE TOOLTIFY_IMPORT_DIR=<folder> \
 *             EXPECTED_DB_NAME=<db> [ALLOW_PROD_IMPORT=YES_I_AM_SURE NODE_ENV=production] \
 *             npm --prefix apps/api run import:tooltify
 */

import { PrismaClient } from '@prisma/client';
import { promises as fs } from 'fs';
import * as path from 'path';
import { readXlsxRows } from '../modules/imported-sales/xlsx-reader';
import { parseSalesLineItems, ParsedSale } from '../modules/imported-sales/tooltify-sales-parser';

const REQUIRED_CONSENT = 'YES_I_AM_SURE';

async function assertDb(prisma: PrismaClient, expected: string): Promise<string> {
  const [{ current_database: actual }] =
    await prisma.$queryRaw<{ current_database: string }[]>`SELECT current_database()`;
  if (actual !== expected) {
    throw new Error(`DB mismatch: connected="${actual}" but EXPECTED_DB_NAME="${expected}". Aborting.`);
  }
  if (process.env.NODE_ENV === 'production' && process.env.ALLOW_PROD_IMPORT !== REQUIRED_CONSENT) {
    throw new Error(`Refusing to import in NODE_ENV=production without ALLOW_PROD_IMPORT=${REQUIRED_CONSENT}`);
  }
  return actual;
}

async function main(): Promise<void> {
  const dir = process.env.TOOLTIFY_IMPORT_DIR;
  if (!dir) {
    console.error('ERROR: TOOLTIFY_IMPORT_DIR is required (folder containing ขาย/*.xlsx)');
    process.exit(1);
  }
  const expectedDb = process.env.EXPECTED_DB_NAME;
  if (!expectedDb) {
    console.error('ERROR: EXPECTED_DB_NAME is required (must match current_database())');
    process.exit(1);
  }
  const write = process.env.CONFIRM_IMPORT === REQUIRED_CONSENT;

  const prisma = new PrismaClient();
  try {
    const actualDb = await assertDb(prisma, expectedDb);
    console.log(`[import-tooltify] database: ${actualDb}${write ? '' : '  (DRY RUN)'}`);

    const salesDir = path.join(dir, 'ขาย');
    const files = (await fs.readdir(salesDir)).filter((f) => f.endsWith('.xlsx')).sort();
    if (files.length === 0) {
      console.error(`ERROR: no .xlsx files found under ${salesDir}`);
      process.exit(1);
    }

    let all: ParsedSale[] = [];
    for (const f of files) {
      const rows = await readXlsxRows(path.join(salesDir, f));
      const parsed = parseSalesLineItems(rows, { importBatch: f });
      console.log(`  ${f}: ${parsed.length} line items`);
      all = all.concat(parsed);
    }

    if (all.length === 0) {
      console.error('ERROR: parsed 0 line items across all files — check the source files / parser before proceeding.');
      process.exit(1);
    }

    // reconcile summary
    const byChannel = all.reduce<Record<string, number>>((m, r) => {
      m[r.saleChannel] = (m[r.saleChannel] ?? 0) + 1;
      return m;
    }, {});
    console.log(`\nTOTAL line items: ${all.length}`);
    console.log('by channel:', byChannel);

    if (!write) {
      console.log(`\n[DRY_RUN] set CONFIRM_IMPORT=${REQUIRED_CONSENT} to write.`);
      return;
    }

    const res = await prisma.importedSale.createMany({
      data: all.map((r) => ({ ...r })),
      skipDuplicates: true,
    });
    console.log(`\nINSERTED ${res.count} rows (skipDuplicates on @@unique([source, barcode, orderNumber, soldAt])).`);
    if (res.count < all.length) {
      console.log(`SKIPPED ${all.length - res.count} rows as duplicates.`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
