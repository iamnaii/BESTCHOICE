import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import type { PettyCashMovementKind, PettyCashMovementPayload, PettyCashMovementsPage, PettyCashRecordResult, PettyCashSummary } from '../types';

export const pettyCashKeys = {
  all: ['shop-petty-cash'] as const,
  summary: ['shop-petty-cash', 'summary'] as const,
  movements: (month: string) => ['shop-petty-cash', 'movements', month] as const,
};

export const PETTY_CASH_ENDPOINT: Record<PettyCashMovementKind, string> = {
  TOP_UP: '/shop/petty-cash/top-ups',
  RETURN: '/shop/petty-cash/returns',
};

export function usePettyCashSummary() {
  return useQuery({
    queryKey: pettyCashKeys.summary,
    queryFn: async () => (await api.get('/shop/petty-cash/summary')).data as PettyCashSummary,
  });
}

export function usePettyCashMovements(month: string) {
  return useQuery({
    queryKey: pettyCashKeys.movements(month),
    queryFn: async () => (await api.get('/shop/petty-cash/movements', { params: { month } })).data as PettyCashMovementsPage,
    enabled: !!month,
  });
}

/** เติม/คืน — multipart (รูปหลักฐานไม่บังคับในช่อง `evidence`) · สำเร็จแล้วรีเฟรชยอดและตารางทุกเดือน */
export function useRecordPettyCash(kind: PettyCashMovementKind) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: PettyCashMovementPayload) => {
      const form = new FormData();
      form.append('amount', payload.amount.toFixed(2));
      form.append('bankAccountCode', payload.bankAccountCode);
      form.append('movedAt', payload.movedAt);
      if (payload.note?.trim()) form.append('note', payload.note.trim());
      form.append('requestId', payload.requestId);
      if (payload.evidence) form.append('evidence', payload.evidence);
      return (await api.post(PETTY_CASH_ENDPOINT[kind], form)).data as PettyCashRecordResult;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: pettyCashKeys.all }),
  });
}

export function useSetPettyCashLimit() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (limit: number) => (await api.put('/shop/petty-cash/limit', { limit })).data as PettyCashSummary['limit'],
    onSuccess: () => queryClient.invalidateQueries({ queryKey: pettyCashKeys.all }),
  });
}
