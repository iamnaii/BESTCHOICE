import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import type { PricingTemplate, Prisma } from '@prisma/client';
import {
  buildModelQuote,
  type BcConfig,
  type GfinModelMappingRow,
  type GfinOverpriceRuleRow,
  type GfinRateFactorRow,
  type ModelQuote,
} from '@installment/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { currentDomainAccess } from '../employee-access/access-execution-context';
import { resolveBcConfigForCategory } from '../../utils/bc-installment-config.util';
import {
  extractStorageToken,
  normalizeStorage,
  stripStorageToken,
} from '../../utils/device-query-normalize.util';
import {
  commissionPctForCategory,
  loadGfinSettings,
  type GfinSettings,
} from '../gfin-config/gfin-settings.util';
import { PricingTemplatesService } from './pricing-templates.service';

export type QuoteCategory = 'PHONE_NEW' | 'PHONE_USED' | 'TABLET';
export type QuoteOrigin = 'THAI' | 'IMPORTED';
export const QUOTE_CATEGORIES: readonly QuoteCategory[] = ['PHONE_NEW', 'PHONE_USED', 'TABLET'];

/** หนึ่งแถวของหน้า "ราคาและเรทผ่อน" — ไม่มีทุน / กำไร / ราคาส่ง GFIN (สเปคข้อ 6) */
export interface PriceQuoteRow {
  /** brand|model|storage|hasWarranty */
  key: string;
  brand: string;
  model: string;
  storage: string;
  category: QuoteCategory;
  /** null = มือ 2 ที่มี/ไม่มีประกันตัวเลขเท่ากัน รวมเป็นแถวเดียว */
  hasWarranty: boolean | null;
  cashPrice: number | null;
  /** monthly = ค่างวดที่แสดง (ปัดขึ้นเป็นบาท) */
  rate1: { downAmount: number; monthly: number; months: number } | null;
  rate2: { downAmount: number; monthly: number; months: number } | { unavailable: string };
}

export interface PriceQuoteList {
  /** วันที่แก้ราคากลางล่าสุด (ISO) */
  updatedAt: string | null;
  rows: PriceQuoteRow[];
}

interface QuoteContext {
  bc: Map<QuoteCategory, BcConfig | null>;
  mappings: GfinModelMappingRow[];
  rules: GfinOverpriceRuleRow[];
  rateFactors: GfinRateFactorRow[];
  settings: GfinSettings;
}

const toNumber = (v: Prisma.Decimal | null | undefined): number | null =>
  v == null ? null : Number(v.toString());

const keyOf = (r: { brand: string; model: string; storage: string; hasWarranty: boolean | null }) =>
  `${r.brand}|${r.model}|${r.storage}|${r.hasWarranty === null ? 'null' : String(r.hasWarranty)}`;

/** แถวเดียวกันมีทั้งของเครื่องไทย/นอกและ "ไม่ระบุ" → ใช้แถวของเครื่องไทย/นอก (สเปคข้อ 7.1) */
function preferOrigin(rows: PricingTemplate[], origin: QuoteOrigin): PricingTemplate[] {
  const byKey = new Map<string, PricingTemplate>();
  for (const r of rows) {
    const k = `${r.brand.toLowerCase()}|${r.model.toLowerCase()}|${normalizeStorage(r.storage)}|${r.hasWarranty}`;
    const prev = byKey.get(k);
    if (!prev || (prev.deviceOrigin !== origin && r.deviceOrigin === origin)) byKey.set(k, r);
  }
  return [...byKey.values()];
}

function toQuoteRow(r: PricingTemplate, q: ModelQuote): PriceQuoteRow {
  return {
    key: keyOf(r),
    brand: r.brand,
    model: r.model,
    storage: r.storage,
    category: r.category as QuoteCategory,
    hasWarranty: r.hasWarranty,
    cashPrice: q.cash?.price ?? null,
    rate1: q.rate1
      ? { downAmount: q.rate1.downAmount, monthly: q.rate1.monthlyDisplay, months: q.rate1.months }
      : null,
    rate2: q.rate2.available
      ? { downAmount: q.rate2.downAmount, monthly: q.rate2.monthly, months: q.rate2.months }
      : { unavailable: q.rate2.message },
  };
}

/** มือ 2 ที่มีประกัน / ไม่มีประกันตัวเลขเท่ากันทุกช่อง → แถวเดียว (สเปคข้อ 6) */
function mergeWarrantyTwins(rows: PriceQuoteRow[]): PriceQuoteRow[] {
  const out: PriceQuoteRow[] = [];
  const twins = new Map<string, PriceQuoteRow[]>();
  for (const r of rows) {
    if (r.category !== 'PHONE_USED') {
      out.push(r);
      continue;
    }
    const k = `${r.brand}|${r.model}|${r.storage}`;
    twins.set(k, [...(twins.get(k) ?? []), r]);
  }
  const numbers = (r: PriceQuoteRow) => JSON.stringify([r.cashPrice, r.rate1, r.rate2]);
  for (const group of twins.values()) {
    if (group.length === 2 && numbers(group[0]) === numbers(group[1])) {
      const merged = { ...group[0], hasWarranty: null };
      out.push({ ...merged, key: keyOf(merged) });
    } else {
      out.push(...group);
    }
  }
  return out;
}

function storageGb(storage: string): number {
  const m = normalizeStorage(storage).match(/^(\d+(?:\.\d+)?)(GB|TB)$/);
  if (!m) return Number.MAX_SAFE_INTEGER;
  return m[2] === 'TB' ? Number(m[1]) * 1024 : Number(m[1]);
}

function sortRows(rows: PriceQuoteRow[]): PriceQuoteRow[] {
  const warrantyRank = (w: boolean | null) => (w === true ? 1 : 0);
  return [...rows].sort(
    (a, b) =>
      a.brand.localeCompare(b.brand) ||
      a.model.localeCompare(b.model, 'en', { numeric: true }) ||
      storageGb(a.storage) - storageGb(b.storage) ||
      warrantyRank(a.hasWarranty) - warrantyRank(b.hasWarranty),
  );
}

/**
 * ใบเสนอราคาตามรุ่นจากตารางราคากลาง — ตัวเลขเดียวกับชีต MASTER (ตัวคำนวณกลาง buildModelQuote)
 * ผู้ใช้: GET /pricing-templates/quotes (หน้า "ราคาและเรทผ่อน") และบอทขาย
 */
@Injectable()
export class PricingQuoteService {
  constructor(
    private readonly base: PrismaService,
    private readonly templates: PricingTemplatesService,
  ) {}

  private get prisma() {
    return currentDomainAccess()?.client ?? this.base;
  }

  async listQuotes(query: {
    category: QuoteCategory;
    origin: QuoteOrigin;
    q?: string;
  }): Promise<PriceQuoteList> {
    const text = (query.q ?? '').trim();
    const storageToken = text ? extractStorageToken(text) : null;
    const modelText = storageToken ? stripStorageToken(text) : text;
    const where: Prisma.PricingTemplateWhereInput = {
      isActive: true,
      deletedAt: null,
      category: query.category,
      deviceOrigin: { in: [query.origin, 'UNSPECIFIED'] },
    };
    if (modelText) {
      where.OR = [
        { model: { contains: modelText, mode: 'insensitive' } },
        { brand: { contains: modelText, mode: 'insensitive' } },
      ];
    }
    const rows = await this.prisma.pricingTemplate.findMany({
      where,
      orderBy: [{ brand: 'asc' }, { model: 'asc' }, { storage: 'asc' }, { hasWarranty: 'asc' }],
    });
    const latest = await this.prisma.pricingTemplate.aggregate({
      where: { deletedAt: null },
      _max: { updatedAt: true },
    });
    const picked = preferOrigin(rows, query.origin).filter(
      (r) => !storageToken || normalizeStorage(r.storage) === storageToken,
    );
    const ctx = await this.loadContext();
    const quoted = picked.map((r) => toQuoteRow(r, this.quoteTemplate(r, query.origin, ctx)));
    return {
      updatedAt: latest._max.updatedAt ? latest._max.updatedAt.toISOString() : null,
      rows: sortRows(mergeWarrantyTwins(quoted)),
    };
  }

  async quoteForModel(input: {
    brand: string;
    model: string;
    storage: string;
    category: QuoteCategory;
    hasWarranty?: boolean | null;
    origin: QuoteOrigin;
  }): Promise<ModelQuote | null> {
    const row = await this.templates.lookup(
      input.brand,
      input.model,
      input.storage || null,
      input.category,
      input.hasWarranty ?? null,
      input.origin,
    );
    if (!row) return null;
    return this.quoteTemplate(row, input.origin, await this.loadContext());
  }

  private quoteTemplate(r: PricingTemplate, origin: QuoteOrigin, ctx: QuoteContext): ModelQuote {
    const category = r.category as QuoteCategory;
    return buildModelQuote({
      product: { brand: r.brand, model: r.model, storage: r.storage, category },
      deviceOrigin: origin,
      cashPrice: toNumber(r.cashPrice),
      bcPrice: toNumber(r.installmentBestchoicePrice),
      financePrice: toNumber(r.installmentFinancePrice),
      rate1TermMonths: r.rate1TermMonths,
      rate1DownPayment: toNumber(r.rate1DownPayment),
      rate2TermMonths: r.rate2TermMonths,
      bcConfig: ctx.bc.get(category) ?? null,
      gfin: {
        mappings: ctx.mappings,
        rules: ctx.rules,
        rateFactors: ctx.rateFactors,
        settingMinDownPct: new Decimal(ctx.settings.minDownPct).div(100),
        commissionPct: commissionPctForCategory(ctx.settings, category),
        contractFee: new Decimal(ctx.settings.contractFee),
      },
    });
  }

  /** ตั้งค่าดอกเบี้ยทั้ง 3 หมวด + ตาราง GFIN — ครั้งเดียวต่อคำขอ (อ่านทีละคำสั่ง: client ในธุรกรรมสิทธิ์รันคำสั่งเรียงกันอยู่แล้ว) */
  private async loadContext(): Promise<QuoteContext> {
    const db = this.prisma;
    const bc = new Map<QuoteCategory, BcConfig | null>();
    for (const category of QUOTE_CATEGORIES) {
      const resolved = await resolveBcConfigForCategory(db, category);
      bc.set(category, resolved.found && resolved.config ? resolved.config : null);
    }
    const mappings = await db.gfinModelMapping.findMany({ where: { deletedAt: null, isActive: true } });
    const rules = await db.gfinOverpriceRule.findMany({ where: { deletedAt: null, isActive: true } });
    const factors = await db.gfinRateFactor.findMany({ where: { deletedAt: null, isActive: true } });
    const settings = await loadGfinSettings(db);
    return {
      bc,
      mappings: mappings.map((m) => ({
        id: m.id,
        gfinSeries: m.gfinSeries,
        gfinVariant: m.gfinVariant,
        storage: m.storage,
        condition: m.condition,
        maxPrice: new Decimal(m.maxPrice.toString()),
        modelMatchPattern: m.modelMatchPattern,
        isActive: m.isActive,
      })),
      rules: rules.map((r) => ({
        id: r.id,
        label: r.label,
        seriesPattern: r.seriesPattern,
        condition: r.condition,
        allowance: new Decimal(r.allowance.toString()),
        maxMonths: r.maxMonths ?? null,
        minDownPct: r.minDownPct ?? null,
        isActive: r.isActive,
      })),
      rateFactors: factors.map((f) => ({
        months: f.months,
        shopCommissionPct: f.shopCommissionPct,
        factor: new Decimal(f.factor.toString()),
        feePerInstallment: new Decimal(f.feePerInstallment.toString()),
        isActive: f.isActive,
      })),
      settings,
    };
  }
}
