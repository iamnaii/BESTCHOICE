import { buildModelQuote, type BcConfigJson, type ModelQuote } from '@installment/shared';
import { toBcConfig } from '@/pages/ProductDetailPage/utils/bcQuote';
import { gfinCategoryOf, hasGfinMapping, toModelQuoteGfinContext, type GfinTables } from '@/pages/ProductDetailPage/utils/gfinQuote';

/** ช่องราคาของการ์ด D: เงินสด · ผ่อน BESTCHOICE (เรท 1) · ราคาขาย GFIN (เรท 2) */
export type PriceKey = 'cash' | 'bc' | 'finance';
export type PriceFields = Record<PriceKey, string>;
export const PRICE_KEYS: PriceKey[] = ['cash', 'bc', 'finance'];
export const EMPTY_PRICE_FIELDS: PriceFields = { cash: '', bc: '', finance: '' };

/** แถวราคากลางจาก `GET /pricing-templates/lookup` (Decimal มาเป็น string) */
export interface PriceTemplate {
  cashPrice: string | number;
  installmentBestchoicePrice: string | number;
  installmentFinancePrice: string | number;
  rate1TermMonths: number | null;
  rate1DownPayment: string | number | null;
  rate2TermMonths: number | null;
}

function positive(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** ช่องตัวเลขของฟอร์ม → ตัวเลข (ตัดช่องว่าง/คอมมา) · ว่าง = null */
function parseAmount(raw: string): number | null {
  const t = raw.replace(/,/g, '').trim();
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function asField(value: string | number | null | undefined): string {
  const n = positive(value);
  return n == null ? '' : String(n);
}

/** ราคากลาง → ค่าในช่อง ("25900.00" → "25900") · ราคา 0 = ช่องว่าง */
export function templateFields(template: PriceTemplate | null): PriceFields | null {
  if (!template) return null;
  return {
    cash: asField(template.cashPrice),
    bc: asField(template.installmentBestchoicePrice),
    finance: asField(template.installmentFinancePrice),
  };
}

/** ช่องที่ผู้ใช้แก้ไปจากราคากลาง — เทียบเป็นตัวเลข · ราคากลางช่องนั้นว่าง = ไม่นับ */
export function editedKeys(fields: PriceFields, template: PriceFields | null): PriceKey[] {
  if (!template) return [];
  return PRICE_KEYS.filter((k) => template[k] !== '' && positive(fields[k]) !== positive(template[k]));
}

/**
 * ได้ราคากลางชุดใหม่ (เปลี่ยนรุ่น / ความจุ / ประกัน / ไทย-นอก) หรือไม่พบ (`next` = null):
 * ช่องที่ว่างหรือยังเป็นราคากลางชุดก่อน → เปลี่ยนตามชุดใหม่ · ช่องที่ผู้ใช้แก้เอง → คงไว้
 */
export function mergeTemplate(current: PriceFields, previous: PriceFields | null, next: PriceFields | null): PriceFields {
  const out = { ...current };
  for (const k of PRICE_KEYS) {
    const untouched = current[k] === '' || (previous !== null && positive(current[k]) === positive(previous[k]));
    if (untouched) out[k] = next ? next[k] : '';
  }
  return out;
}

const CATEGORY_SHORT: Record<string, string> = { PHONE_NEW: 'มือ 1', PHONE_USED: 'มือ 2', TABLET: 'แท็บเล็ต' };

/** หัวการ์ด "ตามตารางราคากลาง · iPhone 15 128GB มือ 1" */
export function templateLabelOf(form: { model: string; storage: string; category: string }): string {
  return [form.model, form.storage, CATEGORY_SHORT[form.category]].filter(Boolean).join(' ');
}

export interface CardQuoteInput {
  category: string;
  brand: string;
  model: string;
  storage: string;
  /** ค่าของช่อง "เครื่องไทย / เครื่องนอก" ในฟอร์ม ('' = ยังไม่ระบุ) */
  deviceOrigin: string;
  fields: PriceFields;
  template: PriceTemplate | null;
  /** ช่อง "ราคาทุน" ของฟอร์มนี้ — ว่าง = ไม่มีกำไร */
  costPrice: string;
  bcConfig?: BcConfigJson;
  gfinTables?: GfinTables;
}

/**
 * ดาวน์ / ค่างวด / กำไรของการ์ด — `buildModelQuote` ตัวเดียวกับหน้า "ราคาและเรทผ่อน" และบอทขาย
 * อุปกรณ์เสริม / ยังไม่เลือกยี่ห้อหรือรุ่น = null
 */
export function computeCardQuote(input: CardQuoteInput): ModelQuote | null {
  const category = gfinCategoryOf(input.category);
  if (!category || !input.brand || !input.model) return null;
  const tpl = templateFields(input.template);
  const bcUntouched = tpl !== null && tpl.bc !== '' && positive(input.fields.bc) === positive(tpl.bc);
  const cost = parseAmount(input.costPrice);
  return buildModelQuote({
    product: { brand: input.brand, model: input.model, storage: input.storage, category },
    deviceOrigin: input.deviceOrigin === 'THAI' || input.deviceOrigin === 'IMPORTED' ? input.deviceOrigin : null,
    cashPrice: positive(input.fields.cash),
    bcPrice: positive(input.fields.bc),
    financePrice: positive(input.fields.finance),
    rate1TermMonths: input.template?.rate1TermMonths ?? null,
    // ดาวน์กำหนดเองของรุ่นผูกกับราคาผ่อนของรุ่น — แก้ราคาผ่อนแล้วกลับไปใช้ดาวน์ขั้นต่ำ
    rate1DownPayment: bcUntouched ? positive(input.template?.rate1DownPayment) : null,
    rate2TermMonths: input.template?.rate2TermMonths ?? null,
    bcConfig: input.bcConfig ? toBcConfig(input.bcConfig) : null,
    gfin: input.gfinTables ? toModelQuoteGfinContext(input.gfinTables, input.category) : null,
    costPrice: cost,
  });
}

/** GFIN ไม่มีใบราคาของรุ่นนี้ → ช่องราคาขาย GFIN ปิด และบันทึกเป็นค่าว่าง (ดูจากตารางรุ่นอย่างเดียว ไม่ขึ้นกับช่องราคา) */
export function gfinBlocked(input: CardQuoteInput): boolean {
  if (!input.gfinTables) return false;
  return (
    hasGfinMapping(
      { brand: input.brand, model: input.model, storage: input.storage, category: input.category },
      input.gfinTables,
    ) === false
  );
}

/** อุปกรณ์เสริม: กำไร = ราคาขาย − ทุน (ไม่มีผ่อน) */
export function accessoryProfit(cash: string, costPrice: string): number | null {
  const price = positive(cash);
  const cost = parseAmount(costPrice);
  return price == null || cost == null ? null : price - cost;
}

export interface PricePayload {
  cashPrice: number | null;
  installmentPrice?: number | null;
  financePrice?: number | null;
}

/**
 * ราคาที่หน้าเพิ่มสินค้าส่ง (สเปคข้อ 5) — คอลัมน์ล้วน ระบบสร้างแถวราคาและค่าเริ่มต้นเอง
 * ส่งค่าตามที่เห็นบนการ์ด: ช่องว่าง = null (ไม่ให้เซิร์ฟเวอร์เติมจากราคากลางซ้ำ) · อุปกรณ์เสริมส่งเฉพาะเงินสด
 */
export function toPricePayload(category: string, fields: PriceFields, opts: { gfinBlocked: boolean }): PricePayload {
  if (category === 'ACCESSORY') return { cashPrice: positive(fields.cash) };
  return {
    cashPrice: positive(fields.cash),
    installmentPrice: positive(fields.bc),
    financePrice: opts.gfinBlocked ? null : positive(fields.finance),
  };
}

/** ต้องมีราคาอย่างน้อย 1 ช่องจึงบันทึกได้ (เท่ากติกาเดิม) */
export function hasAnyPrice(payload: PricePayload): boolean {
  return [payload.cashPrice, payload.installmentPrice, payload.financePrice].some((v) => v != null);
}
