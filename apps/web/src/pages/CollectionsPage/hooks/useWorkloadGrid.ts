import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import api from '@/lib/api';

export interface WorkloadCollector {
  id: string;
  name: string;
}

export interface WorkloadContract {
  id: string;
  contractNumber: string;
  outstanding: number;
  daysOverdue: number;
  customer: { name?: string | null; phone?: string | null } | null;
  assignedTo: { id: string; name: string } | null;
}

interface QueueResponse {
  data: WorkloadContract[];
  total: number;
}

interface UsersListItem {
  id: string;
  name: string;
  role: string;
}

interface UsersListResponse {
  data: UsersListItem[];
}

const COLLECTOR_ROLES = ['SALES', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'OWNER'];

/**
 * Fetches everything the workload-redistribution OWNER grid needs:
 *   - All overdue contracts (queue tab=ALL, capped at 500)
 *   - All collectors (users with collector roles)
 *
 * Provides reassign() and autoBalance() mutations that invalidate the
 * relevant queries on success so the grid re-renders with the new mapping.
 */
export function useWorkloadGrid() {
  const queryClient = useQueryClient();

  const contractsQuery = useQuery<QueueResponse>({
    queryKey: ['collections-workload-contracts'],
    queryFn: async () =>
      (await api.get('/overdue/queue?tab=ALL&limit=500&page=1')).data,
    staleTime: 60_000,
  });

  const collectorsQuery = useQuery<UsersListResponse>({
    queryKey: ['collections-workload-collectors'],
    queryFn: async () => (await api.get('/users?limit=200&page=1')).data,
    staleTime: 5 * 60_000,
  });

  const reassignMutation = useMutation({
    mutationFn: async (params: { contractId: string; assignedToId: string }) => {
      // Existing endpoint: POST /overdue/:contractId/assign
      // Body shape per assign-collector.dto: { assignedToId }
      return (
        await api.post(`/overdue/${params.contractId}/assign`, {
          assignedToId: params.assignedToId,
        })
      ).data;
    },
  });

  const reassignMany = async (
    pairs: { contractId: string; assignedToId: string }[],
  ): Promise<{ ok: number; failed: number }> => {
    let ok = 0;
    let failed = 0;
    // Sequential to keep server load reasonable + give clearer error toasts.
    for (const p of pairs) {
      try {
        await reassignMutation.mutateAsync(p);
        ok += 1;
      } catch {
        failed += 1;
      }
    }
    await queryClient.invalidateQueries({ queryKey: ['collections-workload-contracts'] });
    if (failed === 0) {
      toast.success(`มอบหมายสำเร็จ ${ok} สัญญา`);
    } else {
      toast.error(`มอบหมายสำเร็จ ${ok} · ล้มเหลว ${failed}`);
    }
    return { ok, failed };
  };

  const collectors: WorkloadCollector[] = (collectorsQuery.data?.data ?? [])
    .filter((u) => COLLECTOR_ROLES.includes(u.role))
    .map((u) => ({ id: u.id, name: u.name }));

  const contracts = contractsQuery.data?.data ?? [];

  return {
    contracts,
    collectors,
    isLoading: contractsQuery.isLoading || collectorsQuery.isLoading,
    isError: contractsQuery.isError || collectorsQuery.isError,
    error: contractsQuery.error || collectorsQuery.error,
    refetch: () => {
      contractsQuery.refetch();
      collectorsQuery.refetch();
    },
    reassign: (contractId: string, assignedToId: string) =>
      reassignMany([{ contractId, assignedToId }]),
    reassignMany,
    autoBalance: async () => {
      // Round-robin across collectors over ALL contracts (assigned + unassigned)
      if (collectors.length === 0) {
        toast.error('ไม่พบพนักงานสำหรับกระจายงาน');
        return;
      }
      const pairs = contracts.map((c, idx) => ({
        contractId: c.id,
        assignedToId: collectors[idx % collectors.length].id,
      }));
      await reassignMany(pairs);
    },
  };
}
