import { randomUUID } from 'node:crypto';
import Decimal from 'decimal.js';
import { buildModelQuote } from '@installment/shared';
import { PrismaClient } from '@prisma/client';
import { afterAll, expect, it } from 'vitest';
import { applyBatch } from '../batch';
import { hashSourceDecisions } from '../canonicalize';
import { buildImportPlan } from '../plan';
import { verifyAppliedBatch } from '../reconcile';
import { writeStockItem } from '../stock-writer';
import { stockInput } from './preflight-fixtures';

const db = new PrismaClient();
afterAll(() => db.$disconnect());
type Input = Awaited<ReturnType<typeof stockInput>>;
const decision = (i: Input) => i.decisions.entries.find((d) => d.action === 'RESOLVE_STOCK')!;
async function plan(i: Input) {
  i.manifest.decisionsSha256 = hashSourceDecisions(i.decisions);
  return buildImportPlan(db, i);
}
const write = (
  tx: Parameters<typeof writeStockItem>[0],
  item: Parameters<typeof applyBatch>[1]['items'][number],
) => {
  if (item.kind !== 'STOCK') throw Error('expected stock');
  return writeStockItem(tx, item);
};
async function fixture() {
  const i = await stockInput(db);
  Object.assign(i.rows[0], { category: 'PHONE_USED', model: randomUUID(), storage: '128GB' });
  Object.assign(decision(i), {
    deviceOrigin: 'THAI',
    pricing: { mode: 'MASTER_INSTALLMENTS', cashPrice: '13900.00' },
  });
  const template = await db.pricingTemplate.create({
    data: {
      brand: i.rows[0].brand,
      model: i.rows[0].model,
      storage: '128GB',
      category: 'PHONE_USED',
      cashPrice: '14900',
      installmentBestchoicePrice: '11700',
      installmentFinancePrice: '11100',
      rate1TermMonths: 12,
      rate2TermMonths: 12,
    },
  });
  return { i, template };
}

it('blocks ready financed phones when origin was omitted by the export', async () => {
  const i = await stockInput(db);
  decision(i).pricing = {
    mode: 'EXPLICIT',
    cashPrice: '13900',
    installmentPrice: '11700',
    financePrice: '11100',
  };
  const p = await plan(i);
  expect(p.items[0].reason).toBe('DEVICE_ORIGIN_REQUIRED_FOR_INSTALLMENTS');
  await expect(applyBatch(db, p, write)).rejects.toThrow('IMPORT_PLAN_BLOCKED_OR_CHANGED');
});

it('imports master installments with evidenced cash and origin and repeats without duplicate or price drift', async () => {
  const { i, template } = await fixture();
  const p = await plan(i);
  expect(p.issues).toEqual([]);
  expect(p.items[0].payload).toMatchObject({
    deviceOrigin: 'THAI',
    cashPrice: '13900.00',
    installmentPrice: '11700.00',
    financePrice: '11100.00',
  });
  const receipt = await applyBatch(db, p, write);
  await verifyAppliedBatch(db, receipt.batchId, p.planHash);
  await applyBatch(db, p, write);
  expect(
    await db.product.count({ where: { imeiSerial: i.rows[0].barcode, deletedAt: null } }),
  ).toBe(1);
  const next = { ...i, manifest: { ...i.manifest, canonicalSetId: randomUUID() } };
  const matched = await plan(next);
  expect(matched.items[0].disposition).toBe('MATCH');
  await applyBatch(db, matched, write);
  await db.pricingTemplate.update({
    where: { id: template.id },
    data: { installmentFinancePrice: '12000' },
  });
  await applyBatch(db, p, write); // Immutable receipt replay keeps the original accepted prices.
  const changed = await plan({ ...i, manifest: { ...i.manifest, canonicalSetId: randomUUID() } });
  expect(changed.items[0].reason).toBe('STOCK_TARGET_CONFLICT');
  const product = await db.product.findFirstOrThrow({
    where: { imeiSerial: i.rows[0].barcode, deletedAt: null },
  });
  expect(product.financePrice?.toFixed(2)).toBe('11100.00');
  expect(product.deviceOrigin).toBe('THAI');
  // iPhone 14 128GB used: MASTER sheet's actual down/monthly amounts, not only base-price equality.
  const quote = buildModelQuote({
    product: { brand: 'Apple', model: 'iPhone 14', storage: '128GB', category: 'PHONE_USED' },
    deviceOrigin: product.deviceOrigin,
    cashPrice: product.cashPrice!.toNumber(),
    bcPrice: product.installmentPrice!.toNumber(),
    financePrice: product.financePrice!.toNumber(),
    rate1TermMonths: 12,
    rate2TermMonths: 12,
    bcConfig: {
      minDownPct: new Decimal('.15'),
      commissionPct: new Decimal('.10'),
      vatPct: new Decimal('.07'),
      ratePctByMonths: new Map([[12, new Decimal('.50')]]),
      allowedMonths: [12],
    },
    gfin: {
      mappings: [
        {
          id: 'm',
          gfinSeries: 'iPhone 14',
          gfinVariant: null,
          storage: '128GB',
          condition: 'HAND_2',
          maxPrice: new Decimal(12900),
          modelMatchPattern: 'iPhone 14',
          isActive: true,
        },
      ],
      rules: [
        {
          id: 'r',
          label: 'iPhone 14',
          seriesPattern: 'iPhone 14',
          condition: 'HAND_2',
          allowance: new Decimal(2000),
          maxMonths: 12,
          minDownPct: 25,
          isActive: true,
        },
      ],
      rateFactors: [
        {
          months: 12,
          shopCommissionPct: 15,
          factor: new Decimal('.17'),
          feePerInstallment: new Decimal(100),
          isActive: true,
        },
      ],
      settingMinDownPct: new Decimal('.25'),
      commissionPct: 15,
      contractFee: new Decimal(100),
    },
  });
  expect(quote.rate1).toMatchObject({ downAmount: 1800, monthlyContract: 1411, months: 12 });
  expect(quote.rate2).toMatchObject({
    available: true,
    downAmount: 0,
    monthly: 2000,
    months: 12,
    originNote: false,
  });
});

it('rejects a changed master between dry run and apply', async () => {
  const { i, template } = await fixture();
  const p = await plan(i);
  expect(p.issues).toEqual([]);
  await db.pricingTemplate.update({
    where: { id: template.id },
    data: { installmentBestchoicePrice: '11800' },
  });
  await expect(applyBatch(db, p, write)).rejects.toThrow();
  expect(
    await db.product.count({ where: { imeiSerial: i.rows[0].barcode, deletedAt: null } }),
  ).toBe(0);
});

it('refuses generic capacity or incomplete master prices instead of publishing guessed installments', async () => {
  const { i, template } = await fixture();
  await db.pricingTemplate.update({ where: { id: template.id }, data: { storage: '' } });
  expect((await plan(i)).items[0].reason).toBe('EXACT_INSTALLMENT_TEMPLATE_REQUIRED');
  await db.pricingTemplate.update({
    where: { id: template.id },
    data: { storage: '128GB', installmentFinancePrice: '0' },
  });
  expect((await plan(i)).items[0].reason).toBe('EXACT_INSTALLMENT_TEMPLATE_REQUIRED');
});
