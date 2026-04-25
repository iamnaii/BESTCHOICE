import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import api from '@/lib/api';

/**
 * Trigger an on-demand PDF export and stream the blob to the user as a
 * download. Uses axios responseType=blob to keep the binary intact.
 */
export function useGeneratePdf() {
  return useMutation({
    mutationFn: async (params: { from?: Date; to?: Date }) => {
      const search = new URLSearchParams();
      if (params.from) search.set('from', params.from.toISOString());
      if (params.to) search.set('to', params.to.toISOString());
      const { data } = await api.post(`/reporting/pdf?${search.toString()}`, undefined, {
        responseType: 'blob',
      });
      return data as Blob;
    },
    onSuccess: (blob) => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `collections-${new Date().toISOString().slice(0, 10)}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success('ดาวน์โหลด PDF สำเร็จ');
    },
    onError: () => {
      toast.error('สร้าง PDF ไม่สำเร็จ');
    },
  });
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
