import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import { getPositiveDisplayPrices, type ProductPriceRow } from '@/utils/getDisplayPrices';
import {
  buildCustomerSummary,
  buildShopProductUrl,
  computeDefaultBcInstallment,
  type BcConfigJson,
} from '../utils/buildCustomerSummary';
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

  // queryKey เดียวกับ InstallmentCalculatorCard → react-query ยิงครั้งเดียว
  const { data: bcConfig } = useQuery<BcConfigJson>({
    queryKey: ['interest-config', product?.category, 'bc'],
    queryFn: async () => {
      const { data } = await api.get(`/interest-configs/resolved?category=${product?.category}`);
      return data;
    },
    // ยิงเฉพาะหมวดที่มีตารางดอกเบี้ยจริง — ACCESSORY/TABLET จะได้ error จาก
    // resolveConfig (interest-config.controller.ts:39-43) ซึ่งไม่ควร retry
    // (M2) ถ้า config โหลดพลาด (network/5xx/หมวดไม่มีตาราง) bcConfig จะค้างเป็น undefined →
    // computeDefaultBcInstallment คืน null → buildCustomerSummary ตัดบรรทัด "ผ่อน..." ทิ้งไปเงียบๆ
    // แทนที่จะโชว์ตัวเลขพัง — เป็น behavior เดิมของฟังก์ชันนี้ตั้งแต่ก่อน fix round นี้ ยอมรับได้
    enabled:
      displayPrices.installment != null &&
      (product?.category === 'PHONE_NEW' || product?.category === 'PHONE_USED'),
    retry: false,
  });

  // fix-round 1 (C2): gate บรรทัดลิงก์ในสรุปด้วย readiness จริง — dedupe query key เดียวกับ
  // ReadinessCard (Task 8, ผ่าน PRODUCT_READINESS_QUERY_KEY ภายใน useProductReadiness เอง)
  const { data: readiness } = useProductReadiness(product?.id);

  if (!product) return { summaryText: '', shareUrl: '' };

  // ค่าที่เลือกอยู่ในเครื่องคำนวณมาก่อน (ถ้า valid) — ตกไปค่าตั้งต้นเมื่อการ์ดยังไม่โหลด/ดาวน์ไม่ผ่านเงื่อนไข
  const bcSelected =
    quotes?.bc && quotes.bc.quote.result.isValid
      ? {
          months: quotes.bc.months,
          downAmount: quotes.bc.downAmount,
          monthlyPayment: quotes.bc.quote.result.monthlyPayment.toNumber(),
        }
      : null;
  const installment =
    bcSelected ?? computeDefaultBcInstallment(displayPrices.installment, bcConfig ?? null);
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
