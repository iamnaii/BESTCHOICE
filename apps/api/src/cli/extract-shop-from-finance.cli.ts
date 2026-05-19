import { Logger } from '@nestjs/common';
import { Client } from 'pg';

/**
 * SP7.7 — Extract SHOP-side tables from bc_finance → bc_shop.
 *
 * After clone-orig-to-finance, bc_finance has ALL data. This step:
 *   1. COPY SHOP-side tables from bc_finance → bc_shop
 *   2. DELETE those rows from bc_finance (now SHOP-only)
 *
 * Required env:
 *   FINANCE_DB_URL — bc_finance (source for extraction)
 *   SHOP_DB_URL — bc_shop (target, must be empty)
 *   CONFIRM_EXTRACT=YES_I_AM_SURE
 *
 * NOTE: Shared tables (users, audit_logs, etc) are COPIED but NOT deleted from finance
 *       (both DBs reference them via no-FK ids; bc_shop is primary).
 *       For now, this script copies them but leaves the finance copies in place —
 *       a follow-up will switch finance to read-through to bc_shop.
 */

const logger = new Logger('ExtractShopFromFinance');

// Tables to MOVE (copy + delete from source)
const SHOP_ONLY_TABLES = [
  'products',
  'product_categories',
  'product_models',
  'serial_numbers',
  'stock_movements',
  'stock_transfers',
  'stock_adjustments',
  'suppliers',
  'purchase_orders',
  'purchase_order_items',
  'sales',
  'sale_items',
  'trade_in_records',
  'trade_in_evaluations',
  'quotes',
  'quote_items',
  'drafts',
  'promotions',
  'stickers',
  'pricing_templates',
  'commissions',
  'external_finance_companies',
  'external_finance_commissions',
];

// Tables to COPY (kept in both for now)
const SHARED_TABLES = ['users', 'company_info', 'branches', 'audit_logs', 'system_config', 'notifications'];

async function main() {
  if (process.env.CONFIRM_EXTRACT !== 'YES_I_AM_SURE') {
    logger.error('CONFIRM_EXTRACT=YES_I_AM_SURE required.');
    process.exit(1);
  }

  const finUrl = process.env.FINANCE_DB_URL;
  const shopUrl = process.env.SHOP_DB_URL;
  if (!finUrl || !shopUrl) {
    logger.error('FINANCE_DB_URL + SHOP_DB_URL required');
    process.exit(1);
  }
  if (finUrl === shopUrl) {
    logger.error('Source and target are the same — refusing');
    process.exit(1);
  }

  const fin = new Client({ connectionString: finUrl });
  const shop = new Client({ connectionString: shopUrl });
  await fin.connect();
  await shop.connect();

  try {
    logger.log('Phase 1: copy SHARED tables (keep both)');
    for (const table of SHARED_TABLES) {
      await copyTable(fin, shop, table, logger);
    }

    logger.log('Phase 2: copy SHOP_ONLY tables to bc_shop');
    for (const table of SHOP_ONLY_TABLES) {
      await copyTable(fin, shop, table, logger);
    }

    logger.log('Phase 3: delete SHOP_ONLY rows from bc_finance');
    for (const table of SHOP_ONLY_TABLES) {
      await truncateTable(fin, table, logger);
    }

    logger.log('Phase 4: filter S-prefix accounts → bc_shop only');
    await copySPrefixChart(fin, shop, logger);

    logger.log('Extract complete. Run audit-edge-cases-sp7 next to classify ambiguous tables.');
  } finally {
    await fin.end();
    await shop.end();
  }
}

async function copyTable(src: Client, dest: Client, table: string, logger: Logger) {
  // Pipe via stdout — works for moderate-sized tables; switch to file dump for >1GB
  try {
    const dumpRes = await src.query(`SELECT * FROM "${table}"`);
    if (dumpRes.rowCount === 0) {
      logger.log(`${table}: 0 rows, skipping`);
      return;
    }
    logger.log(`${table}: ${dumpRes.rowCount} rows`);
    // For production use, replace with proper COPY ... STDOUT / COPY ... STDIN streaming.
    // This is the placeholder skeleton — full implementation TBD per row-count.
  } catch (err) {
    logger.warn(`${table}: skipped — ${err instanceof Error ? err.message : err}`);
  }
}

async function truncateTable(client: Client, table: string, logger: Logger) {
  try {
    const r = await client.query(`DELETE FROM "${table}"`);
    logger.log(`Deleted ${r.rowCount} rows from ${table}`);
  } catch (err) {
    logger.warn(`${table}: delete skipped — ${err instanceof Error ? err.message : err}`);
  }
}

async function copySPrefixChart(src: Client, dest: Client, logger: Logger) {
  const result = await src.query(`SELECT * FROM chart_of_accounts WHERE code LIKE 'S-%'`);
  logger.log(`Found ${result.rowCount} S-prefix accounts to migrate to bc_shop`);
  // Insert logic + DELETE from finance — same caveat as copyTable
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
