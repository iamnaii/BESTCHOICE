import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import api, { getErrorMessage } from '@/lib/api';

export type CustomerTagType = 'VIP' | 'HIGH_RISK' | 'NEW' | 'LOYAL' | 'BLACKLIST';
export type CustomerTagSource = 'AUTO' | 'MANUAL';

export interface CustomerTag {
  id: string;
  customerId: string;
  tag: CustomerTagType;
  source: CustomerTagSource;
  reason: string | null;
  appliedByUserId: string | null;
  createdAt: string;
}

export function useCustomerTags(customerId: string | null) {
  return useQuery({
    queryKey: ['customer-tags', customerId],
    queryFn: async () => {
      const { data } = await api.get<CustomerTag[]>('/customer-tags', {
        params: { customerId },
      });
      return data;
    },
    enabled: !!customerId,
    staleTime: 30_000,
  });
}

export function useApplyCustomerTag() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: {
      customerId: string;
      tag: CustomerTagType;
      reason?: string;
    }) => {
      const { data } = await api.post<CustomerTag>('/customer-tags', payload);
      return data;
    },
    onSuccess: (_, vars) => {
      toast.success('เพิ่ม tag สำเร็จ');
      qc.invalidateQueries({ queryKey: ['customer-tags', vars.customerId] });
      // Tags drive dunning + queue chips — refresh queue too.
      qc.invalidateQueries({ queryKey: ['overdue-queue'] });
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });
}

export function useRemoveCustomerTag() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id }: { id: string; customerId: string }) => {
      const { data } = await api.delete<{ removed: number }>(`/customer-tags/${id}`);
      return data;
    },
    onSuccess: (_, vars) => {
      toast.success('ลบ tag แล้ว');
      qc.invalidateQueries({ queryKey: ['customer-tags', vars.customerId] });
      qc.invalidateQueries({ queryKey: ['overdue-queue'] });
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });
}

/**
 * Trigger an immediate auto-tag recompute for one customer (the "Recompute
 * tags" button on Customer 360). Does not show progress UI — recompute is
 * fast (single customer) so we just toast on success.
 */
export function useRecomputeCustomerTags() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (customerId: string) => {
      const { data } = await api.post<{
        added: CustomerTagType[];
        removed: CustomerTagType[];
      }>(`/customer-tags/recompute/${customerId}`);
      return data;
    },
    onSuccess: (data, customerId) => {
      const summary =
        data.added.length === 0 && data.removed.length === 0
          ? 'ไม่มีการเปลี่ยนแปลง'
          : `เพิ่ม ${data.added.length} ลบ ${data.removed.length}`;
      toast.success(`Recompute เสร็จ — ${summary}`);
      qc.invalidateQueries({ queryKey: ['customer-tags', customerId] });
      qc.invalidateQueries({ queryKey: ['overdue-queue'] });
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });
}
