import { useQueries } from '@tanstack/react-query';
import api from '@/lib/api';
import type { BcConfigJson, DefaultInstallment } from '@installment/shared';
import { BC_CONFIG_QUERY_KEY } from '@/pages/ProductDetailPage/hooks/useBcConfig';
import { useGfinTables } from '@/pages/ProductDetailPage/hooks/useGfinTables';
import { INITIAL_CALC_STATE } from '@/pages/ProductDetailPage/hooks/useInstallmentCalcState';
import {
  resolveQuotes,
  type ProductForQuotes,
  type ResolvedBc,
  type ResolvedGfin,
} from '@/pages/ProductDetailPage/utils/resolveQuotes';
import { getPositiveDisplayPrices, normalizePositive } from '@/utils/getDisplayPrices';
import type { StickerQuotes } from './stickerView';

export interface QuotableProduct extends ProductForQuotes {
  id: string;
}

/** หมวดที่มีตารางดอกเบี้ยผ่อนกับร้าน — ชุดเดียวกับ useStockInstallments ของหน้ารายการสินค้า */
const BC_CATEGORIES = new Set(['PHONE_NEW', 'PHONE_USED', 'TABLET']);

function toBcRate(bc: ResolvedBc | null): DefaultInstallment | null {
  if (!bc || !bc.quote.result.isValid) return null;
  const monthly = bc.quote.result.monthlyPayment.toNumber();
  return Number.isFinite(monthly) ? { months: bc.months, downAmount: bc.downAmount, monthlyPayment: monthly } : null;
}

function toGfinRate(gfin: ResolvedGfin | null): DefaultInstallment | null {
  if (!gfin || !gfin.quote.available || gfin.months == null) return null;
  const down = gfin.quote.result.downAmountActual.toNumber();
  const monthly = gfin.quote.result.monthlyPayment.toNumber();
  return Number.isFinite(down) && Number.isFinite(monthly)
    ? { months: gfin.months, downAmount: down, monthlyPayment: monthly }
    : null;
}

/**
 * ค่างวดสำหรับสติกเกอร์ของหลายเครื่อง — เรท 1 (ผ่อนกับร้าน) + เรท 2 (ไฟแนนซ์ภายนอก) จาก `resolveQuotes`
 * ด้วยค่าตั้งต้นของเครื่องคำนวณหน้าสินค้า (12 งวด · ดาวน์ขั้นต่ำ · คอมตามหมวด) ⇒ ตัวเลขบนดวงเท่ากับ
 * หน้ารายละเอียดสินค้าและสรุปส่งลูกค้าเป๊ะ · ตารางดอกเบี้ยยิงครั้งเดียวต่อหมวด (query key เดียวกับหน้าสินค้า)
 */
export function useStickerQuotes(products: QuotableProduct[]) {
  const categories = [
    ...new Set(
      products
        .filter(
          (product) =>
            BC_CATEGORIES.has(product.category) &&
            normalizePositive(getPositiveDisplayPrices(product).installment) != null,
        )
        .map((product) => product.category),
    ),
  ];
  const bcQueries = useQueries({
    queries: categories.map((category) => ({
      queryKey: BC_CONFIG_QUERY_KEY(category),
      queryFn: async () => {
        const { data } = await api.get<BcConfigJson>(`/interest-configs/resolved?category=${category}`);
        return data;
      },
      retry: false,
    })),
  });
  const gfin = useGfinTables(products.length > 0);

  const quotes = new Map<string, StickerQuotes>();
  for (const product of products) {
    const index = categories.indexOf(product.category);
    const bcQuery = index >= 0 ? bcQueries[index] : undefined;
    const resolved = resolveQuotes({
      product,
      state: INITIAL_CALC_STATE,
      bcConfig: bcQuery && !bcQuery.isError ? bcQuery.data : undefined,
      gfinTables: gfin.tables,
    });
    quotes.set(product.id, { rate1: toBcRate(resolved.bc), rate2: toGfinRate(resolved.gfin) });
  }

  return {
    quotes,
    isLoading: bcQueries.some((query) => query.isPending) || (products.length > 0 && gfin.isLoading),
  };
}
