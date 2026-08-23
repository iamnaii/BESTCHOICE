import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { normalizeStorage } from '../../../utils/device-query-normalize.util';
import { DEMO_NAME_PREFIX, SHOP_BRAND, SHOP_PHONE_CATEGORIES } from '../../../utils/product-readiness.util';
import { readBoolFlag } from '../../../utils/config.util';
import { compareDevices, findDeviceSpec, type DeviceSpec } from '../data/device-specs';
import {
  GetInstallmentRatesTool,
  type InstallmentRateOption,
  type PricingTemplateRateRow,
} from './get-installment-rates.tool';
import { estimateTradeIn, type TradeInEstimate } from './trade-in-estimate';

export const RECOMMEND_DEVICES_TOOL = {
  name: 'recommend_devices',
  description:
    "Recommend up to 2 iPhone models that fit the customer's budget, computed ENTIRELY " +
    'server-side from the same PricingTemplate rates get_installment_rates reads (sticker-exact ' +
    'baht), live stock counts, and the official Apple spec table. Call this ONCE — only in the ' +
    'recommendation flow: the customer asked you to pick for them ("แนะนำหน่อย", "รุ่นไหนดี", ' +
    '"เลือกไม่ถูก") AND you already know at least one budget (downBudget and/or monthlyBudget, ' +
    'ideally both — ask first if neither is known; without any budget the tool returns reason ' +
    'and no recommendations). Pass the model they use now when known ("ใช้ 11 อยู่"). ' +
    'Do NOT call this when the customer already named the specific model they want — use ' +
    'search_products / get_installment_rates for that. ' +
    'Every recommended item carries the rate plan chosen (rateLabel เรทที่ 1/เรทที่ 2), its ' +
    'downPayment / monthlyPrice / termMonths in BAHT, condition (มือ 1 / มือสอง), whether it ' +
    'is inStock (with unitCount + a sampleUnit), and — when the current model is recognized — ' +
    'betterThanCurrent / worseThanCurrent spec sentences in Thai; when the current model is NOT ' +
    'recognized (Android / unknown) those are empty — use each item\'s `highlights` instead and ' +
    'never describe the customer\'s non-iPhone device from memory. ONLY models NEWER than the ' +
    'current one are returned. nearMiss (≤1) is the closest model that slightly exceeds the ' +
    'budget (overBy = how much over). tradeIn = estimated buy-back value of the current device ' +
    '(grade A, ราคาประมาณ). STRICT: quote numbers and spec sentences ONLY from this result — ' +
    'never invent, round, or compute your own. If recommended is empty, read `reason` and ask ' +
    'the customer to adjust the budget instead of guessing a model.',
  input_schema: {
    type: 'object',
    properties: {
      currentModel: {
        type: 'string',
        description:
          'Raw text of the model the customer uses now, e.g. "ใช้ 11 อยู่", "iPhone XR 64GB" ' +
          '(omit if unknown)',
      },
      downBudget: { type: 'number', description: 'Max down payment in baht, if stated' },
      monthlyBudget: { type: 'number', description: 'Max monthly payment in baht, if stated' },
      preferStorage: {
        type: 'string',
        description: 'Minimum storage the customer wants, e.g. "128GB" (omit if not stated)',
      },
    },
  },
};

export type RateLabel = 'เรทที่ 1' | 'เรทที่ 2';
export type DeviceCondition = 'มือ 1' | 'มือสอง';

export interface RecommendedDevice {
  brand: string;
  model: string;
  storage: string;
  hasWarranty: boolean;
  condition: DeviceCondition;
  rateLabel: RateLabel;
  downPayment: number;
  monthlyPrice: number;
  termMonths: number;
  inStock: boolean;
  unitCount: number;
  sampleUnit?: {
    productId: string;
    batteryHealth: number | null;
    color: string | null;
    photoUrl: string | null;
  };
  betterThanCurrent: string[];
  worseThanCurrent: string[];
  generationGap: number | null;
  /** จุดเด่นของรุ่นนี้จากตารางสเปค (ใช้แทนบรรทัด "ดีกว่า" เมื่อลูกค้าใช้ยี่ห้ออื่น/ไม่รู้รุ่นเดิม) */
  highlights: string[];
}

export interface NearMissDevice extends RecommendedDevice {
  overBy: { down: number; monthly: number };
}

export interface RecommendDevicesResult {
  current: { model: string; recognized: boolean } | null;
  budget: { down: number | null; monthly: number | null };
  /** ≤2 รุ่นที่เข้างบทั้งดาวน์และผ่อน */
  recommended: RecommendedDevice[];
  /** ≤1 รุ่นใกล้งบที่สุด (เฉพาะเมื่อ recommended < 2) */
  nearMiss: NearMissDevice[];
  tradeIn: TradeInEstimate | null;
  /** เมื่อ recommended ว่าง — อธิบายสั้น ๆ ให้บอทถามงบใหม่แทนการเดา */
  reason?: string;
}

export interface RecommendDevicesInput {
  currentModel?: string;
  downBudget?: number;
  monthlyBudget?: number;
  preferStorage?: string;
}

const MAX_RECOMMENDED = 2;
/** เพดาน Product ที่ดึงมานับสต็อก (รุ่นละไม่กี่เครื่อง — 200 พอสำหรับทุก template ที่ผ่านตัวกรอง) */
const STOCK_TAKE = 200;

interface StockRow {
  id: string;
  model: string;
  storage: string | null;
  category: string;
  color: string | null;
  batteryHealth: number | null;
  gallery: string[];
}

interface Candidate {
  template: PricingTemplateRateRow;
  spec: DeviceSpec | null;
  /** เรทที่เข้างบ (ถ้ามี) */
  fit: { label: RateLabel; rate: InstallmentRateOption } | null;
  /** เรทที่ใกล้งบที่สุด + ส่วนที่เกิน (ใช้ทำ nearMiss เมื่อไม่เข้างบ) */
  closest: { label: RateLabel; rate: InstallmentRateOption; overBy: { down: number; monthly: number } };
}

/** '128GB' → 128, '1TB' → 1024, '' / ไม่ใช่ตัวเลข → null */
export function storageGb(storage: string | null | undefined): number | null {
  const m = normalizeStorage(storage).match(/^(\d+(?:\.\d+)?)(GB|TB)?$/);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n <= 0) return null;
  return m[2] === 'TB' ? n * 1024 : n;
}

const toBudget = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
};

/** ชื่อรุ่นเทียบเท่ากันไหม — ใช้ spec canonical ถ้ารู้จักทั้งคู่ ไม่งั้นเทียบข้อความแบบหลวม */
const sameModel = (a: string, b: string): boolean => {
  const sa = findDeviceSpec(a);
  const sb = findDeviceSpec(b);
  if (sa && sb) return sa.model === sb.model;
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
  return norm(a) === norm(b);
};

@Injectable()
export class RecommendDevicesTool {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rates: GetInstallmentRatesTool,
  ) {}

  async run(input: RecommendDevicesInput = {}): Promise<RecommendDevicesResult> {
    const currentText = String(input?.currentModel ?? '').trim();
    const currentSpec = currentText ? findDeviceSpec(currentText) : null;
    const current = currentText
      ? { model: currentSpec?.model ?? currentText, recognized: currentSpec !== null }
      : null;
    const down = toBudget(input?.downBudget);
    const monthly = toBudget(input?.monthlyBudget);
    const minGb = input?.preferStorage ? storageGb(input.preferStorage) : null;

    const [allRates, tradeIn] = await Promise.all([
      this.rates.listAllRates(),
      estimateTradeIn(this.prisma, currentSpec, currentText),
    ]);
    const phoneCats = new Set<string>(SHOP_PHONE_CATEGORIES);
    const templates = allRates.filter((t) => phoneCats.has(t.category));

    const base: RecommendDevicesResult = {
      current,
      budget: { down, monthly },
      recommended: [],
      nearMiss: [],
      tradeIn,
    };
    if (templates.length === 0) return { ...base, reason: 'ยังไม่มีตารางราคาในระบบ' };
    // ไม่รู้งบเลย → ห้ามแนะนำ (ไม่งั้นทุกรุ่น "เข้างบ" แล้วเรียงรุ่นใหม่สุด = เสนอตัวแพงสุดให้ทุกคน)
    // ยังคืน tradeIn ให้บอทใช้ชวนคุยต่อได้ — รีวิว 2026-08-23
    if (down === null && monthly === null) {
      return { ...base, reason: 'ยังไม่ทราบงบดาวน์/งวดต่อเดือน — ถามลูกค้าก่อนแล้วค่อยเรียกใหม่' };
    }

    // (4) ต้อง "ใหม่กว่า" เครื่องที่ใช้อยู่ · (5) ความจุ ≥ ที่ต้องการ
    const eligible: Candidate[] = [];
    for (const t of templates) {
      const spec = findDeviceSpec(t.model);
      if (currentSpec && (!spec || spec.generation <= currentSpec.generation)) continue;
      if (minGb !== null) {
        const gb = storageGb(t.storage);
        if (gb === null || gb < minGb) continue;
      }
      eligible.push({ template: t, spec, ...pickRates(t, down, monthly) });
    }
    if (eligible.length === 0) {
      return {
        ...base,
        reason: currentSpec
          ? `ไม่มีรุ่นที่ใหม่กว่า ${currentSpec.model} ในตารางราคา`
          : 'ไม่มีรุ่นที่ตรงเงื่อนไขในตารางราคา',
      };
    }

    const fitting = eligible.filter((c) => c.fit !== null);
    const missing = eligible.filter((c) => c.fit === null);

    // (6) นับสต็อกครั้งเดียวสำหรับทุก candidate ที่เข้างบ (+ nearMiss ต้องรู้ inStock ด้วย)
    const stock = await this.loadStock([...fitting, ...missing].map((c) => c.template));

    // รู้งบทั้งสองด้าน → ใหม่กว่าดีกว่า (ทุกตัวเข้างบแล้ว) · รู้ด้านเดียว → ด้านที่ไม่รู้ต้องถูกสุดก่อน
    // (ไม่งั้นลูกค้าบอกแค่ดาวน์ 5,000 จะได้รุ่นใหม่สุดที่ผ่อนเดือนละ 3,900 ทั้งที่อาจไหวแค่ 2,000)
    const bothKnown = down !== null && monthly !== null;
    const recommended = fitting
      .map((c) => this.toDevice(c, c.fit!.label, c.fit!.rate, stock, currentSpec))
      .sort(
        (a, b) =>
          Number(b.inStock) - Number(a.inStock) ||
          (bothKnown
            ? genOf(b) - genOf(a) || a.downPayment - b.downPayment || a.monthlyPrice - b.monthlyPrice
            : monthly === null
              ? a.monthlyPrice - b.monthlyPrice || genOf(b) - genOf(a)
              : a.downPayment - b.downPayment || genOf(b) - genOf(a)),
      )
      .slice(0, MAX_RECOMMENDED);

    // (8) ใกล้งบที่สุด ≤1 เมื่อยังแนะนำได้ไม่ครบ 2
    const nearMiss: NearMissDevice[] = [];
    if (recommended.length < MAX_RECOMMENDED && missing.length > 0) {
      const closest = [...missing].sort(
        (a, b) =>
          a.closest.overBy.down + a.closest.overBy.monthly -
            (b.closest.overBy.down + b.closest.overBy.monthly) ||
          genOf(b.template) - genOf(a.template),
      )[0];
      nearMiss.push({
        ...this.toDevice(closest, closest.closest.label, closest.closest.rate, stock, currentSpec),
        overBy: closest.closest.overBy,
      });
    }

    const result: RecommendDevicesResult = { ...base, recommended, nearMiss };
    if (recommended.length === 0) {
      result.reason = currentSpec
        ? `ไม่มีรุ่นที่ใหม่กว่า ${currentSpec.model} ในงบนี้`
        : 'ไม่มีรุ่นที่เข้างบนี้';
    }
    return result;
  }

  /**
   * where เดียวกับ search_products (deletedAt / isOnlineVisible / IN_STOCK+RESERVED /
   * [DEMO] ตาม flag `shop_hide_demo_products` / มือสองต้องมีเกรด) — ดึงครั้งเดียวแล้ว
   * จับคู่ในหน่วยความจำ: contains ใน DB กว้าง ('iPhone 15' ติด 'iPhone 15 Pro Max' ด้วย)
   * จึงต้องเทียบรุ่นให้ตรงจริง + ความจุตรง + category ตรง (มือ 1/มือสอง) ก่อนนับ
   */
  private async loadStock(templates: PricingTemplateRateRow[]): Promise<Map<string, StockRow[]>> {
    const byKey = new Map<string, StockRow[]>();
    if (templates.length === 0) return byKey;
    const excludeDemo = await readBoolFlag(this.prisma, 'shop_hide_demo_products', false);
    const models = [...new Set(templates.map((t) => t.model.trim()).filter((m) => m.length >= 2))];
    if (models.length === 0) return byKey;

    const where: Prisma.ProductWhereInput = {
      deletedAt: null,
      isOnlineVisible: true,
      status: { in: ['IN_STOCK', 'RESERVED'] },
      // อุปกรณ์เสริมชื่อ "ฟิล์ม iPhone 17" ก็ contains ผ่าน — ต้องกรอง brand/category ตั้งแต่ใน SQL
      // ไม่งั้น 575 ชิ้นกินโควตา take ก่อนเครื่องจริง (รีวิว 2026-08-23)
      brand: { equals: SHOP_BRAND, mode: 'insensitive' },
      category: { in: [...SHOP_PHONE_CATEGORIES] },
      ...(excludeDemo ? { NOT: { name: { startsWith: DEMO_NAME_PREFIX } } } : {}),
      OR: models.map((m) => ({ model: { contains: m, mode: 'insensitive' as const } })),
      AND: [
        {
          OR: [
            { category: { not: 'PHONE_USED' } },
            { AND: [{ conditionGrade: { not: null } }, { conditionGrade: { not: '' } }] },
          ],
        },
      ],
    };
    const rows: StockRow[] = await this.prisma.product.findMany({
      where,
      take: STOCK_TAKE,
      orderBy: [{ batteryHealth: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
      select: {
        id: true,
        model: true,
        storage: true,
        category: true,
        color: true,
        batteryHealth: true,
        gallery: true,
      },
    });

    for (const t of templates) {
      const key = stockKey(t);
      if (byKey.has(key)) continue;
      byKey.set(
        key,
        rows.filter(
          (r) =>
            r.category === t.category &&
            normalizeStorage(r.storage) === normalizeStorage(t.storage) &&
            sameModel(r.model, t.model),
        ),
      );
    }
    return byKey;
  }

  private toDevice(
    c: Candidate,
    label: RateLabel,
    rate: InstallmentRateOption,
    stock: Map<string, StockRow[]>,
    currentSpec: DeviceSpec | null,
  ): RecommendedDevice {
    const t = c.template;
    const units = stock.get(stockKey(t)) ?? [];
    const sample = [...units].sort(
      (a, b) => (b.batteryHealth ?? -1) - (a.batteryHealth ?? -1),
    )[0];
    const diff = currentSpec && c.spec ? compareDevices(currentSpec, c.spec) : null;
    return {
      brand: t.brand,
      model: t.model,
      storage: t.storage,
      hasWarranty: t.hasWarranty,
      // category คือตัวบอกมือ 1/มือสอง — hasWarranty = มือสองที่ยังมีประกัน (schema comment)
      condition: t.category === 'PHONE_NEW' ? 'มือ 1' : 'มือสอง',
      rateLabel: label,
      downPayment: rate.downPayment,
      monthlyPrice: rate.monthlyPrice,
      termMonths: rate.termMonths,
      inStock: units.length > 0,
      unitCount: units.length,
      ...(sample
        ? {
            sampleUnit: {
              productId: sample.id,
              batteryHealth: sample.batteryHealth ?? null,
              color: sample.color ?? null,
              photoUrl: sample.gallery?.[0] ?? null,
            },
          }
        : {}),
      betterThanCurrent: diff?.better ?? [],
      worseThanCurrent: diff?.worse ?? [],
      generationGap: diff?.generationGap ?? null,
      highlights: c.spec?.highlights ?? [],
    };
  }
}

const stockKey = (t: PricingTemplateRateRow): string =>
  `${t.category}|${t.model.toLowerCase()}|${normalizeStorage(t.storage)}`;

/** generation ของรุ่น (ไม่รู้จัก → -1 ให้ไปท้ายสุด) */
const genOf = (d: { model: string }): number => findDeviceSpec(d.model)?.generation ?? -1;

/**
 * (3) เลือกเรท: ผ่านทั้งดาวน์และผ่อน (เฉพาะงบที่ระบุ) — ผ่านทั้ง 2 เรทเลือกที่ผ่อนต่ำกว่า
 * ไม่ผ่านเลย → เก็บเรทที่ "เกินน้อยที่สุด" ไว้ทำ nearMiss
 */
function pickRates(
  t: PricingTemplateRateRow,
  down: number | null,
  monthly: number | null,
): Pick<Candidate, 'fit' | 'closest'> {
  const options: { label: RateLabel; rate: InstallmentRateOption }[] = [
    { label: 'เรทที่ 1', rate: t.rate1 },
    { label: 'เรทที่ 2', rate: t.rate2 },
  ];
  const overOf = (r: InstallmentRateOption) => ({
    down: down !== null ? Math.max(0, r.downPayment - down) : 0,
    monthly: monthly !== null ? Math.max(0, r.monthlyPrice - monthly) : 0,
  });
  const fits = options
    .filter((o) => {
      const ov = overOf(o.rate);
      return ov.down === 0 && ov.monthly === 0;
    })
    .sort((a, b) => a.rate.monthlyPrice - b.rate.monthlyPrice || a.rate.downPayment - b.rate.downPayment);
  const closest = options
    .map((o) => ({ ...o, overBy: overOf(o.rate) }))
    .sort(
      (a, b) =>
        a.overBy.down + a.overBy.monthly - (b.overBy.down + b.overBy.monthly) ||
        a.rate.monthlyPrice - b.rate.monthlyPrice,
    )[0];
  return { fit: fits[0] ?? null, closest };
}
