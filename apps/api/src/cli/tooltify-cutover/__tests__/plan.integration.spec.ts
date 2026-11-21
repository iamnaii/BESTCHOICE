import { PrismaClient } from '@prisma/client';
import { hashImportValue, hashSourceDecisions } from '../canonicalize';
import type { CanonicalInput, CanonicalSaleLine, PlannedItem, TargetWriteResult } from '../types';
import { saleSourceKey } from '../../../modules/imported-sales/tooltify-sales-parser';
import { salesTargetFingerprint } from '../plan';
import { saleContent } from '../plan-targets';
import type { Prisma } from '@prisma/client';
import { afterAll, describe, expect, it } from 'vitest';
import { applyBatch } from '../batch';
import { buildImportPlan } from '../plan';
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
    const ready = await buildImportPlan(db, input);
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
