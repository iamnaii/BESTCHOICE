import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { GetInstallmentRatesTool } from './get-installment-rates.tool';

/**
 * Issue #1337 — v2 rework of #1332. Owner live-test verdict: percent-only
 * replies read as robotic and must never say ดอกเบี้ย/%. The bot must quote
 * BAHT (down + monthly + term) exactly like the shop's price stickers —
 * so this tool now reads the SAME source stickers.service.ts uses:
 * PricingTemplate (+ SystemConfig `sticker.*` defaults for null rates).
 *
 * The old InterestConfig percent flow from #1332 is entirely superseded —
 * no percent fixtures here anymore (see git history for the old contract).
 *
 * Grounding contract (#1337): the result now DOES carry baht amounts, and
 * DELIBERATELY uses the key names `downPayment` / `monthlyPrice` that
 * `collectGroundedPrices` (sales-bot.service.ts) has been extended to
 * collect — so every baht figure here is groundable, and any baht the model
 * invents outside these numbers is still HALLUCINATION_BLOCKED.
 */

const makePrisma = (
  templates: unknown[],
  configRows: { key: string; value: string }[] = [],
): PrismaService =>
  ({
    pricingTemplate: { findMany: jest.fn().mockResolvedValue(templates) },
    systemConfig: { findMany: jest.fn().mockResolvedValue(configRows) },
  }) as unknown as PrismaService;

const tpl = (over: Record<string, unknown> = {}) => ({
  brand: 'Apple',
  model: 'iPhone 15 Pro Max',
  storage: '256GB',
  category: 'PHONE_NEW',
  hasWarranty: false,
  cashPrice: new Prisma.Decimal('42900'),
  installmentBestchoicePrice: new Prisma.Decimal('2490'),
  installmentFinancePrice: new Prisma.Decimal('2390'),
  rate1DownPayment: new Prisma.Decimal('4900'),
  rate1TermMonths: 24,
  rate2DownPayment: new Prisma.Decimal('1900'),
  rate2TermMonths: 12,
  ...over,
});

describe('GetInstallmentRatesTool.run', () => {
  it('fuzzy-matches by model text (insensitive contains) and returns baht rates', async () => {
    const tool = new GetInstallmentRatesTool(makePrisma([tpl()]));
    const r: any = await tool.run({ query: 'iphone 15 pro max' });

    expect(r.templates).toEqual([
      {
        brand: 'Apple',
        model: 'iPhone 15 Pro Max',
        storage: '256GB',
        hasWarranty: false,
        monthlyPrice: 2490,
        rate1: { downPayment: 4900, termMonths: 24 },
        rate2: { downPayment: 1900, termMonths: 12 },
      },
    ]);
  });

  it('matches when the customer query is a substring of the stored model (shorter query)', async () => {
    const tool = new GetInstallmentRatesTool(makePrisma([tpl({ model: 'iPhone 15 Pro Max' })]));
    const r: any = await tool.run({ query: '15 pro max มีไหมคะ' });

    expect(r.templates).toHaveLength(1);
    expect(r.templates[0].model).toBe('iPhone 15 Pro Max');
  });

  it('null rate1/rate2 fields fall back to SystemConfig sticker defaults (same source as stickers.service)', async () => {
    const tool = new GetInstallmentRatesTool(
      makePrisma(
        [
          tpl({
            rate1DownPayment: null,
            rate1TermMonths: null,
            rate2DownPayment: null,
            rate2TermMonths: null,
          }),
        ],
        [
          { key: 'sticker.rate1.defaultDown', value: '3900' },
          { key: 'sticker.rate1.defaultTerm', value: '24' },
          { key: 'sticker.rate2.defaultDown', value: '1500' },
          { key: 'sticker.rate2.defaultTerm', value: '12' },
        ],
      ),
    );
    const r: any = await tool.run({ query: 'iPhone 15 Pro Max' });

    expect(r.templates[0].rate1).toEqual({ downPayment: 3900, termMonths: 24 });
    expect(r.templates[0].rate2).toEqual({ downPayment: 1500, termMonths: 12 });
  });

  it('uses hard-coded fallback defaults when SystemConfig has no sticker.* rows at all', async () => {
    const tool = new GetInstallmentRatesTool(
      makePrisma([
        tpl({
          rate1DownPayment: null,
          rate1TermMonths: null,
          rate2DownPayment: null,
          rate2TermMonths: null,
        }),
      ]),
    );
    const r: any = await tool.run({ query: 'iPhone 15 Pro Max' });

    // Mirrors StickersService.loadDefaults() hard fallback (rate1Term=24, rate2Term=12, downs=0).
    expect(r.templates[0].rate1).toEqual({ downPayment: 0, termMonths: 24 });
    expect(r.templates[0].rate2).toEqual({ downPayment: 0, termMonths: 12 });
  });

  it('storage refine: narrows to the matching storage when the query mentions one and multiple sizes matched', async () => {
    const tool = new GetInstallmentRatesTool(
      makePrisma([
        tpl({ storage: '128GB', installmentBestchoicePrice: new Prisma.Decimal('2190') }),
        tpl({ storage: '256GB', installmentBestchoicePrice: new Prisma.Decimal('2490') }),
        tpl({ storage: '512GB', installmentBestchoicePrice: new Prisma.Decimal('2890') }),
      ]),
    );
    const r: any = await tool.run({ query: 'iPhone 15 Pro Max 256GB' });

    expect(r.templates).toHaveLength(1);
    expect(r.templates[0].storage).toBe('256GB');
    expect(r.templates[0].monthlyPrice).toBe(2490);
  });

  it('storage refine is a narrowing hint, not a filter — falls back to all candidates when no row matches the mentioned storage', async () => {
    const tool = new GetInstallmentRatesTool(
      makePrisma([
        tpl({ storage: '128GB' }),
        tpl({ storage: '256GB' }),
      ]),
    );
    const r: any = await tool.run({ query: 'iPhone 15 Pro Max 1TB' });

    // Neither row is 1TB — don't wipe out real candidates, just cap at 3.
    expect(r.templates).toHaveLength(2);
  });

  it('caps results at 3 matches even when more rows match', async () => {
    const tool = new GetInstallmentRatesTool(
      makePrisma([
        tpl({ storage: '128GB' }),
        tpl({ storage: '256GB' }),
        tpl({ storage: '512GB' }),
        tpl({ storage: '1TB' }),
      ]),
    );
    const r: any = await tool.run({ query: 'iPhone 15 Pro Max' });

    expect(r.templates).toHaveLength(3);
  });

  it('no PricingTemplate match → empty templates array (persona takes the ask-budget path)', async () => {
    const tool = new GetInstallmentRatesTool(makePrisma([]));
    const r = await tool.run({ query: 'Nokia 3310' });

    expect(r).toEqual({ templates: [] });
  });

  it('empty/missing query → empty templates array (no crash, no DB call needed)', async () => {
    const tool = new GetInstallmentRatesTool(makePrisma([tpl()]));
    expect(await tool.run({ query: '' })).toEqual({ templates: [] });
    expect(await tool.run({} as any)).toEqual({ templates: [] });
  });

  it('carries hasWarranty (mattered for PHONE_USED variants — two rows, one per warranty state)', async () => {
    const tool = new GetInstallmentRatesTool(
      makePrisma([
        tpl({ category: 'PHONE_USED', hasWarranty: true, storage: '128GB' }),
        tpl({ category: 'PHONE_USED', hasWarranty: false, storage: '128GB' }),
      ]),
    );
    const r: any = await tool.run({ query: 'iPhone 15 Pro Max' });

    expect(r.templates.map((t: any) => t.hasWarranty).sort()).toEqual([false, true]);
  });

  it('grounded keys present: result carries the exact key names collectGroundedPrices watches for (downPayment, monthlyPrice)', async () => {
    const tool = new GetInstallmentRatesTool(makePrisma([tpl()]));
    const r: any = await tool.run({ query: 'iPhone 15 Pro Max' });

    const keys = new Set<string>();
    const collect = (v: unknown) => {
      if (v == null || typeof v !== 'object') return;
      if (Array.isArray(v)) return v.forEach(collect);
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
        keys.add(k);
        collect(val);
      }
    };
    collect(r);

    expect(keys.has('downPayment')).toBe(true);
    expect(keys.has('monthlyPrice')).toBe(true);
  });
});
