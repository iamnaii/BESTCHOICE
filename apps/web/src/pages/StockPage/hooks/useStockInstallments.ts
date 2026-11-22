import { useQueries } from '@tanstack/react-query';
import api from '@/lib/api';
import { getPositiveDisplayPrices, normalizePositive } from '@/utils/getDisplayPrices';
import {
  computeDefaultBcInstallment,
  type BcConfigJson,
} from '@/pages/ProductDetailPage/utils/buildCustomerSummary';
import { useGfinTables } from '@/pages/ProductDetailPage/hooks/useGfinTables';
import { resolveGfinQuote } from '@/pages/ProductDetailPage/utils/gfinQuote';
import { INITIAL_CALC_STATE } from '@/pages/ProductDetailPage/hooks/useInstallmentCalcState';
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
      const terms = product.templateTerms;
      const quote = computeDefaultBcInstallment(price, query?.isError ? null : query?.data, {
        months: terms?.rate1TermMonths,
        downAmount:
          price != null && normalizePositive(terms?.bcPrice) === price
            ? normalizePositive(terms?.rate1DownPayment)
            : null,
      });
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

  const eligible = products.filter(
    (product) =>
      ['PHONE_NEW', 'PHONE_USED', 'TABLET'].includes(product.category) &&
      (normalizePositive(product.financePrice) ??
        normalizePositive(getPositiveDisplayPrices(product).installment)) != null,
  );
  const gfin = useGfinTables(eligible.length > 0);
  const gfinInstallments = new Map<
    string,
    {
      quote: { downAmount: number; monthlyPayment: number; months: number } | null;
      isLoading: boolean;
      isError: boolean;
      unavailableReason: string | null;
    }
  >(
    products.map((product) => {
      const enabled = eligible.includes(product);
      const price =
        normalizePositive(product.financePrice) ??
        normalizePositive(getPositiveDisplayPrices(product).installment);
      const result =
        enabled && price != null && gfin.tables && !gfin.isError
          ? resolveGfinQuote(
              gfin.tables,
              { ...product, deviceOrigin: product.deviceOrigin ?? null },
              price,
              {
                ...INITIAL_CALC_STATE.gfin,
                templateMonths: product.templateTerms?.rate2TermMonths,
              },
            )
          : null;
      const quote =
        result?.quote.available && result.months != null
          ? {
              downAmount: result.quote.result.downAmountActual.toNumber(),
              monthlyPayment: result.quote.result.monthlyPayment.toNumber(),
              months: result.months,
            }
          : null;
      const reasons = {
        unsupported_category: 'ไม่รองรับหมวดนี้',
        no_mapping: 'ยังไม่มีรุ่นในตาราง GFIN',
        no_rule: 'ยังไม่มีเงื่อนไข GFIN',
        no_factor: 'ยังไม่มีเรทผ่อน GFIN',
      };
      return [
        product.id,
        {
          quote,
          isLoading: enabled && gfin.isLoading,
          isError: enabled && gfin.isError,
          unavailableReason:
            result && !result.quote.available ? reasons[result.quote.reason] : null,
        },
      ];
    }),
  );

  return {
    installments,
    gfinInstallments,
    isError: queries.some((query) => query.isError) || (eligible.length > 0 && gfin.isError),
    isFetching: queries.some((query) => query.isFetching),
    retry: () => {
      if (eligible.length > 0) gfin.retry();
      queries
        .filter((query) => query.isError)
        .forEach((query) => {
          void query.refetch();
        });
    },
  };
}
