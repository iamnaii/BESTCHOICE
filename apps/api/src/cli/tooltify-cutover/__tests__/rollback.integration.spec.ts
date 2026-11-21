import { randomUUID } from 'node:crypto';
import { afterAll, expect, it } from 'vitest';
import { seedShopCoa } from '../../../../prisma/seed-coa-shop';
import { JournalAutoService } from '../../../modules/journal/journal-auto.service';
import { CompanyResolverService } from '../../../modules/journal/company-resolver.service';
import { ShopAccountResolver } from '../../../modules/journal/shop-account-resolver.service';
import { ShopCashSaleTemplate } from '../../../modules/journal/cpa-templates/shop-cash-sale.template';
import { ShopExternalFinanceSaleTemplate } from '../../../modules/journal/cpa-templates/shop-external-finance-sale.template';
import { SalesService } from '../../../modules/sales/sales.service';
import { applyBatch } from '../batch';
import { buildImportPlan } from '../plan';
import { planRollback, applyRollback } from '../rollback';
import { productData, stockInput } from './preflight-fixtures';
import { frozen, harnessClient, writer } from './rollback-fixtures';

const db = harnessClient();
afterAll(() => db.$disconnect());
async function imported(count = 1, match = false) {
  const input = await stockInput(db, count);
  const existing = match ? await db.product.create({ data: productData(input.rows[0]) }) : null;
  const plan = await buildImportPlan(db, input);
  await applyBatch(db, plan, writer);
  const rollback = await planRollback(db, plan.batchId);
  expect(rollback.blockers).toEqual([]);
  return { input, plan, rollback, existing, productId: rollback.targets[0].targetId };
}
it('soft-deletes only owned products and prices atomically, tombstones receipts and rejects replay', async () => {
  const { input, plan, rollback, existing, productId } = await imported(2, true);
  expect(rollback.targets).toHaveLength(1);
  const receipt = await frozen(() => applyRollback(db, rollback));
  expect(receipt).toMatchObject({ products: 1, importedSales: 0, prices: 1 });
  const p = await db.product.findUniqueOrThrow({
    where: { id: productId },
    include: { prices: true },
  });
  expect(p.deletedAt).toBeInstanceOf(Date);
  expect(p.prices[0].deletedAt).toEqual(p.deletedAt);
  expect(await db.product.findUniqueOrThrow({ where: { id: existing!.id } })).toEqual(existing);
  const items = await db.tooltifyImportItem.findMany({ where: { batchId: plan.batchId } });
  expect(items).toHaveLength(2);
  for (const i of items) {
    expect(i.reversedAt).toEqual(p.deletedAt);
    expect(i.deletedAt).toBeNull();
    expect(i.afterFingerprint).toBeTruthy();
  }
  expect(await frozen(() => applyRollback(db, rollback))).toMatchObject({ products: 0, prices: 0 });
  await expect(buildImportPlan(db, input)).rejects.toThrow(
    'ROLLED_BACK_NEW_INSPECTED_RUN_REQUIRED',
  );
  await expect(applyBatch(db, plan, writer)).rejects.toThrow(
    'ROLLED_BACK_NEW_INSPECTED_RUN_REQUIRED',
  );
});
it('blocks_rollback_after_real_use', async () => {
  const { input, rollback, productId, plan } = await imported(2);
  await seedShopCoa(db);
  const branchId = input.rows[0].branchId;
  const user = await db.user.create({
    data: { email: 'admin@bestchoice.com', password: 'x', name: 'Fixture', role: 'OWNER' },
  });
  const customer = await db.customer.create({
    data: { name: 'Fixture', phone: '0000000000', nationalId: randomUUID() },
  });
  const journal = new JournalAutoService(db as never),
    resolver = new CompanyResolverService(db as never);
  const pos = new SalesService(
    db as never,
    null as never,
    new ShopCashSaleTemplate(journal, db as never, resolver),
    new ShopAccountResolver(db as never),
    new ShopExternalFinanceSaleTemplate(journal, db as never, resolver),
    { notify: async () => {} } as never,
  );
  await pos.create(
    {
      saleType: 'CASH',
      customerId: customer.id,
      productId,
      branchId,
      sellingPrice: 200,
      paymentMethod: 'BANK_TRANSFER',
      downPaymentReference: randomUUID(),
      amountReceived: 200,
    } as never,
    user.id,
    'OWNER',
  );
  const sale = await db.sale.findFirstOrThrow({ where: { productId } });
  const journalEntry = await db.journalEntry.findFirstOrThrow({
    where: { referenceId: 'sale:' + sale.id + ':' + productId },
    include: { lines: true },
  });
  expect(journalEntry.metadata).toMatchObject({ inventoryCost: '100.00', revenueAmount: '200.00' });
  expect(journalEntry.lines.some((l) => l.accountCode === 'S11-2001' && l.credit.equals(100))).toBe(
    true,
  );
  expect((await planRollback(db, plan.batchId)).references).toMatchObject({
    sales: 1,
    journal_entries: 1,
  });
  expect(await db.product.findUniqueOrThrow({ where: { id: productId } })).toMatchObject({
    status: 'SOLD_CASH',
  });
  await frozen(async () => {
    await expect(applyRollback(db, rollback)).rejects.toThrow('TARGET_IN_USE');
  });
  expect((await db.product.findUniqueOrThrow({ where: { id: productId } })).deletedAt).toBeNull();
  expect(
    await db.product.count({
      where: { id: { in: rollback.targets.map((t) => t.targetId) }, deletedAt: null },
    }),
  ).toBe(2);
  await expect(applyBatch(db, plan, writer)).rejects.toThrow();
});
it('fails closed on an open database, on a second idle writer, and rejects new writer connections during freeze', async () => {
  const { rollback, productId } = await imported();
  await expect(applyRollback(db, rollback)).rejects.toThrow('ROLLBACK_FREEZE_REQUIRED');
  const writerDb = harnessClient();
  await writerDb.$queryRaw`SELECT 1`;
  try {
    await frozen(async () => {
      await expect(applyRollback(db, rollback)).rejects.toThrow('ROLLBACK_FREEZE_REQUIRED');
      expect(
        (await writerDb.product.findUniqueOrThrow({ where: { id: productId } })).deletedAt,
      ).toBeNull();
      await writerDb.$disconnect();
      const newWriter = harnessClient();
      try {
        await expect(newWriter.$connect()).rejects.toThrow();
        await applyRollback(db, rollback);
        await expect(newWriter.$connect()).rejects.toThrow();
      } finally {
        await newWriter.$disconnect();
      }
    });
  } finally {
    await writerDb.$disconnect();
  }
});
it('blocks active other-batch MATCH until dependent batch is reversed', async () => {
  const { input, rollback } = await imported();
  input.manifest.canonicalSetId = randomUUID();
  const match = await buildImportPlan(db, input);
  expect(match.totals.matched).toBe(1);
  await applyBatch(db, match, writer);
  const dependent = await planRollback(db, match.batchId);
  await frozen(async () => {
    await expect(applyRollback(db, rollback)).rejects.toThrow('TARGET_IN_USE');
    expect(await applyRollback(db, dependent)).toMatchObject({ products: 0 });
    expect(await applyRollback(db, rollback)).toMatchObject({ products: 1 });
  });
});
it('blocks a hold, stock movement or adjustment and price drift after review', async () => {
  const { rollback, productId, input, plan } = await imported();
  const branchId = input.rows[0].branchId;
  await db.productReservation.create({
    data: { productId, sessionId: randomUUID(), expiresAt: new Date(Date.now() + 60000) },
  });
  await db.stockTransfer.create({
    data: { productId, fromBranchId: branchId, toBranchId: branchId, transferredBy: 'fixture' },
  });
  const user = await db.user.create({
    data: { email: randomUUID() + '@example.invalid', password: 'x', name: 'Fixture' },
  });
  await db.stockCount.create({
    data: {
      countNumber: randomUUID(),
      branchId,
      countedById: user.id,
      items: { create: { productId, expectedStatus: 'IN_STOCK' } },
    },
  });
  await db.stockAdjustment.create({
    data: {
      productId,
      branchId,
      reason: 'OTHER',
      previousStatus: 'IN_STOCK',
      adjustedById: user.id,
    },
  });
  const supplier = await db.supplier.create({ data: { name: 'fixture', phone: '00000000' } });
  const po = await db.purchaseOrder.create({
    data: {
      poNumber: randomUUID(),
      supplierId: supplier.id,
      orderDate: new Date(),
      totalAmount: 100,
      netAmount: 100,
      createdById: user.id,
    },
  });
  await db.product.update({ where: { id: productId }, data: { poId: po.id } });
  await db.productPrice.updateMany({ where: { productId }, data: { amount: 301 } });
  const changed = await planRollback(db, plan.batchId);
  expect(changed.blockers).toEqual(expect.arrayContaining(['TARGET_IN_USE', 'TARGET_CHANGED']));
  expect(changed.references).toMatchObject({
    product_reservations: 1,
    stock_transfers: 1,
    stock_count_items: 1,
    stock_adjustments: 1,
    products: 1,
  });
  await frozen(async () => {
    await expect(applyRollback(db, rollback)).rejects.toThrow('TARGET_IN_USE');
  });
});
it('detects logical references independently of the sale/contract primary device', async () => {
  const { input, plan, productId, rollback } = await imported();
  const user = await db.user.create({
    data: { email: randomUUID() + '@example.invalid', password: 'x', name: 'Fixture' },
  });
  const customer = await db.customer.create({
    data: { name: 'fixture', phone: randomUUID(), nationalId: randomUUID() },
  });
  const branchId = input.rows[0].branchId;
  const primary = await db.product.create({
    data: { ...productData(input.rows[0]), imeiSerial: null },
  });
  const common = {
    branchId,
    customerId: customer.id,
    productId: primary.id,
    salespersonId: user.id,
    sellingPrice: 100,
  };
  const contract = await db.contract.create({
    data: {
      ...common,
      bundleProductIds: [productId],
      contractNumber: randomUUID(),
      planType: 'STORE_WITH_INTEREST',
      downPayment: 0,
      financedAmount: 100,
      interestRate: 0,
      totalMonths: 1,
      interestTotal: 0,
      monthlyPayment: 100,
    },
  });
  const sale = await db.sale.create({
    data: {
      ...common,
      bundleProductIds: [productId],
      saleNumber: randomUUID(),
      saleType: 'CASH',
      netAmount: 100,
    },
  });
  const promotion = await db.promotion.create({
    data: {
      name: 'fixture',
      type: 'FREE_ACCESSORY',
      conditions: { accessoryProductIds: [productId] },
      startDate: new Date(),
      endDate: new Date(),
    },
  });
  await db.salePromotionBenefit.create({
    data: {
      promotionId: promotion.id,
      saleId: sale.id,
      productId: primary.id,
      customerId: customer.id,
      branchId,
      type: 'FREE_ACCESSORY',
      baselineSource: 'fixture',
      baselineAmount: 100,
      discountAmount: 1,
      accessoryProductIds: [productId],
      definition: {},
      fingerprint: 'fixture',
    },
  });
  await db.contractPromotionTerms.create({
    data: {
      contractId: contract.id,
      promotionId: promotion.id,
      baselineSource: 'fixture',
      baselineAmount: 100,
      monthlyRate: 0,
      sellingPrice: 100,
      downPayment: 0,
      financedAmount: 100,
      interestTotal: 0,
      storeCommission: 0,
      vatAmount: 0,
      vatPct: 0,
      monthlyPayment: 100,
      totalMonths: 1,
      bundleProductIds: [productId],
      schedule: [],
      definition: {},
      fingerprint: 'fixture',
    },
  });
  await db.afterSalesCase.create({
    data: {
      caseNumber: randomUUID(),
      branchId,
      customerId: customer.id,
      source: 'WALK_IN',
      replacementProductId: productId,
      symptom: 'fixture',
      warrantySnapshot: {},
      receivedById: user.id,
    },
  });
  expect((await planRollback(db, plan.batchId)).references).toMatchObject({
    contracts: 1,
    sales: 1,
    promotions: 1,
    sale_promotion_benefits: 1,
    contract_promotion_terms: 1,
    after_sales_cases: 1,
  });
  await frozen(async () => {
    await expect(applyRollback(db, rollback)).rejects.toThrow('TARGET_IN_USE');
  });
});

it('pins closed admission until commit; a maintenance session cannot reopen it during mutation', async () => {
  const { rollback } = await imported();
  const admin = harnessClient('postgres');
  await db.$executeRaw`CREATE FUNCTION t9_delay_test_update() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN PERFORM pg_sleep(1); RETURN NEW; END $$`;
  await db.$executeRaw`CREATE TRIGGER t9_delay BEFORE UPDATE OF deleted_at ON products FOR EACH ROW EXECUTE FUNCTION t9_delay_test_update()`;
  let signal!: (value: number) => void;
  const ready = new Promise<number>((r) => {
    signal = r;
  });
  const operation = applyRollback(db, rollback, (state) => signal(state.backendPid));
  try {
    const pid = await ready;
    await admin.$executeRaw`ALTER DATABASE bc_vitest_test ALLOW_CONNECTIONS false`;
    const until = Date.now() + 5000;
    let sleeping = false;
    while (!sleeping && Date.now() < until) {
      const [state] = await admin.$queryRaw<
        { sleeping: boolean }[]
      >`SELECT wait_event='PgSleep' AS sleeping FROM pg_stat_activity WHERE pid=${pid}`;
      sleeping = state?.sleeping;
      if (!sleeping) await new Promise((r) => setTimeout(r, 20));
    }
    expect(sleeping).toBe(true);
    await expect(
      admin.$transaction(async (tx) => {
        await tx.$executeRaw`SET LOCAL lock_timeout='75ms'`;
        await tx.$executeRaw`ALTER DATABASE bc_vitest_test ALLOW_CONNECTIONS true`;
      }),
    ).rejects.toMatchObject({ code: 'P2010', meta: { code: '55P03' } });
    expect(await operation).toMatchObject({ products: 1 });
    const [gate] = await admin.$queryRaw<
      { datallowconn: boolean }[]
    >`SELECT datallowconn FROM pg_database WHERE datname='bc_vitest_test'`;
    expect(gate.datallowconn).toBe(false);
  } finally {
    await operation.catch(() => {});
    await admin.$executeRaw`ALTER DATABASE bc_vitest_test ALLOW_CONNECTIONS true`;
    await db.$executeRaw`DROP TRIGGER t9_delay ON products`;
    await db.$executeRaw`DROP FUNCTION t9_delay_test_update()`;
    await admin.$disconnect();
  }
});
it('can reverse only the committed prefix of a failed batch and detects standalone price changes', async () => {
  const input = await stockInput(db, 2),
    plan = await buildImportPlan(db, input);
  let writes = 0;
  await expect(
    applyBatch(db, plan, async (tx, item) => {
      const target = await writer(tx, item);
      if (++writes === 2) throw Error('INTERRUPTED');
      return target;
    }),
  ).rejects.toThrow('INTERRUPTED');
  const partial = await planRollback(db, plan.batchId);
  expect(partial).toMatchObject({ status: 'FAILED', blockers: [] });
  expect(partial.targets).toHaveLength(1);
  expect(await frozen(() => applyRollback(db, partial))).toMatchObject({
    products: 1,
    reversedItems: 1,
  });
  const clean = await imported();
  await db.productPrice.updateMany({
    where: { productId: clean.productId },
    data: { amount: 206 },
  });
  expect((await planRollback(db, clean.plan.batchId)).blockers).toEqual(['TARGET_CHANGED']);
  await frozen(async () => {
    await expect(applyRollback(db, clean.rollback)).rejects.toThrow('TARGET_CHANGED');
  });
});
it('rejects unbound rollback metadata, replay with a forged revision, and preserves durable recovery evidence', async () => {
  const { rollback, plan } = await imported();
  await expect(
    db.$executeRaw`UPDATE tooltify_import_batches SET rollback_code_revision='new-revision' WHERE id=${plan.batchId}`,
  ).rejects.toThrow();
  await expect(
    db.$executeRaw`UPDATE tooltify_import_batches SET status='ROLLED_BACK',rollback_plan_hash='bad',rollback_code_revision='bad' WHERE id=${plan.batchId}`,
  ).rejects.toThrow();
  await expect(
    db.$executeRaw`UPDATE tooltify_import_batches SET status='ROLLED_BACK' WHERE id=${plan.batchId}`,
  ).rejects.toThrow();
  await frozen(async () => {
    await applyRollback(db, rollback);
    const original = await db.tooltifyImportBatch.findUniqueOrThrow({
      where: { id: plan.batchId },
      include: { items: true, events: true },
    });
    expect(original).toMatchObject({
      rollbackPlanHash: rollback.planHash,
      rollbackCodeRevision: rollback.codeRevision,
    });
    const { hashImportValue } = await import('../canonicalize');
    const forged = { ...rollback, codeRevision: 'a'.repeat(40) };
    forged.planHash = hashImportValue({ ...forged, planHash: undefined });
    await expect(applyRollback(db, forged)).rejects.toThrow('ROLLBACK_REPLAY_PROOF_MISMATCH');
    await applyRollback(db, rollback);
    expect(
      await db.tooltifyImportBatch.findUniqueOrThrow({
        where: { id: plan.batchId },
        include: { items: true, events: true },
      }),
    ).toEqual(original);
  });
});

it('blocks an already-admitted writer that has read the live product but not committed its logical reference', async () => {
  const { rollback, productId, plan } = await imported();
  const worker = harnessClient();
  let resume!: () => void, checked!: () => void;
  const proceed = new Promise<void>((r) => {
      resume = r;
    }),
    read = new Promise<void>((r) => {
      checked = r;
    });
  const operation = worker.$transaction(async (tx) => {
    const product = await tx.product.findUniqueOrThrow({ where: { id: productId } });
    expect(product.deletedAt).toBeNull();
    checked();
    await proceed;
    await tx.promotion.create({
      data: {
        name: 'fixture',
        type: 'FREE_ACCESSORY',
        conditions: { accessoryProductIds: [productId] },
        startDate: new Date(),
        endDate: new Date(),
      },
    });
  });
  try {
    await read;
    await frozen(async () => {
      await expect(applyRollback(db, rollback)).rejects.toThrow('ROLLBACK_FREEZE_REQUIRED');
      resume();
      await operation;
      await worker.$disconnect();
      expect((await planRollback(db, plan.batchId)).references.promotions).toBe(1);
      await expect(applyRollback(db, rollback)).rejects.toThrow('TARGET_IN_USE');
    });
    expect((await db.product.findUniqueOrThrow({ where: { id: productId } })).deletedAt).toBeNull();
  } finally {
    resume();
    await operation;
    await worker.$disconnect();
  }
});
