import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import api from '@/lib/api';

export type SmsChannel = 'SMS' | 'LINE';

export interface TemplateVariable {
  name: string;
  label: string;
}

export interface SmsTemplate {
  id: string;
  name: string;
  channel: SmsChannel;
  subject: string | null;
  body: string;
  variables: TemplateVariable[];
  active: boolean;
  variantOf: string | null;
  parent?: { id: string; name: string } | null;
  variants?: { id: string; name: string; active: boolean }[];
  createdAt: string;
  updatedAt: string;
}

export interface CreateBody {
  name: string;
  channel: SmsChannel;
  subject?: string | null;
  body: string;
  variables: TemplateVariable[];
  active?: boolean;
}

export type UpdateBody = Partial<CreateBody>;

export interface PreviewResult {
  rendered: string;
  usedSampleData: Record<string, string | number>;
}

export function useListTemplates(channel?: SmsChannel | 'ALL') {
  return useQuery({
    queryKey: ['sms-templates', channel ?? 'ALL'],
    queryFn: async () => {
      const params = channel && channel !== 'ALL' ? { channel } : {};
      const { data } = await api.get<SmsTemplate[]>('/sms-templates', { params });
      return data;
    },
    staleTime: 30_000,
  });
}

export function useCreateTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: CreateBody) => {
      const { data } = await api.post<SmsTemplate>('/sms-templates', body);
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sms-templates'] });
      toast.success('สร้าง template เรียบร้อย');
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.message ?? 'สร้าง template ล้มเหลว');
    },
  });
}

export function useUpdateTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...body }: UpdateBody & { id: string }) => {
      const { data } = await api.patch<SmsTemplate>(`/sms-templates/${id}`, body);
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sms-templates'] });
      toast.success('บันทึก template เรียบร้อย');
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.message ?? 'บันทึก template ล้มเหลว');
    },
  });
}

export function useDeleteTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/sms-templates/${id}`);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sms-templates'] });
      toast.success('ลบ template เรียบร้อย');
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.message ?? 'ลบ template ล้มเหลว');
    },
  });
}

export function usePreviewTemplate() {
  return useMutation({
    mutationFn: async ({
      id,
      sampleData,
    }: {
      id: string;
      sampleData?: Record<string, string | number>;
    }) => {
      const { data } = await api.post<PreviewResult>(`/sms-templates/${id}/preview`, {
        sampleData,
      });
      return data;
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.message ?? 'render preview ล้มเหลว');
    },
  });
}

export function useCreateVariant() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      parentId,
      name,
      body,
    }: {
      parentId: string;
      name?: string;
      body?: string;
    }) => {
      const { data } = await api.post<SmsTemplate>(`/sms-templates/${parentId}/variant`, {
        name,
        body,
      });
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sms-templates'] });
      toast.success('สร้าง A/B variant เรียบร้อย');
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.message ?? 'สร้าง variant ล้มเหลว');
    },
  });
}
