import { Prisma, ProductCategory } from '@prisma/client';
import { normalizeStorage } from './device-query-normalize.util';
import { syncPriceRowsFromColumns } from './product-price-sync.util';
import { readStringFlag } from './config.util';

export type TemplateInstallmentSemantics = 'PER_MONTH' | 'TOTAL';
export const SEMANTICS_CONFIG_KEY = 'pricing_template_installment_semantics';

export interface AutofillResult {
  filled: boolean;
  reason:
    | 'FILLED'
    | 'ALREADY_PRICED'
    | 'NO_TEMPLATE'
    | 'ZERO_PRICE'
    /** เติมราคาเงินสดแล้ว แต่ข้ามราคาผ่อนเพราะเลขดูเป็น "ค่างวดต่อเดือน" (filled = true) */
    | 'INSTALLMENT_LOOKS_PER_MONTH';
  templateId?: string;
  cashPrice?: Prisma.Decimal;
  installmentPrice?: Prisma.Decimal;
}

export interface AutofillInput {
  productId: string;
  brand: string;
  model: string;
  storage: string | null;
  category: ProductCategory;
  /** null = ไม่รู้สถานะประกันของเครื่อง (เช่น เทิร์นเข้ามา) */
  hasWarranty: boolean | null;
  currentCashPrice: Prisma.Decimal | null;
}

/**
 * Fix round 1 [Minor] — อ่าน + validate flag `pricing_template_installment_semantics`
 * ครั้งเดียว แยกออกมาเป็น export ได้ เพื่อให้ caller ที่เรียก `autofillProductPriceFromTemplate`
 * ในลูป (เช่น po-receiving รับหลายเครื่องต่อ 1 batch) hoist การอ่าน SystemConfig ออกนอกลูป
 * แล้วส่งผลลัพธ์ที่ validate แล้วเข้ามาทาง `semanticsOverride` แทนการอ่านซ้ำทุกรอบใน
 * Serializable tx เดียวกัน (50 เครื่อง = 50 queries โดยไม่จำเป็น)
 */
export async function resolveInstallmentSemantics(
  tx: Prisma.TransactionClient,
  logger?: { warn: (m: string) => void },
): Promise<TemplateInstallmentSemantics> {
  const rawSemantics = await readStringFlag(tx, SEMANTICS_CONFIG_KEY, 'PER_MONTH');
  // validate: `as TemplateInstallmentSemantics` เฉยๆ รับสตริงอะไรก็ได้ — พิมพ์ผิดจะเงียบ
  const semantics: TemplateInstallmentSemantics =
    rawSemantics === 'TOTAL' || rawSemantics === 'PER_MONTH' ? rawSemantics : 'PER_MONTH';
  if (semantics !== rawSemantics) {
    logger?.warn(
      `[autofill] SystemConfig ${SEMANTICS_CONFIG_KEY}='${rawSemantics}' ไม่ใช่ค่าที่รองรับ (TOTAL|PER_MONTH) — ใช้ค่าเริ่มต้น PER_MONTH`,
    );
  }
  return semantics;
}

/**
 * B0 §2.1 — เติมราคาตั้งต้นจากตารางราคากลางตอนสร้าง Product
 *
 * เงื่อนไข: เติมเฉพาะเมื่อยังไม่มี cashPrice (ราคาที่คนกรอกชนะเสมอ),
 * normalize ความจุ null↔''↔'128 GB', เลือกแถว hasWarranty แบบ deterministic
 * (กำกวม = ข้าม + log ไม่เดา), stamp priceAutofilledAt เพื่อให้ UI ติดป้ายได้
 *
 * ต้องเรียกภายใน tx ของ caller
 */
export async function autofillProductPriceFromTemplate(
  tx: Prisma.TransactionClient,
  input: AutofillInput,
  logger?: { warn: (m: string) => void; log: (m: string) => void },
  /**
   * Fix round 1 [Minor]: caller ที่เรียกในลูป (po-receiving) ควร resolve ครั้งเดียวก่อนลูป
   * ด้วย `resolveInstallmentSemantics` แล้วส่งเข้ามาตรงนี้ — ข้าม readStringFlag ซ้ำ. ไม่ส่ง
   * (undefined) = พฤติกรรมเดิมเป๊ะ อ่าน+validate เองภายใน (caller ที่เรียกครั้งเดียวต่อ tx
   * อย่าง products.service.ts/trade-in ไม่ต้องแก้อะไร)
   */
  semanticsOverride?: TemplateInstallmentSemantics,
): Promise<AutofillResult> {
  if (input.currentCashPrice != null && input.currentCashPrice.greaterThan(0)) {
    return { filled: false, reason: 'ALREADY_PRICED' };
  }

  const rows = await tx.pricingTemplate.findMany({
    where: {
      isActive: true,
      deletedAt: null,
      category: input.category,
      brand: { equals: input.brand, mode: 'insensitive' },
      model: { equals: input.model, mode: 'insensitive' },
    },
    // deterministic: hasWarranty asc = แถว false (ไม่มีประกัน / ราคาถูกกว่า) มาก่อนเสมอ
    orderBy: [{ hasWarranty: 'asc' }, { createdAt: 'asc' }],
  });
  if (rows.length === 0) return { filled: false, reason: 'NO_TEMPLATE' };

  // 1) ความจุ: ตรงก่อน แล้วค่อย fallback แถว storage ว่าง
  const wanted = normalizeStorage(input.storage);
  let candidates = rows.filter((r) => normalizeStorage(r.storage) === wanted);
  if (candidates.length === 0) candidates = rows.filter((r) => normalizeStorage(r.storage) === '');
  if (candidates.length === 0) return { filled: false, reason: 'NO_TEMPLATE' };

  // 2) ประกัน: deterministic เท่านั้น
  if (input.category !== 'PHONE_USED') {
    const noWarranty = candidates.filter((r) => r.hasWarranty === false);
    if (noWarranty.length > 0) candidates = noWarranty;
  } else if (input.hasWarranty !== null) {
    candidates = candidates.filter((r) => r.hasWarranty === input.hasWarranty);
  } else if (candidates.length > 1) {
    // ไม่รู้สถานะประกัน (เครื่องเทิร์น/รับซื้อส่ง null เสมอ) และเทมเพลตมี 2 แถวต่อรุ่น
    // → เลือก "ไม่มีประกัน" = ราคาต่ำกว่า (อนุรักษ์นิยม ไม่ตั้งราคาสูงเกินจริง)
    // precedent เดิม: pricing-templates.service.ts:37 ใช้ `hasWarranty ?? false`
    const noWarranty = candidates.filter((r) => r.hasWarranty === false);
    if (noWarranty.length > 0) candidates = noWarranty;
    logger?.log(
      `[autofill] product=${input.productId} ไม่รู้สถานะประกัน — ใช้ราคาแถว "ไม่มีประกัน" (${input.brand} ${input.model} ${wanted || 'ไม่ระบุความจุ'})`,
    );
  }
  if (candidates.length === 0) return { filled: false, reason: 'NO_TEMPLATE' };

  const template = candidates[0];
  const cashPrice = new Prisma.Decimal(template.cashPrice.toString());
  if (!cashPrice.greaterThan(0)) return { filled: false, reason: 'ZERO_PRICE' };

  // 3) ความหมายของ installmentBestchoicePrice — gate ของ owner (spec §9.1)
  // readStringFlag รับ Prisma.TransactionClient ได้ตรงๆ ไม่ต้อง cast —
  // precedent: expense-document-lifecycle.service.ts:866-872 ส่ง tx เข้าไปแบบเดียวกัน
  // Fix round 1 [Minor]: caller ที่ resolve ไว้ก่อนลูปแล้วส่ง semanticsOverride เข้ามา ข้าม
  // การอ่าน+validate ซ้ำตรงนี้ทั้งหมด (ทั้ง query และ warn log)
  const semantics: TemplateInstallmentSemantics =
    semanticsOverride ?? (await resolveInstallmentSemantics(tx, logger));

  // sanity guard: ถ้าเลข "ราคาผ่อน" ต่ำกว่าราคาเงินสด แปลว่ามันคือค่างวดต่อเดือน
  // (sticker ตีความแบบนั้นอยู่ — stickers.service.ts:175) เขียนลง Product.installmentPrice
  // ไม่ได้เด็ดขาด เพราะหลัง Task 1 คอลัมน์นี้ชนะทุกแถวในเครื่องคิดเงินสัญญา
  const templateInstallment = new Prisma.Decimal(template.installmentBestchoicePrice.toString());
  const looksPerMonth = templateInstallment.lessThan(cashPrice);
  const installmentPrice =
    semantics === 'TOTAL' && !looksPerMonth ? templateInstallment : undefined;

  if (semantics === 'TOTAL' && looksPerMonth) {
    logger?.warn(
      `[autofill] product=${input.productId} ข้ามการเติมราคาผ่อน — เทมเพลต ${template.id} มีราคาผ่อน ${templateInstallment.toString()} ต่ำกว่าราคาเงินสด ${cashPrice.toString()} (น่าจะเป็นค่างวดต่อเดือน ไม่ใช่ยอดเต็ม)`,
    );
  } else if (semantics !== 'TOTAL') {
    logger?.log(
      `[autofill] product=${input.productId} เติมเฉพาะราคาเงินสด (semantics=${semantics}) — ราคาผ่อนต้องกรอกเอง`,
    );
  }

  await tx.product.update({
    where: { id: input.productId },
    data: {
      cashPrice,
      ...(installmentPrice ? { installmentPrice } : {}),
      priceAutofilledAt: new Date(),
    },
  });

  await syncPriceRowsFromColumns(tx, input.productId, {
    cashPrice,
    installmentPrice: installmentPrice ?? null,
  });

  return {
    filled: true,
    reason: semantics === 'TOTAL' && looksPerMonth ? 'INSTALLMENT_LOOKS_PER_MONTH' : 'FILLED',
    templateId: template.id,
    cashPrice,
    installmentPrice,
  };
}
