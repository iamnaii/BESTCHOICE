import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';

export interface CoaAccountRow {
  code: string;
  name: string;
  normalBalance: string;
  vatApplicable: boolean;
  notes: string | null;
}

export interface CoaGroup {
  category: string;
  accounts: CoaAccountRow[];
}

export interface CoaGroupedResponse {
  groups: CoaGroup[];
}

export interface CoaByCodesRow {
  code: string;
  name: string;
}

export interface CoaGroupedFilter {
  type?: string;
  codePrefix?: string;
  category?: string;
}

export function useCoaGroups(filter: CoaGroupedFilter) {
  return useQuery<CoaGroupedResponse>({
    queryKey: ['coa', 'grouped', filter],
    queryFn: async () => {
      const { data } = await api.get<CoaGroupedResponse>('/chart-of-accounts/grouped', {
        params: filter,
      });
      return data;
    },
    staleTime: Infinity,
  });
}

export function useCoaByCodes(codes: string[]) {
  const sortedKey = [...codes].sort().join(',');
  return useQuery<CoaByCodesRow[]>({
    queryKey: ['coa', 'by-codes', sortedKey],
    queryFn: async () => {
      const { data } = await api.get<CoaByCodesRow[]>('/chart-of-accounts/by-codes', {
        params: { codes: codes.join(',') },
      });
      return data;
    },
    staleTime: Infinity,
    enabled: codes.length > 0,
  });
}
