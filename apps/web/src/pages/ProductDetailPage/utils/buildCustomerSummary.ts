import { SHOP_BASE_URL } from '@/lib/env';
import { IPHONE_COLORS } from '@/components/product/VariantSelector';
import { formatRateLine } from '@installment/shared';

export { computeDefaultBcInstallment } from '@installment/shared';
export type { BcConfigJson, DefaultInstallment } from '@installment/shared';
import type { DefaultInstallment } from '@installment/shared';

/**
 * ฟอร์แมตเงินแบบ deterministic (ไม่พึ่ง Intl/locale ของเครื่อง) เพราะข้อความนี้
 * ถูกคัดลอกไปส่งลูกค้าและถูก assert แบบตรงตัวในเทสต์
 */
export function formatBaht(value: number): string {
  if (!Number.isFinite(value)) return '-';
  const fixed = Math.abs(value).toFixed(2);
  const [intPart, decPart] = fixed.split('.');
  const withSep = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const sign = value < 0 ? '-' : '';
  return decPart === '00' ? `${sign}${withSep}` : `${sign}${withSep}.${decPart}`;
}

export interface CustomerSummaryInput {
  brand?: string | null;
  model?: string | null;
  storage?: string | null;
  color?: string | null;
  category?: string | null;
  conditionGrade?: string | null;
  batteryHealth?: number | null;
  shopWarrantyDays?: number | null;
  accessoriesIncluded?: string[] | null;
  cosmeticNotes?: string | null;
  cashPrice?: string | number | null;
  installmentPrice?: string | number | null;
  /** เรทที่ 1 = BESTCHOICE (สัญญาของเรา) */
  installment?: DefaultInstallment | null;
  /** เรทที่ 2 = ไฟแนนซ์ภายนอก (GFIN) — ห้ามเอ่ยชื่อไฟแนนซ์กับลูกค้า (สคริปต์ขาย) */
  installment2?: DefaultInstallment | null;
  branchName?: string | null;
  imeiSerial?: string | null;
  link?: string | null;
}

const CATEGORY_LABEL: Record<string, string> = {
  PHONE_NEW: 'เครื่องใหม่',
  PHONE_USED: 'เครื่องมือสอง',
  TABLET: 'แท็บเล็ต',
  ACCESSORY: 'อุปกรณ์เสริม',
};

function toNumber(value: string | number | null | undefined): number | null {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function nonEmpty(value: string | null | undefined): string | null {
  const trimmed = (value ?? '').toString().trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * product.color เก็บค่าอังกฤษดิบ (เช่น 'Natural Titanium' — ดู VariantSelector.tsx
 * IPHONE_COLORS ที่ value=อังกฤษ/label=ไทย). ถ้า map ได้ ใช้ label ไทยพร้อมคำ "สี" นำ
 * (ตรงกับที่พนักงานเห็นในตัวเลือกสี). ถ้า map ไม่ได้ (สีที่พิมพ์เองแบบ custom) fallback
 * เป็นค่าดิบ **ไม่มี** คำว่า "สี" นำ — ตรงกับที่หน้าร้านจริงโชว์ (เช่น "…256GB Natural Titanium").
 */
function resolveColorLabel(color: string | null | undefined): string | null {
  const raw = nonEmpty(color);
  if (!raw) return null;
  const match = IPHONE_COLORS.find((c) => c.value === raw);
  return match ? `สี${match.label}` : raw;
}

/**
 * ข้อความสรุปสำหรับส่งลูกค้าทางแชท — pure function ทั้งก้อน (ไม่แตะ DOM/network)
 * เพื่อให้เป็นแกนที่ทดสอบได้เต็ม. กติกา null-safe: บรรทัดหลัก (ชื่อรุ่น + เงินสด)
 * แสดงเสมอ, บรรทัดรองที่ไม่มีข้อมูล **ตัดทิ้งทั้งบรรทัด** ไม่โชว์ '-' ให้ลูกค้าอ่าน
 */
export function buildCustomerSummary(input: CustomerSummaryInput): string {
  const lines: string[] = [];

  const head = [
    nonEmpty(input.brand),
    nonEmpty(input.model),
    nonEmpty(input.storage),
    resolveColorLabel(input.color),
  ]
    .filter((p): p is string => p !== null)
    .join(' ');

  const condition = [
    input.category ? (CATEGORY_LABEL[input.category] ?? null) : null,
    nonEmpty(input.conditionGrade) ? `เกรด ${nonEmpty(input.conditionGrade)}` : null,
  ].filter((p): p is string => p !== null);

  lines.push(condition.length > 0 ? `${head || '-'} (${condition.join(' ')})` : head || '-');

  const cash = toNumber(input.cashPrice);
  lines.push(
    cash != null && cash > 0 ? `ราคาเงินสด ${formatBaht(cash)} บาท` : 'ราคาเงินสด สอบถามแอดมิน',
  );

  // บรรทัดค่างวดใช้รูปแบบเดียวกับสติกเกอร์หน้าร้าน/บอท: "เรทที่ N ดาวน์ X บาท ผ่อนเดือนละ Y บาท Z งวด"
  // บรรทัดที่ข้อมูลเสีย (NaN/Infinity) ตัดทั้งบรรทัด ไม่โชว์ตัวเลขพังให้ลูกค้าอ่าน
  const instPrice = toNumber(input.installmentPrice);
  const rateLine = (rateNo: 1 | 2, r: DefaultInstallment | null | undefined): string | null =>
    r &&
    instPrice != null &&
    instPrice > 0 &&
    Number.isFinite(r.months) &&
    Number.isFinite(r.downAmount) &&
    Number.isFinite(r.monthlyPayment)
      ? formatRateLine(rateNo, r.downAmount, r.monthlyPayment, r.months)
      : null;
  const rate1 = rateLine(1, input.installment);
  if (rate1) lines.push(rate1);
  const rate2 = rateLine(2, input.installment2);
  if (rate2) lines.push(rate2);

  const accessories = (input.accessoriesIncluded ?? [])
    .map((a) => a.trim())
    .filter((a) => a.length > 0);

  const specs = [
    input.batteryHealth != null && input.batteryHealth > 0 ? `แบต ${input.batteryHealth}%` : null,
    input.shopWarrantyDays != null && input.shopWarrantyDays > 0
      ? `ประกันร้าน ${input.shopWarrantyDays} วัน`
      : null,
    accessories.length > 0 ? `อุปกรณ์: ${accessories.join(', ')}` : null,
  ].filter((s): s is string => s !== null);
  if (specs.length > 0) lines.push(specs.join(' | '));

  const notes = nonEmpty(input.cosmeticNotes);
  if (notes) lines.push(`ตำหนิ: ${notes}`);

  const imei = nonEmpty(input.imeiSerial);
  const tail = [
    nonEmpty(input.branchName) ? `สาขา ${nonEmpty(input.branchName)}` : null,
    imei && imei.length >= 4 ? `เลขเครื่อง 4 ตัวท้าย ${imei.slice(-4)}` : null,
  ].filter((s): s is string => s !== null);
  if (tail.length > 0) lines.push(tail.join(' | '));

  const link = nonEmpty(input.link);
  if (link) lines.push(`ดูรายละเอียด: ${link}`);

  return lines.join('\n');
}

/**
 * ลิงก์หน้าสินค้าฝั่งลูกค้า — ชี้ share endpoint ของ API ที่เสิร์ฟ Open Graph
 * (B4) เพื่อให้ลิงก์ที่แอดมินคัดลอกส่งลูกค้าขึ้นการ์ดใน LINE/Facebook
 * endpoint จะเด้งคนจริงต่อไปที่ /products/:id ทันที
 */
export function buildShopProductUrl(productId: string, base: string = SHOP_BASE_URL): string {
  return `${base.replace(/\/+$/, '')}/api/shop/share/${productId}`;
}
