import { displayInstallment } from '@installment/shared';
import { getPositiveDisplayPrices, type ProductPriceRow } from '@/utils/getDisplayPrices';
import {
  buildCustomerSummary,
  buildShopProductUrl,
  computeDefaultBcInstallment,
} from '../utils/buildCustomerSummary';
import { useBcConfig } from './useBcConfig';
import { useProductReadiness } from './useProductReadiness';
import type { ResolvedQuotes } from '../utils/resolveQuotes';

interface ProductForSummary {
  id: string;
  brand: string;
  model: string;
  storage: string | null;
  color: string | null;
  category: string;
  conditionGrade: string | null;
  batteryHealth: number | null;
  shopWarrantyDays: number | null;
  effectiveShopWarrantyDays?: number;
  deviceOrigin?: 'THAI' | 'IMPORTED' | null;
  warrantyTerms?: string | null;
  accessoriesIncluded: string[] | null;
  cosmeticNotes: string | null;
  cashPrice: string | null;
  installmentPrice: string | null;
  imeiSerial: string | null;
  branch: { name: string };
  /**
   * fix-round 1 (C1): the price CARD (SellingPriceCard, Task 7 — see index.tsx:281)
   * displays whatever `getPositiveDisplayPrices` resolves — raw column first, falling
   * back to a `prices[]` label match when the column is null/non-positive. The
   * customer-facing summary must read prices through the SAME function, or a product
   * that's `isReady=true` (has a real prices[] row) but still has a null column would
   * silently drop its ผ่อน/เงินสด line even though the card right above it shows a price.
   */
  prices: ProductPriceRow[];
}

/**
 * @param quotes ค่าที่เครื่องคำนวณใช้อยู่ (resolveQuotes) — ถ้าส่งมา สรุปจะใช้งวด/ดาวน์ที่พนักงานเลือก
 *   (เรทที่ 1 = BESTCHOICE, เรทที่ 2 = GFIN เมื่อรุ่นนี้ส่ง GFIN ได้) · ไม่ส่ง = ค่าตั้งต้นเหมือนเดิม
 */
export function useCustomerSummary(product: ProductForSummary | undefined, quotes?: ResolvedQuotes) {
  // fix-round 1 (C1): ราคาที่ใช้คำนวณสรุปต้องเป็นเส้นเดียวกับการ์ด — ห้ามอ่านคอลัมน์
  // cashPrice/installmentPrice ดิบตรงๆ (ดู comment บน ProductForSummary.prices ด้านบน)
  const displayPrices = product
    ? getPositiveDisplayPrices(product)
    : { cash: null, installment: null };

  // useBcConfig = key/หมวดชุดเดียวกับการ์ดคำนวณและสติกเกอร์ (มือถือ + แท็บเล็ต) → react-query ยิงครั้งเดียว
  // (M2) ถ้า config โหลดพลาด bcConfig ค้างเป็น undefined → computeDefaultBcInstallment คืน null →
  // buildCustomerSummary ตัดบรรทัด "ผ่อน..." ทิ้งเงียบ ๆ แทนที่จะโชว์ตัวเลขพัง — พฤติกรรมเดิม ยอมรับได้
  const { data: bcConfig } = useBcConfig(product?.category, displayPrices.installment != null);

  // fix-round 1 (C2): gate บรรทัดลิงก์ในสรุปด้วย readiness จริง — dedupe query key เดียวกับ
  // ReadinessCard (Task 8, ผ่าน PRODUCT_READINESS_QUERY_KEY ภายใน useProductReadiness เอง)
  const { data: readiness } = useProductReadiness(product?.id);

  if (!product) return { summaryText: '', shareUrl: '' };

  // ค่าที่เลือกอยู่ในเครื่องคำนวณมาก่อน (ถ้า valid) — ตกไปค่าตั้งต้นเมื่อการ์ดยังไม่โหลด/ดาวน์ไม่ผ่านเงื่อนไข
  // ค่างวดเรท 1 ที่ส่งลูกค้าปัดขึ้นบาทเต็ม (หน้าราคา · บอท · สติกเกอร์) — สัญญายังเก็บสตางค์
  const bcSelected =
    quotes?.bc && quotes.bc.quote.result.isValid
      ? {
          months: quotes.bc.months,
          downAmount: quotes.bc.downAmount,
          monthlyPayment: displayInstallment(quotes.bc.quote.result.monthlyPayment),
        }
      : null;
  const fallback = bcSelected ? null : computeDefaultBcInstallment(displayPrices.installment, bcConfig ?? null);
  const installment =
    bcSelected ?? (fallback ? { ...fallback, monthlyPayment: displayInstallment(fallback.monthlyPayment) } : null);
  const installment2 =
    quotes?.gfin?.quote.available && quotes.gfin.months != null
      ? {
          months: quotes.gfin.months,
          downAmount: quotes.gfin.quote.result.downAmountActual.toNumber(),
          monthlyPayment: quotes.gfin.quote.result.monthlyPayment.toNumber(),
        }
      : null;
  const shareUrl = buildShopProductUrl(product.id);
  // ไม่ ready = เว็บลูกค้ายังไม่ขึ้น → ห้ามแนบลิงก์ตายในสรุป (ปุ่ม "คัดลอกลิงก์" เองก็ disable ด้วย
  // เหตุผลเดียวกัน — ข้อความสรุปต้อง consistent กับปุ่ม) แต่ปุ่ม "คัดลอกสรุปส่งลูกค้า" ยังใช้ได้ปกติ
  // เพราะแอดมินอาจอยากส่งสเปค/ราคาให้ลูกค้าทางแชทแม้เครื่องยังไม่ขึ้นเว็บ — ตัดแค่บรรทัดลิงก์ ไม่ตัดทั้งข้อความ
  const isReady = readiness?.isReady ?? false;

  return {
    shareUrl,
    summaryText: buildCustomerSummary({
      brand: product.brand,
      model: product.model,
      storage: product.storage,
      color: product.color,
      category: product.category,
      conditionGrade: product.conditionGrade,
      batteryHealth: product.batteryHealth,
      shopWarrantyDays: product.effectiveShopWarrantyDays ?? product.shopWarrantyDays,
      deviceOrigin: product.deviceOrigin,
      warrantyTerms: product.warrantyTerms,
      accessoriesIncluded: product.accessoriesIncluded,
      cosmeticNotes: product.cosmeticNotes,
      cashPrice: displayPrices.cash,
      installmentPrice: displayPrices.installment,
      installment,
      installment2,
      branchName: product.branch?.name ?? null,
      imeiSerial: product.imeiSerial,
      link: isReady ? shareUrl : undefined,
    }),
  };
}
