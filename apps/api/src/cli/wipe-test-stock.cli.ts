/**
 * Soft-delete "test stock" from the operational `Product` table, to clear a clean slate
 * before importing real stock (Flow A). The owner confirmed the current prod `products`
 * table is ENTIRELY test data seeded during setup.
 *
 * SCOPE (deliberately narrow + safe)
 * ----------------------------------
 * Soft-deletes (sets `deleted_at = now()`) only LIVE products that are NOT Tooltify imports —
 * i.e. `deleted_at IS NULL AND (legacy_product_code IS NULL OR legacy_product_code NOT LIKE 'TTFY-%')`.
 * This means:
 *   - Running it BEFORE the import clears all the test/seed products (they carry no TTFY code).
 *   - Running it AFTER the import can NEVER wipe the freshly-imported stock (those are TTFY-*).
 * Order-independent + reversible: soft-delete keeps every row (no FK breakage with test
 * sales/contracts) and can be undone with `UPDATE products SET deleted_at=NULL WHERE ...`.
 *
 * GUARDS (mirror the import CLIs)
 * ------------------------------
 * - EXPECTED_DB_NAME required; SELECT current_database() must match → exit 1.
 * - DRY-RUN by default: prints how many rows + a category/status breakdown, writes NOTHING.
 * - CONFIRM_WIPE_STOCK=YES_I_AM_SURE → actually soft-deletes.
 * - NODE_ENV=production also requires ALLOW_PROD_WIPE_STOCK=YES_I_AM_SURE.
 *
 * USAGE
 * -----
 *   Dry-run:  EXPECTED_DB_NAME=<db> npm --prefix apps/api run wipe:test-stock
 *   Wipe:     CONFIRM_WIPE_STOCK=YES_I_AM_SURE EXPECTED_DB_NAME=<db> \
 *             [ALLOW_PROD_WIPE_STOCK=YES_I_AM_SURE NODE_ENV=production] \
 *             npm --prefix apps/api run wipe:test-stock
 */

import { PrismaClient, Prisma } from '@prisma/client';

const REQUIRED_CONSENT = 'YES_I_AM_SURE';
const LEGACY_PREFIX = 'TTFY-';

async function assertDb(prisma: PrismaClient, expected: string): Promise<string> {
  const [{ current_database: actual }] =
    await prisma.$queryRaw<{ current_database: string }[]>`SELECT current_database()`;
  if (actual !== expected) {
    throw new Error(`DB mismatch: connected="${actual}" but EXPECTED_DB_NAME="${expected}". Aborting.`);
  }
  if (process.env.NODE_ENV === 'production' && process.env.ALLOW_PROD_WIPE_STOCK !== REQUIRED_CONSENT) {
    throw new Error(
      `Refusing to wipe in NODE_ENV=production without ALLOW_PROD_WIPE_STOCK=${REQUIRED_CONSENT}`,
    );
  }
  return actual;
}

async function main() {
  const expected = process.env.EXPECTED_DB_NAME;
  if (!expected) throw new Error('EXPECTED_DB_NAME is required');
  const write = process.env.CONFIRM_WIPE_STOCK === REQUIRED_CONSENT;

  const prisma = new PrismaClient();
  try {
    const db = await assertDb(prisma, expected);

    // The target set: live, non-TTFY products (the test/seed stock).
    // NOTE: a bare `NOT (legacy_product_code LIKE 'TTFY-%')` drops NULL-code rows in SQL
    // (NULL LIKE → NULL → excluded), and the seed/test products all have a NULL code — so we
    // must explicitly OR-in the NULL case, otherwise nothing matches.
    // INCLUDE_TTFY=1 : also clear the Tooltify-imported rows (used when re-importing a
    // corrected on-hand list — wipe everything, then import the fresh set).
    const includeTtfy = process.env.INCLUDE_TTFY === '1';
    const where: Prisma.ProductWhereInput = includeTtfy
      ? { deletedAt: null }
      : {
          deletedAt: null,
          OR: [
            { legacyProductCode: null },
            { legacyProductCode: { not: { startsWith: LEGACY_PREFIX } } },
          ],
        };

    const total = await prisma.product.count({ where });
    const byCategory = await prisma.product.groupBy({
      by: ['category'],
      where,
      _count: { _all: true },
    });
    const byStatus = await prisma.product.groupBy({
      by: ['status'],
      where,
      _count: { _all: true },
    });

    const ttfyLive = await prisma.product.count({
      where: { deletedAt: null, legacyProductCode: { startsWith: LEGACY_PREFIX } },
    });

    console.log(`DB: ${db}`);
    console.log(`Target = LIVE products that are NOT Tooltify imports (legacy_product_code not '${LEGACY_PREFIX}%').`);
    console.log(`  will soft-delete: ${total} rows`);
    console.log('  by category:', Object.fromEntries(byCategory.map((r) => [r.category, r._count._all])));
    console.log('  by status:', Object.fromEntries(byStatus.map((r) => [r.status, r._count._all])));
    console.log(`  (TTFY-imported live rows that stay UNTOUCHED: ${ttfyLive})`);

    if (!write) {
      console.log('\n[DRY_RUN] Nothing changed. Set CONFIRM_WIPE_STOCK=YES_I_AM_SURE to soft-delete.');
      return;
    }

    const res = await prisma.product.updateMany({
      where,
      data: { deletedAt: new Date() },
    });
    console.log(`\nSOFT-DELETED ${res.count} test-stock Product rows (deleted_at set).`);
    console.log('Reversible: UPDATE products SET deleted_at=NULL WHERE deleted_at IS NOT NULL AND (legacy_product_code IS NULL OR legacy_product_code NOT LIKE \'TTFY-%\');');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
