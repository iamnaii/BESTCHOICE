import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';

export const GET_INSTALLMENT_RATES_TOOL = {
  name: 'get_installment_rates',
  description:
    "Look up the shop's REAL baht installment rates for a phone model from PricingTemplate — " +
    'the same table stickers.service.ts uses to print price stickers, so numbers here always ' +
    "match what's printed in-store. `query` MUST be ONLY the model name (brand/model, optionally " +
    'storage) — e.g. "iPhone 15 128GB" — with NO other words: matching requires the stored model ' +
    'to contain the query text, so greetings or extra words ("มีไหมคะ") make it match nothing. ' +
    'Returns up to 3 matches, each with BOTH rate plans (rate1/rate2), and each plan carries its ' +
    'OWN down-payment, monthly baht payment, and term — ALL BAHT, ready to quote directly (the ' +
    'two plans usually have different monthly amounts, exactly like the two lines on the physical ' +
    'sticker). Matches can be sibling models (asked "iPhone 15", got "iPhone 15 Pro Max") — ALWAYS ' +
    'attribute quoted numbers to the returned brand+model+storage verbatim. Use this whenever ' +
    'search_products found nothing (or every hit has priceMissing) so the bot can still answer with ' +
    'real down/monthly/term numbers instead of going silent. No match → templates: [] (ask the ' +
    'customer for their budget instead of guessing).',
  input_schema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description:
          'Model name ONLY, e.g. "iPhone 15 Pro Max 256GB" — no greetings/extra words ' +
          '(stored model must contain this text)',
      },
    },
    required: ['query'],
  },
};

/** Same shape as StickerRate (stickers.service.ts) — sticker-exact parity. */
export interface InstallmentRateOption {
  downPayment: number;
  monthlyPrice: number;
  termMonths: number;
}

export interface PricingTemplateRateMatch {
  brand: string;
  model: string;
  storage: string;
  hasWarranty: boolean;
  rate1: InstallmentRateOption;
  rate2: InstallmentRateOption;
}

export interface GetInstallmentRatesResult {
  templates: PricingTemplateRateMatch[];
}

interface RateDefaults {
  rate1Down: number;
  rate1Term: number;
  rate2Down: number;
  rate2Term: number;
}

interface PricingTemplateRow {
  brand: string;
  model: string;
  storage: string;
  hasWarranty: boolean;
  installmentBestchoicePrice: unknown;
  installmentFinancePrice: unknown;
  rate1DownPayment: unknown;
  rate1TermMonths: number | null;
  rate2DownPayment: unknown;
  rate2TermMonths: number | null;
}

const MAX_MATCHES = 3;

/** Pulls a storage token like "256GB" / "1TB" out of free text, normalized upper-case no-space. */
function extractStorageToken(text: string): string | null {
  const m = text.match(/(\d+)\s*(gb|tb)\b/i);
  if (!m) return null;
  return `${m[1]}${m[2].toUpperCase()}`;
}

function normalizeStorage(storage: string): string {
  return storage.toUpperCase().replace(/\s+/g, '');
}

@Injectable()
export class GetInstallmentRatesTool {
  constructor(private readonly prisma: PrismaService) {}

  async run(
    input: { query?: string } = {},
  ): Promise<GetInstallmentRatesResult> {
    const rawQuery = String(input?.query ?? '').trim();
    if (!rawQuery) return { templates: [] };

    const storageToken = extractStorageToken(rawQuery);
    // Strip the storage token from the text used for the brand/model contains
    // match — a stored model like "iPhone 15 Pro Max" would never contain the
    // literal "256GB" substring the customer typed alongside it.
    const modelQuery = storageToken
      ? rawQuery.replace(/(\d+)\s*(gb|tb)\b/i, ' ').replace(/\s+/g, ' ').trim()
      : rawQuery;
    if (!modelQuery) return { templates: [] };

    const rows: PricingTemplateRow[] = await this.prisma.pricingTemplate.findMany({
      where: {
        isActive: true,
        deletedAt: null,
        OR: [
          { model: { contains: modelQuery, mode: 'insensitive' } },
          { brand: { contains: modelQuery, mode: 'insensitive' } },
        ],
      },
      orderBy: [{ brand: 'asc' }, { model: 'asc' }, { storage: 'asc' }, { hasWarranty: 'asc' }],
    });

    if (rows.length === 0) return { templates: [] };

    // Storage refine: a narrowing HINT, not a filter — if the query names a
    // storage size and at least one row actually has it, narrow to those;
    // otherwise keep the full candidate set (mirrors PricingTemplatesService
    // .lookup()'s exact-then-fallback shape without discarding real hits).
    let candidates = rows;
    if (storageToken) {
      const bySize = rows.filter((r) => normalizeStorage(r.storage) === storageToken);
      if (bySize.length > 0) candidates = bySize;
    }

    const defaults = await this.loadDefaults();
    return {
      templates: candidates.slice(0, MAX_MATCHES).map((t) => this.toMatch(t, defaults)),
    };
  }

  // Sticker-exact parity with StickersService.composeOne(): rate1 monthly =
  // installmentBestchoicePrice (stickers.service.ts:175), rate2 monthly =
  // installmentFinancePrice (stickers.service.ts:185). The bot must quote the
  // same two lines customers see on the physical in-store sticker (#1337).
  private toMatch(t: PricingTemplateRow, defaults: RateDefaults): PricingTemplateRateMatch {
    return {
      brand: t.brand,
      model: t.model,
      storage: t.storage,
      hasWarranty: t.hasWarranty,
      rate1: {
        downPayment:
          t.rate1DownPayment !== null && t.rate1DownPayment !== undefined
            ? Number(t.rate1DownPayment)
            : defaults.rate1Down,
        monthlyPrice: Number(t.installmentBestchoicePrice),
        termMonths: t.rate1TermMonths ?? defaults.rate1Term,
      },
      rate2: {
        downPayment:
          t.rate2DownPayment !== null && t.rate2DownPayment !== undefined
            ? Number(t.rate2DownPayment)
            : defaults.rate2Down,
        monthlyPrice: Number(t.installmentFinancePrice),
        termMonths: t.rate2TermMonths ?? defaults.rate2Term,
      },
    };
  }

  // Same SystemConfig source stickers.service.ts's loadDefaults() reads —
  // keeps the bot's quoted rate consistent with the printed sticker when a
  // template hasn't set an explicit rate1/rate2 down/term.
  private async loadDefaults(): Promise<RateDefaults> {
    const rows = await this.prisma.systemConfig.findMany({
      where: { key: { startsWith: 'sticker.' } },
    });
    const map = new Map((rows ?? []).map((r: { key: string; value: string }) => [r.key, r.value]));
    return {
      rate1Down: Number(map.get('sticker.rate1.defaultDown') ?? 0),
      rate1Term: Number(map.get('sticker.rate1.defaultTerm') ?? 24),
      rate2Down: Number(map.get('sticker.rate2.defaultDown') ?? 0),
      rate2Term: Number(map.get('sticker.rate2.defaultTerm') ?? 12),
    };
  }
}
