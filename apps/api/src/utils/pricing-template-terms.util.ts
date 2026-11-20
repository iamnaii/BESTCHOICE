import { Prisma, ProductCategory } from '@prisma/client';
import { pickPricingTemplate, positiveDecimal, TEMPLATE_ORDER } from './pricing-template-match.util';
import { templateKeyOf, type ProductTemplateFields } from './product-finance-price.util';

/**
 * เงื่อนไขผ่อนของราคากลางที่ตรงกับเครื่อง — ค่าตั้งต้นของงวด/ดาวน์บนสติกเกอร์ เครื่องคำนวณหน้าสินค้า และสรุปส่งลูกค้า
 * (ชุดเดียวกับ `buildModelQuote` ของการ์ดหน้าเพิ่มสินค้า / หน้า "ราคาและเรทผ่อน" / บอท — final review C1 I1)
 * ไม่มีทุน กำไร ราคาส่ง GFIN — แค่งวด ดาวน์ และราคาผ่อนของราคากลาง (ตัวตัดสินว่าดาวน์ของราคากลางใช้ได้ไหม)
 */
export interface TemplateTerms {
  /** ราคาผ่อน BESTCHOICE ของราคากลาง — ดาวน์เรท 1 ของราคากลางใช้เฉพาะเมื่อราคาผ่อนของเครื่องเท่านี้ */
  bcPrice: string | null;
  rate1TermMonths: number | null;
  rate1DownPayment: string | null;
  rate2TermMonths: number | null;
}

/** หมวดที่มีราคากลางเรท 1 / เรท 2 */
const TERMS_CATEGORIES: ProductCategory[] = ['PHONE_NEW', 'PHONE_USED', 'TABLET'];

type TemplateReader = { pricingTemplate: Pick<Prisma.TransactionClient['pricingTemplate'], 'findMany'> };

/**
 * อ่านแถวราคากลางครั้งเดียวต่อชุดเครื่อง แล้วเลือกแถวด้วย `pickPricingTemplate` + `templateKeyOf` (ตัวเลือกเดียวกับตอนสร้างเครื่อง
 * และตัวเติมราคาขาย GFIN) · เครื่องที่หาราคากลางไม่ได้ / หมวดอื่น = null
 */
export async function loadTemplateTerms(
  client: TemplateReader,
  products: Array<ProductTemplateFields & { id: string }>,
): Promise<Map<string, TemplateTerms | null>> {
  const out = new Map<string, TemplateTerms | null>(products.map((p) => [p.id, null]));
  const eligible = products.filter((p) => TERMS_CATEGORIES.includes(p.category) && p.brand && p.model);
  if (eligible.length === 0) return out;

  const keys = new Map<string, Prisma.PricingTemplateWhereInput>();
  for (const p of eligible) {
    keys.set(`${p.category}|${p.brand.toLowerCase()}|${p.model.toLowerCase()}`, {
      category: p.category,
      brand: { equals: p.brand, mode: 'insensitive' },
      model: { equals: p.model, mode: 'insensitive' },
    });
  }
  const rows = await client.pricingTemplate.findMany({
    where: { isActive: true, deletedAt: null, OR: [...keys.values()] },
    orderBy: TEMPLATE_ORDER,
  });

  for (const p of eligible) {
    const t = pickPricingTemplate(rows, templateKeyOf(p));
    if (!t) continue;
    out.set(p.id, {
      bcPrice: positiveDecimal(t.installmentBestchoicePrice)?.toString() ?? null,
      rate1TermMonths: t.rate1TermMonths ?? null,
      rate1DownPayment: positiveDecimal(t.rate1DownPayment)?.toString() ?? null,
      rate2TermMonths: t.rate2TermMonths ?? null,
    });
  }
  return out;
}
