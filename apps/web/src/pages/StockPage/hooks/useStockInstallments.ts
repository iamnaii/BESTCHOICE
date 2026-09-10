import { useQueries } from '@tanstack/react-query';
import api from '@/lib/api';
import { getPositiveDisplayPrices, normalizePositive } from '@/utils/getDisplayPrices';
import {
  computeDefaultBcInstallment,
  type BcConfigJson,
} from '@/pages/ProductDetailPage/utils/buildCustomerSummary';
import type { StockProduct } from '../types';

export function useStockInstallments(products: StockProduct[]) {
  // Resolve once per supported category, sharing the detail page's query cache.
  const categories = [
    ...new Set(
      products
        .filter(
          (product) =>
            ['PHONE_NEW', 'PHONE_USED', 'TABLET'].includes(product.category) &&
            normalizePositive(getPositiveDisplayPrices(product).installment) != null,
        )
        .map((product) => product.category),
    ),
  ];
  const queries = useQueries({
    queries: categories.map((category) => ({
      queryKey: ['interest-config', category, 'bc'],
      queryFn: async () => {
        const { data } = await api.get<BcConfigJson>(
          `/interest-configs/resolved?category=${category}`,
        );
        return data;
      },
      retry: false,
    })),
  });

  const installments = new Map(
    products.map((product) => {
      const price = normalizePositive(getPositiveDisplayPrices(product).installment);
      const query = price != null ? queries[categories.indexOf(product.category)] : undefined;
      const quote = computeDefaultBcInstallment(price, query?.isError ? null : query?.data);
      return [
        product.id,
        {
          quote,
          isLoading: query?.isPending ?? false,
          isError: query?.isError ?? false,
          unavailableReason:
            query?.data && !quote
              ? query.data.allowedMonths.length === 0
                ? 'ยังไม่มีเงื่อนไขผ่อน'
                : 'ตรวจเงื่อนไขผ่อน'
              : null,
        },
      ];
    }),
  );

  return {
    installments,
    isError: queries.some((query) => query.isError),
    isFetching: queries.some((query) => query.isFetching),
    retry: () => {
      queries
        .filter((query) => query.isError)
        .forEach((query) => {
          void query.refetch();
        });
    },
  };
}
