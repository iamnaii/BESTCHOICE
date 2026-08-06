import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import {
  buildCustomerSummary,
  buildShopProductUrl,
  computeDefaultBcInstallment,
  type BcConfigJson,
} from '../utils/buildCustomerSummary';

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
}

export function useCustomerSummary(product: ProductForSummary | undefined) {
  // queryKey เดียวกับ InstallmentCalculatorCard → react-query ยิงครั้งเดียว
  const { data: bcConfig } = useQuery<BcConfigJson>({
    queryKey: ['interest-config', product?.category, 'bc'],
    queryFn: async () => {
      const { data } = await api.get(`/interest-configs/resolved?category=${product?.category}`);
      return data;
    },
    // ยิงเฉพาะหมวดที่มีตารางดอกเบี้ยจริง — ACCESSORY/TABLET จะได้ error จาก
    // resolveConfig (interest-config.controller.ts:39-43) ซึ่งไม่ควร retry
    enabled:
      product?.installmentPrice != null &&
      (product?.category === 'PHONE_NEW' || product?.category === 'PHONE_USED'),
    retry: false,
  });

  if (!product) return { summaryText: '', shareUrl: '' };

  const installment = computeDefaultBcInstallment(
    product.installmentPrice != null ? Number(product.installmentPrice) : null,
    bcConfig ?? null,
  );
  const shareUrl = buildShopProductUrl(product.id);

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
      cashPrice: product.cashPrice,
      installmentPrice: product.installmentPrice,
      installment,
      branchName: product.branch?.name ?? null,
      imeiSerial: product.imeiSerial,
      link: shareUrl,
    }),
  };
}
