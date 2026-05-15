import { useQuery } from '@tanstack/react-query';
import { assetsApi } from '@/pages/assets/api';

export function useDraftAssetCount(enabled: boolean): number | undefined {
  const query = useQuery({
    queryKey: ['asset-draft-count'],
    queryFn: () => assetsApi.list({ status: 'DRAFT', limit: 1, page: 1 }),
    enabled,
    refetchInterval: 30_000,        // 30s
    refetchOnWindowFocus: true,
    staleTime: 10_000,
  });
  return query.data?.total;
}
