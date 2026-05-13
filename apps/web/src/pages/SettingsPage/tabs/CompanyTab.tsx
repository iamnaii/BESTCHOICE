import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import api, { getErrorMessage } from '@/lib/api';
import CompanySettings from '../components/CompanySettings';
import type { ConfigItem } from '../components/shared';

export function CompanyTab() {
  const queryClient = useQueryClient();
  const [values, setValues] = useState<Record<string, string>>({});
  const [editingSection, setEditingSection] = useState<string | null>(null);
  const [draftSignatureImage, setDraftSignatureImage] = useState('');
  const [draftSignerName, setDraftSignerName] = useState('');

  const { data: configs = [] } = useQuery<ConfigItem[]>({
    queryKey: ['settings'],
    queryFn: async () => (await api.get('/settings')).data,
  });

  useEffect(() => {
    if (configs.length > 0 && !editingSection) {
      const map: Record<string, string> = {};
      configs.forEach((c) => { map[c.key] = c.value; });
      setValues(map);
    }
  }, [configs, editingSection]);

  const saveMutation = useMutation({
    mutationFn: async (items: { key: string; value: string }[]) => api.patch('/settings', { items }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings'] });
      toast.success('บันทึกสำเร็จ');
      setEditingSection(null);
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  const handleSave = (items: { key: string; value: string }[]) => {
    const finalItems = [
      ...items,
      { key: 'lessor_signature_image', value: draftSignatureImage },
      { key: 'lessor_signer_name', value: draftSignerName },
    ];
    saveMutation.mutate(finalItems);
  };

  const handleEdit = (sectionKey: string) => {
    setEditingSection(sectionKey);
    setDraftSignatureImage(values['lessor_signature_image'] || '');
    setDraftSignerName(values['lessor_signer_name'] || '');
  };

  return (
    <CompanySettings
      values={values}
      editingSection={editingSection}
      onEdit={handleEdit}
      onSave={handleSave}
      onCancel={() => setEditingSection(null)}
      isSaving={saveMutation.isPending}
      draftSignatureImage={draftSignatureImage}
      draftSignerName={draftSignerName}
      setDraftSignatureImage={setDraftSignatureImage}
      setDraftSignerName={setDraftSignerName}
    />
  );
}
