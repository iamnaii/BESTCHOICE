import { Prisma, ProductCategory, type PricingTemplate } from '@prisma/client';
import { normalizeStorage } from './device-query-normalize.util';
import { syncPriceRowsFromColumns } from './product-price-sync.util';

export interface AutofillResult {
  filled: boolean;
  reason: 'FILLED' | 'ALREADY_PRICED' | 'NO_TEMPLATE' | 'ZERO_PRICE';
  templateId?: string;
  cashPrice?: Prisma.Decimal;
  installmentPrice?: Prisma.Decimal;
}

export interface AutofillInput {
  deviceOrigin?: 'THAI' | 'IMPORTED' | null;
  productId: string;
  brand: string;
  model: string;
  storage: string | null;
  category: ProductCategory;
  /** null = ไม่รู้สถานะประกันของเครื่อง (เช่น เทิร์นเข้ามา) */
  hasWarranty: boolean | null;
  currentCashPrice: Prisma.Decimal | null;
}

type Logger = { warn: (m: string) => void; log: (m: string) => void };

/** เลือกแถวจากชุดเดียวกัน (ที่มาเครื่องเดียว): ความจุตรงก่อน → แถวไม่ระบุความจุ · ประกันแบบ deterministic */
function pickTemplate(
  rows: PricingTemplate[],
  input: AutofillInput,
  logger?: Logger,
): PricingTemplate | null {
  const wanted = normalizeStorage(input.storage);
  let candidates = rows.filter((r) => normalizeStorage(r.storage) === wanted);
  if (candidates.length === 0) candidates = rows.filter((r) => normalizeStorage(r.storage) === '');
  if (candidates.length === 0) return null;

  if (input.category !== 'PHONE_USED') {
    const noWarranty = candidates.filter((r) => r.hasWarranty === false);
    if (noWarranty.length > 0) candidates = noWarranty;
  } else if (input.hasWarranty !== null) {
    candidates = candidates.filter((r) => r.hasWarranty === input.hasWarranty);
  } else if (candidates.length > 1) {
    // ไม่รู้สถานะประกัน (เครื่องเทิร์น/รับซื้อส่ง null เสมอ) และเทมเพลตมี 2 แถวต่อรุ่น
    // → เลือก "ไม่มีประกัน" = ราคาต่ำกว่า (อนุรักษ์นิยม ไม่ตั้งราคาสูงเกินจริง)
    const noWarranty = candidates.filter((r) => r.hasWarranty === false);
    if (noWarranty.length > 0) candidates = noWarranty;
    logger?.log(
      `[autofill] product=${input.productId} ไม่รู้สถานะประกัน — ใช้ราคาแถว "ไม่มีประกัน" (${input.brand} ${input.model} ${wanted || 'ไม่ระบุความจุ'})`,
    );
  }
  return candidates[0] ?? null;
}

/**
 * B0 §2.1 — เติมราคาตั้งต้นจากตารางราคากลางตอนสร้าง Product
 *
 * เงื่อนไข: เติมเฉพาะเมื่อยังไม่มี cashPrice (ราคาที่คนกรอกชนะเสมอ) · ราคาผ่อน BESTCHOICE ของราคากลาง
 * = ราคาเต็มเสมอ (สเปคข้อ 3.1 — เลิกค่าตั้ง pricing_template_installment_semantics และการเดาว่า
 * "ราคาผ่อนต่ำกว่าเงินสด = ค่างวด" เพราะมือ 2 ในชีตตั้งราคาผ่อนต่ำกว่าเงินสดทุกรุ่น) จึงเติมพร้อมเงินสด
 * · ไม่มีแถวของเครื่องไทย/นอก → ถอยไปแถว "ไม่ระบุ" (สเปคข้อ 7.1)
 *
 * ต้องเรียกภายใน tx ของ caller
 */
export async function autofillProductPriceFromTemplate(
  tx: Prisma.TransactionClient,
  input: AutofillInput,
  logger?: Logger,
): Promise<AutofillResult> {
  if (input.currentCashPrice != null && input.currentCashPrice.greaterThan(0)) {
    return { filled: false, reason: 'ALREADY_PRICED' };
  }

  const origin = input.deviceOrigin ?? 'UNSPECIFIED';
  const origins: ('THAI' | 'IMPORTED' | 'UNSPECIFIED')[] =
    origin === 'UNSPECIFIED' ? ['UNSPECIFIED'] : [origin, 'UNSPECIFIED'];
  const rows = await tx.pricingTemplate.findMany({
    where: {
      deviceOrigin: { in: origins },
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

  let template: PricingTemplate | null = null;
  for (const o of origins) {
    template = pickTemplate(rows.filter((r) => r.deviceOrigin === o), input, logger);
    if (template) break;
  }
  if (!template) return { filled: false, reason: 'NO_TEMPLATE' };

  const cashPrice = new Prisma.Decimal(template.cashPrice.toString());
  if (!cashPrice.greaterThan(0)) return { filled: false, reason: 'ZERO_PRICE' };

  const templateInstallment = new Prisma.Decimal(template.installmentBestchoicePrice.toString());
  const installmentPrice = templateInstallment.greaterThan(0) ? templateInstallment : undefined;

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

  return { filled: true, reason: 'FILLED', templateId: template.id, cashPrice, installmentPrice };
}
