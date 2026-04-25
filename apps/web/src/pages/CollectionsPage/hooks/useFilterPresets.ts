import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import api from '@/lib/api';
import type { QueueFilterState } from './useQueueFilter';

export type FilterPresetScope = 'PRIVATE' | 'SHARED_BRANCH' | 'SHARED_ALL';

export interface FilterPreset {
  id: string;
  name: string;
  ownerUserId: string;
  scope: FilterPresetScope;
  branchId: string | null;
  page: string;
  filterJson: QueueFilterState;
  createdAt: string;
  updatedAt: string;
}

export interface CreatePresetBody {
  name: string;
  scope: FilterPresetScope;
  page: string;
  filterJson: QueueFilterState;
  branchId?: string;
}

export function useListPresets(page: string) {
  return useQuery({
    queryKey: ['filter-presets', page],
    queryFn: async () => {
      const { data } = await api.get<FilterPreset[]>('/filter-presets', { params: { page } });
      return data;
    },
    staleTime: 60_000,
  });
}

export function useCreatePreset() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: CreatePresetBody) => {
      const { data } = await api.post<FilterPreset>('/filter-presets', body);
      return data;
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['filter-presets', vars.page] });
      toast.success('บันทึก preset แล้ว');
    },
    onError: (err: any) => {
      const msg = err?.response?.data?.message ?? 'บันทึก preset ล้มเหลว';
      toast.error(msg);
    },
  });
}

export function useDeletePreset(page: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/filter-presets/${id}`);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['filter-presets', page] });
      toast.success('ลบ preset แล้ว');
    },
    onError: (err: any) => {
      const msg = err?.response?.data?.message ?? 'ลบ preset ล้มเหลว';
      toast.error(msg);
    },
  });
}
