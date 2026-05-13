import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import PageHeader from '@/components/ui/PageHeader';
import api, { getErrorMessage } from '@/lib/api';
import GeneralSettings from './components/GeneralSettings';
import type { ConfigItem } from './components/shared';

export default function GeneralSettingsPage() {
  useDocumentTitle('ตั้งค่าทั่วไป');
  const queryClient = useQueryClient();
  const [values, setValues] = useState<Record<string, string>>({});
  const [editingSection, setEditingSection] = useState<string | null>(null);

  const { data: configs = [] } = useQuery<ConfigItem[]>({
    queryKey: ['settings'],
    queryFn: async () => (await api.get('/settings')).data,
  });

  useEffect(() => {
    if (configs.length > 0 && !editingSection) {
      const map: Record<string, string> = {};
      configs.forEach((c) => {
        map[c.key] = c.value;
      });
      setValues(map);
    }
  }, [configs, editingSection]);

  const saveMutation = useMutation({
    mutationFn: async (items: { key: string; value: string }[]) =>
      api.patch('/settings', { items }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings'] });
      toast.success('บันทึกสำเร็จ');
      setEditingSection(null);
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="ตั้งค่าทั่วไป"
        subtitle="บัญชีธนาคาร, ค่าปรับ, PDPA และ payment gateway"
      />
      {/* penalty + pdpa */}
      <GeneralSettings
        values={values}
        editingSection={editingSection}
        onEdit={setEditingSection}
        onSave={(items) => saveMutation.mutate(items)}
        onCancel={() => setEditingSection(null)}
        isSaving={saveMutation.isPending}
        slot="pre"
      />
      {/* banking + payment_link */}
      <GeneralSettings
        values={values}
        editingSection={editingSection}
        onEdit={setEditingSection}
        onSave={(items) => saveMutation.mutate(items)}
        onCancel={() => setEditingSection(null)}
        isSaving={saveMutation.isPending}
        slot="post"
      />
    </div>
  );
}
