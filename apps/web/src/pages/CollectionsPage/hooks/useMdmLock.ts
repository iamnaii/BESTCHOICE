import { useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';

/**
 * Manual lock — calls POST /mdm/contracts/:contractId/lock.
 * Used by Customer360Panel "ล็อคเครื่อง" button (no approval queue).
 * Open to OWNER + FINANCE_MANAGER + BRANCH_MANAGER + SALES on the backend.
 */
export function useLockContract() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      contractId,
      reason,
    }: {
      contractId: string;
      reason: string;
    }) => {
      const { data } = await api.post(`/mdm/contracts/${contractId}/lock`, {
        reason,
      });
      return data;
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['collections'] });
      qc.invalidateQueries({ queryKey: ['contracts'] });
      qc.invalidateQueries({ queryKey: ['customer-360', vars.contractId] });
      qc.invalidateQueries({ queryKey: ['pending-mdm'] });
    },
  });
}

/**
 * Manual unlock — calls POST /mdm/contracts/:contractId/unlock.
 * Mirror of useLockContract.
 */
export function useUnlockContract() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (contractId: string) => {
      const { data } = await api.post(`/mdm/contracts/${contractId}/unlock`);
      return data;
    },
    onSuccess: (_data, contractId) => {
      qc.invalidateQueries({ queryKey: ['collections'] });
      qc.invalidateQueries({ queryKey: ['contracts'] });
      qc.invalidateQueries({ queryKey: ['customer-360', contractId] });
      qc.invalidateQueries({ queryKey: ['pending-mdm'] });
    },
  });
}
