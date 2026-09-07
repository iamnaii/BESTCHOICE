import { useState, useRef } from 'react';
import { useQuery, useMutation, useMutationState, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import api, { getErrorMessage } from '@/lib/api';
import { validateCreditFile, type StatementResult } from '../components/credit-statement';

export interface RoomCreditFile {
  id: string;
  roomId: string;
  name: string;
  mimeType: string;
  size: number;
  sourceMessageId: string | null;
  url: string;
}
export interface RoomCreditAnalysis {
  id: string;
  status: string;
  fileIds: string[];
  result?: StatementResult | null;
  error?: string | null;
  createdAt: string;
}
interface RoomCreditData {
  files: RoomCreditFile[];
  analysis: RoomCreditAnalysis | null;
}
export interface RoomCreditModel extends RoomCreditData {
  roomId: string | null;
  busy: boolean;
  analyzing: boolean;
  loading: boolean;
  error: string | null;
  upload(files: File[]): void;
  toggleMessage(messageId: string): void;
  remove(fileId: string): void;
  analyze(): void;
  retry(): void;
}
type CreditAction = { roomId: string } & (
  | { kind: 'upload'; files: File[] }
  | { kind: 'message'; messageId: string }
  | { kind: 'remove'; fileId: string }
  | { kind: 'analyze'; fileIds: string[] }
);

export const creditHistoryKeys = [
  'customers',
  'credit-checks',
  'customer-credit-checks',
  'customer-latest-credit',
  'customer-credit-check-latest-statement',
];

export function useRoomCredit(
  roomId: string | null,
  onAttached: (roomId: string) => void,
): RoomCreditModel {
  const qc = useQueryClient();
  const [errors, setErrors] = useState<Record<string, string | null>>({});
  const activeActions = useRef(new Set<string>());
  const query = useQuery<RoomCreditData>({
    queryKey: ['room-credit', roomId],
    enabled: !!roomId,
    queryFn: async () => (await api.get(`/staff-chat/rooms/${roomId}/credit-check`)).data,
    refetchInterval: (q) => (q.state.data?.analysis?.status === 'ANALYZING' ? 2500 : 15000),
  });
  const pending = useMutationState({
    filters: { mutationKey: ['room-credit-action'], status: 'pending' },
    select: (m) => m.state.variables as CreditAction,
  }).filter((action) => action.roomId === roomId);
  const action = useMutation({
    mutationKey: ['room-credit-action'],
    mutationFn: async (input: CreditAction) => {
      const base = `/staff-chat/rooms/${input.roomId}/credit-check`;
      if (input.kind === 'analyze')
        return api.post(
          '/ocr/bank-statement',
          { roomId: input.roomId, fileIds: input.fileIds },
          { timeout: 120000 },
        );
      if (input.kind === 'message')
        return api.post(`${base}/messages`, { messageId: input.messageId }, { timeout: 120000 });
      if (input.kind === 'remove') return api.delete(`${base}/files/${input.fileId}`);
      const failures: string[] = [];
      for (const [index, file] of input.files.entries()) {
        try {
          await validateCreditFile(file);
        } catch (error) {
          failures.push(
            `ไฟล์ที่ ${index + 1}: ${error instanceof Error ? error.message : 'อ่านไฟล์ไม่ได้ กรุณาเลือกใหม่'}`,
          );
          continue;
        }
        try {
          const form = new FormData();
          form.append('file', file);
          await api.post(`${base}/files`, form, {
            timeout: 120000,
            headers: { 'Content-Type': 'multipart/form-data' },
          });
          await qc.invalidateQueries({ queryKey: ['room-credit', input.roomId] });
        } catch (error) {
          failures.push(`ไฟล์ที่ ${index + 1}: ${getErrorMessage(error)}`);
        }
      }
      return { attachedCount: input.files.length - failures.length, failures };
    },
    onSuccess: (data, input) => {
      if (input.kind === 'message') onAttached(input.roomId);
      if (input.kind === 'upload' && data && 'attachedCount' in data) {
        if (data.attachedCount > 0) onAttached(input.roomId);
        if (data.failures.length) {
          const message = `แนบสำเร็จ ${data.attachedCount} ไฟล์\n${data.failures.join('\n')}`;
          setErrors((previous) => ({ ...previous, [input.roomId]: message }));
          toast.error(message);
        }
      }
      if (input.kind === 'analyze') toast.success('อ่านสเตทเม้นแล้ว');
    },
    onError: (error, input) => {
      const message = getErrorMessage(error);
      setErrors((previous) => ({ ...previous, [input.roomId]: message }));
      toast.error(message);
    },
    onSettled: async (_data, _error, input) => {
      await qc.invalidateQueries({ queryKey: ['room-credit', input.roomId] });
      await Promise.all(creditHistoryKeys.map((key) => qc.invalidateQueries({ queryKey: [key] })));
      activeActions.current.delete(input.roomId);
    },
  });
  const files = query.data?.files ?? [];
  const analysis = query.data?.analysis ?? null;
  const analyzing = analysis?.status === 'ANALYZING' || pending.some((p) => p.kind === 'analyze');
  const busy = pending.length > 0 || analyzing;
  const run = (input: CreditAction) => {
    if (activeActions.current.has(input.roomId) || busy) return;
    activeActions.current.add(input.roomId);
    setErrors((previous) => ({ ...previous, [input.roomId]: null }));
    action.mutate(input);
  };
  return {
    roomId,
    files,
    analysis,
    busy,
    analyzing,
    loading: !!roomId && query.isPending,
    error:
      (roomId ? errors[roomId] : null) || (query.isError ? getErrorMessage(query.error) : null),
    upload: (files) => {
      if (roomId && files.length) run({ roomId, kind: 'upload', files });
    },
    toggleMessage: (messageId) => {
      if (!roomId) return;
      const existing = files.find((file) => file.sourceMessageId === messageId);
      run(
        existing
          ? { roomId, kind: 'remove', fileId: existing.id }
          : { roomId, kind: 'message', messageId },
      );
    },
    remove: (fileId) => {
      if (roomId) run({ roomId, kind: 'remove', fileId });
    },
    analyze: () => {
      if (roomId && files.length)
        run({ roomId, kind: 'analyze', fileIds: files.map((file) => file.id) });
    },
    retry: () => {
      if (roomId) setErrors((previous) => ({ ...previous, [roomId]: null }));
      void query.refetch();
    },
  };
}
