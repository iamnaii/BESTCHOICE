/**
 * Import current in-stock units from Tooltify into the operational `Product` table (Flow A).
 *
 * WHY
 * ---
 * Tooltify (the shop's previous POS) tracked stock via two flow reports — units IMPORTED
 * and units SOLD — there is no "current balance" snapshot export available (design spec
 * §6.1/§9, fallback A2). This CLI reconstructs "what's still in stock right now" as
 * (imported − sold) and creates those units directly as operational `Product` rows so they
 * can be sold for real from BESTCHOICE going forward.
 *
 * Reads every `*.xlsx` under `<TOOLTIFY_IMPORT_DIR>/สต๊อค/` (imports) and
 * `<TOOLTIFY_IMPORT_DIR>/ขาย/` (sales, to build the sold-barcode set — reuses Flow B's
 * `parseSalesLineItems`), reconstructs current stock via
 * `tooltify-stock-parser.reconstructCurrentStock`, and writes straight to `Product` via
 * PrismaClient — bypassing ProductsService/POService entirely (no PO/receiving workflow,
 * no business-logic side effects for a historical bulk migration).
 *
 * GUARDS
 * ------
 * - TOOLTIFY_IMPORT_DIR required (folder containing สต๊อค/*.xlsx + ขาย/*.xlsx).
 * - EXPECTED_DB_NAME required; SELECT current_database() must match → exit 1.
 * - DRY-RUN by default: parses + reconstructs + prints counts, writes NOTHING, exit 0.
 * - CONFIRM_IMPORT_STOCK=YES_I_AM_SURE → actually writes.
 * - NODE_ENV=production also requires ALLOW_PROD_IMPORT_STOCK=YES_I_AM_SURE.
 * - branchId resolved at runtime: Branch WHERE isMainWarehouse=true AND deletedAt IS NULL
 *   (error if 0 or >1 — no hardcoded id, dev/prod differ).
 * - ownedByCompanyId resolved at runtime: CompanyInfo WHERE companyCode='SHOP'.
 * - Idempotent + reversible via `legacyProductCode` (@unique, spec §6.3): a candidate whose
 *   code already exists as a LIVE row is skipped; one that exists SOFT-DELETED is RESTORED
 *   (deletedAt=null) + updated with the latest values (not silently skipped — re-importing
 *   after a manual reverse must not leave the row gone forever).
 *
 * USAGE
 * -----
 *   Dry-run:  TOOLTIFY_IMPORT_DIR=<folder> EXPECTED_DB_NAME=<db> \
 *             npm --prefix apps/api run import:tooltify-stock
 *   Write:    CONFIRM_IMPORT_STOCK=YES_I_AM_SURE TOOLTIFY_IMPORT_DIR=<folder> \
 *             EXPECTED_DB_NAME=<db> [ALLOW_PROD_IMPORT_STOCK=YES_I_AM_SURE NODE_ENV=production] \
 *             npm --prefix apps/api run import:tooltify-stock
 */

import { PrismaClient } from '@prisma/client';
import { promises as fs } from 'fs';
import * as path from 'path';
import { readXlsxRows } from '../modules/imported-sales/xlsx-reader';
import { parseSalesLineItems } from '../modules/imported-sales/tooltify-sales-parser';
import {
  parseStockImportRows,
  reconstructCurrentStock,
  toProductCreateData,
  buildLegacyProductCode,
  ParsedStockImportRow,
  ProductCreateData,
} from '../modules/imported-sales/tooltify-stock-parser';

const REQUIRED_CONSENT = 'YES_I_AM_SURE';
const LEGACY_PREFIX = 'TTFY-';

async function assertDb(prisma: PrismaClient, expected: string): Promise<string> {
  const [{ current_database: actual }] =
    await prisma.$queryRaw<{ current_database: string }[]>`SELECT current_database()`;
  if (actual !== expected) {
    throw new Error(`DB mismatch: connected="${actual}" but EXPECTED_DB_NAME="${expected}". Aborting.`);
  }
  if (process.env.NODE_ENV === 'production' && process.env.ALLOW_PROD_IMPORT_STOCK !== REQUIRED_CONSENT) {
    throw new Error(
      `Refusing to import in NODE_ENV=production without ALLOW_PROD_IMPORT_STOCK=${REQUIRED_CONSENT}`,
    );
  }
  return actual;
}

async function resolveBranchId(prisma: PrismaClient): Promise<string> {
  const branches = await prisma.branch.findMany({
    where: { isMainWarehouse: true, deletedAt: null },
    select: { id: true, name: true },
  });
  if (branches.length === 0) {
    throw new Error('No Branch found with isMainWarehouse=true AND deletedAt IS NULL. Set one and re-run.');
  }
  if (branches.length > 1) {
    throw new Error(
      `Expected exactly 1 main-warehouse branch, found ${branches.length}: ${branches
        .map((b) => `${b.name} (${b.id})`)
        .join(', ')}. Fix data and re-run.`,
    );
  }
  return branches[0].id;
}

async function resolveShopCompanyId(prisma: PrismaClient): Promise<string> {
  const company = await prisma.companyInfo.findFirst({ where: { companyCode: 'SHOP' } });
  if (!company) {
    throw new Error("No CompanyInfo found with companyCode='SHOP'. Seed it and re-run.");
  }
  return company.id;
}

async function main(): Promise<void> {
  const dir = process.env.TOOLTIFY_IMPORT_DIR;
  if (!dir) {
    console.error('ERROR: TOOLTIFY_IMPORT_DIR is required (folder containing สต๊อค/*.xlsx + ขาย/*.xlsx)');
    process.exit(1);
  }
  const expectedDb = process.env.EXPECTED_DB_NAME;
  if (!expectedDb) {
    console.error('ERROR: EXPECTED_DB_NAME is required (must match current_database())');
    process.exit(1);
  }
  const write = process.env.CONFIRM_IMPORT_STOCK === REQUIRED_CONSENT;

  const prisma = new PrismaClient();
  try {
    const actualDb = await assertDb(prisma, expectedDb);
    console.log(`[import-tooltify-stock] database: ${actualDb}${write ? '' : '  (DRY RUN)'}`);

    // ---- 1. parse import files ----
    const stockDir = path.join(dir, 'สต๊อค');
    const stockFiles = (await fs.readdir(stockDir)).filter((f) => f.endsWith('.xlsx')).sort();
    if (stockFiles.length === 0) {
      console.error(`ERROR: no .xlsx files found under ${stockDir}`);
      process.exit(1);
    }
    let importRows: ParsedStockImportRow[] = [];
    for (const f of stockFiles) {
      const rows = await readXlsxRows(path.join(stockDir, f));
      const parsed = parseStockImportRows(rows, { importBatch: f });
      console.log(`  [import] ${f}: ${parsed.length} rows`);
      importRows = importRows.concat(parsed);
    }
    if (importRows.length === 0) {
      console.error('ERROR: parsed 0 import rows across all files — check the source files / parser.');
      process.exit(1);
    }

    // ---- 2. parse sales files -> flat sold-barcode list ----
    // IMPORT_AS_IS=1 : the stock files ALREADY are the current on-hand list (owner's
    // "สต๊อคคงเหลือ" export). Do NOT subtract sales — every stock row IS a unit in stock.
    const asIs = process.env.IMPORT_AS_IS === '1';
    let soldBarcodes: string[] = [];
    if (asIs) {
      console.log('  [AS-IS] IMPORT_AS_IS=1 — treating every stock row as current on-hand (no sales subtraction).');
    } else {
      const salesDir = path.join(dir, 'ขาย');
      const salesFiles = (await fs.readdir(salesDir)).filter((f) => f.endsWith('.xlsx')).sort();
      if (salesFiles.length === 0) {
        console.error(`ERROR: no .xlsx files found under ${salesDir} (or set IMPORT_AS_IS=1 for an on-hand file)`);
        process.exit(1);
      }
      for (const f of salesFiles) {
        const rows = await readXlsxRows(path.join(salesDir, f));
        const parsed = parseSalesLineItems(rows, { importBatch: f });
        console.log(`  [sales]  ${f}: ${parsed.length} line items`);
        soldBarcodes = soldBarcodes.concat(parsed.map((p) => p.barcode));
      }
    }

    // ---- 3. reconstruct current stock ----
    const { phones, accessories } = reconstructCurrentStock(importRows, soldBarcodes);

    const phoneByCategory = phones.reduce<Record<string, number>>((m, r) => {
      m[r.categoryText] = (m[r.categoryText] ?? 0) + 1;
      return m;
    }, {});
    const accessoryUnitCount = accessories.reduce((sum, a) => sum + a.qty, 0);

    console.log(`\nRECONSTRUCTED STOCK`);
    console.log(`  phones/tablets: ${phones.length} — by category:`, phoneByCategory);
    console.log(`  accessory SKUs with qty>0: ${accessories.length}`);
    console.log(`  accessory units total: ${accessoryUnitCount}`);
    console.log(`  TOTAL Product rows to create: ${phones.length + accessoryUnitCount}`);

    // ---- 4. resolve runtime context ----
    const branchId = await resolveBranchId(prisma);
    const ownedByCompanyId = await resolveShopCompanyId(prisma);
    console.log(`\nresolved branchId=${branchId} ownedByCompanyId=${ownedByCompanyId}`);

    // ---- 5. build candidate Product rows ----
    const ctx = { branchId, ownedByCompanyId };
    const candidates: ProductCreateData[] = [];
    for (const row of phones) {
      const legacyProductCode = buildLegacyProductCode({ kind: 'phone', barcode: row.barcode });
      candidates.push(toProductCreateData(row, ctx, { kind: 'phone', legacyProductCode }));
    }
    for (const acc of accessories) {
      for (let seq = 1; seq <= acc.qty; seq++) {
        const legacyProductCode = buildLegacyProductCode({ kind: 'accessory', sku: acc.sku, seq });
        candidates.push(toProductCreateData(acc.source, ctx, { kind: 'accessory', legacyProductCode }));
      }
    }

    const categoryBreakdown = candidates.reduce<Record<string, number>>((m, c) => {
      m[c.category] = (m[c.category] ?? 0) + 1;
      return m;
    }, {});
    console.log(`\nProduct category breakdown (final):`, categoryBreakdown);

    // ---- 6. idempotency: check existing legacyProductCode rows (TTFY-%) ----
    const existing = await prisma.product.findMany({
      where: { legacyProductCode: { startsWith: LEGACY_PREFIX } },
      select: { id: true, legacyProductCode: true, deletedAt: true },
    });
    const existingByCode = new Map(existing.map((e) => [e.legacyProductCode as string, e]));

    const toCreate: ProductCreateData[] = [];
    const toRestore: { id: string; data: ProductCreateData }[] = [];
    let skippedLiveCount = 0;
    for (const c of candidates) {
      const found = existingByCode.get(c.legacyProductCode);
      if (!found) {
        toCreate.push(c);
      } else if (found.deletedAt) {
        toRestore.push({ id: found.id, data: c });
      } else {
        skippedLiveCount++;
      }
    }
    console.log(
      `\nIdempotency check: ${toCreate.length} new, ${toRestore.length} to restore (soft-deleted -> live), ${skippedLiveCount} skipped (already live)`,
    );

    if (!write) {
      console.log(`\n[DRY_RUN] set CONFIRM_IMPORT_STOCK=${REQUIRED_CONSENT} to write.`);
      return;
    }

    // ---- 7. write: chunked createMany (slices of 1000) ----
    const CHUNK_SIZE = 1000;
    let createdCount = 0;
    for (let i = 0; i < toCreate.length; i += CHUNK_SIZE) {
      const slice = toCreate.slice(i, i + CHUNK_SIZE);
      const res = await prisma.product.createMany({ data: slice, skipDuplicates: true });
      createdCount += res.count;
    }

    // ---- 8. write: restore soft-deleted rows one at a time (update, not createMany) ----
    let restoredCount = 0;
    for (const r of toRestore) {
      await prisma.product.update({
        where: { id: r.id },
        data: { ...r.data, deletedAt: null },
      });
      restoredCount++;
    }

    console.log(`\nCREATED ${createdCount} Product rows.`);
    console.log(`RESTORED ${restoredCount} previously soft-deleted Product rows.`);
    console.log(`SKIPPED ${skippedLiveCount} rows already live.`);
    if (createdCount < toCreate.length) {
      console.log(`  (${toCreate.length - createdCount} were skipped as duplicates by createMany)`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
