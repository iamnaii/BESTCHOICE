import type { ProductQuote } from './product-quote.service';

export interface ProductCardFacts {
  name: string;
  brand: string;
  model: string;
  color: string | null;
  storage: string | null;
  /** ProductCategory */
  category: string;
  /** ProductStatus */
  status: string;
  conditionGrade: string | null;
  batteryHealth: number | null;
  shopWarrantyDays: number | null;
  branchName: string | null;
}

const STATUS_TEXT: Record<string, string> = {
  IN_STOCK: 'พร้อมขาย',
  RESERVED: 'ติดจองชั่วคราว',
  SOLD_CASH: 'ขายแล้ว',
  SOLD_INSTALLMENT: 'ขายผ่อนแล้ว',
  SOLD_RESELL: 'ขายแล้ว',
};

const GRADE_TEXT: Record<string, string> = {
  A: 'สภาพ A (สวยมาก)',
  B: 'สภาพ B (สวย)',
  C: 'สภาพ C (มีตำหนิ)',
};

export function fmtBaht(n: number): string {
  return n.toLocaleString('th-TH', { maximumFractionDigits: 2 });
}

/**
 * ข้อความการ์ดสินค้าที่ส่งให้ลูกค้า — ทุกตัวเลขมาจาก ProductQuote (ราคาคอลัมน์ +
 * InterestConfig จริง) ไม่มีค่าคงที่ 'ผ่อนได้สูงสุด 12 งวด' และไม่มี fallback
 * prices[0] แบบเดิมอีกแล้ว
 */
export function buildProductCardText(
  p: ProductCardFacts,
  quote: ProductQuote,
  shareUrl: string | null,
): string {
  const title =
    [p.brand, p.model, p.storage, p.color].filter(Boolean).join(' ').trim() || p.name;
  const lines: string[] = [`📱 ${title}`];

  lines.push(
    quote.cashPrice != null
      ? `💰 เงินสด ${fmtBaht(quote.cashPrice)} บาท`
      : '💰 สอบถามราคากับแอดมินได้เลยค่ะ',
  );

  if (quote.months != null && quote.monthlyPayment != null) {
    const down = quote.downAmount != null ? ` (ดาวน์ ${fmtBaht(quote.downAmount)} บาท)` : '';
    lines.push(`📆 ผ่อน ${quote.months} งวด งวดละ ${fmtBaht(quote.monthlyPayment)} บาท${down}`);
  }

  if (p.category === 'PHONE_USED' && p.conditionGrade) {
    lines.push(`⭐ ${GRADE_TEXT[p.conditionGrade] ?? `สภาพ ${p.conditionGrade}`}`);
  }
  if (p.batteryHealth != null) lines.push(`🔋 แบตเตอรี่ ${p.batteryHealth}%`);
  if (p.shopWarrantyDays != null) lines.push(`🛡️ ประกันร้าน ${p.shopWarrantyDays} วัน`);
  if (p.branchName) lines.push(`📍 สาขา${p.branchName}`);

  lines.push(`สถานะ: ${STATUS_TEXT[p.status] ?? p.status}`);
  if (shareUrl) lines.push(shareUrl);

  return lines.join('\n');
}
