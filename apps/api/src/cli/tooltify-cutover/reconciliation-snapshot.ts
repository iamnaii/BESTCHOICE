import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { identityHash, saleContent, sourceRefJson } from './plan-targets';
import { hashImportValue as hash, orderedDigest, receiptDigest } from './canonicalize';
import type {
  CanonicalInput,
  FileRef,
  GrossSalesTotals,
  PlannedItem,
  CanonicalSaleLine,
  CanonicalStockUnit,
  EconomicAggregate,
  ReconciliationSnapshot,
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

type SaleMeasure = Pick<
  CanonicalSaleLine,
  'sourceStoreKey' | 'orderNumber' | 'soldAt' | 'saleChannel' | (typeof moneyFields)[number]
> & { branchId: string };
type StockMeasure = {
  kind: 'DEVICE' | 'ACCESSORY';
  branchId: string;
  skuHash: string | null;
  cost: string;
};

function groupTotals<T, D, R>(
  rows: T[],
  dimensions: (r: T) => D,
  aggregate: (rows: T[], key: string) => R,
) {
  const groups = new Map<string, { key: D; rows: T[] }>();
  for (const row of rows) {
    const key = dimensions(row),
      id = hash(key),
      group = groups.get(id) ?? { key, rows: [] };
    group.rows.push(row);
    groups.set(id, group);
  }
  return [...groups]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([id, g]) => ({ ...g.key, totals: aggregate(g.rows, id) }));
}
const saleDimensions = (r: SaleMeasure) => ({
  month: new Date(r.soldAt.getTime() + 7 * 3600000).toISOString().slice(0, 7),
  channel: channel.safeParse(r.saleChannel).data ?? 'UNKNOWN',
  branchId: r.branchId,
});
const billKey = (r: SaleMeasure) => hash([r.sourceStoreKey, r.orderNumber]);
export function aggregateSales(
  rows: SaleMeasure[],
  retained: SaleMeasure[] = [],
): Extract<EconomicAggregate, { kind: 'SALES' }> {
  // A removed line removes a distinct bill only if no retained line keeps it in this scope.
  const retainedBills = new Set(retained.map(billKey));
  const retainedGroupBills = new Set(
    retained.map((r) => hash([hash(saleDimensions(r)), billKey(r)])),
  );
  const total = (sales: SaleMeasure[], group?: string): GrossSalesTotals => {
    const bills = new Set<string>();
    const result = {
      bills: 0,
      lines: sales.length,
      costTotal: '0.00',
      listPrice: '0.00',
      salePrice: '0.00',
      profit: '0.00',
    };
    for (const r of sales) {
      const key = billKey(r);
      if (!(group ? retainedGroupBills.has(hash([group, key])) : retainedBills.has(key)))
        bills.add(key);
      for (const field of moneyFields)
        result[field] = new Prisma.Decimal(result[field]).plus(r[field]).toFixed(2);
    }
    return { ...result, bills: bills.size };
  };
  return { kind: 'SALES', totals: total(rows), groups: groupTotals(rows, saleDimensions, total) };
}
export function aggregateStock(
  rows: StockMeasure[],
): Extract<EconomicAggregate, { kind: 'STOCK' }> {
  const total = (rs: StockMeasure[]): StockTotals => ({
    units: rs.length,
    cost: rs.reduce((sum, r) => sum.plus(r.cost), new Prisma.Decimal(0)).toFixed(2),
  });
  return {
    kind: 'STOCK',
    totals: total(rows),
    groups: groupTotals(
      rows,
      ({ kind, branchId, skuHash }) => ({ kind, branchId, skuHash }),
      total,
    ),
  };
}
export function stockMeasure(r: CanonicalStockUnit): StockMeasure {
  return {
    kind: r.kind,
    branchId: r.branchId,
    cost: r.cost,
    skuHash: r.kind === 'ACCESSORY' ? hash(['ACCESSORY', r.branchId, r.barcode]) : null,
  };
}
function sourceAggregates(input: CanonicalInput, files: FileRef[]) {
  const ordinary = input.excluded
    .filter((e) => e.reason !== 'IDENTICAL_FILE_COPY')
    .map((e) => hash(sourceRefJson(e.source)))
    .sort();
  const evidence = input.excludedEvidence ?? [];
  const complete =
    hash(ordinary) === hash(evidence.map((r) => hash(sourceRefJson(r.source))).sort());
  if (input.kind === 'SALES') {
    const byFile = new Map(files.map((f) => [f.sha256, f.branchId]));
    const measure = (r: CanonicalSaleLine) => ({
      ...r,
      branchId: byFile.get(r.source.fileSha256) ?? '',
    });
    const retained = input.rows.map(measure);
    return {
      canonical: aggregateSales(retained),
      adjustments: complete
        ? aggregateSales((input.excludedEvidence ?? []).map(measure), retained)
        : null,
    };
  }
  return {
    canonical: aggregateStock(input.rows.map(stockMeasure)),
    adjustments: complete ? aggregateStock((input.excludedEvidence ?? []).map(stockMeasure)) : null,
  };
}

export function expectedTarget(item: PlannedItem) {
  if (item.kind === 'SALES') return [item.sourceKey, saleContent(item.payload)];
  const r = item.payload;
  return [
    item.sourceKey,
    identityHash(item),
    r.branchId,
    r.category,
    r.desiredStatus,
    new Prisma.Decimal(r.cost).toFixed(2),
    ...(['cashPrice', 'installmentPrice', 'financePrice'] as const).map((k) =>
      r[k] === null ? null : new Prisma.Decimal(r[k]).toFixed(2),
    ),
    item.disposition === 'CREATE' ? new Date(r.importedAt) : null,
  ];
}
function feasibleSourceGroups(
  source: NonNullable<ReconciliationSnapshot['source']>,
  files: FileRef[],
): boolean {
  if (!source.reported || !source.detail || !source.groups) return false;
  if (source.kind === 'STOCK') {
    const validUnits = (total: { units: number | null }) =>
      total.units !== null && total.units >= 0;
    return (
      validUnits(source.reported) &&
      validUnits(source.detail) &&
      source.groups.every(
        (g) =>
          validUnits(g.totals) &&
          (g.kind === 'ACCESSORY' ? g.skuHash !== null : g.skuHash === null),
      )
    );
  }
  const possible = (t: { lines: number | null; bills: number | null }) =>
    t.lines !== null &&
    t.bills !== null &&
    t.lines >= 0 &&
    t.bills >= 0 &&
    t.bills <= t.lines &&
    (t.bills === 0) === (t.lines === 0);
  if (
    !possible(source.reported) ||
    !possible(source.detail) ||
    !source.groups.every((g) => possible(g.totals))
  )
    return false;
  // Source groups name branches, while a bill's identity includes its source store.
  // An ambiguous store assignment cannot establish which group counts may overlap.
  const storeByBranch = new Map<string, string>();
  for (const { branchId, storeKey } of files) {
    if (
      !branchId?.trim() ||
      branchId === 'UNRESOLVED' ||
      !storeKey.trim() ||
      storeKey !== storeKey.trim() ||
      storeKey === 'UNRESOLVED'
    )
      return false;
    const previous = storeByBranch.get(branchId);
    if (previous !== undefined && previous !== storeKey) return false;
    storeByBranch.set(branchId, storeKey);
  }

  const largestGroupByStore = new Map<string, number>();
  let upperBound = 0;
  for (const group of source.groups) {
    const store = storeByBranch.get(group.branchId);
    if (!store) return false;
    const bills = group.totals.bills!;
    largestGroupByStore.set(store, Math.max(largestGroupByStore.get(store) ?? 0, bills));
    upperBound += bills;
  }
  // Groups within a store may share all their bills. Distinct stores share none.
  const lowerBound = [...largestGroupByStore.values()].reduce((sum, n) => sum + n, 0);
  return lowerBound <= source.detail.bills! && source.detail.bills! <= upperBound;
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
      feasibleSourceGroups(source, files) &&
      dimensions.length === new Set(dimensions).size &&
      balanced
    );
  }
  const byReason = new Map<CanonicalInput['excluded'][number]['reason'], number>();
  for (const e of input.excluded) byReason.set(e.reason, (byReason.get(e.reason) ?? 0) + 1);
  return {
    version: 1,
    ...(input.kind === 'SALES' && input.validatedHistory?.length
      ? {
          history: input.validatedHistory.map(({ branchId, reportFrom, reportTo }) => ({
            branchId,
            reportFrom,
            reportTo,
          })),
        }
      : {}),
    cannotVerifySource:
      cannotVerifySource ||
      (input.kind === 'STOCK' && input.issues.some((i) => i.code === 'STOCK_SUMMARY_MISMATCH')),
    uniquePhysicalRows:
      input.uniquePhysicalRows === undefined
        ? ((source?.kind === 'SALES' ? source.detail?.lines : source?.detail?.units) ?? null)
        : z.number().int().safe().nonnegative().parse(input.uniquePhysicalRows),
    files: files.map((f) => ({ fileSha256: f.sha256, branchId: f.branchId })),
    source,
    ...sourceAggregates(input, files),
    expectedTargetsHash: orderedDigest(items.map(expectedTarget)),
    expectedReceiptsHash: receiptDigest([
      ...items.map((i) => ({
        sourceKey: i.sourceKey,
        disposition: i.disposition,
        payloadHash: i.payloadHash,
        identityHash: identityHash(i),
        sourceRefs: [sourceRefJson(i.payload.source)],
        targetId: i.targetId,
      })),
      ...input.excluded.map((e, index) => {
        const key = hash(['EXCLUDE', index, e]);
        return {
          sourceKey: key,
          disposition: 'EXCLUDE',
          payloadHash: hash(e),
          identityHash: key,
          targetId: null,
          sourceRefs: [
            { ...sourceRefJson(e.source), reason: e.reason, canonicalSourceKey: e.sourceKey },
          ],
        };
      }),
    ]),
    exclusions: [...byReason].map(([reason, lines]) => ({ reason, lines })),
  };
}
