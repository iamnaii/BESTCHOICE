import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';

/**
 * Distinct system-user display names — used to populate the `<datalist>` of
 * custodian / responsible-person comboboxes (asset entry + transfer, petty-cash
 * custodian, ...). The user can pick a name OR type a custom one, so these are
 * suggestions only. `/users` returns paginated `{ data, total, page, limit }`.
 */
export function useUserNames(): string[] {
  const query = useQuery({
    queryKey: ['users', 'names'],
    queryFn: async () => {
      const res = await api.get('/users', { params: { limit: 500 } });
      const list: { id: string; name: string }[] =
        res.data?.data ?? (Array.isArray(res.data) ? res.data : []);
      return list;
    },
    staleTime: 5 * 60_000,
  });
  return Array.from(new Set((query.data ?? []).map((u) => u.name).filter(Boolean)));
}
