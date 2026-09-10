import { Prisma } from '@prisma/client';
import Decimal from 'decimal.js';
import {
  computeDefaultBcInstallment,
  type StockSortKey,
  type StockSortDirection,
  type BcConfigJson,
} from '@installment/shared';
import { KNOWN_ACCESSORY_TYPES } from '../../utils/accessory-type.util';
import { resolveBcConfig } from '../interest-config/resolve-bc-config';
import { CASH_LABEL, INSTALLMENT_LABEL } from '../../utils/product-price-sync.util';

type Candidate = { key: string; category: string; value: string | number | null };
const collator = new Intl.Collator('th', { numeric: true, sensitivity: 'base' });
const numericKeys = new Set<StockSortKey>([
  'storage',
  'batteryHealth',
  'hasBox',
  'costPrice',
  'cashPrice',
  'downPayment',
  'monthlyPayment',
  'quantity',
  'category',
]);

/** Whitelisted SQL only; query parameter names never become SQL identifiers. */
function valueExpression(key: StockSortKey, grouped: boolean): Prisma.Sql {
  const model = Prisma.sql`COALESCE(NULLIF(p.model, ''), p.name)`;
  const expressions: Record<StockSortKey, Prisma.Sql> = {
    name: Prisma.sql`MIN(CASE WHEN p.category = 'ACCESSORY' THEN COALESCE(NULLIF(p.name, ''), p.model) ELSE ${model} END)`,
    category: Prisma.sql`MIN(CASE p.category WHEN 'PHONE_NEW' THEN 1 WHEN 'PHONE_USED' THEN 2 WHEN 'TABLET' THEN 3 ELSE 4 END)`,
    productCode: Prisma.sql`MIN(CASE WHEN NULLIF(p.accessory_type, '') IS NOT NULL AND p.accessory_type NOT IN (${Prisma.join([...KNOWN_ACCESSORY_TYPES])}) THEN p.accessory_type ${grouped ? Prisma.empty : Prisma.sql`ELSE NULLIF(p.legacy_product_code, '')`} END)`,
    accessoryType: Prisma.sql`MIN(CASE WHEN p.accessory_type IN (${Prisma.join([...KNOWN_ACCESSORY_TYPES])}) THEN NULLIF(p.accessory_type, '') END)`,
    specifications: Prisma.sql`MIN(NULLIF(CONCAT_WS(' · ', NULLIF(p.storage, ''), NULLIF(p.color, '')), ''))`,
    storage: Prisma.sql`MIN(CASE WHEN p.storage ~* '^\\s*[0-9]+(\\.[0-9]+)?\\s*(GB|TB)\\s*$' THEN (substring(p.storage from '[0-9]+(?:\\.[0-9]+)?'))::numeric * CASE WHEN p.storage ~* 'TB' THEN 1024 ELSE 1 END END)`,
    color: Prisma.sql`MIN(NULLIF(p.color, ''))`,
    connectivity: Prisma.sql`MIN(CASE
      WHEN p.model ~* '\\m(cellular|lte|4g|5g)\\M' THEN 'Wi-Fi + Cellular'
      WHEN p.model ~* '\\mwi[[:space:]‐‑‒–—―-]?fi\\M' THEN 'Wi-Fi'
      WHEN p.name ~* '\\m(cellular|lte|4g|5g)\\M' THEN 'Wi-Fi + Cellular'
      WHEN p.name ~* '\\mwi[[:space:]‐‑‒–—―-]?fi\\M' THEN 'Wi-Fi' END)`,
    batteryHealth: Prisma.sql`MIN(CASE WHEN p.battery_health BETWEEN 0 AND 100 THEN p.battery_health END)`,
    hasBox: Prisma.sql`MIN(p.has_box::int)`,
    warrantyExpireDate: Prisma.sql`MIN(CASE WHEN p.warranty_expired THEN '0001-01-01'::date ELSE p.warranty_expire_date END)`,
    costPrice: Prisma.sql`MIN(p.cost_price)`,
    cashPrice: Prisma.sql`MIN(p.display_price) FILTER (WHERE p.display_price > 0)`,
    downPayment: Prisma.sql`MIN(p.display_price) FILTER (WHERE p.display_price > 0)`,
    monthlyPayment: Prisma.sql`MIN(p.display_price) FILTER (WHERE p.display_price > 0)`,
    stockInDate: Prisma.sql`MIN(p.stock_in_date)`,
    quantity: Prisma.sql`COUNT(*) FILTER (WHERE p.status = 'IN_STOCK')`,
    status: Prisma.sql`STRING_AGG(DISTINCT p.status::text, ',' ORDER BY p.status::text)`,
    branch: Prisma.sql`MIN(b.name)`,
  };
  return expressions[key];
}

/**
 * Sort compact group keys/values before paging; only the selected page loads product
 * relations. This keeps Thai/natural ordering and the shared installment calculation
 * consistent without copying a financial formula into SQL.
 */
export async function sortedStockPageKeys(
  tx: Prisma.TransactionClient,
  filtered: Prisma.Sql,
  key: StockSortKey,
  direction: StockSortDirection,
  grouped: boolean,
  page: number,
  limit: number,
) {
  const isQuote = key === 'downPayment' || key === 'monthlyPayment';
  const needsPrice = isQuote || key === 'cashPrice';
  const label = isQuote ? INSTALLMENT_LABEL : CASH_LABEL;
  const prefix = isQuote ? 'ราคาผ่อน' : CASH_LABEL;
  const priceColumn = isQuote ? Prisma.sql`p.installment_price` : Prisma.sql`p.cash_price`;
  const priced = needsPrice
    ? Prisma.sql`
    SELECT p.*, COALESCE(CASE WHEN ${priceColumn} > 0 THEN ${priceColumn} END, legacy.amount) AS display_price
    FROM filtered p LEFT JOIN LATERAL (
      SELECT amount FROM product_prices WHERE product_id = p.id AND deleted_at IS NULL AND label LIKE ${`${prefix}%`}
      ORDER BY (label = ${label}) DESC, created_at ASC, id ASC LIMIT 1
    ) legacy ON ${priceColumn} IS NULL OR ${priceColumn} <= 0
  `
    : Prisma.sql`SELECT * FROM filtered`;
  const candidates = await tx.$queryRaw<Candidate[]>(Prisma.sql`
    WITH filtered AS (${filtered}), priced AS (${priced})
    SELECT md5(p.group_key) AS key, MIN(p.category::text) AS category,
      (${valueExpression(key, grouped)})::text AS value
    FROM priced p LEFT JOIN branches b ON b.id = p.branch_id
    GROUP BY p.group_key
  `);
  const configs = new Map<string, BcConfigJson>();
  if (isQuote) {
    for (const category of new Set(candidates.map((row) => row.category))) {
      if (['PHONE_NEW', 'PHONE_USED', 'TABLET'].includes(category)) {
        configs.set(category, await resolveBcConfig(tx, category));
      }
    }
    for (const row of candidates) {
      const quote = computeDefaultBcInstallment(
        row.value == null ? null : new Decimal(row.value).toNumber(),
        configs.get(row.category),
      );
      row.value = (key === 'downPayment' ? quote?.downAmount : quote?.monthlyPayment) ?? null;
    }
  }
  candidates.sort((a, b) => {
    // Missing/invalid values stay at the bottom in both directions.
    if (a.value == null || b.value == null) {
      if (a.value != null) return -1;
      if (b.value != null) return 1;
    } else {
      const difference = numericKeys.has(key)
        ? new Decimal(a.value).comparedTo(new Decimal(b.value))
        : collator.compare(String(a.value), String(b.value));
      if (difference) return direction === 'desc' ? -difference : difference;
    }
    return a.key.localeCompare(b.key);
  });
  return candidates.slice((page - 1) * limit, page * limit).map((row) => row.key);
}
