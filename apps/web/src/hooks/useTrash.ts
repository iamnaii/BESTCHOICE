import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';

/**
 * ถังขยะรวม (ก้อน 8 · A10) — รูปข้อมูลต้องตรงกับ `TrashController` / `TrashService` ฝั่ง API
 * (รายการประเภทมาจาก `trash-registry.ts` ฝั่ง API — เว็บไม่ hardcode)
 */
export type TrashDays = 0 | 30 | 90;

export interface TrashTypeInfo {
  type: string;
  label: string;
  group: string;
  count: number;
  restorable: boolean;
}

export interface TrashDeletedBy {
  id: string;
  name: string;
  system: boolean;
}

export interface TrashRow {
  type: string;
  typeLabel: string;
  group: string;
  id: string;
  title: string;
  subtitle: string;
  deletedAt: string;
  deletedBy: TrashDeletedBy | null;
  restorable: boolean;
  reason?: string;
  actionLabel?: string;
  link?: string;
}

export interface TrashListResult {
  data: TrashRow[];
  total: number;
  page: number;
  pageSize: number;
  /** ดูรวมทุกประเภท = ล่าสุด 50 รายการต่อประเภท */
  capped: boolean;
}

export interface TrashRestoreResult {
  ok: true;
  warnings: string[];
  link?: string;
}

export interface TrashBulkResultItem {
  type: string;
  id: string;
  ok: boolean;
  error?: string;
  warnings?: string[];
  link?: string;
}

export interface TrashListQuery {
  type?: string;
  q?: string;
  days: TrashDays;
  page: number;
  pageSize?: number;
}

export const TRASH_KEY = ['trash'] as const;
export const trashRowKey = (row: Pick<TrashRow, 'type' | 'id'>) => `${row.type}:${row.id}`;

export function useTrashTypes(days: TrashDays) {
  return useQuery<TrashTypeInfo[]>({
    queryKey: [...TRASH_KEY, 'types', days],
    queryFn: async () => (await api.get('/trash/types', { params: { days } })).data.types,
  });
}

export function useTrashList(query: TrashListQuery) {
  const params = { type: query.type || undefined, q: query.q || undefined, days: query.days, page: query.page, pageSize: query.pageSize ?? 50 };
  return useQuery<TrashListResult>({
    queryKey: [...TRASH_KEY, 'list', params],
    queryFn: async () => (await api.get('/trash', { params })).data,
    placeholderData: (previous) => previous,
  });
}

export function useRestoreTrash() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (row: Pick<TrashRow, 'type' | 'id'>) => (await api.post(`/trash/${row.type}/${row.id}/restore`)).data as TrashRestoreResult,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: TRASH_KEY }),
  });
}

export function useRestoreTrashBulk() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (items: Array<Pick<TrashRow, 'type' | 'id'>>) =>
      (await api.post('/trash/restore', { items: items.map(({ type, id }) => ({ type, id })) })).data as { results: TrashBulkResultItem[] },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: TRASH_KEY }),
  });
}
