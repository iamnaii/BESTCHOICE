import { Injectable } from '@nestjs/common';
import type { ModelQuote } from '@installment/shared';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  extractStorageToken,
  normalizeStorage,
  stripStorageToken,
} from '../../../utils/device-query-normalize.util';
import {
  PricingQuoteService,
  type PriceQuoteRow,
  type QuoteCategory,
  type QuoteOrigin,
} from '../../pricing-templates/pricing-quote.service';

export const GET_INSTALLMENT_RATES_TOOL = {
  name: 'get_installment_rates',
  description:
    "Look up the shop's installment quotes for a phone model from the price table (PricingTemplate). " +
    'Numbers come from the same calculator as the staff price page and contracts: rate1 = ผ่อนกับร้าน ' +
    '(BESTCHOICE), rate2 = ผ่อนกับ GFIN; each plan has its own downPayment / monthlyPrice / termMonths in ' +
    'whole baht (monthly already rounded up) — quote them directly, never round or recompute. ' +
    '`query` MUST be ONLY the model name (brand/model, optionally storage) — e.g. "iPhone 15 128GB" — with ' +
    'NO other words: matching requires the stored model to contain the query text, so greetings or extra ' +
    'words ("มีไหมคะ") make it match nothing. Returns up to 3 matches. rate2 can be null with ' +
    'rate2Unavailable (customer-safe Thai reason, e.g. "GFIN ไม่รับรุ่นนี้") — then offer rate1 only. allowedTerms lists ' +
    'the ONLY terms rate1 can be done at; if the customer asks for another term, say which terms are ' +
    'available (e.g. "ผ่อนได้ 10 หรือ 12 งวด") instead of computing a number. Matches can be sibling ' +
    'models (asked "iPhone 15", got "iPhone 15 Pro Max") — ALWAYS attribute quoted numbers to the ' +
    'returned brand+model+storage verbatim. Use this whenever search_products found nothing (or every ' +
    'hit has priceMissing) so the bot can still answer with real down/monthly/term numbers instead of ' +
    "going silent. No match → templates: [] — do NOT guess a rate and do NOT ask for the customer's " +
    'budget; retry once with the plain English model name without storage, then follow the persona rule ' +
    'for an empty table. deviceOrigin and condition are internal labels — never print ' +
    'THAI/IMPORTED to the customer; deviceOrigin is the origin the numbers were quoted for ' +
    "(THAI = the shop's regular table unless the customer asked for an imported phone). " +
    'Pass deviceOrigin IMPORTED only when the customer wants an imported phone (GFIN gives imported ' +
    'phones a lower price, so rate2 differs). Never quote these rows for the imported free-down promo ' +
    '(promo rates come from search_knowledge_base only). Each match carries `condition` ("มือ 1" = new, ' +
    '"มือสอง" = used) — the same model+storage can have BOTH rows with different numbers (มือ 1 rows ' +
    'come first); quote ONLY the row whose condition matches what the customer is buying (pass ' +
    '`condition` to filter).',
  input_schema: {
    type: 'object',
    properties: {
      deviceOrigin: {
        type: 'string',
        enum: ['THAI', 'IMPORTED', 'UNSPECIFIED'],
        description: 'Device origin requested by the customer, if specified',
      },
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

export interface InstallmentRateOption {
  downPayment: number;
  monthlyPrice: number;
  termMonths: number;
}

export type RateCondition = 'มือ 1' | 'มือสอง';

export interface PricingTemplateRateMatch {
  deviceOrigin?: string;
  /** มือ 1 (PHONE_NEW) / มือสอง (อื่น ๆ) */
  condition: RateCondition;
  brand: string;
  model: string;
  storage: string;
  /** มือสองที่มีประกันร้าน (true) / ไม่มี (false) · null = มือ 1 / แท็บเล็ต / มือสองที่ราคาเท่ากัน — ไม่มีเรื่องประกันให้พูด */
  hasWarranty: boolean | null;
  /** เรท 1 (ผ่อนกับร้าน) — null = คิดไม่ได้ (ไม่มีราคาผ่อน / ตั้งค่าดอกเบี้ย) */
  rate1: InstallmentRateOption | null;
  /** เรท 2 (GFIN) — null = ใช้ไม่ได้ ดูเหตุผลที่ rate2Unavailable */
  rate2: InstallmentRateOption | null;
  rate2Unavailable?: string;
  /** งวดที่เรท 1 ทำได้ (ตั้งค่าดอกเบี้ย) — ลูกค้าขอวดอื่นให้บอกตัวเลือกนี้ */
  allowedTerms?: number[];
}

export interface GetInstallmentRatesResult {
  templates: PricingTemplateRateMatch[];
}

/** แถวของ listAllRates() — ผู้เรียกภายใน (recommend_devices) ต้องรู้ category ดิบ */
export interface PricingTemplateRateRow extends PricingTemplateRateMatch {
  category: string;
}

interface PricingTemplateRow {
  deviceOrigin: string;
  brand: string;
  model: string;
  storage: string;
  category: string;
  hasWarranty: boolean;
}

const MAX_MATCHES = 3;

/**
 * เรียงผลให้คงที่ และแถวแฝด (รุ่น+ความจุเดียวกัน) ออก มือ 1 ก่อน มือสอง — enum ProductCategory ใน
 * Postgres เรียงตามลำดับประกาศ (PHONE_NEW, PHONE_USED, …) ⇒ category asc = PHONE_NEW ก่อน
 */
const RATE_ORDER_BY = [
  { brand: 'asc' as const },
  { model: 'asc' as const },
  { storage: 'asc' as const },
  { category: 'asc' as const },
  { hasWarranty: 'asc' as const },
];

const conditionOf = (category: string): RateCondition => (category === 'PHONE_NEW' ? 'มือ 1' : 'มือสอง');

/** ป้ายประกันมีความหมายแค่มือสอง — มือ 1 / แท็บเล็ตในฐานข้อมูลเก็บ false ไว้เฉย ๆ ห้ามส่งให้โมเดลอ่านเป็น "ไม่มีประกัน" */
const warrantyOf = (category: string, hasWarranty: boolean | null): boolean | null =>
  category === 'PHONE_USED' ? hasWarranty : null;

/** ลูกค้าขอเครื่องนอก → คิดแบบเครื่องนอก (OVER ครึ่ง) · นอกนั้น = เครื่องไทย (ค่าเริ่มต้นหน้า "ราคาและเรทผ่อน") */
const quoteOrigin = (origin: string | undefined): QuoteOrigin => (origin === 'IMPORTED' ? 'IMPORTED' : 'THAI');

/** ข้อความถึงลูกค้าตามรหัสเหตุผล — ไม่ส่งข้อความภายในของตัวคำนวณ (เช่น "ยังไม่ได้ตั้งค่า GFIN") */
function rate2UnavailableText(reason: string): string {
  if (reason === 'NO_PRICE_LIST') return 'GFIN ไม่รับรุ่นนี้';
  if (reason === 'NO_RATE') return 'GFIN ไม่มีแผนผ่อนจำนวนงวดนี้';
  return 'ยังไม่มีราคาผ่อน GFIN สำหรับรุ่นนี้';
}

function fromQuote(t: PricingTemplateRow, q: ModelQuote, origin: QuoteOrigin): PricingTemplateRateMatch {
  return {
    // ป้ายต้องตรงกับที่มาที่ใช้คิดตัวเลขจริง (ไม่ใช่ป้ายของแถวที่รอดการตัดซ้ำ)
    deviceOrigin: origin,
    condition: conditionOf(t.category),
    brand: t.brand,
    model: t.model,
    storage: t.storage,
    hasWarranty: warrantyOf(t.category, t.hasWarranty),
    rate1: q.rate1
      ? { downPayment: q.rate1.downAmount, monthlyPrice: q.rate1.monthlyDisplay, termMonths: q.rate1.months }
      : null,
    rate2: q.rate2.available
      ? { downPayment: q.rate2.downAmount, monthlyPrice: q.rate2.monthly, termMonths: q.rate2.months }
      : null,
    ...(q.rate2.available ? {} : { rate2Unavailable: rate2UnavailableText(q.rate2.reason) }),
    allowedTerms: q.rate1?.allowedMonths ?? [],
  };
}

function fromQuoteRow(r: PriceQuoteRow): PricingTemplateRateRow {
  const rate2 = 'unavailable' in r.rate2 ? null : r.rate2;
  return {
    category: r.category,
    condition: conditionOf(r.category),
    brand: r.brand,
    model: r.model,
    storage: r.storage,
    // มือสองที่ราคามี/ไม่มีประกันเท่ากัน (null) คงเดิม = false
    hasWarranty: r.category === 'PHONE_USED' ? r.hasWarranty === true : null,
    rate1: r.rate1
      ? { downPayment: r.rate1.downAmount, monthlyPrice: r.rate1.monthly, termMonths: r.rate1.months }
      : null,
    rate2: rate2 ? { downPayment: rate2.downAmount, monthlyPrice: rate2.monthly, termMonths: rate2.months } : null,
    ...('unavailable' in r.rate2 ? { rate2Unavailable: r.rate2.unavailable } : {}),
  };
}

@Injectable()
export class GetInstallmentRatesTool {
  constructor(
    private readonly prisma: PrismaService,
    private readonly quotes: PricingQuoteService,
  ) {}

  async run(
    input: { query?: string; deviceOrigin?: string; condition?: string } = {},
  ): Promise<GetInstallmentRatesResult> {
    const rawQuery = String(input?.query ?? '').trim();
    if (!rawQuery) return { templates: [] };

    const storageToken = extractStorageToken(rawQuery);
    // ตัดความจุออกจากคำค้นรุ่น — ชื่อรุ่นที่เก็บไม่มีคำ "256GB" อยู่ในตัว
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
      select: { deviceOrigin: true, brand: true, model: true, storage: true, category: true, hasWarranty: true },
    });
    if (rows.length === 0) return { templates: [] };

    // ความจุเป็นตัวแคบผล ไม่ใช่ตัวกรอง — ไม่มีแถวของความจุนั้นก็คงทุกแถวไว้
    let candidates = rows;
    if (storageToken) {
      const bySize = rows.filter((r) => normalizeStorage(r.storage) === storageToken);
      if (bySize.length > 0) candidates = bySize;
    }

    // แถวของเครื่องไทย/นอกกับ "ไม่ระบุ" ของรุ่นเดียวกัน = คิดครั้งเดียว (quoteForModel เลือกแถวตามกติกาข้อ 7.1 เอง)
    const seen = new Set<string>();
    const unique = candidates.filter((r) => {
      if (r.category === 'ACCESSORY') return false;
      const k = `${r.brand.toLowerCase()}|${r.model.toLowerCase()}|${normalizeStorage(r.storage)}|${r.category}|${r.hasWarranty}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });

    const origin = quoteOrigin(input.deviceOrigin);
    const templates: PricingTemplateRateMatch[] = [];
    for (const t of unique.slice(0, MAX_MATCHES)) {
      const q = await this.quotes.quoteForModel({
        brand: t.brand,
        model: t.model,
        storage: t.storage,
        category: t.category as QuoteCategory,
        hasWarranty: t.hasWarranty,
        origin,
      });
      if (q) templates.push(fromQuote(t, q, origin));
    }
    return { templates };
  }

  /**
   * ใบเสนอราคาทุกรุ่นของมือ 1 / มือ 2 (เครื่องไทย) ให้ recommend_devices — อ่าน listQuotes ซึ่งโหลด
   * ตั้งค่าครั้งเดียวต่อหมวด แทนการเรียก quoteForModel ทีละแถว
   */
  async listAllRates(): Promise<PricingTemplateRateRow[]> {
    const out: PricingTemplateRateRow[] = [];
    for (const category of ['PHONE_NEW', 'PHONE_USED'] as const) {
      const { rows } = await this.quotes.listQuotes({ category, origin: 'THAI' });
      out.push(...rows.map(fromQuoteRow));
    }
    return out;
  }
}

/**
 * THAI / IMPORTED รวมแถว "ไม่ระบุ" (สเปคข้อ 7.1 — ไม่มีแถวของที่มาเครื่องนั้นให้ใช้แถว "ไม่ระบุ")
 * ไม่ส่ง = ไม่กรอง
 */
function originFilter(origin: string | undefined) {
  if (origin === 'THAI' || origin === 'IMPORTED')
    return { deviceOrigin: { in: [origin, 'UNSPECIFIED'] as ('THAI' | 'IMPORTED' | 'UNSPECIFIED')[] } };
  if (origin === 'UNSPECIFIED') return { deviceOrigin: 'UNSPECIFIED' as const };
  return {};
}

function conditionFilter(condition: string | undefined) {
  const c = String(condition ?? '').replace(/\s+/g, '');
  if (c === 'มือ1') return { category: 'PHONE_NEW' as const };
  if (c === 'มือสอง' || c === 'มือ2') return { category: { not: 'PHONE_NEW' as const } };
  return {};
}
