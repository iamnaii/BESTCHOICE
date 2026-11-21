import { Prisma, PrismaClient, type TooltifyImportItem } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { saleSourceKey } from '../../modules/imported-sales/tooltify-sales-parser';
import { sourceTimestamp } from '../../modules/imported-sales/tooltify-date';
import { hashImportValue as hash, hashSourceDecisions } from './canonicalize';
import {
  evaluateItem,
  identityHash,
  salesTargetFingerprint,
  stockTargetFingerprint,
  sourceRefJson,
} from './plan-targets';
import type {
  CanonicalInput,
  CanonicalStockUnit,
  ImportPlan,
  PlannedItem,
  PlannedStockItem,
  SourceDecision,
  StockResolution,
} from './types';

import { buildReconciliationSnapshot } from './reconciliation-snapshot';
export { stockTargetFingerprint, salesTargetFingerprint };
type Db = Prisma.TransactionClient;
export async function readImportDatabaseIdentity(db: Db) {
  const [identity] = await db.$queryRaw<
    { host: string; port: string; database: string; schema: string }[]
  >`
    SELECT coalesce(host(inet_server_addr()), current_setting('unix_socket_directories')) AS host,
      current_setting('port') AS port, current_database() AS database, current_schema() AS schema`;
  return { ...identity, fingerprint: hash(identity) };
}

export async function assertImportDatabase(db: Db, expected: string) {
  const identity = await readImportDatabaseIdentity(db);
  if (!expected || expected !== identity.fingerprint)
    throw Error('IMPORT_DATABASE_IDENTITY_MISMATCH');
  const indexes = await db.$queryRaw<{ indexname: string; indexdef: string }[]>`
    SELECT indexname,indexdef FROM pg_indexes WHERE schemaname=current_schema() AND indexname IN
      ('products_imei_serial_active_unique','product_prices_one_default','imported_sales_source_barcode_order_number_sold_at_key')`;
  const needs: Record<string, string> = {
    products_imei_serial_active_unique:
      'products USING btree (imei_serial) WHERE (deleted_at IS NULL)',
    product_prices_one_default:
      'product_prices USING btree (product_id) WHERE (is_default AND (deleted_at IS NULL))',
    imported_sales_source_barcode_order_number_sold_at_key:
      'imported_sales USING btree (source, barcode, order_number, sold_at)',
  };
  if (
    indexes.length !== 3 ||
    indexes.some(
      (i) =>
        !i.indexdef.startsWith('CREATE UNIQUE INDEX ') ||
        !i.indexdef.endsWith('.' + needs[i.indexname]),
    )
  )
    throw Error('IMPORT_SCHEMA_INDEX_MISMATCH');
}

export function computePlanHash(plan: ImportPlan) {
  // A read-only dry-run allocates a proposed UUID; the first successful set lock owns the durable UUID.
  return hash({
    ...plan,
    planHash: undefined,
    batchId: undefined,
    items: plan.items.map((item) => ({ ...item, batchId: undefined })),
  });
}

export async function replayItem(
  db: Db,
  item: PlannedItem,
  receipt: TooltifyImportItem,
): Promise<PlannedItem> {
  const targetType = item.kind === 'STOCK' ? 'PRODUCT' : 'IMPORTED_SALE';
  if (
    receipt.deletedAt ||
    receipt.reversedAt ||
    receipt.targetType !== targetType ||
    receipt.payloadHash !== item.payloadHash ||
    receipt.identityHash !== identityHash(item) ||
    hash(receipt.sourceRefs) !== hash([sourceRefJson(item.payload.source)]) ||
    !receipt.targetId ||
    !['CREATE', 'MATCH'].includes(receipt.disposition)
  )
    throw Error('IMPORT_ITEM_RECEIPT_MISMATCH');
  const actual = await (item.kind === 'STOCK' ? stockTargetFingerprint : salesTargetFingerprint)(
    db,
    receipt.targetId,
  );
  if (actual !== receipt.afterFingerprint) throw Error('IMPORT_ITEM_TARGET_CHANGED');
  // CREATE had no target at dry-run. Its committed target is identified exclusively by the receipt.
  const base = {
    targetId: receipt.disposition === 'MATCH' ? receipt.targetId : null,
    disposition: receipt.disposition,
    dependencyFingerprint: receipt.dependencyFingerprint,
    reason: null,
  };
  if (item.kind === 'SALES') return { ...item, ...base };
  const stored = receipt.stockResolution as unknown as StockResolution | null;
  if (!stored || !item.decision) throw Error('IMPORT_ITEM_RESOLUTION_MISSING');
  return {
    ...item,
    ...base,
    resolution: stored,
    payload: {
      ...item.original,
      deviceOrigin: item.decision.deviceOrigin,
      desiredStatus: item.decision.desiredStatus,
      priceEvidence: item.decision.evidenceRef,
      cashPrice: stored.cashPrice,
      installmentPrice: stored.installmentPrice,
      financePrice: stored.financePrice,
    },
  };
}

function stockDraft(
  row: CanonicalStockUnit,
  entries: SourceDecision[],
  batchId: string,
): PlannedStockItem {
  const decision =
    entries.find(
      (e): e is Extract<SourceDecision, { action: 'RESOLVE_STOCK' }> =>
        e.action === 'RESOLVE_STOCK',
    ) ?? null;
  const accessoryMapping =
    entries.find(
      (e): e is Extract<SourceDecision, { action: 'MAP_ACCESSORY_UNITS' }> =>
        e.action === 'MAP_ACCESSORY_UNITS',
    ) ?? null;
  return {
    kind: 'STOCK',
    batchId,
    sourceKey: row.sourceKey,
    original: row,
    payload: row,
    decision,
    accessoryMapping,
    resolution: {
      companyId: null,
      templateId: null,
      cashPrice: null,
      installmentPrice: null,
      financePrice: null,
    },
    branchId: row.branchId,
    disposition: 'CONFLICT',
    reason: null,
    targetId: null,
    dependencyFingerprint: '',
    payloadHash: hash({ row, decision, accessoryMapping }),
  };
}

function inputIssues(input: CanonicalInput) {
  const issues = [...input.issues];
  const issue = (code: string, source: CanonicalStockUnit['source'] | null = null) =>
    issues.push({ code, source, message: code });
  const { manifest, decisions } = input;
  if (
    !manifest.canonicalSetId.trim() ||
    manifest.companyCode !== 'SHOP' ||
    manifest.version !== 1 ||
    !manifest.files.length ||
    !input.codeRevision.trim() ||
    !manifest.cutoverAt.endsWith('+07:00') ||
    !sourceTimestamp(manifest.cutoverAt)
  )
    issue('INVALID_IMPORT_CONTEXT');
  if (hashSourceDecisions(decisions) !== manifest.decisionsSha256) issue('DECISIONS_HASH_MISMATCH');
  const kindFiles = manifest.files.filter(
    (f) => f.kind === (input.kind === 'STOCK' ? 'STOCK_SNAPSHOT' : 'SALES'),
  );
  if (
    !kindFiles.length ||
    kindFiles.some(
      (f) =>
        !decisions.entries.some(
          (d) =>
            d.fileSha256 === f.sha256 &&
            (d.action === 'EXCLUDE_FILE' ||
              (input.kind === 'STOCK'
                ? d.action === 'SELECT_SNAPSHOT'
                : d.action === 'SELECT_SALES' || d.action === 'ZERO_SALES')),
        ),
    )
  )
    issue('UNPROVEN_IMPORT_SCOPE');
  for (const d of decisions.entries) {
    if (
      !d.reason.trim() ||
      !d.evidenceRef.trim() ||
      d.action === 'UNRESOLVED' ||
      !manifest.files.some((f) => f.sha256 === d.fileSha256) ||
      new Set(d.sourceRows).size !== d.sourceRows.length
    )
      issue('INVALID_SOURCE_DECISION');
  }
  const seenKeys = new Set<string>(),
    seenPhysical = new Set<string>(),
    seenImeis = new Set<string>();
  const orderStores = new Map<string, string>();
  for (const row of input.rows) {
    const ref = row.source;
    const file = manifest.files.find((f) => f.sha256 === ref.fileSha256);
    const entries = decisions.entries.filter(
      (e) => e.fileSha256 === ref.fileSha256 && e.sourceRows.includes(ref.row),
    );
    const selected = entries.filter(
      (e) => e.action === (input.kind === 'STOCK' ? 'SELECT_SNAPSHOT' : 'SELECT_SALES'),
    );
    const placement = selected[0];
    if (
      !file ||
      !ref.storeKey ||
      ref.storeKey === 'UNRESOLVED' ||
      ref.storeKey !== file.storeKey ||
      !ref.sheet ||
      !Number.isSafeInteger(ref.row) ||
      ref.row < 1 ||
      !file.branchId ||
      selected.length !== 1 ||
      !placement ||
      !('storeKey' in placement) ||
      placement.storeKey !== ref.storeKey ||
      placement.branchId !== file.branchId ||
      entries.some((e) => e.action === 'EXCLUDE_ROW' || e.action === 'EXCLUDE_FILE')
    )
      issue('SOURCE_SCOPE_MISMATCH', ref);
    const physical = hash([ref.fileSha256, ref.sheet, ref.row]);
    if (seenKeys.has(row.sourceKey) || seenPhysical.has(physical))
      issue('DUPLICATE_SOURCE_KEY', ref);
    seenKeys.add(row.sourceKey);
    seenPhysical.add(physical);
    if ('desiredStatus' in row) {
      const identity =
        row.kind === 'DEVICE'
          ? [ref.storeKey, row.barcode]
          : [manifest.canonicalSetId, ref.fileSha256, ref.sheet, ref.row, 1];
      if (
        hash(identity) !== row.sourceKey ||
        row.branchId !== file?.branchId ||
        file?.kind !== 'STOCK_SNAPSHOT' ||
        placement?.action !== 'SELECT_SNAPSHOT' ||
        placement.asOf !== manifest.cutoverAt ||
        file.reportFrom !== manifest.cutoverAt.slice(0, 10) ||
        file.reportTo !== file.reportFrom ||
        row.cashPrice !== null ||
        row.installmentPrice !== null ||
        row.financePrice !== null ||
        row.desiredStatus !== null ||
        row.priceEvidence !== null ||
        !/^\d{1,10}(\.\d{1,2})?$/.test(row.cost) ||
        !sourceTimestamp(row.importedAt) ||
        new Date(row.importedAt) > new Date(manifest.cutoverAt) ||
        (row.kind === 'DEVICE'
          ? !/^\d{14,15}$/.test(row.barcode) ||
            !['PHONE_NEW', 'PHONE_USED', 'TABLET'].includes(row.category)
          : !row.barcode || row.category !== 'ACCESSORY')
      )
        issue('INVALID_CANONICAL_STOCK', ref);
      if (row.kind === 'DEVICE') {
        if (seenImeis.has(row.barcode)) issue('DUPLICATE_IMEI', ref);
        seenImeis.add(row.barcode);
      }
      if (entries.filter((e) => e.action === 'RESOLVE_STOCK').length !== 1)
        issue('UNRESOLVED_STOCK_DECISION', ref);
    } else if ('sourceStoreKey' in row) {
      const soldDay = new Date(row.soldAt.getTime() + 7 * 60 * 60 * 1000)
        .toISOString()
        .slice(0, 10);
      if (
        file?.kind !== 'SALES' ||
        placement?.action !== 'SELECT_SALES' ||
        soldDay < placement.reportFrom ||
        soldDay > placement.reportTo ||
        row.soldAt > new Date(manifest.cutoverAt) ||
        row.sourceStoreKey !== ref.storeKey ||
        saleSourceKey(row, row.occurrence) !== row.sourceKey
      )
        issue('INVALID_CANONICAL_SALE', ref);
      const store = orderStores.get(row.orderNumber);
      if (store && store !== row.sourceStoreKey) issue('SALES_STORE_COLLISION', ref);
      orderStores.set(row.orderNumber, row.sourceStoreKey);
    }
  }
  const assignedTargets = new Set<string>();
  if (input.kind === 'STOCK') {
    for (const d of decisions.entries.filter((e) => e.action === 'MAP_ACCESSORY_UNITS')) {
      const rows = input.rows.filter(
        (r) =>
          r.kind === 'ACCESSORY' && r.source.fileSha256 === d.fileSha256 && r.barcode === d.sku,
      );
      const expected = rows.map((r) => r.source.row).sort((a, b) => a - b);
      const sameRows = (nums: number[]) => hash([...nums].sort((a, b) => a - b)) === hash(expected);
      if (
        !rows.length ||
        !Number.isSafeInteger(d.checkedQuantity) ||
        d.checkedQuantity !== rows.length ||
        !sameRows(d.sourceRows) ||
        !sameRows(d.assignments.map((a) => a.row))
      )
        issue('INVALID_ACCESSORY_MAPPING');
      for (const { targetId } of d.assignments)
        if (targetId !== null) {
          if (!targetId.trim() || assignedTargets.has(targetId))
            issue('DUPLICATE_ACCESSORY_TARGET');
          assignedTargets.add(targetId);
        }
    }
    for (const row of input.rows) {
      const mappings = decisions.entries.filter(
        (d) =>
          d.action === 'MAP_ACCESSORY_UNITS' &&
          d.fileSha256 === row.source.fileSha256 &&
          d.sourceRows.includes(row.source.row),
      );
      if (mappings.length !== (row.kind === 'ACCESSORY' ? 1 : 0))
        issue('ACCESSORY_MAPPING_REQUIRED', row.source);
    }
  }
  for (const e of input.excluded) {
    const evidence = decisions.entries.filter(
      (d) => d.fileSha256 === e.source.fileSha256 && d.sourceRows.includes(e.source.row),
    );
    const file = manifest.files.find((f) => f.sha256 === e.source.fileSha256);
    if (
      !file ||
      file.storeKey !== e.source.storeKey ||
      (e.reason !== 'IDENTICAL_FILE_COPY' && !evidence.some((d) => d.action === e.reason))
    )
      issue('UNPROVEN_EXCLUSION', e.source);
  }
  // Selected evidence enumerates physical rows. An upstream caller cannot silently omit one.
  const accounted = new Set(
    [...input.rows, ...input.excluded].map((r) => hash([r.source.fileSha256, r.source.row])),
  );
  for (const d of decisions.entries) {
    const file = manifest.files.find((f) => f.sha256 === d.fileSha256);
    if (file?.kind !== (input.kind === 'STOCK' ? 'STOCK_SNAPSHOT' : 'SALES')) continue;
    if (
      ['SELECT_SNAPSHOT', 'SELECT_SALES', 'EXCLUDE_ROW', 'EXCLUDE_FILE'].includes(d.action) &&
      d.sourceRows.some((r) => !accounted.has(hash([d.fileSha256, r])))
    )
      issue('UNACCOUNTED_SOURCE_ROW');
  }
  return issues;
}

function totals(
  items: PlannedItem[],
  excluded: number,
  canonical: ImportPlan['reconciliationSnapshot']['canonical'],
): ImportPlan['totals'] {
  return {
    created: items.filter((i) => i.disposition === 'CREATE').length,
    matched: items.filter((i) => i.disposition === 'MATCH').length,
    conflicts: items.filter((i) => i.disposition === 'CONFLICT').length,
    excluded,
    stockCost: canonical.kind === 'STOCK' ? canonical.totals.cost : '0.00',
    sales: canonical.kind === 'SALES' ? canonical.totals : null,
  };
}

export async function buildImportPlan(
  db: PrismaClient,
  input: CanonicalInput,
): Promise<ImportPlan> {
  const issues = inputIssues(input);
  const { manifest, codeRevision, kind } = input;
  return db.$transaction(
    async (tx) => {
      await assertImportDatabase(tx, input.expectedDbIdentity);
      const batch = await tx.tooltifyImportBatch.findUnique({
        where: { canonicalSetId_kind: { canonicalSetId: manifest.canonicalSetId, kind } },
        include: { items: true },
      });
      const manifestHash = hash(manifest);
      if (
        batch &&
        (batch.deletedAt ||
          batch.status === 'ROLLED_BACK' ||
          batch.manifestHash !== manifestHash ||
          batch.codeRevision !== codeRevision)
      )
        throw Error('IMPORT_BATCH_INPUT_CHANGED');
      const batchId = batch?.id ?? randomUUID();
      const receipts = new Map(batch?.items.map((r) => [r.sourceKey, r]));
      const items: PlannedItem[] = [];
      for (const row of input.rows) {
        const entries = input.decisions.entries.filter(
          (e) => e.fileSha256 === row.source.fileSha256 && e.sourceRows.includes(row.source.row),
        );
        const draft: PlannedItem =
          'desiredStatus' in row
            ? stockDraft(row, entries, batchId)
            : {
                kind: 'SALES',
                payload: row,
                batchId,
                sourceKey: row.sourceKey,
                branchId:
                  manifest.files.find((f) => f.sha256 === row.source.fileSha256)?.branchId ?? '',
                payloadHash: hash(row),
                disposition: 'CONFLICT',
                targetId: null,
                dependencyFingerprint: '',
                reason: null,
              };
        const receipt = receipts.get(row.sourceKey);
        const item = receipt ? await replayItem(tx, draft, receipt) : await evaluateItem(tx, draft);
        items.push(item);
        if (item.reason)
          issues.push({ source: row.source, code: item.reason, message: item.reason });
      }
      const excluded = input.excluded.map((e, index) => ({
        ...e,
        receiptKey: hash(['EXCLUDE', index, e]),
        payloadHash: hash(e),
      }));
      const reconciliationSnapshot = buildReconciliationSnapshot(input, items);
      const plan: ImportPlan = {
        reconciliationSnapshot,
        batchId,
        kind,
        canonicalSetId: manifest.canonicalSetId,
        sourceCutoverAt: manifest.cutoverAt,
        codeRevision,
        manifestHash,
        decisionsHash: hashSourceDecisions(input.decisions),
        dbIdentity: input.expectedDbIdentity,
        planHash: '',
        dependencyFingerprint: hash(items.map((i) => [i.sourceKey, i.dependencyFingerprint])),
        items,
        excluded,
        totals: totals(items, excluded.length, reconciliationSnapshot.canonical),
        issues,
      };
      plan.planHash = computePlanHash(plan);
      if (batch && batch.planHash !== plan.planHash) throw Error('IMPORT_BATCH_PLAN_CHANGED');
      return plan;
    },
    { isolationLevel: 'RepeatableRead', timeout: 600000 },
  );
}
