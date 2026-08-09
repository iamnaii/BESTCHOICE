import Decimal from 'decimal.js';
import { calcBcInstallment } from '@installment/shared';
import { SHOP_BASE_URL } from '@/lib/env';
import { IPHONE_COLORS } from '@/components/product/VariantSelector';

/** shape ของ GET /interest-configs/resolved?category=... */
export interface BcConfigJson {
  minDownPct: number;
  commissionPct: number;
  vatPct: number;
  ratePctByMonths: Record<number, number>;
  allowedMonths: number[];
}

export interface DefaultInstallment {
  months: number;
  downAmount: number;
  monthlyPayment: number;
}

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

/**
 * ค่างวด "เริ่มต้น" ของหน้าสินค้า — คำนวณด้วย calcBcInstallment ตรง เพราะ
 * BcCalculatorCard เก็บ state ไว้ภายในและไม่ expose ผลลัพธ์ออกมา (spec §3).
 * ค่า default ต้องตรงกับ BcCalculatorCard.tsx:29-31 เป๊ะ ไม่งั้นข้อความที่
 * คัดลอกจะไม่ตรงกับตัวเลขที่พนักงานเห็นบนจอ.
 */
export function computeDefaultBcInstallment(
  installmentPrice: number | null | undefined,
  config: BcConfigJson | null | undefined,
): DefaultInstallment | null {
  if (installmentPrice == null || !(installmentPrice > 0)) return null;
  if (!config || !config.allowedMonths || config.allowedMonths.length === 0) return null;

  const months = config.allowedMonths.includes(12) ? 12 : config.allowedMonths[0];
  const downAmount = Math.round(installmentPrice * config.minDownPct);

  const result = calcBcInstallment({
    installmentPrice: new Decimal(installmentPrice),
    months,
    customDownAmount: new Decimal(downAmount),
    config: {
      minDownPct: new Decimal(config.minDownPct),
      commissionPct: new Decimal(config.commissionPct),
      vatPct: new Decimal(config.vatPct),
      ratePctByMonths: new Map(
        Object.entries(config.ratePctByMonths).map(([k, v]) => [Number(k), new Decimal(v)]),
      ),
      allowedMonths: config.allowedMonths,
    },
  });

  if (!result.isValid) return null;

  const downAmountNum = result.downAmount.toNumber();
  const monthlyPaymentNum = result.monthlyPayment.toNumber();
  // decimal.js accepts NaN/Infinity as valid Decimal values (no throw) — a corrupt
  // config (e.g. minDownPct/vatPct already NaN upstream) can sail through calcBcInstallment
  // with isValid still true. Treat a non-finite result as invalid so the caller never
  // receives a NaN/Infinity to print into a customer-facing message.
  if (!Number.isFinite(downAmountNum) || !Number.isFinite(monthlyPaymentNum)) return null;

  return {
    months,
    downAmount: downAmountNum,
    monthlyPayment: monthlyPaymentNum,
  };
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
  installment?: DefaultInstallment | null;
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

  const instPrice = toNumber(input.installmentPrice);
  if (
    input.installment &&
    instPrice != null &&
    instPrice > 0 &&
    Number.isFinite(input.installment.downAmount) &&
    Number.isFinite(input.installment.monthlyPayment)
  ) {
    const { months, downAmount, monthlyPayment } = input.installment;
    lines.push(
      `ผ่อน ${months} งวด ดาวน์ ${formatBaht(downAmount)} บาท งวดละ ${formatBaht(monthlyPayment)} บาท`,
    );
  }

  const accessories = (input.accessoriesIncluded ?? [])
    .map((a) => a.trim())
    .filter((a) => a.length > 0);

  const specs = [
    input.batteryHealth != null && input.batteryHealth > 0
      ? `แบต ${input.batteryHealth}%`
      : null,
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
