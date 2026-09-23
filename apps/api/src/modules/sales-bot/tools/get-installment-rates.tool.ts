import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  extractStorageToken,
  normalizeStorage,
  stripStorageToken,
} from '../../../utils/device-query-normalize.util';

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
    'real down/monthly/term numbers instead of going silent. No match → templates: [] — do NOT guess ' +
    "a rate and do NOT ask for the customer's budget; retry once with the plain English model name " +
    'without storage, then follow the persona rule for an empty table. ' +
    'deviceOrigin and condition are internal labels — never print THAI/IMPORTED/UNSPECIFIED to the ' +
    "customer; UNSPECIFIED rows are the shop's regular (Thai) table. Never quote these rows for the " +
    'imported free-down promo (promo rates come from search_knowledge_base only). ' +
    'Each match carries `condition` ("มือ 1" = new, "มือสอง" = used) — the same model+storage can have BOTH rows ' +
    'with different numbers (มือ 1 rows come first); quote ONLY the row whose condition matches what the ' +
    'customer is buying (pass `condition` to filter). deviceOrigin THAI also returns rows not yet labelled (UNSPECIFIED).',
  input_schema: {
    type: 'object',
    properties: {
      deviceOrigin: { type: 'string', enum: ['THAI', 'IMPORTED', 'UNSPECIFIED'], description: 'Device origin requested by the customer, if specified' },
      condition: {
        type: 'string',
        enum: ['มือ 1', 'มือสอง'],
        description: 'ใส่เมื่อรู้แล้วว่าลูกค้าสนใจมือ 1 หรือมือสอง — กรองให้เหลือเฉพาะแถวประเภทนั้น',
      },
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

export type RateCondition = 'มือ 1' | 'มือสอง';

export interface PricingTemplateRateMatch {
  deviceOrigin?: string;
  /** มือ 1 (PHONE_NEW) / มือสอง (อื่น ๆ) — รุ่น+ความจุเดียวกันมีได้ทั้งสองแถวที่ตัวเลขต่างกัน */
  condition: RateCondition;
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

/**
 * แถวเต็มจาก `listAllRates()` — ผลของ `run()` บอกแค่ `condition` (มือ 1/มือสอง) ส่วนผู้เรียกภายใน
 * (recommend_devices) ต้องรู้ category ดิบ — `hasWarranty` **ไม่ใช่** ตัวบอกมือ 1
 * (schema: true = มือสองที่ยังมีประกัน — ดู stickers.service.ts composeOne)
 */
export interface PricingTemplateRateRow extends PricingTemplateRateMatch {
  category: string;
}

interface RateDefaults {
  rate1Down: number;
  rate1Term: number;
  rate2Down: number;
  rate2Term: number;
}

interface PricingTemplateRow {
  deviceOrigin?: string;
  brand: string;
  model: string;
  storage: string;
  category: string;
  hasWarranty: boolean;
  installmentBestchoicePrice: unknown;
  installmentFinancePrice: unknown;
  rate1DownPayment: unknown;
  rate1TermMonths: number | null;
  rate2DownPayment: unknown;
  rate2TermMonths: number | null;
}

const MAX_MATCHES = 3;

/**
 * เรียงผลให้คงที่ และแถวแฝด (รุ่น+ความจุเดียวกัน) ออก มือ 1 ก่อน มือสอง — enum ProductCategory ใน
 * Postgres เรียงตามลำดับประกาศ (PHONE_NEW, PHONE_USED, …) ⇒ category asc = PHONE_NEW ก่อน
 * (เดิมไม่มี category ใน orderBy ⇒ ลำดับแถวแฝดขึ้นกับ DB และ MAX_MATCHES ตัดทิ้งแถวไหนก็ได้ — synth C04)
 */
const RATE_ORDER_BY = [
  { brand: 'asc' as const },
  { model: 'asc' as const },
  { storage: 'asc' as const },
  { category: 'asc' as const },
  { hasWarranty: 'asc' as const },
];

@Injectable()
export class GetInstallmentRatesTool {
  constructor(private readonly prisma: PrismaService) {}

  async run(
    input: { query?: string; deviceOrigin?: string; condition?: string } = {},
  ): Promise<GetInstallmentRatesResult> {
    const rawQuery = String(input?.query ?? '').trim();
    if (!rawQuery) return { templates: [] };

    const storageToken = extractStorageToken(rawQuery);
    // Strip the storage token from the text used for the brand/model contains
    // match — a stored model like "iPhone 15 Pro Max" would never contain the
    // literal "256GB" substring the customer typed alongside it.
    const modelQuery = storageToken ? stripStorageToken(rawQuery) : rawQuery;
    if (!modelQuery) return { templates: [] };

    const rows: PricingTemplateRow[] = await this.prisma.pricingTemplate.findMany({
      where: {
        ...originFilter(input.deviceOrigin),
        ...conditionFilter(input.condition),
        isActive: true,
        deletedAt: null,
        OR: [
          { model: { contains: modelQuery, mode: 'insensitive' } },
          { brand: { contains: modelQuery, mode: 'insensitive' } },
        ],
      },
      orderBy: RATE_ORDER_BY,
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

  /**
   * ทุก template ที่ใช้งานอยู่ แปลงเป็น rate1/rate2 ด้วยสูตรเดียวกับ `run()`
   * (toMatch + loadDefaults) — ให้ tool อื่น (recommend_devices) inject ใช้
   * แทนการก๊อปสูตร sticker-parity ไปซ้ำอีกที่
   */
  async listAllRates(): Promise<PricingTemplateRateRow[]> {
    const rows: PricingTemplateRow[] = await this.prisma.pricingTemplate.findMany({
      where: { isActive: true, deletedAt: null },
      orderBy: RATE_ORDER_BY,
    });
    if (rows.length === 0) return [];
    const defaults = await this.loadDefaults();
    return rows.map((t) => ({ ...this.toMatch(t, defaults), category: String(t.category) }));
  }

  // Sticker-exact parity with StickersService.composeOne(): rate1 monthly =
  // installmentBestchoicePrice (stickers.service.ts:175), rate2 monthly =
  // installmentFinancePrice (stickers.service.ts:185). The bot must quote the
  // same two lines customers see on the physical in-store sticker (#1337).
  private toMatch(t: PricingTemplateRow, defaults: RateDefaults): PricingTemplateRateMatch {
    return {
      deviceOrigin: t.deviceOrigin ?? 'UNSPECIFIED',
      condition: String(t.category) === 'PHONE_NEW' ? 'มือ 1' : 'มือสอง',
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

/**
 * THAI นับรวมแถวที่ยังไม่ติดป้าย (UNSPECIFIED) — ตารางเรทบน prod ทั้งชุดเป็นแถวก่อน #1619
 * (ยังไม่ระบุ origin) ถ้ากรองตรงตัว ลูกค้าที่เลือก "เครื่องไทย" จะได้ผลว่างทุกรุ่น
 */
function originFilter(origin: string | undefined) {
  if (origin === 'THAI') return { deviceOrigin: { in: ['THAI', 'UNSPECIFIED'] as ('THAI' | 'UNSPECIFIED')[] } };
  if (origin === 'IMPORTED' || origin === 'UNSPECIFIED') return { deviceOrigin: origin as 'IMPORTED' | 'UNSPECIFIED' };
  return {};
}

function conditionFilter(condition: string | undefined) {
  const c = String(condition ?? '').replace(/\s+/g, '');
  if (c === 'มือ1') return { category: 'PHONE_NEW' as const };
  if (c === 'มือสอง' || c === 'มือ2') return { category: { not: 'PHONE_NEW' as const } };
  return {};
}
