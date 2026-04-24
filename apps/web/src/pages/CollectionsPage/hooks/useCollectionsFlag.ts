import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';

/**
 * Reads the collections_v2_enabled feature flag from the backend. Cached 5 min.
 * When enabled=true, the app should route /overdue -> /collections.
 */
export function useCollectionsFlag() {
  const { data, isLoading } = useQuery<{ enabled: boolean }>({
    queryKey: ['collections-flag'],
    queryFn: async () => {
      const { data } = await api.get('/overdue/collections-flag');
      return data;
    },
    staleTime: 5 * 60 * 1000,
  });
  return { enabled: data?.enabled ?? false, isLoading };
}
