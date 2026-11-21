import { Prisma, PrismaClient } from '@prisma/client';
import { afterAll, expect, it, vi } from 'vitest';
import { hasSellingPrice } from '../../../modules/products/product-enter-stock.util';
import * as priceSync from '../../../utils/product-price-sync.util';
import { applyBatch } from '../batch';
import { hashImportValue, hashSourceDecisions } from '../canonicalize';
import { buildImportPlan, stockTargetFingerprint } from '../plan';
import { writeStockItem } from '../stock-writer';
import type { PlannedItem, PlannedStockItem } from '../types';
import { productData, stockInput } from './preflight-fixtures';

const db = new PrismaClient();
afterAll(() => db.$disconnect());
type Input = Awaited<ReturnType<typeof stockInput>>;

function stock(item: PlannedItem): PlannedStockItem {
  if (item.kind !== 'STOCK') throw Error('expected stock');
  return item;
}
function write(tx: Prisma.TransactionClient, item: PlannedItem) {
  return writeStockItem(tx, stock(item));
}
function planFor(input: Input) {
  input.manifest.decisionsSha256 = hashSourceDecisions(input.decisions);
  return buildImportPlan(db, input);
}
function decision(input: Input) {
  return input.decisions.entries.find((entry) => entry.action === 'RESOLVE_STOCK')!;
}
function protectedCounts() {
  return Promise.all([
    db.importedSale.count(),
    db.sale.count(),
    db.contract.count(),
    db.payment.count(),
    db.salesCommission.count(),
    db.externalFinanceCommission.count(),
    db.journalEntry.count(),
    db.journalLine.count(),
    db.goodsReceivingItem.count(),
  ]);
}
function templateFor(row: Input['rows'][number]) {
  return db.pricingTemplate.create({
    data: {
      brand: row.brand,
      model: row.model,
      category: row.category,
      storage: '',
      cashPrice: '201.11',
      installmentBestchoicePrice: '212.22',
      installmentFinancePrice: '233.33',
    },
  });
}

it('creates one verified snapshot unit despite two historical sales of the same IMEI', async () => {
  const input = await stockInput(db);
  const row = input.rows[0];
  row.category = 'PHONE_USED';
  row.deviceOrigin = 'IMPORTED';
  row.model = input.manifest.canonicalSetId;
  row.storage = '128 GB';
  row.color = 'Black';
  decision(input).deviceOrigin = 'IMPORTED';
  decision(input).pricing = { mode: 'TEMPLATE' };
  const template = await templateFor(row);
  await db.importedSale.createMany({
    data: [1, 2].map((n) => ({
      source: 'TOOLTIFY',
      barcode: row.barcode,
      productName: row.name,
      category: 'synthetic',
      buyerLabel: 'fixture',
      orderNumber: 'fixture-' + n,
      paymentType: 'CASH',
      priceGroup: 'fixture',
      saleChannel: 'CASH',
      costTotal: '90',
      listPrice: '121',
      salePrice: '120',
      profit: '30',
      salespersonName: 'fixture',
      soldAt: new Date('2026-10-0' + n + 'T12:00:00+07:00'),
      importBatch: 'historical-fixture',
    })),
  });
  const before = await protectedCounts();
  const plan = await planFor(input);
  expect(plan.issues).toEqual([]);
  const receipt = await applyBatch(db, plan, write);
  expect(receipt.created).toBe(1);
  const [product] = await db.product.findMany({
    where: { imeiSerial: row.barcode },
    include: { prices: true },
  });
  expect(await db.product.count({ where: { imeiSerial: row.barcode } })).toBe(1);
  const shop = await db.companyInfo.findUniqueOrThrow({ where: { companyCode: 'SHOP' } });
  expect(product).toMatchObject({
    category: 'PHONE_USED',
    deviceOrigin: 'IMPORTED',
    name: row.name,
    model: row.model,
    brand: row.brand,
    color: row.color,
    storage: row.storage,
    branchId: row.branchId,
    ownedByCompanyId: shop.id,
    stockInDate: new Date(row.importedAt),
    status: 'IN_STOCK',
    legacyProductCode: 'TTFY-CUTOVER:' + receipt.batchId + ':' + row.sourceKey,
    priceAutofilledAt: expect.any(Date),
  });
  expect(product.costPrice.toFixed(2)).toBe(row.cost);
  const expected = [
    [priceSync.CASH_LABEL, product.cashPrice, '201.11', true],
    [priceSync.INSTALLMENT_LABEL, product.installmentPrice, '212.22', false],
    [priceSync.FINANCE_LABEL, product.financePrice, '233.33', false],
  ] as const;
  expect(product.prices).toHaveLength(3);
  for (const [label, column, value, isDefault] of expected) {
    expect(column?.toFixed(2)).toBe(value);
    const price = product.prices.find((p) => p.label === label);
    expect(price).toMatchObject({ isDefault, deletedAt: null });
    expect(price?.amount.toFixed(2)).toBe(value);
  }
  const item = await db.tooltifyImportItem.findFirstOrThrow({
    where: { batchId: receipt.batchId },
  });
  expect(item).toMatchObject({
    targetType: 'PRODUCT',
    targetId: product.id,
    disposition: 'CREATE',
    sourceRefs: [row.source],
    afterFingerprint: await stockTargetFingerprint(db, product.id),
    stockResolution: { templateId: template.id, companyId: shop.id },
  });
  expect(await protectedCounts()).toEqual(before);
});

it('keeps the evidenced installment as the default and explicit cash null even with a matching template', async () => {
  const input = await stockInput(db);
  const row = input.rows[0];
  row.model = input.manifest.canonicalSetId;
  await templateFor(row);
  decision(input).pricing = {
    mode: 'EXPLICIT',
    cashPrice: null,
    installmentPrice: '175.99',
    financePrice: '200.06',
  };
  await applyBatch(db, await planFor(input), write);
  const p = await db.product.findFirstOrThrow({
    where: { imeiSerial: row.barcode },
    include: { prices: true },
  });
  expect(p.cashPrice).toBeNull();
  expect(p.priceAutofilledAt).toBeNull();
  expect(p.installmentPrice?.toFixed(2)).toBe('175.99');
  expect(p.financePrice?.toFixed(2)).toBe('200.06');
  expect(p.prices).toHaveLength(2);
  expect(p.prices.filter((r) => r.isDefault).map((r) => r.label)).toEqual([
    priceSync.INSTALLMENT_LABEL,
  ]);
});

it('does_not_publish_an_unpriced_device', async () => {
  const input = await stockInput(db);
  input.rows[0].model = input.manifest.canonicalSetId;
  decision(input).pricing = { mode: 'TEMPLATE' };
  const unpricedItem = stock((await planFor(input)).items[0]);
  expect(unpricedItem.resolution.templateId).toBeNull();
  await expect(db.$transaction((tx) => writeStockItem(tx, unpricedItem))).rejects.toThrow(
    'MISSING_SELLING_PRICE',
  );
  expect(await db.product.count({ where: { imeiSerial: unpricedItem.payload.barcode } })).toBe(0);
});

it('keeps a finance-only QC unit unsellable and refuses to publish the same prices', async () => {
  const input = await stockInput(db);
  const d = decision(input);
  d.pricing = { mode: 'EXPLICIT', cashPrice: null, installmentPrice: null, financePrice: '150.50' };
  const blocked = await planFor(input);
  expect(stock(blocked.items[0]).reason).toBe('MISSING_SELLING_PRICE');
  await expect(applyBatch(db, blocked, write)).rejects.toThrow('IMPORT_PLAN_BLOCKED_OR_CHANGED');
  d.desiredStatus = 'QC_PENDING';
  await applyBatch(db, await planFor(input), write);
  const p = await db.product.findFirstOrThrow({
    where: { imeiSerial: input.rows[0].barcode },
    include: { prices: true },
  });
  expect(p).toMatchObject({ status: 'QC_PENDING', cashPrice: null, installmentPrice: null });
  expect(p.prices).toHaveLength(1);
  expect(p.prices[0]).toMatchObject({ label: priceSync.FINANCE_LABEL, isDefault: false });
  expect(hasSellingPrice(p)).toBe(false);
});

it('keeps installment empty when the selected template has zero cash and a positive installment', async () => {
  const input = await stockInput(db);
  const row = input.rows[0];
  row.model = input.manifest.canonicalSetId;
  const template = await templateFor(row);
  await db.pricingTemplate.update({ where: { id: template.id }, data: { cashPrice: '0' } });
  const d = decision(input);
  d.pricing = { mode: 'TEMPLATE' };
  const blocked = await planFor(input);
  expect(stock(blocked.items[0])).toMatchObject({
    disposition: 'CONFLICT',
    reason: 'MISSING_SELLING_PRICE',
    resolution: {
      templateId: template.id,
      cashPrice: null,
      installmentPrice: null,
      financePrice: '233.33',
    },
  });
  await expect(applyBatch(db, blocked, write)).rejects.toThrow('IMPORT_PLAN_BLOCKED_OR_CHANGED');
  expect(await db.product.count({ where: { imeiSerial: row.barcode } })).toBe(0);

  d.desiredStatus = 'QC_PENDING';
  await applyBatch(db, await planFor(input), write);
  const product = await db.product.findFirstOrThrow({
    where: { imeiSerial: row.barcode },
    include: { prices: true },
  });
  expect(product).toMatchObject({
    status: 'QC_PENDING',
    cashPrice: null,
    installmentPrice: null,
    priceAutofilledAt: null,
  });
  expect(product.financePrice?.toFixed(2)).toBe('233.33');
  expect(product.prices).toHaveLength(1);
  expect(product.prices[0]).toMatchObject({ label: priceSync.FINANCE_LABEL, isDefault: false });
  expect(product.prices[0].amount.toFixed(2)).toBe('233.33');
  expect(hasSellingPrice(product)).toBe(false);
});

it('creates one accessory per mapped physical unit and replays the same durable receipts', async () => {
  const input = await stockInput(db, 3);
  for (const row of input.rows) {
    row.category = 'ACCESSORY';
    row.kind = 'ACCESSORY';
    row.barcode = 'CASE';
    row.sourceKey = hashImportValue([
      input.manifest.canonicalSetId,
      row.source.fileSha256,
      row.source.sheet,
      row.source.row,
      1,
    ]);
  }
  input.decisions.entries.push({
    ...decision(input),
    action: 'MAP_ACCESSORY_UNITS',
    checkedQuantity: 3,
    sku: 'CASE',
    assignments: input.rows.map((r) => ({ row: r.source.row, targetId: null })),
  });
  const plan = await planFor(input);
  const receipt = await applyBatch(db, plan, write);
  const spy = vi.fn(write);
  expect(await applyBatch(db, plan, spy)).toEqual(receipt);
  expect(spy).not.toHaveBeenCalled();
  expect(receipt.created).toBe(3);
  const products = await db.product.findMany({ where: { branchId: input.rows[0].branchId } });
  expect(products).toHaveLength(3);
  expect(products.every((p) => p.category === 'ACCESSORY' && p.imeiSerial === null)).toBe(true);
  expect(products.map((p) => p.legacyProductCode).sort()).toEqual(
    input.rows.map((r) => 'TTFY-CUTOVER:' + receipt.batchId + ':' + r.sourceKey).sort(),
  );
});

it('MATCH preserves the complete existing Product and price rows', async () => {
  const input = await stockInput(db);
  const existing = await db.product.create({
    data: {
      ...productData(input.rows[0]),
      prices: { create: { label: priceSync.CASH_LABEL, amount: '200', isDefault: true } },
    },
    include: { prices: true },
  });
  const plan = await planFor(input);
  const spy = vi.fn(write);
  expect(await applyBatch(db, plan, spy)).toMatchObject({ created: 0, matched: 1 });
  expect(spy).not.toHaveBeenCalled();
  expect(
    await db.product.findUniqueOrThrow({ where: { id: existing.id }, include: { prices: true } }),
  ).toEqual(existing);
});

it.each(['deleted', 'sold', 'held'])('keeps a %s target intact', async (variant) => {
  const input = await stockInput(db);
  const p = await db.product.create({
    data: {
      ...productData(input.rows[0]),
      ...(variant === 'deleted' ? { deletedAt: new Date() } : {}),
      ...(variant === 'sold' ? { status: 'SOLD_CASH' as const } : {}),
    },
  });
  if (variant === 'held')
    await db.productReservation.create({
      data: {
        productId: p.id,
        sessionId: 'fixture',
        expiresAt: new Date(Date.now() + 3600000),
      },
    });
  const blocked = await planFor(input);
  expect(blocked.items[0].disposition).toBe('CONFLICT');
  await expect(applyBatch(db, blocked, write)).rejects.toThrow('IMPORT_PLAN_BLOCKED_OR_CHANGED');
  expect(await db.product.findMany({ where: { imeiSerial: input.rows[0].barcode } })).toEqual([p]);
});

it('requires a fresh plan when the selected template price changes', async () => {
  const input = await stockInput(db);
  input.rows[0].model = input.manifest.canonicalSetId;
  decision(input).pricing = { mode: 'TEMPLATE' };
  const template = await templateFor(input.rows[0]);
  const plan = await planFor(input);
  await db.pricingTemplate.update({ where: { id: template.id }, data: { cashPrice: '499' } });
  await expect(applyBatch(db, plan, write)).rejects.toThrow('IMPORT_DEPENDENCY_CHANGED');
  expect(await db.product.count({ where: { imeiSerial: input.rows[0].barcode } })).toBe(0);
});

it.each(['failure', 'unpriced'])(
  'rolls back Product, Price and Item after pricing helper %s',
  async (variant) => {
    const input = await stockInput(db);
    const plan = await planFor(input);
    const before = await db.productPrice.count();
    const sync = priceSync.syncPriceRowsFromColumns;
    const spy = vi
      .spyOn(priceSync, 'syncPriceRowsFromColumns')
      .mockImplementationOnce(async (tx, id, columns) => {
        const rows = await sync(tx, id, columns);
        expect(rows.cashRowId).toBeTruthy();
        if (variant === 'failure') throw Error('injected pricing failure');
        // Simulate a helper losing the price after sync. The publishing gate must read persisted live rows.
        await tx.product.update({ where: { id }, data: { cashPrice: null } });
        await tx.productPrice.updateMany({
          where: { productId: id },
          data: { deletedAt: new Date() },
        });
        return rows;
      });
    try {
      await expect(applyBatch(db, plan, write)).rejects.toThrow(
        variant === 'failure' ? 'injected pricing failure' : 'MISSING_SELLING_PRICE',
      );
    } finally {
      spy.mockRestore();
    }
    expect(await db.product.count({ where: { imeiSerial: input.rows[0].barcode } })).toBe(0);
    expect(await db.productPrice.count()).toBe(before);
    expect(await db.tooltifyImportItem.count({ where: { batchId: plan.batchId } })).toBe(0);
  },
);
