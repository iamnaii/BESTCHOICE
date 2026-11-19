import { Prisma, ProductCategory } from '@prisma/client';
import { syncPriceRowsFromColumns } from './product-price-sync.util';
import { findPricingTemplate } from './pricing-template-match.util';

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

  // ตัวเลือกแถวตัวเดียวกับราคาขาย GFIN (`fillFinancePriceFromTemplate`) — ความจุ · ประกัน · ถอยไป "ไม่ระบุ" (ข้อ 7.1)
  const template = await findPricingTemplate(tx, input);
  if (!template) return { filled: false, reason: 'NO_TEMPLATE' };
  if (input.category === 'PHONE_USED' && input.hasWarranty === null) {
    logger?.log(
      `[autofill] product=${input.productId} ไม่รู้สถานะประกัน — ใช้ราคาแถว "ไม่มีประกัน" ถ้ามี (${input.brand} ${input.model} ${input.storage ?? 'ไม่ระบุความจุ'})`,
    );
  }

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
