import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { ShopBuybackService } from './shop-buyback.service';
import { BuybackPricingService } from './buyback-pricing.service';
import { ShopBuybackController } from './shop-buyback.controller';
import { issueQuoteWindow, QUOTE_WINDOW_MS } from './quote-window';

// Run only with tools/test-db-vitest.sh; never use an inherited application database.
const dbUrl = new URL(process.env.DATABASE_URL ?? 'postgresql://invalid/');
if (dbUrl.pathname !== '/bc_vitest_test' || !dbUrl.searchParams.get('host')?.startsWith('/tmp/bc-vitest-db.')) {
  throw new Error('This spec requires the isolated PostgreSQL Vitest harness');
}
const db = new PrismaClient();
const line = { sendFlexMessage: vi.fn() };
const service = new ShopBuybackService(db as never, line as never, new BuybackPricingService());
const controller = new ShopBuybackController(service);
const model = 'iPhone 13 Pro Max';
const storage = '256GB';
const answer = (id: string) => [{ questionKey: 'device-origin', choiceIds: [id] }];

beforeAll(async () => {
  vi.stubEnv('JWT_SECRET', 'isolated-sell-quote-test-secret');
  await db.tradeInValuation.create({ data: { brand: 'Apple', model, storage, condition: 'A', basePrice: 20000 } });
  await db.buybackQuestion.create({ data: {
    key: 'device-origin', title: 'เครื่องศูนย์', selectType: 'SINGLE',
    choices: { create: [
      { id: 'origin-thai', label: 'เครื่องศูนย์ไทย (TH)', deductType: 'FIXED', deductValue: 0 },
      { id: 'origin-imported', label: 'เครื่องนอก (โมเดลอื่น)', deductType: 'FIXED', deductValue: 1500 },
      { id: 'origin-unknown', label: 'ไม่แน่ใจ', deductType: 'FIXED', deductValue: 0 },
    ] },
  } });
});
afterAll(async () => { await db.$disconnect(); vi.unstubAllEnvs(); });

describe('Thai-only storefront buyback policy', () => {
  it('keeps the Thai cash price and tiered exchange bonus', async () => {
    const quote = await controller.quote({ model, storage, answers: answer('origin-thai') });
    expect(quote).toMatchObject({ available: true, cashPrice: '20000.00', exchangePrice: '20500.00' });
  });
  it.each(['origin-imported', 'origin-unknown'])('rejects %s for quotes and both submission flows without creating a lead', async (id) => {
    await expect(service.quoteForAnswers(model, storage, answer(id))).rejects.toThrow('เฉพาะเครื่องโมเดลไทย');
    for (const flow of ['BUYBACK', 'EXCHANGE'] as const) {
      await expect(service.submit({ model, storage, answers: answer(id), flow, sellerName: 'TEST ORIGIN', sellerPhone: '0000000000' }, undefined)).rejects.toThrow('เฉพาะเครื่องโมเดลไทย');
    }
    expect(await db.tradeIn.count()).toBe(0);
    expect(line.sendFlexMessage).not.toHaveBeenCalled();
  });
  it('rejects omitted and forged origin answers', async () => {
    await expect(service.quoteForAnswers(model, storage, [])).rejects.toThrow();
    await expect(service.quoteForAnswers(model, storage, answer('__origin_unknown'))).rejects.toThrow();
  });
  it('fails closed on public quote and submit if origin is removed from the active questionnaire', async () => {
    await db.buybackQuestion.update({ where: { key: 'device-origin' }, data: { isActive: false } });
    try {
      await expect(controller.quote({ model, storage, answers: [] })).rejects.toThrow('เฉพาะเครื่องโมเดลไทย');
      await expect(service.submit({ model, storage, answers: [], sellerName: 'TEST ORIGIN', sellerPhone: '0000000000' }, undefined)).rejects.toThrow('เฉพาะเครื่องโมเดลไทย');
      expect(await db.tradeIn.count()).toBe(0);
    } finally {
      await db.buybackQuestion.update({ where: { key: 'device-origin' }, data: { isActive: true } });
    }
  });
  it('fails closed if a model-specific reference profile omits origin', async () => {
    const key = 'sell_reference_pricing_v1';
    const catalog = { version: 1, source: 'https://example.com/test', capturedAt: '2026-11-21T00:00:00Z',
      profiles: { p: { pricingMode: 'MAX_PERCENT_EXACT', eligibilityRequired: true, eligibilityText: 'TEST eligibility',
        questions: [{ id: 'warranty', key: 'warranty', title: 'TEST warranty', selectType: 'SINGLE',
          choices: [{ id: 'ok', label: 'TEST ok', deductType: 'FIXED', deductValue: '0' }] }] } },
      assignments: [{ model, storage, profileId: 'p' }] };
    await db.systemConfig.create({ data: { key, value: JSON.stringify(catalog) } });
    try {
      const payload = { model, storage, answers: [{ questionKey: 'warranty', choiceIds: ['ok'] }], deviceEligibilityConfirmed: true };
      await expect(controller.quote(payload)).rejects.toThrow('เฉพาะเครื่องโมเดลไทย');
      await expect(service.submit({ ...payload, sellerName: 'TEST ORIGIN', sellerPhone: '0000000000' }, undefined)).rejects.toThrow('เฉพาะเครื่องโมเดลไทย');
      expect(await db.tradeIn.count()).toBe(0);
    } finally {
      await db.systemConfig.delete({ where: { key } });
    }
  });
  it.each(['BUYBACK', 'EXCHANGE'] as const)('accepts a Thai confirmation without a part-number field for %s', async (flow) => {
    const payload = { model, storage, answers: answer('origin-thai'), flow, sellerName: 'TEST THAI', sellerPhone: '0000000000' };
    const quote = await controller.quote(payload);
    if (!quote.available) throw new Error('fixture quote missing');
    const result = await controller.submit({ ...payload, quoteToken: quote.quoteToken }, {} as never);
    const record = await db.tradeIn.findUniqueOrThrow({ where: { id: result.id } });
    expect(record.conditionAnswers).toContainEqual(expect.objectContaining({ questionKey: 'device-origin', choices: [expect.objectContaining({ choiceId: 'origin-thai' })] }));
    expect(record.conditionAnswers).not.toContainEqual(expect.objectContaining({ questionKey: '__device_part_number' }));
    expect(record.quoteBreakdown).toMatchObject({ assessedAt: quote.assessedAt, expiresAt: quote.expiresAt });
    await db.tradeIn.delete({ where: { id: result.id } });
  });
  it('public submissions reject missing, expired, tampered and changed-input windows without creating a record', async () => {
    const payload = { model, storage, answers: answer('origin-thai'), sellerName: 'TEST WINDOW', sellerPhone: '0000000000' };
    const valid = issueQuoteWindow(payload);
    const expired = issueQuoteWindow(payload, Date.now() - QUOTE_WINDOW_MS);
    for (const quoteToken of [undefined, expired.quoteToken, valid.quoteToken + 'x']) {
      await expect(controller.submit({ ...payload, quoteToken }, {} as never)).rejects.toThrow();
    }
    await expect(controller.submit({ ...payload, answers: answer('origin-imported'), quoteToken: valid.quoteToken }, {} as never)).rejects.toThrow();
    expect(await db.tradeIn.count()).toBe(0);
  });
});
