import { resolveStockSupplier } from './supplier-link';
import { validLegacySaleEvidence } from './legacy-sale-evidence';
import { validStockSourceMapping } from './stock-source-mapping';
import { Prisma, PrismaClient, type TooltifyImportItem } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { saleSourceKey } from '../../modules/imported-sales/tooltify-sales-parser';
import { sourceTimestamp } from '../../modules/imported-sales/tooltify-date';
import { hashImportValue as hash, hashSourceDecisions } from './canonicalize';
import {
  evaluateItem,
  identityHash,
  readSaleOriginsFor,
  readStockTarget,
  stockEligibilityIssue,
  type SaleOrigins,
  salesTargetFingerprint,
  stockTargetFingerprint,
  sourceRefJson,
} from './plan-targets';
import type {
  CanonicalInput,
  CanonicalSaleLine,
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
  const indexes = await db.$queryRaw<
    { indexname: string; indexdef: string; indisvalid: boolean; indisready: boolean }[]
  >`
    SELECT c.relname AS indexname, pg_get_indexdef(c.oid) AS indexdef, i.indisvalid, i.indisready
    FROM pg_catalog.pg_index i JOIN pg_catalog.pg_class c ON c.oid=i.indexrelid
    JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname=current_schema() AND c.relname IN
      ('products_imei_serial_active_unique','product_prices_one_default','imported_sales_source_barcode_order_number_sold_at_key','imported_sales_source_event_occurrence_key')`;
  const needs: Record<string, string> = {
    products_imei_serial_active_unique:
      'products USING btree (imei_serial) WHERE (deleted_at IS NULL)',
    product_prices_one_default:
      'product_prices USING btree (product_id) WHERE (is_default AND (deleted_at IS NULL))',
    imported_sales_source_event_occurrence_key:
      'imported_sales USING btree (source, barcode, order_number, sold_at, source_occurrence)',
  };
  if (
    indexes.length !== 3 ||
    indexes.some(
      (i) =>
        !i.indisvalid ||
        !i.indisready ||
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
  origins?: SaleOrigins,
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
  const product = item.kind === 'STOCK' ? await readStockTarget(db, receipt.targetId) : null;
  const actual = product ? hash(product) : await salesTargetFingerprint(db, receipt.targetId);
  if (actual !== receipt.afterFingerprint) throw Error('IMPORT_ITEM_TARGET_CHANGED');
  if (product) {
    const issue = await stockEligibilityIssue(db, product);
    if (issue) throw Error(issue);
  }
  // CREATE had no target at dry-run. Its committed target is identified exclusively by the receipt.
  const base = {
    targetId: receipt.disposition === 'MATCH' ? receipt.targetId : null,
    disposition: receipt.disposition,
    dependencyFingerprint: receipt.dependencyFingerprint,
    reason: null,
  };
  if (item.kind === 'SALES') {
    if (receipt.disposition === 'MATCH') {
      const origin = (origins ?? (await readSaleOriginsFor(db, { id: receipt.targetId }))).get(
        receipt.targetId,
      );
      if (!origin) throw Error('UNPROVEN_SALE_ORIGIN');
      if (origin.branchId !== item.branchId || origin.storeKey !== item.payload.sourceStoreKey)
        throw Error('SALE_ORIGIN_BRANCH_CONFLICT');
    }
    return { ...item, ...base };
  }
  const stored = receipt.stockResolution as unknown as StockResolution | null;
  if (!stored || !item.decision) throw Error('IMPORT_ITEM_RESOLUTION_MISSING');
  try {
    const current = await resolveStockSupplier(db, item.original, item.decision);
    if (hash(current ?? null) !== hash(stored.supplierLink ?? null))
      throw Error('IMPORT_DEPENDENCY_CHANGED');
  } catch {
    throw Error('IMPORT_DEPENDENCY_CHANGED');
  }
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
  const selected = kindFiles.some((file) => {
    const entries = decisions.entries.filter((d) => d.fileSha256 === file.sha256);
    if (entries.some((d) => d.action === 'EXCLUDE_FILE')) return false;
    return entries.some((d) =>
      input.kind === 'STOCK'
        ? d.action === 'SELECT_SNAPSHOT' &&
          d.sourceRows.length > 0 &&
          d.asOf === manifest.cutoverAt &&
          d.branchId === file.branchId &&
          d.storeKey === file.storeKey
        : ((d.action === 'SELECT_SALES' && d.sourceRows.length > 0) ||
            (d.action === 'ZERO_SALES' && d.sourceRows.length === 0)) &&
          d.branchId === file.branchId &&
          input.validatedHistory?.some(
            (h) =>
              h.branchId === d.branchId && h.reportFrom <= d.reportFrom && h.reportTo >= d.reportTo,
          ),
    );
  });
  if (
    !selected ||
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
    issues.push({
      kind: input.kind,
      code: 'UNPROVEN_IMPORT_SCOPE',
      message: 'UNPROVEN_IMPORT_SCOPE',
      source: null,
    });
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
      const mappings = entries.filter((d) => d.action === 'MAP_STOCK_ITEM');
      const mapping = row.sourceMapping;
      const validMapping = !!(
        mapping &&
        mappings.length === 1 &&
        hash(mapping) === hash(mappings[0]) &&
        validStockSourceMapping(mapping, ref, row.barcode, row.name, mapping.expectedCategory) &&
        row.category === mapping.category &&
        row.kind === (mapping.category === 'TABLET' ? 'DEVICE' : 'ACCESSORY')
      );
      if ((mapping || mappings.length) && !validMapping) issue('INVALID_STOCK_SOURCE_MAPPING', ref);
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
        row.sourceStatus !== null ||
        row.desiredStatus !== null ||
        row.priceEvidence !== null ||
        !/^\d{1,10}(\.\d{1,2})?$/.test(row.cost) ||
        !sourceTimestamp(row.importedAt) ||
        new Date(row.importedAt) > new Date(manifest.cutoverAt) ||
        (row.kind === 'DEVICE'
          ? (!/^\d{14,15}$/.test(row.barcode) &&
              !(validMapping && mapping?.category === 'TABLET')) ||
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
      const legacy = row.legacyIdentityEvidence;
      const proofs = entries.filter((d) => d.action === 'RETAIN_LEGACY_SALE');
      if (
        (legacy || proofs.length) &&
        !(
          legacy &&
          proofs.length === 1 &&
          hash(legacy) === hash(proofs[0]) &&
          validLegacySaleEvidence(legacy, ref, row.barcode, row.productName, row.category)
        )
      )
        issue('INVALID_LEGACY_SALE_EVIDENCE', ref);
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
  if (input.kind === 'SALES') {
    const groups = new Map<string, CanonicalSaleLine[]>();
    for (const row of input.rows) {
      const key = saleSourceKey(row, 1);
      groups.set(key, [...(groups.get(key) ?? []), row]);
    }
    for (const group of groups.values()) {
      const sorted = [...group].sort((a, b) => a.occurrence - b.occurrence);
      const first = sorted[0];
      if (sorted.some((r, i) => r.occurrence !== i + 1))
        issue('UNPROVEN_SALES_MULTIPLICITY', first.source);
      if (group.length === 1) continue;
      const proofs = decisions.entries.filter(
        (d) =>
          d.action === 'DISTINCT_UNITS' &&
          d.fileSha256 === first.source.fileSha256 &&
          hash([...d.sourceRows].sort((a, b) => a - b)) ===
            hash(group.map((r) => r.source.row).sort((a, b) => a - b)),
      );
      if (
        proofs.length !== 1 ||
        group.some(
          (r) =>
            r.source.fileSha256 !== first.source.fileSha256 ||
            r.source.sheet !== first.source.sheet,
        )
      )
        issue('UNPROVEN_SALES_MULTIPLICITY', first.source);
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
  issues.push(...sourceAccountingIssues(input));
  return issues;
}

function sourceAccountingIssues(input: CanonicalInput): ImportPlan['issues'] {
  const issues: ImportPlan['issues'] = [];
  type PhysicalEntry = {
    source: CanonicalStockUnit['source'];
    sourceKey: string | null;
    reason?: CanonicalInput['excluded'][number]['reason'];
  };
  const physical = (sha: string, row: number) => hash([sha, row]);
  const primary = new Map<string, PhysicalEntry>();
  const kind = input.kind === 'STOCK' ? 'STOCK_SNAPSHOT' : 'SALES';
  const files = new Map(
    input.manifest.files.filter((f) => f.kind === kind).map((f) => [f.sha256, f]),
  );
  const issue = (code: string, source: PhysicalEntry['source'] | null) =>
    issues.push({ code, message: code, source });
  const retainedStores = new Map<string, string>();
  for (const r of input.rows) retainedStores.set(r.sourceKey, r.source.storeKey);
  // Decisions address a physical row in the file. Its worksheet/store must also agree on every copy.
  for (const entry of [
    ...input.rows,
    ...input.excluded.filter((e) => e.reason !== 'IDENTICAL_FILE_COPY'),
  ]) {
    const { source } = entry,
      key = physical(source.fileSha256, source.row);
    if (primary.has(key)) issue('MULTIPLE_PRIMARY_DISPOSITIONS', source);
    else primary.set(key, entry);
  }

  for (const e of input.excluded) {
    const { source } = e;
    if (
      files.get(source.fileSha256)?.storeKey !== source.storeKey ||
      !source.sheet ||
      !Number.isSafeInteger(source.row) ||
      source.row < 1
    ) {
      issue('UNPROVEN_EXCLUSION', source);
      continue;
    }
    if (e.reason === 'IDENTICAL_FILE_COPY') {
      const original = primary.get(physical(source.fileSha256, source.row));
      if (
        !original ||
        original.source.sheet !== source.sheet ||
        original.source.storeKey !== source.storeKey ||
        original.sourceKey !== e.sourceKey
      )
        issue('UNPROVEN_FILE_COPY', source);
      continue;
    }
    const evidence = input.decisions.entries.filter(
      (d) =>
        d.fileSha256 === source.fileSha256 &&
        d.action === e.reason &&
        d.sourceRows.includes(source.row),
    );
    if (
      evidence.length !== 1 ||
      (e.sourceKey !== null && retainedStores.get(e.sourceKey) !== source.storeKey)
    )
      issue('UNPROVEN_EXCLUSION', source);
  }

  for (const d of input.decisions.entries) {
    if (!files.has(d.fileSha256)) continue;
    if (d.action === 'REPORT_DUPLICATE') {
      const keep = primary.get(physical(d.fileSha256, d.keepRow));
      if (
        input.kind !== 'SALES' ||
        !keep ||
        keep.reason ||
        !keep.sourceKey ||
        !d.sourceRows.includes(d.keepRow) ||
        d.sourceRows.length < 2 ||
        d.sourceRows.some((row) => {
          if (row === d.keepRow) return false;
          const linked = primary.get(physical(d.fileSha256, row));
          return (
            linked?.reason !== 'REPORT_DUPLICATE' ||
            linked.sourceKey !== keep.sourceKey ||
            linked.source.sheet !== keep.source.sheet
          );
        })
      )
        issue('INVALID_REPORT_DUPLICATE_LINK', keep?.source ?? null);
    }
    if (
      ['SELECT_SNAPSHOT', 'SELECT_SALES', 'EXCLUDE_ROW', 'EXCLUDE_FILE'].includes(d.action) &&
      d.sourceRows.some((row) => !primary.has(physical(d.fileSha256, row)))
    )
      issue('UNACCOUNTED_SOURCE_ROW', null);
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
      if (batch?.status === 'ROLLED_BACK') throw Error('ROLLED_BACK_NEW_INSPECTED_RUN_REQUIRED');
      if (
        batch &&
        (batch.deletedAt ||
          batch.manifestHash !== manifestHash ||
          batch.codeRevision !== codeRevision)
      )
        throw Error('IMPORT_BATCH_INPUT_CHANGED');
      const batchId = batch?.id ?? randomUUID();
      const receipts = new Map(batch?.items.map((r) => [r.sourceKey, r]));
      const origins =
        input.kind === 'SALES'
          ? await readSaleOriginsFor(tx, {
              source: 'TOOLTIFY',
              orderNumber: { in: [...new Set(input.rows.map((r) => r.orderNumber))] },
            })
          : undefined;
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
                ...(input.decisions.entries.some(
                  (d) =>
                    d.action === 'DISTINCT_UNITS' &&
                    d.fileSha256 === row.source.fileSha256 &&
                    d.sourceRows.includes(row.source.row),
                )
                  ? {
                      multiplicityEvidence: input.decisions.entries.find(
                        (d) =>
                          d.action === 'DISTINCT_UNITS' &&
                          d.fileSha256 === row.source.fileSha256 &&
                          d.sourceRows.includes(row.source.row),
                      ),
                    }
                  : {}),
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
        const item = receipt
          ? await replayItem(tx, draft, receipt, origins)
          : await evaluateItem(tx, draft, origins);
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
      if (issues.some((i) => i.kind === kind && i.code === 'UNPROVEN_IMPORT_SCOPE'))
        reconciliationSnapshot.cannotVerifySource = true;
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
