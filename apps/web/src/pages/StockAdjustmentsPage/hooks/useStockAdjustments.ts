import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import api, { getErrorMessage } from '@/lib/api';
import type {
  AdjustmentDetail,
  AdjustmentListFilters,
  AdjustmentListResponse,
  AdjustmentPreview,
  AdjustmentReason,
  ApproveResponse,
  ProductLookupRow,
  StockAdjustmentRow,
} from '../types';

export const ADJUSTMENTS_KEY = ['stock-adjustments'] as const;
export const PENDING_COUNT_KEY = ['stock-adjustment-pending-count'] as const;

function listParams(filters: AdjustmentListFilters): Record<string, string> {
  const params: Record<string, string> = {};
  if (filters.status) params.status = filters.status;
  if (filters.reason) params.reason = filters.reason;
  if (filters.branchId) params.branchId = filters.branchId;
  if (filters.productId) params.productId = filters.productId;
  if (filters.search) params.search = filters.search;
  if (filters.mine) params.mine = 'true';
  if (filters.startDate) params.startDate = filters.startDate;
  if (filters.endDate) params.endDate = filters.endDate;
  params.page = String(filters.page ?? 1);
  params.limit = String(filters.limit ?? 50);
  return params;
}

export function useAdjustmentList(filters: AdjustmentListFilters, enabled = true) {
  return useQuery<AdjustmentListResponse>({
    queryKey: [...ADJUSTMENTS_KEY, 'list', listParams(filters)],
    queryFn: async () => {
      const { data } = await api.get('/stock-adjustments', { params: listParams(filters) });
      return data;
    },
    enabled,
  });
}

export function useAdjustmentDetail(id: string | null) {
  return useQuery<AdjustmentDetail>({
    queryKey: [...ADJUSTMENTS_KEY, 'detail', id],
    queryFn: async () => {
      const { data } = await api.get(`/stock-adjustments/${id}`);
      return data;
    },
    enabled: !!id,
  });
}

export function useProductLookup(q: { imei?: string; search?: string }, reason: AdjustmentReason | '', enabled = true) {
  const term = (q.imei ?? q.search ?? '').trim();
  return useQuery<ProductLookupRow[]>({
    queryKey: [...ADJUSTMENTS_KEY, 'lookup', q.imei ?? '', q.search ?? '', reason],
    queryFn: async () => {
      const { data } = await api.get('/stock-adjustments/lookup', {
        params: { ...(q.imei ? { imei: q.imei } : { search: q.search }), reason: reason || 'CORRECTION' },
      });
      return data ?? [];
    },
    enabled: enabled && term.length >= 2,
    staleTime: 10_000,
  });
}

export function useAdjustmentPreview(productId: string | null, reason: AdjustmentReason | '') {
  return useQuery<AdjustmentPreview>({
    queryKey: [...ADJUSTMENTS_KEY, 'preview', productId, reason],
    queryFn: async () => {
      const { data } = await api.get('/stock-adjustments/preview', { params: { productId, reason } });
      return data;
    },
    enabled: !!productId && !!reason,
  });
}

/** mutation ทุกตัว invalidate รายการ · ป้ายเมนู · สินค้า (สถานะเครื่องเปลี่ยน) */
export function useAdjustmentMutations() {
  const queryClient = useQueryClient();
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ADJUSTMENTS_KEY });
    queryClient.invalidateQueries({ queryKey: PENDING_COUNT_KEY });
    queryClient.invalidateQueries({ queryKey: ['products'] });
    queryClient.invalidateQueries({ queryKey: ['product'] });
    queryClient.invalidateQueries({ queryKey: ['stock'] });
  };

  const createRequest = useMutation({
    mutationFn: async (form: FormData) => {
      const { data } = await api.post<StockAdjustmentRow>('/stock-adjustments', form);
      return data;
    },
    onSuccess: (row) => {
      invalidate();
      toast.success(`ส่งคำขอ ${row.requestNumber ?? ''} แล้ว — รอเจ้าของอนุมัติ`);
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });

  const approve = useMutation({
    mutationFn: async (id: string) => {
      const { data } = await api.post<ApproveResponse>(`/stock-adjustments/${id}/approve`);
      return data;
    },
    onSuccess: (res) => {
      invalidate();
      if (res.journalEntryNo) toast.success(`อนุมัติแล้ว · ลงบัญชี ${res.journalEntryNo}`);
      else if (res.accountingNotified) toast.success('อนุมัติแล้ว · ไม่มีรายการบัญชี — แจ้งฝ่ายบัญชีแล้ว');
      else toast.success('อนุมัติแล้ว');
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });

  const reject = useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }) => {
      const { data } = await api.post<StockAdjustmentRow>(`/stock-adjustments/${id}/reject`, { reason });
      return data;
    },
    onSuccess: () => {
      invalidate();
      toast.success('ไม่อนุมัติ — เครื่องกลับสถานะเดิมแล้ว');
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });

  const cancel = useMutation({
    mutationFn: async (id: string) => {
      const { data } = await api.post<StockAdjustmentRow>(`/stock-adjustments/${id}/cancel`);
      return data;
    },
    onSuccess: () => {
      invalidate();
      toast.success('ยกเลิกคำขอแล้ว — เครื่องกลับสถานะเดิม');
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });

  return { createRequest, approve, reject, cancel };
}
