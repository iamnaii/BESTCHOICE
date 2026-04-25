import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';

export interface ContractSnapshot {
  contractId: string;
  contractNumber: string;
  status: string;
  customer: {
    id: string;
    name: string;
    phone: string;
  };
  product: {
    name: string;
  };
  totals: {
    totalAmount: number;
    outstanding: number;
    installmentsTotal: number;
    installmentsRemaining: number;
  };
  lastPromise: {
    settlementDate: string;
    result: string;
    notes: string | null;
  } | null;
  lastLine: {
    timestamp: string;
    read: boolean;
  } | null;
  lastCollectorComment: {
    text: string;
    truncated: boolean;
    by: string | null;
    at: string;
  } | null;
}

/**
 * Fetches the lightweight snapshot used by the Customer 360 hover/long-press
 * preview card. Cache for 30s — the panel only opens after a 500ms intent
 * gesture so this hits cache nicely on rapid hover-pop-hover patterns.
 */
export function useContractSnapshot(contractId: string | null, enabled = true) {
  return useQuery({
    queryKey: ['contract-snapshot', contractId],
    queryFn: async () => {
      const { data } = await api.get<ContractSnapshot>(
        `/contracts/${contractId}/snapshot`,
      );
      return data;
    },
    enabled: !!contractId && enabled,
    staleTime: 30_000,
  });
}
