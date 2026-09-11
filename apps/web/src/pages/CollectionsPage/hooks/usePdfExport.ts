import { useEffect, useRef } from 'react';
import { downloadProtectedDocument, getDocumentErrorMessage } from '@/lib/document-download';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import api from '@/lib/api';

/**
 * Trigger an on-demand PDF export and stream the blob to the user as a
 * download. Uses axios responseType=blob to keep the binary intact.
 */
export function useGeneratePdf(onDownloaded?: () => void) {
  const active = useRef<AbortController | null>(null);
  const cancel = () => { active.current?.abort(); active.current = null; };
  useEffect(() => () => { active.current?.abort(); active.current = null; }, []);
  const mutation = useMutation({
    mutationFn: async ({ params, controller }: {
      params: { from?: Date; to?: Date }; controller: AbortController;
    }) => {
      const search = new URLSearchParams();
      if (params.from) search.set('from', params.from.toISOString());
      if (params.to) search.set('to', params.to.toISOString());
      await downloadProtectedDocument(`/reporting/pdf?${search}`, `collections-${new Date().toISOString().slice(0, 10)}.pdf`, {
        method: 'post', signal: controller.signal,
      });
    },
    onSuccess: (_data, { controller }) => {
      if (active.current !== controller || controller.signal.aborted) return;
      toast.success('ดาวน์โหลด PDF สำเร็จ');
      onDownloaded?.();
    },
    onError: (error, { controller }) => {
      if (active.current === controller && !controller.signal.aborted) toast.error(getDocumentErrorMessage(error));
    },
    onSettled: (_data, _error, { controller }) => {
      if (active.current === controller) active.current = null;
    },
  });
  return {
    isPending: mutation.isPending,
    cancel,
    generate: (params: { from?: Date; to?: Date }) => {
      if (active.current) return;
      const controller = new AbortController();
      active.current = controller;
      mutation.mutate({ params, controller });
    },
  };
}

export function useReportRecipients() {
  return useQuery({
    queryKey: ['reporting', 'recipients'],
    queryFn: async () => {
      const { data } = await api.get<{ recipients: string[] }>('/reporting/recipients');
      return data.recipients;
    },
    staleTime: 60_000,
  });
}

export function useUpdateRecipients() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (recipients: string[]) => {
      const { data } = await api.put<{ recipients: string[] }>('/reporting/recipients', {
        recipients,
      });
      return data.recipients;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['reporting', 'recipients'] });
      toast.success('บันทึกรายชื่อผู้รับสำเร็จ');
    },
    onError: () => {
      toast.error('บันทึกผู้รับไม่สำเร็จ');
    },
  });
}
