import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { identityHash } from './plan-targets';
import { hashImportValue as hash } from './canonicalize';
import type {
  CanonicalInput,
  GrossSalesTotals,
  PlannedItem,
  PlannedStockItem,
  PlannedSalesItem,
  ReconciliationSnapshot,
  SalesGroup,
  StockGroup,
  StockTotals,
} from './types';

const moneyFields = ['costTotal', 'listPrice', 'salePrice', 'profit'] as const;
const money = z
  .string()
  .regex(/^-?\d+\.\d{2}$/)
  .nullable();
const count = z.number().int().safe().nullable();
const sha = z.string().regex(/^[a-f0-9]{64}$/);
const stockTotals = z.object({ units: count, cost: money }).strict();
const salesTotals = z
  .object({
    bills: count,
    lines: count,
    costTotal: money,
    listPrice: money,
    salePrice: money,
    profit: money,
  })
  .strict();
const channel = z.enum(['CASH', 'INSTALLMENT', 'EXTERNAL_FINANCE', 'OTHER']);
const sourceSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('SALES'),
      reported: salesTotals.nullable(),
      detail: salesTotals.nullable(),
      delta: salesTotals.nullable(),
      groups: z
        .array(
          z
            .object({
              month: z.string().regex(/^\d{4}-(?:0[1-9]|1[0-2])$/),
              channel,
              branchId: z.string(),
              totals: salesTotals,
            })
            .strict(),
        )
        .nullable(),
      evidenceFileSha256s: z.array(sha),
    })
    .strict(),
  z
    .object({
      kind: z.literal('STOCK'),
      reported: stockTotals.nullable(),
      detail: stockTotals.nullable(),
      delta: stockTotals.nullable(),
      groups: z
        .array(
          z
            .object({
              kind: z.enum(['DEVICE', 'ACCESSORY']),
              branchId: z.string(),
              skuHash: sha.nullable(),
              totals: stockTotals,
            })
            .strict(),
        )
        .nullable(),
      evidenceFileSha256s: z.array(sha),
    })
    .strict(),
]);

function summarizeSales(items: PlannedSalesItem[]): GrossSalesTotals {
  const result = {
    bills: 0,
    lines: items.length,
    costTotal: '0.00',
    listPrice: '0.00',
    salePrice: '0.00',
    profit: '0.00',
  };
  const bills = new Set<string>();
  for (const { payload } of items) {
    bills.add(hash([payload.sourceStoreKey, payload.orderNumber]));
    for (const field of moneyFields)
      result[field] = new Prisma.Decimal(result[field]).plus(payload[field]).toFixed(2);
  }
  return { ...result, bills: bills.size };
}
function summarizeStock(items: PlannedStockItem[]): StockTotals {
  return {
    units: items.length,
    cost: items.reduce((s, i) => s.plus(i.payload.cost), new Prisma.Decimal(0)).toFixed(2),
  };
}
function groupTotals<T, D, R>(rows: T[], dimensions: (row: T) => D, aggregate: (rows: T[]) => R) {
  const groups = new Map<string, { key: D; rows: T[] }>();
  for (const row of rows) {
    const key = dimensions(row),
      id = hash(key);
    const group = groups.get(id) ?? { key, rows: [] };
    group.rows.push(row);
    groups.set(id, group);
  }
  return [...groups]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, group]) => ({ ...group.key, totals: aggregate(group.rows) }));
}
function canonicalGroups(
  kind: CanonicalInput['kind'],
  items: PlannedItem[],
): ReconciliationSnapshot['canonical'] {
  if (kind === 'SALES') {
    const sales = items.filter((i): i is PlannedSalesItem => i.kind === 'SALES');
    const groups: SalesGroup<GrossSalesTotals>[] = groupTotals(
      sales,
      (i) => ({
        month: new Date(i.payload.soldAt.getTime() + 7 * 60 * 60 * 1000).toISOString().slice(0, 7),
        channel: channel.parse(i.payload.saleChannel),
        branchId: i.branchId,
      }),
      summarizeSales,
    );
    return { kind, groups, totals: summarizeSales(sales) };
  }
  const stock = items.filter((i): i is PlannedStockItem => i.kind === 'STOCK');
  const groups: StockGroup<StockTotals>[] = groupTotals(
    stock,
    (i) => ({
      branchId: i.branchId,
      kind: i.payload.kind,
      skuHash: i.payload.kind === 'ACCESSORY' ? identityHash(i) : null,
    }),
    summarizeStock,
  );
  return { kind, groups, totals: summarizeStock(stock) };
}

export function buildReconciliationSnapshot(
  input: CanonicalInput,
  items: PlannedItem[],
): ReconciliationSnapshot {
  // Accept only count/money fields, recognized grouping dimensions and file checksums. A new
  // source column (including a customer/salesperson label) must never enter provenance implicitly.
  const source = input.sourceSummary ? sourceSchema.parse(input.sourceSummary) : null;
  const files = input.manifest.files.filter(
    (f) => f.kind === (input.kind === 'STOCK' ? 'STOCK_SNAPSHOT' : 'SALES'),
  );
  if (
    source &&
    (source.kind !== input.kind ||
      source.evidenceFileSha256s.some((sha) => !files.some((f) => f.sha256 === sha)) ||
      source.groups?.some((g) => !files.some((f) => f.branchId === g.branchId)))
  )
    throw Error('INVALID_SOURCE_SUMMARY_SCOPE');
  const complete = (value: Record<string, string | number | null> | null) =>
    value !== null && Object.values(value).every((v) => v !== null);
  let cannotVerifySource = true;
  if (source?.reported && source.detail && source.delta && source.groups) {
    const { reported, detail, delta, groups } = source;
    const fields = Object.keys(detail) as (keyof typeof detail)[];
    // Reported minus raw detail must reconcile. Distinct bills across groups may overlap.
    const balanced = fields.every((key) => {
      const raw = detail[key],
        header = reported[key],
        difference = delta[key];
      return (
        raw !== null &&
        header !== null &&
        difference !== null &&
        new Prisma.Decimal(difference).isZero() &&
        new Prisma.Decimal(raw).equals(header) &&
        (key === 'bills' ||
          groups
            .reduce((sum, group) => sum.plus(group.totals[key] ?? 0), new Prisma.Decimal(0))
            .equals(raw))
      );
    });
    const dimensions = groups.map(({ totals: _totals, ...keys }) => hash(keys));
    cannotVerifySource = !(
      files.length &&
      files.every((f) => source.evidenceFileSha256s.includes(f.sha256)) &&
      complete(reported) &&
      complete(detail) &&
      complete(delta) &&
      groups.every((g) => complete(g.totals)) &&
      dimensions.length === new Set(dimensions).size &&
      balanced
    );
  }
  const byReason = new Map<CanonicalInput['excluded'][number]['reason'], number>();
  for (const e of input.excluded) byReason.set(e.reason, (byReason.get(e.reason) ?? 0) + 1);
  return {
    version: 1,
    cannotVerifySource,
    files: files.map((f) => ({ fileSha256: f.sha256, branchId: f.branchId })),
    source,
    canonical: canonicalGroups(input.kind, items),
    exclusions: [...byReason].map(([reason, lines]) => ({ reason, lines })),
  };
}
