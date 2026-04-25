import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';

export interface SearchResult {
  contracts: {
    id: string;
    contractNumber: string;
    customerName: string;
    status: string;
  }[];
  customers: {
    id: string;
    name: string;
    phone: string | null;
  }[];
  imeis: {
    contractId: string;
    imei: string;
    contractNumber: string;
    customerName: string;
  }[];
  letterTrackings: {
    letterId: string;
    trackingNumber: string;
    contractId: string;
    contractNumber: string;
  }[];
}

/**
 * Debounced union search across contracts, customers, letter tracking
 * numbers, and IMEIs. Returns grouped results for CommandPalette.
 *
 * The caller is expected to debounce `q` (see `useDebounce` in
 * CommandPalette). Server enforces min 2 chars — we mirror that with
 * `enabled` to avoid firing requests for single-char queries.
 */
export function useUnionSearch(q: string) {
  return useQuery<SearchResult>({
    queryKey: ['search-union', q],
    queryFn: async () => {
      const res = await api.get<SearchResult>('/search/union', {
        params: { q },
      });
      return res.data;
    },
    enabled: q.trim().length >= 2,
    staleTime: 30_000,
  });
}
