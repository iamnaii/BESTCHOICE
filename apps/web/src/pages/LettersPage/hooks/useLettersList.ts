import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import type { LettersListFilters, LettersListResponse } from '../types';

const stripUndefined = <T extends object>(obj: T): Partial<T> => {
  const out: any = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined && v !== '') out[k] = v;
  }
  return out;
};

export function useLettersList(filters: LettersListFilters) {
  const params = stripUndefined(filters);
  return useQuery({
    queryKey: ['letters', params],
    queryFn: async (): Promise<LettersListResponse> => {
      const { data } = await api.get<LettersListResponse>('/overdue/letters', { params });
      return data;
    },
    staleTime: 30_000,
  });
}
