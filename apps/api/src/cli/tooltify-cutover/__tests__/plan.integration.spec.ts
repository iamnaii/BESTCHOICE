import { PrismaClient } from '@prisma/client';
import { hashImportValue, hashSourceDecisions } from '../canonicalize';
import type { CanonicalInput, CanonicalSaleLine, PlannedItem, TargetWriteResult } from '../types';
import { saleSourceKey } from '../../../modules/imported-sales/tooltify-sales-parser';
import { salesTargetFingerprint } from '../plan';
import { saleContent } from '../plan-targets';
import type { Prisma } from '@prisma/client';
import { afterAll, describe, expect, it } from 'vitest';
import { applyBatch } from '../batch';
import { assertImportDatabase, buildImportPlan } from '../plan';
import { createFixtureTarget, productData, stockInput } from './preflight-fixtures';

const db = new PrismaClient();
afterAll(() => db.$disconnect());

async function allCounts() {
  const tables = await db.$queryRaw<
    { name: string }[]
  >`select tablename as name from pg_tables where schemaname=current_schema() order by tablename`;
  return Promise.all(
    tables.map(async ({ name }) => {
      const rows = await db.$queryRawUnsafe<{ n: bigint }[]>(
        'select count(*) as n from "' + name.replaceAll('"', '""') + '"',
      );
      return [name, rows[0].n];
    }),
  );
}

async function salesInput(): Promise<Extract<CanonicalInput, { kind: 'SALES' }>> {
  const seed = await stockInput(db);
  const { source, barcode, branchId } = seed.rows[0],
    soldAt = new Date('2026-11-18T11:00:00+07:00');
  const row: CanonicalSaleLine = {
    source,
    sourceStoreKey: source.storeKey,
    sourceKey: '',
    occurrence: 1,
    barcode,
    orderNumber: seed.manifest.canonicalSetId,
    productName: 'Fixture sale',
    category: 'iPhone มือ 1',
    buyerLabel: 'synthetic',
    shopLabel: null,
    paymentType: 'CASH',
    priceGroup: 'ราคาปลีก',
    saleChannel: 'CASH',
    costTotal: '90.00',
    listPrice: '120.00',
    salePrice: '119.99',
    profit: '29.99',
    salespersonName: 'synthetic',
    soldAt,
  };
  row.sourceKey = saleSourceKey(row, 1);
  const decisions = {
    entries: [
      {
        ...seed.decisions.entries[0],
        action: 'SELECT_SALES' as const,
        storeKey: source.storeKey,
        branchId,
        reportFrom: '2026-11-18',
        reportTo: '2026-11-18',
      },
    ],
  };
  return {
    ...seed,
    kind: 'SALES',
    rows: [row],
    decisions,
    manifest: {
      ...seed.manifest,
      decisionsSha256: hashSourceDecisions(decisions),
      files: seed.manifest.files.map((f) => ({
        ...f,
        kind: 'SALES',
        reportFrom: '2026-11-18',
        reportTo: '2026-11-18',
      })),
    },
  };
}

function saleData(row: CanonicalSaleLine, batchId: string) {
  return {
    ...saleContent(row),
    costTotal: row.costTotal,
    listPrice: row.listPrice,
    salePrice: row.salePrice,
    profit: row.profit,
    source: 'TOOLTIFY',
    importBatch: batchId,
  };
}
async function fixtureSalesWriter(
  tx: Prisma.TransactionClient,
  item: PlannedItem,
): Promise<TargetWriteResult> {
  if (item.kind !== 'SALES') throw Error('expected sale');
  const sale = await tx.importedSale.create({ data: saleData(item.payload, item.batchId) });
  return {
    targetId: sale.id,
    targetType: 'IMPORTED_SALE',
    created: true,
    afterFingerprint: await salesTargetFingerprint(tx, sale.id),
  };
}
describe('legacy sale uniqueness and attribution', () => {
  it('rejects occurrence > 1 and bill collisions across stores', async () => {
    const input = await salesInput();
    input.rows[0].occurrence = 2;
    input.rows[0].sourceKey = saleSourceKey(input.rows[0], 2);
    expect((await buildImportPlan(db, input)).items[0].reason).toBe(
      'UNSUPPORTED_SALES_MULTIPLICITY',
    );
    const second = await salesInput();
    second.rows[0].orderNumber = input.rows[0].orderNumber;
    second.rows[0].sourceKey = saleSourceKey(second.rows[0], 1);
    const combined = await buildImportPlan(db, { ...input, rows: [...input.rows, ...second.rows] });
    expect(combined.issues.map((i) => i.code)).toContain('SALES_STORE_COLLISION');
  });
  it('freezes source and Bangkok canonical group totals, strips private labels, and gates incomplete evidence', async () => {
    const input = await salesInput();
    input.rows[0].soldAt = new Date('2026-10-31T18:00:00Z');
    const placement = input.decisions.entries.find((d) => d.action === 'SELECT_SALES')!;
    placement.reportFrom = '2026-11-01';
    input.manifest.files[0].reportFrom = placement.reportFrom;
    input.manifest.decisionsSha256 = hashSourceDecisions(input.decisions);
    input.rows[0].sourceKey = saleSourceKey(input.rows[0], 1);
    input.rows[0].buyerLabel = 'PRIVATE BUYER EXAMPLE';
    const base = await buildImportPlan(db, input);
    expect(base.reconciliationSnapshot.cannotVerifySource).toBe(true);
    const counts = {
      bills: 1,
      lines: 1,
      costTotal: '90.00',
      listPrice: '120.00',
      salePrice: '119.99',
      profit: '29.99',
    };
    const zero = {
      bills: 0,
      lines: 0,
      costTotal: '0.00',
      listPrice: '0.00',
      salePrice: '0.00',
      profit: '0.00',
    };
    const group = {
      month: '2026-11',
      channel: 'CASH',
      branchId: input.manifest.files[0].branchId!,
      totals: counts,
    };
    input.sourceSummary = {
      kind: 'SALES',
      reported: counts,
      detail: counts,
      delta: zero,
      groups: [group],
      evidenceFileSha256s: [input.rows[0].source.fileSha256],
    };
    const source = input.sourceSummary;
    input.sourceSummary = { ...source, groups: null };
    expect((await buildImportPlan(db, input)).reconciliationSnapshot.cannotVerifySource).toBe(true);
    input.sourceSummary = { ...source, delta: { ...zero, profit: '0.01' } };
    expect((await buildImportPlan(db, input)).reconciliationSnapshot.cannotVerifySource).toBe(true);
    input.sourceSummary = { ...source, groups: [{ ...group, branchId: 'unmapped' }] };
    await expect(buildImportPlan(db, input)).rejects.toThrow('INVALID_SOURCE_SUMMARY_SCOPE');
    input.sourceSummary = source;
    const withoutHistory = await buildImportPlan(db, input);
    const history = { branchId: group.branchId, reportFrom: '2026-11-01', reportTo: '2026-11-18' };
    const evidence = { ...history, evidenceRef: 'SYNTHETIC-PRIVATE-REF' };
    input.validatedHistory = [evidence];
    const ready = await buildImportPlan(db, input);
    expect(ready.planHash).not.toBe(withoutHistory.planHash);
    expect(ready.reconciliationSnapshot.history).toEqual([history]);
    expect(JSON.stringify(ready.reconciliationSnapshot)).not.toContain(evidence.evidenceRef);
    expect(ready.planHash).not.toBe(base.planHash);
    expect(ready.reconciliationSnapshot).toMatchObject({
      cannotVerifySource: false,
      canonical: { groups: [group], totals: counts },
    });
    const receipt = await applyBatch(db, ready, fixtureSalesWriter);
    const batch = await db.tooltifyImportBatch.findUniqueOrThrow({
      where: { id: receipt.batchId },
    });
    expect(batch.reconciliationSnapshot).toEqual(ready.reconciliationSnapshot);
    expect(JSON.stringify(batch.reconciliationSnapshot)).not.toContain('PRIVATE BUYER EXAMPLE');
    await expect(
      db.tooltifyImportBatch.update({
        where: { id: batch.id },
        data: { reconciliationSnapshot: {} },
      }),
    ).rejects.toThrow();
    input.sourceSummary = undefined;
    await expect(buildImportPlan(db, input)).rejects.toThrow('IMPORT_BATCH_PLAN_CHANGED');
  });
  it('blocks legacy rows with unproven source store', async () => {
    const input = await salesInput();
    await db.importedSale.create({ data: saleData(input.rows[0], 'legacy') });
    expect((await buildImportPlan(db, input)).items[0].reason).toBe('UNPROVEN_LEGACY_SALE_STORE');
  });
  it('MATCH requires the same evidenced store and exact historical payload', async () => {
    const input = await salesInput();
    const original = await buildImportPlan(db, input);
    expect(original.totals.sales).toMatchObject({ bills: 1, lines: 1, salePrice: '119.99' });
    await applyBatch(db, original, fixtureSalesWriter);
    input.manifest.canonicalSetId += '-next';
    const match = await buildImportPlan(db, input);
    expect(match.items[0].disposition).toBe('MATCH');
    await applyBatch(db, match, async () => {
      throw Error('MATCH invoked writer');
    });
    input.manifest.canonicalSetId += '-changed';
    input.rows[0].profit = '20.01';
    expect((await buildImportPlan(db, input)).items[0].reason).toBe('SALE_TARGET_CONFLICT');
    const other = await salesInput();
    other.rows[0].orderNumber = input.rows[0].orderNumber;
    other.rows[0].sourceKey = saleSourceKey(other.rows[0], 1);
    expect((await buildImportPlan(db, other)).items[0].reason).toBe('SALES_STORE_COLLISION');
  });
});

async function expectBlockedBeforeBatch(input: CanonicalInput) {
  const plan = await buildImportPlan(db, input);
  expect(plan.issues.length).toBeGreaterThan(0);
  await expect(applyBatch(db, plan, createFixtureTarget)).rejects.toThrow(
    'IMPORT_PLAN_BLOCKED_OR_CHANGED',
  );
  expect(await db.tooltifyImportBatch.count({ where: { id: plan.batchId } })).toBe(0);
}
describe('source accounting', () => {
  it.each(['lone copy', 'two primary exclusions', 'copy with a wrong link'] as const)(
    'rejects %s',
    async (fault) => {
      const input: CanonicalInput = await stockInput(db);
      const row = input.rows[0];
      if (fault === 'lone copy') input.rows = [];
      if (fault === 'two primary exclusions') {
        input.rows = [];
        input.decisions.entries.push({ ...input.decisions.entries[0], action: 'EXCLUDE_ROW' });
        input.manifest.decisionsSha256 = hashSourceDecisions(input.decisions);
        input.excluded.push(
          ...[1, 2].map(() => ({
            source: row.source,
            sourceKey: null,
            reason: 'EXCLUDE_ROW' as const,
          })),
        );
      } else
        input.excluded.push({
          source: row.source,
          sourceKey: fault === 'lone copy' ? row.sourceKey : 'bad',
          reason: 'IDENTICAL_FILE_COPY',
        });
      await expectBlockedBeforeBatch(input);
    },
  );
  it.each(['keep row excluded', 'wrong canonical link', 'valid duplicate and copies'] as const)(
    '%s',
    async (variant) => {
      const input = await salesInput();
      const keep = input.rows[0],
        duplicate = keep.source.row + 1;
      const selection = input.decisions.entries[0];
      selection.sourceRows = [keep.source.row, duplicate];
      input.decisions.entries.push({
        ...selection,
        action: 'REPORT_DUPLICATE',
        keepRow: keep.source.row,
      });
      input.manifest.decisionsSha256 = hashSourceDecisions(input.decisions);
      const excluded = {
        source: { ...keep.source, row: duplicate },
        sourceKey: keep.sourceKey,
        reason: 'REPORT_DUPLICATE' as const,
      };
      if (variant === 'keep row excluded') {
        input.rows[0] = { ...keep, source: excluded.source };
        input.excluded.push({ ...excluded, source: keep.source });
      } else
        input.excluded.push({
          ...excluded,
          sourceKey: variant === 'wrong canonical link' ? 'wrong' : keep.sourceKey,
        });
      if (variant !== 'valid duplicate and copies') return expectBlockedBeforeBatch(input);
      input.excluded.push(
        { ...excluded, reason: 'IDENTICAL_FILE_COPY' },
        { ...excluded, source: keep.source, reason: 'IDENTICAL_FILE_COPY' },
      );
      const plan = await buildImportPlan(db, input);
      expect(plan.issues).toEqual([]);
      expect(await applyBatch(db, plan, fixtureSalesWriter)).toMatchObject({
        created: 1,
        excluded: 3,
      });
    },
  );
});

describe('source group evidence', () => {
  it.each([
    ['two stores, one reported bill', 1, false, true],
    ['two stores, two reported bills', 2, false, false],
    ['two possible stores for one branch', 2, true, true],
  ] as const)('%s', async (_case, reportedBills, ambiguous, cannotVerify) => {
    const input = await salesInput(),
      other = await salesInput();
    const branchA = input.manifest.files[0].branchId!;
    const branchB = ambiguous ? branchA : other.manifest.files[0].branchId!;
    const fileB = {
      ...other.manifest.files[0],
      path: 'fixture-b.xlsx',
      sha256: 'b'.repeat(64),
      branchId: branchB,
    };
    input.manifest.files.push(fileB);
    const rowB = other.rows[0];
    rowB.source.fileSha256 = fileB.sha256;
    rowB.saleChannel = 'OTHER';
    rowB.priceGroup = 'Fixture';
    input.rows.push(rowB);
    const selection = other.decisions.entries.find((d) => d.action === 'SELECT_SALES')!;
    input.decisions.entries.push({ ...selection, fileSha256: fileB.sha256, branchId: branchB });
    input.manifest.decisionsSha256 = hashSourceDecisions(input.decisions);
    const unit = {
      bills: 1,
      lines: 1,
      costTotal: '90.00',
      listPrice: '120.00',
      salePrice: '119.99',
      profit: '29.99',
    };
    const overall = {
      bills: reportedBills,
      lines: 2,
      costTotal: '180.00',
      listPrice: '240.00',
      salePrice: '239.98',
      profit: '59.98',
    };
    input.sourceSummary = {
      kind: 'SALES',
      detail: overall,
      reported: overall,
      delta: {
        bills: 0,
        lines: 0,
        costTotal: '0.00',
        listPrice: '0.00',
        salePrice: '0.00',
        profit: '0.00',
      },
      groups: [
        { month: '2026-11', branchId: branchA, channel: 'CASH', totals: unit },
        { month: '2026-11', branchId: branchB, channel: 'OTHER', totals: unit },
      ],
      evidenceFileSha256s: input.manifest.files.map((f) => f.sha256),
    };
    const plan = await buildImportPlan(db, input);
    expect(plan.issues).toEqual([]);
    expect(plan.reconciliationSnapshot.cannotVerifySource).toBe(cannotVerify);
  });
  it.each(['missing SKU', 'unexpected device SKU', 'negative units', 'valid accessory'] as const)(
    'checks %s',
    async (variant) => {
      const input: Extract<CanonicalInput, { kind: 'STOCK' }> = await stockInput(db);
      const totals = { units: variant === 'negative units' ? -1 : 1, cost: '20.00' };
      input.sourceSummary = {
        kind: 'STOCK',
        reported: totals,
        detail: totals,
        delta: { units: 0, cost: '0.00' },
        groups: [
          {
            branchId: input.rows[0].branchId,
            kind: variant === 'unexpected device SKU' ? 'DEVICE' : 'ACCESSORY',
            skuHash: variant === 'missing SKU' ? null : hashImportValue('sku'),
            totals,
          },
        ],
        evidenceFileSha256s: [input.rows[0].source.fileSha256],
      };
      expect((await buildImportPlan(db, input)).reconciliationSnapshot.cannotVerifySource).toBe(
        variant !== 'valid accessory',
      );
    },
  );
  it.each([
    ['more bills than lines', 4, 2, 2],
    ['zero bills in a nonempty group', 2, 0, 2],
    ['below a group count', 1, 2, 1],
    ['above all grouped bills', 3, 1, 1],
    ['negative bills', -1, -1, -1],
    ['overlapping bills', 2, 2, 1],
  ] as const)('checks %s', async (label, bills, a, b) => {
    const input = await salesInput();
    const zero = {
      bills: 0,
      lines: 0,
      costTotal: '0.00',
      listPrice: '0.00',
      salePrice: '0.00',
      profit: '0.00',
    };
    const total = { ...zero, bills, lines: 3 };
    input.sourceSummary = {
      kind: 'SALES',
      reported: total,
      detail: total,
      delta: zero,
      groups: [
        {
          month: '2026-11',
          branchId: input.manifest.files[0].branchId!,
          channel: 'CASH',
          totals: { ...zero, bills: a, lines: 2 },
        },
        {
          month: '2026-11',
          branchId: input.manifest.files[0].branchId!,
          channel: 'OTHER',
          totals: { ...zero, bills: b, lines: 1 },
        },
      ],
      evidenceFileSha256s: [input.rows[0].source.fileSha256],
    };
    expect((await buildImportPlan(db, input)).reconciliationSnapshot.cannotVerifySource).toBe(
      label !== 'overlapping bills',
    );
  });
});

describe('DB-backed dry-run', () => {
  it('matches_existing_imei_without_legacy_prefix', async () => {
    const input = await stockInput(db);
    const existingProduct = await db.product.create({ data: productData(input.rows[0]) });
    const beforeCount = await db.product.count();
    const counts = await allCounts();
    const plan = await buildImportPlan(db, input);
    expect(plan.items[0]).toMatchObject({ disposition: 'MATCH', targetId: existingProduct.id });
    expect(await db.product.count()).toBe(beforeCount);
    expect(await allCounts()).toEqual(counts);
    expect((await buildImportPlan(db, input)).planHash).toBe(plan.planHash);
    await applyBatch(db, plan, async () => {
      throw Error('MATCH wrote a target');
    });
    expect(await db.product.findUniqueOrThrow({ where: { id: existingProduct.id } })).toEqual(
      existingProduct,
    );
    await expect(
      db.tooltifyImportBatch.update({ where: { id: plan.batchId }, data: { status: 'VERIFIED' } }),
    ).rejects.toThrow();
  });
  it.each(['deleted', 'SOLD_CASH', 'RESERVED'] as const)('blocks %s targets', async (status) => {
    const input = await stockInput(db);
    await db.product.create({
      data: {
        ...productData(input.rows[0]),
        ...(status === 'deleted' ? { deletedAt: new Date() } : { status }),
      },
    });
    expect((await buildImportPlan(db, input)).items[0].disposition).toBe('CONFLICT');
  });
  it('rejects a changed MATCH target before provenance is committed', async () => {
    const input = await stockInput(db);
    const target = await db.product.create({ data: productData(input.rows[0]) });
    const plan = await buildImportPlan(db, input);
    await db.product.update({ where: { id: target.id }, data: { cashPrice: '201.00' } });
    await expect(applyBatch(db, plan, createFixtureTarget)).rejects.toThrow();
    expect(await db.tooltifyImportItem.count({ where: { batchId: plan.batchId } })).toBe(0);
  });
  it.each(['unknown category', 'unevidenced reservation'])(
    'blocks %s before stock apply',
    async (variant) => {
      const input = await stockInput(db);
      if (variant === 'unknown category') {
        Object.assign(input.rows[0], { category: 'UNKNOWN' });
      } else {
        input.rows[0].sourceStatus = 'RESERVED';
      }
      const plan = await buildImportPlan(db, input);
      expect(plan.issues.map((i) => i.code)).toContain('INVALID_CANONICAL_STOCK');
      await expect(applyBatch(db, plan, createFixtureTarget)).rejects.toThrow(
        'IMPORT_PLAN_BLOCKED_OR_CHANGED',
      );
      expect(await db.tooltifyImportBatch.count({ where: { id: plan.batchId } })).toBe(0);
    },
  );
  it('refuses the wrong expected database', async () => {
    const input = await stockInput(db);
    await expect(buildImportPlan(db, { ...input, expectedDbIdentity: 'wrong' })).rejects.toThrow();
  });
  it('blocks an active online hold even if the product status still shows IN_STOCK', async () => {
    const input = await stockInput(db);
    const product = await db.product.create({ data: productData(input.rows[0]) });
    await db.productReservation.create({
      data: { productId: product.id, sessionId: 'test', expiresAt: new Date(Date.now() + 60000) },
    });
    expect((await buildImportPlan(db, input)).items[0].reason).toBe('HELD_STOCK_TARGET');
  });
  it('reselects templates and rejects a new higher-priority origin match', async () => {
    const input = await stockInput(db),
      row = input.rows[0];
    row.model = input.manifest.canonicalSetId;
    const base = {
      category: 'PHONE_NEW' as const,
      brand: row.brand,
      model: row.model,
      cashPrice: '120',
      installmentBestchoicePrice: '140',
      installmentFinancePrice: '150',
    };
    const fallback = await db.pricingTemplate.create({ data: base });
    const d = input.decisions.entries.find((e) => e.action === 'RESOLVE_STOCK')!;
    d.deviceOrigin = 'IMPORTED';
    d.pricing = { mode: 'TEMPLATE' };
    input.manifest.decisionsSha256 = hashSourceDecisions(input.decisions);
    const plan = await buildImportPlan(db, input);
    expect(plan.items[0]).toMatchObject({
      disposition: 'CREATE',
      resolution: { templateId: fallback.id },
      payload: { deviceOrigin: 'IMPORTED', cashPrice: '120.00', financePrice: '150.00' },
    });
    expect(row.cashPrice).toBeNull();
    await db.pricingTemplate.create({
      data: { ...base, deviceOrigin: 'IMPORTED', cashPrice: '121' },
    });
    await expect(applyBatch(db, plan, createFixtureTarget)).rejects.toThrow('DEPENDENCY_CHANGED');
    expect(await db.tooltifyImportBatch.count({ where: { id: plan.batchId } })).toBe(0);
  });
  it('requires evidenced quantities and explicit target IDs for accessories', async () => {
    const input = await stockInput(db, 2);
    const sku = 'A-PACK';
    for (const row of input.rows) {
      row.kind = 'ACCESSORY';
      row.category = 'ACCESSORY';
      row.barcode = sku;
      row.sourceKey = hashImportValue([
        input.manifest.canonicalSetId,
        row.source.fileSha256,
        row.source.sheet,
        row.source.row,
        1,
      ]);
    }
    const target = await db.product.create({
      data: {
        ...productData(input.rows[0]),
        imeiSerial: null,
        legacyProductCode: 'TTFY-' + sku + '-1',
      },
    });
    const first = await buildImportPlan(db, input);
    expect(first.issues.map((i) => i.code)).toContain('ACCESSORY_MAPPING_REQUIRED');
    const assignments = input.rows.map((r) => ({
      row: r.source.row,
      targetId: null as string | null,
    }));
    const d = {
      ...input.decisions.entries[0],
      action: 'MAP_ACCESSORY_UNITS' as const,
      sku,
      checkedQuantity: 2,
      assignments,
    };
    input.decisions.entries.push(d);
    input.manifest.decisionsSha256 = hashSourceDecisions(input.decisions);
    expect((await buildImportPlan(db, input)).issues.map((i) => i.code)).toContain(
      'ACCESSORY_MAPPING_CONFLICT',
    );
    assignments[0].targetId = target.id;
    input.manifest.decisionsSha256 = hashSourceDecisions(input.decisions);
    const approved = await buildImportPlan(db, input);
    expect(approved.issues).toEqual([]);
    expect(approved.items.map((i) => i.disposition)).toEqual(['MATCH', 'CREATE']);
    d.checkedQuantity = 3;
    input.manifest.decisionsSha256 = hashSourceDecisions(input.decisions);
    expect((await buildImportPlan(db, input)).issues.map((i) => i.code)).toContain(
      'INVALID_ACCESSORY_MAPPING',
    );
  });
  it('blocks missing source decisions, fabricated raw prices and omitted selected rows', async () => {
    const input = await stockInput(db, 2);
    input.rows.pop();
    input.rows[0].cashPrice = '300.00';
    input.decisions.entries = input.decisions.entries.filter((d) => d.action !== 'RESOLVE_STOCK');
    input.manifest.decisionsSha256 = hashSourceDecisions(input.decisions);
    const plan = await buildImportPlan(db, input);
    expect(plan.issues.map((i) => i.code)).toEqual(
      expect.arrayContaining([
        'UNRESOLVED_STOCK_DECISION',
        'INVALID_CANONICAL_STOCK',
        'UNACCOUNTED_SOURCE_ROW',
      ]),
    );
    await expect(applyBatch(db, plan, createFixtureTarget)).rejects.toThrow();
  });
  it.each(['indisvalid', 'indisready'])('refuses a matching index with %s=false', async (flag) => {
    const input = await stockInput(db);
    // Simulate an interrupted concurrent build without modifying the database's system catalogs.
    const actualQueries = new Proxy(db, {
      get(target, prop) {
        if (prop !== '$queryRaw') return Reflect.get(target, prop);
        return async (sql: TemplateStringsArray, ...args: unknown[]) => {
          const rows = await db.$queryRaw<Record<string, unknown>[]>(sql, ...args);
          return rows.map((r) =>
            r.indexname === 'product_prices_one_default' ? { ...r, [flag]: false } : r,
          );
        };
      },
    });
    await expect(assertImportDatabase(actualQueries, input.expectedDbIdentity)).rejects.toThrow(
      'IMPORT_SCHEMA_INDEX_MISMATCH',
    );
  });
  it('retains production partial unique indexes', async () => {
    const indexes = await db.$queryRaw<
      { indexdef: string }[]
    >`select indexdef from pg_indexes where schemaname=current_schema() and indexname in ('products_imei_serial_active_unique','product_prices_one_default') order by indexname`;
    expect(indexes.map((i) => i.indexdef)).toEqual([
      expect.stringMatching(
        /UNIQUE.+\(product_id\) WHERE \(is_default AND \(deleted_at IS NULL\)\)/,
      ),
      expect.stringMatching(/UNIQUE.+\(imei_serial\) WHERE \(deleted_at IS NULL\)/),
    ]);
  });
});
