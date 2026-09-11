import { useQuery } from '@tanstack/react-query';
import type { ContractQuote } from '@installment/shared';
import api from '@/lib/api';

export interface ContractQuoteInput {
  customerId?: string; productId?: string; branchId?: string;
  sellingPrice: number; downPayment: number; totalMonths: number; paymentDueDay: number;
  tradeInCreditId?: string;
}

export function useContractQuote(input: ContractQuoteInput, enabled: boolean) {
  return useQuery({
    queryKey: ['contract-quote', input],
    queryFn: async ({ signal }) => (await api.post<ContractQuote>('/contracts/quote', input, { signal })).data,
    enabled: enabled && !!input.customerId && !!input.productId && !!input.branchId && input.sellingPrice > 0,
    placeholderData: undefined,
    staleTime: 0,
    retry: false,
  });
}
