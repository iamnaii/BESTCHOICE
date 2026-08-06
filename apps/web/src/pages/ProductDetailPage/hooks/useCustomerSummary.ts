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

export function useCustomerSummary(product: ProductForSummary | undefined) {
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

  const installment = computeDefaultBcInstallment(displayPrices.installment, bcConfig ?? null);
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
      shopWarrantyDays: product.shopWarrantyDays,
      accessoriesIncluded: product.accessoriesIncluded,
      cosmeticNotes: product.cosmeticNotes,
      cashPrice: displayPrices.cash,
      installmentPrice: displayPrices.installment,
      installment,
      branchName: product.branch?.name ?? null,
      imeiSerial: product.imeiSerial,
      link: isReady ? shareUrl : undefined,
    }),
  };
}
